# DESIGN — ROM as a MODE of the RFP (not a separate record)

Author: Adolfo (intent) + Claude (plan), 2026-07-21. Supersedes the fork-creates-a-pilot
half of DESIGN-rom-pilot-convergence.md. Spec tags (DESIGN-context-aware-pricing.md) are
unaffected in substance — only in where they write.

## The rule

> An RFP that goes the ROM route keeps everything ON THE RFP and opens the SAME
> Evaluation screen everyone else sees — identical layout and behavior — except the
> team member cannot change unit rates. The ROM Pilot tab holds ONLY ROMs started
> directly there, with no parent RFP.

Today the fork creates a second record in `rom_pilots` with its own line items
(`rom_pilot_line_items`), its own modal (`rom-pilot-scope-modal-new.tsx`) and its own
report. That is the thing being removed for RFP-originated ROMs.

## Why this is worth doing

`evaluation-budget.tsx` and `rom-pilot-scope-modal-new.tsx` render the same concept twice.
That is the duplicate-edit-form bug (2026-07-20) one level up: a field or behavior added to
one silently does not exist in the other. Spec tags currently work in the ROM modal and
nowhere else. Collapsing to one surface removes the class of bug, not just an instance.

## What already exists (no new plumbing needed)

- **`rfpRequests.pricingPath`** — `'development' | 'rom_pilot'`. THE MODE FLAG. Already
  set by the fork. No new column.
- **`evaluationBudgets`** — one row per RFP (`rfpId`), line items stored as JSON arrays:
  `tenantImprovements`, `designSoftCosts`, `existingImprovements`. Saved via
  `POST /api/rfp-requests/:rfpId/evaluation-budget` (guarded `checkPermission('rfp.edit')`).
- **`EvaluationLineItem.masterItemId`** — already links an evaluation row to a
  `rom_scope_items` catalog row, with `masterItemSnapshot` alongside. THIS IS THE JOIN
  POINT for both rate lock and spec tags. No new field.
- **`romPilots.linkedRfpId`** — how we tell RFP-originated pilots from standalone ones.
- **`server/spec-tag-resolver.ts`** — entity-agnostic. Takes a context and a catalog item.
  Reused verbatim.

## Slices

### Slice 0 — Permissions (BLOCKING; do first)
JJ is role `user`. Today `user` carries view-only permissions, so under ROM mode he could
see his budget and take a 403 on save. Adolfo's intent: the leasing team CREATES step 1
and runs ROMs; what they must never do is change unit rates.

- **Mechanical note:** `checkPermission` reads the per-user `users.permissions` JSON
  column, NOT `ROLE_PERMISSIONS` — the role map is only a seed. Changing the map does
  NOT fix existing accounts. Backfill JJ's row (and any other `user`) in the same change,
  via startup migration or an admin action.
- **Grant to role `user`:** `rfp.create`, `rfp.edit`, `rom.create`, `rom.edit`
  (plus existing views).
- **NEW permission `pricing.edit`** — granted to `admin` and `manager`, withheld from
  `user`. Rationale: `rfp.edit` alone would let a leasing user open a DEVELOPMENT RFP and
  edit unit rates, because a mode-only lock doesn't know who is looking. And a blanket
  "non-admins can't edit rates" would break the dev team — `manager` has no `admin.access`
  but must enter contractor bid pricing.
