/**
 * Cost tracking: what the work actually cost, against what was budgeted.
 *
 * Once a deal signs and the improvement is built, the money arrives in the
 * contractor's language — a schedule of values by trade: Plumbing, HVAC,
 * Electrical, General Conditions, Overhead and Fee. The budget was written in
 * ours: Office Area, Warehouse LED Lighting, Design, Permit Fees. This module
 * is the translation, so that at closeout "what did the office area really
 * cost" has an answer.
 *
 *   BASELINE        the budget, frozen when the project is opened. Each line
 *                   keeps its tenant share, so actuals split the same way the
 *                   budget did: what can be billed back, what is absorbed.
 *   CONTRACTS       one per counterparty (the GC, the architect, the permit
 *                   office). Each has SOV lines.
 *   CHANGE ORDERS   a header on the contract, with its OWN lines underneath —
 *                   cost of work, insurance, fee — exactly as a GC breaks one
 *                   out. A line with no change order is base contract.
 *   ALLOCATION      set once per SOV line, never per pay app:
 *                     direct  — to one or more budget lines by percentage
 *                               (Electrical: 70% Office Area, 30% Warehouse LED)
 *                     spread  — in proportion to the direct lines of its own
 *                               group. General Conditions, insurance and fee
 *                               are markups on the work, not a scope of their
 *                               own; a change order's fee spreads over that
 *                               change order's work.
 *   APPLICATIONS    pay apps and invoices. Per SOV line: work completed this
 *                   period (column E), materials presently stored (F, a
 *                   snapshot), retainage held to date (I, a snapshot).
 *
 * Money is never dropped. Anything that cannot be placed lands on an
 * Unallocated row, so every total on the report reconciles to the contracts.
 * That rule exists because this codebase has twice shipped a total that
 * quietly left money out.
 */

export const UNALLOCATED_KEY = '__unallocated__';

export type AllocationMode = 'direct' | 'spread' | 'unallocated';
export type ChangeOrderStatus = 'approved' | 'pending' | 'void';

export interface BaselineLine {
  /** Stable key: the evaluation line id it came from, or a generated one. */
  key: string;
  description: string;
  /** contractor | design | cm | misc — the Budget by Contract buckets. */
  bucket: string;
  /** What the work was budgeted to cost, all in (not the tenant's share). */
  budget: number;
  /** The tenant's share of this line, 0–100. */
  tenantSharePct: number;
}

export interface Allocation {
  baselineKey: string;
  pct: number;
}

export interface SovLine {
  id: number;
  contractId: number;
  /** null = base contract. */
  changeOrderId: number | null;
  scheduledValue: number;
  allocationMode: AllocationMode;
  allocations: Allocation[];
}

export interface ChangeOrder {
  id: number;
  contractId: number;
  status: ChangeOrderStatus;
  /**
   * First pay app the CO belongs on. Earlier apps' G702s leave it out of
   * lines 2, 3 and 9, as the contractor's did. Null/absent = every app.
   */
  startApp?: number | null;
}

/**
 * Which pay app each change order starts on: the number set on it; else the
 * first app that bills one of its lines; else the first app recorded after
 * the CO was; else the next app. Pure.
 */
export function changeOrderStarts(input: {
  changeOrders: readonly { id: number; contractId: number; startAppNumber?: number | null; createdAt?: string | Date | null }[];
  lines: readonly { id: number; changeOrderId: number | null }[];
  applications: readonly { contractId: number; number: number; createdAt?: string | Date | null; lines: readonly { sovLineId: number; workThisPeriod: number; storedToDate: number }[] }[];
}): Map<number, { start: number | null; source: 'set' | 'billed' | 'recorded' | 'next' | 'none' }> {
  const out = new Map<number, { start: number | null; source: 'set' | 'billed' | 'recorded' | 'next' | 'none' }>();
  const t = (d: string | Date | null | undefined) => (d ? new Date(d).getTime() : NaN);
  for (const co of input.changeOrders) {
    if (co.startAppNumber != null && co.startAppNumber > 0) { out.set(co.id, { start: co.startAppNumber, source: 'set' }); continue; }
    const mine = new Set(input.lines.filter((l) => l.changeOrderId === co.id).map((l) => l.id));
    const apps = input.applications.filter((a) => a.contractId === co.contractId).sort((a, b) => a.number - b.number);
    const billed = apps.find((a) => a.lines.some((l) => mine.has(l.sovLineId) && (n(l.workThisPeriod) !== 0 || n(l.storedToDate) !== 0)));
    if (billed) { out.set(co.id, { start: billed.number, source: 'billed' }); continue; }
    const after = apps.find((a) => t(a.createdAt) > t(co.createdAt));
    if (after) { out.set(co.id, { start: after.number, source: 'recorded' }); continue; }
    if (apps.length) { out.set(co.id, { start: apps[apps.length - 1].number + 1, source: 'next' }); continue; }
    out.set(co.id, { start: null, source: 'none' });
  }
  return out;
}

