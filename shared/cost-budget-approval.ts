/**
 * Confirming a project's budget against the Lease Approval Form (LAF).
 *
 * The LAF is the company's source of truth for what a deal is allowed to
 * spend. It is built from the priced budget, but in a different shape: every
 * soft cost (design, CM fee, permits, testing, contingency) is folded into the
 * contractor lines pro rata, and the deal team sometimes cuts a line when the
 * deal is struck. Accordia, October 2026: priced $1,600,914, LAF $1,466,500 —
 * every line ×1.1775, and Office Expansion cut by $134,415.
 *
 *   DRAFT       the priced budget, copied from the RFP. Tracked, but not yet
 *               the number anyone is held to.
 *   LAF         its total (required) and its lines (optional). The gap
 *               between the priced total and the LAF total is the DEAL
 *               DISCOUNT.
 *   DISTRIBUTE  push any part of the discount onto budget lines. Whatever is
 *               not distributed stays on its own Deal Discount line, so the
 *               budget always totals to the LAF.
 *   CONFIRM     snapshot the result as the ORIGINAL budget, with who and when.
 *               Later edits are revisions; the original never changes.
 *
 * Pure: no database import, tested on its own.
 */
import type { BaselineLine } from './cost-tracking';

export const DEAL_DISCOUNT_KEY = '__deal_discount__';

export interface LafLine {
  description: string;
  amount: number;
  /** The budget line it corresponds to, or null when nothing matches. */
  key: string | null;
}

export interface DiscountAllocation {
  key: string;
  /** Positive takes money OFF the line. */
  amount: number;
}

export interface OriginalLine {
  key: string;
  description: string;
  bucket: string;
  budget: number;
}

export interface BudgetApproval {
  status: 'draft' | 'confirmed';
  /** The LAF's total, in dollars. null until it is entered. */
  lafTotal: number | null;
  lafLines: LafLine[];
  /**
   * Priced total less the LAF total, set when the LAF total is entered.
   * Stored rather than derived: once confirmed, adding a budget line is a
   * revision that raises the budget, not something the discount silently
   * swallows.
   */
  discount: number;
  allocations: DiscountAllocation[];
  confirmedAt: string | null;
  confirmedBy: string | null;
  original: OriginalLine[] | null;
  originalTotal: number | null;
  revisions: Array<{ at: string; by: string | null; total: number; note: string }>;
}

const num = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export function emptyApproval(): BudgetApproval {
  return {
    status: 'draft', lafTotal: null, lafLines: [], discount: 0, allocations: [],
    confirmedAt: null, confirmedBy: null, original: null, originalTotal: null, revisions: [],
  };
}

/** Whatever is stored, made whole. Old projects have nothing stored. */
export function normalizeApproval(raw: any): BudgetApproval {
  const a = emptyApproval();
  if (!raw || typeof raw !== 'object') return a;
  a.status = raw.status === 'confirmed' ? 'confirmed' : 'draft';
  a.lafTotal = raw.lafTotal == null || raw.lafTotal === '' ? null : r2(num(raw.lafTotal));
  a.lafLines = Array.isArray(raw.lafLines)
    ? raw.lafLines.map((l: any) => ({
      description: String(l?.description ?? '').trim(),
      amount: r2(num(l?.amount)),
      key: l?.key ? String(l.key) : null,
    })).filter((l: LafLine) => l.description || l.amount)
    : [];
  a.discount = r2(num(raw.discount));
  a.allocations = Array.isArray(raw.allocations)
    ? raw.allocations.map((x: any) => ({ key: String(x?.key ?? ''), amount: r2(num(x?.amount)) }))
      .filter((x: DiscountAllocation) => x.key && x.amount !== 0)
    : [];
  a.confirmedAt = raw.confirmedAt ? String(raw.confirmedAt) : null;
  a.confirmedBy = raw.confirmedBy ? String(raw.confirmedBy) : null;
  a.original = Array.isArray(raw.original) ? raw.original.map((o: any) => ({
    key: String(o.key), description: String(o.description ?? ''), bucket: String(o.bucket ?? 'misc'), budget: r2(num(o.budget)),
  })) : null;
  a.originalTotal = raw.originalTotal == null ? null : r2(num(raw.originalTotal));
  a.revisions = Array.isArray(raw.revisions) ? raw.revisions.slice(-200) : [];
  return a;
}

