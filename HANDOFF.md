## Product Vision — Phase 2 Platform Expansion

### Strategic Goal
Transform RFP Tracker from a TI project management tool into a full lease pipeline intelligence platform used by Development Managers, Leasing Teams, and Executive Leadership.

### Three User Tiers
1. **Admin/Development Manager (Adolfo)** — full access, all features
2. **Leasing Team** — pipeline view, ROM generator, no contractor/pricing data
3. **Executive Team** — read-only portfolio dashboard, high-level metrics only

### Lease Lifecycle to Track
Prospect → LOI → Lease Execution → TI Design → Construction → Occupancy

### Build Phases

**Phase 1 — Dashboard Redesign (COMPLETE)**
- Attention Required cards (overdue RFPs, bids awaiting evaluation, upcoming deadlines)
- Pipeline value tracking (total active TI value by property)
- Portfolio intelligence summary (avg $/SF, trends, most active property)
- Action-oriented layout replacing current status count layout

**Phase 2 — Lease Lifecycle Tracking**
- Add LOI stage before RFP received
- Track lease execution details (TI allowance, term, commencement date)
- Connect lease data to existing RFP workflow
- Lease expiration tracking with 18/12/6 month alerts

**Phase 3 — Executive Dashboard**
- Separate read-only view for ownership/leadership
- Portfolio-wide TI spend by property and quarter
- Active deal count and total pipeline value
- Export to PDF for board meetings

**Phase 4 — Leasing Team Access**
- Simplified pipeline view
- ROM generator access for prospect conversations
- No access to contractor bids, pricing intelligence, or financials

**Phase 5 — Lease Expiration Intelligence**
- Track all active leases across portfolio
- Auto-alert when leases are 18/12/6 months from expiration
- Auto-generate renewal RFP workflow

### Key Dashboard Metrics to Show
- RFPs past internal due date (attention required)
- Total active pipeline TI value ($)
- Pipeline by property
- Average TI cost/SF current year vs prior year
- Days from RFP received to evaluation complete (velocity)
- Largest active deal
- Leases expiring in next 12 months

### Design Principle
The dashboard should answer: "What needs my attention TODAY and how is my portfolio performing?"
Not: "How many RFPs are in each status bucket?"

---

## End of Session Checklist
- [ ] Republish the app (Republish button)
- [ ] Push to GitHub (Git tab → Push button)
- [ ] Update HANDOFF.md with what was accomplished and what's next

---

RFP Tracker — Savant Portal Integration
Project Handoff Document
Session Date: April 15, 2026

What this project is:
A commercial real estate RFP management system built for Bridge Industrial, hosted at rfptracker.app on Replit with a Neon PostgreSQL database. The codebase is TypeScript full-stack — React/Vite frontend, Express backend, Drizzle ORM.
GitHub: https://github.com/ARSavantCG/rfptracker

What was accomplished this session:

✅ Seeded master_categories table to 32 categories (added Dock Equipment, Flooring & Wall Finishes, Office Build-out, Warehouse Lighting, Permits & Fees, Insurance & Bond, Contractor Fee/OH&P, Contingency, Interior Storefront/Glazed Partitions, Cabinetry, Solid Surface Countertops, Remote Restroom(s))
✅ Category dropdown on bid line items — compact 160px dropdown per untagged row in bid-view-modal.tsx; tagged rows show blue pill + clear button; selection PATCHes /api/bid-line-items/:id/mapping
✅ Keyword auto-suggest on bid modal load — keywords (general conditions, overhead/profit, insurance, bond, permit, fee) match description text and pre-populate dropdown with amber styling + ✓ confirm button; user must confirm before saving
✅ Grouped import rollup in evaluation-budget.tsx — tagged items grouped by masterCategoryId (summed totals, category name as description, unit "ls"); untagged items pass through individually
✅ PDF bid import "first clean table only" detection — server/pdf-parser.ts now drops junk rows (blank, pure-number, parentheses-only, header phrases like "QTY UNIT", "PRICE", "SHELL AREA", "OTHER AREA", "TOTAL AREA") and truncates at end of first contiguous clean block (3 consecutive non-clean rows triggers cutoff)
✅ Stripped all 55 debug console.log statements from evaluation-budget.tsx (105 lines removed including multi-line objects for parking calc, electrical calc, tiered pricing, auto-calculations, drag operations)


Current file structure:
server/
├── routes.ts          (5,886 lines — orchestrator)
├── middleware.ts      (179 lines — requireAuth, checkPermission, upload)
├── auth-routes.ts     (351 lines — login/logout/passwords)
├── rom-routes.ts      (854 lines — ROM Pilot + report generator)
├── property-routes.ts (2,064 lines — properties, electrical, bays)
├── html-generators.ts (713 lines — bid/report HTML generators)
├── pdf-parser.ts      (491 lines — PDF table extraction + clean-block filter)
└── ai-routes.ts       (AI bid analysis)

Key components:
client/src/components/
├── bid-view-modal.tsx      — category dropdown + keyword auto-suggest
├── evaluation-budget.tsx   — grouped import rollup, parking/electrical calc (debug-clean)
└── pdf-bid-import-modal.tsx — PDF import flow (column mapping + review screens)