- **Resulting lock rule (supersedes slice 2's mode-only version):**
  unit rates are read-only when `pricingPath === 'rom_pilot'` **OR** the user lacks
  `pricing.edit`. Enforced SERVER-SIDE on the evaluation save; the greyed input is only
  the courtesy.
### Slice 0b — Ownership scoping (DECIDED 2026-07-21, blocking with 0)
Adolfo: a `user` may modify only what they created — full RFP, ROM-route RFP, or a
standalone ROM Pilot. An `admin` may modify anything. `rfp.edit` alone is global, so
granting it in slice 0 WITHOUT this would widen access, not narrow it.

- **The data problem, resolve first:** `rfpRequests.createdBy` and `romPilots.createdBy`
  are NULLABLE TEXT holding a DISPLAY NAME ("Adolfo Reutlinger"), not a user id. Scoping
  on a display name breaks when a name is edited and collides if two people share one.
  Add `createdByUserId` (additive startup migration) to both tables, backfill by matching
  the existing text against users, and scope on the ID.
- **Before enabling, COUNT the rows that backfill cannot resolve** (null or unmatched
  `createdBy`). Report the number. Do not enable scoping until that set is known — a
  silent lockout of historical records is the failure mode here.
- **Unresolved-owner rule: fail CLOSED.** A record with no resolvable owner is
  admin-only. Never treat "no owner" as "anyone".
- **Implementation:** one middleware, `requireRecordOwnershipOrAdmin`, that loads the
  record and passes if `admin.access` OR `record.createdByUserId === req.user.id`. Applied
  to every MUTATING route, not just the evaluation save — otherwise scoping is theatre.
  Known surface: the 6 `checkPermission('rfp.edit')` routes in routes.ts (PATCH rfp,
  advance-phase, bid-collections ×3, evaluation-budget), `fork-to-rom`, the ROM line-item
  write routes, and the ROM pilot update/delete routes. Enumerate and confirm the full
  list at build time rather than trusting this one.
- **Reads stay unscoped** unless Adolfo says otherwise: JJ can SEE the portfolio, he just
  can't change what isn't his. (Confirm — this is an assumption.)

- **Superseded note:** the earlier "open question" about global `rfp.edit` is now answered
  by this slice.

### Slice 1 — Seed the RFP's evaluation budget, not a pilot
`POST /api/rfp-requests/:id/fork-to-rom` stops creating a `rom_pilots` row. Instead:
- set `pricingPath = 'rom_pilot'` on the RFP;
- build the spec context via `buildSpecContext(rfp, bays)` (unchanged);
- walk the template exactly as today — variant selection, first-quantity-tag-wins,
  notes stamping all identical — but emit `EvaluationLineItem[]` with `masterItemId` set
  to the catalog id, and write them into `evaluationBudgets.tenantImprovements` /
  `.designSoftCosts` by category.
- **Type note:** `EvaluationLineItem.quantity` is a NUMBER; `romPilotLineItems.quantity`
  is TEXT. Convert at the boundary, do not carry strings across.
- The endpoint name stays (`fork-to-rom`) so existing callers don't break; only its effect
  changes.

### Slice 2 — Rate lock on the evaluation save path
`enforceRomRateLock` currently guards the ROM line-item endpoints. The evaluation endpoint
was built for contractor bids, where editable pricing is the entire point — so the lock is
CONDITIONAL on mode:

On `POST /api/rfp-requests/:rfpId/evaluation-budget`, if `rfp.pricingPath === 'rom_pilot'`:
- every row WITH a `masterItemId` gets `unitPrice` FORCED from the catalog
  (`activePrice ?? unitPrice`) and `totalPrice` recomputed server-side;
- rows WITHOUT a `masterItemId` (custom free-text) are allowed ONLY for `admin.access`;
  non-admins get 403 with the catalog-only guidance already used in the ROM modal.
- if `pricingPath === 'development'`, behavior is byte-for-byte what it is today. This
  must be regression-tested explicitly — the dev team's bid workflow cannot change.

A read-only input is not a lock: the server must not trust the body regardless of what
the client renders.

### Slice 3 — Client: one screen, two modes
`evaluation-budget.tsx` gains a `romMode` boolean (from `rfp.pricingPath`). In ROM mode:
- unit price renders read-only/greyed with the lock affordance and the existing
  "Quantities are yours — unit rates come from the catalog and are locked" banner;
- the MasterScopeItemPicker stays (catalog-only is the point);
- "Add custom item" is hidden for non-admins (server already 403s — this is the friendly
  version, matching what the ROM modal does today);
- everything else is unchanged, which is the requirement.

### Slice 4 — Fees and spec tags follow the line items
- **Fee engine:** `computeRomFeeTotals` keys off the catalog row; in the evaluation
  budget it keys off `masterItemId` instead of `scopeItemId`. Same math, same
  percent-from-name extraction.
- **Spec-tag refresh:** add `GET /api/rfp-requests/:rfpId/spec-tags/preview`, the twin of
  the ROM-pilot one shipped in ccb85189. Identical body; different lookup of items and
  context. Extract the shared proposal-builder so there is ONE implementation.
- The row-level recompute icon and the previewed bulk dialog port to
  `evaluation-budget.tsx` as-is.

### Slice 5 — Report and the ROM Pilot tab
- ROM report generation currently reads `rom_pilots` + `rom_pilot_line_items`. It learns
  to read an RFP in `rom_pilot` mode + its evaluation budget. Same output.
- The ROM Pilot list filters to `linkedRfpId IS NULL` — standalone ROMs only, which is
  the stated rule.
- Standalone ROM pilots keep working exactly as they do now. This design does NOT touch
  them.

### Slice 6 — Existing forked pilots
All current RFP-originated pilots are test data (JJ is not live). **Delete and re-fork.**
No migration code — it is pure cost and pure risk for a handful of throwaway records.
Before deleting, confirm with Adolfo that none are real work.
Cleanup list: pilots 17-20, catalog test items 79/80, RFPs 203/204, plus the Tester Miami
Station pilot.

## Deferred until this lands (they live wherever the line items live)

1. **Fee base definition.** All percent fees currently share ONE base: every non-percent
   row. Adolfo's requirement differs per fee (permit = % of construction; contingency = %
   of all costs). `CALCULATION_BASES` already has `pct-ti-total` / `pct-construction-total`
   but the fee engine ignores `calculationBasis`. Needs Adolfo's three answers first:
   permit base = TI subtotal only? contingency excludes other fees? CM before or after
   contingency? Each moves real money.