export interface ApplicationLine {
  sovLineId: number;
  /** Column E: work completed this period. */
  workThisPeriod: number;
  /** Column F: materials presently stored — a snapshot, not cumulative. */
  storedToDate: number;
  /** Column I: retainage held to date — a snapshot, not cumulative. */
  retainageToDate: number;
}

export interface Application {
  id: number;
  contractId: number;
  /** Ordering within the contract; the highest is the latest. */
  number: number;
  lines: ApplicationLine[];
  /**
   * An accepted adjustment to retainage held, entered on this pay app (dollars). It stays
   * in retainage held on every later pay app, so their line 7 keeps agreeing. Used for the
   * contractor's rounding (they round line by line) when it's accepted rather than chased.
   */
  retainageAdj?: number | null;
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : 0;
};
const round2 = (v: number) => Math.round(v * 100) / 100;

// ------------------------------------------------------------ what is owed

/** Is this line part of the committed contract? Void change orders are not. */
export function lineStatus(line: SovLine, cos: Map<number, ChangeOrder>): ChangeOrderStatus {
  if (line.changeOrderId == null) return 'approved';
  return cos.get(line.changeOrderId)?.status ?? 'pending';
}

/**
 * Work completed and stored to date, per SOV line, as of the latest
 * application on each contract.
 *
 *   completed to date = Σ work this period, across every application
 *   stored            = the latest application's figure (a snapshot)
 *   retainage held    = the latest application's figure (a snapshot)
 *
 * Summing column F across applications would count the same stored material
 * again every month it sat on site. Summing column I would do the same to
 * retainage. Only E accumulates.
 */
export function lineProgress(apps: readonly Application[]): Map<number, {
  completed: number; stored: number; toDate: number; retainage: number;
}> {
  const out = new Map<number, { completed: number; stored: number; toDate: number; retainage: number }>();
  const latestByContract = new Map<number, number>();
  for (const a of apps) {
    latestByContract.set(a.contractId, Math.max(latestByContract.get(a.contractId) ?? -Infinity, a.number));
  }
  for (const a of apps) {
    const isLatest = latestByContract.get(a.contractId) === a.number;
    for (const l of a.lines) {
      const cur = out.get(l.sovLineId) ?? { completed: 0, stored: 0, toDate: 0, retainage: 0 };
      cur.completed += n(l.workThisPeriod);
      if (isLatest) {
        cur.stored = n(l.storedToDate);
        cur.retainage = n(l.retainageToDate);
      }
      out.set(l.sovLineId, cur);
    }
  }
  Array.from(out.values()).forEach((v) => { v.toDate = v.completed + v.stored; });
  return out;
}

// --------------------------------------------------------------- allocation

/**
 * Where a direct line's money goes, as fractions that always total 1.
 *
 * Percentages that do not reach 100 leave the remainder Unallocated rather
 * than scaling the rest up: a mapping of 70% to Office Area and nothing else
 * means someone has not finished, not that Office Area gets it all.
 * Percentages over 100 are scaled down, because the alternative is money that
 * does not exist.
 */
