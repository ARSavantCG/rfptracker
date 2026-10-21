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
import { UNALLOCATED_KEY, type BaselineLine } from './cost-tracking';

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

/**
 * A change to the budget after it is set — the tenant asks for more, or a
 * condition turns up. Each line raises (or lowers) one budget line. The CM
 * fee on it is added at the project's rate, frozen when the change order is
 * written. Billable says whether the tenant pays for it; a change order the
 * tenant can't be billed for still raises the budget, as outstanding share.
 *
 * Only approved change orders move the budget. Pending ones are shown as
 * exposure; void ones are kept for the record.
 */
export interface BudgetCOLine {
  key: string;
  description: string;
  /** Full cost on the budget line. */
  amount: number;
  /** Share of the cost the tenant pays, 0–100. */
  tenantPct: number;
  /** The vendor change order the line was priced from, if any. */
  fromCoId?: number | null;
}
/** A markup on the tenant's share: a % of it, or a fixed amount (e.g. permit fees charged at cost). */
export interface CoMarkup { key: string; label: string; pct: number; amount?: number | null }

/** The LAF's % lines (other than the CM fee): "Permit Fees (3.00%)", "Contingency (5.00%)". */
export function defaultMarkups(baseline: ReadonlyArray<{ key: string; description: string; bucket: string }>, cmKey: string | null): CoMarkup[] {
  return baseline
    .filter((b) => b.bucket !== 'cm' && b.key !== cmKey && b.key !== DEAL_DISCOUNT_KEY && b.key !== CO_CM_KEY)
    .map((b) => ({ b, m: String(b.description).match(/\((\d+(?:\.\d+)?)\s*%\)/) }))
    .filter((x) => x.m)
    .map((x) => ({ key: x.b.key, label: String(x.b.description).replace(/\s*\((\d+(?:\.\d+)?)\s*%\)\s*$/, '').trim() || x.b.description, pct: Number(x.m![1]) }));
}

/** A vendor (contract) change order behind a tenant change order, and the tenant's share of it. */
export interface BudgetCOLink {
  contractCoId: number;
  contractId: number;
  pct: number;
}
export interface BudgetCO {
  id: string;
  number: string;
  title: string;
  date: string | null;
  status: 'pending' | 'approved' | 'void';
  /** Default tenant share for typed lines: billable = 100%, not = 0%. */
  billable: boolean;
  lines: BudgetCOLine[];
  /** CM fee the tenant pays (at the tenant rate, on their cost plus markups). */
  cmFee: boolean;
  /** The tenant's CM fee rate, fixed when the change order was written. */
  cmFeePct: number;
  /** Markups on the tenant's share — the LAF's % lines (permit, contingency…). Each raises its budget line. */
  markups: CoMarkup[];
  /** The tenant's CM fee as a typed amount, overriding the rate (null = figured). */
  cmFeeAmount: number | null;
  /** CM fee the capital partner pays on all of this change order's work (the partner rate). */
  partnerFee: boolean;
  partnerFeePct: number;
  /** What the partner fee is on: all the work, or only the tenant's share (absorbed costs not charged). */
  /** What the capital partner's fee is figured on: all the work, the tenant's share, or only what we absorb (the difference). */
  partnerFeeBasis: 'all' | 'tenant' | 'absorbed';
  /** Vendor change orders priced into this one (any contracts). */
  links: BudgetCOLink[];
  /**
   * Where the part we absorb is paid from inside the budget (contingency, another line): moved
   * off those lines, so the budget only grows by the rest — which is new (supplemental) money.
   */
  fundedFrom: Array<{ key: string; amount: number }>;
  /** Credit to the tenant (a concession), absorbed by us. */
  credit: number;
  /** Earn the CM fee on our share too, charged to the capital partner. */
  cmOnAbsorbed: boolean;
  /** Cost of work as first estimated, kept when vendor prices replace it. */
  estimate: number | null;
  /** Why the budget changed — the story told against the original. */
  reason: CoReason;
  /** First link, kept for older code paths. */
  contractId: number | null;
  contractCoId: number | null;
}