2. **Percent-row display.** Rate shows as `$0.05` instead of `5%`, and quantity shows an
   editable `1` the engine forces anyway. Both columns lie about what they hold.

## Acceptance tests

1. Fork an RFP to ROM → NO new `rom_pilots` row; the RFP's evaluation budget holds the
   seeded rows; `pricingPath = 'rom_pilot'`.
2. Open that RFP → the SAME evaluation screen a development RFP shows, with unit price
   locked and quantity editable.
3. As a non-admin, POST an evaluation budget with a modified unitPrice → saved value is
   the CATALOG price, not the submitted one. (Test via API, not just the UI — a greyed
   input proves nothing.)
4. As a non-admin, POST a row with no `masterItemId` → 403 with catalog-only guidance.
5. A `development` RFP's evaluation behaves EXACTLY as before for a MANAGER — unit prices
   editable, bids intact. Explicit regression; this is the test protecting the dev workflow.
5b. A role-`user` account on a DEVELOPMENT RFP: quantities editable, unit rates NOT
   (lacks `pricing.edit`). Verify by API, not by looking at the input.
5c. JJ's ACTUAL account can create an RFP, fork to ROM, edit quantities and save without a
   403 — proving the slice 0 backfill reached his existing row, not just new accounts.
5d. JJ CANNOT modify an RFP created by someone else — 403 on PATCH, on evaluation-budget
   save, and on fork-to-rom. Test every mutating route, not one of them.
5e. An admin CAN modify that same RFP.
5f. A record whose owner could not be backfilled is admin-only, and JJ gets 403 rather
   than silent success.
6. Spec tags: a tagged demising row seeds the right variant with a computed quantity, on
   the RFP, with the notes stamp.
7. Refresh from property specs works on the RFP surface, and still proposes ONLY tagged
   rows.
8. ROM report renders from an RFP in ROM mode.
9. ROM Pilot tab shows standalone ROMs only.
10. **At least one gate is a human tap or Playwright pass on the real rendered page, in
    the default view.** All 7 gates passed on 2026-07-19 while the spec-tag editor was
    invisible in production because every UI check was an API call or a source read.

## Risks

- **Blast radius.** `evaluation-budget.tsx` and its save endpoint are core to the
  development workflow. Test 5 is the one that protects it.
- **Two write paths during transition.** Until slice 5 lands, ROM data could exist in both
  places. Do slices 1-3 in one push, not spread over sessions.
- **RESOLVED (was: confirm JJ's role).** JJ is role `user`, which today lacks `rfp.edit`
  entirely — ROM mode would have 403'd him on save. Slice 0 fixes it and is BLOCKING.
- **Open from the last session, unrelated but still open:** `PUT /api/rom-scope-items/:id`
  is `requireAuth`-only, so a non-admin can edit the CATALOG (prices AND spec tags)
  directly. That undermines rate lock from behind regardless of which surface renders it.
  Fix in the same sweep.
