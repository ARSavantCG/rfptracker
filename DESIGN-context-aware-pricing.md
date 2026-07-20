# Design: Context-Aware Price Resolution

**Status:** Design agreed with Adolfo 2026-07-17. Not yet built. Cross-cuts the AI parser,
scope bundles, and the catalog. This is what makes proposed scope land with the RIGHT
price in Step 4, not a placeholder.

## The requirement
When scope ties to the catalog (whether the AI proposes it or Adolfo pulls a bundle), the
price must resolve **contextually** from the property's attributes and the quantities —
not a generic flat number. Two concrete cases Adolfo gave:

1. **Demising wall by clear height:** Gratigny is a 40' clear building → pull the **40'
   clear** demising wall price, NOT the 36' clear. (Wall cost scales with height: taller
   wall = more material + labor.) The property's `clearHeight` drives which price variant.

2. **Office by SF tier:** enter 5,000 SF of office → pull the pricing for the **tier that
   covers 5,000 SF** (e.g. the 3,001–7,500 tier), not a flat rate.

The principle: **catalog prices resolve from property context + quantity**, and the
parser/bundle expansion must honor that resolution so Step 4 shows the correct price
immediately, with no manual fixing.

## What already exists (reuse)
- **Property `clearHeight`** (schema line 121 property, 637 building) — e.g. "40 feet".
- **Tiered pricing by SF**: catalog has `itemGroup` + `minSquareFootage` +
  `maxSquareFootage` (e.g. "Office Area" tiers). The 5,000 SF → correct tier case is the
  EXISTING tiered-pricing feature — the parser just needs to feed the right quantity so
  the tier resolves. (Confirm the tier-resolution logic already runs in the eval; it does
  via applyTieredPricing in evaluation-budget.)

## What's NEW: variant pricing by building attribute (clear height)
Demising wall by clear height is a NEW dimension — pricing keyed on a property attribute
(clear height), not on SF. Same PATTERN as tiered pricing, different KEY.
Options to model it:
- **Option A (mirror tiers):** add `minClearHeight` / `maxClearHeight` (or a
  `clearHeightVariant` label like "36ft" / "40ft") to catalog items, so a demising wall
  has multiple catalog rows (one per clear-height band), and resolution picks the row
  matching the property's clear height. Consistent with how SF tiers already work.
- **Option B (attribute map):** a per-item pricing map keyed on clear height. More
  flexible, more to build.
- **Lean: Option A** — it mirrors the tier pattern the app + users already understand.

## WHEN pricing resolves: Step 4, not Step 2 (Adolfo 2026-07-17)
Step 2 validates WHAT scope applies (identify + accept/reject) — no pricing shown there,
keeps validation fast and judgment-focused. Pricing resolves in Step 4 on the finalized
scope list. Flow: identify scope (parser) -> validate scope (Step 2) -> price scope (Step 4).
A proposed item carries its catalog link + quantity through Step 2; the price is RESOLVED
at Step 4 using the flow below.

## Resolution flow (runs at Step 4 for each validated catalog-tied item)
1. Determine the property (from the RFP).
2. Read property attributes (clearHeight, etc.).
3. Read the quantity (e.g. 5,000 SF office; demising wall LF).
4. Resolve the correct catalog row/price:
   - SF-tiered items → pick the tier by quantity (existing logic).
   - Clear-height-variant items (demising wall) → pick the variant by property clearHeight.
   - Plain items → the single price.
5. The proposed line item lands in Step 4 with THAT resolved price.

## Ties to the other designs
- **Scope bundles:** when a bundle expands (e.g. "Demising Wall Package"), each component
  resolves its own context-aware price (the wall by clear height, etc.) — not generic.
- **AI parser:** proposals that catalog-match carry the resolved price + quantity, so
  accepting one drops a correctly-priced line, ready for evaluation. "needs-mapping"
  proposals (no catalog match) stay generic for the team to price.
