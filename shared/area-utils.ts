/**
 * Bay area maths — the single place warehouse area, mechanical proration, and
 * total rentable area are computed.
 *
 * BACKGROUND. This calculation was duplicated across six components:
 * create-rfp-modal, edit-rfp-modal, rfp-validation-modal, publish-summary,
 * evaluation-budget, and the properties list. The copies drifted, and every
 * incident since has come out of that drift:
 *
 *   - create-rfp-modal carried two hardcoded string literals ("408,763" and
 *     "426") behind an "all bays selected" branch, so every property in the
 *     portfolio rendered one building's numbers. Fixed 2026-07-31.
 *
 *   - publish-summary and rfp-validation-modal decide "all bays selected" by
 *     comparing COUNTS: selected.length === property.bayConfigurations.length.
 *     Split bays are separate entries, so selecting both halves of six bays in a
 *     twelve-bay building gives twelve entries and trips the check — granting
 *     100% of the mechanical room to a tenant with half the building. Fixed by
 *     deleting the branch: at a true full selection the proportional formula
 *     already returns 1.0, so the special case was never needed.
 *
 * Add new callers here rather than writing a seventh copy.
 */

export interface BayLike {
  id?: string;
  squareFootage?: number | null;
  rentableSquareFootage?: number | null;
  /** Set on split-bay halves; identifies the whole bay they came from. */
  parentBayId?: string | null;
}

/**
 * A bay's area. Prefers rentableSquareFootage and falls back to squareFootage,
 * because rentableSquareFootage is null on plenty of older and property-sourced
 * bay records. Summing only the rentable field returns 0 for a whole property,
 * which is what hid the Rentable Area readout on the evaluation screen.
 */
export function bayArea(bay: BayLike | null | undefined): number {
  if (!bay) return 0;
  // squareFootage FIRST, rentable only as a fallback.
  //
  // On split-bay halves, rentableSquareFootage is built as
  // (half squareFootage + that half's mechanical allocation) — so preferring it
  // folded the mechanical room into the warehouse figure, and computeAreaSummary
  // then added prorated mechanical again on top. Warehouse area is raw bay area;
  // mechanical is added once, separately.
  return bay.squareFootage || bay.rentableSquareFootage || 0;
}

/**
 * Remove double-counted bays before summing.
 *
 * Two ways a selection double-counts:
 *   - the same bay appears twice (duplicate id)
 *   - a whole bay appears alongside its own split halves, so its area is counted
 *     once as the parent and again as north + south
 *
 * Halves win over the parent: if both are present the selection was made at the
 * half level and the parent is a stale leftover. A silent 2x on a rentable area
 * is the kind of error that reaches a proposal, so this is stripped rather than
 * trusted.
 */
export function dedupeBays(bays: readonly BayLike[] | null | undefined): BayLike[] {
  if (!Array.isArray(bays)) return [];

  const byId = new Map<string, BayLike>();
  for (const bay of bays) {
    const key = bay?.id != null ? String(bay.id) : `__anon_${byId.size}`;
    if (!byId.has(key)) byId.set(key, bay);
  }

  const parentIdsCoveredByHalves = new Set<string>();
  for (const bay of byId.values()) {
    if (bay?.parentBayId) parentIdsCoveredByHalves.add(String(bay.parentBayId));
  }

  return Array.from(byId.entries())
    .filter(([id]) => !parentIdsCoveredByHalves.has(id))
    .map(([, bay]) => bay);
}

export function sumBayArea(bays: readonly BayLike[] | null | undefined): number {
  return dedupeBays(bays).reduce((sum, bay) => sum + bayArea(bay), 0);
}

/**
 * Tenant's share of the building by area, 0-100.
 * Returns 0 when the building total is unknown, so no caller divides by zero or
 * reports a share against a denominator it does not have.
 */
export function baySharePercent(
  selectedBays: readonly BayLike[] | null | undefined,
  allPropertyBays: readonly BayLike[] | null | undefined,
): number {
  const total = sumBayArea(allPropertyBays);
  if (!(total > 0)) return 0;
  return (sumBayArea(selectedBays) / total) * 100;
}

export interface AreaSummary {
  /** Warehouse area from the selected bays. Never exceeds the building total. */
  warehouseSf: number;
  /** This tenant's prorated share of the mechanical room. */
  mechanicalSf: number;
  /** warehouseSf + mechanicalSf. */
  totalRentableSf: number;
  /** Selected share of the building by area, 0-100. */
  sharePercent: number;
  /**
   * True when the selected bays exceed the property's own bay total — which
   * should be impossible and means the selection or the property record is
   * wrong. Surfaced rather than swallowed: a warehouse area larger than the
   * building is exactly the condition that went unnoticed in production for
   * months because both numbers looked plausible on their own.
   */
  exceedsBuilding: boolean;
}

/**
 * Warehouse area, mechanical allocation, and total rentable area for a selection
 * of bays.
 *
 * Mechanical is prorated strictly by area. There is deliberately NO "all bays
 * selected" special case: when every bay is selected the proportion is 1.0 and
 * the formula returns the whole mechanical room on its own. Every count-based
 * shortcut written for that case has been a bug.
 */
export function computeAreaSummary(
  selectedBays: readonly BayLike[] | null | undefined,
  allPropertyBays: readonly BayLike[] | null | undefined,
  mechanicalRoomSf: number | null | undefined,
): AreaSummary {
  const warehouseSf = sumBayArea(selectedBays);
  const buildingSf = sumBayArea(allPropertyBays);
  const mechRoom = mechanicalRoomSf || 0;

  const proportion = buildingSf > 0 ? warehouseSf / buildingSf : 0;
  const mechanicalSf = Math.round(proportion * mechRoom);

  // A selection cannot exceed the building it sits in. When it does, the numbers
  // downstream are wrong in a way that still looks plausible - which is how a
  // doubled rentable area reaches a proposal. Logged loudly; exceedsBuilding is
  // returned so callers can surface it rather than print a confident bad figure.
  if (buildingSf > 0 && warehouseSf > buildingSf) {
    console.warn(
      `[area-utils] selected ${warehouseSf.toLocaleString()} SF exceeds the building's ` +
      `${buildingSf.toLocaleString()} SF. The selection is double-counting - most often a ` +
      `split bay stored alongside its own halves, or configured half areas larger than the bay.`
    );
  }

  return {
    warehouseSf,
    mechanicalSf,
    totalRentableSf: warehouseSf + mechanicalSf,
    sharePercent: proportion * 100,
    exceedsBuilding: buildingSf > 0 && warehouseSf > buildingSf,
  };
}
