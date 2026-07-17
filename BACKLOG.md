# RFP Tracker — Backlog & Open Items

**Purpose:** The running list of everything outstanding for RFP Tracker / Savant Portal.
When Adolfo asks "what's open / outstanding / ready to tackle," this file is the answer.
Keep it current — move items to **Done** when shipped, add new items as they surface.

**Last updated:** July 17, 2026

-----

## 🔥 TOP OF LIST — in-flight from the 2026-07-16/17 session (do these first)

*These are the freshest items. Full detail lives in the DESIGN-*.md docs noted.*

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 0.1 | **Bundle expansion into evaluation** | M | The ONLY remaining piece of the scope-bundles feature. Adding a "trigger" item (e.g. demising wall) auto-adds its cascade items (electrical/fire-alarm/sprinkler reconfig) as SEPARATE, individually-deletable line items; plus a manual "Add Bundle" button. Both triggers. **This is the only bundle piece that WRITES to the evaluation (money math) — build fresh + careful, click-and-watch.** Spec in `DESIGN-scope-bundles.md` ("Bundle expansion into the evaluation — SPEC"). Rest of bundles (schema/storage/routes/admin UI) is DONE + shipped. |
| 0.2 | **AI intake parser** | L | Biggest feature. Step 1 files/email/typed-text → Claude reads → proposes scope items (+ desired occupancy date as a cost/feasibility trigger) in Step 2 for dev-team review (accept/edit/reject, bulk actions, manual-add always available). Hybrid catalog-match. Rules in an editable DB table. Full spec in `DESIGN-ai-intake-parser.md`. Foundations exist (ai-routes.ts, files-by-step, catalog). |
| 0.3 | **Context-aware pricing** | M | Proposed/added scope pulls the RIGHT price at Step 4 from property attrs + qty: 40' clear → 40' demising wall price (new clear-height variant pricing, mirror the SF-tier pattern); 5000sf office → correct SF tier (tiering already exists). Spec in `DESIGN-context-aware-pricing.md`. |
| 0.4 | **First-gen / second-gen space tracking** | M | Manual flag, property default + per-RFP override (field name `spaceGeneration`, NOT `generation` — collision with doc-generation). Occupancy report segments first-gen (80-90% perm-financing lease-up) vs second-gen separately. Spec in `DESIGN-space-generation.md`. |
| 0.5 | **App Settings system** | M | Admin-editable settings table + page + `getSetting(key, fallback)`. Seed with branding (single-source already done in `server/lib/branding.ts`), occupancy thresholds (90/70), perm-financing threshold. The AI parser's rules table could share this infra. Audit in `SETTINGS-AUDIT.md`. |
| 0.6 | **Deploy verification** | S | Pull + Republish, then confirm live: Calculation Basis on the 4 soft costs, the fixed ROM-pilot Select-All button, the new Scope Bundles UI. |
| 0.7 | **Server-side TS2339s (~22)** | M | Case-by-case; some are real bugs (like buildingName was), some need judgment (getUser is an unimplemented method, not a typo). Investigate individually, don't batch-rename. Do NOT touch the ~500 eval-budget API-typing errors (high risk, no benefit). |
| 0.8 | **ROM Pilot ↔ Evaluation convergence** | M/L | Make ROM Pilot mirror the Evaluation: bays+tenant+line items, report with costs-in-place footer. KEY: quantities editable, unit rates LOCKED (from catalog). Optionally pull from a Step-1 RFP. Already ~70% there structurally. Build order: rate-lock first (small/safe), then report mirroring, then RFP pull. Spec in `DESIGN-rom-pilot-convergence.md`. |

**Cleanup (no rush, days):** decommission old Neon DB (ep-still-mud) after confidence · revoke the session's GitHub PAT · delete the Railway test project.

-----



## How to use this file

- Items are grouped by category, and within each category ordered roughly by priority.
- Each item has enough context to start work without re-deriving it.
- "Effort" is a rough sizing: **S** = one prompt / under an hour · **M** = a focused
  session · **L** = multi-session or touches core flows.
