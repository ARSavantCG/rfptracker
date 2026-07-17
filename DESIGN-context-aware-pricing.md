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

## Resolution flow (when a catalog-tied item is proposed/pulled)
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
