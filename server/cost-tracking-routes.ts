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
  costApplications, costApplicationLines, costDocuments,
} from '@shared/schema';
import { eq, inArray, like, desc } from 'drizzle-orm';
import {
  budgetVsActual, g702For, formatProjectNumber,
  type BaselineLine, type SovLine, type ChangeOrder, type Application, type AllocationMode,
} from '@shared/cost-tracking';
import { headIds, lineSplitWithHeads, isCoveredByHead } from '@shared/budget-totals';
import { resolveContractBucket } from './budget-by-contract';
import { backupToObjectStorage, streamFromObjectStorage } from './storage-backup';

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

const intParam = (req: Request, name: string) => {
  const v = parseInt(String(req.params[name]), 10);
  return Number.isFinite(v) ? v : null;
};
const who = (req: Request) => {
  const u: any = (req as any).user;
  return String(u?.email || u?.username || (req as any).userId || '');
};

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
      description: String(b?.description ?? '').trim() || 'Untitled line',
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
  const documents = await db.select().from(costDocuments)
    .where(eq(costDocuments.projectId, projectId)).orderBy(desc(costDocuments.createdAt));

  // To the pure model, in dollars.
  const baseline = (project.baseline || []) as BaselineLine[];
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

  const summary = budgetVsActual({ baseline, lines, changeOrders, applications });
  const g702 = Object.fromEntries(contracts.map((c) => {
    const nums = applications.filter((a) => a.contractId === c.id).map((a) => a.number);
    return [c.id, g702For(c.id, nums.length ? Math.max(...nums) : 0, { lines, changeOrders, applications })];
  }));

  return {
    project,
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
  };
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
      await db.delete(costApplications).where(eq(costApplications.id, id));
      res.json({ ok: true });
    } catch (e) { fail(res, e, 'delete the application'); }
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
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey: key,
        storage: where,
        uploadedBy: who(req),
      }).returning();
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
