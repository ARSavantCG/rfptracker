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
  normalizeApproval, effectiveBaseline, discountState, budgetBreakdown, fundingSources, budgetStory, defaultMarkups, SUPPLEMENTAL_DEFAULT, snapshotOriginal, pricedTotal, normalizeCO, coTotals, coSummary, CO_CM_KEY,
  type BudgetApproval, type BudgetCO,
} from '@shared/cost-budget-approval';
import { positionAsOf, detectCmFee, cmFeeEarned, buildLedger, cmInvoiceCalc, billableItems, paidItems, invoiceCalc, coFeeLinks, supplementalCmEarned, type DatedApplication, type Payment } from '@shared/cost-position';
import { and, eq, inArray, like, desc, isNull, isNotNull, sql } from 'drizzle-orm';
import { feePaid, feeDonut, vendorDonut, scheduleRows, type ProjectDashboard } from '@shared/cost-dashboard';
import {
  budgetVsActual, g702For, lineProgress, g702Check, normalizeContractorG702, retainageCents, changeOrderStarts, docNumbers, newAppNumbers, formatProjectNumber, UNALLOCATED_KEY,
  type BaselineLine, type SovLine, type ChangeOrder, type Application, type AllocationMode,
} from '@shared/cost-tracking';
import { headIds, lineSplitWithHeads, isCoveredByHead } from '@shared/budget-totals';
import { resolveContractBucket } from './budget-by-contract';
import { backupToObjectStorage, streamFromObjectStorage, downloadFromObjectStorage, deleteFromObjectStorage, listObjectsWithMeta, mimeFromName } from './storage-backup';
import archiver from 'archiver';
import Anthropic from '@anthropic-ai/sdk';
import { requireAi } from './lib/ai-switch';
import { normalizeScopes, computeScopes, absorbedByLine } from '@shared/funding-scopes';
import { normalizeRead, matchRows, payAppPrompt, coKey, contractorG703From, normalizeContractorG703 } from '@shared/cost-payapp-read';

const AI_MODEL = 'claude-sonnet-4-5';
import { coLog, cosOnPayApp } from '@shared/co-log';
import { isStage, stageOf, statusOfStage, parseRouting, type CoStage } from '@shared/co-routing';
import { waiverChecklist, waiverLog, waiverOutstanding, waiverTotals, partyOf, previousApp, payAppVendors, sameVendor, paidOfFrom, unpaid, paidNote, fundingNote, gcPaymentDue, DOC_TYPES, type Waiver } from '@shared/cost-waivers';
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