export const CO_REASONS = [
  ['tenant', 'Tenant request'],
  ['scope', 'Missed scope'],
  ['unforeseen', 'Unforeseen condition'],
  ['design', 'Design error / omission'],
  ['code', 'Code / permit requirement'],
  ['owner', 'Owner request'],
  ['other', 'Other'],
] as const;
export type CoReason = typeof CO_REASONS[number][0];
export const reasonLabel = (r: string) => CO_REASONS.find(([k]) => k === r)?.[1] ?? 'Other';

export const CO_CM_KEY = '__co_cm_fee__';
export const SUPPLEMENTAL_CM_LABEL = 'Supplemental CM Fee';
export const UNASSIGNED_LABEL = 'Unallocated — not yet assigned to a budget line';
/** A change order line can wait unassigned while you work out where it belongs. */
export { UNALLOCATED_KEY as CO_UNASSIGNED_KEY };

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
  changeOrders: BudgetCO[];
  transfers: BudgetTransfer[];
}

/**
 * Money moved from one budget line to another — contingency to the office
 * expansion, say. The total doesn't change; the trail of why a line moved
 * is kept.
 */
export interface BudgetTransfer {
  id: string;
  fromKey: string;
  toKey: string;
  amount: number;
  note: string;
  date: string;
  by: string | null;
}