- When picking work: Quick Wins first if time is short; Features when there's a real
  session to give; Data Decisions only with Adolfo's eyes on them.

-----

## 1. Quick Wins

*Small, low-risk, well-understood. Good for short sessions.*

|#  |Item                                   |Effort|Notes                                                                                                                                                                                                                                                                                                                                                             |
|---|---------------------------------------|------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|1.1|CI pipeline cleanup                    |S     |CI fails on every push. Two false positives: (a) `npm test` — no test script exists, add a placeholder `"test": "echo 'no tests' && exit 0"`; (b) `npm audit` exits non-zero on any finding — set `--audit-level=high` or make the security job non-blocking. Report any genuine high/critical CVEs.                                                              |
|1.2|Contingency matcher broadening         |S     |The CM% base-backout needs the contingency line subtracted from the base. For pre-2026 projects, contingency has a null `romSnapshot`, so the matcher misses it and the CM% reads slightly low. Fix: broaden the contingency matcher to match on `description` containing "contingency" as a fallback — same proven pattern used for the CM fee matcher. Makes CM% accurate across all 51 projects, not just 2026.|
|1.3|Logo/endpoint legacy naming            |S     |The Kurv logo asset is `bridge_logo_new_base64.txt`, served via `/api/bridge-logo` — both still use the pre-rebrand "bridge" name. Functional, just legacy. Rename asset + endpoint + all callers when convenient.                                                                                                                                                |
|1.4|Dead code: `/api/auth/user` stub       |S     |`auth-routes.ts` ~line 417 has an unreachable dev-era stub creating a 'test-admin' user. Harmless but confusing. Delete.                                                                                                                                                                                                                                          |
|1.5|Cosmetic: percentage scope-item display|S     |Percentage-based library items (e.g. CM fee) display as "$0.03 per $" instead of "2.75%". Show the percentage directly for items defined that way.                                                                                                                                                                                                                |

-----

## 2. Features

*Real new capability. Needs a proper session.*

|#  |Item                                     |Effort|Notes                                                                                                                                                                                                                                                                                                                                                          |
|---|-----------------------------------------|------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|2.1|Properties module — mobile responsive    |M     |So Adolfo can answer "what's the parking at X property" from his phone on the road. Properties list → stacked cards below 768px; property detail reflows to single column; no horizontal scroll at 375px. Prompt already drafted in chat history.                                                                                                              |
|2.2|Home-screen icon (PWA basics)            |S     |`manifest.json` + apple-touch-icon so the app launches from a phone home screen without browser chrome. Often bundled with 2.1.                                                                                                                                                                                                                                |
|~~2.3~~|~~Stamp `masterItemId` on budget line items~~|~~M~~|**DONE May 2026.** 282 of 1,172 line items now carry `masterItemId`. Template import stamped at creation. Report switched to integer-primary matching with string fallback. ~890 free-text and ~30 office-area items remain null (genuinely unresolvable). See BACKLOG 5.2 for office-tier follow-up.|
|2.4|Mobile Step 1 / RFP intake entry         |L     |Let the leasing team start a new RFP from a phone. **Depends on the email/RFP parser (4.x)** — without it, mobile Step 1 is a 30-field form nobody will use. Build parser-first, then a mobile-friendly upload-and-confirm entry on top.                                                                                                                       |
|~~2.6~~|~~Fixed-allowance line item exemption~~|~~M~~|**DONE May 2026.** `isFixedAllowance` boolean on each line item (stored in JSON, defaults false). Toggle button (lock icon) in display-row actions; "Fixed" checkbox in edit mode. Distribution logic in `calculateDistributedCosts` excludes fixed items from both the rollup denominator and design-cost denominator — hidden costs redistribute to non-fixed peers. Amber badge in UI; amber highlighted row + "Fixed Allowance" badge in report HTML and print/PDF output. Grand total is computed independently (raw `totalPrice` sums) and is provably unchanged by toggling. Edge case: if ALL lines are fixed, the function returns early for each and the stranded hidden costs remain in the grand total but are unallocated per-line — the total is still correct. See HANDOFF.md for verification numbers.|
|2.7|Line-item search across evaluations AND contractor proposals|M     |No way currently exists to search budget line items across RFPs. Users need to find where a specific scope item was priced historically (e.g. "which RFP did I price a Cooler in?") and drill into the source. Build a search — on the Reports page or global — where a user enters a text term and gets back matching line items from two clearly separated sources: **(A) Evaluation/ROM budget line items** (what we priced) and **(B) Contractor proposal/bid line items** (what contractors quoted). Each result shows: RFP number, tenant, property, line item description, quantity, unit price, total price, source (our estimate vs. which contractor), and a click-through to the full ROM or full proposal. Toggle to search one source, the other, or both. Read-only. Natural stepping stone toward historical cost benchmarking — comparing our estimates against contractor pricing over time is exactly the intelligence the roadmap is building toward.|
|2.8|iPad / tablet optimization|M     |Optimize the app for iPad use (primary: landscape). Unlike phone optimization, this keeps the existing desktop-style layout — the work is **(a)** ensuring wide tables, modals, and report views fit and scroll cleanly within a ~1024 px viewport without clipping, and **(b)** making all interactive elements touch-friendly: adequate tap-target sizes for buttons, toggles (including the Fixed Allowance lock), dropdown items, and form controls. Reference `docs/DESIGN_STANDARDS.md` and update it with any tablet-specific touch-target standards. Test in iPad landscape and portrait. Does **not** require the stacked-card rework that full phone optimization needs. Side benefit: improves trackpad/laptop use too.|