/** Where a file sat, said in words for the Deleted Files bin: "Nova · Pay App 05 · Conditional Waiver — JEM". */
async function fileLocation(d: typeof costDocuments.$inferSelect, waiver?: { kind: string; vendor: string } | null): Promise<string> {
  const parts: string[] = [];
  if (d.contractId) { const [c] = await db.select({ n: costContracts.counterparty }).from(costContracts).where(eq(costContracts.id, d.contractId)); if (c) parts.push(c.n); }
  if (d.applicationId) {
    const [a] = await db.select({ n: costApplications.number, k: costApplications.kind, doc: costApplications.docNumber }).from(costApplications).where(eq(costApplications.id, d.applicationId));
    if (a) parts.push(`${a.k === 'invoice' ? 'Invoice' : 'Pay App'} ${String(a.doc ?? a.n).padStart(3, '0')}`);
  }
  if (d.changeOrderId) { const [co] = await db.select({ n: costChangeOrders.number }).from(costChangeOrders).where(eq(costChangeOrders.id, d.changeOrderId)); if (co) parts.push(`Change Order ${co.n}`); }
  if (d.directCostId) { const [x] = await db.select({ v: costDirectCosts.vendor, t: costDirectCosts.description }).from(costDirectCosts).where(eq(costDirectCosts.id, d.directCostId)); if (x) parts.push(`Direct Cost — ${x.v || x.t || ''}`.trim()); }
  if (d.budgetCoId) parts.push('Tenant Change Order Backup');
  const type = waiver ? (waiver.kind === 'conditional' ? 'Conditional Waiver' : 'Unconditional Waiver') : DOC_TYPES.find(([k]) => k === d.docType)?.[1];
  const vendor = waiver ? waiver.vendor : d.vendor;
  if (type) parts.push(type + (vendor ? ` — ${vendor}` : ''));
  return parts.join(' · ') || 'Project Files';
}

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
    .where(and(eq(costDocuments.projectId, projectId), isNull(costDocuments.deletedAt))).orderBy(desc(costDocuments.createdAt));
  const payRows = none ? [] : await db.select().from(costPayments)
    .where(inArray(costPayments.contractId, contractIds)).orderBy(costPayments.paidDate, costPayments.id);
  const directRows = await db.select().from(costDirectCosts)
    .where(eq(costDirectCosts.projectId, projectId)).orderBy(costDirectCosts.date, costDirectCosts.id);
  const directCosts = directRows.map((d) => ({
    id: d.id, date: isoDay(d.date), vendor: d.vendor, description: d.description,
    amount: dollars(d.amountCents), method: d.method, reference: d.reference, invoiceNumber: d.invoiceNumber ?? null, chargeTo: (d.chargeTo === 'tenant' || d.chargeTo === 'landlord') ? d.chargeTo : null,
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
  const applications: Application[] = apps.map((a) => ({
    id: a.id, contractId: a.contractId, number: a.number,
    retainageAdj: a.retainageAdjCents ? dollars(a.retainageAdjCents) : 0,
    lines: appLines.filter((l) => l.applicationId === a.id).map((l) => ({
      sovLineId: l.sovLineId,
      workThisPeriod: dollars(l.workThisPeriodCents),
      storedToDate: dollars(l.storedToDateCents),
      retainageToDate: dollars(l.retainageToDateCents),
    })),
  }));
  // Which pay app each CO first appears on, so earlier G702s leave it out.
  const coStarts = changeOrderStarts({
    changeOrders: cos.map((c) => ({ id: c.id, contractId: c.contractId, startAppNumber: c.startAppNumber, createdAt: c.createdAt })),
    lines: lines.map((l) => ({ id: l.id, changeOrderId: l.changeOrderId })),
    applications: apps.map((a) => ({ ...applications.find((x) => x.id === a.id)!, createdAt: a.createdAt })),
  });
  const changeOrders: ChangeOrder[] = cos.map((c) => ({
    id: c.id, contractId: c.contractId,
    status: (CO_STATUSES.includes(c.status) ? c.status : 'pending') as ChangeOrder['status'],
    startApp: coStarts.get(c.id)?.start ?? null,
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
  // Original → revised, line by line, and where the money comes from.
  const breakdown = budgetBreakdown(baseline, approval, cmSettings.key);
  const bk = new Map(breakdown.map((r) => [r.key, r]));
  const summary = {
    ...summary0,
    rows: summary0.rows.map((r) => ({
      ...r,
      priced: priced.has(r.key) ? Math.round(priced.get(r.key)! * 100) / 100 : null,
      originalBudget: approval.status === 'confirmed' ? (originalBy.get(r.key) ?? 0) : null,
      original: bk.get(r.key)?.original ?? 0,
      revisions: bk.get(r.key)?.revisions ?? 0,
      transfers: bk.get(r.key)?.transfers ?? 0,
      additions: bk.get(r.key)?.additions ?? 0,
      changeOrders: bk.get(r.key)?.changeOrders ?? 0,
    })),
  };
  const funding0 = fundingSources(breakdown, approval, { committed: summary0.totals.committed, pending: summary0.totals.pending, cmRate: cmSettings.pct, cmUncapped: cmSettings.cmUncapped,
    byKey: new Map(summary0.rows.map((r) => [r.key, { committed: r.committed, pending: r.pending }])) });
  const story = budgetStory(approval, funding0);
  const funding = {
    ...funding0,
    label: String(((project.settings || {}) as any).supplementalLabel || SUPPLEMENTAL_DEFAULT),
    confirmed: approval.status === 'confirmed',
  };

  const docs = docNumbers(apps);
  const dated: DatedApplication[] = applications.map((a) => {
    const row = apps.find((x) => x.id === a.id)!;
    return { ...a, date: isoDay(row.periodEnd ?? row.createdAt), kind: row.kind, invoiceNumber: row.invoiceNumber, docNumber: docs.get(a.id) };
  });
  const payments: Payment[] = payRows.map((p) => ({
    id: p.id, contractId: p.contractId, applicationId: p.applicationId ?? null,
    amount: dollars(p.amountCents), paidDate: isoDay(p.paidDate), reference: p.reference,
  }));
  const positionInput = {
    contractIds, lines, changeOrders, applications: dated, payments,
    directCosts: directCosts.map((d) => ({ id: d.id, date: d.date, amount: d.amount, vendor: d.vendor, description: d.description, method: d.method, reference: d.reference, invoiceNumber: d.invoiceNumber, key: d.key })),
  };
  // Through today, or through the latest pay app when one is dated ahead (period ending at
  // month end, entered before it): what's been entered counts (Adolfo, 2026-10-23).
  const latestApp = dated.reduce((m, a: any) => (String(a.date).slice(0, 10) > m ? String(a.date).slice(0, 10) : m), '');
  const position = positionAsOf(latestApp > todayEastern() ? latestApp : todayEastern(), positionInput);

  const settings = (project.settings || {}) as any;
  // The CM's own contract (if there is one) is not part of its base.
  const cmContractIds = new Set(contracts.filter((c) => c.bucket === 'cm').map((c) => c.id));
  // Change order work on vendor COs linked to tenant change orders earns the
  // Supplemental CM Fee; everything else earns the original fee.
  const coLinks = coFeeLinks(approval.changeOrders, sov.map((l) => ({ id: l.id, changeOrderId: l.changeOrderId ?? null })));
  const progress = lineProgress(applications);
  const contractOfLine = new Map(sov.map((l) => [l.id, l.contractId]));
  const paidFrac = (lineId: number) => {
    const c = position.contracts.find((x) => x.contractId === contractOfLine.get(lineId));
    return c && c.netBilled > 0.005 ? c.paid / c.netBilled : 0;
  };
  const supplemental = { ...supplementalCmEarned(progress, coLinks, paidFrac), budget: bk.get('__co_cm_fee__')?.revised ?? 0 };
  const cmFee = cmSettings.key || settings.cmFeePct != null
    ? cmFeeEarned(cmSettings, {
      rows: summary.rows.map((r) => ({ key: r.key, budget: r.budget, toDate: r.toDate })),
      paidBase: payments.filter((p) => !cmContractIds.has(p.contractId)).reduce((s, p) => s + p.amount, 0)
        + directCosts.filter((d) => d.key !== cmSettings.key).reduce((s, d) => s + d.amount, 0),
      supplemental,
    })
    : null;
  const g702 = Object.fromEntries(contracts.map((c) => {
    const nums = applications.filter((a) => a.contractId === c.id).map((a) => a.number);
    return [c.id, g702For(c.id, nums.length ? Math.max(...nums) : 0, { lines, changeOrders, applications }, { allChangeOrders: true })];
  }));

  const bundle = {
    project: { ...project, baseline },
    contracts: contracts.map((c) => ({ ...c, retainagePct: c.retainageBp / 100 })),
    changeOrders: cos.map((c) => ({ ...c, routing: parseRouting(c.routing), proposedAmount: c.proposedAmountCents == null ? null : dollars(c.proposedAmountCents), startApp: coStarts.get(c.id)?.start ?? null, startSource: coStarts.get(c.id)?.source ?? 'none' })),
    sovLines: sov.map((l) => ({ ...l, scheduledValue: dollars(l.scheduledValueCents) })),
    applications: apps.map((a) => ({
      ...a,
      retainageAdj: a.retainageAdjCents ? dollars(a.retainageAdjCents) : 0,
      docNumber: docs.get(a.id)!,
      lines: appLines.filter((l) => l.applicationId === a.id).map((l) => ({
        id: l.id, sovLineId: l.sovLineId,
        workThisPeriod: dollars(l.workThisPeriodCents),
        storedToDate: dollars(l.storedToDateCents),
        retainageToDate: dollars(l.retainageToDateCents),
      })),
      g702: g702For(a.contractId, a.number, { lines, changeOrders, applications }),
    })).map((a) => ({ ...a, check: g702Check(a.g702, a.contractorG702 as any) })),
    documents,
    summary,
    breakdown,
    funding,
    story,
    // Funding by scope (allowances, tenant funds, our site budget, each with its own overage rule).
    scopeSetup: normalizeScopes(settings.fundingScopes),
    scopes: computeScopes(normalizeScopes(settings.fundingScopes), summary.rows, absorbedByLine(approval.changeOrders)),
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
    // Two invoices, side by side: the tenant's (costs + their CM fee) and the capital
    // partner's (the CM fee only, with the costs incurred and paid shown as backup).
    // Each has its own numbers and its own "previously invoiced".
    ...(() => {
    // What the tenant pays for: change orders only (the original scope is in the capital
    // partner's budget), or their LAF share of the original scope too. Projects that
    // already invoiced the tenant for costs keep that until changed.
    const tenantCosOnly = (settings.tenantBills ?? (settings.invoiceType === 'reimbursable' ? 'all' : 'cos')) !== 'all';
    // Projected at completion, so the team sees what's still to come, not only what's billable now.
    const cosApproved = approval.changeOrders.filter((c) => c.status === 'approved');
    const cosPending = approval.changeOrders.filter((c) => c.status === 'pending');
    // The original budget (before change orders) includes the CM fee, so the fee is backed out of it at
    // the partner's rate: base = budget ÷ (1 + rate), fee = budget − base. E.g. $1,466,500 at 2.75%.
    const notCm = (k: string) => k !== cmSettings.key && k !== CO_CM_KEY;
    // When the budget does not include the fee (it's paid on top), the base is the budget less any CM line, and the fee is added.
    const origTotal0 = r2c(breakdown.filter((r) => (cmSettings.feeInBudget ? r.key !== CO_CM_KEY : notCm(r.key))).reduce((t, r) => t + r.revised - r.changeOrders, 0));
    const origBase = cmSettings.feeInBudget ? r2c(origTotal0 / (1 + cmSettings.pct / 100)) : origTotal0;
    const origTotal = cmSettings.feeInBudget ? origTotal0 : r2c(origTotal0 * (1 + cmSettings.pct / 100));
    const origTenantBase = r2c(breakdown.filter((r) => notCm(r.key)).reduce((t, r) => {
      const share = Number(baseline.find((x) => x.key === r.key)?.tenantSharePct ?? 100);
      return t + ((r.revised - r.changeOrders) * share) / 100;
    }, 0));
    const budgetOf = (k: string | null) => (k ? summary.rows.find((r) => r.key === k)?.budget ?? 0 : 0);
    const sumCo = (cs: typeof cosApproved, f: (t: ReturnType<typeof coTotals>) => number) => r2c(cs.reduce((t, c) => t + f(coTotals(c)), 0));
    const projection = {
      fee: {
        original: r2c(origTotal - origBase), changeOrders: sumCo(cosApproved, (t) => t.cmAbsorbed),
        pending: sumCo(cosPending, (t) => t.cmAbsorbed), budget: r2c(budgetOf(cmSettings.key) + budgetOf(CO_CM_KEY)), base: origBase,
        // Change order amounts the partner's fee is figured on: all the work, or the tenant's share, per change order.
        // Change order amounts the partner's fee is figured on: all the work, or the tenant's share, per change order.
        coBase: sumCo(cosApproved, (t) => t.partnerBase), pendingBase: sumCo(cosPending, (t) => t.partnerBase),
      },
      reimbursable: {
        original: tenantCosOnly ? 0 : r2c((origTenantBase * cmSettings.tenantPct) / 100),
        changeOrders: sumCo(cosApproved, (t) => t.cm), pending: sumCo(cosPending, (t) => t.cm), budget: 0, base: tenantCosOnly ? 0 : origTenantBase,
        // The tenant's fee on each change order is on their share of the work and markups, less credits.
        coBase: sumCo(cosApproved, (t) => t.tenantFeeBase), pendingBase: sumCo(cosPending, (t) => t.tenantFeeBase),
        // Everything the tenant will owe on approved change orders: their share, markups and fee, less credits.
        total: sumCo(cosApproved, (t) => t.tenant), pendingTotal: sumCo(cosPending, (t) => t.tenant),
      },
    };
    // The CM fee budget: the ceiling on the capital partner's original fee.
    const cmCeiling = cmSettings.key ? r2c(breakdown.filter((r) => r.key === cmSettings.key).reduce((t, r) => t + r.revised - r.changeOrders, 0)) : 0;
    const draftFor = (type: 'fee' | 'reimbursable') => {
      const issued = ((settings.cmInvoices || []) as CmInvoiceRecord[]).filter((i) => streamOf(i) === type);
      // Charges marked Tenant Pays or Landlord Pays move the tenant's share off their budget line's.
      const lineShare = new Map(summary.rows.map((r) => [r.key, r.tenantSharePct] as [string, number]));
      const chargeAdj = r2c(directCosts.filter((d) => d.chargeTo && d.key !== cmSettings.key).reduce((t, d) => {
        const linePct = d.key && lineShare.has(d.key) ? lineShare.get(d.key)! : 0;
        return t + (d.amount * ((d.chargeTo === 'tenant' ? 100 : 0) - linePct)) / 100;
      }, 0));
      const calc = cmInvoiceCalc({
        rows: [
          ...summary.rows.map((r) => ({ key: r.key, description: r.description, toDate: r.toDate, tenantSharePct: r.tenantSharePct })),
          ...(Math.abs(chargeAdj) >= 0.005 ? [{ key: '__charge_to__', description: 'Charges Marked Tenant or Landlord Pays', toDate: chargeAdj, tenantSharePct: 100 }] : []),
        ],
        cmKey: cmSettings.key, pct: cmSettings.pct,
        previouslyInvoiced: issued.reduce((s, i) => s + (Number(i.due) || 0), 0),
      });
      const covered = new Set(issued.flatMap((i) => (i.items || []).map((x) => x.ref)));
      const billed = billableItems({
        lines, changeOrders,
        applications: dated.map((a) => {
          const row = apps.find((x) => x.id === a.id)!;
          return { ...a, kind: row.kind, invoiceNumber: row.invoiceNumber, docNumber: docs.get(a.id) };
        }),
        directCosts,
        // Linked change order work is billed at its own share; other work at the
        // line's share with only unlinked change orders (estimates) folded in.
        // The tenant's invoice, when the tenant pays for change orders only: the original
        // scope is the capital partner's, so only change order shares are billable.
        tenantPct: type === 'reimbursable' && tenantCosOnly
          ? new Map(effectiveBaseline(baseline.map((x) => ({ ...x, tenantSharePct: 0 })), { ...approval, changeOrders: approval.changeOrders.filter((c) => !c.links.length) }, cmSettings.key)
            .map((x) => [x.key, Number(x.tenantSharePct ?? 0)] as [string, number]))
          : coLinks.size
          ? new Map(effectiveBaseline(baseline, { ...approval, changeOrders: approval.changeOrders.filter((c) => !c.links.length) }, cmSettings.key)
            .map((b) => [b.key, Number(b.tenantSharePct ?? 100)] as [string, number]))
          : new Map(summary.rows.map((r) => [r.key, r.tenantSharePct] as [string, number])),
        validKeys: new Set(effective.map((b) => b.key)),
        cmKey: cmSettings.key,
        contractName: (cid) => contracts.find((c) => c.id === cid)?.counterparty ?? 'Contract',
        coLinks, rate: cmSettings.pct, tenantRate: cmSettings.tenantPct,
        credits: type === 'reimbursable'
          ? approval.changeOrders.filter((c) => c.status === 'approved' && c.credit > 0).map((c) => ({ id: c.id, date: c.date ?? todayEastern(), number: c.number, amount: c.credit }))
          : [],
      });
      const items = billed;
      // Each item is rounded to the cent; put the rounding difference on the
      // largest item so the column ties to the base the fee is figured on.
      const drift = Math.round((calc.base - items.reduce((t, i) => t + i.billable, 0)) * 100) / 100;
      if (!coLinks.size && items.length && Math.abs(drift) >= 0.005 && Math.abs(drift) < 1) {
        const big = items.reduce((m, i) => (Math.abs(i.billable) > Math.abs(m.billable) ? i : m), items[0]);
        big.billable = Math.round((big.billable + drift) * 100) / 100;
        big.fee = Math.round(big.billable * cmSettings.pct) / 100;
      }
      const spent = Math.round(calc.lines.reduce((t, l) => t + l.spent, 0) * 100) / 100;
      const drift2 = Math.round((spent - items.reduce((t, i) => t + i.amount, 0)) * 100) / 100;
      if (items.length && Math.abs(drift2) >= 0.005 && Math.abs(drift2) < 1) {
        const big = items.reduce((m, i) => (Math.abs(i.amount) > Math.abs(m.amount) ? i : m), items[0]);
        big.amount = Math.round((big.amount + drift2) * 100) / 100;
      }
      // How each invoice counts costs and who it goes to (set on the Reports tab).
      const legacy = settings.invoiceType === 'reimbursable' ? 'reimbursable' : 'fee';
      const basisRaw = (type === 'reimbursable' ? settings.invoiceBasisTenant : settings.invoiceBasisCapital) ?? settings.invoiceBasis;
      const basis = basisRaw === 'billed' ? 'billed' as const : 'paid' as const;
      const billTo = String((type === 'reimbursable' ? settings.billToTenant : settings.billToCapital)
        ?? (legacy === type ? settings.billTo : null)
        ?? (type === 'reimbursable' ? project.tenantName : '') ?? '');
      // Paid to date on each item: payments on its pay app; a direct charge is paid when entered.
      const paidOn = new Map<string, number>();
      for (const p of payments) if (p.applicationId != null) paidOn.set(`app-${p.applicationId}`, (paidOn.get(`app-${p.applicationId}`) ?? 0) + p.amount);
      const paidList = paidItems(items, payments, (aid) => {
        const row = apps.find((x) => x.id === aid);
        if (!row) return null;
        return {
          vendor: contracts.find((c) => c.id === row.contractId)?.counterparty ?? 'Contract',
          item: `${row.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${String(docs.get(row.id)).padStart(3, '0')}${row.invoiceNumber ? ` (${row.invoiceNumber})` : ''}`,
        };
      });
      const chosen = basis === 'billed' ? items : paidList;
      // The tenant is invoiced at the tenant rate; the capital partner at the partner rate.
      const invPct = type === 'reimbursable' ? cmSettings.tenantPct : cmSettings.pct;
      // Earned both ways, whatever this invoice counts: on work billed and on payments made.
      // Base: every cost for the capital partner; the tenant's billable share for the tenant.
      // The capital partner's original fee stops at the CM fee budget (a ceiling), unless the project
      // earns the fee beyond it (e.g. supplemental funding from a lease amendment).
      const capFee = <T extends { fee: number; suppFee: number; toDate: number; due: number; previous: number }>(x: T): T => {
        if (type !== 'fee' || cmSettings.cmUncapped || !(cmCeiling > 0) || x.fee <= cmCeiling) return x;
        const toDate = r2c(cmCeiling + x.suppFee);
        return { ...x, fee: r2c(cmCeiling), toDate, due: r2c(toDate - x.previous), capped: true };
      };
      const earnedOn = (list: typeof items) => {
        const x = capFee(invoiceCalc({ type, items: list, pct: invPct, previouslyInvoiced: 0 }));
        return { base: type === 'fee' ? r2c(list.reduce((t, i) => t + i.amount, 0)) : x.costs, fee: r2c(x.fee + x.suppFee) };
      };
      const earnedBilled = earnedOn(items), earnedPaid = earnedOn(paidList);
      const inv = capFee(invoiceCalc({ type, items: chosen, pct: invPct, previouslyInvoiced: calc.previous }));
      // Retainage held back on each pay app (its G702: held now less held before) — why what was paid is less than the cost.
      const heldOn = (ref: string) => {
        if (!ref.startsWith('app-')) return 0;
        const a = apps.find((x) => `app-${x.id}` === ref);
        if (!a) return 0;
        const prior = apps.filter((x) => x.contractId === a.contractId && x.number < a.number).sort((x, y) => y.number - x.number)[0];
        const now = g702For(a.contractId, a.number, { lines, changeOrders, applications }).retainage;
        const before = prior ? g702For(prior.contractId, prior.number, { lines, changeOrders, applications }).retainage : 0;
        return r2c(now - before);
      };
      const withPaid = (it: typeof items[number]) => ({ ...it, retainage: heldOn(it.ref), paid: it.ref.startsWith('direct-') || it.ref.startsWith('pay-') ? it.amount : it.ref.startsWith('app-') ? r2c(paidOn.get(it.ref) ?? 0) : 0 });
      // The capital partner sees every cost incurred (with what's been paid), whatever the fee is counted on.
      const shown = type === 'fee' ? items.map(withPaid) : chosen.map(withPaid);
      // The tenant can owe each approved change order in full — work share, markups and CM fee, less
      // credits — as soon as it's approved, rather than as the work is billed (Adolfo, 2026-10-22: the
      // money has to be in our sources per the lease). Previously invoiced still comes off.
      if (type === 'reimbursable' && settings.tenantBillMode === 'full') {
        const coItems = cosApproved.map((c) => {
          const t = coTotals(c);
          return { ref: `co-${c.id}`, date: c.date ?? todayEastern(), vendor: `Change Order ${c.number}`, item: c.title || '',
            amount: t.tenantWork, billable: r2c(t.tenantWork + t.markups - t.credit), fee: 0, suppFee: t.cm,
            markups: t.markups, credit: t.credit, total: t.tenant, retainage: 0, paid: 0 };
        });
        const full = invoiceCalc({ type, items: coItems, pct: invPct, previouslyInvoiced: calc.previous });
        return {
          ...calc, type, basis, billTo, stream: 'tenant' as const, mode: 'full' as const,
          incurred: r2c(items.reduce((t, i) => t + i.amount, 0)),
          paidToDate: r2c(items.reduce((t, i) => t + withPaid(i).paid, 0)),
          invoicedToDate: r2c(issued.reduce((t, i) => t + (Number(i.due) || 0), 0)),
          feeInvoiced: issued.length ? r2c((Number(issued[issued.length - 1].earned) || 0) + (Number(issued[issued.length - 1].suppFee) || 0)) : 0,
          invoices: issued.length, tenantCosOnly, earnedBilled, earnedPaid,
          projected: (() => { const pr = projection.reimbursable; return { ...pr, fee: r2c(pr.original + pr.changeOrders) }; })(),
          base: full.costs, earned: full.fee, suppFee: full.suppFee, cpFee: 0, toDate: full.toDate, due: full.due, pct: invPct,
          supplementalCos: cosApproved.filter((c) => coTotals(c).cm > 0).map((c) => c.number),
          items: coItems.map((it) => ({ ...it, thisInvoice: issued.length > 0 && !covered.has(it.ref) })),
          lines: [] as typeof calc.lines,
        };
      }
      return {
        mode: 'incurred' as const,
        ...calc, type, basis, billTo, stream: type === 'fee' ? 'capital' as const : 'tenant' as const,
        incurred: r2c(items.reduce((t, i) => t + i.amount, 0)),
        paidToDate: r2c(items.reduce((t, i) => t + withPaid(i).paid, 0)),
        invoicedToDate: r2c(issued.reduce((t, i) => t + (Number(i.due) || 0), 0)),
        // The fee part of it: the latest invoice's fee to date (each one carries its running fee).
        feeInvoiced: issued.length ? r2c((Number(issued[issued.length - 1].earned) || 0) + (Number(issued[issued.length - 1].suppFee) || 0)) : 0,
        invoices: issued.length,
        tenantCosOnly, earnedBilled, earnedPaid,
        projected: (() => {
          const pr = projection[type] as { original: number; changeOrders: number; pending: number; budget: number; base: number; coBase: number; pendingBase: number; total?: number; pendingTotal?: number };
          return { ...pr, fee: r2c(pr.original + pr.changeOrders) };
        })(),
        // base/earned/due follow the chosen type and basis.
        base: inv.costs, earned: inv.fee, suppFee: inv.suppFee, cpFee: inv.cpFee, toDate: inv.toDate, due: inv.due, pct: invPct,
        supplementalCos: Array.from(new Set(Array.from(coLinks.values()).filter((l) => (type === 'fee' ? l.partnerFee : l.cmFee)).map((l) => l.coNumber))),
        items: shown.map((it) => ({ ...it, thisInvoice: issued.length > 0 && !covered.has(it.ref) })),
        // The by-line table ties to the items only when no change order work is billed at its own share.
        lines: basis === 'billed' && !coLinks.size ? calc.lines : [],
      };
    };
    const capital = draftFor('fee');
    const tenant = draftFor('reimbursable');
    return {
      cmInvoiceDrafts: { capital, tenant },
      // The one the project used before there were two (older screens and tests).
      cmInvoiceDraft: settings.invoiceType === 'reimbursable' ? tenant : capital,
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
      sortOrder: w.sortOrder ?? null, party: (w.party === 'gc' || w.party === 'sub') ? (w.party as 'gc' | 'sub') : null,
      payAppDue: w.payAppDueCents == null ? null : dollars(w.payAppDueCents),
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
        return `${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${String(docs.get(a.id) ?? a.number).padStart(3, '0')}${a.invoiceNumber ? ` (${a.invoiceNumber})` : ''}`;
      },
      budgetLineName: (key) => (key ? baseline.find((b) => b.key === key)?.description ?? 'Unallocated' : 'Unallocated'),
    }),
  };
  // Admin dashboard figures ride along (the UI shows them to admins only).
  return { ...bundle, dashboard: dashboardFor(bundle) };
}

/** A CM fee invoice as issued: its numbers frozen, so a reprint matches what was sent. */
export interface CmInvoiceRecord {
  number: string;
  date: string;
  /** Payment received on this invoice (from the capital partner or the tenant). */
  paidDate?: string | null;
  paidAmount?: number | null;
  base: number;
  pct: number;
  earned: number;
  /** Supplemental CM fee (change orders), and the part charged to the capital partner. */
  suppFee?: number;
  cpFee?: number;
  supplementalCos?: string[];
  previous: number;
  due: number;
  lines: Array<{ key: string; description: string; spent: number; tenantSharePct: number; billable: number }>;
  payApps: Array<{ contract: string; number: number; date: string; billedToDate: number }>;
  /** Every billable item behind it — pay apps, invoices, direct charges. */
  items?: Array<{ ref: string; date: string; vendor: string; item: string; amount: number; billable: number; thisInvoice: boolean }>;
  type?: 'fee' | 'reimbursable';
  basis?: 'paid' | 'billed';
  /** Tenant invoice: billed as costs are incurred, or each approved change order in full. */
  mode?: 'incurred' | 'full';
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
    /**
     * The tenant's rate, which can differ from the capital partner's: set for the
     * project, else the CM line's name (the LAF's rate), else the partner rate.
     */
    tenantPct: settings.tenantCmFeePct != null && Number.isFinite(Number(settings.tenantCmFeePct)) ? Number(settings.tenantCmFeePct)
      : detected?.pct ?? (settings.cmFeePct != null ? Number(settings.cmFeePct) : 0),
    tenantSource: (settings.tenantCmFeePct != null ? 'project' : detected ? 'line' : 'none') as 'project' | 'line' | 'none',
    /**
     * Whether the approved budget (the LAF total) already includes the CM fee. Then the original fee is
     * backed out of it; if not, the fee is on top: rate × budget. Assumed yes when the budget has a CM line.
     */
    feeInBudget: settings.feeInBudget != null ? settings.feeInBudget === true
      : (settings.cmFeeKey !== undefined ? !!settings.cmFeeKey : !!detected?.key),
    feeInBudgetSet: settings.feeInBudget != null,
    /** Earn the capital partner's fee beyond the CM fee budget (supplemental funding, a lease amendment). Off: the budget is a ceiling. */
    cmUncapped: settings.cmUncapped === true,
  };
}

const r2c = (v: number) => Math.round(v * 100) / 100;
/** Which invoice stream an issued invoice belongs to. Older ones carry the type the project used then. */
export const streamOf = (i: { type?: 'fee' | 'reimbursable' }) => (i.type === 'reimbursable' ? 'reimbursable' : 'fee');
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
      ? Math.round(retainageCents(((priorWork.get(sovLineId) ?? 0) + work + stored) * retainageBp / 10000 / 100) * 100)
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
  app.get('/api/cost-projects', ...canEdit, async (req, res) => {
    try {
      const rows = await db.select().from(costProjects).orderBy(desc(costProjects.createdAt));
      // Dashboards (CM fees, vendor billings, schedule) are for admins only.
      const u: any = (req as any).user;
      const admin = !!u && (u.role === 'admin' || (u.permissions || []).includes('admin.access'));
      const out = [];
      for (const p of rows) {
        const b = await loadProjectBundle(p.id);
        out.push({
          ...p,
          totals: b?.summary.totals ?? null,
          reconciles: b?.summary.reconciles ?? true,
          contractCount: b?.contracts.length ?? 0,
          ...(admin && b ? { dashboard: b.dashboard } : {}),
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

  /**
   * Budget lines priced from vendor change orders: each vendor line's amount on
   * the budget line(s) it is mapped to, at that vendor's tenant share. A vendor
   * line not mapped yet falls back to the budget line this change order used.
   */
  const linesFromVendors = async (projectId: number, links: BudgetCO['links'], current: BudgetCO['lines'], baseline: BaselineLine[]) => {
    const keys = new Set(baseline.map((b) => b.key));
    const out: BudgetCO['lines'] = [];
    for (const link of links) {
      const [cco] = await db.select().from(costChangeOrders).where(eq(costChangeOrders.id, link.contractCoId));
      const [k] = cco ? await db.select().from(costContracts).where(eq(costContracts.id, cco.contractId)) : [];
      if (!cco || !k || k.projectId !== projectId) throw new UserError('A linked vendor change order no longer exists. Unlink it.');
      const vlines = await db.select().from(costSovLines).where(eq(costSovLines.changeOrderId, cco.id));
      const label = `${k.counterparty} ${cco.number}`;
      if (!vlines.length) throw new UserError(`${label} has no amounts yet. Enter its lines on the Contracts tab first.`);
      // Where this vendor's unmapped lines sat before (not a line one of its lines has since been mapped to).
      const mappedKeys = new Set(vlines.filter((v) => v.allocationMode === 'direct')
        .flatMap((v) => ((v.allocations || []) as Array<{ baselineKey: string }>).map((x) => x.baselineKey)));
      const fallback = current.find((l) => l.fromCoId === cco.id && !mappedKeys.has(l.key))?.key
        ?? current.find((l) => l.fromCoId == null)?.key ?? null;
      const byKey = new Map<string, number>();
      for (const v of vlines) {
        const amt = dollars(v.scheduledValueCents);
        const alloc = ((v.allocations || []) as Array<{ baselineKey: string; pct: number }>).filter((x) => keys.has(x.baselineKey) && Number(x.pct) > 0);
        if (v.allocationMode === 'direct' && alloc.length) {
          for (const x of alloc) byKey.set(x.baselineKey, (byKey.get(x.baselineKey) ?? 0) + (amt * Number(x.pct)) / 100);
        } else {
          // Not mapped yet: the line chosen in the form, else Unallocated until it is mapped (then Re-price).
          const k2 = fallback ?? UNALLOCATED_KEY;
          byKey.set(k2, (byKey.get(k2) ?? 0) + amt);
        }
      }
      for (const [key, amount] of Array.from(byKey)) {
        if (Math.abs(amount) >= 0.005) out.push({ key, description: label, amount: Math.round(amount * 100) / 100, tenantPct: link.pct, fromCoId: cco.id });
      }
    }
    return out;
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
      const cms = cmSettingsFor(project, baseline);
      const co = normalizeCO({
        ...b, id: `co-${nanoid(8)}`,
        // Rates are fixed when the change order is written: the tenant's, and the capital partner's.
        // Typed on the change order, else the project's rates.
        cmFeePct: b.cmFeePct != null && b.cmFeePct !== '' ? b.cmFeePct : cms.tenantPct,
        partnerFeePct: b.partnerFeePct != null && b.partnerFeePct !== '' ? b.partnerFeePct : cms.pct,
        partnerFee: b.partnerFee !== false,
        markups: Array.isArray(b.markups) ? b.markups : defaultMarkups(baseline, cms.key),
        contractId: null, contractCoId: null, links: [],
      })!;
      const keys = new Set([...baseline.map((x) => x.key), UNALLOCATED_KEY]);
      // Vendor change orders picked in the form: the lines are priced from them.
      const vendor = (Array.isArray(b.vendorLinks) ? b.vendorLinks : [])
        .map((l: any) => ({ contractCoId: Number(l?.contractCoId), pct: Math.max(0, Math.min(100, Math.round(Number(l?.pct ?? 100) * 1e10) / 1e10)) }))
        .filter((l: any) => Number.isFinite(l.contractCoId) && l.contractCoId > 0);
      if (vendor.length) {
        const links: BudgetCO['links'] = [];
        for (const v of vendor) {
          const [cco] = await db.select().from(costChangeOrders).where(eq(costChangeOrders.id, v.contractCoId));
          const [k] = cco ? await db.select().from(costContracts).where(eq(costContracts.id, cco.contractId)) : [];
          if (!cco || !k || k.projectId !== id) throw new UserError('That vendor change order is not on a contract in this project.');
          if (a.changeOrders.some((c) => c.links.some((x) => x.contractCoId === cco.id))) throw new UserError(`${k.counterparty} ${cco.number} is already linked to another tenant change order.`);
          if (!links.some((x) => x.contractCoId === cco.id)) links.push({ contractCoId: cco.id, contractId: cco.contractId, pct: Number.isFinite(v.pct) ? v.pct : 100 });
        }
        co.links = links;
        // A vendor line not mapped yet lands on the budget line chosen in the form.
        const fallback = b.fallbackKey && keys.has(String(b.fallbackKey)) ? [{ key: String(b.fallbackKey), description: '', amount: 0, tenantPct: 100 }] : [];
        co.lines = await linesFromVendors(id, links, co.lines.length ? co.lines : fallback, baseline);
        co.contractCoId = links[0].contractCoId;
        co.contractId = links[0].contractId;
        // Approving the tenant change order approves the vendors' with it.
        if (co.status === 'approved') {
          await db.update(costChangeOrders).set({ status: 'approved', approvedDate: new Date() })
            .where(inArray(costChangeOrders.id, links.map((l) => l.contractCoId)));
        }
      }
      if (!co.lines.length) return res.status(400).json({ message: 'Add at least one line with an amount, or pick the vendor change order behind it.' });
      if (co.lines.some((l) => !keys.has(l.key))) return res.status(400).json({ message: 'Each line needs a budget line.' });
      if (co.fundedFrom.some((f) => !baseline.some((x) => x.key === f.key))) return res.status(400).json({ message: 'Pick the budget line each amount is paid from.' });
      const contractId = b.contractId != null && b.contractId !== '' && !vendor.length ? Number(b.contractId) : null;
      if (contractId) {
        const ccoId = await writeContractCo(contractId, co, baseline);
        co.links = [{ contractCoId: ccoId, contractId, pct: co.billable ? 100 : 0 }];
        co.lines = co.lines.map((l) => ({ ...l, fromCoId: ccoId }));
        co.contractCoId = ccoId;
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
      const next = normalizeCO({ ...cur, ...pick(b, ['number', 'title', 'date', 'status', 'billable', 'lines', 'cmFee', 'credit', 'cmOnAbsorbed', 'reason', 'markups', 'partnerFee', 'partnerFeeBasis', 'cmFeePct', 'partnerFeePct', 'cmFeeAmount', 'fundedFrom']) })!;
      const keys = new Set([...baseline.map((x) => x.key), UNALLOCATED_KEY]);
      if (next.lines.some((l) => !keys.has(l.key))) return res.status(400).json({ message: 'Each line needs a budget line.' });
      if (next.fundedFrom.some((f) => !baseline.some((x) => x.key === f.key))) return res.status(400).json({ message: 'Pick the budget line each amount is paid from.' });
      // The vendors' side: write the estimate onto a contract, link vendor change
      // orders (any contracts, each with the tenant's share), set shares, re-price
      // from the vendors, or unlink. Linked lines are priced from the vendors.
      let linkNote = '';
      let links = [...next.links];
      let derive = false;
      if (b.writeContractId != null && b.writeContractId !== '') {
        // Writing the estimate as a new vendor change order would count the cost twice once vendors are linked.
        if (links.length) throw new UserError('Vendor change orders are already linked. Link another one instead of writing the estimate.');
        const cid = Number(b.writeContractId);
        const ccoId = await writeContractCo(cid, next, baseline);
        const pcts = Array.from(new Set(next.lines.map((l) => l.tenantPct)));
        links.push({ contractCoId: ccoId, contractId: cid, pct: pcts.length === 1 ? pcts[0] : 100 });
        linkNote = ' — written onto the contract';
        derive = true;
      }
      if (b.linkContractCoId != null && b.linkContractCoId !== '') {
        const ccoId = Number(b.linkContractCoId);
        if (links.some((l) => l.contractCoId === ccoId)) throw new UserError('That vendor change order is already linked here.');
        const [cco] = await db.select().from(costChangeOrders).where(eq(costChangeOrders.id, ccoId));
        const [k] = cco ? await db.select().from(costContracts).where(eq(costContracts.id, cco.contractId)) : [];
        if (!cco || !k || k.projectId !== id) throw new UserError('That change order is not on a contract in this project.');
        const pct = b.pct != null && b.pct !== '' ? Math.max(0, Math.min(100, Number(b.pct))) : 100;
        links.push({ contractCoId: ccoId, contractId: cco.contractId, pct });
        linkNote = ` — linked ${k.counterparty} ${cco.number}`;
        derive = true;
      }
      if (Array.isArray(b.links)) {
        // Shares set on existing links (and links dropped if left out).
        const want = new Map<number, number>(b.links.map((l: any): [number, number] => [Number(l.contractCoId), Math.max(0, Math.min(100, Math.round(Number(l.pct) * 1e10) / 1e10))]));
        links = links.filter((l) => want.has(l.contractCoId)).map((l) => ({ ...l, pct: Number.isFinite(want.get(l.contractCoId)!) ? want.get(l.contractCoId)! : l.pct }));
        linkNote = linkNote || ' — tenant shares updated';
        derive = true;
      }
      if (b.unlinkCoId != null) {
        const u = Number(b.unlinkCoId);
        links = links.filter((l) => l.contractCoId !== u);
        linkNote = ' — vendor change order unlinked';
        derive = links.length > 0;
        if (!links.length) next.lines = next.lines.map((l) => ({ ...l, fromCoId: null }));
      } else if (b.unlink === true) {
        links = [];
        next.lines = next.lines.map((l) => ({ ...l, fromCoId: null }));
        linkNote = ' — unlinked from the vendors';
      }
      if (b.resync === true && links.length) { derive = true; linkNote = ' — re-priced from the vendors'; }
      if (links.some((l) => a.changeOrders.some((c, j) => j !== i && c.links.some((x) => x.contractCoId === l.contractCoId)))) {
        throw new UserError('One of those vendor change orders is already linked to another tenant change order.');
      }
      if (derive && links.length) {
        // The first time vendor prices replace a typed estimate, keep the estimate.
        if (next.estimate == null && !cur.links.length && next.lines.length) next.estimate = coTotals(cur).work;
        next.lines = await linesFromVendors(id, links, next.lines, baseline);
      }
      next.links = links;
      next.contractCoId = links[0]?.contractCoId ?? null;
      next.contractId = links[0]?.contractId ?? null;
      a.changeOrders[i] = next;
      // Approving the tenant change order approves the vendors' with it. The reverse
      // never: work already released to a vendor stays released while who pays is decided.
      if (next.links.length && next.status !== cur.status && next.status === 'approved') {
        await db.update(costChangeOrders).set({ status: next.status, ...(next.status === 'approved' ? { approvedDate: new Date() } : {}) })
          .where(inArray(costChangeOrders.id, next.links.map((l) => l.contractCoId)));
      }
      await saveCos(id, project, a, req, `${next.number} ${next.status !== cur.status ? next.status : 'changed'}${linkNote}`);
      res.json(await loadProjectBundle(id));
    } catch (e) {
      if (e instanceof UserError) return res.status(400).json({ message: e.message });
      fail(res, e, 'update the change order');
    }
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
      // Which invoice: the tenant's or the capital partner's.
      const d = req.body?.stream === 'tenant' ? b.cmInvoiceDrafts.tenant : req.body?.stream === 'capital' ? b.cmInvoiceDrafts.capital : b.cmInvoiceDraft;
      if (Math.abs(d.due) < 0.005) return res.status(400).json({ message: 'Nothing new to invoice — everything to date has been invoiced.' });
      list.push({ number, date, base: d.base, pct: d.pct, earned: d.earned, previous: d.previous, due: d.due,
        lines: d.lines, payApps: payAppsFor(b), items: d.items, type: d.type, basis: d.basis, billTo: d.billTo, toDate: d.toDate,
        suppFee: d.suppFee, cpFee: d.cpFee, supplementalCos: d.supplementalCos, mode: (d as any).mode,
        issuedBy: whoName(req), issuedAt: new Date().toISOString() });
      settings.cmInvoices = list;
      await db.update(costProjects).set({ settings, updatedAt: new Date() }).where(eq(costProjects.id, id));
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'issue the invoice'); }
  });

  /** Payment received on an issued invoice (date and amount); amount null clears it. */
  app.patch('/api/cost-projects/:id/cm-invoices/:number/payment', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const settings: any = { ...(project.settings || {}) };
      const list: CmInvoiceRecord[] = [...(settings.cmInvoices || [])];
      const i = list.findIndex((x) => x.number === req.params.number);
      if (i < 0) return res.status(404).json({ message: 'Invoice not found' });
      const amount = req.body?.amount;
      if (amount === null || amount === '') {
        list[i] = { ...list[i], paidDate: null, paidAmount: null };
      } else {
        const date = String(req.body?.date ?? '').slice(0, 10);
        const amt = Math.round(Number(amount) * 100) / 100;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Enter the date it was paid.' });
        if (!(amt > 0)) return res.status(400).json({ message: 'Enter the amount received.' });
        list[i] = { ...list[i], paidDate: date, paidAmount: amt };
      }
      settings.cmInvoices = list;
      await db.update(costProjects).set({ settings, updatedAt: new Date() }).where(eq(costProjects.id, id));
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'record the payment'); }
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
      // The latest of its own stream (tenant or capital partner), so that stream's chain stays true.
      const me = list.find((i) => i.number === req.params.number);
      const mine = me ? list.filter((i) => streamOf(i) === streamOf(me)) : [];
      if (!me || mine[mine.length - 1] !== me) return res.status(400).json({ message: 'Only the most recent invoice to the same party can be withdrawn.' });
      settings.cmInvoices = list.filter((i) => i !== me);
      await db.update(costProjects).set({ settings, updatedAt: new Date() }).where(eq(costProjects.id, id));
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'withdraw the invoice'); }
  });

  // ---- additional funding (new money on a budget line that isn't a change order)
  app.post('/api/cost-projects/:id/budget-additions', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const baseline = (project.baseline || []) as BaselineLine[];
      const a = normalizeApproval(project.budgetApproval);
      const b = req.body || {};
      const key = String(b.key ?? '');
      const line = key ? baseline.find((x) => x.key === key) : null;
      if (key && !line) return res.status(400).json({ message: 'That budget line no longer exists.' });
      const amount = Math.round(toCents(b.amount)) / 100;
      if (!(Math.abs(amount) >= 0.005)) return res.status(400).json({ message: 'Enter the amount.' });
      const source = ['amortized', 'tenant', 'partner'].includes(b.source) ? b.source : 'amortized';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : todayEastern();
      const x = { id: `f-${nanoid(8)}`, key, amount, source, label: String(b.label || 'Additional Funding').trim().slice(0, 120), date, note: String(b.note ?? '').trim().slice(0, 300), by: whoName(req) };
      a.additions = [...a.additions, x as any];
      if (a.status === 'confirmed') {
        a.revisions = [...a.revisions, {
          at: new Date().toISOString(), by: whoName(req),
          total: Math.round((discountState(baseline, a).approvedTotal + coSummary(a.changeOrders).approved + a.additions.reduce((t, y) => t + y.amount, 0)) * 100) / 100,
          note: `Additional funding ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}: ${x.label}${line ? ` on ${line.description}` : ' (not on a line yet)'}`,
        }];
      }
      await saveApproval(id, a);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'add the funding'); }
  });

  /** Put additional funding on a budget line later (or take it off one). */
  app.patch('/api/cost-projects/:id/budget-additions/:aid', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const baseline = (project.baseline || []) as BaselineLine[];
      const a = normalizeApproval(project.budgetApproval);
      const x = a.additions.find((y) => y.id === req.params.aid);
      if (!x) return res.status(404).json({ message: 'Funding not found' });
      const b = req.body || {};
      if (b.key !== undefined) {
        const key = String(b.key || '');
        if (key && !baseline.some((l) => l.key === key)) return res.status(400).json({ message: 'That budget line no longer exists.' });
        x.key = key;
      }
      if (b.label !== undefined) x.label = String(b.label || x.label).slice(0, 120);
      if (b.note !== undefined) x.note = String(b.note || '').slice(0, 300);
      await saveApproval(id, a);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'update the funding'); }
  });

  app.delete('/api/cost-projects/:id/budget-additions/:aid', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const project = await loadProject(id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const a = normalizeApproval(project.budgetApproval);
      const x = a.additions.find((y) => y.id === req.params.aid);
      if (!x) return res.status(404).json({ message: 'Funding not found' });
      a.additions = a.additions.filter((y) => y.id !== x.id);
      if (a.status === 'confirmed') {
        const baseline = (project.baseline || []) as BaselineLine[];
        a.revisions = [...a.revisions, {
          at: new Date().toISOString(), by: whoName(req),
          total: Math.round((discountState(baseline, a).approvedTotal + coSummary(a.changeOrders).approved + a.additions.reduce((t, y) => t + y.amount, 0)) * 100) / 100,
          note: `Additional funding removed: ${x.label} (${x.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`,
        }];
      }
      await saveApproval(id, a);
      res.json(await loadProjectBundle(id));
    } catch (e) { fail(res, e, 'remove the funding'); }
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
      if (b.tenantCmFeePct !== undefined) {
        const v = parseFloat(String(b.tenantCmFeePct));
        if (b.tenantCmFeePct === null || b.tenantCmFeePct === '') delete next.tenantCmFeePct;
        else if (Number.isFinite(v) && v >= 0 && v <= 100) next.tenantCmFeePct = v;
        else return res.status(400).json({ message: 'The tenant CM fee must be a percentage between 0 and 100.' });
      }
      if (b.invoiceType !== undefined) next.invoiceType = b.invoiceType === 'reimbursable' ? 'reimbursable' : 'fee';
      if (b.invoiceBasis !== undefined) next.invoiceBasis = b.invoiceBasis === 'billed' ? 'billed' : 'paid';
      if (b.billTo !== undefined) next.billTo = String(b.billTo ?? '').trim().slice(0, 200);
      if (b.cmUncapped !== undefined) next.cmUncapped = !!b.cmUncapped;
      if (b.feeInBudget !== undefined) next.feeInBudget = b.feeInBudget === null ? null : !!b.feeInBudget;
      if (b.tenantBills !== undefined) next.tenantBills = b.tenantBills === 'all' ? 'all' : 'cos';
      if (b.tenantBillMode !== undefined) next.tenantBillMode = b.tenantBillMode === 'full' ? 'full' : 'incurred';
      if (b.billToTenant !== undefined) next.billToTenant = String(b.billToTenant ?? '').trim().slice(0, 200);
      if (b.billToCapital !== undefined) next.billToCapital = String(b.billToCapital ?? '').trim().slice(0, 200);
      if (b.invoiceBasisTenant !== undefined) next.invoiceBasisTenant = b.invoiceBasisTenant === 'billed' ? 'billed' : 'paid';
      if (b.invoiceBasisCapital !== undefined) next.invoiceBasisCapital = b.invoiceBasisCapital === 'billed' ? 'billed' : 'paid';
      if (b.fundingScopes !== undefined) next.fundingScopes = normalizeScopes(b.fundingScopes);
      if (b.contingencyKeys !== undefined) next.contingencyKeys = Array.isArray(b.contingencyKeys) ? b.contingencyKeys.map(String).slice(0, 20) : [];
      if (b.supplementalLabel !== undefined) next.supplementalLabel = String(b.supplementalLabel ?? '').trim().slice(0, 60);
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
      if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes).slice(0, 2000) : null;
      if (b.amount !== undefined) {
        const cents = toCents(b.amount);
        if (cents === 0) return res.status(400).json({ message: 'Enter the amount paid.' });
        patch.amountCents = cents;
      }
      if (b.paidDate !== undefined) {
        const d = String(b.paidDate || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ message: 'Enter the date it was paid.' });
        patch.paidDate = new Date(`${d}T12:00:00Z`);
      }
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
    if (b.invoiceNumber !== undefined) out.invoiceNumber = String(b.invoiceNumber ?? '').trim().slice(0, 80) || null;
    if (b.chargeTo !== undefined) out.chargeTo = b.chargeTo === 'tenant' || b.chargeTo === 'landlord' ? b.chargeTo : null;
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
      const start = b.startAppNumber != null && Number(b.startAppNumber) >= 1 ? Math.floor(Number(b.startAppNumber)) : null;
      // Routing starts at Under Review (or wherever its status puts it), received today unless given.
      const stage: CoStage = isStage(b.stage) ? b.stage : status === 'approved' ? 'approved' : status === 'void' ? 'rejected' : 'review';
      const received = /^\d{4}-\d{2}-\d{2}$/.test(String(b.receivedDate ?? '')) ? new Date(String(b.receivedDate) + 'T12:00:00Z') : new Date();
      const amt = b.proposedAmount != null && b.proposedAmount !== '' && Number.isFinite(Number(b.proposedAmount)) ? Math.round(Number(b.proposedAmount) * 100) : null;
      const [row] = await db.insert(costChangeOrders).values({
        contractId, number, title: b.title ? String(b.title) : null, status: statusOfStage(stage),
        approvedDate: stage === 'approved' ? new Date() : null,
        startAppNumber: stage === 'approved' ? start : null,
        sortOrder: existing.length,
        stage, receivedDate: received, proposedAmountCents: amt, daysAdded: b.daysAdded != null && b.daysAdded !== '' && Number.isFinite(Number(b.daysAdded)) ? Math.max(0, Math.round(Number(b.daysAdded))) : null, routedTo: b.routedTo ? String(b.routedTo).trim().slice(0, 120) || null : null,
        routing: JSON.stringify([{ stage, at: received.toISOString().slice(0, 10), by: whoName(req), to: b.routedTo ? String(b.routedTo).trim() : null, note: 'Received' }]),
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
          // Its files go to the Deleted Files bin, not away: restored, they land under Other.
          await tx.update(costDocuments).set({ deletedAt: sql`COALESCE(${costDocuments.deletedAt}, now())`, deletedBy: sql`COALESCE(${costDocuments.deletedBy}, ${who(req)})`,
            deletedFrom: sql`COALESCE(${costDocuments.deletedFrom}, ${`${c.counterparty} (contract deleted)`})`, applicationId: null, contractId: null, changeOrderId: null })
            .where(inArray(costDocuments.applicationId, appIds));
        }
        await tx.delete(costPayments).where(eq(costPayments.contractId, id));
        await tx.delete(costWaivers).where(eq(costWaivers.contractId, id));
        await tx.delete(costApplications).where(eq(costApplications.contractId, id));
        await tx.delete(costSovLines).where(eq(costSovLines.contractId, id));
        await tx.delete(costChangeOrders).where(eq(costChangeOrders.contractId, id));
        await tx.update(costDocuments).set({ deletedAt: sql`COALESCE(${costDocuments.deletedAt}, now())`, deletedBy: sql`COALESCE(${costDocuments.deletedBy}, ${who(req)})`,
          deletedFrom: sql`COALESCE(${costDocuments.deletedFrom}, ${`${c.counterparty} (contract deleted)`})`, applicationId: null, contractId: null, changeOrderId: null })
          .where(eq(costDocuments.contractId, id));
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

  /** Change orders in the order arranged by hand (ids in order). */
  app.put('/api/cost-contracts/:id/change-order-order', ...canEdit, async (req, res) => {
    try {
      const contractId = intParam(req, 'id');
      if (contractId === null) return res.status(400).json({ message: 'Invalid ID' });
      const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite);
      const mine = await db.select({ id: costChangeOrders.id }).from(costChangeOrders).where(eq(costChangeOrders.contractId, contractId));
      const valid = new Set(mine.map((m) => m.id));
      let i = 0;
      for (const cid of ids) if (valid.has(cid)) await db.update(costChangeOrders).set({ sortOrder: i++ }).where(eq(costChangeOrders.id, cid));
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'reorder the change orders'); }
  });

  app.patch('/api/cost-change-orders/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const b = req.body || {};
      const patch: any = {};
      if (b.number !== undefined) patch.number = String(b.number).trim() || 'CO';
      if (b.title !== undefined) patch.title = b.title ? String(b.title) : null;
      // Routing: a move to a new stage (logged with its date, who moved it, who has it now, a note).
      const at = /^\d{4}-\d{2}-\d{2}$/.test(String(b.at ?? '')) ? String(b.at) : todayEastern();
      if (b.stage !== undefined || b.status !== undefined || b.routedTo !== undefined || b.note !== undefined || b.receivedDate !== undefined || b.proposedAmount !== undefined || b.daysAdded !== undefined) {
        const [cur] = await db.select().from(costChangeOrders).where(eq(costChangeOrders.id, id));
        if (!cur) return res.status(404).json({ message: 'Change order not found' });
        const hist = parseRouting(cur.routing);
        const curStage = stageOf(cur);
        // A plain status change (older screens) moves the stage too.
        const toStage: CoStage | null = isStage(b.stage) ? b.stage
          : b.status !== undefined && CO_STATUSES.includes(String(b.status)) ? (b.status === 'approved' ? 'approved' : b.status === 'void' ? 'rejected' : (curStage === 'approved' || curStage === 'rejected' ? 'review' : curStage))
          : null;
        const to = b.routedTo !== undefined ? (String(b.routedTo ?? '').trim().slice(0, 120) || null) : undefined;
        if (to !== undefined) patch.routedTo = to;
        if (toStage && toStage !== curStage) {
          patch.stage = toStage;
          hist.push({ stage: toStage, at, by: whoName(req), to: to !== undefined ? to : cur.routedTo ?? null, note: b.note ? String(b.note).slice(0, 500) : null });
          b.status = statusOfStage(toStage);
          if (toStage === 'approved' && b.at) b.approvedAt = at;
        } else if (b.note) {
          hist.push({ stage: curStage, at, by: whoName(req), to: to !== undefined ? to : cur.routedTo ?? null, note: String(b.note).slice(0, 500) });
        } else if (to !== undefined && hist.length) {
          hist[hist.length - 1] = { ...hist[hist.length - 1], to };
        }
        if (cur.stage == null && !patch.stage) patch.stage = curStage;
        patch.routing = JSON.stringify(hist);
        if (b.receivedDate !== undefined) patch.receivedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.receivedDate ?? '')) ? new Date(String(b.receivedDate) + 'T12:00:00Z') : null;
        if (b.daysAdded !== undefined) patch.daysAdded = b.daysAdded == null || b.daysAdded === '' || !Number.isFinite(Number(b.daysAdded)) ? null : Math.max(0, Math.round(Number(b.daysAdded)));
        if (b.proposedAmount !== undefined) patch.proposedAmountCents = b.proposedAmount == null || b.proposedAmount === '' || !Number.isFinite(Number(b.proposedAmount)) ? null : Math.round(Number(b.proposedAmount) * 100);
        if (b.status === (cur.status) && !(toStage && toStage !== curStage)) delete b.status; // nothing to change financially
      }
      if (b.status !== undefined && CO_STATUSES.includes(String(b.status))) {
        patch.status = String(b.status);
        patch.approvedDate = b.status === 'approved' ? (b.approvedAt ? new Date(b.approvedAt + 'T12:00:00Z') : new Date()) : null;
        // Approved now and not tied to a pay app yet: it goes on the next one,
        // unless it is already billed (then the first app that bills it).
        if (b.status === 'approved' && b.startAppNumber === undefined) {
          const [co] = await db.select().from(costChangeOrders).where(eq(costChangeOrders.id, id));
          if (co && co.status !== 'approved' && co.startAppNumber == null) {
            const lineIds = (await db.select({ id: costSovLines.id }).from(costSovLines).where(eq(costSovLines.changeOrderId, id))).map((l) => l.id);
            const billed = lineIds.length ? await db.select({ number: costApplications.number })
              .from(costApplicationLines).innerJoin(costApplications, eq(costApplications.id, costApplicationLines.applicationId))
              .where(inArray(costApplicationLines.sovLineId, lineIds)) : [];
            const apps = await db.select({ number: costApplications.number }).from(costApplications).where(eq(costApplications.contractId, co.contractId));
            patch.startAppNumber = billed.length ? Math.min(...billed.map((r) => r.number)) : apps.reduce((m, a) => Math.max(m, a.number), 0) + 1;
          }
        }
      }
      if (b.startAppNumber !== undefined) {
        const n = b.startAppNumber === null || b.startAppNumber === '' ? null : Math.floor(Number(b.startAppNumber));
        if (n !== null && !(n >= 1)) return res.status(400).json({ message: 'Pick a pay app number.' });
        if (n !== null) {
          // It cannot start after an app that already bills it.
          const [co] = await db.select().from(costChangeOrders).where(eq(costChangeOrders.id, id));
          if (!co) return res.status(404).json({ message: 'Change order not found' });
          const lineIds = (await db.select({ id: costSovLines.id }).from(costSovLines).where(eq(costSovLines.changeOrderId, id))).map((l) => l.id);
          if (lineIds.length) {
            const billed = await db.select({ number: costApplications.number })
              .from(costApplicationLines).innerJoin(costApplications, eq(costApplications.id, costApplicationLines.applicationId))
              .where(inArray(costApplicationLines.sovLineId, lineIds));
            const first = billed.reduce((m, r) => Math.min(m, r.number), Infinity);
            if (first < n) return res.status(400).json({ message: `${co.number} is already billed on Pay App ${String(first).padStart(3, '0')}, so it has to start on App ${String(first).padStart(3, '0')} or earlier.` });
          }
        }
        patch.startAppNumber = n;
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
          section: l.section && String(l.section).trim() ? String(l.section).trim().slice(0, 80) : null,
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
      if (b.section !== undefined) patch.section = b.section && String(b.section).trim() ? String(b.section).trim().slice(0, 80) : null;
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
      // Rows left at $0.00 on a pay app don't count as billing: they go with the line.
      const rows = await db.select({ id: costApplicationLines.id, w: costApplicationLines.workThisPeriodCents, st: costApplicationLines.storedToDateCents, r: costApplicationLines.retainageToDateCents, app: costApplicationLines.applicationId })
        .from(costApplicationLines).where(eq(costApplicationLines.sovLineId, id));
      const live = rows.filter((x) => Number(x.w) || Number(x.st) || Number(x.r));
      if (live.length) {
        const apps = await db.select({ id: costApplications.id, doc: costApplications.docNumber, kind: costApplications.kind }).from(costApplications)
          .where(inArray(costApplications.id, Array.from(new Set(live.map((x) => x.app)))));
        const names = apps.sort((a, b) => (a.doc ?? 0) - (b.doc ?? 0)).map((a) => `${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${String(a.doc ?? 0).padStart(3, '0')}`).join(', ');
        return res.status(409).json({ message: `This line has amounts on ${names}, so it cannot be deleted. Take them off there first, or set its value to zero.` });
      }
      if (rows.length) await db.delete(costApplicationLines).where(inArray(costApplicationLines.id, rows.map((x) => x.id)));
      await db.delete(costSovLines).where(eq(costSovLines.id, id));
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'delete the line'); }
  });

  /** AI reads a pay app file against the contract's lines. Throws {status, message} when it can't. */
  async function aiReadPayApp(contract: { id: number; counterparty: string }, buf: Buffer, mime: string, name: string) {
    const isPdf = /pdf/i.test(mime) || /\.pdf$/i.test(name);
    const img = /^image\/(png|jpe?g|gif|webp)$/i.exec(mime);
    if (!isPdf && !img) throw Object.assign(new Error('AI can read a PDF or a photo of the pay app. For a spreadsheet, copy the columns into the grid instead.'), { status: 400 });
    const cos = await db.select().from(costChangeOrders).where(eq(costChangeOrders.contractId, contract.id));
    const voided = new Set(cos.filter((c) => c.status === 'void').map((c) => c.id));
    const sov = (await db.select().from(costSovLines).where(eq(costSovLines.contractId, contract.id))
      .orderBy(costSovLines.sortOrder, costSovLines.id))
      .filter((l) => l.changeOrderId == null || !voided.has(l.changeOrderId))
      .map((l) => ({ id: l.id, itemNo: l.itemNo, description: l.description, scheduledValue: dollars(l.scheduledValueCents) }));

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const source = { type: 'base64' as const, data: buf.toString('base64') };
    let response;
    try {
      response = await anthropic.messages.create({
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
    } catch (e: any) {
      if (e?.status === 401) throw Object.assign(new Error('The Anthropic API key was rejected. Check the ANTHROPIC_API_KEY secret.'), { status: 502 });
      throw e;
    }
    const block = response.content.find((c) => c.type === 'text');
    const text = block && block.type === 'text' ? block.text : '';
    const a = text.indexOf('{'), z = text.lastIndexOf('}');
    if (a === -1 || z === -1) throw Object.assign(new Error('AI could not read a pay app in that file.'), { status: 502 });
    let parsed: any;
    try { parsed = JSON.parse(text.slice(a, z + 1)); }
    catch { throw Object.assign(new Error(response.stop_reason === 'max_tokens' ? 'That pay app is too long to read in one go.' : 'AI returned something that was not readable. Try again.'), { status: 502 }); }
    const read = normalizeRead(parsed);
    const result = matchRows(read, sov);
    console.log(`[ai] read pay app for contract ${contract.id}: ${read.rows.length} rows, ${result.matched.length} matched, ${result.unmatched.length} unmatched (${response.usage?.input_tokens ?? '?'} in / ${response.usage?.output_tokens ?? '?'} out tokens)`);
    return { read, result };
  }
  async function documentBytes(d: { storage: string | null; storageKey: string }) {
    return d.storage === 'object' ? await downloadFromObjectStorage(d.storageKey)
      : await fsp.readFile(path.join(process.cwd(), 'uploads', d.storageKey)).catch(() => null);
  }

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
        const [d] = await db.select().from(costDocuments).where(and(eq(costDocuments.id, Number(req.body.documentId)), isNull(costDocuments.deletedAt)));
        if (!d) return res.status(404).json({ message: 'File not found' });
        buf = await documentBytes(d as any);
        mime = d.mimeType || ''; name = d.originalName;
      }
      if (!buf) return res.status(400).json({ message: 'Attach the pay app PDF first.' });
      const { read, result } = await aiReadPayApp(contract, buf, mime, name);
      res.json({ ...read, ...result, fileName: name });
    } catch (e: any) {
      if (e?.status === 400 || e?.status === 502) return res.status(e.status).json({ message: e.message });
      fail(res, e, 'read the pay app');
    }
  });

  /**
   * Read the contractor's G703 from the pay app file attached to a saved pay app
   * and keep it on the pay app (their G702 figures fill any not typed yet), for
   * the line-by-line G702 / G703 Comparison.
   */
  app.post('/api/cost-applications/:id/read-their-g703', ...canEdit, requireAi, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [appRow] = await db.select().from(costApplications).where(eq(costApplications.id, id));
      if (!appRow) return res.status(404).json({ message: 'Pay app not found' });
      const [contract] = await db.select().from(costContracts).where(eq(costContracts.id, appRow.contractId));
      const docs = (await db.select().from(costDocuments).where(and(eq(costDocuments.applicationId, id), isNull(costDocuments.deletedAt))))
        .filter((d) => /\.pdf$/i.test(d.originalName) || /pdf|^image\//i.test(d.mimeType || ''));
      const pick = req.body?.documentId ? docs.find((d) => d.id === Number(req.body.documentId)) : docs.find((d) => /\.pdf$/i.test(d.originalName) || /pdf/i.test(d.mimeType || '')) ?? docs[0];
      if (!pick) return res.status(400).json({ message: 'No pay app PDF is attached to this pay app. Attach it on the pay app first.' });
      const buf = await documentBytes(pick as any);
      if (!buf) return res.status(404).json({ message: 'The attached file could not be opened.' });
      const { read, result } = await aiReadPayApp(contract, buf, pick.mimeType || '', pick.originalName);
      const g703 = contractorG703From(read, result, pick.originalName);
      // Their G702: fill only what wasn't typed.
      const had: Record<string, number | null> = (appRow.contractorG702 as any) || {};
      const merged: Record<string, unknown> = { ...had };
      for (const k of ['contractSumToDate', 'completedAndStored', 'retainage', 'previousCertificates', 'currentPaymentDue']) {
        if (merged[k] == null && (read.g702 as any)[k] != null) merged[k] = (read.g702 as any)[k];
      }
      await db.update(costApplications).set({ contractorG703: g703, contractorG702: normalizeContractorG702(merged) }).where(eq(costApplications.id, id));
      res.json({ ok: true, rows: g703.rows.length, matched: result.matched.length, unmatched: result.unmatched.length, fileName: pick.originalName, warnings: result.warnings });
    } catch (e: any) {
      if (e?.status === 400 || e?.status === 502) return res.status(e.status).json({ message: e.message });
      fail(res, e, "read the contractor's G703");
    }
  });

  /**
   * Make the contract match a pay app AI just read: add the lines it does not
   * have (and the change orders they sit under), and record what was billed
   * before tracking began as one opening application. All or nothing.
   */
  app.post('/api/cost-contracts/:id/setup-from-pay-app', ...canEdit, async (req, res) => {
    try {
      const contractId = intParam(req, 'id');
      if (contractId === null) return res.status(400).json({ message: 'Invalid ID' });
      const [contract] = await db.select().from(costContracts).where(eq(costContracts.id, contractId));
      if (!contract) return res.status(404).json({ message: 'Contract not found' });
      const b = req.body || {};
      const lines: any[] = (Array.isArray(b.lines) ? b.lines : []).filter((l: any) => String(l?.description ?? '').trim());
      const opening = b.opening && Array.isArray(b.opening.lines) && b.opening.lines.length ? b.opening : null;
      const pct = b.retainagePct != null && Number.isFinite(Number(b.retainagePct)) ? Number(b.retainagePct) : null;
      if (!lines.length && !opening && pct === null) return res.status(400).json({ message: 'Nothing to set up.' });

      const result = await db.transaction(async (tx) => {
        let retainageBp = contract.retainageBp;
        if (pct !== null && pct >= 0 && pct <= 100) {
          retainageBp = Math.round(pct * 100);
          await tx.update(costContracts).set({ retainageBp }).where(eq(costContracts.id, contractId));
        }
        const cos = await tx.select().from(costChangeOrders).where(eq(costChangeOrders.contractId, contractId));
        const coIds = new Map<string, number>();
        for (const c of cos) if (c.status !== 'void') coIds.set(coKey(c.number), c.id);
        let coOrder = cos.length;
        for (const l of lines) {
          if (!l.changeOrder) continue;
          const k = coKey(String(l.changeOrder));
          if (coIds.has(k)) continue;
          const [co] = await tx.insert(costChangeOrders).values({
            contractId, number: String(l.changeOrder).slice(0, 60), title: null, status: 'approved',
            approvedDate: new Date(), sortOrder: coOrder++,
          }).returning();
          coIds.set(k, co.id);
        }
        const existing = await tx.select({ id: costSovLines.id }).from(costSovLines).where(eq(costSovLines.contractId, contractId));
        const lineIds: Record<number, number> = {};
        let order = existing.length;
        for (const l of lines) {
          const [row] = await tx.insert(costSovLines).values({
            contractId,
            changeOrderId: l.changeOrder ? coIds.get(coKey(String(l.changeOrder))) ?? null : null,
            itemNo: l.itemNo ? String(l.itemNo).slice(0, 40) : null,
            description: String(l.description).trim().slice(0, 300),
            scheduledValueCents: toCents(l.scheduledValue),
            allocationMode: 'unallocated', allocations: [], sortOrder: order++,
          }).returning();
          lineIds[Number(l.rowIndex)] = row.id;
        }

        let openingId: number | null = null;
        if (opening) {
          const n = Math.floor(Number(opening.number));
          const apps = await tx.select({ number: costApplications.number }).from(costApplications)
            .where(eq(costApplications.contractId, contractId));
          if (!(n >= 1)) throw new UserError('The opening balance needs a pay app number.');
          if (apps.some((a) => a.number <= n)) throw new UserError(`Pay apps up to ${n} are already recorded, so there is no gap to fill with an opening balance.`);
          const valid = new Set((await tx.select({ id: costSovLines.id }).from(costSovLines)
            .where(eq(costSovLines.contractId, contractId))).map((x) => x.id));
          const [app0] = await tx.insert(costApplications).values({
            contractId, number: n, kind: 'pay_app', invoiceNumber: null,
            notes: String(opening.label || 'Billed before tracking').slice(0, 200), createdBy: who(req),
          }).returning();
          openingId = app0.id;
          const rows = [];
          for (const ol of opening.lines) {
            const id = ol.sovLineId != null ? Number(ol.sovLineId) : lineIds[Number(ol.rowIndex)];
            if (!id || !valid.has(id)) continue;
            const work = toCents(ol.work);
            if (!work) continue;
            const ret = ol.retainage === null || ol.retainage === undefined || ol.retainage === ''
              ? Math.round(retainageCents(work * retainageBp / 10000 / 100) * 100) : toCents(ol.retainage);
            rows.push({ applicationId: app0.id, sovLineId: id, workThisPeriodCents: work, storedToDateCents: 0, retainageToDateCents: ret });
          }
          if (rows.length) await tx.insert(costApplicationLines).values(rows);
          // Billed before tracking is, as a rule, paid before tracking. Recorded so
          // "owed" is only what is actually open; certified = work less retainage.
          if (b.openingPaid) {
            const due = rows.reduce((t, r) => t + r.workThisPeriodCents - r.retainageToDateCents, 0);
            const d = /^\d{4}-\d{2}-\d{2}$/.test(String(b.openingPaidDate ?? '')) ? String(b.openingPaidDate) : new Date().toISOString().slice(0, 10);
            if (due > 0) await tx.insert(costPayments).values({
              contractId, applicationId: app0.id, amountCents: due, paidDate: new Date(`${d}T12:00:00Z`),
              reference: null, method: 'other', notes: 'Paid before tracking began (recorded when the contract was set up from a pay app).', createdBy: who(req),
            });
          }
        }
        return { lineIds, openingId, retainagePct: retainageBp / 100 };
      });
      res.json(result);
    } catch (e) {
      if (e instanceof UserError) return res.status(400).json({ message: e.message });
      fail(res, e, 'set up the contract');
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
      const kind = b.kind === 'invoice' ? 'invoice' : 'pay_app';
      const existing = await db.select({ id: costApplications.id, contractId: costApplications.contractId, number: costApplications.number, kind: costApplications.kind, docNumber: costApplications.docNumber })
        .from(costApplications).where(eq(costApplications.contractId, contractId));
      // The number typed is the printed one; older callers send it as `number`.
      const typed = Number(b.docNumber ?? b.number);
      const { seq: number, doc } = newAppNumbers(kind, Number.isFinite(typed) && typed > 0 ? typed : null, existing);
      const docs = docNumbers(existing);
      if (existing.some((a) => (a.kind === 'invoice') === (kind === 'invoice') && docs.get(a.id) === doc)) {
        return res.status(409).json({ message: `${kind === 'invoice' ? 'Invoice' : 'Pay App'} ${String(doc).padStart(3, '0')} already exists on this contract. Open it to edit it.` });
      }
      const [row] = await db.insert(costApplications).values({
        contractId, number, docNumber: doc,
        contractorG702: normalizeContractorG702(b.contractorG702),
        contractorG703: normalizeContractorG703(b.contractorG703),
        retainageAdjCents: Number.isFinite(Number(b.retainageAdj)) && Math.abs(Number(b.retainageAdj)) >= 0.005 ? Math.round(Number(b.retainageAdj) * 100) : null,
        retainageAdjNote: Number.isFinite(Number(b.retainageAdj)) && Math.abs(Number(b.retainageAdj)) >= 0.005 ? String(b.retainageAdjNote || 'Rounding').slice(0, 200) : null,
        kind,
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
      if (b.contractorG702 !== undefined) patch.contractorG702 = normalizeContractorG702(b.contractorG702);
      if (b.contractorG703 !== undefined) patch.contractorG703 = normalizeContractorG703(b.contractorG703);
      if (b.retainageAdj !== undefined) {
        const v = Number(b.retainageAdj);
        patch.retainageAdjCents = b.retainageAdj === null || b.retainageAdj === '' || !Number.isFinite(v) || Math.abs(v) < 0.005 ? null : Math.round(v * 100);
        patch.retainageAdjNote = patch.retainageAdjCents == null ? null : String(b.retainageAdjNote || 'Rounding').slice(0, 200);
      }
      if (b.docNumber !== undefined && b.docNumber !== null && b.docNumber !== '') {
        const doc = Math.floor(Number(b.docNumber));
        if (!(doc >= 1)) return res.status(400).json({ message: 'Enter a number.' });
        const others = await db.select({ id: costApplications.id, contractId: costApplications.contractId, number: costApplications.number, kind: costApplications.kind, docNumber: costApplications.docNumber })
          .from(costApplications).where(eq(costApplications.contractId, appRow.contractId));
        const docs = docNumbers(others);
        if (others.some((a) => a.id !== id && (a.kind === 'invoice') === (appRow.kind === 'invoice') && docs.get(a.id) === doc)) {
          return res.status(409).json({ message: `${appRow.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${String(doc).padStart(3, '0')} already exists on this contract.` });
        }
        patch.docNumber = doc;
      }
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
    if (b.party !== undefined) out.party = b.party === 'gc' || b.party === 'sub' ? b.party : null;
    if (b.payAppDue !== undefined) out.payAppDueCents = b.payAppDue === null || b.payAppDue === '' ? null : toCents(b.payAppDue);
    return out;
  };

  /**
   * Put one pay app's conditionals, or its unconditionals, in the order given.
   * An unconditional that is only expected so far is saved first, unchanged.
   */
  app.post('/api/cost-applications/:id/waivers/order', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [a] = await db.select().from(costApplications).where(eq(costApplications.id, id));
      if (!a) return res.status(404).json({ message: 'Pay app not found' });
      const [c] = await db.select().from(costContracts).where(eq(costContracts.id, a.contractId));
      const kind = req.body?.kind === 'unconditional' ? 'unconditional' : 'conditional';
      const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [];
      const mine = await db.select({ id: costWaivers.id }).from(costWaivers)
        .where(and(eq(costWaivers.applicationId, id), eq(costWaivers.kind, kind)));
      const ok = new Set(mine.map((w) => w.id));
      let i = 0;
      for (const r of rows) {
        let wid = Number(r?.id) || null;
        if (wid && !ok.has(wid)) return res.status(400).json({ message: 'That waiver is not on this pay app.' });
        if (!wid) {
          if (kind !== 'unconditional') continue;
          const [row] = await db.insert(costWaivers).values({
            projectId: c.projectId, contractId: a.contractId, applicationId: id, kind,
            fromWaiverId: r?.fromWaiverId ? Number(r.fromWaiverId) : null, received: false,
            ...waiverValues({ vendor: r?.vendor, amount: r?.amount ?? 0 }, false), createdBy: who(req),
          }).returning();
          wid = row.id;
        }
        await db.update(costWaivers).set({ sortOrder: i++ }).where(eq(costWaivers.id, wid));
      }
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof UserError) return res.status(400).json({ message: e.message });
      fail(res, e, 'reorder the waivers');
    }
  });

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
      // Moved to the pay app it belongs with (an unconditional entered on the pay app it releases).
      if (req.body?.applicationId !== undefined || req.body?.fromWaiverId !== undefined) {
        const [cur] = await db.select().from(costWaivers).where(eq(costWaivers.id, id));
        if (!cur) return res.status(404).json({ message: 'Waiver not found' });
        if (req.body?.applicationId !== undefined) {
          const [to] = await db.select().from(costApplications).where(eq(costApplications.id, Number(req.body.applicationId)));
          if (!to || to.contractId !== cur.contractId) return res.status(400).json({ message: 'That pay app is not on this contract.' });
          patch.applicationId = to.id; patch.sortOrder = null;
        }
        if (req.body?.fromWaiverId !== undefined) {
          const fid = req.body.fromWaiverId == null ? null : Number(req.body.fromWaiverId);
          if (fid) {
            const [from] = await db.select().from(costWaivers).where(eq(costWaivers.id, fid));
            if (!from || from.contractId !== cur.contractId || from.kind !== 'conditional') return res.status(400).json({ message: 'That conditional is not on this contract.' });
          }
          patch.fromWaiverId = fid;
        }
      }
      if (!Object.keys(patch).length) return res.status(400).json({ message: 'Nothing to change.' });
      if (patch.documentId !== undefined) {
        if (patch.documentId == null) {
          // Unlinked (the wrong file): it isn't in hand any more, unless told otherwise.
          if (req.body?.received === undefined) patch.received = false;
        } else {
          // One file, one waiver: take it off any other waiver, tag it, and count this one received.
          await db.update(costWaivers).set({ documentId: null, received: false }).where(eq(costWaivers.documentId, patch.documentId));
          if (req.body?.received === undefined) patch.received = true;
        }
      }
      const [row] = await db.update(costWaivers).set(patch).where(eq(costWaivers.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'Waiver not found' });
      if (patch.documentId) await db.update(costDocuments).set({ docType: row.kind, vendor: null }).where(eq(costDocuments.id, patch.documentId));
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
      if (b.vendor !== undefined) patch.vendor = b.vendor ? String(b.vendor).trim().slice(0, 200) || null : null;
      if (!Object.keys(patch).length) return res.status(400).json({ message: 'Nothing to change.' });
      // Retagged as something other than a waiver: no longer any waiver's file.
      if (patch.docType !== undefined && patch.docType !== 'conditional' && patch.docType !== 'unconditional') {
        await db.update(costWaivers).set({ documentId: null, received: false }).where(eq(costWaivers.documentId, id));
      }
      const [row] = await db.update(costDocuments).set(patch).where(eq(costDocuments.id, id)).returning();
      if (!row) return res.status(404).json({ message: 'File not found' });
      res.json(row);
    } catch (e) { fail(res, e, 'update the file'); }
  });

  /**
   * One pay app's package as a zip, named so it can be followed without
   * opening it:  Tenant - Property - Contractor - Pay App 02.zip
   *   1 Pay Applications/   00 GC - G702-G703, then each sub's pay app in waiver order
   *   2 Conditional Waivers (Pay App 02)/  ABC Plumbing - Conditional - Pay App 02 - $40,000.00.pdf
   *   3 Unconditional Waivers (Pay App 01)/
   *   4 Invoices & Backup/
   *   5 Other/
   *   00 Contents.txt   — what's in it, and any waiver still outstanding
   */
  /**
   * One pay app's package, ready to write into a zip (at its root, or under a folder when several
   * go to the lender together). { error } when there's nothing to package.
   */
  async function preparePackage(id: number): Promise<{ error: string; status: number } | { zipName: string; folderName: string; write: (zip: archiver.Archiver, root: string) => Promise<void> }> {
    {
      const [a] = await db.select().from(costApplications).where(eq(costApplications.id, id));
      if (!a) return { error: 'Pay app not found', status: 404 };
      const [c] = await db.select().from(costContracts).where(eq(costContracts.id, a.contractId));
      const [project] = await db.select().from(costProjects).where(eq(costProjects.id, c.projectId));
      const property: any = project.propertyId ? await storage.getProperty(project.propertyId).catch(() => undefined) : undefined;
      const allApps = await db.select({ id: costApplications.id, contractId: costApplications.contractId, number: costApplications.number, kind: costApplications.kind, docNumber: costApplications.docNumber })
        .from(costApplications).where(eq(costApplications.contractId, a.contractId));
      const dn = docNumbers(allApps);
      const waivers = (await db.select().from(costWaivers).where(eq(costWaivers.contractId, a.contractId))).map((w) => ({
        id: w.id, contractId: w.contractId, applicationId: w.applicationId, kind: w.kind as Waiver['kind'], vendor: w.vendor,
        amount: dollars(w.amountCents), fromWaiverId: w.fromWaiverId ?? null, received: w.received, notNeeded: w.notNeeded, documentId: w.documentId ?? null,
        sortOrder: w.sortOrder ?? null, party: (w.party === 'gc' || w.party === 'sub') ? w.party as 'gc' | 'sub' : null,
      }));
      const prev = previousApp({ id: a.id, contractId: a.contractId, number: a.number }, allApps);
      const ck = waiverChecklist(a.id, allApps, waivers, c.counterparty);
      const docs = await db.select().from(costDocuments).where(and(eq(costDocuments.applicationId, a.id), isNull(costDocuments.deletedAt)));
      const payRows = payAppVendors(ck.conditionals, c.counterparty);
      const waiverDocIds = new Set(waivers.filter((w) => w.applicationId === a.id && w.documentId).map((w) => w.documentId!));
      const extra = waiverDocIds.size
        ? (await db.select().from(costDocuments).where(and(inArray(costDocuments.id, Array.from(waiverDocIds)), isNull(costDocuments.deletedAt)))).filter((d) => !docs.some((x) => x.id === d.id))
        : [];
      // Change orders approved on this pay app (its G702 "this period"): their executed copies go in too.
      const bundleForPaid = await loadProjectBundle(c.projectId).catch(() => null);
      const coRows = bundleForPaid ? cosOnPayApp(coLog(bundleForPaid.changeOrders as any, bundleForPaid.sovLines as any, bundleForPaid.documents as any), c.id, a.number) : [];
      const coDocOf = new Map<number, (typeof coRows)[number]>();
      for (const r of coRows) for (const f of r.files) coDocOf.set(f.id, r);
      const coDocs = coDocOf.size
        ? (await db.select().from(costDocuments).where(and(inArray(costDocuments.id, Array.from(coDocOf.keys())), isNull(costDocuments.deletedAt)))).filter((d) => !docs.some((x) => x.id === d.id) && !extra.some((x) => x.id === d.id))
        : [];
      const all = [...docs, ...extra, ...coDocs];
      if (!all.length) return { error: 'No files on this pay app yet.', status: 404 };

      const safe = (s: string) => String(s ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
      const nn = (n: number) => String(n).padStart(3, '0');
      const label = a.kind === 'invoice' ? 'Invoice' : 'Pay App';
      const zipName = safe([project.tenantName, property?.name, c.counterparty, `${label} ${nn(dn.get(a.id)!)}`].filter(Boolean).join(' - ')) + '.zip';
      const ext = (n: string) => (n.includes('.') ? n.slice(n.lastIndexOf('.')) : '');
      const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      const folder: Record<string, string> = {
        g702: '1 Pay Applications',
        sub_pay_app: '1 Pay Applications',
        conditional: `2 Conditional Waivers (${label} ${nn(dn.get(a.id)!)})`,
        unconditional: `3 Unconditional Waivers (${prev ? `Pay App ${nn(dn.get(prev.id)!)}` : 'prior'})`,
        invoice: '4 Invoices & Backup',
        other: '5 Other',
        change_order: '6 Change Orders',
      };

      const folderName = safe(`${label} ${nn(dn.get(a.id)!)}`);
      const write = async (zip: archiver.Archiver, root: string) => {
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
        const coOf = coDocOf.get(d.id);
        if (coOf) {
          const zipPath = unique(`${root}${folder.change_order}/${safe(coOf.number)}${coOf.title ? ` - ${safe(coOf.title)}` : ''} - ${money(coOf.amount)}${ext(d.originalName)}`);
          let buf: Buffer | null = null;
          if (d.storage === 'object') buf = await downloadFromObjectStorage(d.storageKey);
          else buf = await fsp.readFile(path.join(process.cwd(), 'uploads', d.storageKey)).catch(() => null);
          if (!buf) { missing.push(d.originalName); continue; }
          zip.append(buf, { name: zipPath });
          contents.push(zipPath);
          continue;
        }
        const type = w ? w.kind : (d.docType === 'conditional' || d.docType === 'unconditional' ? 'other' : (d.docType || 'g702'));
        let name: string;
        if (w) {
          const covers = w.kind === 'conditional' ? `${label} ${nn(dn.get(a.id)!)}` : prev ? `Pay App ${nn(dn.get(prev.id)!)}` : 'prior';
          // Numbered as arranged in the app, so the folder lists in the same order.
          const list: Array<{ id: number | null }> = w.kind === 'conditional' ? ck.conditionals : ck.unconditionals;
          const pos = list.findIndex((x) => x.id === w.id);
          name = `${pos >= 0 ? `${String(pos + 1).padStart(2, '0')} ` : ''}${safe(w.vendor)} - ${w.kind === 'conditional' ? 'Conditional' : 'Unconditional'} - ${covers} - ${money(w.amount)}${ext(d.originalName)}`;
        } else if (type === 'g702') {
          name = `00 ${safe(d.vendor || c.counterparty)} - GC - ${label} ${nn(dn.get(a.id)!)} - G702-G703${ext(d.originalName)}`;
        } else if (type === 'sub_pay_app') {
          const pos = payRows.findIndex((r) => r.party === 'sub' && d.vendor && sameVendor(r.vendor, d.vendor));
          name = `${String(pos >= 0 ? pos : 98).padStart(2, '0')} ${safe(d.vendor || 'Subcontractor')} - Sub Pay App - ${label} ${nn(dn.get(a.id)!)}${ext(d.originalName)}`;
        } else {
          name = `${label} ${nn(dn.get(a.id)!)} - ${safe(d.originalName)}`;
        }
        const zipPath = unique(`${root}${folder[type] ?? folder.other}/${name}`);
        let buf: Buffer | null = null;
        if (d.storage === 'object') buf = await downloadFromObjectStorage(d.storageKey);
        else buf = await fsp.readFile(path.join(process.cwd(), 'uploads', d.storageKey)).catch(() => null);
        if (!buf) { missing.push(d.originalName); continue; }
        zip.append(buf, { name: zipPath });
        contents.push(zipPath);
      }
      contents.push('', 'Lien waivers');
      // Subs indented under the GC (no GC/Sub tag — Adolfo, 2026-10-22).
      const tag = (r: { vendor: string; party?: 'gc' | 'sub' | null }) => (partyOf(r, c.counterparty) === 'gc' ? '' : '    ');
      const sums = (t: ReturnType<typeof waiverTotals>) => [
        `    Subcontractors (${t.subCount})  ${money(t.subs)}`,
        `    GC                  ${money(t.gc)}`,
        `    GC Less Subs        ${money(t.gap)}${t.gapPct != null ? `  (${t.gapPct.toFixed(1)}% of the GC's release)` : ''}`,
      ];
      for (const w of ck.conditionals) contents.push(`  Conditional   ${tag(w)}${w.vendor}  ${money(w.amount)}  ${w.notNeeded ? 'not needed' : w.received ? 'received' : 'OUTSTANDING'}`);
      for (const m of ck.missing) contents.push(`  Conditional   ${m.party === 'gc' ? '' : '    '}${m.vendor}  MISSING${m.lastAmount != null ? `  (${money(m.lastAmount)} last pay app)` : ''}`);
      if (ck.conditionals.length) contents.push(...sums(waiverTotals(ck.conditionals, c.counterparty)));
      // Unconditionals for a pay app we haven't paid in full yet can't exist — say so rather than OUTSTANDING.
      const paidOf = bundleForPaid ? paidOfFrom(bundleForPaid.payments, (aid) => { const x: any = bundleForPaid.applications.find((y: any) => y.id === aid); return x ? gcPaymentDue(x, bundleForPaid.waivers, c.counterparty).due : null; }) : undefined;
      const prevPaid = prev && paidOf ? paidOf(prev.id) : null;
      const waitNote = (u: { vendor: string; party?: 'gc' | 'sub' | null; expectedAmount: number | null }) => `PENDING FUNDING (${fundingNote(dn.get(prev!.id)!, prevPaid!, partyOf(u, c.counterparty), u.expectedAmount)})`;
      const waiting = !!prev && unpaid(prevPaid);
      for (const u of ck.unconditionals) contents.push(`  Unconditional ${tag(u)}${u.vendor}  ${money(u.amount)}  ${u.notNeeded ? 'not needed' : u.received ? 'received' : (waiting && u.source === 'expected' ? waitNote(u) : 'OUTSTANDING')}${u.edited ? `  (edited — expected ${u.expectedVendor} ${money(u.expectedAmount ?? 0)})` : ''}`);
      if (ck.unconditionals.length) contents.push(...sums(waiverTotals(ck.unconditionals, c.counterparty)));
      const earlier = waiverLog(allApps.map((x) => ({ ...x, docNumber: dn.get(x.id) ?? x.number })), waivers, () => c.counterparty, paidOf)
        .filter((r) => waiverOutstanding(r.status) && prev && (allApps.find((x) => x.id === r.appId)?.number ?? 0) < prev.number);
      if (earlier.length) {
        contents.push('', 'Still outstanding from earlier pay apps');
        for (const r of earlier) contents.push(`  Pay App ${nn(r.appNumber)}  ${r.vendor}  ${money(r.conditionalAmount)}  ${r.status.toUpperCase()}`);
      }
      if (coRows.length) {
        contents.push('', `Change orders approved on this pay app`);
        for (const r of coRows) contents.push(`  ${r.number}${r.title ? ` — ${r.title}` : ''}  ${money(r.amount)}  ${r.executed ? 'executed' : 'NOT EXECUTED (no signed copy on file)'}`);
      }
      if (missing.length) contents.push('', 'Could not be included (file not found in storage):', ...missing.map((m) => `  ${m}`));
      zip.append(contents.join('\r\n'), { name: `${root}00 Contents.txt` });
      };
      return { zipName, folderName, write };
    }
  }

  app.get('/api/cost-applications/:id/package', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const p = await preparePackage(id);
      if ('error' in p) return res.status(p.status).json({ message: p.error });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${p.zipName.replace(/"/g, '')}"`);
      const zip = archiver('zip', { zlib: { level: 6 } });
      zip.on('error', (err) => { console.error('[cost] package zip error', err); try { res.end(); } catch {} });
      zip.pipe(res);
      await p.write(zip, '');
      await zip.finalize();
    } catch (e) { if (!res.headersSent) fail(res, e, 'build the package'); }
  });

  /**
   * Several pay apps' packages in one zip for the lender: a folder each ("Pay App 05/…"),
   * each sorted the same way as a single package, with a contents sheet at the top.
   */
  app.get('/api/cost-projects/:id/packages', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [project] = await db.select().from(costProjects).where(eq(costProjects.id, id));
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const want = String(req.query.apps || '').split(',').map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
      const rows = await db.select({ id: costApplications.id, contractId: costApplications.contractId, number: costApplications.number })
        .from(costApplications).innerJoin(costContracts, eq(costContracts.id, costApplications.contractId)).where(eq(costContracts.projectId, id));
      const ids = rows.filter((r) => !want.length || want.includes(r.id)).sort((x, y) => x.contractId - y.contractId || x.number - y.number).map((r) => r.id);
      const ready: Array<{ zipName: string; folderName: string; write: (zip: archiver.Archiver, root: string) => Promise<void> }> = [];
      const skipped: string[] = [];
      for (const aid of ids) {
        const p = await preparePackage(aid);
        if ('error' in p) skipped.push(`${rows.find((r) => r.id === aid)?.number ?? aid}: ${p.error}`); else ready.push(p);
      }
      if (!ready.length) return res.status(404).json({ message: 'None of those pay apps have files yet.' });
      const property: any = project.propertyId ? await storage.getProperty(project.propertyId).catch(() => undefined) : undefined;
      const safe = (s: string) => String(s ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
      const span = ready.length === 1 ? ready[0].folderName : `${ready[0].folderName} to ${ready[ready.length - 1].folderName.replace(/^Pay App |^Invoice /, '')}`;
      const zipName = ready.length === 1 ? ready[0].zipName : safe([project.tenantName, property?.name, 'Pay App Packages', span].filter(Boolean).join(' - ')) + '.zip';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName.replace(/"/g, '')}"`);
      const zip = archiver('zip', { zlib: { level: 6 } });
      zip.on('error', (err) => { console.error('[cost] packages zip error', err); try { res.end(); } catch {} });
      zip.pipe(res);
      // Every executed change order on the job, in one folder, when asked for.
      const allCos = String(req.query.cos || '') === '1';
      const coLines: string[] = [];
      const bnd = allCos ? await loadProjectBundle(id) : null;
      if (bnd) {
        const rowsCo = coLog(bnd.changeOrders as any, bnd.sovLines as any, bnd.documents as any).filter((r) => r.status === 'approved');
        const ids = rowsCo.flatMap((r) => r.files.map((f) => f.id));
        const docRows = ids.length ? await db.select().from(costDocuments).where(and(inArray(costDocuments.id, ids), isNull(costDocuments.deletedAt))) : [];
        const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        const ext = (n: string) => (n.includes('.') ? n.slice(n.lastIndexOf('.')) : '');
        const used = new Set<string>();
        for (const r of rowsCo) {
          const cName = bnd.contracts.find((x: any) => x.id === r.contractId)?.counterparty ?? '';
          coLines.push(`  ${cName} — ${r.number}${r.title ? ` — ${r.title}` : ''}  ${money(r.amount)}  ${r.executed ? 'executed' : 'NOT EXECUTED (no signed copy on file)'}`);
          for (const f of r.files) {
            const d = docRows.find((x) => x.id === f.id); if (!d) continue;
            let buf: Buffer | null = null;
            if (d.storage === 'object') buf = await downloadFromObjectStorage(d.storageKey);
            else buf = await fsp.readFile(path.join(process.cwd(), 'uploads', d.storageKey)).catch(() => null);
            if (!buf) continue;
            let nm = `Change Orders/${safe(r.number)}${r.title ? ` - ${safe(r.title)}` : ''} - ${money(r.amount)}${ext(d.originalName)}`;
            let i = 2; while (used.has(nm.toLowerCase())) nm = nm.replace(/(\.[^.]*)?$/, ` (${i++})$1`);
            used.add(nm.toLowerCase());
            zip.append(buf, { name: nm });
          }
        }
        if (coLines.length) zip.append(['Change orders — all approved to date', '', ...coLines].join('\r\n'), { name: 'Change Orders/00 Change Order Log.txt' });
      }
      if (ready.length === 1) await ready[0].write(zip, '');
      else {
        const used = new Set<string>();
        for (const p of ready) {
          let f = p.folderName; let i = 2;
          while (used.has(f)) f = `${p.folderName} (${i++})`;
          used.add(f);
          await p.write(zip, `${f}/`);
        }
        zip.append([zipName.replace(/\.zip$/, ''), '', 'One folder per pay app, each with its own contents sheet:', ...ready.map((p) => `  ${p.folderName}`),
          ...(allCos ? ['', 'Change Orders/ — every approved change order to date, with its executed copy'] : []),
          ...(skipped.length ? ['', 'Left out (no files yet):', ...skipped.map((x) => `  Pay App ${String(x).padStart(3, '0')}`)] : [])].join('\r\n'), { name: '00 Contents.txt' });
      }
      await zip.finalize();
    } catch (e) { if (!res.headersSent) fail(res, e, 'build the packages'); }
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
        budgetCoId: req.body?.budgetCoId ? String(req.body.budgetCoId).slice(0, 40) : null,
        docType: DOC_TYPES.some(([k]) => k === req.body?.docType) ? String(req.body.docType) : null,
        vendor: req.body?.vendor ? String(req.body.vendor).trim().slice(0, 200) || null : null,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey: key,
        storage: where,
        uploadedBy: who(req),
      }).returning();
      // A file dropped on a waiver is that waiver: attach it and mark it received.
      const waiverId = num(req.body?.waiverId);
      // A new file on a waiver replaces the one it had; the old one stays in the package's files, untied, to retag or remove.
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
      // The real type and name, so every browser opens a PDF or photo in the tab and saves anything else under its own name.
      const type = doc.mimeType && doc.mimeType !== 'application/octet-stream' ? doc.mimeType : mimeFromName(doc.originalName);
      const ascii = doc.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
      res.setHeader('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`);
      res.setHeader('X-File-Name', encodeURIComponent(doc.originalName));
      res.setHeader('Access-Control-Expose-Headers', 'X-File-Name, Content-Disposition');
      if (doc.storage === 'object') {
        const served = await streamFromObjectStorage(doc.storageKey, res, undefined, type);
        if (!served) res.status(404).json({ message: 'The file record exists but Object Storage does not have it.' });
        return;
      }
      res.setHeader('Content-Type', type);
      res.sendFile(path.join(process.cwd(), 'uploads', doc.storageKey));
    } catch (e) { fail(res, e, 'fetch the file'); }
  });

  app.delete('/api/cost-documents/:id', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      // Into the Deleted Files bin: the record and the stored object stay until the bin is
      // emptied, so a wrong click can be restored (Adolfo, 2026-10-22).
      const [d] = await db.select().from(costDocuments).where(eq(costDocuments.id, id));
      if (!d) return res.status(404).json({ message: 'File not found' });
      if (d.deletedAt) return res.json({ ok: true });
      const links = await db.select({ id: costWaivers.id, received: costWaivers.received, kind: costWaivers.kind, vendor: costWaivers.vendor }).from(costWaivers).where(eq(costWaivers.documentId, id));
      const from = await fileLocation(d, links[0] ?? null);
      await db.transaction(async (tx) => {
        if (links.length) await tx.update(costWaivers).set({ documentId: null, received: false }).where(eq(costWaivers.documentId, id));
        await tx.update(costDocuments).set({ deletedAt: new Date(), deletedBy: who(req), deletedFrom: from, restoreLinks: links.length ? JSON.stringify(links.map((l) => ({ id: l.id, received: l.received }))) : null })
          .where(eq(costDocuments.id, id));
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'remove the file'); }
  });

  // ---- Deleted Files bin ------------------------------------------------------------
  // Files deleted before the bin existed are still in storage under cost/<project>/ with no
  // record; they're listed as "deleted earlier" and can be recovered or removed the same way.
  const earlierDeleted = async (projectId: number) => {
    const prefix = `cost/${projectId}/`;
    const known = new Set((await db.select({ k: costDocuments.storageKey }).from(costDocuments).where(eq(costDocuments.projectId, projectId))).map((r) => r.k));
    let objs: Array<{ key: string; size: number; created: string | null }> = [];
    if (process.env.PRIVATE_OBJECT_DIR) objs = await listObjectsWithMeta(prefix);
    else {
      const dir = path.join(process.cwd(), 'uploads', prefix);
      const names = await fsp.readdir(dir).catch(() => [] as string[]);
      for (const n of names) {
        const st = await fsp.stat(path.join(dir, n)).catch(() => null);
        if (st?.isFile()) objs.push({ key: prefix + n, size: st.size, created: st.mtime.toISOString() });
      }
    }
    return objs.filter((o) => !known.has(o.key)).map((o) => ({ ...o, name: o.key.slice(prefix.length).replace(/^[A-Za-z0-9_-]{10}-/, '') }));
  };
  const removeStored = async (key: string, where: string) => {
    if (where === 'object' && process.env.PRIVATE_OBJECT_DIR) return deleteFromObjectStorage(key);
    await fsp.unlink(path.join(process.cwd(), 'uploads', key)).catch(() => null);
    return true;
  };

  app.get('/api/cost-projects/:id/deleted-files', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const rows = await db.select().from(costDocuments).where(and(eq(costDocuments.projectId, id), isNotNull(costDocuments.deletedAt))).orderBy(desc(costDocuments.deletedAt));
      const earlier = await earlierDeleted(id).catch((e) => { console.error('[bin] list earlier', e); return []; });
      res.json({
        deleted: rows.map((d) => ({ id: d.id, name: d.originalName, size: d.sizeBytes ?? 0, mimeType: d.mimeType, deletedAt: d.deletedAt, deletedBy: d.deletedBy, from: d.deletedFrom, uploadedAt: d.createdAt })),
        earlier: earlier.sort((a, b) => String(b.created).localeCompare(String(a.created))),
      });
    } catch (e) { fail(res, e, 'list deleted files'); }
  });

  app.post('/api/cost-documents/:id/restore', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [d] = await db.select().from(costDocuments).where(eq(costDocuments.id, id));
      if (!d || !d.deletedAt) return res.status(404).json({ message: 'Not in the Deleted Files bin' });
      // Back where it was when that still exists; otherwise under Other.
      const exists = async (t: any, col: any, v: number | null) => (v == null ? true : (await db.select({ id: col }).from(t).where(eq(col, v))).length > 0);
      const patch: any = { deletedAt: null, deletedBy: null, deletedFrom: null, restoreLinks: null };
      if (!(await exists(costApplications, costApplications.id, d.applicationId))) patch.applicationId = null;
      if (!(await exists(costContracts, costContracts.id, d.contractId))) patch.contractId = null;
      if (!(await exists(costChangeOrders, costChangeOrders.id, d.changeOrderId))) patch.changeOrderId = null;
      if (!(await exists(costDirectCosts, costDirectCosts.id, d.directCostId))) patch.directCostId = null;
      const links: Array<{ id: number; received: boolean }> = (() => { try { return JSON.parse(d.restoreLinks || '[]'); } catch { return []; } })();
      await db.transaction(async (tx) => {
        await tx.update(costDocuments).set(patch).where(eq(costDocuments.id, id));
        for (const l of links) await tx.update(costWaivers).set({ documentId: id, received: true }).where(and(eq(costWaivers.id, l.id), isNull(costWaivers.documentId)));
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'restore the file'); }
  });

  app.post('/api/cost-projects/:id/deleted-files/recover', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const key = String(req.body?.key ?? '');
      const hit = (await earlierDeleted(id)).find((o) => o.key === key);
      if (!hit) return res.status(404).json({ message: 'That file is no longer in storage.' });
      const ext = hit.name.split('.').pop()?.toLowerCase() || '';
      const mime = ext === 'pdf' ? 'application/pdf' : /^(png|jpe?g|gif|webp)$/.test(ext) ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : null;
      await db.insert(costDocuments).values({ projectId: id, originalName: hit.name, mimeType: mime, sizeBytes: hit.size, storageKey: key,
        storage: process.env.PRIVATE_OBJECT_DIR ? 'object' : 'local', uploadedBy: who(req) });
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'recover the file'); }
  });

  app.delete('/api/cost-documents/:id/forever', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const [d] = await db.select().from(costDocuments).where(eq(costDocuments.id, id));
      if (!d || !d.deletedAt) return res.status(400).json({ message: 'Only a file in the Deleted Files bin can be deleted forever.' });
      await removeStored(d.storageKey, d.storage);
      await db.delete(costDocuments).where(eq(costDocuments.id, id));
      console.log(`[cost] file ${d.originalName} (${d.storageKey}) deleted forever by ${who(req)}`);
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'delete the file'); }
  });

  app.post('/api/cost-projects/:id/deleted-files/purge', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const key = String(req.body?.key ?? '');
      const hit = (await earlierDeleted(id)).find((o) => o.key === key);
      if (!hit) return res.status(404).json({ message: 'That file is no longer in storage.' });
      await removeStored(key, process.env.PRIVATE_OBJECT_DIR ? 'object' : 'local');
      console.log(`[cost] earlier-deleted file ${key} removed forever by ${who(req)}`);
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'delete the file'); }
  });

  /** Empty the bin: every deleted file on the project, and every earlier-deleted one, gone for good. */
  app.post('/api/cost-projects/:id/deleted-files/empty', ...canEdit, async (req, res) => {
    try {
      const id = intParam(req, 'id');
      if (id === null) return res.status(400).json({ message: 'Invalid ID' });
      const rows = await db.select().from(costDocuments).where(and(eq(costDocuments.projectId, id), isNotNull(costDocuments.deletedAt)));
      const earlier = await earlierDeleted(id);
      for (const d of rows) await removeStored(d.storageKey, d.storage);
      if (rows.length) await db.delete(costDocuments).where(inArray(costDocuments.id, rows.map((d) => d.id)));
      for (const o of earlier) await removeStored(o.key, process.env.PRIVATE_OBJECT_DIR ? 'object' : 'local');
      console.log(`[cost] bin emptied on project ${id} by ${who(req)}: ${rows.length} + ${earlier.length} earlier`);
      res.json({ ok: true, removed: rows.length + earlier.length });
    } catch (e) { fail(res, e, 'empty the bin'); }
  });
}


/** The dashboard for one project (admins): CM fee, vendor billings and schedule, each split to add up. */
export function dashboardFor(b: any): ProjectDashboard {
  const paid = feePaid(b.cmInvoices as any);
  const stream = (d: any, p: number) => ({ earned: d.earnedBilled?.fee ?? 0, earnedOnPaid: d.earnedPaid?.fee ?? 0, invoiced: d.feeInvoiced ?? 0, anticipated: d.projected?.fee ?? 0, paid: p });
  const cap = stream(b.cmInvoiceDrafts.capital, paid.fee);
  const ten = stream(b.cmInvoiceDrafts.tenant, paid.tenant);
  const pctOf = new Map(b.position.contracts.map((c: any) => [c.contractId, c.pctComplete]));
  return {
    fee: feeDonut([cap, ten]),
    feeByParty: { capital: feeDonut([cap]), tenant: feeDonut([ten]) },
    vendor: vendorDonut(b.position.totals),
    schedule: scheduleRows(b.contracts as any, (id) => Number(pctOf.get(id) ?? 0), todayEastern()),
    spent: b.summary.totals.toDate, budget: b.summary.totals.budget, committed: b.summary.totals.committed,
  };
}
