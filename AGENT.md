# AGENT.md — How to work in this repo

This file is the working contract for any AI agent (or human) making changes to
RFP Tracker. It exists because the approach below has repeatedly caught real bugs
that "looked fine" in code review. Follow it.

## The golden rule
**Evidence over narration. Never accept "it works" without proof.** A description
of behavior is not proof. Raw diffs, real query results (with the database stated),
and live test output are proof. The gold standard is: click the button and watch.

## Source of truth & workflow
- **GitHub is the source of truth** (`ARSavantCG/rfptracker`). Not Replit, not any
  single environment.
- Work on a `feature/*` branch: clone → edit → typecheck → push → open a PR → merge.
- Replit is a **deploy target**, not a dependency. The app must build and run on any
  host (honor `process.env.PORT`; don't hardcode Replit-isms).

## Before writing any code
1. **Recon first.** Read the relevant code paths. Grep for how a thing is actually
   done elsewhere before adding a new pattern. Inventory before building.
2. Establish a **typecheck baseline**: `npx tsc --noEmit 2>/dev/null | wc -l`. Your
   changes must not raise the count. Diff the error list, don't chase zero (there
   are known pre-existing errors).

## While coding
- **Surgical, guardrailed changes.** State explicitly what you are NOT touching.
- **Two render paths exist for many things.** Notably bay config has an "Add" form
  AND an "Edit" modal that don't share a component — new fields must go in BOTH.
  Search for all call sites before assuming one edit is enough.
- **MANDATORY before claiming a form field is done:** count the render paths and
  confirm the field is in the one that's actually editable. For a modal, grep the
  edit-form heading (e.g. `grep -c "Edit: {item.name}" the-modal.tsx`) — if it
  returns >1, there are multiple forms and the field must go in the RIGHT one (the
  editable path, not a display/preview variant). A field can be present in the file,
  compile into the bundle, and STILL not appear because it's in the wrong path. If a
  deployed change "isn't showing," check the bundle hash changed AND which render
  path the field landed in BEFORE assuming it's a cache/deploy problem.