export function directShares(line: SovLine, validKeys: Set<string>): Map<string, number> {
  const shares = new Map<string, number>();
  const usable = (line.allocations || []).filter((a) => validKeys.has(a.baselineKey) && n(a.pct) > 0);
  const total = usable.reduce((s, a) => s + n(a.pct), 0);
  if (total <= 0) {
    shares.set(UNALLOCATED_KEY, 1);
    return shares;
  }
  const scale = total > 100 ? 100 / total : 1;
  for (const a of usable) {
    shares.set(a.baselineKey, (shares.get(a.baselineKey) ?? 0) + (n(a.pct) * scale) / 100);
  }
  const placed = Array.from(shares.values()).reduce((s, v) => s + v, 0);
  if (placed < 1 - 1e-9) shares.set(UNALLOCATED_KEY, 1 - placed);
  return shares;
}

/**
 * The weights a spread line follows: its group's direct lines, by scheduled
 * value. A change order's fee follows that change order's work; base-contract
 * markups follow the base contract. A change order with nothing direct in it
 * — a fee-only CO, say — falls back to the base contract of the same
 * contract, and failing that, Unallocated.
 *
 * Weighting by scheduled value rather than by progress keeps the split the
 * same from one pay app to the next. Weighting by progress would move General
 * Conditions between budget lines every month for no reason anyone could see.
 */
function spreadWeights(
  line: SovLine,
  lines: readonly SovLine[],
  validKeys: Set<string>,
): Map<string, number> {
  const weigh = (group: readonly SovLine[]) => {
    const w = new Map<string, number>();
    for (const l of group) {
      if (l.allocationMode !== 'direct') continue;
      const sv = n(l.scheduledValue);
      if (sv === 0) continue;
      for (const [k, share] of Array.from(directShares(l, validKeys))) {
        if (k === UNALLOCATED_KEY) continue;
        w.set(k, (w.get(k) ?? 0) + sv * share);
      }
    }
    return w;
  };
  const sameContract = lines.filter((l) => l.contractId === line.contractId);
  let w = weigh(sameContract.filter((l) => (l.changeOrderId ?? null) === (line.changeOrderId ?? null)));
  if (w.size === 0 && line.changeOrderId != null) {
    w = weigh(sameContract.filter((l) => l.changeOrderId == null));
  }
  const total = Array.from(w.values()).reduce((s, v) => s + v, 0);
  const out = new Map<string, number>();
  if (total <= 0) {
    out.set(UNALLOCATED_KEY, 1);
    return out;
  }
  Array.from(w).forEach(([k, v]) => out.set(k, v / total));
  return out;
}

/** The fractions one line's money splits into. Always totals 1. */
export function lineShares(line: SovLine, lines: readonly SovLine[], validKeys: Set<string>): Map<string, number> {
  if (line.allocationMode === 'direct') return directShares(line, validKeys);
  if (line.allocationMode === 'spread') return spreadWeights(line, lines, validKeys);
  return new Map([[UNALLOCATED_KEY, 1]]);
}

/** Put an amount per SOV line onto budget lines. */
export function allocate(
  lines: readonly SovLine[],
  amountByLine: Map<number, number>,
  validKeys: Set<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const amount = n(amountByLine.get(line.id));
    if (amount === 0) continue;
    for (const [k, share] of Array.from(lineShares(line, lines, validKeys))) {
      out.set(k, (out.get(k) ?? 0) + amount * share);
    }
  }
  return out;
}

// ------------------------------------------------------- budget vs actual

export interface BudgetVsActualRow {
  key: string;
  description: string;
  bucket: string;
  budget: number;
  /** Base contract plus approved change orders. */
  committed: number;
  /** Change orders not yet approved. Exposure, not commitment. */
  pending: number;
  /** Work completed and stored to date. */
  toDate: number;
  retainageHeld: number;
  /** Budget less committed. Positive is under budget. */
  variance: number;
  tenantSharePct: number;
  /** Committed, split the way the budget line is split. */
  committedTenant: number;
  committedOutstanding: number;
}

export interface BudgetVsActual {
  rows: BudgetVsActualRow[];
  totals: Omit<BudgetVsActualRow, 'key' | 'description' | 'bucket' | 'tenantSharePct'>;
  /** Σ scheduled value of committed lines — what the rows must add back to. */
  contractCommitted: number;
  contractToDate: number;
  /** True when the rows add back to the contracts, to the cent. */
  reconciles: boolean;
}

