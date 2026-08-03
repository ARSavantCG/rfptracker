// Single source of truth for ROM / evaluation line-item dollar math.
//
// WHY THIS FILE EXISTS (Adolfo 2026-08-03):
// `rom_scope_items.minimumCost` / `hasMinimumCost` shipped as schema columns and
// as an admin form field in rom-scope-items-modal.tsx, but NO calculation path
// ever read them. Fourteen separate sites across server/ and client/ computed
// `qty * unitPrice` inline. Any catalog item carrying a contractor minimum
// (e.g. demising wall priced at a 200 LF minimum) was billed at raw quantity, so
// every ROM containing one was silently LOW. See HANDOFF.md.
//
// Every line-total computation must route through computeLineTotal(). Do not
// reintroduce inline `qty * price` — that is how this drifted the first time.

/** The catalog-item fields the math needs. Accepts a rom_scope_items row, an
 *  evaluation line item's romSnapshot, or anything shaped like either. Fields
 *  are text columns in Postgres, so strings are expected and parsed. */
export interface MinimumCostSource {
  minimumCost?: string | number | null;
  hasMinimumCost?: boolean | null;
}

/** Parses a Postgres text/numeric money column. Returns null when absent or
 *  unparseable — deliberately distinct from 0, which is a real price. */
export function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return isNaN(raw) ? null : raw;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  // parseFloat with comma stripping per UI-STANDARDS.md — parseInt/parseFloat
  // silently truncate at a comma in formatted values like "1,200.00".
  const n = parseFloat(trimmed.replace(/[$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

/** The effective minimum total cost for an item, or null when none applies.
 *  A minimum only applies when hasMinimumCost is true AND minimumCost parses
 *  to a positive number — a checked box with an empty value is not a floor. */
export function effectiveMinimumCost(source: MinimumCostSource | null | undefined): number | null {
  if (!source || !source.hasMinimumCost) return null;
  const min = parseMoney(source.minimumCost);
  if (min === null || min <= 0) return null;
  return min;
}

export interface LineTotalInput {
  quantity: number | string | null | undefined;
  unitPrice: number | string | null | undefined;
  /** Tenant share as a PERCENT (0-100), not a fraction. Defaults to 100. */
  tenantShare?: number | string | null;
  /** Catalog item or romSnapshot carrying minimumCost / hasMinimumCost. */
  item?: MinimumCostSource | null;
}

export interface LineTotalResult {
  /** quantity × unitPrice, before any minimum or share is applied. */
  rawTotal: number;
  /** rawTotal after the catalog minimum is applied, before share. */
  grossTotal: number;
  /** Final billable amount: grossTotal × (tenantShare / 100). */
  total: number;
  /** True when the minimum raised this line above quantity × unitPrice. */
  minimumApplied: boolean;
  /** The minimum that applied, or null. Surface this in the UI. */
  minimumCost: number | null;
}

/**
 * Computes a line total.
 *
 * Order of operations is deliberate: the minimum is a CONTRACTOR minimum on the
 * gross cost of the work, so it floors the gross BEFORE tenant share is applied.
 * A 200 LF demising wall minimum at 50% tenant share bills half of the floored
 * gross, not a floored half. Flooring after the share would overcharge the
 * tenant on every shared line.
 */
export function computeLineTotal(input: LineTotalInput): LineTotalResult {
  const qty = parseMoney(input.quantity) ?? 0;
  const price = parseMoney(input.unitPrice) ?? 0;

  const shareRaw = parseMoney(input.tenantShare);
  const sharePct = shareRaw === null ? 100 : shareRaw;

  const rawTotal = qty * price;

  const minimumCost = effectiveMinimumCost(input.item);
  const grossTotal = minimumCost !== null ? Math.max(rawTotal, minimumCost) : rawTotal;

  return {
    rawTotal,
    grossTotal,
    total: grossTotal * (sharePct / 100),
    minimumApplied: minimumCost !== null && minimumCost > rawTotal,
    minimumCost,
  };
}

/** Convenience wrapper for call sites that only need the number. */
export function lineTotal(input: LineTotalInput): number {
  return computeLineTotal(input).total;
}