Environment secrets (Replit):

DATABASE_URL — Neon PostgreSQL
SESSION_SECRET
SENDGRID_API_KEY
ANTHROPIC_API_KEY — key named "RFPTracker" in Anthropic console


Active users and permissions:

Adolfo Reutlinger — admin, full access including AI
Francis Roura — create/edit, no AI
Eduardo Diaz — create/edit, no AI
John Mejia — view + user management, no AI
Brenda Gonzalez — view only, no AI


## Recently Completed

✅ **Phase 1 — Quarterly Pricing Intelligence** (complete)
- `QuarterlyPricingPanel` component: quote table, add-quote form, price intelligence summary cards, active price mode selector
- Integrated into ROM scope items modal with BarChart2 toggle button on every TI and non-TI row
- ROM calculator uses `activePrice` (catalog / contractor / manual override) in both calculations and HTML export
- PATCH `/api/scope-items/:id/pricing-mode` route with `selectedContractorName` and `manualOverridePrice` fields

✅ **Phase 2 — Project Actuals & Historical Intelligence** (complete)
- `project_actuals` and `project_actual_line_items` database tables (full CRUD + benchmarks intelligence endpoint)
- Historical Import page (`/historical-import`): manual entry tab + CSV import tab with downloadable template
- Benchmarks Dashboard (`cost-benchmarks.tsx`): Low/Avg/High $/SF by category × area type, spread % color coding, ROM diff comparison, one-click "Update ROM Price"
- ROM Pilot Benchmarks tab added alongside existing estimates list
- Record Project Actuals section at the bottom of every Evaluation Budget view — pre-populated from RFP + budget data, Save / Skip options, success state with Benchmarks link

✅ **Proposals Library & Bid Tagging System** (complete)
- Proposals Library page (`/proposals-library`): card grid of all bid collections with PDF attachments, search/filter by contractor/year, summary stats bar
- Shared `BidTaggingModal` component: split-panel with PDF iframe on left, dynamic tagging table on right (Description, Total $, Unit $, Qty, Unit, Scope Item dropdown grouped by category, Quarter, Notes)
- Quarter auto-populated from bid submission date; scope item dropdown pulls all ROM scope items
- "Tag Prices" button added to bid view modal header — pre-populated from existing bid line items for fast one-click categorization
- Backend: `server/proposals-routes.ts` with GET /api/proposals, GET /api/proposals/by-contractor/:id, GET /api/proposals/search, POST /api/proposals/:id/tag-line-items
- "Proposals" nav link added between "Reports" and "ROM Pilot"

✅ **Area Parsing Fixes — parseInt → parseFloat (April 15, 2026)**
- 8 occurrences of `parseInt` on `rfp.warehouseArea`, `rfp.projectArea`, and `rfp.warehouseAreaOverride` replaced with `parseFloat(value.toString().replace(/[^0-9.]/g, ''))` to correctly handle formatted strings like "397,164 SF (calculated from selected bay configurations)"
- Files changed: `rfp-validation-modal.tsx` (4 fixes), `evaluation-budget.tsx` (5 fixes), `rfp-detail-modal.tsx` (1 fix)

✅ **Object Storage Integration (April 15, 2026)**
- `server/storage-backup.ts`: fire-and-forget backup on upload, presigned-URL fallback serving, migration helper
- `server/middleware.ts`: custom `DiskWithBackupStorage` multer engine writes to disk and backs up to Object Storage
- `/uploads/*` route updated with Object Storage key fallback (`.private/uploads/<basename>`)
- Admin System Maintenance tab: migration button to backfill all existing uploads to Object Storage
- Admin routes: `GET /api/admin/migrate-uploads`, `GET /api/admin/list-storage-files`

✅ **Missing Schema Imports Fixed (April 15, 2026)**
- Added 6 previously missing insert/update schema exports to `shared/schema.ts` and imported them in `server/routes.ts`: `insertContactSchema`, `updateContactSchema`, `insertInvitationSchema`, `updateInvitationSchema`, `updateInvitationToBidSchema`, `insertPdfTemplateSchema`

✅ **Split-Bay Fixes (April 23, 2026)**
- Door calculation in `calculateDoorCounts` now handles `_north`/`_south` suffixed bay IDs: strips the suffix, finds the base bay in `propertyByIdData.bayConfigurations`, and reads `splitNorthDockDoors`/`splitNorthOversizedDoors` or `splitSouthDockDoors`/`splitSouthOversizedDoors` as appropriate; whole-bay IDs fall back to `standardDockDoors`/`oversizedDockDoors`
- `populateExistingImprovements` guard removed the `!rfp?.selectedBayConfigurations` block — improvements now load regardless of whether bay configurations are populated; `selectedBayIds` used as fallback for bay ID matching when `selectedBayConfigurations` is empty
- Area parsing fixed across 8 occurrences (`rfp-validation-modal.tsx`, `evaluation-budget.tsx`, `rfp-detail-modal.tsx`): `parseInt` → `parseFloat(value.toString().replace(/[^0-9.]/g, ''))` to handle formatted strings like "397,164 SF (calculated from selected bay configurations)"
- 6 missing schema imports added: `insertContactSchema`, `updateContactSchema`, `insertInvitationSchema`, `updateInvitationSchema`, `updateInvitationToBidSchema`, `insertPdfTemplateSchema`
- Bay-specific existing improvements now match using four-way normalized ID comparison (`rawId` and `strippedId` checked against both raw and normalized selected bay ID lists); deduplication via `seenIds` Set prevents double-counting when both a full bay and a split half are selected; cost is always 100% of `improvement.totalCost` (no proportional division); confirmed spec office shows full $1,200,654.74 for Mercado Libre; all debug logs removed

