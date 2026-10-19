/**
 * THE SINGLE RULE for what a budget's line items add up to.
 *
 * WHY THIS EXISTS: RFP-2026-031 published a base of $735,340 when its own line
 * items summed to $792,540. $57,200 of priced, visible scope was missing from
 * the number at the bottom of the page.
 *
 * TWO PATHS PRODUCED THE SAME FAULT, and both are fixed here:
 *
 * 1. LEGACY ASSEMBLIES (the August scheme). A line item tagged into an assembly
 *    carried the assembly's NAME in assemblyId. Every total skipped items with
 *    an assemblyId, on the assumption that the assembly's head line carried
 *    their value instead — but in that scheme there was no head line. The
 *    assembly's total lived in a separate map, was rendered in its own block,
 *    and was never added to anything. The children were subtracted and nothing
 *    put them back.
 *
 * 2. CURRENT ASSEMBLIES. The head IS a real line item, but it is created with
 *    totalPrice '0.00' and its value is DERIVED from its children for display
 *    only — deliberately, so the children stay the single source of truth. The
 *    totals, however, read the stored totalPrice. So the children were excluded
 *    and the head contributed zero: the whole assembly vanished from the grand
 *    total while showing the right figure on its own row.
 *
 * The rule, applied once here instead of being re-derived per call site:
 *
 *   - An assembly HEAD contributes the sum of its children, never its own
 *     stored price, which is a placeholder.
 *   - A child of a head that EXISTS contributes nothing on its own; its head
 *     already counted it.
 *   - A child whose head does NOT exist contributes its own amount. Money with
 *     no header to carry it is still money, and dropping it is what caused
 *     this.
 *   - Everything else contributes its own amount.
 *
 * Nothing is ever skipped without something else accounting for it.
 */

export interface BudgetLine {
  id?: string;
  description?: string;
  totalPrice?: string | number | null;
  tenantShare?: number | null;
  /** The head line item's id, or — in the legacy scheme — the assembly's name. */
  assemblyId?: string | null;
}

export interface AssemblyDef {
  id: string;
  name?: string;
}

/** A line's own contribution: price times the tenant's share. */
export function lineAmount(item: BudgetLine | null | undefined): number {
  if (!item) return 0;
  const price = typeof item.totalPrice === 'number'
    ? item.totalPrice
    : parseFloat(String(item.totalPrice ?? '')) || 0;
  const share = (item.tenantShare ?? 100) / 100;
  const amount = price * share;
  return Number.isFinite(amount) ? amount : 0;
}

/** Ids that are assembly heads: declared as an assembly AND present as a line. */
export function headIds(
  allItems: readonly BudgetLine[],
  assemblies: readonly AssemblyDef[] | null | undefined,
): Set<string> {
  const lineIds = new Set(allItems.map((i) => String(i?.id ?? '')));
  const heads = new Set<string>();
  for (const a of assemblies || []) {
    if (a?.id && lineIds.has(String(a.id))) heads.add(String(a.id));
  }
  // A head can also be identified by children pointing at a line that exists,
  // which is how the current scheme marks one even before customAssemblies
  // round-trips. Without this, a head whose assembly record was lost would
  // double-count: counted itself AND via its children.
  for (const item of allItems) {
    const parent = item?.assemblyId ? String(item.assemblyId) : '';
    if (parent && lineIds.has(parent)) heads.add(parent);
  }
  return heads;
}

/** What one line contributes, given the whole budget for context. */
export function effectiveLineAmount(
  item: BudgetLine,
  allItems: readonly BudgetLine[],
  assemblies: readonly AssemblyDef[] | null | undefined,
): number {
  const heads = headIds(allItems, assemblies);
  return effectiveLineAmountWithHeads(item, allItems, heads);
}

/** The same, with the head set computed once by the caller. */
export function effectiveLineAmountWithHeads(
  item: BudgetLine,
  allItems: readonly BudgetLine[],
  heads: Set<string>,
): number {
  const id = String(item?.id ?? '');

  // A HEAD is worth its children. Its own totalPrice is a placeholder ('0.00'
  // at creation) and is deliberately never written back.
  if (heads.has(id)) {
    return allItems
      .filter((child) => child?.assemblyId && String(child.assemblyId) === id)
      .reduce((sum, child) => sum + lineAmount(child), 0);
  }

  const parent = item?.assemblyId ? String(item.assemblyId) : '';
  // A child of a real head is already counted by that head.
  if (parent && heads.has(parent)) return 0;

  // ORPHAN: tagged into an assembly that has no head line. This is the August
  // case. Count it — there is nothing else to.
  return lineAmount(item);
}

/**
 * Total a set of lines, assembly-aware.
 *
 * `allItems` is every line in the budget, across all categories, because a
 * head and its children can sit in different ones. `items` is the subset being
 * totalled.
 */
export function sumBudgetLines(
  items: readonly BudgetLine[],
  allItems: readonly BudgetLine[],
  assemblies: readonly AssemblyDef[] | null | undefined,
): number {
  const heads = headIds(allItems, assemblies);
  return items.reduce(
    (sum, item) => sum + effectiveLineAmountWithHeads(item, allItems, heads), 0);
}

/**
 * Items tagged into an assembly that does not exist, and what they are worth.
 *
 * Exactly the money that used to disappear. Surfaced so a budget can say so
 * on screen rather than leaving someone to find it by adding the page up.
 */
export function orphanedAssemblyLines(
  allItems: readonly BudgetLine[],
  assemblies: readonly AssemblyDef[] | null | undefined,
): { items: BudgetLine[]; total: number; assemblyNames: string[] } {
  const heads = headIds(allItems, assemblies);
  const items = allItems.filter(
    (i) => i?.assemblyId && !heads.has(String(i.assemblyId)));
  return {
    items,
    total: items.reduce((s, i) => s + lineAmount(i), 0),
    assemblyNames: Array.from(new Set(items.map((i) => String(i.assemblyId)))),
  };
}

/**
 * Does a stored total still match what the lines add up to?
 *
 * Within a dollar is reconciled: cents move with rounding, $57,200 does not.
 */
export function reconcileTotal(
  storedTotal: number,
  computedTotal: number,
): { gap: number; reconciled: boolean; understated: boolean } {
  const gap = storedTotal - computedTotal;
  return {
    gap,
    reconciled: Math.abs(gap) < 1,
    understated: gap <= -1,
  };
}
