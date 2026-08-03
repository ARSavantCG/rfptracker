// Fee base definitions — the single place the three fee-base decisions live.
//
// DECIDED BY ADOLFO 2026-08-03. Do not change these without asking; each one
// moves real dollars, and changing a base changes which fees clear their
// minimum floor (see shared/line-total.ts).
//
//   Q1. Permit fees are assessed on CONSTRUCTION COSTS = TI HARD COSTS ONLY.
//       Design, engineering, CM, and other soft costs are OUT of the permit base.
//       This is also the meaning of the 'pct-construction-total' calculation
//       basis: construction total == TI hard costs.
//
//   Q2. Contingency is carried on ALL COSTS ABOVE IT — TI plus every soft cost
//       including design, CM, permit, and builder's risk. It excludes only
//       itself.
//
//   Q3. CM COMES BEFORE CONTINGENCY. CM is computed on a base that excludes
//       contingency; contingency is then computed on a base that INCLUDES the
//       CM fee. Contingency earns on CM; CM does not earn on contingency.
//
// The ordering in Q3 is what keeps this non-circular. Fees must be computed in
// the FEE_PASSES order below. Computing them in one pass over a single shared
// subtotal — which is what server/rom-routes.ts did before 2026-08-03 — gives
// every fee the same base and silently contradicts all three answers.

export type FeeKind =
  | 'permit'
  | 'builders-risk'
  | 'cm'
  | 'contingency'
  | 'design'
  | 'other';

/**
 * Classifies a catalog item name into a fee family.
 *
 * Description-matching is not ideal, but it is what the evaluation screen
 * already does and the two must agree; a catalog-driven replacement should
 * change BOTH at once. Order matters: 'contingency' is checked before the
 * broader patterns so "construction contingency" does not classify as CM.
 */
export function classifyFeeRow(name: string | null | undefined): FeeKind {
  const n = (name || '').toLowerCase();
  if (!n.trim()) return 'other';
  if (n.includes('contingency')) return 'contingency';
  if (n.includes('construction') && n.includes('management')) return 'cm';
  if (n.includes('cm fee')) return 'cm';
  if (n.includes('permit')) return 'permit';
  if (n.includes('builder') && n.includes('risk')) return 'builders-risk';
  if (n.includes('design') || n.includes('architect') || n.includes('engineer')) return 'design';
  return 'other';
}

/**
 * Fee computation order. Each pass may only consume totals produced by an
 * EARLIER pass. This encodes Q3.
 *   pass 1 — permit, builder's risk, and any other percent fee (base: TI only)
 *   pass 2 — CM (base: everything except CM and contingency)
 *   pass 3 — contingency (base: everything except contingency itself)
 */
export const FEE_PASSES: FeeKind[][] = [
  ['permit', 'builders-risk', 'design', 'other'],
  ['cm'],
  ['contingency'],
];

export function feePassIndex(kind: FeeKind): number {
  const i = FEE_PASSES.findIndex((p) => p.includes(kind));
  return i === -1 ? 0 : i;
}

export interface FeeBaseTotals {
  /** Sum of non-fee TENANT IMPROVEMENT rows. The "construction total". */
  tiTotal: number;
  /** Sum of non-fee soft-cost rows (design/engineering entered as real dollars). */
  nonFeeSoftCosts: number;
  /** Fees resolved in pass 1 (permit, builder's risk, etc.). */
  pass1FeeTotal: number;
  /** The CM fee resolved in pass 2. */
  cmFeeTotal: number;
}

/**
 * The base a given fee family is assessed on.
 *
 * `explicitBasis` is the catalog item's calculationBasis and wins when set to
 * an explicit pct-* value; 'lump-sum' and 'manual' never reach here (callers
 * return early). When no basis is set, the family default below applies.
 */
export function resolveFeeBase(
  kind: FeeKind,
  totals: FeeBaseTotals,
  explicitBasis?: string | null,
  rentableSf = 0,
): number {
  const basis = (explicitBasis || '').toString();

  // Q1: "construction total" means TI hard costs only — NOT TI + soft costs.
  if (basis === 'pct-construction-total') return totals.tiTotal;
  if (basis === 'pct-ti-total') return totals.tiTotal;
  if (basis === 'pct-rentable-sf') return rentableSf;

  switch (kind) {
    // Q1: permit assessed on TI hard costs only.
    case 'permit':
      return totals.tiTotal;

    // Builder's risk follows the same construction-value logic as permit.
    case 'builders-risk':
      return totals.tiTotal;

    // Q3: CM is computed BEFORE contingency, so contingency is not in its base.
    // Everything else above it is: TI + non-fee soft costs + pass-1 fees.
    case 'cm':
      return totals.tiTotal + totals.nonFeeSoftCosts + totals.pass1FeeTotal;

    // Q2: contingency carries ALL costs above it, including the CM fee.
    case 'contingency':
      return totals.tiTotal + totals.nonFeeSoftCosts + totals.pass1FeeTotal + totals.cmFeeTotal;

    default:
      return totals.tiTotal;
  }
}