---

Known issues / next session fix list:
🔧 Bug Fixes:

1. MG Westside Bldg B split bays need dock door counts added to bay records
4. File Storage Migration (Phase 1 — immediate): Migrate file uploads to Replit Object Storage so files persist across redeploys. Prompt already written and ready to run.
5. File Storage Migration (Phase 2 — future): Migrate to Dropbox/S3/cloud storage like Savant Portal setup for proper enterprise file management with folder structure, sharing links, and version history.
2. ✅ RESOLVED — AI bid analysis debugging logs now live in production (API key presence, bid collection ID, Claude raw response first 500 chars). Ready to reproduce and diagnose "Analysis failed" in next desktop session.
3. ✅ RESOLVED — /api/version route already had try/catch fallback in place; confirmed no longer 500ing.
10. Fix GitHub CI/CD Pipeline — update .github/workflows so security scan and tests pass after routes refactoring, or simplify if automated testing is not a current priority

🏗️ Features to Build:
1. Master Cost Library — unified pricing database replacing ROM Scope Items
2. Workletter/broker PDF parser — Claude extracts scope checklist at Step 1
3. Email/notes parser — Claude captures construction requirements from team emails
4. ✅ COMPLETE — Historical cost benchmarking — $/SF by category from clean bid data (Phase 2)
5. Bulk-confirm all keyword suggestions in bid view modal (one-click "Accept All" button)

## Next Session Priority
1. PDF viewer in Proposals Library — Object Storage key path still pending (PDF iframe not loading from `.private/uploads/` key)
2. Tag prices from existing proposals into ROM scope items
3. Enter historical project actuals via Historical Import page
4. Test Benchmarks dashboard with real data
5. Remove debug logs added to server-side routes during earlier sessions (e.g. `Existing improvement applicableBays:` log in `server/property-routes.ts`)

How to start next session:
Paste this into Claude:
"I'm continuing work on the RFP Tracker / Savant Portal project. Here is the handoff document from our last session: [paste this document]. Let's start with [item from fix list]."

Key architectural decisions made:

Token auth only — no sessions (stored as auth-token with hyphen in localStorage)
AI features locked to admin.access permission only
Split bays use rentableSquareFootage field, not squareFootage
Property parking is proportional: (tenantSF / totalPropertySF) * propertyParking
PATCH /api/bid-line-items/:id/mapping requires BOTH masterCategoryId and isCleanData — always pass item.isCleanData ?? false
master_categories table: 32 rows; columns: id, name, description, sort_order, created_at
Cost amounts stored inconsistently — some as text strings, some as integer cents (future cleanup needed)
PDF parser clean-block cutoff: 3 consecutive non-clean rows after first clean block starts = end of table

---

## Session: April 24, 2026 — Phase 1 Dashboard Redesign

### Recently Completed

✅ **Phase 1 Dashboard Redesign (complete)**
- New backend endpoint: `GET /api/dashboard/metrics` (`server/dashboard-routes.ts`) — returns `attentionRequired`, `pipeline`, and `portfolioIntelligence` blocks in a single authenticated call; registered via `registerDashboardRoutes(app)` in `server/routes.ts`
- **`attention-required.tsx`**: Three side-by-side cards (grid-cols-3 on md+) — Overdue RFPs (red AlertCircle, daysOverdue in red-600), Bids Awaiting Evaluation (amber Clock, daysWaiting in amber-600), Upcoming Deadlines 7 days (blue Calendar, urgency-color coded: red ≤2d, amber ≤5d). Each row clickable via `handleOpenRfpById` which looks up the full RfpRequest from `allRfps` and calls the existing `handleSelectRfp`. Top 5 shown + "+N more" row. Green CheckCircle2 empty states.
- **`dashboard-pipeline.tsx`**: Single Card with three subsections — (A) two-stat summary row: Total Active TI Value (formatCurrency helper: M/K/raw) + Largest Active Deal (clickable, opens RFP); (B) horizontal bar visualization by property, bars scale proportionally to max TI value using `bg-primary`, top 8 shown + overflow count; (C) Most Active Property highlight with TrendingUp icon (omitted entirely when null).
- **`dashboard-portfolio-intelligence.tsx`**: Two-column grid — (A) Avg TI Cost per SF with YoY delta pill (red + TrendingUp if cost rose, green + TrendingDown if cost fell, muted "Flat" if 0, plain text if no prior year data) + "Add historical data →" link to `/historical-import` (wouter Link); (B) Avg RFP Cycle Time from velocity data with sample size + "Not enough recent data" italic empty state + verbatim `note` string from API as footnote.
- **StatsCards demoted to filter row**: Moved below the three intelligence sections, preceded by "Filter by status" `<h2>` heading (text-sm font-medium text-muted-foreground) with conditional "Clear filter" `<button>` (X icon + text, clears with `setStatusFilter("")`); mt-8 spacer separates it from intelligence sections above. Section titles ("Status", "Distribution", "Overview") removed from stats-cards.tsx; icons reduced from w-5 h-5 to w-4 h-4.
- All three dashboard components share `queryKey: ['/api/dashboard/metrics']` with `staleTime: 60_000` — single network request serves all three via react-query deduplication.
- `handleOpenRfpById(id: number)` helper added to dashboard.tsx: looks up `allRfps.find(r => r.id === rfpId)` and calls existing `handleSelectRfp`, identical path to table row click.

