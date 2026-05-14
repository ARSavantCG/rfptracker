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

### May 7 2026 close-out status
| Item | Status |
|---|---|
| Logo rendering — server-side PDFs (getBridgeLogo data URI) | ✅ Fixed — base64 line-wrap resolved |
| Logo rendering — /api/bridge-logo HTTP endpoint | ✅ Fixed — `fs.readFileSync` (routes.ts:4973) |
| Logo rendering — email attachments / HTML reports | ✅ Fixed — same getBridgeLogo fix covers all 7 call sites |
| /api/version returning real version (1.1.4) | ✅ Fixed — `fs.readFileSync` (routes.ts:5285) |
| Dock door counts for RFP-2026-014 (37/1) | ✅ Fixed — resolveSelectedBays split-field audit |
| Rebrand Bridge → Kurv Industrial (39 occurrences, 17 files) | ✅ Complete |
| Missing-import audit (all server route files) | ✅ Clean — 3 bugs found and fixed, no others |
| Republish | ⬜ Manual step — user action required |
| Push to GitHub | ⬜ Manual step — user action required |

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
3. ✅ RESOLVED (fully, May 7 2026) — `/api/version` 500 history: a prior session added a try/catch fallback which stopped the 500, but the underlying missing `readFileSync` import was never fixed — the endpoint silently returned hardcoded `version: "1.0.0"` on every request. Root cause found and fixed this session (`readFileSync` → `fs.readFileSync` at routes.ts:5285). Now returns real data from `version.json` (version `1.1.4`). See "Version Fix" section.
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

## Version Fix: /api/version silent wrong-data bug (May 7 2026)

### Prior history
A previous session added a try/catch around the `/api/version` endpoint to stop a production 500, then marked the bug "✅ RESOLVED — no longer 500ing." That entry was accurate in the narrow sense: the 500 was stopped. But the underlying cause — `readFileSync` called bare in `routes.ts` which only has `import fs from "fs"` (default) and no named `readFileSync` import — was never fixed. The catch block returned `{ version: "1.0.0", environment: "production" }` as a plausible-looking fallback on every single request, so the bug was completely invisible.

### Discovery
Found by the proactive missing-import grep at session close (same grep that confirmed the logo fixes were complete). Identified as the same one-character pattern as the logo endpoint fix.

### Discrepancy: "500 in production" vs "200 fallback" — resolved
Both were true at different points in time:
- **Pre-try/catch**: endpoint threw `ReferenceError` uncaught → Express default error handler → **500**
- **Post-try/catch (until today)**: `ReferenceError` thrown → caught → `res.json({ version: "1.0.0" })` → **200 with stale fallback data**

The prior HANDOFF.md "RESOLVED" note captured the 200 state accurately. The production 500 was real when reported, then masked (not fixed) by the try/catch.

### Fix
`server/routes.ts:5285` — `readFileSync(` → `fs.readFileSync(`. Same one-character change as the logo fix.

### Verified
```
curl http://localhost:5000/api/version
→ {"version":"1.1.4","buildDate":"2026-02-03T00:00:00.000Z","gitCommit":"local-build",
   "changes":[...5 entries...],"nodeVersion":"v20.20.0","uptime":11,...}
```
Returns real `version.json` data (681 bytes, version `1.1.4`). Not the fallback `"1.0.0"`. ✓

---

## ⚠️ NEXT SESSION PRIORITY: Silent-failure try/catch audit

### Missing-import audit — COMPLETE. All three bugs found and fixed this session.

A proactive grep at session close found the full population of missing-import bugs in `server/routes.ts`. All three were masked by try/catch blocks that swallowed `ReferenceError` as if it were a routine data/runtime error:

| # | Missing import | Symptom | How it hid | Status |
|---|---|---|---|---|
| 1 | `convertFormDateToDbDate` | PATCH returned 400, dates silently nulled | Caught, generic error returned | ✅ Fixed this session |
| 2 | `readFileSync` (logo endpoint) | `/api/bridge-logo` returned 404 "Logo not found" | Caught, catch-block response indistinguishable from missing file | ✅ Fixed this session |
| 3 | `readFileSync` (version endpoint) | `/api/version` silently returned hardcoded `version: "1.0.0"` | Caught, plausible-looking fallback masked the error completely | ✅ Fixed this session |