- **Single source of truth:** prices still live once in the catalog; resolution just picks
  the right row. No price copying.

## Open questions for build
- Confirm how demising wall is currently priced (per LF? per SF of wall? flat?) — drives
  how clear-height variants attach.
- Are there other attribute-driven price variants besides clear height? (column spacing?
  dock-high vs grade? — ask Adolfo at build.)
- Does the property always have clearHeight populated? If missing, fall back to a default
  variant + flag for review.

## ACTIVATED 2026-07-19 (post-fork field test): demising wall in the ROM seeder
Adolfo's live test: the seeded demising wall arrived with no quantity and without
clear-height variant selection. This feature's first build target is now the FORK
SEEDER (then the parser/bundles per the original design). Two questions to answer
at build time:
1. **Quantity source:** where does demising-wall LF live or derive from? Bay configs
   carry SF/doors/office-SF but no depth or wall length. Candidates: a per-property
   or per-building depth/dimensions field Adolfo maintains (the "properties tab"
   figure he expects it to pull from — identify the exact field), or a formula
   (e.g., bay depth × demised sides). DO NOT invent a formula without confirmation.
2. **Variant modeling:** how are demising variants distinguished in the live catalog
   today (names embedding clear heights?), and do we build Option A properly
   (min/max clear-height columns mirroring SF tiers) or v1 name-matching against
   property.clearHeight? Option A is the design-doc preference.
Wire-up point: the fork seeder's catalog resolution (rom-routes.ts, isDemising
block) — resolve variant by property clearHeight, quantity from the confirmed
source, tenant share stays 50% default.

## QUANTITY BASIS + SPEC MATCHER (Adolfo 2026-07-19) — the design to build
Mirror the existing `calculationBasis` pattern with TWO new catalog fields on
rom_scope_items, both admin-set dropdowns:

1. **quantityBasis** — which property spec supplies the DEFAULT QUANTITY when an item
   is seeded/added. Adolfo's examples:
   - Demising Wall → "Building Depth"
   - LED Warehouse Lighting → "Rentable Area − Office Area"
   Implies a small vocabulary of derived expressions, not just raw fields:
   rentable_sf, office_sf, rentable_minus_office, building_depth, clear_height,
   dock_doors, bay_count, (extend as needed). Resolver reads the RFP's property +
   selected bays and computes the value; blank/unknown basis → quantity stays manual.

2. **specMatcher** — which property spec selects WHICH VARIANT of a scope family to
   prepopulate (the clear-height case): among "Demising Wall 32'/40'/…", pick the row
   whose spec matches the property's clear height. Preferred modeling is still
   Option A (min/max columns) over name parsing; specMatcher names the property
   attribute to compare against.

Together these make the fork seeder self-configuring: the right variant, at the right
quantity, from property data — JJ types nothing. Same resolver serves the parser and
scope bundles.
Build order when picked up: (a) add the two columns + admin dropdowns in Manage Scope
Items, (b) write the resolver with the derived-expression vocabulary, (c) wire into the
fork seeder, (d) then parser/bundles.

### REFINEMENT (Adolfo, same session): N tags per item, not two fixed fields
Model as a REPEATABLE tag list on each catalog item — minimum one, "+" to add more,
each tag = {kind, propertySpec, (optional) value/range}:
- Demising Wall 40': [quantity ← Building Depth] + [match ← Clear Height = 40']
- LED Warehouse Lighting: [quantity ← Rentable Area − Office Area]
One tag kind drives DEFAULT QUANTITY; other tags REFINE which variant applies (matching
against property specs). Storage: json column `specTags` on rom_scope_items (additive
migration), admin UI = a small repeater in Manage Scope Items. Resolver walks the tags:
first quantity tag wins for qty; all match tags must satisfy the property before the
item is auto-selected. Supersedes the fixed quantityBasis/specMatcher column pair above
(same vocabulary, more flexible shape).
