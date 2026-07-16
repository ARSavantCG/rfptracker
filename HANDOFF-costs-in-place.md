# Costs-in-Place Report + Office-Aware $/SF — Handoff Notes

**Branch:** `feature/costs-in-place-report` (pushed to origin, NOT yet merged/deployed to real production)
**Tested on:** Railway staging (`rfptracker-production.up.railway.app`) against **production Neon data** — full click-through verified.
**Session date:** 2026-07-14

---

## What was done

Built a Costs-in-Place report and the office-aware $/SF model behind it, plus several fixes surfaced along the way.

### 1. ROM activePrice staleness fix (`server/rom-routes.ts`)
- **Bug:** `activePrice` on a ROM scope item only recalculated when the user re-clicked "Save Price Mode." Adding or deleting a contractor quote left the average/contractor price stale.
- **Fix:** Extracted `recalculateScopeItemActivePrice(scopeItemId, modeOverride?)` and call it after quote add, quote delete, and from the pricing-mode PATCH (which now passes explicit mode fields). One code path, three callers.

### 2. Costs-in-Place report (`server/costs-in-place-report.ts` — new file)
- `GET /api/reports/costs-in-place?propertyId=X` → single-property; no param → portfolio roll-up (all properties packaged, area breakdown in the summary).
- Server-rendered HTML, `<colgroup>` fixed-layout tables, auto-print. Registered in `server/routes.ts` via `registerCostsInPlaceReportRoutes(app)`.
- **Costs are in CENTS** in `property_existing_improvements`; divided by 100 exactly once, at the report edge.

### 3. Office-aware $/SF denominators
The `$/SF` denominator is chosen per improvement by a **basis**, defaulting by category (overridable per-item via `denominator_basis`):
- `own-area` → the item's own `areaSf` (spec-office). Falls back to property office SF if the line has no `areaSf`.
- `warehouse-net` → `rentable SF − total office SF` (lighting, hvac). If office SF is unknown (0), falls back to full rentable and flags the label with `*`.
- `whole-property` → full rentable SF (fire-alarm, restrooms, custom).
- `none` → dash (demising walls).
- Defaults live in `DEFAULT_DENOMINATOR_BASIS_BY_CATEGORY` + `resolveDenominatorBasis()` in `shared/schema.ts`.
- **Dropped the "Blended $/SF" line** (portfolio and per-property): summing costs with different denominators over one area figure is not a meaningful rate. Report shows total cost + area breakdown (Rentable · Office · Warehouse) instead.
- Report column header renamed **"SF Basis" → "Area (SF)"**.

### 4. Office SF as single source of truth (bay config)
- Office SF now lives on the bay: `officeSquareFootage` (whole bay) and `splitNorthOfficeSquareFootage` / `splitSouthOfficeSquareFootage` (split halves). Entered in **Manage Bay Configurations**; an "Office SF" input appears when the Speculative Office checkbox is ticked (whole bay AND each split half).
- `derivePropertyOfficeSf()` branches on `canBeSplit` to sum the right fields.
- **One-way flow:** bay config is authoritative → the spec-office cost line's `areaSf` is seeded from summed bay office SF via the existing "+ Add Spec Office Costs" button. User enters only the cost; the SF acts as a validation anchor.

### 5. Reports consolidation
- Costs-in-Place lives in the **Reports hub** (`/reports`) as its own card with a property dropdown (blank = portfolio). Removed the ad-hoc buttons from the Property Data Audit header and the Manage Costs in Place modal.
- Renamed the mislabeled **"Vendor Workload" nav link → "All Reports"** (it points to the reports hub, not vendor workload).

### 6. Auth fix (`client/src/pages/reports.tsx`)
- **Bug:** report fetches used `credentials: 'include'` only → 401. `requireAuth` is **Bearer-header-only** (does not read cookies).
- **Fix:** all report fetches now send `Authorization: Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`. This also repaired the pre-existing Executive/Historical/Vendor Workload buttons, which had the same latent 401.

### 7. Railway deploy fixes (only relevant if deploying off Replit)
- `server/index.ts` port was hardcoded to 5000 ("only non-firewalled port" — a Replit-ism). Now `parseInt(process.env.PORT || "5000")`.
- Added `Dockerfile` + `railway.json` (Nixpacks image assembly was failing). `NODE_ENV=production` must be set **after** `npm ci` or devDeps (vite/esbuild) are skipped and the build errors with "vite: not found."

---