All other server route files checked — no additional missing-import bugs found. See full audit log above.

**Lesson confirmed**: when a class of bug is found once, audit for the entire class before closing the session. The proactive grep cost ~10 minutes and closed a long-standing known issue (version endpoint) as a free side effect.

### Remaining work for next session: broader try/catch audit

The missing-import audit is done, but a related problem remains: the recurring pattern of catch blocks that swallow **any** error type — including code bugs — and return misleading fallback responses or status codes. This is the active mechanism by which code bugs reach production undetected.

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

---

## Session: May 12, 2026 — Authentication Hardening

### Completed

✅ **Dev security hole deleted**
- `POST /api/dev/make-admin` removed from `server/routes.ts`
- Dead `makeAdminMutation` removed from `client/src/pages/dashboard.tsx`
- Zero references remain anywhere in the codebase

✅ **Duplicate workflow-phase handler merged**
- Two `PATCH /api/rfp-requests/:id/workflow-phase` handlers existed; dead one deleted
- Live handler (line 2114) now has: `requireAuth` + `canAdvanceToPhase` gate (from dead copy) + publish-email side effect
- Publish email confirmed at line 2146: `sendWorkflowCompletionEmail(updated, 'publish')`
- Comment added to the handler warning against future duplication

✅ **Full endpoint auth coverage across all three server files**

Every `GET`, `POST`, `PATCH`, `PUT`, `DELETE` returning or mutating business data now has `requireAuth`. Admin-only operations (`GET /api/admin/users`, `PATCH /api/admin/users/:id`) also have `requireAdmin`. The only intentionally public endpoint is `GET /api/version`.

Files: `server/routes.ts` (~50 endpoints added), `server/property-routes.ts` (~20 endpoints added), `server/rom-routes.ts` (~10 endpoints added)

Note: `requireAdmin` was **pre-existing** in `server/middleware.ts` before this session (git history confirms). Used without modification at the time — bug discovered and fixed in the subsequent audit log session (see below).

✅ **Client credential gaps closed**

| File | Fix applied |
|---|---|
| `edit-rfp-modal.tsx` | `credentials: 'include'` on `update-with-files` (×2), `workflow-phase`, `summary-report` |
| `invitation-to-bid-modal.tsx` | `credentials: 'include'` on `additional-areas` |
| `financial-summary.tsx` | `credentials: 'include'` on `financial-summary-pdf` |
| `evaluation-budget.tsx` | `credentials: 'include'` on `workflow-phase` publish advance |
| `rfp-table.tsx` | `credentials: 'include'` on `GET /api/rfp-requests` |
| `top-rfps-by-cost.tsx` | `credentials: 'include'` on `GET /api/rfp-requests/top-open-by-cost` |
| `bay-configuration-manager.tsx` | `Authorization: Bearer` + `credentials: 'include'` on `PUT /api/properties/:id` |

✅ **window.open report calls converted to fetch+blob**

`GET /api/reports/executive`, `GET /api/reports/vendor-workload/html`, `GET /api/reports/property-summary` now use `fetch({ credentials: 'include' }) → blob → createObjectURL → window.open`. `GET /api/reports/custom` → `credentials: 'include'` added to existing fetch+blob pattern.

Files: `client/src/pages/reports.tsx`, `client/src/pages/PropertySummaryReport.tsx`, `client/src/components/custom-report-modal.tsx`

### Verification

**Unauthenticated → 401 (all ✓):** `GET /api/rfp-requests`, `GET /api/properties`, `GET /api/rom-pilots`, `POST /api/master-categories`

**Public endpoint still works → 200 (✓):** `GET /api/version`

**Authenticated → 200 (all ✓):** `GET /api/rfp-requests` (routes.ts:457), `GET /api/properties` (property-routes.ts:389), `GET /api/rom-pilots` (rom-routes.ts:464), `PATCH /api/rfp-requests/99999/workflow-phase` → 404 (auth passed, RFP not found)

**Zero-gap final audit:** grep across all three server files for handlers missing `requireAuth` → 0 results.

### Next Session Priorities