### Known Issues / Next Session Fix List

🔧 **Pipeline TI values render as $0** — `rfpRequests.estimatedValue` is blank for most active RFPs. Follow-up: backend fallback — if `estimatedValue` is blank, use the highest bid collection total or the evaluation budget grand total for that RFP.

🔧 **Portfolio Intelligence shows empty states** — `avgCostPerSfCurrentYear`, `avgCostPerSfPriorYear`, `yoyDeltaPct`, and velocity are all null/0 until `project_actuals` data is populated via `/historical-import`. Not a bug — data capture task.

🔧 **Velocity metric uses a proxy** — `completedDate − receivedOn` used as cycle time since no dedicated `evaluationCompleteDate` timestamp exists. Future: record timestamp on workflowPhase transition out of `'evaluation'` for a true velocity metric.

### Next Session Priority

1. **Phase 2 — Lease Lifecycle Tracking**: Add LOI stage before RFP received, lease execution details (TI allowance, term, commencement date), lease expiration tracking with 18/12/6 month alerts
2. Pipeline TI value backend fallback (use bid collection total or evaluation budget grand total when `estimatedValue` is blank)
3. Enter historical project actuals via `/historical-import` to populate Portfolio Intelligence cards with real data
4. PDF viewer fix in Proposals Library (Object Storage key path still pending)
5. Remove residual debug log `Existing improvement applicableBays:` in `server/property-routes.ts` ~line 565

---

## Session: April 29, 2026 — Three Bug Fixes

### Recently Completed

✅ **Fix 1 — Missing import causing PATCH /api/rfp-requests/:id/update-with-files to fail (April 29, 2026)**
- Root cause: `convertFormDateToDbDate` (exported from `shared/date-utils.ts` line 131) was called 9 times in `server/routes.ts` but never imported. The PATCH route's per-field try-catches swallowed the `ReferenceError`, set all dates to null, then the downstream DB write failed — returning "Failed to update RFP request" to the client.
- Fix: one import line added at `server/routes.ts` line 19: `import { convertFormDateToDbDate } from "@shared/date-utils";`
- The POST (create) route was not visibly broken because Drizzle-zod's `.parse()` coerces date strings to `Date` objects before the guarded call sites, so the function was never actually reached during creates.

✅ **Fix 2 — RFP Details modal "Rentable Area: Not specified" (April 29, 2026)**
- Root cause: `rfp-detail-modal.tsx` fetches a live RFP via `GET /api/rfp-requests/:id`, which uses `selectedBayIds` to filter live bay data from the property. For RFPs with split-bay IDs (`_south`/`_north` suffixed), the server-side filter `property.bayConfigurations.filter(bay => rfp.selectedBayIds.includes(bay.id))` returns empty because property bay IDs are unsuffixed — causing `liveRfp.selectedBayConfigurations = []`. The modal then showed "Not specified" because the empty live array masked the correct prop data.
- Fix: in `rfp-detail-modal.tsx` lines 401-421, added fallback so if `displayRfp.selectedBayConfigurations` is empty, it falls through to `rfp?.selectedBayConfigurations` (the prop) before falling back to `warehouseArea` and finally "Not specified". Same `reduce` logic (using `rentableSquareFootage || squareFootage`) unchanged.

✅ **Fix 3 — Rentable Area on evaluation page header (April 29, 2026)**
- Added a `<p className="text-sm text-muted-foreground mt-1">` line in the evaluation-budget.tsx Card header immediately below the `<CardTitle>`, showing "Rentable Area: {N} SF" formatted with thousands separator.
- Uses the existing `calculateRentableArea()` helper already defined in the file (line 1062) — no reimplementation.
- Hidden entirely (returns null) when the helper returns 0 or falsy — no "Not specified" on the evaluation page.
- Re-runs on bay configuration changes since `calculateRentableArea()` reads live `rfp.selectedBayConfigurations` inline.

### Files Changed
- `server/routes.ts` — Fix 1: one import line added (line 19)
- `client/src/components/rfp-detail-modal.tsx` — Fix 2: rentable area fallback logic (lines 401-421)
- `client/src/components/evaluation-budget.tsx` — Fix 3: rentable area display in Card header (lines 4794-4802)

---

## Session: April 29, 2026 (continued) — Punch List A & B

### Punch List A — Data Audit Results