- **Duplicate class methods = silent bugs.** If `npm run build` warns "Duplicate
  member" (e.g. in storage.ts), JS uses the SECOND definition and discards the first
  — and they may DIFFER (one sorts, one doesn't). Treat these as real bugs, not noise.
- Match existing patterns (auth, error handling, formatting) rather than inventing.

## How numbers and fields look (Adolfo, 2026-10-20)
- **Money: always commas and two decimals** — 1,466,500.00 — on screen, in reports,
  and in input boxes. Use `MoneyInput` (`client/src/components/cost/inputs.tsx`) for
  any money field and `money()` / `money2()` / `fmtMoneyText()` for display.
- **Percentages: always two decimals** — 2.75%, 3.00%, 100.00%. Use `PercentInput`,
  `fmtPct()`, and `pctText()` for percentages written inside labels
  ("Permit Fees (3%)" → "Permit Fees (3.00%)"). All in `shared/format.ts`.
- **No placeholder text in empty boxes.** Grey example text reads as if a value were
  already filled in. Give every field a visible label instead. `index.css` hides
  `::placeholder` app-wide; don't add `placeholder=` to new fields.
- **Dropdowns inside table rows:** use the shadcn `Select`, not a native `<select>` —
  a native one in a ledger row would not stay open in Chrome on Windows.

## Verification (required, not optional)
- `npm run build` must pass.
- Typecheck delta must be zero new errors in touched files.
- For logic, write/extend a direct test that imports the REAL module
  (see `test-costs-in-place.ts`) — not a re-implementation.
- After deploy, the human clicks the actual button and watches. Nothing ships as
  "done" until a real user action confirms it against real data.

## Database — the two-database trap
- There are effectively multiple databases (dev vs prod; connection-string tools
  vs the DB the app actually reads). **A migration "verified" against one is NOT
  verified against the others.**
- **Migrate the DB the app actually reads, from inside its environment:**
  `psql "$DATABASE_URL" -c "ALTER TABLE ... ADD COLUMN IF NOT EXISTS ..."`.
- Additive nullable columns are now auto-applied at boot via
  `server/startup-migrations.ts` — add a line there when you add a nullable column
  to `shared/schema.ts`. Anything destructive/structural gets a real reviewed
  migration in `/migrations`, applied deliberately.
- Costs are stored in **cents** in several tables; divide by 100 exactly once, at
  the display edge. `rom_scope_items`/`evaluation_budgets` are dollar text strings —
  never mix.

## Auth
- `requireAuth` is **Bearer-header-only** (no cookies). Client fetches to guarded
  routes need `Authorization: Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}`.
- Resources loaded by browser navigation (`window.open`, `<iframe>`, `<a href>`,
  `<img>`) can't send headers — use `requireAuthFlexible` (header OR `?token=`)
  server-side and `withAuth(url)` client-side.

## End of session
1. Push the branch.
2. Update `HANDOFF-*.md` with: what shipped, migration status (which DB, verified how),
   deploy checklist, and any lessons (bug → root cause → fix → prevention).
3. Note anything deferred and any credentials that should be rotated.

## Deploy checklist
1. Merge to `main` (PR, or fast-forward if clean).
2. Pull on the deploy host; deploy.
3. Startup migrations auto-apply additive columns; verify the app boots
   ("Startup schema check complete" in logs).
4. Human verifies on production: log in, exercise the changed feature against real data.
5. Tear down any temporary infra; rotate any exposed credentials.

## AI features
- One switch for every AI feature: Admin → AI (`app_settings.ai_enabled`, missing = on). Server: `server/lib/ai-switch.ts` — put `requireAi` on any new AI route; client: `useAiStatus().on` hides the button.
- All AI uses the one `ANTHROPIC_API_KEY` secret. AI only fills a screen for review; it never saves.
- Pay app reader: `POST /api/cost-contracts/:id/read-pay-app` (file or documentId). The model proposes which SOV line each G703 row is; `shared/cost-payapp-read.ts` re-checks every match (id → item # → description → value) and returns unmatched rows rather than dropping them.
- Setup from a pay app: `setupPlan()` (shared) + `POST /api/cost-contracts/:id/setup-from-pay-app` add missing lines/COs (unallocated), an opening app numbered N−1 from column D (optionally marked paid), and retainage %. Rows carry `rowIndex` — never match rows by object identity after JSON.
- SovGridEditor resets to server lines while untouched; a stale open grid would otherwise delete lines added elsewhere on save.
- Change orders: `startAppNumber` = the pay app it was APPROVED on (set on create, or on approval → next app) or `changeOrderStarts()` (billed → recorded-after → next). `g702For` leaves a CO out of apps before its start; pass `{ allChangeOrders: true }` for "the contract today" (contract card). Pending COs are out of the contract sum and shown as `pendingChanges` beside it.
- Pay app numbers: `number` = order within the contract (all "previous" math); `docNumber` = printed number, pay apps and invoices counted separately. Always display `docNumber`; create through `newAppNumbers()`.
- Revised budget: `budgetBreakdown()` gives per line Original (confirmed snapshot) + Revisions + Transfers + Approved COs = Revised; `fundingSources()` gives Sources of funds (approved budget, tenant-funded COs, Supplemental Funding = absorbed COs + projected cost beyond revised). Label is `settings.supplementalLabel`. Budget vs Actual prints landscape when the movement columns show.
- Budget COs: contractor side can be written or linked later (`writeContractId` / `linkContractCoId` / `unlink` on PATCH); backup files carry `cost_documents.budget_co_id`; `/api/reports/tenant-co/:id?co=` prints the tenant change order.
- Tenant change orders (budget COs): `links` = vendor change orders (any contracts) each with a tenant %; lines are priced from the vendors (`linesFromVendors`, snapshot; "re-price" resyncs; first typed estimate kept in `estimate`). `coTotals()` splits tenant vs absorbed: CM fee on the tenant's share only, `cmOnAbsorbed` adds fee on our share (capital partner), `credit` is a tenant concession we absorb. Every CO CM fee goes to the separate Supplemental CM Fee row (CO_CM_KEY) — never the original CM line.
- Each budget CO has a `reason`; `budgetStory()` groups approved COs by reason against the original for "Why the budget changed".
- CM fee earned / invoiced: work on vendor CO lines linked to approved tenant COs (`coFeeLinks`) earns the Supplemental CM Fee at that CO's tenant % and rate (`supplementalCmEarned`; `cpFee` = our share when `cmOnAbsorbed`, only on fee-type invoices to the capital partner). The original fee's base leaves that work out. `billableItems` items carry `fee`/`suppFee`/`cpFee`; `invoiceCalc` sums them (flat rate only for items without them). Reimbursable invoices list tenant credits as items.
- Contractor G702 check: `cost_applications.contractor_g702` (lines 3,4,5,7,8; `normalizeContractorG702`), `g702Check()` → status none/match/off + first line off; bundle apps carry `check`. Shown in the pay app window (Theirs column), as ✓/⚠ in pay app lists and on the Pay App Status report, and warned in the payment window.
- Pay App Status filters by contract (`?contract=<id>|direct|all`) via `filterPositionInput`, shared by screen and print; CM fee section only for "all".
- Partner fee basis per tenant CO: `partnerFeeBasis` all | tenant (absorbed share not charged), or `partnerFee` false for none; applies to coTotals, supplemental earned and partner invoices.
- Two CM fee rates: `cmSettings.pct` = capital partner rate (settings.cmFeePct); `cmSettings.tenantPct` = tenant rate (settings.tenantCmFeePct, else the CM line's name %, i.e. the LAF). Tenant change orders fix both on creation (`cmFeePct` tenant, `partnerFeePct` partner) and carry `markups` (default `defaultMarkups()` = the LAF's % lines). `coTotals`: budget = cost + markups + partner fee (all work); tenant pays = tenant share + markups + tenant fee (on share + markups) − credit; absorbed = budget − tenant (can be negative: the fee spread). Reimbursable invoices use the tenant rate; fee invoices the partner rate (`fee/suppFee` vs `feeP/suppP` on items).

## Tenant change orders: discount, per-CO rates, typed fee, fixed markups (2026-10-21)
- CM fee to the tenant is figured on max(0, tenant work + markups − credit): a discount carries no CM fee.
- Tenant rate (`cmFeePct`) and partner rate (`partnerFeePct`) are editable per change order (POST/PATCH); defaults come from project settings.
- `cmFeeAmount` overrides the figured tenant fee (shown amber "Edited"); clear it to go back to figured.
- `CoMarkup.amount` = fixed-amount markup (e.g. permit fees); % ignored when set. Tenant sheet omits % for fixed lines.
