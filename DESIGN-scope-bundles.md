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