1. **audit_log DB table** — never created. Full build: Drizzle schema → migration → write middleware → admin UI log viewer. This is the top remaining security task.
2. **Browser smoke test** — log in, edit RFP-2026-014, verify south-half split bay selection, dock door counts (37/1), and Rentable Area figure.
3. **Publish email live test** — advance a test RFP to "publish" and confirm `sendWorkflowCompletionEmail` fires (check SendGrid activity log or server console).

---

## Session: May 12, 2026 — Audit Log Foundation + requireAdmin Fix

### Recently Fixed

✅ **`requireAdmin` middleware broken since inception**

`requireAdmin` in `server/middleware.ts` called `storage.getUser(req.userId)`. That method is declared on the `IStorage` interface (line 236, marked `// (IMPORTANT) these user operations are mandatory for Replit Auth.` — legacy Replit Auth scaffolding) but was **never implemented** on `DatabaseStorage`. Every call threw `TypeError: storage.getUser is not a function`, caught by the middleware's own `catch` block, and returned HTTP 500.

**Affected endpoints** (the only two using `requireAdmin` in the entire codebase):
- `GET /api/admin/users` (routes.ts)
- `PATCH /api/admin/users/:id` (routes.ts)

Both returned 500 for every admin request — the Users tab in the Admin Panel has never worked.

**Fix applied** (`server/middleware.ts`): Replaced the async DB-fetching implementation with a synchronous check against `req.user`, which `requireAuth` already populates before `requireAdmin` runs. No DB call needed — the user object (including `role` and `permissions`) is already on the request:

```typescript
// Before: async, called storage.getUser(req.userId) — method did not exist
// After: synchronous, reads req.user populated by the preceding requireAuth
function requireAdmin(req: any, res: any, next: any) {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Authentication required" });
  if (user.role !== 'admin' && !(user.permissions?.includes('admin.access'))) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}
```

Side effect: eliminates a redundant DB round-trip on every admin request.

**Production log evidence**: Only today's session logs are retained in `/tmp/logs/`. No historical hits to `/api/admin/users` appear in those logs — the bug existed since inception but no prior 500s are visible in the available window.

**Verification**: `GET /api/admin/users` → 200 + user list ✓ · `PATCH /api/admin/users/:id` → 200 ✓ · no credentials → 401 ✓ · no non-admin system users exist in DB (4d skipped) ✓

---

✅ **Audit log foundation — complete**

Full append-only audit log system built and deployed. Details:

**Schema** (`shared/schema.ts`): New `audit_log` table — `uuid` PK, `event_type` (text), `user_id`, `user_email`, `entity_type`, `entity_id`, `metadata`/`before_data`/`after_data` (JSONB), `changed_fields` (text[]), `created_at`. Three indexes: `(event_type, created_at DESC)`, `(user_id, created_at DESC)`, `(created_at DESC)`. Old serial-PK `audit_log` table (action column) dropped and replaced.

**Helper** (`server/audit-log.ts`): `logEvent()` — fire-and-forget insert with SENSITIVE_KEYS redaction (`password`, `passwordHash`, `token`, `sessionToken`, `apiKey`, `secret`). Controlled-swallow on DB failure: logs loudly to `console.error` but never re-throws (audit failures must never break user operations).

**Login instrumentation** (`server/auth-routes.ts`): Seven branches instrumented — 2 successes (`admin`, `contact`) and 5 failures:
- `bad_password` / admin path — **blocks fall-through** (this was the admin fall-through bug: wrong admin password previously leaked into contact lookup)
- `auth_error` / admin path — new branch for `reason: 'error'` (unexpected DB failure during auth)
- `bad_password` / contact path
- `no_user` / contact path
- `no_access` / contact path
- `no_password_set` / contact path
- `exception` in outer catch block — belt-and-suspenders, instruments uncaught throws

**Admin viewer** (`client/src/pages/audit-log-admin.tsx`, route `/admin/audit-log`):
- Paginated table (50/page), sorted newest-first
- Filter chips for event type (populated from `/api/admin/audit-log/event-types`), email partial-match search, date-from/to range
- Row expand showing all 11 fields with JSONB rendered as formatted objects
- Linked from Admin Panel tab bar ("Audit Log" → Link component)

**Server API** (`server/routes.ts`):
- `GET /api/admin/audit-log` — paginated + filtered (`inArray` for event types, `ilike` for email, `gte`/`lte` for dates)
- `GET /api/admin/audit-log/event-types` — distinct event type list for filter dropdown
- Both gated with `requireAuth, checkPermission('admin.access')`

