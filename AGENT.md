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

## Unassigned change order lines (2026-10-21)
- A budget CO line may use UNALLOCATED_KEY (`CO_UNASSIGNED_KEY`): approved, it raises the Unallocated row (same row unmapped vendor cost lands on), so budget and cost wait together.
- Vendor CO lines not mapped → the form's fallback, else Unassigned (no more 400).
- Each linked vendor CO row has "Assign budget lines": a per-line select that PATCHes the vendor SOV line's allocation (so cost follows) then resyncs the tenant CO. Lines can go to different budget lines.
- linesFromVendors fallback ignores keys a vendor line has since been mapped to.
- budgetVsActual doesn't add a second Unallocated row when the effective baseline already has one.

## Direct costs spelled out (2026-10-21)
- positionAsOf: `direct.rows` (id, date, vendor, description, method, reference, key, amount). positionInput.directCosts carries those fields.
- Pay App Status (screen + print): summary row "Direct costs — no contract (n, listed below)" + a "Direct Costs (No Contract)" table: Date | Paid To | Description | Budget Line | Paid By | Amount.

## Two invoice streams: capital partner vs tenant (2026-10-21)
- Bundle has `cmInvoiceDrafts: { capital, tenant }` (capital = type 'fee', tenant = 'reimbursable'); `cmInvoiceDraft` kept = the legacy `invoiceType` one.
- Each stream: own previous/covered (issued filtered by `streamOf(rec)`; legacy records without type = fee), own basis (`invoiceBasisCapital/Tenant`, fallback `invoiceBasis`), own bill-to (`billToCapital/Tenant`, fallback legacy `billTo` for the legacy type; tenant defaults to tenantName, capital blank).
- Drafts add `stream, incurred, paidToDate, invoicedToDate, invoices`; items carry `paid`. Capital items = every cost incurred (billed items) with paid, whatever the fee basis.
- POST cm-invoices `{stream}`; DELETE allows the latest of its own stream. Report `?stream=capital|tenant` for drafts.
- Capital invoice prints "Costs Incurred and Paid to Date" (reference only). BvA print has `billingTable` (Billing Summary — Capital Partner vs Tenant). Reports tab: summary card + two InvoiceCards (CAP-nn / TEN-nn).
- Capital partner is funded the LAF amount up front, so the capital invoice is the CM fee only (Adolfo, 2026-10-21).

