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

// ── Pricing by quantity (Adolfo 2026-10-22) ──────────────────────────────────
// One catalog item carries a price per quantity range ("Office 0–3,000 SF $200,
// 3,001–5,000 $180, 5,001+ $165"). The range holding the quantity sets the price,
// and the line is NEVER cheaper than the top of a range below it: 3,200 SF at
// $180 = $576,000 is lifted to the 3,000 SF × $200 = $600,000 minimum, until the
// new rate catches up (≈3,334 SF), then it's simply SF × the range's rate.

export interface PriceTierLike {
  min?: number | string | null;
  max?: number | string | null;
  mode?: string | null;
  price?: number | string | null;
  step?: number | string | null;
  note?: string | null;
}
type Tier = { min: number | null; max: number | null; mode: 'unit' | 'flat' | 'step'; price: number; step: number | null; note: string };

export function normalizeTiers(raw: unknown): Tier[] {
  if (!Array.isArray(raw)) return [];
  return (raw as PriceTierLike[])
    .map((t) => ({
      min: parseMoney(t?.min as any),
      max: parseMoney(t?.max as any),
      mode: (t?.mode === 'flat' || t?.mode === 'step' ? t.mode : 'unit') as Tier['mode'],
      price: parseMoney(t?.price as any) ?? 0,
      step: parseMoney(t?.step as any),
      note: String(t?.note ?? '').trim(),
    }))
    .filter((t) => t.price > 0 || t.mode === 'flat')
    .sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
}

function tierAmount(t: Tier, qty: number): number {
  if (t.mode === 'flat') return t.price;
  if (t.mode === 'step') return Math.ceil(Math.max(0, qty) / (t.step && t.step > 0 ? t.step : 1)) * t.price;
  return qty * t.price;
}

const fmtQty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
export function tierLabel(t: { min: number | null; max: number | null }): string {
  const lo = t.min ?? 0;
  return t.max == null ? `${fmtQty(lo)}+` : `${fmtQty(lo)}–${fmtQty(t.max)}`;
}

export interface TierResult {
  /** The amount for this quantity, after the "never cheaper than the range below" floor. */
  gross: number;
  index: number;
  label: string;
  note: string;
  mode: Tier['mode'];
  /** True when the top of a lower range set the price. */
  floorApplied: boolean;
  floor: number;
  floorLabel: string;
}

/** Prices a quantity against an item's ranges. null when the item has none. */
export function priceByTiers(rawTiers: unknown, quantity: number | string | null | undefined): TierResult | null {
  const tiers = normalizeTiers(rawTiers);
  if (!tiers.length) return null;
  const qty = parseMoney(quantity as any) ?? 0;
  // The range holding the quantity; above every range → the last; below the first → the first.
  let index = tiers.findIndex((t) => qty >= (t.min ?? 0) - 1e-9 && (t.max == null || qty <= t.max + 1e-9));
  if (index < 0) index = qty < (tiers[0].min ?? 0) ? 0 : tiers.length - 1;
  const t = tiers[index];
  const own = tierAmount(t, qty);
  // The top of every lower range is a floor: a bigger space never prices below a smaller one.
  let floor = 0, floorLabel = '';
  for (let j = 0; j < index; j++) {
    const top = tiers[j].max ?? tiers[j].min ?? 0;
    const amt = tierAmount(tiers[j], top);
    if (amt > floor) { floor = amt; floorLabel = tierLabel(tiers[j]); }
  }
  const floorApplied = floor > own + 0.005;
  return { gross: floorApplied ? floor : own, index, label: tierLabel(t), note: t.note, mode: t.mode, floorApplied, floor, floorLabel };
}

/** The ranges on a line item, whichever snapshot carries them (same order as resolveMinimumSource). */
export function resolveTierSource(item: any): unknown[] | null {
  if (!item) return null;
  for (const c of [item.romSnapshot, item.masterItemSnapshot, item.scopeItem, item]) {
    const t = c?.priceTiers;
    if (Array.isArray(t) && normalizeTiers(t).length) return t;
  }
  return null;
}