**Auth.ts Option B refactor**: `authenticateUser` now returns discriminated union `{user, reason: null} | {user: null, reason: 'no_user'|'bad_password'|'error'}` instead of bare `null` — fixes the admin login fall-through bug at the source.

### Lessons Learned

**Sixth instance this session-pair of a long-dormant bug surfaced by new adjacent work.** The codebase has accumulated structural fragility (silent fetches, stale validators, missing imports, race conditions in useEffect). The pattern is consistent enough that future work should budget time for "discover and fix bugs the new work exposes" as part of the session, not as an interrupting surprise.

**Fifth instance this session-pair: TypeScript silently allowed a runtime bug.**

| Instance | Pattern |
|----------|---------|
| Missing `requireAuth` on ~80 endpoints | `any`-typed Express route handlers — TS can't enforce middleware presence |
| `storage.getUser` not implemented | Interface declared, class body missing the method — no TS error due to `any` |
| `authenticateUser` returning bare `null` hid fail reason | Return type `User \| null` gave no discrimination between no-user vs bad-password |
| `logAudit()` had silent `console.error` swallow | No compile-time enforcement of audit-log integrity |
| Orphaned `ActivityLogPanel` function body after partial removal | Compiler accepted floating `const` and JSX as module-level statements under `any` |

**Pattern**: The storage interface (`IStorage`) is the most-called code surface in the app and the most dangerous place for any-heavy typing. Every method there is called from express route handlers that are typed as `(req: any, res: any)`. A missing implementation compiles, boots, and fails only at the specific runtime call site.

**Future hardening target**: Tighten types on `IStorage` implementations specifically. Consider a compile-time check (e.g. a test that instantiates `DatabaseStorage` and calls every interface method) to catch missing implementations before they reach production.

### Verification

`GET /api/admin/users` → 200 + users list ✓  
`PATCH /api/admin/users/:id` → 200 ✓  
`GET /api/admin/users` (no auth) → 401 ✓  
`GET /api/admin/audit-log` (admin) → 200 + paginated entries ✓  
`GET /api/admin/audit-log?eventTypes=login_success` → 200 + filtered ✓  
`GET /api/admin/audit-log?userEmail=admin` → 200 + filtered ✓  
`GET /api/admin/audit-log?dateFrom=2027-01-01` → 200 + total: 0 ✓  
`PATCH /api/rfp-requests/187` (RFP-2026-014) → 200 ✓  
`login_success` rows in DB with `authMethod: admin`, correct `user_id` ✓  
`login_failure` rows with `reason`, `authMethod` per branch ✓  

### Next Session Priorities

1. **Browser smoke test** — log in as Adolfo via the UI, open Admin Panel → Users tab, confirm user list loads. Navigate to `/admin/audit-log` and confirm rows are visible with expand working.
2. **Deploy** — audit log foundation + requireAdmin fix unblocks the pending deploy. Republish.
3. **TypeScript hardening** — per lesson above: tighten `IStorage` method typing. The `getUser` stub on the interface is still declared but unimplemented — either add the implementation or remove it.
4. **Publish email live test** — advance a test RFP to "publish" and confirm `sendWorkflowCompletionEmail` fires.

---

## Note for Next Session: Bid Collection (Step 4) Master List

Bid Collection (Step 4) will use a **separate** master list, not `rom_scope_items`. Contractor vocabulary differs from internal scope vocabulary; forcing GC bids through the Evaluation Budget master would distort the data we're capturing. Decisions to make next session:

1. New table for contractor-master items, OR extend the existing `master_categories` table (which `bid_line_items` already references)?
2. Should the contractor master allow PDF-parsed items to contribute directly (semi-automated population from GC bids), or stay admin-curated like the Evaluation master?
3. Some items will overlap conceptually (e.g. "Edge of Dock Levelers") across both masters. Do we cross-link them for analytics, or accept they're independent vocabularies?

The `MasterScopeItemPicker` component is reusable — accepts `searchEndpoint` as a prop. The search endpoint and review queue are duplicated per master list. This is intentional — keeping the masters independent avoids accidentally coupling them at the infrastructure level.

---

