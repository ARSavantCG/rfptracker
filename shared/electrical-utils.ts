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
 */
export function defaultElectricalAllocation(params: {
  /** Building's total electrical allocation in amps (properties.electricalAllocation). */
  buildingTotalAmps: number;
  /** Tenant's share of the building, as a percentage (0-100). */
  tenantSharePercent: number;
  /** Rounding increment in amps (properties.electricalAllocationIncrement). */
  increment: number;
}): number {
  const { buildingTotalAmps, tenantSharePercent, increment } = params;

  if (!(buildingTotalAmps > 0) || !(tenantSharePercent > 0)) return 0;

  const rawShare = buildingTotalAmps * (tenantSharePercent / 100);

  // A non-positive increment means "no rounding configured" - return the raw
  // share rounded to a whole amp rather than dividing by zero.
  if (!(increment > 0)) return Math.round(rawShare);

  return Math.floor(rawShare / increment) * increment;
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
