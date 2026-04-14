## End of Session Checklist
- [ ] Republish the app (Republish button)
- [ ] Push to GitHub (Git tab → Push button)
- [ ] Update HANDOFF.md with what was accomplished and what's next

---

RFP Tracker — Savant Portal Integration
Project Handoff Document
Session Date: April 14, 2026

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


Known issues / next session fix list:
🔧 Bug Fixes:

MG Westside Bldg B split bays need dock door counts added to bay records
AI bid analysis "Analyze with AI" button returning "Analysis failed" — needs console debugging
/api/version returning 500 in production — version.json read failing
10. Fix GitHub CI/CD Pipeline — update .github/workflows so security scan and tests pass after routes refactoring, or simplify if automated testing is not a current priority

🏗️ Features to Build:
1. Master Cost Library — unified pricing database replacing ROM Scope Items
2. Workletter/broker PDF parser — Claude extracts scope checklist at Step 1
3. Email/notes parser — Claude captures construction requirements from team emails
4. Historical cost benchmarking — $/SF by category from clean bid data
5. Bulk-confirm all keyword suggestions in bid view modal (one-click "Accept All" button)

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