## Session: May 14, 2026 — Evaluation Budget Race Condition Fixes (Bugs #1–3)

### Context

These three bugs predated this session's controlled-vocabulary work. The picker exposed them by lengthening the average time between "add line item" and "click save," making the race window easier to hit. All users had been at risk of intermittent line item loss in evaluation budgets for an unknown duration.

### Resolved This Session

**Bug #1 — useEffect race condition in `evaluation-budget.tsx`** (primary cause of silent data loss)

The single `useEffect` at line 1708 had eight dependencies including `allBidLineItems` and `bidCollections`. These two async queries resolved after initial render (sometimes seconds later). Each resolution triggered a full non-partial `setBudgetData({...})` replacement sourced from the server snapshot (`existingBudget`), erasing any line items the user had added to local state since page load. The save then persisted the pre-edit data (HTTP 200, green toast), making the bug completely invisible.

Fix: Split into two effects.
- **Effect A** (deps: `[existingBudget]` only): does the full `setBudgetData` replacement from server snapshot on initial load and after post-save cache invalidation. The inline demising wall transform was removed — it duplicated the dedicated `useEffect` at line 1450 and was the original reason `propertyData` had been added as a dependency.
- **Effect B** (deps: `[propertyImprovements, rfp?.selectedBayConfigurations]`): handles the "needsBucketRefresh" edge case using `setBudgetData(prev => ({...prev, ...}))` — functional setter only, never touches `tenantImprovements` or `designSoftCosts`.
- `allBidLineItems` and `bidCollections` dropped from both effects (were never used in the effect body — pure spurious triggers).

This bug had been present indefinitely and was causing silent intermittent data loss across all evaluation budgets for an unknown duration. Surfaced because the new picker UX lengthened the average time between "add line item" and "click save," making the race window easier to hit.

**Bug #2 — `saveProgressMutation` and `saveAndAdvanceMutation` used raw `fetch()` without response checking**

Both mutations called `fetch()` and never inspected `response.ok`. An HTTP 500 from the server resolved the promise without throwing, so `onSuccess` fired and showed a green "Progress Saved" / "Budget Saved & Workflow Advanced" toast even when the save had completely failed.

Fix: Replaced all raw `fetch()` calls in both mutations with `apiRequest()` from `@/lib/queryClient`, which calls `throwIfResNotOk` internally. This covers the budget save, the attachments upload, and the workflow-phase PATCH. `onError` now fires on server-side failures, surfacing a red error toast instead.

**Bug #3 — No cache invalidation after save**