export function pricedTotal(baseline: readonly BaselineLine[]): number {
  return r2((baseline || []).reduce((s, b) => s + num(b.budget), 0));
}

/** How much of the discount is on lines, and how much is left on its own line. */
export function discountState(baseline: readonly BaselineLine[], a: BudgetApproval) {
  const keys = new Set((baseline || []).map((b) => b.key));
  const live = a.allocations.filter((x) => keys.has(x.key));
  const distributed = r2(live.reduce((s, x) => s + x.amount, 0));
  return {
    priced: pricedTotal(baseline),
    discount: a.discount,
    distributed,
    undistributed: r2(a.discount - distributed),
    /** Allocations pointing at a line that has since been removed. */
    orphaned: a.allocations.filter((x) => !keys.has(x.key)),
    approvedTotal: r2(pricedTotal(baseline) - a.discount),
  };
}

/**
 * The budget the project is measured against: each line less the discount put
 * on it, plus a Deal Discount line for whatever has not been put anywhere.
 * Always totals priced − discount, to the cent.
 */
export function effectiveBaseline(baseline: readonly BaselineLine[], a: BudgetApproval): BaselineLine[] {
  const byKey = new Map<string, number>();
  for (const x of a.allocations) byKey.set(x.key, (byKey.get(x.key) ?? 0) + x.amount);
  const out: BaselineLine[] = (baseline || []).map((b) => ({ ...b, budget: r2(num(b.budget) - (byKey.get(b.key) ?? 0)) }));
  const { undistributed } = discountState(baseline, a);
  if (Math.abs(undistributed) >= 0.005) {
    out.push({
      key: DEAL_DISCOUNT_KEY,
      description: undistributed > 0 ? 'Deal Discount (per LAF)' : 'Deal Premium (per LAF)',
      bucket: 'misc',
      budget: r2(-undistributed),
      tenantSharePct: 100,
    });
  }
  return out;
}

// ------------------------------------------------------------- LAF compare

const STOP = new Set(['the', 'and', 'for', 'with', 'area', 'total', 'additional', 'new']);
function words(s: string): Set<string> {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w)));
}
function similarity(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / Math.min(A.size, B.size);
}

/**
 * Match LAF lines to budget lines by their words, one to one, best first.
 * "Office Expansion (Additional 1,500 SF)" finds "Office Expansion (1,500 sf)".
 * A line already matched by hand keeps its match.
 */
export function matchLafLines(laf: readonly LafLine[], baseline: readonly BaselineLine[]): LafLine[] {
  const out = laf.map((l) => ({ ...l }));
  const taken = new Set(out.filter((l) => l.key).map((l) => l.key as string));
  const pairs: Array<{ i: number; key: string; s: number }> = [];
  out.forEach((l, i) => {
    if (l.key) return;
    for (const b of baseline) {
      if (b.key === DEAL_DISCOUNT_KEY) continue;
      const s = similarity(l.description, b.description);
      if (s >= 0.5) pairs.push({ i, key: b.key, s });
    }
  });
  pairs.sort((x, y) => y.s - x.s);
  const done = new Set<number>();
  for (const p of pairs) {
    if (done.has(p.i) || taken.has(p.key)) continue;
    out[p.i].key = p.key;
    done.add(p.i);
    taken.add(p.key);
  }
  return out;
}

export interface LafComparisonRow {
  description: string;
  key: string | null;
  budgetDescription: string | null;
  /** The budget line as priced, before soft costs are loaded. */
  priced: number;
  /** Priced, with the unmatched lines (soft costs) folded in pro rata — the LAF's shape. */
  pricedLoaded: number;
  laf: number;
  /** LAF less priced-loaded. Negative is a cut. */
  difference: number;
}

/**
 * Put the priced budget in the LAF's shape and line them up.
 *
 * The budget lines no LAF line matches — design, CM, permits, contingency —
 * are spread over the matched lines in proportion to their priced amounts.
 * That is how the LAF is built, so a line the deal team did not touch shows
 * no difference, and the one they cut stands out.
 */