export function budgetVsActual(input: {
  baseline: readonly BaselineLine[];
  lines: readonly SovLine[];
  changeOrders: readonly ChangeOrder[];
  applications: readonly Application[];
  /**
   * Costs with no contract behind them — a permit fee on the card, parking.
   * Committed and spent the moment they are paid, on the budget line chosen,
   * or Unallocated if none is.
   */
  directCosts?: ReadonlyArray<{ key: string | null; amount: number }>;
}): BudgetVsActual {
  const baseline = input.baseline || [];
  const validKeys = new Set(baseline.map((b) => b.key));
  const cos = new Map((input.changeOrders || []).map((c) => [c.id, c]));
  const live = (input.lines || []).filter((l) => lineStatus(l, cos) !== 'void');

  const committedLines = live.filter((l) => lineStatus(l, cos) === 'approved');
  const pendingLines = live.filter((l) => lineStatus(l, cos) === 'pending');
  const progress = lineProgress(input.applications || []);

  const sv = (ls: readonly SovLine[]) => new Map(ls.map((l) => [l.id, n(l.scheduledValue)] as [number, number]));
  // Spread weights are computed across ALL live lines so a pending CO's fee
  // follows that CO's own work, not the base contract's.
  const allocOver = (subset: readonly SovLine[], amounts: Map<number, number>) => {
    const ids = new Set(subset.map((l) => l.id));
    const filtered = new Map<number, number>(Array.from(amounts).filter(([id]) => ids.has(id)));
    return allocate(live, filtered, validKeys);
  };

  const committed = allocOver(committedLines, sv(committedLines));
  const pending = allocOver(pendingLines, sv(pendingLines));
  const toDate = allocOver(live, new Map<number, number>(Array.from(progress).map(([id, p]) => [id, p.toDate] as [number, number])));
  const retainage = allocOver(live, new Map<number, number>(Array.from(progress).map(([id, p]) => [id, p.retainage] as [number, number])));
  let directTotal = 0;
  for (const d of input.directCosts || []) {
    const amt = n(d.amount);
    if (amt === 0) continue;
    const k = d.key && validKeys.has(d.key) ? d.key : UNALLOCATED_KEY;
    committed.set(k, (committed.get(k) ?? 0) + amt);
    toDate.set(k, (toDate.get(k) ?? 0) + amt);
    directTotal += amt;
  }

  const row = (key: string, description: string, bucket: string, budget: number, pct: number): BudgetVsActualRow => {
    const c = round2(committed.get(key) ?? 0);
    return {
      key, description, bucket, budget: round2(budget),
      committed: c,
      pending: round2(pending.get(key) ?? 0),
      toDate: round2(toDate.get(key) ?? 0),
      retainageHeld: round2(retainage.get(key) ?? 0),
      variance: round2(budget - c),
      tenantSharePct: pct,
      committedTenant: round2((c * pct) / 100),
      committedOutstanding: round2(c - (c * pct) / 100),
    };
  };

  const rows = baseline.map((b) => row(b.key, b.description, b.bucket, n(b.budget), n(b.tenantSharePct ?? 100)));
  const unplaced = [committed, pending, toDate, retainage].some((m) => Math.abs(m.get(UNALLOCATED_KEY) ?? 0) >= 0.005);
  if (unplaced && !rows.some((r) => r.key === UNALLOCATED_KEY)) {
    // Nothing budgeted here, and the tenant has agreed to pay none of it until
    // someone says where it belongs. So it counts as outstanding, not as cost
    // that can be billed back.
    rows.push(row(UNALLOCATED_KEY, 'Unallocated — map these lines to a budget line', 'misc', 0, 0));
  }

  const sum = (k: keyof BudgetVsActualRow) => round2(rows.reduce((s, r) => s + (r[k] as number), 0));
  const totals = {
    budget: sum('budget'), committed: sum('committed'), pending: sum('pending'), toDate: sum('toDate'),
    retainageHeld: sum('retainageHeld'), variance: sum('variance'),
    committedTenant: sum('committedTenant'), committedOutstanding: sum('committedOutstanding'),
  };
  const contractCommitted = round2(committedLines.reduce((s, l) => s + n(l.scheduledValue), 0) + directTotal);
  const contractToDate = round2(live.reduce((s, l) => s + (progress.get(l.id)?.toDate ?? 0), 0) + directTotal);
  return {
    rows, totals, contractCommitted, contractToDate,
    reconciles: Math.abs(totals.committed - contractCommitted) < 0.02
      && Math.abs(totals.toDate - contractToDate) < 0.02,
  };
}