`saveProgressMutation.onSuccess` only showed a toast. It did not call `queryClient.invalidateQueries` for the evaluation budget query. As a result `existingBudget` held stale pre-save data indefinitely. If Effect A re-fired for any reason after the save (which was trivially easy to trigger before Bug #1 was fixed), it would restore the pre-save server snapshot, silently losing freshly saved line items.

Fix: Both mutations' `onSuccess` handlers now call:
```javascript
queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfp?.id}/evaluation-budget`] });
```
After Bug #1's fix, Effect A fires harmlessly on the resulting re-fetch and re-syncs from the now-fresh server data without overwriting user edits.

### Files Changed

- `client/src/components/evaluation-budget.tsx` — split useEffect, removed finalTI demising wall transform, replaced raw fetch() with apiRequest(), added cache invalidation to both onSuccess handlers

### DB Evidence at Time of Fix

- Budget for rfp_id 187: 1 master-linked item ("Pit Leveler - 40k lbs (Electric)") confirmed persisted in DB — proving the save mechanism CAN work when the race is won. All other 9 sampled budgets: 0 master-linked items, consistent with the race being lost consistently under typical usage timing.

### Verification Steps (for next session or user to run)

1. Pick "Edge of Dock Levelers" from master scope picker, save, refresh — confirm item persists.
2. Add a line item, wait 15 seconds (longer than any async query should take to settle), save, refresh — confirm persistence.
3. Add a master-picked item AND an "Other" item in the same session, save once, refresh — both should persist.
4. Edit an existing line item's quantity, save, refresh — confirm the edit persists.
5. Simulate a server error (DevTools → Network → block the evaluation-budget POST) — confirm a red error toast appears, not a green success toast.

---

## Session: May 14, 2026 — UX Polish & Verification Fixes (Post-Bug-Fix Session)

### Context

Adolfo conducted live verification of the controlled-vocabulary picker (MasterScopeItemPicker) and the three evaluation budget bug fixes from the prior session. Several pre-existing UX gaps and one cache bug were surfaced and fixed during verification.

### Resolved This Session

**Add & Continue button not resetting the picker for next entry**

The MasterScopeItemPicker holds its own internal state (query text, search results, open/closed, "Other" mode flag). Resetting the parent's `newItem` state was insufficient — the picker still showed the old description in its text box. Fix: added a `pickerKey` counter state to `EvaluationBudget`; incremented on every successful "Add & Continue"; passed as `key={pickerKey}` to the picker, forcing a clean remount. Also fixed the auto-focus `setTimeout` which was targeting the old placeholder string `"Enter item description"` instead of the current `"Type to search scope items…"`.

Files changed: `client/src/components/evaluation-budget.tsx`

**Silent validation failure in the Add Item form**

`addNewItem()` had a guard `if (!newItem.description || !newItem.unitPrice) return;` that silently did nothing — no toast, no shake, no indication. Since the picker requires completing the selection flow (pick from dropdown OR click "Use as custom entry"), users who typed text directly and clicked Add saw no feedback. Fix: replaced the single silent return with three specific red toasts distinguishing "both missing", "description missing", and "unit price missing". The description toast explicitly instructs the user to use the dropdown or "Use as custom entry".

Files changed: `client/src/components/evaluation-budget.tsx`

**Save Progress entering stuck pending state when network drops mid-request**

`apiRequest` used bare `fetch()` with no timeout. If the network dropped while a save was in flight, the browser held the TCP connection open indefinitely — `isPending` stayed `true` forever, the Save Progress button appeared disabled (no visual change to the text since it was batched), and subsequent clicks silently did nothing. Fix: added `signal: AbortSignal.timeout(20_000)` to every `fetch()` call in `apiRequest`. After 20 seconds, the fetch rejects with `AbortError`; TanStack Query catches it, sets `isPending=false`, fires `onError`. The `saveProgressMutation.onError` handler now distinguishes timeout from other failures: "Save Timed Out — network may be slow or offline. Click Save Progress again to retry."

Files changed: `client/src/lib/queryClient.ts`, `client/src/components/evaluation-budget.tsx`

**Scope-item-review pending tab serving stale empty results (TanStack Query cache bug)**

Root cause: the global `staleTime: 5 * 60 * 1000` in `queryClient.ts` caused the `/api/admin/scope-item-review/pending` query to be served from cache for up to 5 minutes after new Other entries were enqueued. The DB always had the correct rows; only the cache layer was stale. Symptoms: admin navigates to `/admin/scope-item-review`, sees "No pending items — queue is clear" even though two confirmed entries exist in the DB with `status='pending'`. Server logs confirmed the `/pending` endpoint was never being hit on those page visits.

Two-part fix:
1. `staleTime: 0` added to the pending query in `scope-item-review.tsx` — admin review pages are action-oriented; freshness matters more than performance.
2. `queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/pending"] })` added to both `saveProgressMutation.onSuccess` and `saveAndAdvanceMutation.onSuccess` in `evaluation-budget.tsx` — busts the cache immediately after any budget save that may have enqueued new Other entries.

Verification: after the fix, all four scope-item-review queries (`/pending`, `/promoted`, `/rejected`, `/duplicates`) hit the server simultaneously on page load. `/pending` returned the two enqueued entries (`Tenant Custom Entry`, `Tenant Custom Scope 4`).

Files changed: `client/src/pages/scope-item-review.tsx`, `client/src/components/evaluation-budget.tsx`

### Recently Fixed (this session continuation)

**Promote/duplicate/reject handlers now write to `audit_log`.** Added `logEvent` calls to all three review-queue action handlers in `server/routes.ts`. Also added the missing `import { logEvent } from "./audit-log"` to `routes.ts` (it was only imported in `auth-routes.ts`). Promote, duplicate, and reject actions now audit-log with correct user identity and metadata. Verified via direct API calls and audit_log query — all three event rows confirmed:
- `scope_item_review_promoted` — entity_type: `master_scope_item`, entity_id: `77`, metadata includes `customDescription`, `promotedMasterItemId`, `csiDivision`, `unit`, `unitPrice`
- `scope_item_review_duplicated` — entity_type: `master_scope_item`, entity_id: `56`, metadata includes `customDescription`, `duplicateOfMasterItemId`
- `scope_item_review_rejected` — entity_type: `scope_item_review_queue`, entity_id: (queue row id or description fallback), metadata includes `customDescription`, `notes`