-----

## 3. Pre-Existing Bugs

*Known broken, predate the recent work.*

|#  |Item                                       |Effort|Notes                                                                                                         |
|---|-------------------------------------------|------|--------------------------------------------------------------------------------------------------------------|
|3.1|"Analyze with AI" returns "Analysis failed"|M     |The AI bid-analysis button fails. Needs console/network debugging to find the actual error before fixing.     |
|3.2|`/api/version` returns 500 in production   |S     |Version endpoint errors in prod. Likely small.                                                                |
|3.3|MG Westside Bldg B — missing dock counts   |S     |Bay records for MG Westside Building B are missing dock door counts. Data entry / verification against source.|

-----

## 4. Deferred & Tech Debt

*Intentional postponements and known debt. Address opportunistically.*

|#  |Item                                            |Effort|Notes                                                                                                                                                                                                                                                                                                     |
|---|------------------------------------------------|------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|4.1|Enhanced types in 4 admin UI components         |M     |`enhanced-rfp-customizer.tsx`, `pdf-template-management.tsx`, `rfp-document-editor.tsx`, `rfp-document-editor-fixed.tsx` don't support Enhanced RFP types. Intentionally deferred during the Enhanced pilot. Revisit before promoting Enhanced to default.                                                |
|4.2|Auth guard audit                                |M     |Route guards are lax — unauthenticated users can reach pages (e.g. Step 3) and hit silent 401s instead of being redirected to login. Audit all routes, add proper redirects.                                                                                                                              |
|4.3|Date input component inconsistency              |S     |Date inputs use raw `<input type="date">` with ad-hoc classes, not the shadcn Input. Define one shared token-derived date-input class. (DESIGN_STANDARDS.md item 8.6.)                                                                                                                                    |
|4.4|Drop legacy `rfp_requests.property` text column |S     |After the propertyId backfill, the text `property` column is redundant. Drop it — but only after grepping to confirm nothing still reads it.                                                                                                                                                              |
|4.5|Three duplicate `parseRfpVariant`-style concerns|S     |Minor: shared utility was extracted, but verify no inline parsing remains. Low priority — no current bug.                                                                                                                                                                                                 |
|4.6|Counter-offer creation reads `rfp_requests` due dates without `invitation_to_bid` fallback|S     |`server/routes.ts` ~line 1383 copies `originalRfp.contractorDueDate` / `architectDueDate` into a new counter-offer row without falling back to `invitation_to_bid`. For the ~27 desynced rows the counter-offer silently inherits NULL dates even though the date exists in `invitation_to_bid`. **Quick fix** (one line each): apply the same `?? invitation.contractorDueDate` / `?? invitation.architectDueDate` fallback already used in the workflow-phase route — fetch the `invitation_to_bid` record for the original rfpId and use the `??` pattern. Separate long-term structural question (drop the `rfp_requests` copy columns entirely vs. enforce reliable sync) is intentionally left open. See HANDOFF.md "Permanent Architectural Note — Due Date Canonical Source" for the full reader inventory.|