Ran the following read-only query against production (Neon):
```sql
SELECT id, rfp_number, tenant_name, received_on, internal_due_date,
       created_at, updated_at
FROM rfp_requests
WHERE received_on IS NULL OR internal_due_date IS NULL
ORDER BY updated_at DESC
```
**Result: ZERO rows returned.** No RFPs have a null `received_on` or `internal_due_date`. Interpretation: either (a) the broken import window was short enough that no edits were attempted via the PATCH route before Fix 1 was deployed, or (b) all edits during the window left both date fields blank intentionally (both null from creation, updatedAt ≈ createdAt). No manual data repair is required. Adolfo to confirm.

### Punch List B — Silent-Failure TODO Comments

Added `// TODO: This catch swallows ReferenceError/TypeError as if they were data errors. Should distinguish code bugs (rethrow) from invalid input (null + warn). See HANDOFF for context.` above each of the 5 try-catch blocks in the PATCH route (`/api/rfp-requests/:id/update-with-files`):
1. `receivedOn` block (line 1768)
2. `internalDueDate` block (line 1781)
3. `responseToBrokerDue` block (line 1794)
4. `contractorDueDate` block (line 1807)
5. `architectDueDate` block (line 1820)

The POST route (`/api/rfp-requests/create-with-files`) does **not** use try-catch around its date conversions (lines 863-874) — bare `if` guards only — so no TODO needed there.

Runtime behavior was not changed. TODO comments only.

### Open Follow-Ups (backlog)

- **Silent-failure try-catch pattern**: The 5 TODO-marked catch blocks in `server/routes.ts` PATCH route conflate code-level bugs (ReferenceError, TypeError) with bad-input scenarios. Future fix: wrap only the input-parsing portion, let code errors propagate.
- **Split-bay ID mismatch (server-side)**: ✅ RESOLVED — see below.

### Files Changed (Punch List)
- `server/routes.ts` — 5 TODO comments added above try-catch blocks (lines 1768, 1781, 1794, 1807, 1820); no runtime changes

---

## Session: April 29, 2026 (continued) — Split-Bay ID Mismatch Fix

### Root Cause
The bay-hydration logic in `server/routes.ts` rebuilds `selectedBayConfigurations` from live property data using:
```js
property.bayConfigurations.filter(bay => selectedBayIds.includes(bay.id))
```
For split-bay RFPs, `selectedBayIds` contains suffixed IDs like `"1754328007840_south"` while property bay configs store unsuffixed IDs like `"1754328007840"`. The `includes()` check always fails → `selectedBayConfigurations = []` for every split-bay RFP from every affected endpoint.

This silently broke every API consumer of `selectedBayConfigurations` for split-bay RFPs (rentable area in Details modal, evaluation header, PDF generation, electrical allocation, leasable area totals). Fix 2 (session earlier today) only added a frontend fallback for the Details modal; the underlying server bug was still present.

### Fix

Added `resolveSelectedBays(selectedBayIds, liveBayConfigs, snapshotBays)` helper at `server/routes.ts` (lines 312–343). It:
1. Tries exact ID match (handles full/non-split bays, no behavior change)
2. If no match, strips `_south`/`_north` suffix → finds the base bay in live property data
3. Merges: takes live bay's current properties (address, parking, etc.) but overrides `id`, `bayName`, `rentableSquareFootage`, and `squareFootage` from the stored snapshot entry — preserving the half's actual SF
4. If still not found (bay deleted from property), falls back to the stored snapshot entry

### Sites Updated
All 4 filter call sites replaced with `resolveSelectedBays()`:
1. `GET /api/rfp-requests` — single-building path (line 474)
2. `GET /api/rfp-requests` — multi-building path (line 485)
3. `GET /api/rfp-requests/:id` — single-building path (line 699)
4. `GET /api/rfp-requests/:id` — multi-building path (line 710)
5. `hydrateLiveBayConfigurations` helper — single-building path (line 354)
6. `hydrateLiveBayConfigurations` helper — multi-building path (line 373)

### After This Fix
- The Details modal fallback (Fix 2) now becomes redundant safety — the GET response's `selectedBayConfigurations` will be correctly populated for split-bay RFPs. The fallback is harmless and left in place.
- All server-side consumers (PDF generation, electrical allocation, leasable area totals) now receive correct split-bay SF.

### Files Changed
- `server/routes.ts` — `resolveSelectedBays` helper added + 6 filter call sites replaced

---

## Session: May 7, 2026 — resolveSelectedBays split-field audit + dock door fix

### Problem
After the `resolveSelectedBays` fix (April 29), dock door defaults in the Tenant Premises Overview were doubled for split-bay RFPs. Investigation confirmed:

- **Before** `resolveSelectedBays`: `selectedBayConfigurations = []` → `calculateDoorCounts()` Step 1 returned 0 → Step 3 (the split-aware fallback) fired correctly using `splitSouthDockDoors`/`splitSouthOversizedDoors` → **correct** {37, 1}.
- **After** `resolveSelectedBays`: bays were populated via `...baseBay` spread → Step 1 read `standardDockDoors` (full-bay count = 74) and `oversizedDockDoors` (= 2) → Step 3 never fired → **wrong** {74, 2}.
- Parking was **fixed** by `resolveSelectedBays` (tenant SF now correctly ~198k → 25% proportion → 124 vehicular, 42 trailer).