// ------------------------------------------------------------ pay app math

export interface G702 {
  originalContractSum: number;
  netChangeOrders: number;
  contractSumToDate: number;
  completedAndStored: number;
  retainage: number;
  earnedLessRetainage: number;
  previousCertificates: number;
  currentPaymentDue: number;
  balanceToFinish: number;
  /**
   * The G702's change order summary box: approved on earlier pay apps vs
   * approved on this one, additions and deductions apart. A CO is "approved
   * on" its start app.
   */
  changeOrderSummary: {
    previous: { additions: number; deductions: number };
    thisPeriod: { additions: number; deductions: number };
    /** COs approved on this pay app. */
    thisPeriodIds: number[];
  };
}

/**
 * The summary page of a pay app, computed from its lines, so a typed-in
 * application can be checked against the contractor's own G702.
 *
 * Previous certificates = what the prior application said was earned less
 * retainage. Computed, not typed: the figure on a G702 is the place a
 * contractor's arithmetic most often goes wrong.
 */
export function g702For(contractId: number, upTo: number, input: {
  lines: readonly SovLine[];
  changeOrders: readonly ChangeOrder[];
  applications: readonly Application[];
}, opts?: { allChangeOrders?: boolean }): G702 {
  const cos = new Map((input.changeOrders || []).map((c) => [c.id, c]));
  // A CO is on app N's G702 only from its start app on — unless asked for the contract as it stands today.
  const onThisApp = (l: SovLine) => {
    if (opts?.allChangeOrders || l.changeOrderId == null) return true;
    const s = cos.get(l.changeOrderId)?.startApp;
    return s == null || s <= upTo;
  };
  const mine = (input.lines || []).filter((l) => l.contractId === contractId && lineStatus(l, cos) === 'approved' && onThisApp(l));
  const original = mine.filter((l) => l.changeOrderId == null).reduce((s, l) => s + n(l.scheduledValue), 0);
  const changes = mine.filter((l) => l.changeOrderId != null).reduce((s, l) => s + n(l.scheduledValue), 0);
  const appsFor = (cutoff: number) => (input.applications || [])
    .filter((a) => a.contractId === contractId && a.number <= cutoff);
  const earned = (cutoff: number) => {
    const p = lineProgress(appsFor(cutoff));
    let done = 0, held = 0;
    Array.from(p.values()).forEach((v) => { done += v.toDate; held += v.retainage; });
    for (const a of appsFor(cutoff)) held += n(a.retainageAdj);
    return { done, held };
  };
  const now = earned(upTo);
  const priorNumbers = appsFor(upTo - 1).map((a) => a.number);
  const prior = priorNumbers.length ? earned(Math.max(...priorNumbers)) : { done: 0, held: 0 };
  const sumToDate = original + changes;
  const earnedLess = now.done - now.held;
  // Change order summary: "this period" = started after the previous app, up to this one.
  const prevNumber = priorNumbers.length ? Math.max(...priorNumbers) : -Infinity;
  const perCo = new Map<number, number>();
  for (const l of mine) if (l.changeOrderId != null) perCo.set(l.changeOrderId, (perCo.get(l.changeOrderId) ?? 0) + n(l.scheduledValue));
  const summary = { previous: { additions: 0, deductions: 0 }, thisPeriod: { additions: 0, deductions: 0 }, thisPeriodIds: [] as number[] };
  for (const [id, v] of Array.from(perCo)) {
    const s = cos.get(id)?.startApp;
    const isThis = !opts?.allChangeOrders && s != null && s > prevNumber && s <= upTo;
    const bucket = isThis ? summary.thisPeriod : summary.previous;
    if (v >= 0) bucket.additions += v; else bucket.deductions += -v;
    if (isThis) summary.thisPeriodIds.push(id);
  }
  for (const b of [summary.previous, summary.thisPeriod]) { b.additions = round2(b.additions); b.deductions = round2(b.deductions); }
  const previous = prior.done - prior.held;
  return {
    originalContractSum: round2(original),
    netChangeOrders: round2(changes),
    contractSumToDate: round2(sumToDate),
    completedAndStored: round2(now.done),
    retainage: round2(now.held),
    earnedLessRetainage: round2(earnedLess),
    previousCertificates: round2(previous),
    currentPaymentDue: round2(earnedLess - previous),
    balanceToFinish: round2(sumToDate - earnedLess),
    changeOrderSummary: summary,
  };
}