export function compareLaf(lafLines: readonly LafLine[], baseline: readonly BaselineLine[]) {
  const byKey = new Map((baseline || []).filter((b) => b.key !== DEAL_DISCOUNT_KEY).map((b) => [b.key, b]));
  const matchedKeys = new Set(lafLines.map((l) => l.key).filter((k): k is string => !!k && byKey.has(k)));
  const matchedPriced = Array.from(matchedKeys).reduce((s, k) => s + num(byKey.get(k)!.budget), 0);
  const total = pricedTotal(Array.from(byKey.values()));
  const factor = matchedPriced > 0 ? total / matchedPriced : 1;

  const rows: LafComparisonRow[] = lafLines.map((l) => {
    const b = l.key ? byKey.get(l.key) : undefined;
    const priced = b ? num(b.budget) : 0;
    const loaded = r2(priced * factor);
    return {
      description: l.description, key: b ? b.key : null, budgetDescription: b ? b.description : null,
      priced: r2(priced), pricedLoaded: loaded, laf: r2(l.amount), difference: r2(l.amount - loaded),
    };
  });
  const lafSum = r2(lafLines.reduce((s, l) => s + num(l.amount), 0));
  const unmatchedLaf = rows.filter((r) => !r.key);
  return {
    rows,
    factor,
    pricedTotal: total,
    lafSum,
    /** Soft costs folded in: priced total less the matched lines. */
    loadedIn: r2(total - matchedPriced),
    unmatchedLaf,
    /**
     * Where the discount would go if every line's difference were taken as
     * the cut on that line. Lines within a dollar are left alone — the LAF
     * rounds to whole dollars.
     */
    suggested: rows
      .filter((r) => r.key && Math.abs(r.difference) >= 1)
      .map((r) => ({ key: r.key as string, amount: r2(-r.difference) })),
  };
}

/** The lines a confirmed budget is frozen as. */
export function snapshotOriginal(baseline: readonly BaselineLine[], a: BudgetApproval): { lines: OriginalLine[]; total: number } {
  const lines = effectiveBaseline(baseline, a).map((b) => ({ key: b.key, description: b.description, bucket: b.bucket, budget: r2(num(b.budget)) }));
  return { lines, total: r2(lines.reduce((s, l) => s + l.budget, 0)) };
}

// ----------------------------------------------------------------- roll-up

export interface RollUpRow {
  key: string;
  description: string;
  /** The line as priced. */
  priced: number;
  /** Its share of the soft costs. */
  softShare: number;
  /** Priced plus its share: the figure the tenant sees. */
  rolledUp: number;
}

/**
 * The budget the way the LAF shows it to the tenant: only the construction
 * (contractor) lines, with every other line — design, CM fee, permits,
 * testing, contingency — folded into them in proportion to their priced
 * amounts. The rolled-up lines total the priced budget exactly; the last
 * line takes the rounding cent.
 *
 * Line by line this is only a guide — the deal team may roll up differently.
 * The total is what has to tie.
 */
export function rollUp(baseline: readonly BaselineLine[]): { rows: RollUpRow[]; soft: number; total: number; factor: number } {
  const all = (baseline || []).filter((b) => b.key !== DEAL_DISCOUNT_KEY);
  let hard = all.filter((b) => b.bucket === 'contractor');
  if (hard.length === 0) hard = all; // nothing marked as construction — nothing to fold into
  const hardTotal = hard.reduce((s, b) => s + num(b.budget), 0);
  const total = r2(all.reduce((s, b) => s + num(b.budget), 0));
  const soft = r2(total - hardTotal);
  const factor = hardTotal > 0 ? total / hardTotal : 1;
  const rows: RollUpRow[] = hard.map((b) => {
    const priced = r2(num(b.budget));
    const rolled = r2(priced * factor);
    return { key: b.key, description: b.description, priced, softShare: r2(rolled - priced), rolledUp: rolled };
  });
  // Put the rounding cent on the largest line so the column adds to the total.
  const drift = r2(total - rows.reduce((s, r) => s + r.rolledUp, 0));
  if (rows.length && Math.abs(drift) >= 0.005) {
    const big = rows.reduce((m, r) => (Math.abs(r.priced) > Math.abs(m.priced) ? r : m), rows[0]);
    big.rolledUp = r2(big.rolledUp + drift);
    big.softShare = r2(big.softShare + drift);
  }
  return { rows, soft, total, factor };
}
