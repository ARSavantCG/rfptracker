/**
 * RFP Tracker — Spec Tag Resolver
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 *
 * DESIGN-context-aware-pricing.md (REFINEMENT, Adolfo 2026-07-19).
 *
 * Catalog items carry a repeatable list of spec tags (rom_scope_items.spec_tags):
 *   - kind 'quantity': names the property spec that supplies the DEFAULT
 *     QUANTITY when the item is seeded/added. The FIRST quantity tag in the
 *     list wins; if its spec can't be computed from the property/bays, the
 *     quantity stays manual (null returned — caller keeps its own default).
 *   - kind 'match': names a property spec the property must satisfy (exact
 *     value, or inclusive [value, maxValue] range) before the item/variant is
 *     auto-selected. ALL match tags must pass. A spec that can't be computed
 *     (missing property data) FAILS the match — we never guess a variant.
 *
 * The same resolver serves the fork seeder today and the parser/scope-bundle
 * expansions later (per the design's "single resolver" note).
 */

import { SPEC_TAG_SOURCES, type SpecTag, type SpecTagSource } from '@shared/schema';

// Context the resolver reads. property is the properties row (or null when the
// RFP's property reference didn't resolve); bays are the selected bay
// configurations snapshotted onto the ROM (BayConfiguration shape).
export interface SpecContext {
  property: any | null;
  bays: any[];
}

// parseFloat + strip per UI-STANDARDS.md — parseInt("1,000") === 1 trap, and
// clear_height is stored as text like "32 feet" / "40'" so we strip everything
// non-numeric before parsing.
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

/**
 * Compute one vocabulary spec from the context. Returns null when the data to
 * compute it isn't present — null means "unknown", never 0. (A building with
 * no depth on file is unknown, not zero feet deep.)
 */
export function computePropertySpec(spec: SpecTagSource | string, ctx: SpecContext): number | null {
  const bays = Array.isArray(ctx.bays) ? ctx.bays : [];
  const sum = (pick: (b: any) => number | null): number | null => {
    if (!bays.length) return null;
    let total = 0;
    let any = false;
    for (const b of bays) {
      const v = pick(b);
      if (v !== null) { total += v; any = true; }
    }
    return any ? total : null;
  };

  switch (spec) {
    case 'rentable_sf':
      // rentableSquareFootage = squareFootage + mechanicalRoomAllocation when
      // computed; fall back to raw squareFootage per bay.
      return sum(b => num(b.rentableSquareFootage) ?? num(b.squareFootage));
    case 'office_sf':
      return sum(b => num(b.officeSquareFootage) ?? 0);
    case 'rentable_minus_office': {
      const rentable = computePropertySpec('rentable_sf', ctx);
      if (rentable === null) return null;
      const office = computePropertySpec('office_sf', ctx) ?? 0;
      return Math.max(0, rentable - office);
    }
    case 'building_depth':
      return num(ctx.property?.buildingDepth);
    case 'clear_height':
      return num(ctx.property?.clearHeight);
    case 'dock_doors':
      return sum(b => (num(b.standardDockDoors) ?? 0) + (num(b.oversizedDockDoors) ?? 0));
    case 'bay_count':
      return bays.length || null;
    default:
      console.warn(`[spec-tags] Unknown propertySpec "${spec}" — vocabulary in shared/schema.ts SPEC_TAG_SOURCES must match the resolver.`);
      return null;
  }
}

function normalizeTags(raw: unknown): SpecTag[] {
  return Array.isArray(raw) ? raw.filter(t => t && typeof t === 'object' && (t as any).kind && (t as any).propertySpec) as SpecTag[] : [];
}

/**
 * Do ALL match tags on the item pass against the property context?
 * Items with no match tags trivially pass (they're unconditional / the
 * "default variant"). Unknown property data fails — no guessing.
 */
export function matchTagsSatisfied(item: { specTags?: unknown }, ctx: SpecContext): boolean {
  const matchTags = normalizeTags(item.specTags).filter(t => t.kind === 'match');
  for (const tag of matchTags) {
    const actual = computePropertySpec(tag.propertySpec, ctx);
    if (actual === null) return false;
    const lo = num(tag.value);
    const hi = num(tag.maxValue);
    if (hi !== null) {
      // Range: value..maxValue inclusive (value missing → open-bottomed).
      if (lo !== null && actual < lo) return false;
      if (actual > hi) return false;
    } else {
      // Exact match. Small epsilon so "40" matches "40.0"/"40 feet".
      if (lo === null || Math.abs(actual - lo) > 0.001) return false;
    }
  }
  return true;
}

/** True when the item carries at least one match tag (i.e. it's a conditioned variant). */
export function hasMatchTags(item: { specTags?: unknown }): boolean {
  return normalizeTags(item.specTags).some(t => t.kind === 'match');
}

/**
 * Default quantity from the item's FIRST quantity tag, or null when the item
 * has no quantity tag or the spec can't be computed (quantity stays manual).
 */
export function resolveDefaultQuantity(item: { specTags?: unknown }, ctx: SpecContext): number | null {
  const qtyTag = normalizeTags(item.specTags).find(t => t.kind === 'quantity');
  if (!qtyTag) return null;
  return computePropertySpec(qtyTag.propertySpec, ctx);
}

/**
 * Variant selection for auto-population (the demising-wall-by-clear-height
 * case). Given a resolved catalog item and the full catalog:
 *   - Candidates are the item plus its itemGroup siblings (itemGroup is the
 *     app's existing family mechanism, reused rather than inventing one).
 *     No itemGroup → the item stands alone.
 *   - A candidate whose match tags ALL pass wins; conditioned variants that
 *     pass beat unconditioned (tag-less) defaults, so with clear_height = 40
 *     "Demising Wall 40'" beats a generic "Demising Wall" row.
 *   - Nothing passes (or data missing) → returns null; the caller keeps the
 *     original item and flags for review — we never silently drop or guess.
 */
export function selectVariant(item: any, catalog: any[], ctx: SpecContext): any | null {
  const group = (item.itemGroup || '').trim();
  const candidates = group
    ? catalog.filter(c => c.isActive !== false && (c.itemGroup || '').trim().toLowerCase() === group.toLowerCase())
    : [item];

  const passing = candidates.filter(c => matchTagsSatisfied(c, ctx));
  if (!passing.length) return null;
  const conditioned = passing.filter(c => hasMatchTags(c));
  return (conditioned[0] ?? passing[0]);
}