## Reports tab rolled up, CM Fee Report, projections, tenant bills change orders only (2026-10-21)
- Reports tab: every report is a collapsible `Card id=…` (open state in localStorage `pm-report-open-<id>`), grouped "Cost reports" / "CM fees & billing"; collapsed rows show a one-line summary.
- New `/api/reports/cm-fees/:id` (renderCmFeeReportHtml): by party (earned, invoiced, billable now, projected, still to bill), CO fees, cmFeeTable, invoices with fee part split from costs.
- Drafts carry `feeInvoiced` (latest issued record's earned+suppFee), `projected` {original, changeOrders, pending, budget, base, fee, total?, pendingTotal?}. Capital projected = partner rate × (committed non-CM cost − approved linked CO SOV work) + Σ approved CO cmAbsorbed. Tenant projected = Σ approved CO cm (fee) and Σ t.tenant (total).
- Setting `tenantBills: 'cos' | 'all'` (default 'cos'; legacy invoiceType 'reimbursable' → 'all'). 'cos': tenant stream tenantPct map = zero-base effectiveBaseline with unlinked COs only, so only CO shares bill.
- Contract card: "Pay apps & invoices" rolls up (rolled key '__apps') to count · latest · open.

## CM Fee Report layout per Adolfo's markup (2026-10-21)
- No eyebrow, "CM Fees by Party" (no "— Earned to Date"), no notes under the party table. Landscape.
- Columns: Party | Rate | Original Budget (fee figured on) | Original Fee | Approved Change Orders (subject to fee, + pending) | Change Order Fees (+ pending) | Total Anticipated Fees | Earned to Date | Invoiced | Billable | Remaining to Bill (= anticipated − invoiced).
- Original budget = Σ breakdown (revised − changeOrders) excluding CM lines (was committed). coTotals now returns partnerBase/tenantFeeBase; projection carries coBase/pendingBase. Same columns on the Reports tab.
- (2026-10-21) Original budget INCLUDES the CM fee: origTotal = Σ(revised − changeOrders) incl. CM line (excl. Supplemental CM line); base = origTotal ÷ (1 + partner rate); original fee = origTotal − base. Accordia: $1,466,500 → $1,427,250.61 + $39,249.39.
- (2026-10-21) `settings.feeInBudget` (checkbox in the CM fee box): budget includes the CM fee → back it out; unchecked → base = budget less CM lines, fee on top. Default (unset) = the budget has a CM line. Exposed as cmSettings.feeInBudget / feeInBudgetSet.

## Partner fee "difference only" + earned by party (2026-10-21)
- partnerFeeBasis adds 'absorbed' (work − tenant share). New COs from the form default to 'absorbed'; API/legacy default stays 'all'. Wired through coTotals (partnerOn), coFeeLinks/supplementalCmEarned/billableItems (v − t).
- Drafts carry earnedBilled / earnedPaid {base, fee} regardless of basis. CM Fee Report "CM Fee Earned to Date" is by party × basis (billed, paid) with Total Anticipated and Remaining; replaces cmFeeTable there.
- Local test token expires after 24h: `UPDATE auth_tokens SET expires_at = now() + interval '7 days' WHERE token=…` in rfpt_verify.

## Precise tenant shares (2026-10-21)
- Tenant shares (link pct, line tenantPct) keep up to 10 decimals (normalizeCO pct helper, POST vendorLinks, PATCH links). `SharePercentInput` stores the typed value, shows 2 decimals.
- Vendor rows (new form and the row under each tenant CO) have a "Tenant pays" dollars box: typing dollars sets pct = dollars ÷ cost × 100 exactly.
- (2026-10-21) Tenant CO print: banner 'Tenant Change Order' (number stays in the info rows), no eyebrow, no budget-line mapping under each line.
- (2026-10-21) Budget panel and Budget change orders roll up (useRolled hook, localStorage pm-rolled-budget-<id> / pm-rolled-budget-cos-<id>); bodies stay mounted (hidden) so unsaved edits survive.
- (2026-10-21) Edit form for a linked tenant CO: Tenant % (and Tenant pays $) editable per vendor line; applies to all lines of that vendor CO and is sent as `links` on PATCH (all current links sent, so none are dropped).

## Supplemental funding only for a shortfall (2026-10-21)
- fundingSources(rows, a, {committed, pending, byKey}): need = Σ lines (committed+pending if anything committed, else budget before COs; contingency lines with nothing committed = 0; deal-discount row at budget) + unplaced cost + approved COs' markups + tenant fee + partner fee + work of unlinked COs. fundsIn = original + revisions + tenant. supplemental = max(0, need − fundsIn); surplus = max(0, fundsIn − need); absorbedFromSurplus; totalFunding = fundsIn + supplemental.
- Funding box (screen + BvA print) shows Projected cost to complete and Projected surplus / shortfall; story shows "we absorb $X" instead of the supplemental label.
- (2026-10-21) fundingSources also returns contingency (unspent on contingency lines) and overLines (committed over revised budget, non-contingency); funding box warns 'Cover it with Move money from contingency' or that contingency is used up.

## Change orders paid from inside the budget + CM Fee Report ribbons (2026-10-21)
- BudgetCO.fundedFrom [{key, amount}]: the absorbed part paid from other budget lines (contingency etc.). coTotals → funded (≤ absorbed), budgetIncrease = total − funded. applyChangeOrders moves funded amounts off the source lines (tenant share kept in proportion). coSummary.approved/pending use budgetIncrease (+ approvedFunded); story groups total = budgetIncrease (+ funded).
- Form: "Paid for by" block (only when we absorb > 0): rows of source line + amount, "+ Pay from a budget line", "Pay from Contingency", remainder = new money (Supplemental). CO list Budget + shows budgetIncrease and the sources. BvA print: Budget Increase + "Paid from …".
- POST/PATCH validate fundedFrom keys against the baseline.
- CM Fee Report: grey (#4b5563) section ribbons; removed "less the CM fee" sub-label and both legends.
- (2026-10-21) Capital partner fee base fixed: feeP = rate × all original work (origAmount) and direct cost amount, not the tenant-weighted billable; invoiceCalc 'fee' costs = Σ amount. Matches the Budget tab CM fee earned (2.75% × spent).
- (2026-10-21) Funding need no longer double counts unmapped contract cost: need = committed lines + max(open (un-bought, non-contingency) line budgets, Unallocated committed) + CO extras. Returns `unmapped`; funding box nudges to map lines.
- (2026-10-21) invoiceCalc 'fee': original fee = r2(Σ(amount − coAmount) × rate) once, so it ties to base × rate (was a cent off from per-item rounding). CM fee box shows earned on billed and on paid.
- (2026-10-21) CM Fee Report 'CM Fees on Change Orders' adds Markups, Credit, Tenant Fee Base, Partner Fee Base so each row ties to the party table.