/**
 * Two numbers per pay app or invoice. `number` is the order within the
 * contract — every "previous" and G702 line 7 is worked from it. `docNumber`
 * is what is printed on it, and pay apps and invoices count separately:
 * Invoice 1 can follow Pay App 3 on the same contract.
 */
type Numbered = { id: number; contractId: number; number: number; kind?: string | null; docNumber?: number | null };

/** The printed number of each app: as set, else its order (pay apps) or its place among the invoices. */
export function docNumbers(apps: readonly Numbered[]): Map<number, number> {
  const out = new Map<number, number>();
  const rank = new Map<string, number>();
  for (const a of [...apps].sort((x, y) => x.contractId - y.contractId || x.number - y.number)) {
    const k = `${a.contractId}|${a.kind === 'invoice' ? 'invoice' : 'pay_app'}`;
    rank.set(k, (rank.get(k) ?? 0) + 1);
    out.set(a.id, a.docNumber != null && a.docNumber > 0 ? a.docNumber : a.kind === 'invoice' ? rank.get(k)! : a.number);
  }
  return out;
}

/**
 * Numbers for a new pay app or invoice on a contract. The printed number is
 * the next of its kind unless one is given. The order number matches it on a
 * contract that is all pay apps (so Pay App 7 is 7 and an opening balance can
 * be 6); otherwise it goes after everything already recorded.
 */
export function newAppNumbers(kind: string, docNumber: number | null, apps: readonly Numbered[]): { seq: number; doc: number } {
  const isInv = kind === 'invoice';
  const docs = docNumbers(apps);
  const same = apps.filter((a) => (a.kind === 'invoice') === isInv);
  const doc = docNumber && docNumber > 0 ? Math.floor(docNumber) : same.reduce((m, a) => Math.max(m, docs.get(a.id)!), 0) + 1;
  const maxSeq = apps.reduce((m, a) => Math.max(m, a.number), 0);
  const pure = !isInv && !apps.some((a) => a.kind === 'invoice');
  const seq = pure && !apps.some((a) => a.number === doc) ? doc : maxSeq + 1;
  return { seq, doc };
}

/** PRJ-2026-001. */
export function formatProjectNumber(year: number, seq: number): string {
  return `PRJ-${year}-${String(seq).padStart(3, '0')}`;
}

// -------------------------------------------------------------- pasting

export interface PastedSovLine {
  itemNo: string | null;
  code: string | null;
  description: string;
  scheduledValue: number;
}

const MONEY_RE = /^\(?-?\$?\s*[\d,]+(\.\d{1,2})?\)?$/;
const ITEM_RE = /^\d+(\.\d+)*[a-z]?$/i;            // 1, 1.13, 2.3a
const CODE_RE = /^\d{2}-\d{4}(\.\d{2})?(\.[A-Z])?$/i; // 09-2100.00.S