export interface LineTotalInput {
  quantity: number | string | null | undefined;
  unitPrice: number | string | null | undefined;
  /** Tenant share as a PERCENT (0-100), not a fraction. Defaults to 100. */
  tenantShare?: number | string | null;
  /** Catalog item or romSnapshot carrying minimumCost / hasMinimumCost (and priceTiers). */
  item?: (MinimumCostSource & { priceTiers?: unknown }) | null;
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
  /** Priced by quantity range: which range, and whether a lower range's top set the price. */
  tier: TierResult | null;
  /** The per-unit price this line works out to (gross ÷ quantity) — the tier's rate, or less when floored. */
  effectiveUnitPrice: number;
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

  // Pricing by quantity wins over the line's typed unit price: the range sets it.
  const tier = priceByTiers(input.item?.priceTiers ?? resolveTierSource(input.item), qty);
  const rawTotal = tier ? tier.gross : qty * price;

  const minimumCost = effectiveMinimumCost(input.item);
  const grossTotal = minimumCost !== null ? Math.max(rawTotal, minimumCost) : rawTotal;

  return {
    rawTotal,
    grossTotal,
    total: grossTotal * (sharePct / 100),
    minimumApplied: minimumCost !== null && minimumCost > rawTotal,
    minimumCost,
    tier,
    effectiveUnitPrice: tier ? (qty ? Math.round((tier.gross / qty) * 10000) / 10000 : (tier.mode === 'flat' ? tier.gross : 0)) : price,
  };
}

/** Convenience wrapper for call sites that only need the number. */
export function lineTotal(input: LineTotalInput): number {
  return computeLineTotal(input).total;
}

/**
 * Finds the minimum-cost fields on a line item regardless of which snapshot
 * shape it carries.
 *
 * Evaluation line items carry `romSnapshot` (catalog import / spec-tag paths)
 * or `masterItemSnapshot` (manual picker path) or, for a raw catalog row, the
 * fields directly. Checking only one of these is why a fix can appear to work
 * on one screen and silently miss on another. Order: romSnapshot, then
 * masterItemSnapshot, then the item itself. First one with the flag ON wins;
 * a snapshot that merely EXISTS does not veto a later source.
 */
export function resolveMinimumSource(item: any): MinimumCostSource | null {
  if (!item) return null;
  const candidates = [item.romSnapshot, item.masterItemSnapshot, item];
  for (const c of candidates) {
    if (c && effectiveMinimumCost(c) !== null) return c;
  }
  return null;
}

export interface FeeFloorResult {
  /** The fee after the minimum is applied. */
  total: number;
  /** The fee before the minimum, kept for display / explanation. */
  computed: number;
  /** True when the minimum raised the fee. */
  minimumApplied: boolean;
  minimumCost: number | null;
}

/**
 * Applies a catalog minimum to a PERCENT-FEE row.
 *
 * WHY THIS IS SEPARATE FROM computeLineTotal (Adolfo 2026-08-03):
 * Percent fees — builder's risk, permit fees, CM, contingency — do not go
 * through quantity x unitPrice. They are computed as base x rate and then
 * ASSIGNED over totalPrice, which stomped any minimum computeLineTotal had
 * already applied. Builder's risk entered at 1% produced 1% of TI total with
 * no floor, even though the catalog item carried a minimum premium.
 *
 * Semantics confirmed by Adolfo: the minimum is a floor on the FEE ITSELF —
 * MAX(base x rate, minimum) — matching how a carrier writes a minimum policy
 * premium. It is NOT a floor on the base the rate applies to.
 */
export function applyFeeMinimum(computed: number, item: any): FeeFloorResult {
  const source = resolveMinimumSource(item);
  const minimumCost = effectiveMinimumCost(source);
  const safeComputed = isNaN(computed) ? 0 : computed;
  if (minimumCost === null) {
    return { total: safeComputed, computed: safeComputed, minimumApplied: false, minimumCost: null };
  }
  return {
    total: Math.max(safeComputed, minimumCost),
    computed: safeComputed,
    minimumApplied: minimumCost > safeComputed,
    minimumCost,
  };
}