## Schema migrations — ALREADY APPLIED TO NEON

Applied via the one-off Railway migration tool (branch `tools/db-migrate`), verified against host `ep-still-mud-a6uzawf6.us-west-2.aws.neon.tech`:

| Migration | Column | Verified |
|---|---|---|
| `0002_costs_in_place_area_sf.sql` | `property_existing_improvements.area_sf` (integer, nullable) | ✅ |
| `0003_costs_in_place_denominator_basis.sql` | `property_existing_improvements.denominator_basis` (text, nullable) | ✅ |

Office SF fields ride in the existing `bay_configurations` JSON column — **no migration needed** for those.

**Before deploying real production:** confirm both columns exist on Neon (they do). Do NOT assume they're missing and re-run blindly.

---

## Deploy checklist (when Replit is back)
1. Merge `feature/costs-in-place-report` → `main`.
2. Confirm migrations 0002 + 0003 present on Neon (already applied — verify, don't re-run).
3. Deploy on Replit. Republish → push to GitHub.
4. **Teardown/security:**
   - Delete the Railway project (public URL pointing at prod data).
   - Revoke the GitHub PAT pasted this session.
   - Rotate the Neon password (was in chat + Railway env).
   - Rotate `MIGRATE_TOKEN` if keeping the tool branch.

---

### 8. `/uploads/*` security fix (`server/middleware.ts`, `server/routes.ts`, client)
- **Bug:** `/uploads/*` had NO auth — every uploaded file (contractor PDFs, proposals, attachments) was downloadable by anyone with the URL. Registered before session middleware, fully public.
- **Constraint:** files open via `window.open` (proposals-library) and `<iframe src>` (bid-tagging-modal) — browser navigation that **cannot send an Authorization header**. This is why the route was left open.
- **Fix:** new `requireAuthFlexible` middleware accepts the token from the `Authorization` header OR a `?token=` query param. `/uploads/*` now uses it. Frontend `withAuth(url)` helper (in `client/src/lib/auth-constants.ts`) appends `?token=` at the two consumer sites.
- **Verified:** `GET /uploads/x` with no token → 401.
- **Tradeoff:** token appears in the URL (history, logs). Acceptable given short-lived tokens; the documented next step is **signed short-lived URLs** — `withAuth()` and `requireAuthFlexible` are the two functions to swap for that upgrade.

### 9. Per-item $/SF basis override (`client/src/components/property-existing-improvements-modal.tsx`)
- The improvements form now has a **"$/SF Basis"** dropdown: *Auto (by category)* = null = smart category default; plus explicit *Warehouse (rentable − office)*, *Whole Property*, *Own Area*.
- Populates `denominator_basis` (column already on Neon from migration 0003). Hidden for demising walls.
- Use case: a warehouse lighting item that also covers an office → override to Whole Property so it divides by full rentable instead of warehouse-net.

### 10. Demising wall improvements (`property-existing-improvements-modal.tsx`)
- **Live cost-split preview** in the form: enter one total + Left/Right %, see each side's dollar amount (warning if % ≠ 100).
- **Per-side split shown in the list** under each demising wall's description.
- **4-tenant guidance + duplicate-wall warning:** a demising wall where the building is split N/S can have up to 4 tenants. Model (Adolfo's call) = **two records, each holding HALF the wall cost**, 50/50 within its N or S half. Guidance box explains it; a warning fires when two demising records share the same bay pair (likely double-count). Common case: one record, full cost, 50/50. Spend-to-date tracks natively via each record's forecast/committed/actuals.

### 11. Occupancy report (`server/occupancy-report.ts` — new file)
- `GET /api/reports/occupancy` → printable portfolio report (rentable/leased/vacant SF, occupancy %, vacancy %, tenants). `GET /api/occupancy/summary` → JSON for property-card badges.
- **Occupancy % = leased SF / rentable SF** (CRE-standard; vacancy = complement). "Occupied" = any signed lease, no date filter.
- **CRITICAL derivation:** occupied SF per lease = override → stored `rentableSquareFootage` → **fall back to summing assigned bays' SF**. Many leases store only bay selections (the UI computes SF live but doesn't persist it), so without the bay-sum fallback occupancy reads 0. Matches `lease-management-modal.tsx`. Capped at 100%, color-coded.
- Property-card badge on `properties.tsx`, fed by `/api/occupancy/summary`. Guarded with `requireAuthFlexible`.

## Lessons banked
- **Run migrations against `$DATABASE_URL` from INSIDE the production environment, not a copied connection string.** Migrations 0002/0003 were applied via the Railway tool using a connection string, but production Replit reads a different Neon instance — so the columns were missing on prod and the Costs-in-Place report 500'd (`db.select()` throws when a schema column is absent). Fix was `psql "$DATABASE_URL" -c "ALTER TABLE ... ADD COLUMN IF NOT EXISTS ..."` from the Replit shell. This is the two-database trap in a new costume: "verified in one DB, broken in the other." Always migrate the DB the app actually reads.
- **`requireAuth` is Bearer-header-only.** Any client fetch to a guarded route needs `Authorization: Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`, not just `credentials: 'include'`. Audit other pages for the `credentials: 'include'`-only pattern.
- **Browser-navigation resources can't send headers.** Anything loaded via `window.open`, `<a href>`, `<img src>`, or `<iframe src>` cannot attach an Authorization header. To protect such a route, use `requireAuthFlexible` (header OR `?token=` query param) server-side and `withAuth(url)` client-side. This is the reusable pattern for any future protected file/resource served this way.
- **Bay config has TWO render paths** — an "Add New Bay" form and an "Edit Bay" modal — that don't share a component. Any new bay field must be added in **both** (this bit us once: Office SF worked in Add but not Edit).
- **Bay-config split-half fields** (`splitNorth/South*`) must be declared in the `newBay` useState initializer, not only in reset blocks — otherwise the inferred state type is incomplete and every reference errors. Completing the initializer fixed 23 pre-existing TS errors as a bonus (761 → 738 total).
- **Office SF is three-tiered:** whole-bay (`officeSquareFootage`) OR split halves (`splitNorth/SouthOfficeSquareFootage`) when `canBeSplit`. `derivePropertyOfficeSf` and the modal seed logic both branch on `canBeSplit`.
- **Port hardcoding** ("ALWAYS 5000 / only non-firewalled port") is a Replit-ism that breaks any other host. Honor `process.env.PORT`.
- **Denominator label tags** in the report tell you the SF source: `(entered)`, `(office)`, `(warehouse)`, `(rentable)`, `(rentable*)` = couldn't net office. This transparency is the validation layer.

## Deferred / future
- ~~Per-item `denominator_basis` override UI~~ — **DONE** (section 9).
- **`/uploads/*` → signed short-lived URLs.** Current fix (section 8) puts the token in the URL. Upgrade to HMAC-signed, time-limited URLs to remove that: change `withAuth()` (client) to fetch a signed URL, and `requireAuthFlexible` (server) to verify the signature instead of the token. Both are single-purpose functions for exactly this reason.
- Fold the migration endpoint into the app as a token-guarded `/admin/migrate` route so schema changes apply from the running app without branch-swapping on Railway.
- Root-level cleanup: `test-costs-in-place.ts` and stale `*_cookies.txt` files in repo root (session cookies in a repo = same risk class as a hardcoded token — delete + gitignore).

---

## Session 2026-07-16 (evening) — next-session priorities

- **TOP: fix 5 duplicate methods in `server/storage.ts`** (getAllRomScopeItems,
  createRomScopeItem, updateRomScopeItem, deleteRomScopeItem,
  deleteEvaluationBudgetHistory — each defined ~twice, e.g. lines 1187 & 1367). JS
  uses the SECOND; they DIFFER (first getAllRomScopeItems sorts by category/name, the
  second doesn't → catalog currently returns UNSORTED). Keep the correct one, delete
  the dup. Verify carefully — load-bearing.
- **Extend Calculation Basis** to Permit Fees, Construction Management, Contingency
  (Builder's Risk done; others still use description-matching in evaluation-budget.tsx).
- **Reconcile Replit Agent auto-publishing** — it commits "Published your App" and
  builds from its own workspace, fighting the GitHub-first flow. Decide: Agent off.
- **Type cleanup (low priority):** 738 total / 83 in eval-budget. Safe: `allData`
  annotation, null-safety. Skip the ~25 "property doesn't exist" (retyping API = risk).

### Lesson banked this session
- Catalog modal (rom-scope-items-modal.tsx) has MULTIPLE render paths. The Calculation
  Basis field was added to a non-editable section first; it compiled into the bundle but
  never showed because the actual edit form (2nd "Edit: {item.name}" heading) lacked it.
  ALWAYS grep the edit-form heading count and confirm which path is editable before
  declaring a form field done. A changed bundle hash confirms new code shipped.
