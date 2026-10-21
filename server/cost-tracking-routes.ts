/**
 * Cost tracking — the API.
 *
 * All of the arithmetic is in shared/cost-tracking.ts. This file stores and
 * fetches, converts cents to dollars at the edge, and freezes a baseline from
 * an RFP's budget when a project is opened.
 *
 * Reads and writes are admin-only for now (Adolfo, 2026-10-20). What a
 * job actually cost is not leasing-team data.
 */
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { db } from './db';
import { storage } from './storage';
import { requireAuth, requireAdmin } from './middleware';
import {
  costProjects, costContracts, costChangeOrders, costSovLines,
  costApplications, costApplicationLines, costDocuments, costPayments, costDirectCosts, costWaivers,
} from '@shared/schema';
import {
  normalizeApproval, effectiveBaseline, discountState, snapshotOriginal, pricedTotal, normalizeCO, coTotals, coSummary,
  type BudgetApproval, type BudgetCO,
} from '@shared/cost-budget-approval';
import { positionAsOf, detectCmFee, cmFeeEarned, buildLedger, cmInvoiceCalc, billableItems, paidItems, invoiceCalc, type DatedApplication, type Payment } from '@shared/cost-position';
import { eq, inArray, like, desc } from 'drizzle-orm';
import {
  budgetVsActual, g702For, formatProjectNumber,
  type BaselineLine, type SovLine, type ChangeOrder, type Application, type AllocationMode,
} from '@shared/cost-tracking';
import { headIds, lineSplitWithHeads, isCoveredByHead } from '@shared/budget-totals';
import { resolveContractBucket } from './budget-by-contract';
import { backupToObjectStorage, streamFromObjectStorage, downloadFromObjectStorage } from './storage-backup';
import archiver from 'archiver';
import Anthropic from '@anthropic-ai/sdk';
import { requireAi } from './lib/ai-switch';
import { normalizeRead, matchRows, payAppPrompt } from '@shared/cost-payapp-read';

const AI_MODEL = 'claude-sonnet-4-5';
import { waiverChecklist, previousApp, DOC_TYPES, type Waiver } from '@shared/cost-waivers';
import { generatedByName } from './lib/report-shell';
import { pctText } from '@shared/format';

// Admins only for now (Adolfo, 2026-10-20).
const canEdit = [requireAuth, requireAdmin] as const;
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ------------------------------------------------------------------ money

/** Dollars in from the client — "1,234.56", 1234.56 — to integer cents. */
export function toCents(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const x = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(x) ? Math.round(x * 100) : 0;
}
const dollars = (cents: number | null | undefined) => Math.round(Number(cents ?? 0)) / 100;

const ALLOCATION_MODES: AllocationMode[] = ['direct', 'spread', 'unallocated'];
const CO_STATUSES = ['approved', 'pending', 'void'];
const BUCKETS = ['contractor', 'design', 'cm', 'misc'];

/** Keep only well-formed allocations: a key and a percentage between 0 and 100. */
export function cleanAllocations(raw: unknown): Array<{ baselineKey: string; pct: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a: any) => ({ baselineKey: String(a?.baselineKey ?? '').trim(), pct: Number(a?.pct) }))
    .filter((a) => a.baselineKey && Number.isFinite(a.pct) && a.pct > 0 && a.pct <= 100);
}

const METHODS = ['card', 'check', 'ach', 'wire', 'other'];
class UserError extends Error {}

const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));

const intParam = (req: Request, name: string) => {
  const v = parseInt(String(req.params[name]), 10);
  return Number.isFinite(v) ? v : null;
};
const who = (req: Request) => {
  const u: any = (req as any).user;
  return String(u?.email || u?.username || (req as any).userId || '');
};
/** A person's name for anything printed: "Adolfo Reutlinger", not an email address. */
const whoName = (req: Request) => generatedByName((req as any).user) || who(req);

// --------------------------------------------------------------- baseline

/**
 * Freeze an RFP's budget as the project's baseline.
 *
 * Each line carries its FULL cost, because actuals arrive at full cost, and
 * its tenant share, so actuals can be split the same way the budget was.
 * Assembly heads are taken at their components' value and the components
 * themselves are not listed again — the rule in shared/budget-totals.
 */
export function baselineFromEvaluation(budget: any, catalogById: Map<number, any>): BaselineLine[] {
  const ti = budget?.tenantImprovements || [];
  const dsc = budget?.designSoftCosts || [];
  const ei = budget?.existingImprovements || [];
  const all = [...ti, ...dsc, ...ei];
  const heads = headIds(all, budget?.customAssemblies || []);
  const includeExisting = !!budget?.hasExistingImprovements && !!budget?.includeExistingInTotal;
  const counted = [...ti, ...dsc, ...(includeExisting ? ei : [])];
  const out: (BaselineLine & { masterItemId?: number | null })[] = [];
  for (const line of counted) {
    if (isCoveredByHead(line, heads)) continue;
    const split = lineSplitWithHeads(line, all, heads);
    if (Math.abs(split.full) < 0.005) continue;
    const cat = line?.masterItemId != null ? catalogById.get(line.masterItemId) : undefined;
    const isHead = heads.has(String(line?.id ?? ''));
    const share = isHead
      ? (split.full ? Math.round((split.tenant / split.full) * 10000) / 100 : 100)
      : Number.isFinite(Number(line?.tenantShare)) ? Number(line.tenantShare) : 100;
    out.push({
      key: String(line?.id ?? nanoid(8)),
      description: String(line?.description ?? ''),
      bucket: resolveContractBucket(String(line?.description ?? ''), cat),
      budget: Math.round(split.full * 100) / 100,
      tenantSharePct: share,
      masterItemId: line?.masterItemId ?? null,
    });
  }
  return out;
}

/** A ROM pilot's lines, as a baseline. The allowance is the tenant's. */
function baselineFromRom(items: any[], catalogById: Map<number, any>): BaselineLine[] {
  return (items || [])
    .map((it: any) => {
      const cat = catalogById.get(it.scopeItemId);
      const amount = parseFloat(it.totalPrice) || 0;
      return {
        key: `rom-${it.id}`,
        description: cat?.name || `Item #${it.scopeItemId}`,
        bucket: resolveContractBucket(cat?.name || '', cat),
        budget: Math.round(amount * 100) / 100,
        tenantSharePct: 100,
        masterItemId: it.scopeItemId ?? null,
      };
    })
    .filter((b) => Math.abs(b.budget) >= 0.005);
}

/** Clean a baseline the client sent: keys unique, numbers numbers. */
export function cleanBaseline(raw: unknown): BaselineLine[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: BaselineLine[] = [];
  for (const b of raw as any[]) {
    let key = String(b?.key ?? '').trim() || `b-${nanoid(8)}`;
    while (seen.has(key)) key = `${key}-${nanoid(4)}`;
    seen.add(key);
    const pct = Number(b?.tenantSharePct);
    out.push({
      key,
      description: pctText(String(b?.description ?? '').trim()) || 'Untitled line',
      bucket: BUCKETS.includes(String(b?.bucket)) ? String(b.bucket) : 'contractor',
      budget: Math.round((Number(String(b?.budget ?? 0).replace(/[$,\s]/g, '')) || 0) * 100) / 100,
      tenantSharePct: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 100,
      ...(b?.masterItemId != null ? { masterItemId: Number(b.masterItemId) } : {}),
    } as BaselineLine);
  }
  return out;
}

