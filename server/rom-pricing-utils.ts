// Shared helpers for resolving live ROM Scope Item pricing/unit/category into
// evaluation-line-item-shaped data. Extracted so that any endpoint that needs to
// "refresh" a catalog reference against current pricing (template import, scope-of-work
// import, etc.) uses one resolution code path instead of re-implementing it per-route.

export interface RomLineItemFallback {
  label?: string;
  unitPrice?: number;
  unit?: string;
  category?: string;
  snapshot?: any;
}

export interface ResolvedRomPricing {
  label: string;
  unitPrice: number;
  unit: string;
  category: string;
  snapshot: any;
}

// Resolves the "live" price/unit/category for a rom_scope_items row, honoring the
// quarterly pricing intelligence fields (pricingMode/activePrice) with a fallback to the
// base unitPrice when no activePrice has been computed yet.
export function resolveLiveRomItemPricing(romItem: any, fallback: RomLineItemFallback = {}): ResolvedRomPricing {
  const activePriceRaw = romItem?.activePrice;
  const activePriceNum = activePriceRaw !== null && activePriceRaw !== undefined && String(activePriceRaw).trim() !== ""
    ? parseFloat(String(activePriceRaw))
    : NaN;

  const baseUnitPriceRaw = romItem?.unitPrice;
  const baseUnitPriceNum = typeof baseUnitPriceRaw === 'string' ? parseFloat(baseUnitPriceRaw) : (baseUnitPriceRaw ?? NaN);

  const unitPrice = !isNaN(activePriceNum)
    ? activePriceNum
    : (!isNaN(baseUnitPriceNum) ? baseUnitPriceNum : (fallback.unitPrice ?? 0));

  const label = romItem?.name || fallback.label || "";
  const unit = romItem?.unit || fallback.unit || "ea.";
  const category = romItem?.category || fallback.category || "";

  const snapshot = {
    ...(fallback.snapshot || {}),
    label,
    unitPrice,
    unit,
    category,
    source: romItem?.source || fallback.snapshot?.source,
    itemGroup: romItem?.itemGroup || fallback.snapshot?.itemGroup,
    minSquareFootage: romItem?.minSquareFootage ?? fallback.snapshot?.minSquareFootage,
    maxSquareFootage: romItem?.maxSquareFootage ?? fallback.snapshot?.maxSquareFootage,
    // Contractor minimum total cost travels WITH the line item so client-side
    // recalcs (evaluation-budget.tsx) can enforce the floor without a catalog
    // round-trip. Without these two keys the client silently loses the minimum
    // the moment a user edits a quantity. See shared/line-total.ts.
    minimumCost: romItem?.minimumCost ?? fallback.snapshot?.minimumCost ?? null,
    hasMinimumCost: romItem?.hasMinimumCost ?? fallback.snapshot?.hasMinimumCost ?? false,
  };

  return { label, unitPrice, unit, category, snapshot };
}

// Normalizes a unit string to the lowercase, period-suffixed convention used across
// evaluation line items (e.g. "SF" -> "sf.").
export function normalizeUnit(unit: string | undefined | null): string {
  let normalized = (unit || "ea.").toLowerCase();
  if (!normalized.endsWith(".")) {
    normalized = normalized + ".";
  }
  return normalized;
}

// Buckets a catalog item into one of the three evaluation budget categories based on its
// category text (with a tag-based fallback), defaulting unrecognized categories to
// Tenant Improvements. Callers that need to warn the user about an unrecognized category
// should compare the returned bucket against the raw category text themselves.
export function categorizeRomLineItem(
  category: string | undefined | null,
  tags: string[] = []
): "tenantImprovements" | "designSoftCosts" | "existingImprovements" {
  const cat = (category || "").toLowerCase();

  if (cat.includes("design") || cat.includes("soft cost") || cat.includes("other fees")) {
    return "designSoftCosts";
  }
  if (cat.includes("existing")) {
    return "existingImprovements";
  }
  if (tags.some((tag) => tag.includes("design") || tag.includes("soft-cost"))) {
    return "designSoftCosts";
  }
  if (tags.some((tag) => tag.includes("existing"))) {
    return "existingImprovements";
  }
  return "tenantImprovements";
}

// A category is considered "known" (i.e. not something we silently default) when it
// matches one of the recognized keyword buckets above. Used to flag unexpected category
// text to the caller instead of silently dumping it into Tenant Improvements.
export function isKnownRomCategory(category: string | undefined | null): boolean {
  const cat = (category || "").toLowerCase();
  return (
    cat.includes("design") ||
    cat.includes("soft cost") ||
    cat.includes("other fees") ||
    cat.includes("existing") ||
    cat.includes("tenant")
  );
}