-----

## 5. Data Decisions

*Require Adolfo's judgment. Never bulk operations — per-project, eyes-on.*

|#  |Item                           |Effort|Notes                                                                                                                                                                                                                                                                                                                                                         |
|---|-------------------------------|------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|5.1|12 projects with no CM fee line|—     |These genuinely never captured a CM fee in their ROM: RFP-2025-007/007.A/007.B (Lilly base variants), 015 (Sibs), 016 (Viro), 019 (Atlas), 020 (CH Robinson Doral), 021 (Quick Shipping), 025 (Happi Tree), 026 (Maersk), 027 (Absher), 2026-008 (Sterling). Decide per-project whether any are worth backfilling from original deal terms. Not a bulk update.|
|5.2|~30 pre-romSnapshot office-area items lack tier information|—     |These line items could not be assigned a `masterItemId` during the May 2026 backfill. The SF tier was never recorded in the description or romSnapshot — descriptions like "New Office Area", "Office Area", "Warehouse Office Area", "Office Area Expansion" give no indication of whether the space was under 3,000 sf, 3,001–5,000 sf, or over 5,000 sf. These **cannot be reworded safely** until a tier is assigned. Decision: someone who knows the projects reviews these ~30 items, determines the actual office SF for each, and assigns the correct tier (rom_scope_items id 36 / 37 / 38). Per-project, eyes-on — never a bulk guess.|

-----

## 6. Roadmap

*Larger product direction. Not scoped yet.*

|#  |Item                                 |Notes                                                                                                                            |
|---|-------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
|6.1|Master Cost Library                  |Centralized, versioned cost reference.                                                                                           |
|6.2|Workletter / broker PDF parser       |Parse broker PDFs into structured RFP data.                                                                                      |
|6.3|Email / notes parser                 |Parse inbound emails into RFP intake. Unblocks 2.4 (mobile Step 1).                                                              |
|6.4|Lease pipeline intelligence expansion|Evolve from TI project tool into a lease pipeline platform — views for Development Managers, Leasing, Executive Leadership.      |
|6.5|Enhanced RFP pilot evaluation        |After several Enhanced RFPs run, decide whether to promote Enhanced to default. If yes, triggers 4.1 (the 4 admin UI components).|

-----

## Done — recent

*Shipped and live. Kept briefly for reference, prune over time.*

- BACKLOG 2.3 — `masterItemId` stamped on budget line items. 282 of 1,172 items now carry a stable integer FK to `rom_scope_items`. Template import fixed going forward. Report switched to 3-pass integer-primary matching. 279 historical items backfilled; ~890 free-text and ~30 office-area items correctly left as null (see 5.2). May 2026.
- Category Cost Breakdown report — built, debugged (dead-click, nav, property filter, scope matching, print truncation), CM matcher broadened to recover 44 historical projects, Kurv logo header, print/PDF. Live on rfptracker.app.
- Enhanced RFP system — Standard + Enhanced variants, parallel pilot, two new PDF templates.
- Dashboard redesign — compact KPI row, collapsible sections, RFP list promoted.
- 9 `apiRequest` argument-swap bugs fixed across 6 files; JSDoc protection added.
- 50-row `propertyId` FK backfill.
- Property records confirmed as legitimate distinct buildings (not duplicates).
- DESIGN_STANDARDS.md created — extracted, ruled, formalized.
- Kurv logo unified across all report headers.

-----

## Maintenance notes

- When an item ships, move it to **Done — recent** with a one-line summary.
- When a new item surfaces mid-session, add it to the right category immediately —
  don't rely on memory.
- This file pairs with HANDOFF.md: HANDOFF.md is the per-session narrative log;
  BACKLOG.md is the standing list of what's not yet done.