async function nextProjectNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PRJ-${year}-`;
  const rows = await db.select({ projectNumber: costProjects.projectNumber })
    .from(costProjects).where(like(costProjects.projectNumber, `${prefix}%`));
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.projectNumber.slice(prefix.length), 10) || 0), 0);
  return formatProjectNumber(year, max + 1);
}

// ------------------------------------------------------------ the bundle

/**
 * Everything about one project, in dollars, with the arithmetic done.
 * The report and the screen both read this, so they cannot disagree.
 */
export async function loadProjectBundle(projectId: number) {
  const [project] = await db.select().from(costProjects).where(eq(costProjects.id, projectId));
  if (!project) return null;

  const contracts = await db.select().from(costContracts)
    .where(eq(costContracts.projectId, projectId)).orderBy(costContracts.id);
  const contractIds = contracts.map((c) => c.id);
  const none = contractIds.length === 0;

  const cos = none ? [] : await db.select().from(costChangeOrders)
    .where(inArray(costChangeOrders.contractId, contractIds))
    .orderBy(costChangeOrders.sortOrder, costChangeOrders.id);
  const sov = none ? [] : await db.select().from(costSovLines)
    .where(inArray(costSovLines.contractId, contractIds))
    .orderBy(costSovLines.sortOrder, costSovLines.id);
  const apps = none ? [] : await db.select().from(costApplications)
    .where(inArray(costApplications.contractId, contractIds))
    .orderBy(costApplications.contractId, costApplications.number);
  const appIds = apps.map((a) => a.id);
  const appLines = appIds.length === 0 ? [] : await db.select().from(costApplicationLines)
    .where(inArray(costApplicationLines.applicationId, appIds));
  const waiverRows = await db.select().from(costWaivers).where(eq(costWaivers.projectId, projectId)).orderBy(costWaivers.id);
  const documents = await db.select().from(costDocuments)
    .where(eq(costDocuments.projectId, projectId)).orderBy(desc(costDocuments.createdAt));
  const payRows = none ? [] : await db.select().from(costPayments)
    .where(inArray(costPayments.contractId, contractIds)).orderBy(costPayments.paidDate, costPayments.id);
  const directRows = await db.select().from(costDirectCosts)
    .where(eq(costDirectCosts.projectId, projectId)).orderBy(costDirectCosts.date, costDirectCosts.id);
  const directCosts = directRows.map((d) => ({
    id: d.id, date: isoDay(d.date), vendor: d.vendor, description: d.description,
    amount: dollars(d.amountCents), method: d.method, reference: d.reference,
    key: d.baselineKey, reconciled: d.reconciled, notes: d.notes,
  }));

  // To the pure model, in dollars.
  // Percentages in line names read to two decimals: "Permit Fees (3.00%)".
  const baseline = ((project.baseline || []) as BaselineLine[]).map((b) => ({ ...b, description: pctText(b.description) }));
  const lines: SovLine[] = sov.map((l) => ({
    id: l.id, contractId: l.contractId, changeOrderId: l.changeOrderId ?? null,
    scheduledValue: dollars(l.scheduledValueCents),
    allocationMode: (ALLOCATION_MODES.includes(l.allocationMode as AllocationMode)
      ? l.allocationMode : 'unallocated') as AllocationMode,
    allocations: (l.allocations || []) as any,
  }));
  const changeOrders: ChangeOrder[] = cos.map((c) => ({
    id: c.id, contractId: c.contractId,
    status: (CO_STATUSES.includes(c.status) ? c.status : 'pending') as ChangeOrder['status'],
  }));
  const applications: Application[] = apps.map((a) => ({
    id: a.id, contractId: a.contractId, number: a.number,
    lines: appLines.filter((l) => l.applicationId === a.id).map((l) => ({
      sovLineId: l.sovLineId,
      workThisPeriod: dollars(l.workThisPeriodCents),
      storedToDate: dollars(l.storedToDateCents),
      retainageToDate: dollars(l.retainageToDateCents),
    })),
  }));

  // Measured against the budget after the deal: each line less the discount
  // put on it, plus a Deal Discount line for whatever has not been placed.
  const approval = normalizeApproval(project.budgetApproval);
  const cmSettings = cmSettingsFor(project, baseline);
  const effective = effectiveBaseline(baseline, approval, cmSettings.key);
  const summary0 = budgetVsActual({
    baseline: effective, lines, changeOrders, applications,
    directCosts: directCosts.map((d) => ({ key: d.key, amount: d.amount })),
  });
  const originalBy = new Map((approval.original || []).map((o) => [o.key, o.budget]));
  const priced = new Map(baseline.map((b) => [b.key, Number(b.budget) || 0]));
  const summary = {
    ...summary0,
    rows: summary0.rows.map((r) => ({
      ...r,
      priced: priced.has(r.key) ? Math.round(priced.get(r.key)! * 100) / 100 : null,
      originalBudget: approval.status === 'confirmed' ? (originalBy.get(r.key) ?? 0) : null,
    })),
  };

  const dated: DatedApplication[] = applications.map((a) => {
    const row = apps.find((x) => x.id === a.id)!;
    return { ...a, date: isoDay(row.periodEnd ?? row.createdAt) };
  });
  const payments: Payment[] = payRows.map((p) => ({
    id: p.id, contractId: p.contractId, applicationId: p.applicationId ?? null,
    amount: dollars(p.amountCents), paidDate: isoDay(p.paidDate), reference: p.reference,
  }));
  const positionInput = {
    contractIds, lines, changeOrders, applications: dated, payments,
    directCosts: directCosts.map((d) => ({ date: d.date, amount: d.amount })),
  };
  const position = positionAsOf(todayEastern(), positionInput);

  const settings = (project.settings || {}) as any;
  // The CM's own contract (if there is one) is not part of its base.
  const cmContractIds = new Set(contracts.filter((c) => c.bucket === 'cm').map((c) => c.id));
  const cmFee = cmSettings.key || settings.cmFeePct != null
    ? cmFeeEarned(cmSettings, {
      rows: summary.rows.map((r) => ({ key: r.key, budget: r.budget, toDate: r.toDate })),
      paidBase: payments.filter((p) => !cmContractIds.has(p.contractId)).reduce((s, p) => s + p.amount, 0)
        + directCosts.filter((d) => d.key !== cmSettings.key).reduce((s, d) => s + d.amount, 0),
    })
    : null;
  const g702 = Object.fromEntries(contracts.map((c) => {
    const nums = applications.filter((a) => a.contractId === c.id).map((a) => a.number);
    return [c.id, g702For(c.id, nums.length ? Math.max(...nums) : 0, { lines, changeOrders, applications })];
  }));

  return {
    project: { ...project, baseline },
    contracts: contracts.map((c) => ({ ...c, retainagePct: c.retainageBp / 100 })),
    changeOrders: cos,
    sovLines: sov.map((l) => ({ ...l, scheduledValue: dollars(l.scheduledValueCents) })),
    applications: apps.map((a) => ({
      ...a,
      lines: appLines.filter((l) => l.applicationId === a.id).map((l) => ({
        id: l.id, sovLineId: l.sovLineId,
        workThisPeriod: dollars(l.workThisPeriodCents),
        storedToDate: dollars(l.storedToDateCents),
        retainageToDate: dollars(l.retainageToDateCents),
      })),
      g702: g702For(a.contractId, a.number, { lines, changeOrders, applications }),
    })),
    documents,
    summary,
    g702ByContract: g702,
    approval: (() => {
      const ds = discountState(baseline, approval);
      const cos = coSummary(approval.changeOrders);
      return {
        ...approval, ...ds,
        changeOrderTotals: approval.changeOrders.map((c) => ({ id: c.id, ...coTotals(c) })),
        coSummary: cos,
        currentTotal: Math.round((ds.approvedTotal + cos.approved) * 100) / 100,
      };
    })(),
    cmSettings,
    cmInvoices: ((settings.cmInvoices || []) as CmInvoiceRecord[]),
    cmInvoiceDraft: (() => {
      const issued = (settings.cmInvoices || []) as CmInvoiceRecord[];
      const calc = cmInvoiceCalc({
        rows: summary.rows.map((r) => ({ key: r.key, description: r.description, toDate: r.toDate, tenantSharePct: r.tenantSharePct })),
        cmKey: cmSettings.key, pct: cmSettings.pct,
        previouslyInvoiced: issued.reduce((s, i) => s + (Number(i.due) || 0), 0),
      });
      const covered = new Set(issued.flatMap((i) => (i.items || []).map((x) => x.ref)));
      const billed = billableItems({
        lines, changeOrders,
        applications: dated.map((a) => {
          const row = apps.find((x) => x.id === a.id)!;
          return { ...a, kind: row.kind, invoiceNumber: row.invoiceNumber };
        }),
        directCosts,
        tenantPct: new Map(summary.rows.map((r) => [r.key, r.tenantSharePct] as [string, number])),
        validKeys: new Set(effective.map((b) => b.key)),
        cmKey: cmSettings.key,
        contractName: (cid) => contracts.find((c) => c.id === cid)?.counterparty ?? 'Contract',
      });
      const items = billed;
      // Each item is rounded to the cent; put the rounding difference on the
      // largest item so the column ties to the base the fee is figured on.
      const drift = Math.round((calc.base - items.reduce((t, i) => t + i.billable, 0)) * 100) / 100;
      if (items.length && Math.abs(drift) >= 0.005 && Math.abs(drift) < 1) {
        const big = items.reduce((m, i) => (Math.abs(i.billable) > Math.abs(m.billable) ? i : m), items[0]);
        big.billable = Math.round((big.billable + drift) * 100) / 100;
      }
      const spent = Math.round(calc.lines.reduce((t, l) => t + l.spent, 0) * 100) / 100;
      const drift2 = Math.round((spent - items.reduce((t, i) => t + i.amount, 0)) * 100) / 100;
      if (items.length && Math.abs(drift2) >= 0.005 && Math.abs(drift2) < 1) {
        const big = items.reduce((m, i) => (Math.abs(i.amount) > Math.abs(m.amount) ? i : m), items[0]);
        big.amount = Math.round((big.amount + drift2) * 100) / 100;
      }
      // How this project invoices (set on the Reports tab).
      const type = settings.invoiceType === 'reimbursable' ? 'reimbursable' as const : 'fee' as const;
      const basis = settings.invoiceBasis === 'billed' ? 'billed' as const : 'paid' as const;
      const billTo = String(settings.billTo || project.tenantName || '');
      const chosen = basis === 'billed' ? items : paidItems(items, payments, (aid) => {
        const row = apps.find((x) => x.id === aid);
        if (!row) return null;
        return {
          vendor: contracts.find((c) => c.id === row.contractId)?.counterparty ?? 'Contract',
          item: `${row.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${row.number}${row.invoiceNumber ? ` (${row.invoiceNumber})` : ''}`,
        };
      });
      const inv = invoiceCalc({ type, items: chosen, pct: cmSettings.pct, previouslyInvoiced: calc.previous });
      return {
        ...calc, type, basis, billTo,
        // base/earned/due follow the chosen type and basis.
        base: inv.costs, earned: inv.fee, toDate: inv.toDate, due: inv.due,
        items: chosen.map((it) => ({ ...it, thisInvoice: issued.length > 0 && !covered.has(it.ref) })),
        lines: basis === 'billed' ? calc.lines : [],
      };
    })(),
    payments: payRows.map((p) => ({ ...p, amount: dollars(p.amountCents) })),
    position,
    positionInput,
    cmFee,
    directCosts,
    waivers: waiverRows.map((w) => ({
      id: w.id, contractId: w.contractId, applicationId: w.applicationId, kind: w.kind as Waiver['kind'],
      vendor: w.vendor, amount: dollars(w.amountCents), fromWaiverId: w.fromWaiverId ?? null,
      received: w.received, notNeeded: w.notNeeded, documentId: w.documentId ?? null, notes: w.notes,
    })),
    ledger: buildLedger({
      payments: payRows.map((p) => ({
        id: p.id, contractId: p.contractId, applicationId: p.applicationId, amount: dollars(p.amountCents),
        paidDate: isoDay(p.paidDate), reference: p.reference, method: p.method, reconciled: p.reconciled,
      })),
      directCosts,
      contractName: (cid) => contracts.find((c) => c.id === cid)?.counterparty ?? 'Contract',
      applicationLabel: (aid) => {
        const a = apps.find((x) => x.id === aid);
        if (!a) return 'Payment';
        return `${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${a.number}${a.invoiceNumber ? ` (${a.invoiceNumber})` : ''}`;
      },
      budgetLineName: (key) => (key ? baseline.find((b) => b.key === key)?.description ?? 'Unallocated' : 'Unallocated'),
    }),
  };
}

/** A CM fee invoice as issued: its numbers frozen, so a reprint matches what was sent. */
export interface CmInvoiceRecord {
  number: string;
  date: string;
  base: number;
  pct: number;
  earned: number;
  previous: number;
  due: number;
  lines: Array<{ key: string; description: string; spent: number; tenantSharePct: number; billable: number }>;
  payApps: Array<{ contract: string; number: number; date: string; billedToDate: number }>;
  /** Every billable item behind it — pay apps, invoices, direct charges. */
  items?: Array<{ ref: string; date: string; vendor: string; item: string; amount: number; billable: number; thisInvoice: boolean }>;
  type?: 'fee' | 'reimbursable';
  basis?: 'paid' | 'billed';
  billTo?: string;
  toDate?: number;
  issuedBy: string | null;
  issuedAt: string;
}

/** The project's CM fee rate and line: set on the project, or read from the CM line's name. */
export function cmSettingsFor(project: { settings?: any }, baseline: readonly BaselineLine[]) {
  const settings = (project.settings || {}) as any;
  const detected = detectCmFee(baseline);
  return {
    pct: settings.cmFeePct != null && Number.isFinite(Number(settings.cmFeePct)) ? Number(settings.cmFeePct) : (detected?.pct ?? 0),
    key: settings.cmFeeKey !== undefined ? (settings.cmFeeKey || null) : (detected?.key ?? null) as string | null,
    /** Where the rate came from: typed for this project, or read off the CM line's name. */
    source: (settings.cmFeePct != null ? 'project' : detected ? 'line' : 'none') as 'project' | 'line' | 'none',
  };
}

const isoDay = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');
/** Today in Eastern time, where the team works: "2026-10-20". */
export function todayEastern(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// ----------------------------------------------------------- application

/**
 * Write an application's lines.
 *
 * Retainage left blank is computed from the contract's rate on work to date,
 * which is what a G703 column I is. Typed in, it is taken as typed — the
 * contractor's figure is the one the check gets written against.
 */
async function writeApplicationLines(
  applicationId: number, contractId: number, number: number, retainageBp: number, raw: unknown,
) {
  const rows = Array.isArray(raw) ? raw : [];
  const contractLines = await db.select({ id: costSovLines.id })
    .from(costSovLines).where(eq(costSovLines.contractId, contractId));
  const valid = new Set(contractLines.map((l) => l.id));

  // Work to date BEFORE this application, per line, for the retainage default.
  const priorApps = await db.select({ id: costApplications.id, number: costApplications.number })
    .from(costApplications).where(eq(costApplications.contractId, contractId));
  const priorIds = priorApps.filter((a) => a.number < number).map((a) => a.id);
  const prior = priorIds.length === 0 ? [] : await db.select({
    sovLineId: costApplicationLines.sovLineId, work: costApplicationLines.workThisPeriodCents,
  }).from(costApplicationLines).where(inArray(costApplicationLines.applicationId, priorIds));
  const priorWork = new Map<number, number>();
  for (const p of prior) priorWork.set(p.sovLineId, (priorWork.get(p.sovLineId) ?? 0) + Number(p.work));

  await db.delete(costApplicationLines).where(eq(costApplicationLines.applicationId, applicationId));
  const toInsert = [];
  for (const r of rows as any[]) {
    const sovLineId = Number(r?.sovLineId);
    if (!valid.has(sovLineId)) continue;
    const work = toCents(r?.workThisPeriod);
    const stored = toCents(r?.storedToDate);
    const typedRetainage = r?.retainageToDate;
    const retainage = typedRetainage === null || typedRetainage === undefined || typedRetainage === ''
      ? Math.round(((priorWork.get(sovLineId) ?? 0) + work + stored) * retainageBp / 10000)
      : toCents(typedRetainage);
    if (work === 0 && stored === 0 && retainage === 0) continue;
    toInsert.push({
      applicationId, sovLineId,
      workThisPeriodCents: work, storedToDateCents: stored, retainageToDateCents: retainage,
    });
  }
  if (toInsert.length) await db.insert(costApplicationLines).values(toInsert);
  return toInsert.length;
}

const fail = (res: Response, error: unknown, what: string) => {
  console.error(`[cost-tracking] ${what}:`, error);
  res.status(500).json({ message: error instanceof Error ? error.message : `Failed to ${what}` });
};

// ---------------------------------------------------------------- routes

export function registerCostTrackingRoutes(app: Express): void {
  /** Every project, with its headline numbers. */
  app.get('/api/cost-projects', ...canEdit, async (_req, res) => {
    try {
      const rows = await db.select().from(costProjects).orderBy(desc(costProjects.createdAt));
      const out = [];
      for (const p of rows) {
        const b = await loadProjectBundle(p.id);
        out.push({
          ...p,
          totals: b?.summary.totals ?? null,
          reconciles: b?.summary.reconciles ?? true,
          contractCount: b?.contracts.length ?? 0,
        });
      }
      res.json({ projects: out });
    } catch (e) { fail(res, e, 'list projects'); }
  });

  app.get('/api/cost-projects/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const bundle = await loadProjectBundle(id);
      if (!bundle) return res.status(404).json({ message: 'Project not found' });
      res.json(bundle);
    } catch (e) { fail(res, e, 'load project'); }
  });

  /**
   * Open a project. From an RFP, the budget is frozen as the baseline; the
   * RFP is untouched. Without one, the baseline starts empty or as sent.
   */
  app.post('/api/cost-projects', ...canEdit, async (req, res) => {
    try {
      const body = req.body || {};
      const rfpId = body.rfpId != null && body.rfpId !== '' ? Number(body.rfpId) : null;
      let name = String(body.name ?? '').trim();
      let tenantName = body.tenantName ? String(body.tenantName) : null;
      let propertyId = body.propertyId != null && body.propertyId !== '' ? Number(body.propertyId) : null;
      let baseline: BaselineLine[] = cleanBaseline(body.baseline);

      if (rfpId !== null) {
        const rfp: any = await storage.getRfpRequest(rfpId);
        if (!rfp) return res.status(404).json({ message: 'RFP not found' });
        name ||= `${rfp.projectName || rfp.tenantName} (${rfp.rfpNumber})`;
        tenantName ||= rfp.tenantName;
        if (propertyId === null) {
          const pid = parseInt(String(rfp.property ?? ''), 10);
          propertyId = Number.isFinite(pid) ? pid : null;
        }
        if (baseline.length === 0) {
          const catalog = await storage.getAllRomScopeItems();
          const byId = new Map<number, any>(catalog.map((c: any) => [c.id, c]));
          if (rfp.pricingPath === 'rom_pilot') {
            const pilots = await storage.getAllRomPilots();
            const pilot: any = pilots.find((r: any) => r.linkedRfpId === rfpId);
            if (pilot) baseline = baselineFromRom(await storage.getRomPilotLineItems(pilot.id) as any[], byId);
          } else {
            const budget: any = await storage.getEvaluationBudget(rfpId);
            if (budget) baseline = baselineFromEvaluation(budget, byId);
          }
        }
      }
      if (!name) return res.status(400).json({ message: 'Give the project a name.' });

      // The unique index settles a race between two people opening at once.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const [created] = await db.insert(costProjects).values({
            projectNumber: await nextProjectNumber(),
            name, rfpId, propertyId, tenantName, baseline: baseline as any,
            notes: body.notes ? String(body.notes) : null,
            createdBy: who(req),
          }).returning();
          return res.json(created);
        } catch (e: any) {
          if (!String(e?.message || '').includes('cost_projects_number_unique') || attempt === 2) throw e;
        }
      }
    } catch (e) { fail(res, e, 'open the project'); }
  });

  app.patch('/api/cost-projects/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const patch: any = { updatedAt: new Date() };
      if (b.name !== undefined) patch.name = String(b.name).trim() || 'Untitled project';
      if (b.status !== undefined) patch.status = b.status === 'closed' ? 'closed' : 'active';
      if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null;
      if (b.tenantName !== undefined) patch.tenantName = b.tenantName ? String(b.tenantName) : null;
      if (b.baseline !== undefined) patch.baseline = cleanBaseline(b.baseline);
      const [row] = await db.update(costProjects).set(patch).where(eq(costProjects.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'Project not found' });
      res.json(row);
    } catch (e) { fail(res, e, 'update the project'); }
  });

  // ---- budget approval (LAF, Deal Discount, confirm)
  const loadProject = async (id: number) => (await db.select().from(costProjects).where(eq(costProjects.id, id)))[0];
  const saveApproval = async (id: number, a: BudgetApproval) =>
    db.update(costProjects).set({ budgetApproval: a as any, updatedAt: new Date() }).where(eq(costProjects.id, id));

  /**
   * Enter or change the LAF, and where the discount goes.
   *
   * A new LAF total resets the discount to (priced − LAF). Allocations are
   * kept: they are amounts on lines, and the remainder simply moves. On a
   * confirmed budget every change that moves the total is logged as a
   * revision; the original stays as it was confirmed.
   */
  app.put('/api/cost-projects/:id/approval', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const baseline = (project.baseline || []) as BaselineLine[];
      const cur = normalizeApproval(project.budgetApproval);
      const body = req.body || {};
      const beforeTotal = discountState(baseline, cur).approvedTotal;
      const next = normalizeApproval({ ...cur, ...pick(body, ['lafLines', 'allocations']) });
      if (body.lafTotal !== undefined) {
        next.lafTotal = body.lafTotal === null || body.lafTotal === '' ? null : Math.round(toCents(body.lafTotal)) / 100;
        next.discount = next.lafTotal == null ? 0 : Math.round((pricedTotal(baseline) - next.lafTotal) * 100) / 100;
      }
      const afterTotal = discountState(baseline, next).approvedTotal;
      if (next.status === 'confirmed' && Math.abs(afterTotal - beforeTotal) >= 0.005) {
        next.revisions = [...next.revisions, {
          at: new Date().toISOString(), by: whoName(req), total: afterTotal,
          note: String(body.note || (body.lafTotal !== undefined ? 'LAF total changed' : 'Budget revised')),
        }];
      }
      await saveApproval(id, next);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'save the budget approval'); }
  });

  /** Lock the budget as the original. The LAF total has to be in. */
  app.post('/api/cost-projects/:id/approval/confirm', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const baseline = (project.baseline || []) as BaselineLine[];
      const a = normalizeApproval(project.budgetApproval);
      if (a.lafTotal == null) return res.status(400).json({ message: 'Enter the LAF total before confirming.' });
      if (baseline.length === 0) return res.status(400).json({ message: 'There are no budget lines to confirm.' });
      const snap = snapshotOriginal(baseline, a, cmSettingsFor(project, baseline).key);
      a.status = 'confirmed';
      a.confirmedAt = new Date().toISOString();
      a.confirmedBy = whoName(req);
      a.original = snap.lines;
      a.originalTotal = snap.total;
      a.revisions = [];
      await saveApproval(id, a);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'confirm the budget'); }
  });

  // ---- budget change orders
  /**
   * Write the contractor's change order from a budget change order: the same
   * number and title, one SOV line per budget line, each mapped straight to
   * it. The CM fee is ours, not the contractor's, so it isn't on it.
   */
  const writeContractCo = async (contractId: number, co: BudgetCO, baseline: BaselineLine[]) => {
    const [c] = await db.select().from(costContracts).where(eq(costContracts.id, contractId));
    if (!c) throw new UserError('That contract no longer exists.');
    const [row] = await db.insert(costChangeOrders).values({
      contractId, number: co.number, title: co.title || null,
      status: co.status === 'void' ? 'void' : co.status, sortOrder: 0,
    }).returning();
    const existing = await db.select({ id: costSovLines.id }).from(costSovLines).where(eq(costSovLines.contractId, contractId));
    if (co.lines.length) {
      await db.insert(costSovLines).values(co.lines.map((l, i) => ({
        contractId, changeOrderId: row.id, itemNo: null, code: null,
        description: l.description || baseline.find((b) => b.key === l.key)?.description || 'Change order work',
        scheduledValueCents: toCents(l.amount), allocationMode: 'direct',
        allocations: [{ baselineKey: l.key, pct: 100 }], sortOrder: existing.length + i,
      })));
    }
    return row.id;
  };

  const saveCos = async (id: number, project: any, a: BudgetApproval, req: Request, note: string) => {
    const baseline = (project.baseline || []) as BaselineLine[];
    const before = normalizeApproval(project.budgetApproval);
    const total = (x: BudgetApproval) => coSummary(x.changeOrders).approved;
    if (a.status === 'confirmed' && Math.abs(total(a) - total(before)) >= 0.005) {
      a.revisions = [...a.revisions, {
        at: new Date().toISOString(), by: whoName(req),
        total: Math.round((discountState(baseline, a).approvedTotal + total(a)) * 100) / 100, note,
      }];
    }
    await saveApproval(id, a);
  };

  app.post('/api/cost-projects/:id/budget-cos', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const baseline = (project.baseline || []) as BaselineLine[];
      const a = normalizeApproval(project.budgetApproval);
      const b = req.body || {};
      const co = normalizeCO({
        ...b, id: `co-${nanoid(8)}`,
        cmFeePct: cmSettingsFor(project, baseline).pct,
        contractId: null, contractCoId: null,
      })!;
      const keys = new Set(baseline.map((x) => x.key));
      if (!co.lines.length) return res.status(400).json({ message: 'Add at least one line with an amount.' });
      if (co.lines.some((l) => !keys.has(l.key))) return res.status(400).json({ message: 'Each line needs a budget line.' });
      const contractId = b.contractId != null && b.contractId !== '' ? Number(b.contractId) : null;
      if (contractId) {
        co.contractCoId = await writeContractCo(contractId, co, baseline);
        co.contractId = contractId;
      }
      a.changeOrders = [...a.changeOrders, co];
      await saveCos(id, project, a, req, `${co.number} added${co.title ? ` — ${co.title}` : ''}`);
      res.json(await loadProjectBundle(id));
    } catch (e) {
      if (e instanceof UserError) return res.status(400).json({ message: e.message });
      fail(res, e, 'add the change order');
    }
  });

  app.patch('/api/cost-projects/:id/budget-cos/:coId', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const baseline = (project.baseline || []) as BaselineLine[];
      const a = normalizeApproval(project.budgetApproval);
      const i = a.changeOrders.findIndex((c) => c.id === req.params.coId);
      if (i < 0) return res.status(404).json({ message: 'Change order not found' });
      const cur = a.changeOrders[i];
      const b = req.body || {};
      const next = normalizeCO({ ...cur, ...pick(b, ['number', 'title', 'date', 'status', 'billable', 'lines', 'cmFee']) })!;
      const keys = new Set(baseline.map((x) => x.key));
      if (next.lines.some((l) => !keys.has(l.key))) return res.status(400).json({ message: 'Each line needs a budget line.' });
      a.changeOrders[i] = next;
      // Keep the contractor's change order in step on status.
      if (next.contractCoId && next.status !== cur.status) {
        await db.update(costChangeOrders).set({ status: next.status }).where(eq(costChangeOrders.id, next.contractCoId));
      }
      await saveCos(id, project, a, req, `${next.number} ${next.status !== cur.status ? next.status : 'changed'}`);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'update the change order'); }
  });

  app.delete('/api/cost-projects/:id/budget-cos/:coId', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const a = normalizeApproval(project.budgetApproval);
      const co = a.changeOrders.find((c) => c.id === req.params.coId);
      if (!co) return res.status(404).json({ message: 'Change order not found' });
      a.changeOrders = a.changeOrders.filter((c) => c.id !== co.id);
      await saveCos(id, project, a, req, `${co.number} deleted`);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'delete the change order'); }
  });

  // ---- CM fee invoices
  /** The latest pay app on each contract — what the invoice's work figure stands on. */
  const payAppsFor = (b: NonNullable<Awaited<ReturnType<typeof loadProjectBundle>>>) => b.contracts.map((c) => {
    const apps = b.positionInput.applications.filter((a) => a.contractId === c.id);
    if (!apps.length) return null;
    const last = apps.reduce((m, a) => (a.number > m.number ? a : m), apps[0]);
    return { contract: c.counterparty, number: last.number, date: last.date, billedToDate: b.g702ByContract[c.id]?.completedAndStored ?? 0 };
  }).filter(Boolean) as CmInvoiceRecord['payApps'];

  app.post('/api/cost-projects/:id/cm-invoices', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      const b = await loadProjectBundle(id);
      if (!project || !b) return res.status(404).json({ message: 'Project not found' });
      const number = String(req.body?.number ?? '').trim();
      const date = String(req.body?.date ?? '').slice(0, 10);
      if (!number) return res.status(400).json({ message: 'Enter an invoice number.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Enter the invoice date.' });
      const settings: any = { ...(project.settings || {}) };
      const list: CmInvoiceRecord[] = settings.cmInvoices || [];
      if (list.some((i) => i.number.toLowerCase() === number.toLowerCase())) return res.status(400).json({ message: `Invoice ${number} already exists.` });
      const d = b.cmInvoiceDraft;
      if (Math.abs(d.due) < 0.005) return res.status(400).json({ message: 'Nothing new to invoice — everything to date has been invoiced.' });
      list.push({ number, date, base: d.base, pct: d.pct, earned: d.earned, previous: d.previous, due: d.due,
        lines: d.lines, payApps: payAppsFor(b), items: d.items, type: d.type, basis: d.basis, billTo: d.billTo, toDate: d.toDate,
        issuedBy: whoName(req), issuedAt: new Date().toISOString() });
      settings.cmInvoices = list;
      await db.update(costProjects).set({ settings, updatedAt: new Date() }).where(eq(costProjects.id, id));
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'issue the invoice'); }
  });

  /** Only the latest invoice can be withdrawn, so the "previously invoiced" chain stays true. */
  app.delete('/api/cost-projects/:id/cm-invoices/:number', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const settings: any = { ...(project.settings || {}) };
      const list: CmInvoiceRecord[] = settings.cmInvoices || [];
      const last = list[list.length - 1];
      if (!last || last.number !== req.params.number) return res.status(400).json({ message: 'Only the most recent invoice can be withdrawn.' });
      settings.cmInvoices = list.slice(0, -1);
      await db.update(costProjects).set({ settings, updatedAt: new Date() }).where(eq(costProjects.id, id));
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'withdraw the invoice'); }
  });

  // ---- budget transfers (money moved between lines; total unchanged)
  app.post('/api/cost-projects/:id/budget-transfers', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const baseline = (project.baseline || []) as BaselineLine[];
      const a = normalizeApproval(project.budgetApproval);
      const b = req.body || {};
      const fromKey = String(b.fromKey ?? ''), toKey = String(b.toKey ?? '');
      const amount = Math.round(toCents(b.amount)) / 100;
      const name = (k: string) => baseline.find((x) => x.key === k)?.description;
      if (!name(fromKey) || !name(toKey)) return res.status(400).json({ message: 'Pick the line to move money from and the line to move it to.' });
      if (fromKey === toKey) return res.status(400).json({ message: 'Pick two different lines.' });
      if (!(amount > 0)) return res.status(400).json({ message: 'Enter the amount to move.' });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : todayEastern();
      const t = { id: `t-${nanoid(8)}`, fromKey, toKey, amount, note: String(b.note ?? '').trim().slice(0, 300), date, by: whoName(req) };
      a.transfers = [...a.transfers, t];
      if (a.status === 'confirmed') {
        a.revisions = [...a.revisions, {
          at: new Date().toISOString(), by: whoName(req),
          total: Math.round((discountState(baseline, a).approvedTotal + coSummary(a.changeOrders).approved) * 100) / 100,
          note: `Transfer ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}: ${name(fromKey)} → ${name(toKey)}${t.note ? ` (${t.note})` : ''}`,
        }];
      }
      await saveApproval(id, a);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'move the money'); }
  });

  app.delete('/api/cost-projects/:id/budget-transfers/:tid', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const a = normalizeApproval(project.budgetApproval);
      const t = a.transfers.find((x) => x.id === req.params.tid);
      if (!t) return res.status(404).json({ message: 'Transfer not found' });
      a.transfers = a.transfers.filter((x) => x.id !== t.id);
      if (a.status === 'confirmed') {
        const baseline = (project.baseline || []) as BaselineLine[];
        a.revisions = [...a.revisions, {
          at: new Date().toISOString(), by: whoName(req),
          total: Math.round((discountState(baseline, a).approvedTotal + coSummary(a.changeOrders).approved) * 100) / 100,
          note: `Transfer of ${t.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} undone`,
        }];
      }
      await saveApproval(id, a);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'undo the transfer'); }
  });

  /** Back to draft — for a budget confirmed by mistake. Drops the original. */
  app.post('/api/cost-projects/:id/approval/reopen', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const a = normalizeApproval(project.budgetApproval);
      a.status = 'draft';
      a.confirmedAt = null; a.confirmedBy = null; a.original = null; a.originalTotal = null; a.revisions = [];
      await saveApproval(id, a);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'reopen the budget'); }
  });

  /** CM fee rate and line. */
  app.put('/api/cost-projects/:id/settings', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const next: any = { ...(project.settings || {}) };
      const b = req.body || {};
      if (b.cmFeePct !== undefined) {
        const v = parseFloat(String(b.cmFeePct));
        if (b.cmFeePct === null || b.cmFeePct === '') delete next.cmFeePct;
        else if (Number.isFinite(v) && v >= 0 && v <= 100) next.cmFeePct = v;
        else return res.status(400).json({ message: 'CM fee must be a percentage between 0 and 100.' });
      }
      if (b.cmFeeKey !== undefined) next.cmFeeKey = b.cmFeeKey ? String(b.cmFeeKey) : '';
      if (b.invoiceType !== undefined) next.invoiceType = b.invoiceType === 'reimbursable' ? 'reimbursable' : 'fee';
      if (b.invoiceBasis !== undefined) next.invoiceBasis = b.invoiceBasis === 'billed' ? 'billed' : 'paid';
      if (b.billTo !== undefined) next.billTo = String(b.billTo ?? '').trim().slice(0, 200);
      await db.update(costProjects).set({ settings: next, updatedAt: new Date() }).where(eq(costProjects.id, id));
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'save the settings'); }
  });

  /**
   * Delete a project and everything under it. The caller must send the
   * project number back as confirmation — the second of two prompts.
   * Stored files stay in Object Storage; only their records go.
   */
  app.delete('/api/cost-projects/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const typed = String((req.body || {}).confirm ?? req.query.confirm ?? '').trim();
      if (typed.toUpperCase() !== project.projectNumber.toUpperCase()) {
        return res.status(400).json({ message: `Type ${project.projectNumber} to delete this project.` });
      }
      const contractIds = (await db.select({ id: costContracts.id }).from(costContracts)
        .where(eq(costContracts.projectId, id))).map((c) => c.id);
      await db.transaction(async (tx) => {
        if (contractIds.length) {
          const appIds = (await tx.select({ id: costApplications.id }).from(costApplications)
            .where(inArray(costApplications.contractId, contractIds))).map((a) => a.id);
          if (appIds.length) await tx.delete(costApplicationLines).where(inArray(costApplicationLines.applicationId, appIds));
          await tx.delete(costPayments).where(inArray(costPayments.contractId, contractIds));
          await tx.delete(costApplications).where(inArray(costApplications.contractId, contractIds));
          await tx.delete(costSovLines).where(inArray(costSovLines.contractId, contractIds));
          await tx.delete(costChangeOrders).where(inArray(costChangeOrders.contractId, contractIds));
          await tx.delete(costContracts).where(inArray(costContracts.id, contractIds));
        }
        await tx.delete(costDirectCosts).where(eq(costDirectCosts.projectId, id));
        await tx.delete(costWaivers).where(eq(costWaivers.projectId, id));
        await tx.delete(costDocuments).where(eq(costDocuments.projectId, id));
        await tx.delete(costProjects).where(eq(costProjects.id, id));
      });
      console.log(`[cost] project ${project.projectNumber} (${project.name}) deleted by ${who(req)}`);
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'delete the project'); }
  });

  // ---- payments
  app.post('/api/cost-applications/:id/payments', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [a] = await db.select().from(costApplications).where(eq(costApplications.id, id));
      if (!a) return res.status(404).json({ message: 'Application not found' });
      const b = req.body || {};
      const cents = toCents(b.amount);
      if (cents === 0) return res.status(400).json({ message: 'Enter the amount paid.' });
      const d = String(b.paidDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ message: 'Enter the date it was paid.' });
      const [row] = await db.insert(costPayments).values({
        contractId: a.contractId, applicationId: a.id, amountCents: cents,
        paidDate: new Date(`${d}T12:00:00Z`),
        reference: b.reference ? String(b.reference).slice(0, 120) : null,
        method: METHODS.includes(String(b.method)) ? String(b.method) : null,
        notes: b.notes ? String(b.notes) : null, createdBy: who(req),
      }).returning();
      res.json(row);
    } catch (e) { fail(res, e, 'record the payment'); }
  });

  app.delete('/api/cost-payments/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      await db.delete(costPayments).where(eq(costPayments.id, id));
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'remove the payment'); }
  });

  app.patch('/api/cost-payments/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const patch: any = {};
      if (b.reconciled !== undefined) patch.reconciled = !!b.reconciled;
      if (b.method !== undefined) patch.method = METHODS.includes(String(b.method)) ? String(b.method) : null;
      if (b.reference !== undefined) patch.reference = b.reference ? String(b.reference).slice(0, 120) : null;
      if (!Object.keys(patch).length) return res.status(400).json({ message: 'Nothing to change.' });
      const [row] = await db.update(costPayments).set(patch).where(eq(costPayments.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'Payment not found' });
      res.json(row);
    } catch (e) { fail(res, e, 'update the payment'); }
  });

  // ---- direct costs (card charges, permits, parking — anything with no contract)
  const directValues = (b: any, partial: boolean) => {
    const out: any = {};
    if (!partial || b.date !== undefined) {
      const d = String(b.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new UserError('Enter the date of the charge.');
      out.date = new Date(`${d}T12:00:00Z`);
    }
    if (!partial || b.vendor !== undefined) {
      const v = String(b.vendor ?? '').trim();
      if (!v) throw new UserError('Enter who was paid.');
      out.vendor = v.slice(0, 200);
    }
    if (!partial || b.amount !== undefined) {
      const c = toCents(b.amount);
      if (c === 0) throw new UserError('Enter the amount.');
      out.amountCents = c;
    }
    if (b.description !== undefined) out.description = String(b.description ?? '').slice(0, 500);
    if (b.method !== undefined) out.method = METHODS.includes(String(b.method)) ? String(b.method) : null;
    if (b.reference !== undefined) out.reference = b.reference ? String(b.reference).slice(0, 120) : null;
    if (b.key !== undefined) out.baselineKey = b.key ? String(b.key) : null;
    if (b.reconciled !== undefined) out.reconciled = !!b.reconciled;
    if (b.notes !== undefined) out.notes = b.notes ? String(b.notes) : null;
    return out;
  };

  app.post('/api/cost-projects/:id/direct-costs', ...canEdit, async (req, res) => {
    try {
      const projectId = intParam(req, 'id');
      if (projectId === null) return res.status(400).json({ message: 'Invalid ID' });
      if (!(await loadProject(projectId))) return res.status(404).json({ message: 'Project not found' });
      const [row] = await db.insert(costDirectCosts)
        .values({ projectId, ...directValues(req.body || {}, false), createdBy: who(req) }).returning();
      res.json(row);
    } catch (e) {
      if (e instanceof UserError) return res.status(400).json({ message: e.message });
      fail(res, e, 'add the cost');
    }
  });

  app.patch('/api/cost-direct-costs/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const patch = directValues(req.body || {}, true);
      if (!Object.keys(patch).length) return res.status(400).json({ message: 'Nothing to change.' });
      const [row] = await db.update(costDirectCosts).set(patch).where(eq(costDirectCosts.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'Cost not found' });
      res.json(row);
    } catch (e) {
      if (e instanceof UserError) return res.status(400).json({ message: e.message });
      fail(res, e, 'update the cost');
    }
  });

  app.delete('/api/cost-direct-costs/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      await db.delete(costDirectCosts).where(eq(costDirectCosts.id, id));
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'remove the cost'); }
  });

  // ---- contracts
  app.post('/api/cost-projects/:id/contracts', ...canEdit, async (req, res) => {
    try {
      const projectId = intParam(req, 'id');
      if (projectId === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const counterparty = String(b.counterparty ?? '').trim();
      if (!counterparty) return res.status(400).json({ message: 'Who is the contract with?' });
      const pct = Number(b.retainagePct);
      const [row] = await db.insert(costContracts).values({
        projectId, counterparty,
        bucket: BUCKETS.includes(String(b.bucket)) ? String(b.bucket) : 'contractor',
        contractNumber: b.contractNumber ? String(b.contractNumber) : null,
        retainageBp: Number.isFinite(pct) ? Math.round(Math.min(100, Math.max(0, pct)) * 100) : 1000,
        notes: b.notes ? String(b.notes) : null,
      }).returning();
      res.json(row);
    } catch (e) { fail(res, e, 'add the contract'); }
  });

  app.patch('/api/cost-contracts/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const patch: any = {};
      if (b.counterparty !== undefined) patch.counterparty = String(b.counterparty).trim() || 'Unnamed';
      if (b.bucket !== undefined && BUCKETS.includes(String(b.bucket))) patch.bucket = String(b.bucket);
      if (b.contractNumber !== undefined) patch.contractNumber = b.contractNumber ? String(b.contractNumber) : null;
      if (b.retainagePct !== undefined && Number.isFinite(Number(b.retainagePct))) {
        patch.retainageBp = Math.round(Math.min(100, Math.max(0, Number(b.retainagePct))) * 100);
      }
      if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null;
      for (const [k, col] of [['contractDate', 'contractDate'], ['startDate', 'startDate'], ['completionDate', 'completionDate']] as const) {
        if (b[k] !== undefined) {
          const v = String(b[k] ?? '').slice(0, 10);
          patch[col] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
        }
      }
      if (!Object.keys(patch).length) return res.status(400).json({ message: 'Nothing to change.' });
      const [row] = await db.update(costContracts).set(patch).where(eq(costContracts.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'Contract not found' });
      res.json(row);
    } catch (e) { fail(res, e, 'update the contract'); }
  });

  // ---- change orders
  app.post('/api/cost-contracts/:id/change-orders', ...canEdit, async (req, res) => {
    try {
      const contractId = intParam(req, 'id');
      if (contractId === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const number = String(b.number ?? '').trim();
      if (!number) return res.status(400).json({ message: 'Give the change order a number.' });
      const status = CO_STATUSES.includes(String(b.status)) ? String(b.status) : 'pending';
      const existing = await db.select({ id: costChangeOrders.id })
        .from(costChangeOrders).where(eq(costChangeOrders.contractId, contractId));
      const [row] = await db.insert(costChangeOrders).values({
        contractId, number, title: b.title ? String(b.title) : null, status,
        approvedDate: status === 'approved' ? new Date() : null,
        sortOrder: existing.length,
      }).returning();
      res.json(row);
    } catch (e) { fail(res, e, 'add the change order'); }
  });

  /**
   * Delete a contract and everything under it — its change orders, lines,
   * pay apps, payments and file records. Confirmed twice in the app. Stored
   * files stay in Object Storage; only their records go.
   */
  app.delete('/api/cost-contracts/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [c] = await db.select().from(costContracts).where(eq(costContracts.id, id));
      if (!c) return res.status(404).json({ message: 'Contract not found' });
      await db.transaction(async (tx) => {
        const appIds = (await tx.select({ id: costApplications.id }).from(costApplications)
          .where(eq(costApplications.contractId, id))).map((a) => a.id);
        if (appIds.length) {
          await tx.delete(costApplicationLines).where(inArray(costApplicationLines.applicationId, appIds));
          await tx.delete(costDocuments).where(inArray(costDocuments.applicationId, appIds));
        }
        await tx.delete(costPayments).where(eq(costPayments.contractId, id));
        await tx.delete(costWaivers).where(eq(costWaivers.contractId, id));
        await tx.delete(costApplications).where(eq(costApplications.contractId, id));
        await tx.delete(costSovLines).where(eq(costSovLines.contractId, id));
        await tx.delete(costChangeOrders).where(eq(costChangeOrders.contractId, id));
        await tx.delete(costDocuments).where(eq(costDocuments.contractId, id));
        await tx.delete(costContracts).where(eq(costContracts.id, id));
      });
      console.log(`[cost] contract ${id} (${c.counterparty}) deleted by ${who(req)}`);
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'delete the contract'); }
  });

  /**
   * Delete a change order and its lines. Refused when any of its lines has
   * been billed — void it instead, so the billing history still adds up.
   */
  app.delete('/api/cost-change-orders/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const lineIds = (await db.select({ id: costSovLines.id }).from(costSovLines)
        .where(eq(costSovLines.changeOrderId, id))).map((l) => l.id);
      if (lineIds.length) {
        const billed = await db.select({ id: costApplicationLines.id }).from(costApplicationLines)
          .where(inArray(costApplicationLines.sovLineId, lineIds)).limit(1);
        if (billed.length) {
          return res.status(409).json({ message: 'This change order has been billed on a pay app, so it cannot be deleted. Set it to Void instead.' });
        }
      }
      await db.transaction(async (tx) => {
        if (lineIds.length) await tx.delete(costSovLines).where(inArray(costSovLines.id, lineIds));
        await tx.delete(costChangeOrders).where(eq(costChangeOrders.id, id));
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'delete the change order'); }
  });

  app.patch('/api/cost-change-orders/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const patch: any = {};
      if (b.number !== undefined) patch.number = String(b.number).trim() || 'CO';
      if (b.title !== undefined) patch.title = b.title ? String(b.title) : null;
      if (b.status !== undefined && CO_STATUSES.includes(String(b.status))) {
        patch.status = String(b.status);
        patch.approvedDate = b.status === 'approved' ? new Date() : null;
      }
      const [row] = await db.update(costChangeOrders).set(patch).where(eq(costChangeOrders.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'Change order not found' });
      res.json(row);
    } catch (e) { fail(res, e, 'update the change order'); }
  });

  // ---- SOV lines
  /** Add lines in bulk — a schedule of values is pasted, not typed one at a time. */
  app.post('/api/cost-contracts/:id/sov-lines', ...canEdit, async (req, res) => {
    try {
      const contractId = intParam(req, 'id');
      if (contractId === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const coId = b.changeOrderId != null && b.changeOrderId !== '' ? Number(b.changeOrderId) : null;
      if (coId !== null) {
        const [co] = await db.select({ contractId: costChangeOrders.contractId })
          .from(costChangeOrders).where(eq(costChangeOrders.id, coId));
        if (!co || co.contractId !== contractId) {
          return res.status(400).json({ message: 'That change order belongs to a different contract.' });
        }
      }
      const existing = await db.select({ id: costSovLines.id })
        .from(costSovLines).where(eq(costSovLines.contractId, contractId));
      const incoming = (Array.isArray(b.lines) ? b.lines : [b]).filter((l: any) => String(l?.description ?? '').trim());
      if (incoming.length === 0) return res.status(400).json({ message: 'No lines with a description.' });
      const rows = await db.insert(costSovLines).values(incoming.map((l: any, i: number) => {
        const mode = ALLOCATION_MODES.includes(l.allocationMode) ? l.allocationMode : 'unallocated';
        return {
          contractId, changeOrderId: coId,
          itemNo: l.itemNo ? String(l.itemNo) : null,
          code: l.code ? String(l.code) : null,
          description: String(l.description).trim(),
          scheduledValueCents: toCents(l.scheduledValue),
          allocationMode: mode,
          allocations: cleanAllocations(l.allocations),
          sortOrder: existing.length + i,
        };
      })).returning();
      res.json({ lines: rows });
    } catch (e) { fail(res, e, 'add the lines'); }
  });

  app.patch('/api/cost-sov-lines/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const patch: any = {};
      if (b.description !== undefined) patch.description = String(b.description).trim() || 'Untitled';
      if (b.itemNo !== undefined) patch.itemNo = b.itemNo ? String(b.itemNo) : null;
      if (b.code !== undefined) patch.code = b.code ? String(b.code) : null;
      if (b.scheduledValue !== undefined) patch.scheduledValueCents = toCents(b.scheduledValue);
      if (b.allocationMode !== undefined && ALLOCATION_MODES.includes(b.allocationMode)) {
        patch.allocationMode = b.allocationMode;
      }
      if (b.allocations !== undefined) patch.allocations = cleanAllocations(b.allocations);
      const [row] = await db.update(costSovLines).set(patch).where(eq(costSovLines.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'Line not found' });
      res.json(row);
    } catch (e) { fail(res, e, 'update the line'); }
  });

  /** Only a line nothing has been billed against. Billed history is not erased. */
  app.delete('/api/cost-sov-lines/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const billed = await db.select({ id: costApplicationLines.id })
        .from(costApplicationLines).where(eq(costApplicationLines.sovLineId, id)).limit(1);
      if (billed.length) {
        return res.status(409).json({ message: 'This line has been billed on a pay app, so it cannot be deleted. Set its value to zero instead.' });
      }
      await db.delete(costSovLines).where(eq(costSovLines.id, id));
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'delete the line'); }
  });

  // ---- AI read of a G702/G703. Returns figures for the dialog; saves nothing.
  app.post('/api/cost-contracts/:id/read-pay-app', ...canEdit, requireAi, docUpload.single('file'), async (req, res) => {
    try {
      const contractId = intParam(req, 'id');
      if (contractId === null) return res.status(400).json({ message: 'Invalid ID' });
      const [contract] = await db.select().from(costContracts).where(eq(costContracts.id, contractId));
      if (!contract) return res.status(404).json({ message: 'Contract not found' });

      let buf: Buffer | null = null;
      let mime = '';
      let name = '';
      if ((req as any).file) {
        buf = (req as any).file.buffer; mime = (req as any).file.mimetype || ''; name = (req as any).file.originalname || '';
      } else if (req.body?.documentId) {
        const [d] = await db.select().from(costDocuments).where(eq(costDocuments.id, Number(req.body.documentId)));
        if (!d) return res.status(404).json({ message: 'File not found' });
        buf = d.storage === 'object' ? await downloadFromObjectStorage(d.storageKey)
          : await fsp.readFile(path.join(process.cwd(), 'uploads', d.storageKey)).catch(() => null);
        mime = d.mimeType || ''; name = d.originalName;
      }
      if (!buf) return res.status(400).json({ message: 'Attach the pay app PDF first.' });
      const isPdf = /pdf/i.test(mime) || /\.pdf$/i.test(name);
      const img = /^image\/(png|jpe?g|gif|webp)$/i.exec(mime);
      if (!isPdf && !img) return res.status(400).json({ message: 'AI can read a PDF or a photo of the pay app. For a spreadsheet, copy the columns into the grid instead.' });

      const cos = await db.select().from(costChangeOrders).where(eq(costChangeOrders.contractId, contractId));
      const voided = new Set(cos.filter((c) => c.status === 'void').map((c) => c.id));
      const sov = (await db.select().from(costSovLines).where(eq(costSovLines.contractId, contractId))
        .orderBy(costSovLines.sortOrder, costSovLines.id))
        .filter((l) => l.changeOrderId == null || !voided.has(l.changeOrderId))
        .map((l) => ({ id: l.id, itemNo: l.itemNo, description: l.description, scheduledValue: dollars(l.scheduledValueCents) }));

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const source = { type: 'base64' as const, data: buf.toString('base64') };
      const response = await anthropic.messages.create({
        model: AI_MODEL,
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content: [
            isPdf
              ? { type: 'document' as const, source: { ...source, media_type: 'application/pdf' as const } }
              : { type: 'image' as const, source: { ...source, media_type: img![0].toLowerCase().replace('jpg', 'jpeg') as any } },
            { type: 'text' as const, text: payAppPrompt(contract.counterparty, sov) },
          ],
        }],
      });
      const block = response.content.find((c) => c.type === 'text');
      const text = block && block.type === 'text' ? block.text : '';
      const a = text.indexOf('{'), z = text.lastIndexOf('}');
      if (a === -1 || z === -1) return res.status(502).json({ message: 'AI could not read a pay app in that file.' });
      let parsed: any;
      try { parsed = JSON.parse(text.slice(a, z + 1)); }
      catch { return res.status(502).json({ message: response.stop_reason === 'max_tokens' ? 'That pay app is too long to read in one go.' : 'AI returned something that was not readable. Try again.' }); }
      const read = normalizeRead(parsed);
      const result = matchRows(read, sov);
      console.log(`[ai] read pay app for contract ${contractId}: ${read.rows.length} rows, ${result.matched.length} matched, ${result.unmatched.length} unmatched (${response.usage?.input_tokens ?? '?'} in / ${response.usage?.output_tokens ?? '?'} out tokens)`);
      res.json({ ...read, ...result, fileName: name });
    } catch (e: any) {
      if (e?.status === 401) return res.status(502).json({ message: 'The Anthropic API key was rejected. Check the ANTHROPIC_API_KEY secret.' });
      fail(res, e, 'read the pay app');
    }
  });

  // ---- applications
  app.post('/api/cost-contracts/:id/applications', ...canEdit, async (req, res) => {
    try {
      const contractId = intParam(req, 'id');
      if (contractId === null) return res.status(400).json({ message: 'Invalid ID' });
      const [contract] = await db.select().from(costContracts).where(eq(costContracts.id, contractId));
      if (!contract) return res.status(404).json({ message: 'Contract not found' });
      const b = req.body || {};
      const existing = await db.select({ number: costApplications.number })
        .from(costApplications).where(eq(costApplications.contractId, contractId));
      const number = Number.isFinite(Number(b.number)) && Number(b.number) > 0
        ? Math.floor(Number(b.number))
        : existing.reduce((m, a) => Math.max(m, a.number), 0) + 1;
      if (existing.some((a) => a.number === number)) {
        return res.status(409).json({ message: `Application ${number} already exists on this contract. Open it to edit it.` });
      }
      const [row] = await db.insert(costApplications).values({
        contractId, number,
        kind: b.kind === 'invoice' ? 'invoice' : 'pay_app',
        invoiceNumber: b.invoiceNumber ? String(b.invoiceNumber) : null,
        periodStart: b.periodStart ? new Date(b.periodStart) : null,
        periodEnd: b.periodEnd ? new Date(b.periodEnd) : null,
        notes: b.notes ? String(b.notes) : null,
        createdBy: who(req),
      }).returning();
      const written = await writeApplicationLines(row.id, contractId, number, contract.retainageBp, b.lines);
      res.json({ ...row, linesWritten: written });
    } catch (e) { fail(res, e, 'record the application'); }
  });

  app.put('/api/cost-applications/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [appRow] = await db.select().from(costApplications).where(eq(costApplications.id, id));
      if (!appRow) return res.status(404).json({ message: 'Application not found' });
      const [contract] = await db.select().from(costContracts).where(eq(costContracts.id, appRow.contractId));
      const b = req.body || {};
      const patch: any = {};
      if (b.invoiceNumber !== undefined) patch.invoiceNumber = b.invoiceNumber ? String(b.invoiceNumber) : null;
      if (b.periodStart !== undefined) patch.periodStart = b.periodStart ? new Date(b.periodStart) : null;
      if (b.periodEnd !== undefined) patch.periodEnd = b.periodEnd ? new Date(b.periodEnd) : null;
      if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null;
      if (Object.keys(patch).length) await db.update(costApplications).set(patch).where(eq(costApplications.id, id));
      let written = null;
      if (b.lines !== undefined) {
        written = await writeApplicationLines(id, appRow.contractId, appRow.number, contract?.retainageBp ?? 1000, b.lines);
      }
      res.json({ ok: true, linesWritten: written });
    } catch (e) { fail(res, e, 'update the application'); }
  });

  app.delete('/api/cost-applications/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      await db.delete(costApplicationLines).where(eq(costApplicationLines.applicationId, id));
      await db.delete(costPayments).where(eq(costPayments.applicationId, id));
      await db.delete(costWaivers).where(eq(costWaivers.applicationId, id));
      await db.delete(costApplications).where(eq(costApplications.id, id));
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'delete the application'); }
  });

  // ---- lien waivers
  const waiverValues = (b: any, partial: boolean) => {
    const out: any = {};
    if (!partial || b.vendor !== undefined) {
      const v = String(b.vendor ?? '').trim();
      if (!v) throw new UserError('Enter the vendor.');
      out.vendor = v.slice(0, 200);
    }
    if (b.amount !== undefined) out.amountCents = toCents(b.amount);
    if (b.received !== undefined) out.received = !!b.received;
    if (b.notNeeded !== undefined) out.notNeeded = !!b.notNeeded;
    if (b.notes !== undefined) out.notes = b.notes ? String(b.notes) : null;
    if (b.documentId !== undefined) out.documentId = b.documentId == null ? null : Number(b.documentId);
    return out;
  };

  app.post('/api/cost-applications/:id/waivers', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [a] = await db.select().from(costApplications).where(eq(costApplications.id, id));
      if (!a) return res.status(404).json({ message: 'Pay app not found' });
      const [c] = await db.select().from(costContracts).where(eq(costContracts.id, a.contractId));
      const b = req.body || {};
      const kind = b.kind === 'unconditional' ? 'unconditional' : 'conditional';
      const [row] = await db.insert(costWaivers).values({
        projectId: c.projectId, contractId: a.contractId, applicationId: id, kind,
        fromWaiverId: kind === 'unconditional' && b.fromWaiverId ? Number(b.fromWaiverId) : null,
        received: b.received === undefined ? kind === 'conditional' : !!b.received,
        ...waiverValues(b, false), createdBy: who(req),
      }).returning();
      res.json(row);
    } catch (e) {
      if (e instanceof UserError) return res.status(400).json({ message: e.message });
      fail(res, e, 'add the waiver');
    }
  });

  app.patch('/api/cost-waivers/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const patch = waiverValues(req.body || {}, true);
      if (!Object.keys(patch).length) return res.status(400).json({ message: 'Nothing to change.' });
      const [row] = await db.update(costWaivers).set(patch).where(eq(costWaivers.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'Waiver not found' });
      res.json(row);
    } catch (e) {
      if (e instanceof UserError) return res.status(400).json({ message: e.message });
      fail(res, e, 'update the waiver');
    }
  });

  app.delete('/api/cost-waivers/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      await db.delete(costWaivers).where(eq(costWaivers.id, id));
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'remove the waiver'); }
  });

  /** Retag a file: what kind of document it is, and which pay app it belongs to. */
  app.patch('/api/cost-documents/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const patch: any = {};
      if (b.docType !== undefined) patch.docType = DOC_TYPES.some(([k]) => k === b.docType) ? String(b.docType) : null;
      if (b.applicationId !== undefined) patch.applicationId = b.applicationId == null ? null : Number(b.applicationId);
      if (!Object.keys(patch).length) return res.status(400).json({ message: 'Nothing to change.' });
      const [row] = await db.update(costDocuments).set(patch).where(eq(costDocuments.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'File not found' });
      res.json(row);
    } catch (e) { fail(res, e, 'update the file'); }
  });

  /**
   * One pay app's package as a zip, named so it can be followed without
   * opening it:  Tenant - Property - Contractor - Pay App 02.zip
   *   1 G702-G703/
   *   2 Conditional Waivers (Pay App 02)/  ABC Plumbing - Conditional - Pay App 02 - $40,000.00.pdf
   *   3 Unconditional Waivers (Pay App 01)/
   *   4 Invoices & Backup/
   *   5 Other/
   *   00 Contents.txt   — what's in it, and any waiver still outstanding
   */
  app.get('/api/cost-applications/:id/package', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [a] = await db.select().from(costApplications).where(eq(costApplications.id, id));
      if (!a) return res.status(404).json({ message: 'Pay app not found' });
      const [c] = await db.select().from(costContracts).where(eq(costContracts.id, a.contractId));
      const [project] = await db.select().from(costProjects).where(eq(costProjects.id, c.projectId));
      const property: any = project.propertyId ? await storage.getProperty(project.propertyId).catch(() => undefined) : undefined;
      const allApps = await db.select({ id: costApplications.id, contractId: costApplications.contractId, number: costApplications.number })
        .from(costApplications).where(eq(costApplications.contractId, a.contractId));
      const waivers = (await db.select().from(costWaivers).where(eq(costWaivers.contractId, a.contractId))).map((w) => ({
        id: w.id, contractId: w.contractId, applicationId: w.applicationId, kind: w.kind as Waiver['kind'], vendor: w.vendor,
        amount: dollars(w.amountCents), fromWaiverId: w.fromWaiverId ?? null, received: w.received, notNeeded: w.notNeeded, documentId: w.documentId ?? null,
      }));
      const prev = previousApp({ id: a.id, contractId: a.contractId, number: a.number }, allApps);
      const ck = waiverChecklist(a.id, allApps, waivers);
      const docs = await db.select().from(costDocuments).where(eq(costDocuments.applicationId, a.id));
      const waiverDocIds = new Set(waivers.filter((w) => w.applicationId === a.id && w.documentId).map((w) => w.documentId!));
      const extra = waiverDocIds.size
        ? (await db.select().from(costDocuments).where(inArray(costDocuments.id, Array.from(waiverDocIds)))).filter((d) => !docs.some((x) => x.id === d.id))
        : [];
      const all = [...docs, ...extra];
      if (!all.length) return res.status(404).json({ message: 'No files on this pay app yet.' });

      const safe = (s: string) => String(s ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
      const nn = (n: number) => String(n).padStart(2, '0');
      const label = a.kind === 'invoice' ? 'Invoice' : 'Pay App';
      const zipName = safe([project.tenantName, property?.name, c.counterparty, `${label} ${nn(a.number)}`].filter(Boolean).join(' - ')) + '.zip';
      const ext = (n: string) => (n.includes('.') ? n.slice(n.lastIndexOf('.')) : '');
      const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      const folder: Record<string, string> = {
        g702: '1 G702-G703',
        conditional: `2 Conditional Waivers (${label} ${nn(a.number)})`,
        unconditional: `3 Unconditional Waivers (${prev ? `Pay App ${nn(prev.number)}` : 'prior'})`,
        invoice: '4 Invoices & Backup',
        other: '5 Other',
      };

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName.replace(/"/g, '')}"`);
      const zip = archiver('zip', { zlib: { level: 6 } });
      zip.on('error', (err) => { console.error('[cost] package zip error', err); try { res.end(); } catch {} });
      zip.pipe(res);
      const used = new Set<string>();
      const unique = (p: string) => {
        let out = p; let i = 2;
        while (used.has(out.toLowerCase())) { out = p.replace(/(\.[^.]*)?$/, ` (${i++})$1`); }
        used.add(out.toLowerCase());
        return out;
      };
      const contents: string[] = [zipName.replace(/\.zip$/, ''), ''];
      const missing: string[] = [];
      for (const d of all) {
        const w = waivers.find((x) => x.documentId === d.id && x.applicationId === a.id);
        const type = w ? w.kind : (d.docType || 'g702');
        let name: string;
        if (w) {
          const covers = w.kind === 'conditional' ? `${label} ${nn(a.number)}` : prev ? `Pay App ${nn(prev.number)}` : 'prior';
          name = `${safe(w.vendor)} - ${w.kind === 'conditional' ? 'Conditional' : 'Unconditional'} - ${covers} - ${money(w.amount)}${ext(d.originalName)}`;
        } else if (type === 'g702') {
          name = `${safe(c.counterparty)} - ${label} ${nn(a.number)} - G702-G703${ext(d.originalName)}`;
        } else {
          name = `${label} ${nn(a.number)} - ${safe(d.originalName)}`;
        }
        const zipPath = unique(`${folder[type] ?? folder.other}/${name}`);
        let buf: Buffer | null = null;
        if (d.storage === 'object') buf = await downloadFromObjectStorage(d.storageKey);
        else buf = await fsp.readFile(path.join(process.cwd(), 'uploads', d.storageKey)).catch(() => null);
        if (!buf) { missing.push(d.originalName); continue; }
        zip.append(buf, { name: zipPath });
        contents.push(zipPath);
      }
      contents.push('', 'Lien waivers');
      for (const w of ck.conditionals) contents.push(`  Conditional   ${w.vendor}  ${money(w.amount)}  ${w.notNeeded ? 'not needed' : w.received ? 'received' : 'OUTSTANDING'}`);
      for (const u of ck.unconditionals) contents.push(`  Unconditional ${u.vendor}  ${money(u.amount)}  ${u.notNeeded ? 'not needed' : u.received ? 'received' : 'OUTSTANDING'}${u.edited ? `  (edited — expected ${u.expectedVendor} ${money(u.expectedAmount ?? 0)})` : ''}`);
      if (missing.length) contents.push('', 'Could not be included (file not found in storage):', ...missing.map((m) => `  ${m}`));
      zip.append(contents.join('\r\n'), { name: '00 Contents.txt' });
      await zip.finalize();
    } catch (e) { if (!res.headersSent) fail(res, e, 'build the package'); }
  });

  // ---- documents
  /**
   * Attach a pay app, an invoice or a change order.
   *
   * Kept only once Object Storage confirms it holds the file. The local
   * uploads folder is wiped on every publish — that is how fifteen files were
   * lost before — so a file Object Storage cannot confirm is refused, not
   * quietly kept somewhere it will disappear from.
   */
  app.post('/api/cost-projects/:id/documents', ...canEdit, docUpload.single('file'), async (req, res) => {
    const tmp = path.join(os.tmpdir(), `cost-${nanoid()}`);
    try {
      const projectId = intParam(req, 'id');
      if (projectId === null) return res.status(400).json({ message: 'Invalid ID' });
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ message: 'No file received.' });

      const safeName = file.originalname.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.\./g, '_');
      const key = `cost/${projectId}/${nanoid(10)}-${safeName}`;
      let where: 'object' | 'local' = 'object';

      if (process.env.PRIVATE_OBJECT_DIR) {
        await fsp.writeFile(tmp, file.buffer);
        await backupToObjectStorage(tmp, key); // throws unless the object is confirmed
      } else {
        // A workspace without Object Storage (development). Kept on disk and
        // labelled as such, so nobody mistakes it for a durable copy.
        const dest = path.join(process.cwd(), 'uploads', key);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, file.buffer);
        where = 'local';
      }

      const num = (v: any) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
      const [row] = await db.insert(costDocuments).values({
        projectId,
        applicationId: num(req.body?.applicationId),
        contractId: num(req.body?.contractId),
        changeOrderId: num(req.body?.changeOrderId),
        directCostId: num(req.body?.directCostId),
        docType: DOC_TYPES.some(([k]) => k === req.body?.docType) ? String(req.body.docType) : null,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey: key,
        storage: where,
        uploadedBy: who(req),
      }).returning();
      // A file dropped on a waiver is that waiver: attach it and mark it received.
      const waiverId = num(req.body?.waiverId);
      if (waiverId) await db.update(costWaivers).set({ documentId: row.id, received: true }).where(eq(costWaivers.id, waiverId));
      res.json(row);
    } catch (e) {
      fail(res, e, 'save the file');
    } finally {
      fsp.unlink(tmp).catch(() => {});
    }
  });

  app.get('/api/cost-documents/:id/download', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [doc] = await db.select().from(costDocuments).where(eq(costDocuments.id, id));
      if (!doc) return res.status(404).json({ message: 'File not found' });
      res.setHeader('Content-Disposition', `inline; filename="${doc.originalName.replace(/"/g, '')}"`);
      if (doc.storage === 'object') {
        const served = await streamFromObjectStorage(doc.storageKey, res);
        if (!served) res.status(404).json({ message: 'The file record exists but Object Storage does not have it.' });
        return;
      }
      res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
      res.sendFile(path.join(process.cwd(), 'uploads', doc.storageKey));
    } catch (e) { fail(res, e, 'fetch the file'); }
  });

  app.delete('/api/cost-documents/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      // The record goes; the stored object stays. Deleting evidence is not
      // something a click in a list should be able to do.
      await db.delete(costDocuments).where(eq(costDocuments.id, id));
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'remove the file'); }
  });
}
