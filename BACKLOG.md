# RFP Tracker — Backlog & Open Items

**Purpose:** The running list of everything outstanding for RFP Tracker / Savant Portal.
When Adolfo asks "what's open / outstanding / ready to tackle," this file is the answer.
Keep it current — move items to **Done** when shipped, add new items as they surface.

**Last updated:** May 2026

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
|2.6|Fixed-allowance line item exemption      |M     |Some tenants specify a fixed allowance (e.g. "carry $3/SF for X"). Today, hidden costs distribute proportionally across all visible line items, inflating that $3 to $5+. Add a per-line-item toggle ("Fixed allowance") in the evaluation: when on, the line is exempt from hidden-cost distribution and displays its exact entered value. The hidden-cost pool redistributes across the remaining non-exempt lines — total project cost is unchanged. Exempted lines stay visible as normal ROM lines with locked pricing, and are visually marked as fixed allowances in the Evaluation Budget Report and PDFs. Requires careful total-cost reconciliation. **Sequenced after 2.3.**|

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
|4.6|`rfp_requests` due-date columns unreliable — counter-offer reader missing fallback|S     |`rfp_requests.contractor_due_date` / `architect_due_date` are a denormalized, unreliable copy of `invitation_to_bid` dates. ~27 rows are desynced (dates exist only in `invitation_to_bid`, NULL in `rfp_requests`). The workflow-phase validator was fixed (May 2026) with an `itb` fallback. One remaining reader has no fallback: counter-offer creation at `server/routes.ts` ~line 1383 copies `originalRfp.contractorDueDate` without checking `invitation_to_bid` — for the 27 desynced rows a new counter-offer would silently inherit NULL dates. Long-term: either keep columns reliably synced (backfill the 27 rows then enforce via trigger/hook), or drop the `rfp_requests` date columns and read `invitation_to_bid` directly everywhere. See HANDOFF.md "Permanent Architectural Note — Due Date Canonical Source" for the full reader inventory.|

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