### Full split-field audit (BayConfiguration schema)

All `splitNorth*`/`splitSouth*` field pairs vs their full-bay equivalents:

| Full-bay field | Split-half fields | Previously handled | Fixed this session |
|---|---|---|---|
| `rentableSquareFootage` | *(derived from squareFootage)* | ✓ (snapshot override) | — |
| `squareFootage` | `splitNorthSquareFootage` / `splitSouthSquareFootage` | ✓ (snapshot override) | — |
| `standardDockDoors` | `splitNorthDockDoors` / `splitSouthDockDoors` | ✗ | ✓ |
| `oversizedDockDoors` | `splitNorthOversizedDoors` / `splitSouthOversizedDoors` | ✗ | ✓ |
| `hasStorefrontEntry` | `splitNorthStorefront` / `splitSouthStorefront` | ✗ | ✓ |
| `hasSpeculativeOffice` | `splitNorthOffice` / `splitSouthOffice` | ✗ | ✓ |
| `hasRestroom` | `splitNorthRestroom` / `splitSouthRestroom` | ✗ | ✓ |

All overrides use `??` (nullish coalescing) so a stored value of `false` or `0` is correctly preserved and not overridden by the full-bay fallback.

### Verified values for RFP-2026-014 after fix
- Regular Doors: **37** ✓ (was 74)
- Oversized Doors: **1** ✓ (was 2)
- Vehicular Parking: **124** ✓ (unchanged — proportion-based, not affected)
- Trailer Parking: **42** ✓ (unchanged)
- Rentable Area: **198,583 SF** ✓ (unchanged)

### Lesson documented
When adding per-half override logic to one field in `resolveSelectedBays`, audit ALL `splitNorth*`/`splitSouth*` field pairs at the same time. The SF fields were correctly handled in April; the door and boolean amenity fields were missed and silently produced wrong values until this session. Step 3 of `calculateDoorCounts()` is left in place as harmless redundancy — it provides a correct fallback if `resolveSelectedBays` ever returns zero-value door counts (e.g. for older properties without split-field data populated).

### Files Changed
- `server/routes.ts` — `resolveSelectedBays` now overrides `standardDockDoors`, `oversizedDockDoors`, `hasStorefrontEntry`, `hasSpeculativeOffice`, `hasRestroom` for split-bay IDs

### Additional notes (Adolfo, May 7 2026)

- `resolveSelectedBays` now overrides 5 additional per-half fields: `standardDockDoors`, `oversizedDockDoors`, `hasStorefrontEntry`, `hasSpeculativeOffice`, `hasRestroom`. Previously only SF fields were overridden. The earlier rentable-area fix had silently broken dock door counts (showed 74/2 instead of 37/1) by enabling Step 1 of `calculateDoorCounts()` to return non-zero values from the un-overridden full-bay data, bypassing Step 3 which had been the only path that handled split halves. All five fixes use `??` to preserve `false`/`0` per-half values. Step 3 of `calculateDoorCounts()` left in place as harmless redundancy.

- **Lesson logged**: when adding split-aware logic to one field on a multi-field record, audit the entire record for other split-aware pairs in the same change. Two related bugs canceling each other out is the hardest failure mode to detect.

### Future hardening (not blocking)

- Add unit tests for `resolveSelectedBays` covering: full bays, south halves, north halves, mixed selections, and missing per-half data fallback to full-bay values. This function is now the single source of truth for split-bay correctness, so it deserves explicit coverage. Estimate: 30 min.

---

## Rebrand: Bridge Industrial → Kurv Industrial (May 7 2026)

### Scope
Mechanical rebrand of all user-visible UI copy, PDF/HTML output, and the logo asset. No property names, variable names, function names, file names, route paths, table names, column names, or dev comments were changed.

### Logo
- Downloaded Kurv logo from `https://kurvindustrial.com/wp-content/uploads/2026/01/Kurv-Logo-2x-Color.png` (601×113 PNG, 4562 bytes)
- Encoded as base64 and overwrote `./bridge_logo_new_base64.txt` in place
- All 7 `getBridgeLogo()` implementations across server files automatically pick up the new logo with zero code changes
- File was NOT renamed (future cleanup item — see below)

### User-visible strings changed (39 individual occurrences across 17 files)
| File | Change |
|---|---|
| `client/src/pages/admin.tsx` | "Bridge Industrial" → "Kurv Industrial" (report notes bullet) |
| `client/src/pages/PropertySummaryReport.tsx` | "Bridge Industrial" → "Kurv Industrial" (branding bullet) |
| `client/src/pages/property-data-audit.tsx` | alt text on logo img |
| `client/src/components/rfp-document-editor.tsx` | intro text → `COMPANY_RFP_INTRO` constant |
| `client/src/components/rfp-document-editor-fixed.tsx` | intro text → `COMPANY_RFP_INTRO` constant |
| `client/src/components/rom-scope-items-modal.tsx` | PDF title + PDF footer |
| `client/src/components/evaluation-budget.tsx` | alt text on logo img in generated PDF HTML |
| `server/routes.ts` | alt text (2×) + contact-name regex updated to match both Bridge and Kurv |
| `server/pdf-generator.ts` | intro text (2×, default + fallback) → `COMPANY_RFP_INTRO`; alt text (3×) |
| `server/property-routes.ts` | alt text (6×, replace_all) |
| `server/pdf-reports.ts` | alt text |
| `server/rom-routes.ts` | alt text |
| `server/historical-pricing-reports.ts` | alt text |
| `server/vendor-workload-report.ts` | alt text |
| `server/property-summary-report.ts` | PDF footer — "© 2025 Bridge Industrial" → "© 2026 Kurv Industrial" |
| `server/email-service.ts` | email footer |
| `shared/constants.ts` | **NEW FILE** — `COMPANY_NAME` and `COMPANY_RFP_INTRO` exports |