const num = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export function emptyApproval(): BudgetApproval {
  return {
    status: 'draft', lafTotal: null, lafLines: [], discount: 0, allocations: [],
    confirmedAt: null, confirmedBy: null, original: null, originalTotal: null, revisions: [], changeOrders: [], transfers: [],
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
  a.changeOrders = Array.isArray(raw.changeOrders) ? raw.changeOrders.map(normalizeCO).filter(Boolean) as BudgetCO[] : [];
  a.transfers = Array.isArray(raw.transfers) ? raw.transfers.map((t: any) => ({
    id: String(t?.id ?? ''), fromKey: String(t?.fromKey ?? ''), toKey: String(t?.toKey ?? ''),
    amount: r2(num(t?.amount)), note: String(t?.note ?? ''), date: String(t?.date ?? '').slice(0, 10), by: t?.by ? String(t.by) : null,
  })).filter((t: BudgetTransfer) => t.id && t.fromKey && t.toKey && t.fromKey !== t.toKey && t.amount > 0) : [];
  return a;
}

export function normalizeCO(raw: any): BudgetCO | null {
  if (!raw || typeof raw !== 'object') return null;
  const status = ['pending', 'approved', 'void'].includes(raw.status) ? raw.status : 'pending';
  const billable = raw.billable !== false;
  // Tenant shares keep the precision typed (e.g. 56.929894%), so the dollars land exactly; shown to two decimals.
  const pct = (v: any, dflt: number) => (v === undefined || v === null || v === '' ? dflt : Math.max(0, Math.min(100, Math.round(num(v) * 1e10) / 1e10)));
  const intOrNull = (v: any) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  // Older change orders carry one contractor link and an all-or-nothing billable flag.
  let links: BudgetCOLink[] = Array.isArray(raw.links) ? raw.links
    .map((l: any) => ({ contractCoId: intOrNull(l?.contractCoId), contractId: intOrNull(l?.contractId), pct: pct(l?.pct, 100) }))
    .filter((l: any) => l.contractCoId != null && l.contractId != null) : [];
  if (!Array.isArray(raw.links) && intOrNull(raw.contractCoId) != null) {
    links = [{ contractCoId: intOrNull(raw.contractCoId)!, contractId: intOrNull(raw.contractId) ?? 0, pct: billable ? 100 : 0 }];
  }
  const seen = new Set<number>();
  links = links.filter((l) => (seen.has(l.contractCoId) ? false : (seen.add(l.contractCoId), true)));
  // An older change order linked to one contractor CO was priced from it: say so on its lines.
  const legacyFrom = !Array.isArray(raw.links) && links.length === 1 ? links[0].contractCoId : null;
  return {
    id: String(raw.id || `co-${Date.now().toString(36)}`),
    number: String(raw.number ?? '').trim() || 'CO',
    title: String(raw.title ?? '').trim(),
    date: raw.date ? String(raw.date).slice(0, 10) : null,
    status,
    billable,
    lines: Array.isArray(raw.lines) ? raw.lines
      .map((l: any) => ({
        key: String(l?.key ?? ''), description: String(l?.description ?? '').trim(), amount: r2(num(l?.amount)),
        tenantPct: pct(l?.tenantPct, billable ? 100 : 0),
        fromCoId: intOrNull(l?.fromCoId) ?? legacyFrom,
      }))
      .filter((l: BudgetCOLine) => l.key && l.amount !== 0) : [],
    cmFee: raw.cmFee !== false,
    cmFeePct: Math.max(0, Math.min(100, num(raw.cmFeePct))),
    markups: Array.isArray(raw.markups) ? raw.markups
      .map((m: any) => ({
        key: String(m?.key ?? ''), label: String(m?.label ?? '').trim(), pct: Math.max(0, Math.min(100, Math.round(num(m?.pct) * 100) / 100)),
        amount: m?.amount !== undefined && m?.amount !== null && m?.amount !== '' ? r2(num(m.amount)) : null,
      }))
      .filter((m: CoMarkup) => m.key && (m.pct > 0 || m.amount != null)) : [],
    /** The tenant's CM fee typed as an amount (blank = figured from the rate). */
    cmFeeAmount: raw.cmFeeAmount !== undefined && raw.cmFeeAmount !== null && raw.cmFeeAmount !== '' ? r2(num(raw.cmFeeAmount)) : null,
    // Older change orders had no partner fee setting; they earn it at their own rate.
    partnerFee: raw.partnerFee !== undefined ? raw.partnerFee !== false : raw.cmOnAbsorbed === true,
    partnerFeePct: Math.max(0, Math.min(100, num(raw.partnerFeePct ?? raw.cmFeePct))),
    partnerFeeBasis: raw.partnerFeeBasis === 'tenant' ? 'tenant' : raw.partnerFeeBasis === 'absorbed' ? 'absorbed' : 'all',
    links,
    fundedFrom: Array.isArray(raw.fundedFrom) ? raw.fundedFrom
      .map((f: any) => ({ key: String(f?.key ?? ''), amount: Math.max(0, r2(num(f?.amount))) }))
      .filter((f: { key: string; amount: number }) => f.key && f.amount > 0) : [],
    credit: Math.max(0, r2(num(raw.credit))),
    cmOnAbsorbed: raw.cmOnAbsorbed === true,
    estimate: raw.estimate != null && raw.estimate !== '' ? r2(num(raw.estimate)) : null,
    reason: (CO_REASONS.some(([k]) => k === raw.reason) ? raw.reason : billable ? 'tenant' : 'other') as CoReason,
    contractId: links[0]?.contractId ?? null,
    contractCoId: links[0]?.contractCoId ?? null,
  };
}

/** A change order's cost of work, its CM fee, and the total. */
/**
 * A change order's money, split between the tenant and us.
 *   work         full cost of work (what the budget rises by, before fees)
 *   tenantWork   the tenant's share of it (each line × its tenant %)
 *   cm           CM fee on the tenant's share only
 *   cmAbsorbed   CM fee on our share, when it is charged to the capital partner
 *   tenant       what the tenant pays: tenantWork + cm − credit
 *   absorbed     what we fund: our share of the work + credit + cmAbsorbed
 *   total        budget increase: work + cm + cmAbsorbed  (= tenant + absorbed)
 */
export function coTotals(co: BudgetCO) {
  const work = r2(co.lines.reduce((s, l) => s + l.amount, 0));
  const tenantWork = r2(co.lines.reduce((s, l) => s + (l.amount * (l.tenantPct ?? 100)) / 100, 0));
  const ourWork = r2(work - tenantWork);
  // The tenant's markups, on their share of the cost.
  const markupLines = (co.markups || []).map((m) => ({ ...m, amount: m.amount != null ? r2(m.amount) : r2((tenantWork * m.pct) / 100), fixed: m.amount != null }));
  const markups = r2(markupLines.reduce((s, m) => s + m.amount, 0));
  const credit0 = r2(co.credit || 0);
  // Two CM fees: the tenant's (their rate, on their cost + markups less any credit — no fee on a discount)
  // and the capital partner's (on the work). The tenant's can be typed as an amount instead.
  const cmBase = r2(Math.max(0, tenantWork + markups - credit0));
  const cmFigured = co.cmFee ? r2((cmBase * co.cmFeePct) / 100) : 0;
  const cm = co.cmFee ? (co.cmFeeAmount != null ? r2(co.cmFeeAmount) : cmFigured) : 0;
  const partnerOn = co.partnerFeeBasis === 'tenant' ? tenantWork : co.partnerFeeBasis === 'absorbed' ? r2(work - tenantWork) : work;
  const cmAbsorbed = co.partnerFee ? r2((partnerOn * (co.partnerFeePct ?? 0)) / 100) : 0;
  const credit = r2(co.credit || 0);
  // The budget holds the work, the markups and the partner's fee; the tenant pays their share, markups and fee.
  const total = r2(work + markups + cmAbsorbed);
  const tenant = r2(tenantWork + markups + cm - credit);
  const absorbed = r2(total - tenant);
  // What each fee is figured on (0 when that fee is off).
  const partnerBase = co.partnerFee ? partnerOn : 0;
  const tenantFeeBase = co.cmFee ? cmBase : 0;
  // Paid from inside the budget (never more than we absorb); the budget grows only by the rest.
  const funded = r2(Math.min(Math.max(0, absorbed), (co.fundedFrom || []).reduce((s, f) => s + f.amount, 0)));
  const budgetIncrease = r2(total - funded);
  return { work, tenantWork, ourWork, markups, markupLines, cmBase, cmFigured, cm, cmAbsorbed, partnerFee: cmAbsorbed, credit, tenant, absorbed, total, partnerBase, tenantFeeBase, funded, budgetIncrease };
}

/** Approved change orders, summed. */
export function coSummary(cos: readonly BudgetCO[]) {
  const sum = (st: string, f: (t: ReturnType<typeof coTotals>) => number) => r2(cos
    .filter((c) => c.status === st)
    .reduce((s, c) => s + f(coTotals(c)), 0));
  return {
    // What change orders add to the budget: less what's paid from other lines inside it.
    approved: sum('approved', (t) => t.budgetIncrease),
    // A change order can be split: the tenant's part and ours are counted apart.
    approvedBillable: sum('approved', (t) => t.tenant),
    approvedAbsorbed: sum('approved', (t) => t.absorbed),
    approvedFunded: sum('approved', (t) => t.funded),
    pending: sum('pending', (t) => t.budgetIncrease),
  };
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
export function effectiveBaseline(baseline: readonly BaselineLine[], a: BudgetApproval, cmKey: string | null = null): BaselineLine[] {
  const byKey = new Map<string, number>();
  for (const x of a.allocations) byKey.set(x.key, (byKey.get(x.key) ?? 0) + x.amount);
  let out: BaselineLine[] = (baseline || []).map((b) => ({ ...b, budget: r2(num(b.budget) - (byKey.get(b.key) ?? 0)) }));
  out = applyTransfers(out, a.transfers || []);
  out = applyChangeOrders(out, a.changeOrders || [], cmKey);
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
export function snapshotOriginal(baseline: readonly BaselineLine[], a: BudgetApproval, cmKey: string | null = null): { lines: OriginalLine[]; total: number } {
  const lines = effectiveBaseline(baseline, a, cmKey).map((b) => ({ key: b.key, description: b.description, bucket: b.bucket, budget: r2(num(b.budget)) }));
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

/**
 * Approved change orders on top of the budget. Each line adds to its budget
 * line; the CM fee adds to the CM line (or a CM fee line of its own when the
 * budget has none). The tenant's share of a line is re-weighted: what the
 * tenant pays of the base, plus every billable change on it, over the new
 * total.
 */
export function applyChangeOrders(lines: BaselineLine[], cos: readonly BudgetCO[], cmKey: string | null): BaselineLine[] {
  const approved = cos.filter((c) => c.status === 'approved');
  if (!approved.length) return lines;
  const out = lines.map((l) => ({ ...l }));
  const tenantAmt = new Map(out.map((l) => [l.key, (num(l.budget) * num(l.tenantSharePct ?? 100)) / 100]));
  const ensure = (key: string, description: string, bucket: string) => {
    let row = out.find((l) => l.key === key);
    if (!row) {
      row = { key, description, bucket, budget: 0, tenantSharePct: 100 };
      out.push(row);
      tenantAmt.set(key, 0);
    }
    return row;
  };
  const add = (row: BaselineLine, amount: number, tenant: number) => {
    row.budget = r2(num(row.budget) + amount);
    tenantAmt.set(row.key, (tenantAmt.get(row.key) ?? 0) + tenant);
  };
  for (const co of approved) {
    const t = coTotals(co);
    for (const l of co.lines) {
      // Not yet assigned: it waits on the Unallocated row, where the vendors' unmapped cost lands too.
      const row = out.find((x) => x.key === l.key)
        ?? (l.key === UNALLOCATED_KEY
          ? ensure(UNALLOCATED_KEY, UNASSIGNED_LABEL, 'misc')
          : ensure(`__co_line_${l.key}`, `${l.description || 'Change order work'} (line removed)`, 'misc'));
      const tenantPart = (l.amount * (l.tenantPct ?? 100)) / 100;
      // A credit to the tenant comes off their share, spread over the lines they pay for.
      const creditPart = t.tenantWork ? (t.credit * tenantPart) / t.tenantWork : 0;
      add(row, l.amount, tenantPart - creditPart);
    }
    // Change order CM fees never touch the original CM fee line: they collect on
    // their own Supplemental CM Fee line, and only from change orders that ask for it.
    const cmRow = () => ensure(CO_CM_KEY, SUPPLEMENTAL_CM_LABEL, 'cm');
    // Markups raise their own budget lines; the tenant pays them.
    for (const m of t.markupLines) {
      if (!m.amount) continue;
      const row = out.find((x) => x.key === m.key) ?? ensure(`__co_line_${m.key}`, `${m.label || 'Markup'} (line removed)`, 'misc');
      add(row, m.amount, m.amount);
    }
    // The capital partner's fee is the budget's; the tenant's fee offsets it.
    if (t.cmAbsorbed) add(cmRow(), t.cmAbsorbed, Math.min(t.cmAbsorbed, t.cm));
    // A credit with nothing billed to the tenant lands on the CM row as our cost.
    if (t.credit && !t.tenantWork) add(cmRow(), 0, -t.credit);
    // Paid from other lines in the budget: moved off them (their tenant share kept in proportion).
    let left = t.funded;
    for (const f of co.fundedFrom || []) {
      const amt = r2(Math.min(f.amount, left));
      if (amt <= 0) break;
      const src = out.find((x) => x.key === f.key);
      if (!src) continue;
      const b = num(src.budget);
      add(src, -amt, b ? -(amt * (tenantAmt.get(src.key) ?? 0)) / b : 0);
      left = r2(left - amt);
    }
  }
  for (const row of out) {
    const b = num(row.budget);
    if (Math.abs(b) >= 0.005) row.tenantSharePct = Math.round(((tenantAmt.get(row.key) ?? 0) / b) * 100 * 10000) / 10000;
  }
  return out;
}

/** Net transfer on each budget line: positive in, negative out. */
export function transferNet(transfers: readonly BudgetTransfer[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of transfers) {
    m.set(t.fromKey, r2((m.get(t.fromKey) ?? 0) - t.amount));
    m.set(t.toKey, r2((m.get(t.toKey) ?? 0) + t.amount));
  }
  return m;
}

/** Move the money. A transfer touching a line that has since been removed is skipped whole, so nothing is lost on one side only. */
export function applyTransfers(lines: BaselineLine[], transfers: readonly BudgetTransfer[]): BaselineLine[] {
  if (!transfers.length) return lines;
  const keys = new Set(lines.map((l) => l.key));
  const net = transferNet(transfers.filter((t) => keys.has(t.fromKey) && keys.has(t.toKey)));
  return lines.map((l) => (net.has(l.key) ? { ...l, budget: r2(num(l.budget) + (net.get(l.key) ?? 0)) } : l));
}

// ------------------------------------------------------- revised budget

export type BudgetBreakdownRow = {
  key: string; description: string; bucket: string;
  /** As confirmed. Draft: priced less discount. */
  original: number;
  /** Edits made to the line after it was confirmed. */
  revisions: number;
  transfers: number;
  /** Approved budget change orders on the line (CM fee onto the CM line). */
  changeOrders: number;
  revised: number;
};

/**
 * Original → revised, line by line: what moved each line, so "why is this
 * line at $260k" reads off the row. Revised is the budget everything is
 * measured against; the four movements add back to it exactly.
 */
export function budgetBreakdown(baseline: readonly BaselineLine[], a: BudgetApproval, cmKey: string | null = null): BudgetBreakdownRow[] {
  const all = effectiveBaseline(baseline, a, cmKey);
  const noCo = effectiveBaseline(baseline, { ...a, changeOrders: [] }, cmKey);
  const bare = effectiveBaseline(baseline, { ...a, changeOrders: [], transfers: [] }, cmKey);
  const val = (rows: BaselineLine[], k: string) => num(rows.find((r) => r.key === k)?.budget);
  const confirmed = a.status === 'confirmed' && a.original != null;
  const orig = new Map((a.original || []).map((o) => [o.key, o]));
  const keys: string[] = all.map((r) => r.key);
  if (confirmed) for (const o of a.original!) if (!keys.includes(o.key)) keys.push(o.key);
  return keys.map((k) => {
    const row = all.find((r) => r.key === k);
    const o = orig.get(k);
    const revised = r2(val(all, k));
    const changeOrders = r2(val(all, k) - val(noCo, k));
    const transfers = r2(val(noCo, k) - val(bare, k));
    const original = confirmed ? r2(o?.budget ?? 0) : r2(val(bare, k));
    return {
      key: k, description: row?.description ?? o?.description ?? 'Removed line', bucket: row?.bucket ?? o?.bucket ?? 'misc',
      original, transfers, changeOrders, revised,
      revisions: r2(revised - original - transfers - changeOrders),
    };
  });
}

export const SUPPLEMENTAL_DEFAULT = 'Supplemental Funding';

/**
 * Where the revised budget's money comes from. The capital partner's
 * approved budget; the tenant, for change orders billed to them; and
 * supplemental funding for what is absorbed — approved absorbed change
 * orders now, and any projected cost beyond the revised budget.
 */
/**
 * Where the money comes from. The capital partner's approved budget and the
 * tenant (for change orders billed to them) come first. Supplemental funding is
 * only what those can't cover: what absorbed change orders (and anything else
 * over budget) leave short once the budget's surplus is used. While the work is
 * coming in under budget, absorbed change orders are paid from that surplus.
 *
 * What the project needs: each budget line at what's committed (+ pending) on
 * it once it has a contract — under or over budget — or at its budget before
 * change orders while nothing is committed yet; plus each approved change
 * order's markups, fees and any work not yet on a contract.
 */
export function fundingSources(rows: readonly BudgetBreakdownRow[], a: BudgetApproval,
  cost: { committed: number; pending: number; byKey?: ReadonlyMap<string, { committed: number; pending: number }> }) {
  const s = coSummary(a.changeOrders);
  const original = r2(rows.reduce((t, r) => t + r.original, 0));
  const revisions = r2(rows.reduce((t, r) => t + r.revisions, 0));
  const transfers = r2(rows.reduce((t, r) => t + r.transfers, 0));
  const revised = r2(rows.reduce((t, r) => t + r.revised, 0));
  const tenant = s.approvedBillable;
  const absorbed = s.approvedAbsorbed;
  const projectedCost = r2(cost.committed + cost.pending);
  const projectedOverrun = r2(Math.max(0, projectedCost - revised));
  const approved = a.changeOrders.filter((c) => c.status === 'approved');
  let need: number;
  // Contingency still unspent: the first place to move money from when a line runs over.
  let contingency = 0;
  const overLines: Array<{ key: string; description: string; over: number }> = [];
  if (cost.byKey) {
    const linesNeed = rows.filter((r) => r.key !== CO_CM_KEY).reduce((t, r) => {
      const pre = r.revised - r.changeOrders;
      if (r.key === DEAL_DISCOUNT_KEY) return t + pre;
      // Bought out (anything committed on it): what's committed, under or over. Not yet: its budget.
      const c = cost.byKey!.get(r.key);
      const committed = (c?.committed ?? 0) + (c?.pending ?? 0);
      // Contingency is the reserve itself: it's surplus to draw on, not a cost to complete.
      if (/contingenc/i.test(r.description)) contingency += Math.max(0, r.revised - committed);
      if (Math.abs(committed) < 0.005 && /contingenc/i.test(r.description)) return t;
      if (committed - r.revised >= 0.005 && !/contingenc/i.test(r.description)) overLines.push({ key: r.key, description: r.description, over: r2(committed - r.revised) });
      return t + (Math.abs(committed) >= 0.005 ? committed : pre);
    }, 0);
    // Unallocated cost (not on any line yet) is cost too.
    const unplaced = Array.from(cost.byKey).filter(([k]) => !rows.some((r) => r.key === k)).reduce((t, [, c]) => t + c.committed + c.pending, 0);
    const coExtras = approved.reduce((t, c) => {
      const x = coTotals(c);
      return t + x.markups + x.cm + x.cmAbsorbed + (c.links.length ? 0 : x.work);
    }, 0);
    need = r2(linesNeed + unplaced + coExtras);
  } else {
    need = r2(Math.max(revised, projectedCost));
  }
  const fundsIn = r2(original + revisions + tenant);
  const supplemental = r2(Math.max(0, need - fundsIn));
  return {
    original, revisions, transfers, tenant, absorbed, revised,
    projectedCost, projectedOverrun,
    /** What the project needs to finish, and the surplus left in the budget after it. */
    need, surplus: r2(Math.max(0, fundsIn - need)),
    contingency: r2(contingency), overLines,
    /** Only the shortfall: absorbed costs the budget surplus can't cover. */
    supplemental,
    /** Absorbed change orders paid from the budget's surplus. */
    absorbedFromSurplus: r2(Math.max(0, absorbed - supplemental)),
    totalFunding: r2(fundsIn + supplemental),
    projectedVariance: r2(revised - projectedCost),
    pendingChangeOrders: s.pending,
  };
}

/**
 * The story of the budget, told against the original: each approved change
 * order grouped by why it happened, then revisions, adding up to the revised
 * budget. Transfers are noted but change nothing in total.
 */
export function budgetStory(a: BudgetApproval, f: { original: number; revisions: number; transfers?: number; revised: number }) {
  const approved = a.changeOrders.filter((c) => c.status === 'approved');
  const groups = CO_REASONS.map(([key, label]) => {
    const cos = approved.filter((c) => c.reason === key).map((c) => ({ id: c.id, number: c.number, title: c.title, ...coTotals(c) }));
    return {
      key, label, cos,
      total: r2(cos.reduce((s, c) => s + c.budgetIncrease, 0)),
      tenant: r2(cos.reduce((s, c) => s + c.tenant, 0)),
      absorbed: r2(cos.reduce((s, c) => s + c.absorbed, 0)),
      funded: r2(cos.reduce((s, c) => s + c.funded, 0)),
    };
  }).filter((g) => g.cos.length);
  const moved = r2(a.transfers.reduce((s, t) => s + t.amount, 0));
  return { original: f.original, groups, revisions: f.revisions, moved, transferCount: a.transfers.length, revised: f.revised };
}
