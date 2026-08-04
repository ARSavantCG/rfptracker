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
}

/**
 * A bay's area. Prefers rentableSquareFootage and falls back to squareFootage,
 * because rentableSquareFootage is null on plenty of older and property-sourced
 * bay records. Summing only the rentable field returns 0 for a whole property,
 * which is what hid the Rentable Area readout on the evaluation screen.
 */
export function bayArea(bay: BayLike | null | undefined): number {
  if (!bay) return 0;
  return bay.rentableSquareFootage || bay.squareFootage || 0;
}

export function sumBayArea(bays: readonly BayLike[] | null | undefined): number {
  if (!Array.isArray(bays)) return 0;
  return bays.reduce((sum, bay) => sum + bayArea(bay), 0);
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

  return {
    warehouseSf,
    mechanicalSf,
    totalRentableSf: warehouseSf + mechanicalSf,
    sharePercent: proportion * 100,
    exceedsBuilding: buildingSf > 0 && warehouseSf > buildingSf,
  };
}
