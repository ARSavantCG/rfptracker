/**
 * A project's financial position in one object: what the Project Financial Summary
 * prints, and what a monthly snapshot keeps so the next summary can say what moved
 * and why (Adolfo, 2026-10-23). DB-free; built from the project bundle.
 */
import { coLog } from './co-log';
import { lineProgress } from './cost-tracking';

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Contingency {
  /** Budget lines counted as contingency (picked in settings, or found by name). */
  keys: string[];
  names: string[];
  original: number;
  /** Moved out to other lines or used to fund budget change orders. */
  movedOut: number;
  /** Spent against the contingency line itself (work completed and stored). */
  spent: number;
  used: number;
  remaining: number;
  /** used / original, and the project's work complete / committed, both 0–100. */
  usedPct: number;
  completePct: number;
  /** Contingency carried inside contracts (SOV lines named contingency): amount and billed. */
  inContracts: { amount: number; billed: number };
  /** True when the lines were found by name rather than picked. */
  auto: boolean;
}

export interface FinancialFigures {
  at: string;
  budget: number; committed: number; pending: number; projected: number;
  toDate: number; paid: number; owed: number; retainage: number;
  contingency: Contingency | null;
  cos: Array<{ id: number; number: string; title: string | null; status: string; amount: number; stage: string }>;
  apps: Array<{ id: number; label: string; due: number; open: number }>;
  rows: Array<{ key: string; description: string; budget: number; committed: number; pending: number }>;
}

export function financialFigures(b: any, today: string): FinancialFigures {
  const t = b.summary.totals;
  const P = b.position.totals;
  const cname = (cid: number) => b.contracts.find((c: any) => c.id === cid)?.counterparty ?? '';
  const rows = (b.summary.rows as any[]);

  // Contingency: the lines picked in settings, else any budget line named contingency.
  const picked: string[] = Array.isArray(b.project?.settings?.contingencyKeys) ? b.project.settings.contingencyKeys.map(String) : [];
  const cRows = picked.length ? rows.filter((r) => picked.includes(r.key)) : rows.filter((r) => /contingenc/i.test(r.description));
  let contingency: Contingency | null = null;
  if (cRows.length) {
    const original = r2(cRows.reduce((s, r) => s + (Number(r.original) || Number(r.budget) || 0), 0));
    const budgetNow = r2(cRows.reduce((s, r) => s + r.budget, 0));
    const movedOut = r2(Math.max(0, original - budgetNow));
    const spent = r2(cRows.reduce((s, r) => s + r.toDate, 0));
    const used = r2(movedOut + spent);
    const prog = lineProgress(b.applications);
    const cosById = new Map((b.changeOrders as any[]).map((c) => [c.id, c]));
    const cLines = (b.sovLines as any[]).filter((l) => /contingenc/i.test(l.description) && (l.changeOrderId == null || cosById.get(l.changeOrderId)?.status === 'approved'));
    contingency = {
      keys: cRows.map((r) => r.key), names: cRows.map((r) => r.description), original, movedOut, spent, used,
      remaining: r2(original - used),
      usedPct: original ? r2((used / original) * 100) : 0,
      completePct: t.committed ? r2((t.toDate / t.committed) * 100) : 0,
      inContracts: { amount: r2(cLines.reduce((s, l) => s + l.scheduledValue, 0)), billed: r2(cLines.reduce((s, l) => s + (prog.get(l.id)?.toDate ?? 0), 0)) },
      auto: !picked.length,
    };
  }

  const cos = coLog(b.changeOrders, b.sovLines, b.documents, today)
    .map((c) => ({ id: c.id, number: c.number, title: c.title, status: c.status, amount: r2(c.amount), stage: c.routing.label }));
  const apps = (b.position.applications as any[]).map((a) => ({
    id: a.applicationId, label: `${cname(a.contractId)} ${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${String(a.docNumber).padStart(3, '0')}`,
    due: r2(a.due), open: r2(a.open),
  }));
  return {
    at: today,
    budget: r2(t.budget), committed: r2(t.committed), pending: r2(t.pending), projected: r2(t.committed + t.pending),
    toDate: r2(t.toDate), paid: r2(P.paid ?? 0), owed: r2(P.owed ?? 0), retainage: r2(P.retainageHeld ?? 0),
    contingency, cos, apps,
    rows: rows.map((r) => ({ key: r.key, description: r.description, budget: r2(r.budget), committed: r2(r.committed), pending: r2(r.pending) })),
  };
}

/** What moved between a snapshot and now, and the change orders and pay apps behind it. */
export function figuresDiff(prev: FinancialFigures, now: FinancialFigures) {
  const d = (k: 'budget' | 'committed' | 'pending' | 'projected' | 'toDate' | 'paid' | 'owed' | 'retainage') => r2(now[k] - prev[k]);
  const before = new Map(prev.cos.map((c) => [c.id, c]));
  const newlyApproved = now.cos.filter((c) => c.status === 'approved' && before.get(c.id)?.status !== 'approved');
  const newPending = now.cos.filter((c) => c.status === 'pending' && !before.has(c.id));
  const rejected = now.cos.filter((c) => c.status === 'void' && before.get(c.id) && before.get(c.id)!.status !== 'void');
  const moved = now.cos.filter((c) => c.status === 'pending' && before.get(c.id)?.status === 'pending' && before.get(c.id)!.stage !== c.stage)
    .map((c) => ({ ...c, from: before.get(c.id)!.stage }));
  const changedAmount = now.cos.filter((c) => before.has(c.id) && Math.abs(before.get(c.id)!.amount - c.amount) >= 0.005 && c.status !== 'void')
    .map((c) => ({ ...c, was: before.get(c.id)!.amount }));
  const prevApps = new Map(prev.apps.map((a) => [a.id, a]));
  const newApps = now.apps.filter((a) => !prevApps.has(a.id));
  const paidOff = now.apps.filter((a) => prevApps.has(a.id) && prevApps.get(a.id)!.open > 0.005 && a.open <= 0.005);
  const prevRows = new Map(prev.rows.map((r) => [r.key, r]));
  const rowMoves = now.rows.map((r) => {
    const p = prevRows.get(r.key);
    return { description: r.description, budget: r2(r.budget - (p?.budget ?? 0)), projected: r2(r.committed + r.pending - ((p?.committed ?? 0) + (p?.pending ?? 0))) };
  }).filter((r) => Math.abs(r.budget) >= 0.005 || Math.abs(r.projected) >= 0.005)
    .sort((a, b) => Math.abs(b.projected) - Math.abs(a.projected));
  return {
    budget: d('budget'), committed: d('committed'), pending: d('pending'), projected: d('projected'),
    toDate: d('toDate'), paid: d('paid'), owed: d('owed'), retainage: d('retainage'),
    contingencyUsed: now.contingency && prev.contingency ? r2(now.contingency.used - prev.contingency.used) : null,
    newlyApproved, newPending, rejected, moved, changedAmount, newApps, paidOff, rowMoves,
  };
}