Files changed: `server/routes.ts` (import + 3 logEvent call blocks)

### Lessons Learned

**Pattern observation — agent does not automatically apply foundation patterns (like audit logging) to new admin actions unless explicitly instructed.** When a new admin action handler is built, ALWAYS add a `logEvent` call. This is the second instance in this session-pair where a foundation built earlier wasn't applied by default to new code built later. Rule: any handler that writes to a privileged table (queue status updates, master item inserts, role changes, etc.) gets a `logEvent` call in the same PR.

**Seventh instance — action-oriented admin views must override the global staleTime.** The 5-minute global staleTime in `queryClient.ts` is appropriate for read-heavy views (RFP tables, property lists) but is a footgun for admin tools where users are acting on live queue state. Any review queue, audit log, or moderation view should set `staleTime: 0` or `refetchOnMount: 'always'` explicitly. The data was always correct in the DB; the cache was the only thing wrong.

**Picker UX contract must be documented.** `MasterScopeItemPicker` is a search-then-select widget, not a free-text input. Typing text into the box does not update the parent's form state — only `onSelect` does. Any form using this picker must either (a) show validation feedback when `description` is empty, or (b) prevent the submit button from enabling until a selection is made. The silent guard pattern (`if (!x) return;`) is never acceptable in a form action.

### Next Session Backlog

- **Audit other admin-page `useQuery` calls for staleTime issues.** Highest priority candidate: `/admin/audit-log` — forensic audit data must always be live. Check all other admin views for the same silent-stale pattern.
- **Scope-item-review invalidation on bid saves.** Currently only evaluation budget saves bust the pending cache. If Other entries can be added from bid collection or other surfaces in the future, those save handlers will also need the invalidation call.
- **"Custom Entry 3" never reached the DB.** During verification, this entry was typed into the picker text box but the "Use as custom entry" flow was not completed before the save attempt. Not a bug — expected behavior of the picker contract — but worth noting as a training scenario.
- **`/admin/scope-item-review` has no navigation bar.** The page renders standalone without the standard app layout (no top nav, no sidebar). Pure UX bug — page is functional but visually orphaned. Defer to next session.
- **`scope_item_review_rejected` entity_id race condition.** The reject handler does a pre-update SELECT to capture the queue row UUID, but if the row status was already changed (race or prior test), the SELECT returns 0 rows and `entity_id` falls back to `descriptionNormalized` (a string) instead of the UUID. This makes `entity_id` type inconsistent across audit log rows. Fix: capture the queue row in the same transaction as the status update using `.returning({ id })` on the UPDATE call — that guarantees the ID without a separate SELECT and with no race window. Not deploy-blocking; the audit row is still meaningful. Files: `server/routes.ts` reject handler (~line 6340).
- **Missing-master indicator not implemented (Test 5).** When a master scope item referenced by `masterItemId` is deleted from `rom_scope_items`, historical budget line items continue to display their stored `item.description` correctly (no crash, correct text). However, there is no visual indicator (badge, warning icon, strikethrough) that the referenced master is gone. The `masterItemId` becomes a dangling reference with no UI signal. Low priority since master deletes are admin-controlled, but track for future completeness.
- **Audit other admin `useQuery` staleness.** `/admin/audit-log` view is highest priority — forensic data must be live. Same `staleTime: 0` fix needed.
- **`rom_scope_items.csiCode` column is unpopulated.** The picker now renders `csiCode ?? shortCsiLabel(csiDivision)` per item. Since `csiCode` is null for every row, all three Levelers fall back to `shortCsiLabel("11 - Equipment")` = `"11"` — they remain indistinguishable by CSI in the dropdown. To get the distinct granular codes Adolfo showed (11 13 18.0000, 11 13 19.0140, 11 13 19.0150) the `csi_code` column must be populated row-by-row in `rom_scope_items`. This is a data entry task, not a code task. The picker logic is ready to render them the moment the data exists.