### Shared constant extraction
- Created `shared/constants.ts` with `COMPANY_RFP_INTRO` and `COMPANY_NAME`
- 4 sites (2 client, 2 server) now import and use `COMPANY_RFP_INTRO` instead of inline strings
- Future copy edits to the intro text require changing only one file

### Stale-year audit
- Only ONE user-visible stale year found: `server/property-summary-report.ts:942` — updated from 2025 → 2026
- Other `© 2025` occurrences are Savant Consulting file-header comments (dev-facing) — left untouched per guardrails
- `ROM-2025-001` default value in `server/rom-routes.ts` is a data format, not a copyright year — left untouched

### Templates.json — NOT updated (paused per instruction)
- `data/templates.json` has 6 entries with `"source": "Bridge Industrial"`
- DB query confirmed 6 rows in `rom_scope_items` table already have `source = 'Bridge Industrial'`
- Since live DB rows reference this string, updating templates.json alone would create an inconsistency between existing rows and new template-seeded rows
- **Recommendation for a future session**: run a DB UPDATE on `rom_scope_items` to set `source = 'Kurv Industrial'` WHERE `source = 'Bridge Industrial'`, THEN update templates.json — do both atomically

### Property names preserved (confirmed)
Property names in DB and hardcoded lookup tables are untouched:
- "Bridge Point Gratigny", "Bridge 595", "Bridge Point Doral - Building X", "Bridge Point Miami Station - Bldg. X", "Bridge Point Port Everglades" — all remain exactly as-is

### Contact-name regex (functional fix, not rebrand)
`server/routes.ts:3933` — regex updated from:
```js
contactName.replace(/\s*-\s*Bridge\s*Industrial/i, '').trim()
```
to:
```js
contactName.replace(/\s*-\s*(Bridge|Kurv)\s*Industrial/i, '').trim()
```
Handles both legacy "- Bridge Industrial" suffixes in existing contact records AND any future "- Kurv Industrial" suffixes.

### Future cleanup (deferred, non-blocking)
1. Rename `bridge_logo_new_base64.txt` → `kurv_logo_base64.txt` — requires updating 7+ `readFileSync` call sites and the `/api/bridge-logo` endpoint
2. Rename `getBridgeLogo()` → `getCompanyLogo()` — requires updating all 7 server files that define it
3. Rename `/api/bridge-logo` → `/api/company-logo` — requires updating all client-side `src="/api/bridge-logo"` references (3 files)
4. Update `rom_scope_items` DB rows + `data/templates.json` `source` field together in one atomic operation

---

## Logo Fix: Multi-line base64 broken data URI (May 7 2026)

### Root cause
The logo has been broken in all PDF, HTML, and email output for an unknown extended period — possibly since the logo file was first created. The Linux `base64` CLI wraps output at 76 characters per line by default, producing 81 lines (79 internal newlines) instead of a single contiguous string. The `getBridgeLogo()` function called `.trim()`, which strips leading/trailing whitespace only — all 79 internal newlines survived into the data URI. Browsers and Puppeteer silently reject `data:image/png;base64,...` URIs with embedded whitespace, showing a broken-image icon instead.

**Why it went undetected**: The broken image rendered as an empty slot with alt text `"Bridge Industrial"` — indistinguishable from normal body text to anyone not specifically looking for the logo. The Kurv rebrand changed the alt text to `"Kurv Industrial"`, making the broken image obvious for the first time.

### Verification (pre-fix)
- `bridge_logo_new_base64.txt` (old): 6165 chars, 81 lines, 79 internal newlines
- Data URI produced: `data:image/png;base64,iVBORw0K...\n...Bx1F\n...YII=` — **invalid**

### Fixes applied (defense in depth)

**Primary (Option A)** — Regenerated `bridge_logo_new_base64.txt` with `base64 -w 0`:
- New file: 6084 chars, **0 lines, 0 internal newlines**, ends with `=` padding, no trailing newline
- All 7 `getBridgeLogo()` implementations pick it up automatically

**Defensive (Option B)** — Updated all 7 `getBridgeLogo()` implementations from `.trim()` to `.replace(/\s+/g, '')`:
- Guards against future accidental regeneration with line-wrapped base64
- Files updated: `server/pdf-generator.ts`, `server/routes.ts`, `server/historical-pricing-reports.ts`, `server/property-routes.ts`, `server/rom-routes.ts`, `server/vendor-workload-report.ts`, `server/pdf-reports.ts`

