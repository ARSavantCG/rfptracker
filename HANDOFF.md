## End of Session Checklist
- [ ] Republish the app (Republish button)
- [ ] Push to GitHub (Git tab → Push button)
- [ ] Update HANDOFF.md with what was accomplished and what's next

---

RFP Tracker — Savant Portal Integration
Project Handoff Document
Session Date: April 13, 2026

What this project is:
A commercial real estate RFP management system built for Bridge Industrial, hosted at rfptracker.app on Replit with a Neon PostgreSQL database. The codebase is TypeScript full-stack — React/Vite frontend, Express backend, Drizzle ORM.
GitHub: https://github.com/ARSavantCG/rfptracker

What was accomplished this session:

✅ Fixed split bay SF calculation for MG Westside Building B
✅ Refactored routes.ts from 10,008 lines to 5,886 lines across 5 feature files
✅ Removed 22 dead imports
✅ Stripped all production debug logging
✅ Added requireAuth to 9 previously unauthenticated routes
✅ Fixed require() inside loop in generateBidCollectionHtml
✅ Created server/ai-routes.ts with AI bid analysis endpoint
✅ Fixed auth-token vs auth_token localStorage key mismatch
✅ Fixed updateRfpRequestSchema missing import causing 400 errors
✅ Fixed insertInvitationToBidSchema missing import
✅ Fixed double response body read in frontend
✅ Got Gordon Foods @ MG Westside Bldg B through Steps 1-4
✅ Fixed parking auto-calculation for split bay RFPs
✅ Locked AI features to admin-only via checkPermission('admin.access')


Current file structure:
server/
├── routes.ts          (5,886 lines — orchestrator)
├── middleware.ts      (179 lines — requireAuth, checkPermission, upload)
├── auth-routes.ts     (351 lines — login/logout/passwords)
├── rom-routes.ts      (854 lines — ROM Pilot + report generator)
├── property-routes.ts (2,064 lines — properties, electrical, bays)
├── html-generators.ts (713 lines — bid/report HTML generators)
└── ai-routes.ts       (new — AI bid analysis)

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
Remove debug console.logs from parking calculation (Parking Calc Debug, Tenant area after fallbacks, Parking Calc Pre-Calculation, Door counts calculated)
/api/version returning 500 in production — version.json read failing

🏗️ Features to Build:
5. Master Cost Library — unified pricing database replacing ROM Scope Items
6. Bid line item tagging → rollup transfer to evaluation Step 5
7. Workletter/broker PDF parser — Claude extracts scope checklist at Step 1
8. Email/notes parser — Claude captures construction requirements from team emails
9. Historical cost benchmarking — $/SF by category from clean bid data

How to start next session:
Paste this into Claude:
"I'm continuing work on the RFP Tracker / Savant Portal project. Here is the handoff document from our last session: [paste this document]. Let's start with [item from fix list]."

Key architectural decisions made:

Token auth only — no sessions (stored as auth-token with hyphen in localStorage)
AI features locked to admin.access permission only
Split bays use rentableSquareFootage field, not squareFootage
Property parking is proportional: (tenantSF / totalPropertySF) * propertyParking
Cost amounts stored inconsistently — some as text strings, some as integer cents (future cleanup needed)