const moneyOf = (cell: string): number => {
  const neg = /^\(.*\)$/.test(cell.trim()) || cell.trim().startsWith('-');
  const v = parseFloat(cell.replace(/[()$,\s-]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : 0;
};

/**
 * Lines pasted from Excel or copied off a G703, one per row.
 *
 * Tab-separated when it came from a spreadsheet; otherwise split on runs of
 * two or more spaces, which is how a PDF's columns come across. In each row:
 * the FIRST money-looking cell is the scheduled value (a G703 row carries
 * several amounts — previous, this period, to date — and column C is the
 * first of them); a leading "1.13" is the item number; "09-2100.00.S" is the
 * cost code; the text that is left is the description.
 *
 * Header rows, subtotal rows and blank rows are skipped: a row with no
 * amount, or one whose description says "total" or "subtotal" anywhere
 * ("Prime Contract Line Items Subtotals"), is not a line of work. Better to drop a header than to import "SCHEDULED VALUE" as a
 * $0 scope.
 */
export function parseSovPaste(text: string): { lines: PastedSovLine[]; skipped: string[] } {
  const lines: PastedSovLine[] = [];
  const skipped: string[] = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const row = raw.trim();
    if (!row) continue;
    const cells = (raw.includes('\t') ? raw.split('\t') : raw.split(/\s{2,}/))
      .map((c) => c.trim()).filter((c) => c !== '');
    // A cell is money when it looks like money: a $ or thousands comma, cents,
    // or a bare number of three digits or more. "1.13" in the first column is
    // an item number, not $1.13, whenever a later cell is also money.
    const looksLikeMoney = (c: string, i: number) => MONEY_RE.test(c) && (
      /[$,]/.test(c) || /\.\d{2}\)?$/.test(c) || (/^\d+$/.test(c) && c.length >= 3 && i > 0));
    const candidates = cells.map((c, i) => (looksLikeMoney(c, i) ? i : -1)).filter((i) => i >= 0);
    if (candidates.length > 1 && candidates[0] === 0 && ITEM_RE.test(cells[0])) candidates.shift();
    const moneyIdx = candidates.length ? candidates[0] : -1;
    if (moneyIdx < 0) { skipped.push(row); continue; }
    const before = cells.slice(0, moneyIdx);
    let itemNo: string | null = null;
    let code: string | null = null;
    const text: string[] = [];
    for (const c of before) {
      if (itemNo === null && text.length === 0 && code === null && ITEM_RE.test(c)) itemNo = c;
      else if (code === null && CODE_RE.test(c.split(/\s+/)[0])) {
        const [first, ...rest] = c.split(/\s+/);
        code = first;
        if (rest.length) text.push(rest.join(' '));
      } else text.push(c);
    }
    const description = text.join(' — ').trim();
    if (!description || /\b(sub)?totals?\b/i.test(description)) { skipped.push(row); continue; }
    lines.push({ itemNo, code, description, scheduledValue: moneyOf(cells[moneyIdx]) });
  }
  return { lines, skipped };
}

/**
 * Spread a total across lines to the cent, the way a G703 does: each line
 * gets its exact share rounded down, and the leftover cents go to the lines
 * with the largest remainders. The lines then add to the total exactly, where
 * rounding each line on its own can be a cent or two off.
 */
/**
 * Retainage at the contract rate, to the cent, rounded DOWN as contractors figure
 * it on the G702 ($7,642.0504 → $7,642.05; $7,642.045 → $7,642.04), so line 5
 * doesn't come out a penny over theirs (Adolfo, 2026-10-23). The tiny allowance
 * keeps float noise (…0.0499999) from dropping a whole cent.
 */
export function retainageCents(exact: number): number {
  const c = exact * 100;
  return (c >= 0 ? Math.floor(c + 1e-6) : -Math.floor(-c + 1e-6)) / 100;
}

export function spreadCents(items: ReadonlyArray<{ id: number; exact: number }>, total: number): Map<number, number> {
  const out = new Map<number, number>();
  if (!items.length) return out;
  const targetC = Math.round(total * 100);
  const sign = targetC < 0 ? -1 : 1;
  const parts = items.map((it) => {
    const c = Math.abs(it.exact * 100);
    const fl = Math.floor(c + 1e-7);
    return { id: it.id, fl, rem: c - fl };
  });
  let left = Math.abs(targetC) - parts.reduce((s, p) => s + p.fl, 0);
  // Largest remainder first; ties to the larger line.
  const order = [...parts].sort((a, b) => b.rem - a.rem || b.fl - a.fl);
  if (left >= 0) {
    for (let i = 0; left > 0 && order.length; i = (i + 1) % order.length) { order[i].fl += 1; left -= 1; }
  } else {
    const desc = [...parts].sort((a, b) => b.fl - a.fl);
    for (let i = 0; left < 0 && desc.length; i = (i + 1) % desc.length) { if (desc[i].fl > 0) { desc[i].fl -= 1; left += 1; } else if (desc.every((d) => d.fl === 0)) break; }
  }
  for (const p of parts) out.set(p.id, (sign * p.fl) / 100);
  return out;
}