### Verification (post-fix)
- Node.js confirmed: raw file = 6084 chars, 0 newlines; after `.replace(/\s+/g, '')` = 6084 chars, 0 newlines (no-op, as intended)
- Data URI produced: `data:image/png;base64,iVBORw0K...VORK5CYII=` — **valid, single line**
- Base64 payload passes strict `/^[A-Za-z0-9+/]+=*$/` regex: **YES**
- `/api/bridge-logo` endpoint returns binary PNG to authenticated browsers (curl without auth returns 14-byte auth error — expected)

### Lesson logged
Visual outputs (PDFs, HTML reports, emails) require actual visual verification in QA — not just "file exists" or "valid base64" checks. Future hardening: add a smoke-test script that generates one of each output type and asserts that the logo image node has nonzero rendered dimensions.

---

## Logo Fix 3: /api/bridge-logo endpoint ReferenceError (May 7 2026)

### Context
After Fix 1 (line-wrap) and Fix 2 (about:blank auth investigation), the `/api/bridge-logo` endpoint was still returning 404 "Logo not found" for all callers — including the authenticated browser rendering `property-data-audit.tsx`.

### Root cause
`server/routes.ts` line 4970 called `readFileSync(...)` bare. Unlike the other 6 `getBridgeLogo()` implementations (each in their own file with their own `import { readFileSync } from "fs"`), `routes.ts` already imports `fs` as a default import (`import fs from "fs"` at line 11) and has no named `readFileSync` import. The call threw `ReferenceError: readFileSync is not defined` on every request, was caught silently, and returned the 404 catch-block response "Logo not found". This bug predates the rebrand.

### Investigation finding: no auth gate exists
Contrary to the initial hypothesis (Option 2 — remove auth gate), the `/api/bridge-logo` endpoint had **no auth requirement** — neither blanket middleware nor explicit `requireAuth`. The endpoint was always public. The 14-byte "Logo not found" response was the catch block, not an auth rejection.

### Fix
Changed `readFileSync(` → `fs.readFileSync(` at `server/routes.ts:4973`. One character change.

### Verified
`curl http://localhost:5000/api/bridge-logo` → PNG image data, 601×113, 4562 bytes ✓ (no auth required, unauthenticated request succeeds)

### Spot-check: all client-side `/api/bridge-logo` usages
| File | Context | Now works? |
|---|---|---|
| `client/src/pages/property-data-audit.tsx:234` | Authenticated page, inline `<img src="/api/bridge-logo">` | ✓ |
| `client/src/components/evaluation-budget.tsx:3389` | Client-side HTML written to `about:blank` via `document.write` | ✓ (endpoint is public, no session needed) |

### Lesson logged
Two distinct bugs produced identical symptoms. The full chain was: (1) base64 line-wrapping → malformed data URI in server-side PDFs; (2) `readFileSync` not defined → endpoint throws → 404 in all HTTP logo requests. Both were masked by the same alt-text-as-body-copy effect. Future similar-symptom debugging must enumerate ALL code paths before declaring root cause.

---

## ⚠️ NEXT SESSION PRIORITY: Silent-failure try/catch audit

### Why this is now urgent

This session surfaced **three** missing-import bugs in `server/routes.ts`, all masked by try/catch blocks that swallowed `ReferenceError` as if it were a routine data/runtime error:

| # | Missing import | Symptom | How it hid |
|---|---|---|---|
| 1 | `convertFormDateToDbDate` | PATCH returned 400, dates silently nulled | Caught, generic error returned |
| 2 | `readFileSync` (logo endpoint) | `/api/bridge-logo` returned 404 "Logo not found" | Caught, catch-block response indistinguishable from missing file |
| 3 | TBD — likely more remain | Unknown | Same pattern |

This is no longer "a pattern worth cleaning up someday." It is **the active mechanism by which code bugs reach production undetected** and present as data or network errors.

### Work to do next session

1. **Audit ALL try/catch blocks** in `server/routes.ts` and all extracted route modules (`auth-routes.ts`, `rom-routes.ts`, `actuals-routes.ts`, `property-routes.ts`, `ai-routes.ts`, `proposals-routes.ts`, `dashboard-routes.ts`) that swallow errors and return generic failure responses.

2. **Triage each catch site**: distinguish "rethrow — this is a code bug" from "handle — this is bad user input":
   - `ReferenceError`, `TypeError`, `SyntaxError` → almost always indicates a code bug → **rethrow or log prominently and return 500**
   - Validation/parsing errors on user-supplied data → legitimate to handle gracefully → keep the pattern but log the actual error type and message

3. **Add explicit error-type logging** at every catch site: even when the user-facing response is generic, the server log should emit `error.constructor.name` and `error.message` so bugs surface immediately in logs instead of silently producing wrong behavior.

4. **One-time missing-import grep**: compare all identifiers used in each server file against that file's import list. Catch any remaining missing-import bugs proactively before they appear as user reports. Focus on files that use named destructured imports from `fs`, `path`, and shared modules alongside a default `fs` import.

### Files to prioritize
- `server/routes.ts` (5991 lines — highest risk, most catch blocks)
- `server/pdf-generator.ts`
- `server/property-routes.ts`
- `server/rom-routes.ts`
- All other extracted route modules
