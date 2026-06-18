---
name: Actuals vs ROM feature
description: Design decisions for the leased-project Contract Actuals section — getOrCreate pattern, DB schema, exclusive linking, and where the UI slots.
---

## Rule
`project_actuals` rows tied to an RFP are created on-demand via `GET /api/rfp-requests/:rfpId/actuals` (getOrCreate). Never create manually or via the historical-import path for leased projects; source field = "leased_actuals".

**Why:** Guarantees at-most-one record per RFP without a UNIQUE constraint migration; fetch-or-create is idempotent and safe to call repeatedly.

**How to apply:** Any UI that needs the actuals for a leased RFP calls this endpoint (enabled only when `isLeased = true`). The endpoint lives in `server/actuals-routes.ts` and is registered via `registerActualsRoutes`.

## DB columns added (migration already applied)
- `project_actuals.completed_date` — nullable (was NOT NULL)
- `project_actuals.total_actual_cost` — nullable (was NOT NULL)
- `project_actual_line_items.vendor_name` — text, nullable
- `project_actual_line_items.linked_master_item_ids` — jsonb NOT NULL DEFAULT '[]'

## Merge rule (CRITICAL)
PATCH `/api/project-actuals/:id/line-items/:lineItemId` uses a conditional merge — only fields present in the request body are updated. `vendorName` and `linkedMasterItemIds` are in this merge. Never overwrite `linkedMasterItemIds` with null on unrelated edits.

## ROM lines — linkability
Evaluation budget lines are only linkable if `masterItemId != null`. Roughly 25% of lines across all budgets are linkable (294 of 1153). Null-masterItemId lines are custom/assembly/"Other" entries.

## UI slot
`RfpActualsSection` component (`client/src/components/rfp-actuals-section.tsx`) is imported into `rfp-detail-modal.tsx` and rendered at the bottom of the left `lg:col-span-2` column, after the Notes section.

## Dollar storage
- ROM totalPrice: stored as dollar string (e.g. "419750.00") — parse with parseFloat
- Actual line totalCost: stored in cents (integer) — divide by 100 for dollars
- Form input: user enters dollars → backend `dollarsToCents()` converts to cents
