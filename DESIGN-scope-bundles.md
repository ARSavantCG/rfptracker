# Design: Scope Bundles / Packages ("Acclimatize Warehouse", etc.)

**Status:** Design agreed with Adolfo. Not yet built. Ties together the cost database
and the AI intake parser.

## The idea
Adolfo wants named, reusable buildout **packages** he can pull on demand — e.g.
"Acclimatize Warehouse" (condition the space: HVAC + insulation + electrical + controls),
"Office Buildout", "Demising Wall + Cascade". Each package = a named group of existing
ROM catalog items, pulled together in one action instead of hand-picking each time.

## Key realization: this is a GROUPING LAYER on the existing catalog
The ROM catalog already has rich atomic scope ITEMS (name, unit, unitPrice,
calculationBasis, CSI, min cost, tiering). What's missing is a way to say
"these N items = a named package." That's the new layer. Three layers total:

1. **Scope items** (EXISTS) — atomic priced line items (LED lighting, HVAC unit, etc.)
2. **Scope bundles/packages** (NEW) — named groups of items ("Acclimatize Warehouse")
3. **Inference rules** (AI parser, see DESIGN-ai-intake-parser.md) — map triggers to
   bundles ("partial building" → "Demising Wall + Cascade" bundle)

## Why bundles marry the AI parser (the elegant part)
A bundle is BOTH:
- Something Adolfo pulls manually ("give me the Acclimatize Warehouse package") →
  expands to its component items with pricing → straight to evaluation.
- Something the AI proposes when it detects a trigger ("tenant wants to condition the
  warehouse" → propose the Acclimatize Warehouse bundle).

The demising-wall cascade from the AI-parser design IS a bundle: "Demising Wall Package"
= { demising wall, electrical reconfig, fire alarm reconfig, sprinkler reconfig }. So
instead of the AI holding a loose rule "demising implies 4 things," the rule just points
to the bundle, and the bundle defines the 4 items. Cleaner, and the bundle is reusable
outside the AI too.

## CRITICAL design decision: bundles EXPAND into separate line items (not a lumped line)
When a bundle is pulled in (manually or via AI), it **explodes into its individual
component line items** — NOT one collapsed "Demising Wall Package: $X" line. Adolfo's
requirement (2026-07-17): keep the wall, electrical reconfig, fire alarm reconfig, and
sprinkler reconfig as SEPARATE line items.

Rationale: each has its own cost, contractor, trade, and $/SF; they're priced, bid,
compared, and tracked independently. A demising wall is structural; electrical reconfig
is a different trade with a different bid. They must stay distinct in the evaluation.

So a bundle is a **template/expander (an "add these N at once" shortcut)**, NOT a
permanent wrapper that hides or groups the components. After expansion:
- The N items are ordinary, independent line items.
- Each is individually editable, re-priceable, and removable.
- There is no lingering "package" object grouping them at the evaluation level.
- (The bundle definition still exists in the catalog for reuse; it just doesn't persist
  as a container on the evaluation.)

This is exactly how the existing master-item picker already drops single catalog items in
— a bundle just drops in several at once, each as its own line.

## Model (build plan)
1. **Schema:**
   - `scope_bundles` table: `id`, `name` ("Acclimatize Warehouse"), `description`,
     `category`, `isActive`, timestamps.
   - `scope_bundle_items` join table: `bundleId`, `scopeItemId`, `defaultQuantity`
     (optional), `notes`, `sortOrder`. Links a bundle to its catalog items.
   - (A bundle references catalog items by ID, so pricing stays single-source — update
     the item's price once, every bundle using it reflects it.)
2. **Backend:** CRUD for bundles; an "expand bundle" endpoint that returns the component
   items (with current prices) ready to drop into a ROM/evaluation.
3. **UI:**
   - Admin/catalog: create/edit a bundle — name it, add catalog items to it.
   - In ROM/evaluation: an "Add Package" action → pick a bundle → its items drop in
     (each still editable, since it's just pre-filling from the catalog).
4. **Ties to AI parser:** inference rules point at bundle IDs. AI proposes the bundle;
   accepting it expands to the items.

## Design principles (consistent with the rest of the app)
- **Single source of truth for pricing:** bundles reference catalog item IDs, never copy
  prices. Change a price once in the catalog, all bundles update.
- **Bundles are starting points, not locked:** dropping a bundle pre-fills items that
  remain individually editable (like the AI proposals — suggestions, not commits).
- **Admin-curated, grows over time:** Adolfo adds bundles as buildout patterns recur.
  Same "living knowledge you curate" theme as the inference rules and settings.

## Seed bundles (from Adolfo's examples)
- **Acclimatize Warehouse** — HVAC unit(s), insulation, electrical drops for units,
  thermostat/controls. (Confirm exact components with Adolfo at build.)
- **Office Buildout** — (define components: framing, HVAC, electrical, finishes, etc.)
- **Demising Wall + Cascade** — demising wall, electrical reconfig, fire alarm reconfig,
  fire sprinkler reconfig.

## Open questions for build session
- Should a bundle carry default quantities, or leave quantity to fill-in at use time?
- Can bundles nest (a bundle including another bundle)? Probably not v1 — keep flat.
- Where does "Add Package" live in the eval UI — next to the master item picker?

## Bundle expansion into the evaluation — SPEC (Adolfo 2026-07-17)
The behavior that makes bundles useful. Two triggers, same result:

1. **Auto-trigger:** when a "trigger item" (e.g. demising wall) is added to an evaluation
   from the catalog, its bundle-mates (electrical reconfig, fire alarm reconfig, sprinkler
   reconfig) are **auto-added as separate line items** — silently, no prompt.
2. **Manual trigger:** an "Add Bundle" button in the evaluation → pick a bundle → its items
   drop in as separate line items.

Rules:
- Items land as SEPARATE, independent line items (never merged). Confirmed repeatedly.
- **Any auto-added line can be deleted individually** — if a given cascade item (e.g. fire
  alarm) doesn't apply to this deal, Adolfo deletes just that one line. (Construction
  reality: the cascade usually applies but not always; prune exceptions.)
- Don't double-add: if an item from the bundle is already in the evaluation, don't add a
  duplicate (or at least make it easy to remove the dupe).
- Which catalog item is the "trigger" for auto-add? Options: (a) mark a bundle with a
  `triggerScopeItemId` (the demising wall) so adding THAT item fires the bundle; (b) or
  keep auto-add manual-button-only for v1 and add the trigger later. Lean: implement the
  manual "Add Bundle" button FIRST (safe, no eval-write surprise), then layer the
  auto-trigger.

### Build location + caution
This is the ONLY bundle piece that WRITES into the evaluation's line items (money math).
Everything else (tables, bundle admin UI, routes) is additive and done. Build this piece
carefully, fresh, verified with click-and-watch — it drops rows into the eval. Reuse the
existing "add catalog item to eval" path (master-item picker drop), just looped over the
bundle's items. Each added line must carry the same shape as a normally-added line so it
prices correctly at Step 4 (context-aware pricing).

### Status of bundles feature
- DONE: schema (scope_bundles + scope_bundle_items), storage CRUD, routes, admin UI
  (create bundle + add/remove items) — all shipped, additive, verified.
- TODO (fresh session): the expansion-into-evaluation described above.
