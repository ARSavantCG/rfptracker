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
|2.3|Stamp `masterItemId` on budget line items|M     |Budget line items currently carry no stable link to the library scope item they came from, forcing string-matching in the Category Cost Breakdown report. Proper fix: stamp `masterItemId` at budget creation time, then the report joins on an integer ID and string-matching can be retired. Touches the ROM budget creation flow — own session, own testing.|
|2.4|Mobile Step 1 / RFP intake entry         |L     |Let the leasing team start a new RFP from a phone. **Depends on the email/RFP parser (4.x)** — without it, mobile Step 1 is a 30-field form nobody will use. Build parser-first, then a mobile-friendly upload-and-confirm entry on top.                                                                                                                       |

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

-----

## 5. Data Decisions

*Require Adolfo's judgment. Never bulk operations — per-project, eyes-on.*

|#  |Item                           |Effort|Notes                                                                                                                                                                                                                                                                                                                                                         |
|---|-------------------------------|------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|5.1|12 projects with no CM fee line|—     |These genuinely never captured a CM fee in their ROM: RFP-2025-007/007.A/007.B (Lilly base variants), 015 (Sibs), 016 (Viro), 019 (Atlas), 020 (CH Robinson Doral), 021 (Quick Shipping), 025 (Happi Tree), 026 (Maersk), 027 (Absher), 2026-008 (Sterling). Decide per-project whether any are worth backfilling from original deal terms. Not a bulk update.|

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