/** The G702 lines worth checking against the contractor's, in order. */
export const G702_CHECK_LINES = [
  ['contractSumToDate', '3', 'Contract sum to date', 'a change order'],
  ['completedAndStored', '4', 'Completed and stored to date', 'the work or stored material'],
  ['retainage', '5', 'Retainage', 'retainage'],
  ['previousCertificates', '7', 'Less previous certificates', 'an earlier pay app'],
  ['currentPaymentDue', '8', 'Current payment due', ''],
] as const;
export type G702CheckKey = typeof G702_CHECK_LINES[number][0];
export type ContractorG702 = Partial<Record<G702CheckKey, number | null>>;

/** Clean typed or read figures: numbers or null, nothing else. */
export function normalizeContractorG702(raw: any): ContractorG702 | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: ContractorG702 = {};
  let any = false;
  for (const [k] of G702_CHECK_LINES) {
    const v = raw[k];
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
    if (Number.isFinite(n)) { out[k] = Math.round(n * 100) / 100; any = true; }
  }
  return any ? out : null;
}

/**
 * Ours against theirs, line by line. "match" needs line 8 entered and every
 * entered line within half a cent; the first line that is off says where to look.
 */
export function g702Check(ours: G702, theirs: ContractorG702 | null | undefined) {
  const lines = G702_CHECK_LINES.map(([key, no, label, hint]) => {
    const t = theirs?.[key];
    const o = ours[key];
    const diff = t == null ? null : Math.round((o - t) * 100) / 100;
    return { key, no, label, hint, ours: o, theirs: t ?? null, diff, ok: diff == null ? null : Math.abs(diff) < 0.005 };
  });
  const entered = lines.filter((l) => l.theirs != null);
  const due = lines.find((l) => l.key === 'currentPaymentDue')!;
  const off = entered.filter((l) => l.ok === false);
  const status: 'none' | 'match' | 'off' = !entered.length ? 'none' : off.length ? 'off' : due.theirs != null ? 'match' : 'none';
  // The first line off, in G702 order (line 8 only when nothing earlier explains it).
  const first = off.find((l) => l.key !== 'currentPaymentDue') ?? off[0] ?? null;
  return { lines, status, dueDiff: due.diff, first };
}

/**
 * Carry-forward check on the contractor's own G702s (Adolfo, 2026-10-23): their line 4
 * on this pay app less their line 4 on the previous one should be the work billed this
 * period; and their line 7 should be their previous line 6 (line 4 less line 5). When
 * they don't chain, one of their two G702s is wrong, whatever the G703 lines say.
 */
export interface CarryForward {
  /** Their line 4 now less their line 4 last pay app. */
  implied: number | null;
  /** Work billed this period on the G703 lines entered (ours: line 4 now less line 4 last pay app). */
  period: number | null;
  periodDiff: number | null;
  /** Their line 7 now, and their line 6 last pay app. */
  line7: number | null;
  prevLine6: number | null;
  line7Diff: number | null;
  status: 'ok' | 'off' | 'none';
}
export function carryForwardCheck(
  theirs: ContractorG702 | null | undefined,
  prevTheirs: ContractorG702 | null | undefined,
  oursNow: { completedAndStored: number } | null | undefined,
  oursPrev: { completedAndStored: number } | null | undefined,
): CarryForward {
  const t4 = theirs?.completedAndStored ?? null, p4 = prevTheirs?.completedAndStored ?? null, p5 = prevTheirs?.retainage ?? null;
  const implied = t4 != null && p4 != null ? round2(t4 - p4) : null;
  const period = oursNow && oursPrev ? round2(oursNow.completedAndStored - oursPrev.completedAndStored) : oursNow && !oursPrev ? round2(oursNow.completedAndStored) : null;
  const periodDiff = implied != null && period != null ? round2(implied - period) : null;
  const line7 = theirs?.previousCertificates ?? null;
  const prevLine6 = p4 != null && p5 != null ? round2(p4 - p5) : null;
  const line7Diff = line7 != null && prevLine6 != null ? round2(line7 - prevLine6) : null;
  const off = (d: number | null) => d != null && Math.abs(d) >= 0.005;
  const status = periodDiff == null && line7Diff == null ? 'none' : off(periodDiff) || off(line7Diff) ? 'off' : 'ok';
  return { implied, period, periodDiff, line7, prevLine6, line7Diff, status };
}
