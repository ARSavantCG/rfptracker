/**
 * Default tenant electrical allocation.
 *
 * A tenant's default allocation is their proportionate share of the building's
 * total amps, rounded DOWN to the property's configured increment.
 *
 * Rounding down is deliberate: electrical capacity is finite and shared. Rounding
 * up hands a tenant more amps than their share of the building supports, and if
 * every tenant is rounded up the building is over-committed. The user can always
 * raise the number by hand; the default should never over-commit on its own.
 *
 * Worked examples (Adolfo, 2026-07-30):
 *   1,800 A building, tenant at 50%, 100 A increment -> 900 A
 *     floor(900 / 100) * 100 = 900
 *   1,800 A building, tenant at 50%, 200 A increment -> 800 A
 *     floor(900 / 200) * 200 = 800   (NOT 1,000 - down, not nearest)
 *
 * Minimum (Adolfo, 2026-08-03): a tenant never receives less than the property's
 * minimum service, however small their share.
 *   1,800 A building, tenant at 5%, 200 A increment, 200 A minimum -> 200 A
 *     floor(90 / 200) * 200 = 0, then raised to the 200 A minimum
 */
export function defaultElectricalAllocation(params: {
  /** Building's total electrical allocation in amps (properties.electricalAllocation). */
  buildingTotalAmps: number;
  /** Tenant's share of the building, as a percentage (0-100). */
  tenantSharePercent: number;
  /** Rounding increment in amps (properties.electricalAllocationIncrement). */
  increment: number;
  /**
   * Minimum service floor in amps (properties.electricalAllocationMinimum).
   * A tenant never gets less than this, however small their share.
   *
   * This is NOT the same as one increment. The increment is rounding
   * granularity; the minimum is the smallest service that can actually run a
   * space. A property can have 100 A increments and still a 200 A minimum.
   */
  minimum?: number;
}): number {
  const { buildingTotalAmps, tenantSharePercent, increment, minimum = 0 } = params;

  // No building total or no tenant share means no data, not a small tenant -
  // the minimum must not manufacture an allocation out of nothing.
  if (!(buildingTotalAmps > 0) || !(tenantSharePercent > 0)) return 0;

  const rawShare = buildingTotalAmps * (tenantSharePercent / 100);

  // A non-positive increment means "no rounding configured".
  const rounded = increment > 0
    ? Math.floor(rawShare / increment) * increment
    : Math.round(rawShare);

  // Minimum applied AFTER rounding. Rounding first and flooring second is what
  // makes a sub-increment share land on the minimum rather than on zero.
  //
  // Note the minimum wins even when it is not a multiple of the increment: it is
  // a hard service floor, not another rounding step. Capped at the building
  // total so a minimum larger than the whole building cannot be handed out.
  const withMinimum = Math.max(rounded, minimum > 0 ? minimum : 0);

  return Math.min(withMinimum, buildingTotalAmps);
}

/**
 * Tenant share of a building by area, as a percentage (0-100).
 * Returns 0 when the building total is unknown, so callers never divide by zero
 * or report a share against an unknown denominator.
 */
export function tenantSharePercent(tenantSf: number, buildingSf: number): number {
  if (!(buildingSf > 0) || !(tenantSf > 0)) return 0;
  return (tenantSf / buildingSf) * 100;
}
