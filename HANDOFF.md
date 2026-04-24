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
