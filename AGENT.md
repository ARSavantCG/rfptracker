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
- (2026-10-21) fundingSources splits need into cmReserved (cm-bucket lines at max(budget before COs, committed) + approved COs' tenant & partner fees) and projectCost; surplus never includes the CM fee. Funding box/BvA: 'CM fees — set aside' row + 'Projected cost to complete' (project only).
- (2026-10-21) Original CM fee in the projection = partner rate × (project cost to complete − approved CO work & markups), capped at the CM line budget (a ceiling; 0 when no CM line). spendable = surplus ÷ (1+rate) while the fee has room under the ceiling, else surplus − room. fundingSources takes cost.cmRate.
- (2026-10-21) settings.cmUncapped (checkbox in CM fee box): off = capital partner's original fee capped at the CM line budget (invoices, earned, projection); on = earns on every dollar (supplemental funding / lease amendment).

## Pricing by quantity on one catalog item (2026-10-22)
- rom_scope_items.price_tiers json (startup migration): [{min, max, mode 'unit'|'flat'|'step', price, step?, note}]. Math in shared/line-total.ts: priceByTiers() — the range holding the qty sets the price; NEVER below the top of any lower range (Adolfo's "minimum = top of previous tier", option A). computeLineTotal uses tiers when the item/snapshot carries them (typed unitPrice ignored) and returns tier + effectiveUnitPrice; minimum cost still floors after.
- Snapshot (rom-pricing-utils) carries priceTiers (rate lock). ROM pilot modal, evaluation budget, server line saves and template seeding set unitPrice = effectiveUnitPrice when tiered. ROM pilot rows show "Range …" and "Minimum: top of …".
- Catalog form: PriceTiersEditor (client/src/components/price-tiers-editor.tsx) replaces the min/max SF tier fields; Item family kept (spec-tag variants). List + printed library show tiersSummary.
- server/lib/merge-price-tiers.ts runs once at startup (app_settings 'price_tiers_merged_v1'): SF-tier groups (itemGroup + min/max SF, no match tags) → lowest tier row becomes one item named after the group with ranges at current prices; other rows retired (is_active=false, never deleted); templates repointed/deduped. enforceRomRateLock reads inactive items too so old ROMs stay editable.

## Dashboards (2026-10-22)
- Admin-only. Per project: Overview tab (first tab for admins). Portfolio: top of /projects, sums active projects; collapsible.
- Figures come from `shared/cost-dashboard.ts` (pure) via `dashboardFor(bundle)` in cost-tracking-routes; every bundle carries `dashboard`; the list endpoint adds it only for admins.
- CM fee donut: paid / invoiced not paid / earned not invoiced (on work billed) / not yet earned; centre = anticipated. "Paid" comes from `paidDate`/`paidAmount` on CM invoices — recorded on Reports → invoice card → "Record payment" (`PATCH /api/cost-projects/:id/cm-invoices/:number/payment`, `{amount:null}` clears).
- Vendor donut: paid / approved not paid (owed) / retainage / not yet billed = contract sum.
- Schedule: bar = % billed, line = % of start→completion elapsed; late = past completion, behind = billed trails time by >10 pts. Needs contract start + completion dates; undated contracts fold into one "Show N" line.

## Lien waivers: order, GC vs subs, missing (2026-10-22)
- `cost_waivers.sort_order` (drag by the grip; `POST /api/cost-applications/:id/waivers/order {kind, rows}` — expected-only unconditionals are saved first) and `cost_waivers.party` ('gc'|'sub'; null = `isGcVendor(vendor, contract.counterparty)`, a 10-letter shared start).
- Unconditionals follow the previous pay app's conditional order unless reordered. Package zip numbers waiver files in that order.
- `missingConditionals`: GC every pay app + every vendor on the previous pay app; a conditional entered here (even not needed = "Not this pay app") answers it. Tracking starts at the first pay app on the contract with any waiver.
- Dialog: totals (subs, GC, GC less subs, GC vs G702 line 8), missing rows (GC prefilled with payment due), "Still outstanding from earlier pay apps" with tick/attach/not needed.
- Log: Received column, missing rows, per-pay-app GC/subs subtotal. CM invoice backup: Retainage Held (G702 held now less held before). DRAFT watermark via `reportHeaderHtml({ draft })`: unissued CM invoices, unconfirmed budget (BvA, Budget Log). Tenant COs not watermarked (they go out for signature).

## Capitalization + fit (2026-10-22)
- Adolfo wants Title Case on every label, heading, column, button, tab, option, tag and toast title ("Invoiced, Not Paid"); full sentences / help text / tooltips stay sentence case. Small words (a, an, the, and, or, of, on, in, at, to, by, vs, per, for, with, from) lowercase mid-label; acronyms kept (CM, GC, CO, SOV, G702, LAF, ROM, RFP).
- Swept with a TS-AST script (labels in th/h*/Button/SelectItem/TabsTrigger/label/DialogTitle, label=/title= on Card-like components, label: props, ?: branches). New UI text should follow the rule by hand.
- CM fee donut: Earned, Not Invoiced split into "— Costs Paid" (ready to invoice) and "— Costs Not Yet Paid" (`earnedOnPaid` per stream from draft.earnedPaid.fee).
- Dialogs fit the window: `w-[96vw] max-h-[92vh] overflow-y-auto grid-cols-[minmax(0,1fr)]` (wide tables scroll in their own box). Package dialog: header pinned, body scrolls.

## Package files: swap, roll up, pay apps per vendor (2026-10-22)
- `cost_documents.vendor`; DOC_TYPES adds `sub_pay_app` (labels Title Case). `payAppVendors(conditionals, contractName)` = one Pay Applications row per vendor (GC first if missing); `isPayAppOf(doc,row)` (GC row takes untagged-vendor G702s too).
- PATCH waiver `{documentId}`: null = unlink (received → false unless sent); id = link (taken off any other waiver, doc retagged to the waiver kind, received → true). PATCH document with a non-waiver docType unlinks it from any waiver. Uploading onto a waiver row replaces its file; the old one stays in Files, untied.
- Dialog: Files list (assign each file via one dropdown: Pay App — vendor, Conditional — vendor, Unconditional — vendor, or a type; "Not Assigned" flagged), Pay Applications section, sections roll up (open by default while something needs attention or a row is being added).
- Zip: "1 Pay Applications/00 GC - … G702-G703", then "NN Sub - Sub Pay App" in waiver order.
- Vendor names (2026-10-22): every vendor box in the package dialog suggests names already on the project (`knownVendors`: one spelling per vendor — the contract's own, else most used; near-identical spellings folded). `closeVendor` offers "Use “…” (already on this project)" under a new row. `sameVendor` tightened: all of the shorter name, or ≥10 letters and ≥80% of it in common — "Centerline Plumbing" ≠ "Centerline Electric".
- Working backwards (2026-10-22): each conditional row shows its unconditional's status ("due with / received with Pay App NN") with Mark Received / Attach — saved on the next pay app (created as expected-matched if needed). An unconditional *added* on the pay app it releases (vendor matches one of its conditionals, none on the previous) offers "Move to Pay App NN": PATCH waiver `{applicationId, fromWaiverId}` (same contract, conditional only).
- Lien Waiver Log by pay app (2026-10-22): `waiversByPayApp` — each pay app's conditionals, then the unconditionals it carries for the pay app before ("Unconditional — for Pay App NN"); a pay app is Compliant (green tag) when none outstanding. A pay app's own unconditionals belong to the next pay app (Adolfo's model). `waiverLog` (per-conditional) still feeds the dialog's earlier-outstanding list and the zip contents.
- Reports: no "GC" tag beside the GC's name; subs indented under it (log: padding-left; zip contents: 4 spaces). In the log, the GC leads each kind in a pay app, subs follow in the arranged order.
- Lien Waiver Log filter (2026-10-22): Reports card lists each pay app with its Compliant / N Outstanding tag; tick some (none = all), "Select Not Compliant", "Outstanding Only". Route takes `?apps=<application ids>&outstanding=1`; the report says what it's showing.
- Project names (2026-10-22): headers, the project list and the schedule show `shortProjectName` (trailing bracketed RFP notes dropped: "(Balance of Bldg.) (RFP-2025-011.B)"); the full name sits small at the foot of the project page and as the list row's tooltip.
- Awaiting Our Payment (2026-10-22): an expected unconditional for a pay app not paid in full (payments on it < its G702 line 8) is 'awaiting payment', amber, with "Pay App NN paid $X of $Y" — not outstanding, not against compliance. `paidOfFrom(payments, dueOf)` → `PaidOf`; passed to `waiversByPayApp` / `waiverLog`. Shown in the log (row + group tag + summary), package dialog (row tag, badge, header), conditional status line ("once we pay…"), zip contents, Reports card tags.
- Not billing this pay app (2026-10-22): a conditional marked not needed with $0 is one gray line ("Not Billing This Pay App: …", Undo = delete → it shows as Missing again) in the package and the log, not a $0.00 row. Deleting a sub who was on the pay app before brings back "Missing" — "Not This Pay App" is the right marker.
- Pay app amounts (2026-10-22): `cost_waivers.pay_app_due_cents` — a sub's own pay app line 8, typed on the Pay Applications row (saved on that vendor's conditional); the GC's comes from this pay app's G702. Check column: Matches / Off by $X against the conditional; subs total row; section badge "N Don't Match" (amber).
- Waivers (2026-10-22, later): only the GC's conditional is required every pay app — subs are listed only on pay apps they bill (`carriedVendors` = "Also on Pay App NN: X (Add)", never outstanding). "Awaiting Our Payment" renamed "Pending Funding". Lien Waiver Log has no "Cost Report" eyebrow.
- Pay Application Log (2026-10-22): `payAppLog` (shared) / `/api/reports/pay-app-log/:id?apps=&issues=1` — per pay app, each vendor's line 8 vs conditional and file attached; "By Vendor" totals. Reports card with the same picker as the Lien Waiver Log.
- Lender Packages (2026-10-22): `preparePackage(appId)` builds one pay app's package into any zip root; `/api/cost-applications/:id/package` (single) and `/api/cost-projects/:id/packages?apps=` (one zip, a folder per pay app + 00 Contents.txt). Reports card: tick pay apps (those with files), Select All / Latest Only, Download Zip.
- GC line 8 (2026-10-22): `gcPaymentDue(app, waivers, contractName)` = typed on the GC's conditional (payAppDue) → the contractor's G702 (contractorG702.currentPaymentDue) → ours (can be a penny off from rounding). Used for the GC row, waiver totals checks, Pending Funding (paid vs due), the Pay Application Log and the zip. GC row is editable: shows the current figure, type theirs over it; clear to fall back.
- Executed change orders (2026-10-22): `shared/co-log.ts` (`coLog`, `cosOnPayApp` = approved COs whose startApp is this pay app). Signed copy = a document with changeOrderId (Contracts tab "Attach Executed" per CO, or the package's Change Orders section); Executed = approved + file. Pay app zip: "6 Change Orders/<No> - <Title> - $amount". Lender zip `&cos=1`: "Change Orders/" with every approved CO + log. Report: `/api/reports/co-log/:id` (Change Order Log card).
- Documents tab (2026-10-22): Lender Packages (open by default) + Project Files moved off the Reports tab / page foot.
- Project Files grouped (2026-10-22): `ProjectFilesList` — Pay Apps (one fold per pay app, newest first), Executed Change Orders, Tenant Change Order Backup, Direct Cost Receipts, Contract Documents, Other; each fold remembered (pm-files-open-*). Pay Apps tab: "Pay Apps & Invoices" and "Direct Costs" roll up with a one-line summary (open by default).

- Pending Funding notes (2026-10-22): `fundingNote(n, paid, party, conditional)` — every row cites that vendor's own conditional on the pay app it releases ("Pay App 05 conditional $30,001.05 · not yet funded"); only the GC row adds what we've paid ("· paid $0.00"), since we pay the GC and the GC pays its subs. Used by the log, waiverLog, the package dialog and the zip contents.

- Reports (2026-10-22): no eyebrow above the blue banner on ANY report (report-shell ignores `eyebrow`). Pay App Status: pay apps grouped under each contract (no repeated Contract column); new Paid On column (date · method/reference, amounts when split); "G702 Check" compares our line 8 with the contractor's — full contractor G702 when entered, else the GC line 8 typed in the lien waiver package — Matches / Off $x (G702 $y) / Not Entered. "Direct Costs" (no "no contract").

- Tenant invoice Billing Method (2026-10-22): settings.tenantBillMode 'incurred' (default, as before) | 'full'. Full = each approved tenant change order billed in full when approved (coTotals.tenant: tenant work + markups + CM fee − credit), one item per CO (ref co-<id>), less previously invoiced; printed as "Change Order Invoice" with an Approved Change Orders table. Issued records keep `mode`. "At completion" not built yet. Full mode currently bills change orders only (hides Costs Counted / Tenant Pays For).

- Deleted Files bin (2026-10-22): DELETE /api/cost-documents/:id is a soft delete (cost_documents.deleted_at/by/from, restore_links = waivers it was attached to, unlinked). Every cost_documents read filters `isNull(deletedAt)` except /download (so the bin can open files). Contract delete moves its files to the bin (ids nulled, restored under Other). Routes: GET /api/cost-projects/:id/deleted-files ({deleted, earlier}); POST /api/cost-documents/:id/restore; DELETE /api/cost-documents/:id/forever; POST …/deleted-files/recover|purge {key}; POST …/deleted-files/empty. "earlier" = objects under cost/<pid>/ with no row at all (deleted before the bin existed). UI: DeletedFilesBin in project-files.tsx, under Project Files on the Documents tab.
- Backups (2026-10-22): server/backup.ts. Admin → File Storage → Backups. Download Full Backup = one-use ticket → zip (README, database/rfptracker-database.json = every public table except auth_tokens/password_reset_tokens/sessions/backup_files; app_settings rows `backup.*` left out; files/<key> for every stored object). Google Drive: OAuth (drive.file + openid email), secrets GOOGLE_OAUTH_CLIENT_ID/SECRET, redirect APP_BASE_URL/api/admin/backup/google/callback; refresh token in app_settings backup.drive. Catch-up scheduler (Autoscale sleeps): every 30 min, runs when last success > 22h or files remain; lease row backup.lease; DB snapshot to "RFPTracker Backups/Database" (keep newest 30 + first of month ×24), files mirrored to "Files/<key path>", tracked in backup_files (key, size). Restore: server/scripts/restore-backup.ts (multi-pass for FKs; verified 53/53 tables). Google endpoints overridable (GOOGLE_OAUTH_BASE/GOOGLE_API_BASE/GOOGLE_AUTH_URL) for the local stand-in only.

- Formatting rules (2026-10-22): document numbers are 3 digits everywhere — Pay App 007, Invoice 012, TEN-001, CAP-001, CO-001 (`no3` in shared/doc-number.ts; server/report code uses padStart(3)). Zip sort prefixes (00 GC, 01 sub…) stay 2 digits. Table headers are centered over their column app-wide (index.css `table thead th`, opt out with .th-keep); client/src/lib/table-align.ts shrinks number columns (mostly right-aligned cells) to fit so the centered header sits over the amounts (opt out: table[data-no-fit]). Action buttons in tables get their own fixed-width centered columns so they line up row to row (Pay Apps table: Payments | Package | Files).
- Opening files (2026-10-22): /api/cost-documents/:id/download sends the real type (doc.mimeType, else from the extension via mimeFromName) and the name (Content-Disposition + X-File-Name). Object Storage often stored application/octet-stream, which made Chrome download a nameless file (Edge sniffed the PDF). openDocument opens PDFs/images/text in the new tab and saves anything else under its own name. New uploads are stored with their content type.

- Backup memory fix (2026-10-23): production went down ("Internal Server Error", "A backup is already running on another server") — the first Drive run held whole files in memory and the Autoscale instance was killed. Files now stream to Drive in 8 MB resumable chunks (uploadStream; ~70 MB peak for a 200 MB file), one bad file is skipped and retried next run instead of failing the run, the lease is 5 min renewed per file, and Secret BACKUP_AUTO=off stops the automatic run.
- Backup snapshots skip when unchanged (2026-10-23): writeDatabaseDump returns a sha256 of the table data (not the date); runBackup keeps lastDbHash/lastDbName in backup.status and uploads a new snapshot only when the hash differs (run record db.unchanged). Retention unchanged: newest 30 + first of month ×24.

- Change order routing (2026-10-23): shared/co-routing.ts. Stages Under Review → Returned to Contractor → Pending Internal Approval → Pending Signatures → Approved / Rejected; status follows the stage (approved | pending | void; old status-only PATCH still moves the stage). cost_change_orders: stage, routed_to ("With"), received_date, proposed_amount_cents (amount as submitted, used until lines exist), days_added, routing (JSON history {stage, at, by, to, note}). "Higher routing" flag (tracking only, not enforced): over $250,000 or 30+ days added → Pending Internal Approval; "Skipped internal approval" when it went review → signatures/approved without it. UI: CoStageControls + Routing dialog (client/src/components/cost/co-routing.tsx) on each CO row; new-CO form takes Received, Amount as Submitted, Days Added, defaults to Under Review. Change Order Log: Where They Stand (per stage: count, $, longest in stage), Received/days open, Stage + With + days in stage (amber 14, red 30), Days Added; ?open=1 Open Only, ?history=1 routing history.

- Future-dated pay apps (2026-10-23): a pay app whose period end is after today (entered before month end) didn't show on the Pay Apps tab or in the header totals (both were "as of today"). Now the bundle position and the Pay Apps tab default to the later of today and the latest pay app date; an amber note lists any pay app after the chosen As Of date with a "Show Through" button. CO rows: name on line 1 (+ higher-routing tag), controls on line 2 in fixed order/widths: Stage · Routing · Approved On · Executed · delete.

- Three-way check (2026-10-23): threeWayCheck(app, waivers, contractName) in shared/cost-waivers.ts — ours (G702 line 8 from the G703 lines), the contractor's line 8 (GC conditional payAppDue, else contractorG702), the GC conditional amount. match | partial (two entered agree) | off | none; oursOff < 0 = lines missing (usually CO work billed that period). Shown: ThreeWayBadge next to the pay app no. (Contracts + Pay Apps tabs), Payment Due cell red ⚠ when off, a live "Three-Way Check on Line 8" box in the pay app window, and the Pay App Status report's G702 Check column ("✓ All 3 Match" / "⚠ Off $x" + G702 · Conditional).
- Formulas in dollar boxes (2026-10-23): parseAmount in shared/format.ts (arithmetic only: + - * / ( ) and %, optional leading =; no eval). MoneyInput/PercentInput evaluate on blur (and hand the result to the caller's onBlur); every screen's local num()/amount parsing uses parseAmount so totals are live while typing; inputMode text so = and * can be typed.
- G702 / G703 Comparison report (2026-10-23): server/g702-compare-report.ts, /api/reports/g702-compare/:id?app=<appId>|off|all (off = only pay apps whose three-way check is off; each pay app on its own page). G702 lines 1–9 ours vs the contractor's (contractorG702; line 8 also from the GC conditional's typed payAppDue; theirs 6 and 9 derived from their 3–5) with a Difference column, plus the GC conditional row; G703 as entered (previous / this period / stored / to date / % / balance / retainage) grouped base + each CO on the app, shading a CO approved on this pay app with nothing entered this period. Reports card "G702 / G703 Comparison" with a pay app picker.
- Payoff Statement (2026-10-23): server/payoff-report.ts, /api/reports/payoff/:id?asOf= (default today, or the latest pay app when dated ahead). Total to bring every contractor to zero = open pay apps (line 8 less payments, as of the date) + retainage held; per contractor; open pay apps; retainage held (sum, completed & stored, rate); Releases to Collect at Payoff (outstanding unconditionals first, then an unconditional per conditional on each open pay app, then a final release per contractor for retainage). Card PayoffCard (exported from reports-view) on the Reports tab and the Documents tab under Lender Packages.

## 2026-10-23 — Payoff print fix; G702/G703 line by line
- `openReport` (client/src/components/cost/types.ts) opens the tab synchronously first (static AUTH_TOKEN_KEY import, nothing awaited before window.open) and, when the server fails, writes the error into the tab instead of closing it. PayoffCard calls it directly. Payoff renderer tolerates Date objects.
- `cost_applications.contractor_g703` (json, ADDITIVE_COLUMNS): the contractor's G703 as AI read it ({readAt, fileName, rows: ReadRow[]} with sovLineId set to the validated match). Saved by the pay app window on Save after Read with AI (`contractorG703From`, includes lines added by setup), or by `POST /api/cost-applications/:id/read-their-g703` (reads the PDF attached to the pay app; fills contractorG702 keys not yet typed). The AI read was refactored into `aiReadPayApp()` in cost-tracking-routes.
- G702/G703 Comparison: new "G703 — Line by Line" table (this period / to date / retainage, ours, theirs, difference), rows re-matched with `matchRows` at report time, unmatched rows of theirs listed at the end, and a verdict box naming each line that differs. G702 line 1 for theirs = base contract (Contracts tab); theirs line 2 = their line 3 less line 1. "Period To" capitalized. Reports card gets Read Their G703 (AI).
- Retainage rounds DOWN to the cent (`retainageCents` in shared/cost-tracking.ts, 1e-6 float allowance): the pay app window's blank-box default (total floored, then spread), and the server defaults in writeApplicationLines and setup-from-pay-app. Saved pay apps keep their retainage; when line 5 is off and the boxes are filled, the pay app window offers "Recalculate retainage at X% (rounded down)".
- Payoff Statement: "Pay Apps" lists every pay app through the as-of date, paid ones included ($0.00 still due, PAID tag), with Paid On (last payment date) and Retainage Withheld per app (line 5 less the previous app's line 5; totals to retainage held). Releases to Collect are grouped under a header per pay app (Outstanding Now first, Retainage last); the GC's release is flagged red when its conditional differs from the pay app's payment due (line 8).
- Payoff Pay Apps table reworked (Adolfo): As Billed (Work Billed before retainage = line 4 delta, Retainage Withheld = line 5 delta, Payment Due net line 8) · Payments (Paid net, Paid On) · For the Payoff (Still Due on Pay App, Retainage Held, Payoff = still due + its retainage). (Explanatory note on retainage removed at his request: readers know what a payoff entails.)
- G702/G703 Comparison: no AI wording on the printed report (no "not read" note; line-by-line source shown as the file name). Off verdict adds a diagnosis when lines 3 and 7 agree: the difference is in work this period (line 4).
- Pay app window: changing a line's work/stored/to date clears that line's retainage so it's figured again (unless retainage was typed in this window). Blank-box retainage total uses their G702 line 5 when typed and within $1.00 of the rate figure (contractors round line by line); otherwise the rate, rounded down.
- Retainage rounding adjustment (Adolfo: our rounding is right; accept theirs when tiny, track it, don't re-chase every month): `cost_applications.retainage_adj_cents` + `retainage_adj_note`. `Application.retainageAdj` (dollars) is added to retainage held in g702For for that app and every later one, so line 5/6/8 match theirs and later line 7s agree; position/payoff retainage includes it. Pay app window: "Accept their retainage: +$X rounding adjustment" when their line 5 differs by ≤ $10 (RET_ADJ_MAX); shown in violet with Remove. G702/G703 Comparison notes it on line 5. Reverted the earlier snap-to-their-line-5 (rate figure, rounded down, stays ours).
- Package window: "Add Vendors Who've Billed (N)" popover replaces the "Also on Pay App X" line: every sub with a conditional (amount > 0) on any pay app of the contract, not yet on this one (`billedVendors` in shared/cost-waivers.ts; previous pay app's first, then most recent; shows last pay app and amount). Multi-select, "Select Everyone on Pay App X", Add posts a conditional (amount 0, not received) for each, so they also appear under Pay Applications. The GC's conditional is added automatically when the package opens and it's missing (amount = line 8, not received).
- threeWayCheck counts the GC conditional only once it's marked received (the auto-added one at line 8 isn't evidence).
- Carry-forward check (`carryForwardCheck` in shared/cost-tracking.ts): their line 4 less their previous pay app's line 4 vs this period's work on the lines; their line 7 vs their previous line 6. Shown in the pay app window (amber when off) and in the G702/G703 Comparison under the verdict. Adolfo's idea from Pay App 008 ($938,550.31 − $764,216.04 = $174,334.27 vs $180,170.58).
- Billing Roll-Forward report (server/rollforward-report.ts, /api/reports/rollforward/:id, Reports tab card): by pay app (previous, this period, total to date from the lines; their line 4; their previous = line 4 less this period; carries forward vs their prior line 4) and by line (total to date at the end of every pay app = next pay app's Previous column). Landscape.
- Payoff "Worst Case" (?worst=1, checkbox on the Payoff card): each open pay app at the higher of ours and the contractor's line 8 (their G702, or the GC's received conditional/typed line 8); title becomes "Payoff Statement: Worst Case", box notes how much over ours; the Payment Due cell shows ours beneath.
- Owed by Vendor (Reports tab card with on-screen table + Find a Vendor, and /api/reports/owed-by-vendor/:id print): `owedByVendor` in shared/cost-waivers.ts — for each pay app not yet paid in full (position open > 0), each vendor's conditional amount (summed, received flag), vendor totals; GC first, then subs largest first with a subs total per pay app.
- Owed by Vendor now shows every pay app (paid ones grayed with a Paid tag) with Total Released and Still Owed columns; Outstanding Only checkbox (?outstanding=1 on the print) limits it to unpaid pay apps. A partly paid pay app counts as unpaid (full conditional owed).
- Roll-Forward by line: cells for change order lines not yet on the SOV at that pay app (CO approved later, or pending) are shaded and blank; on the SOV with nothing billed shows $0.00 in gray. CO headers say 'on the SOV from Pay App X' or 'not approved yet'; the scheduled value total leaves out pending COs.
- Project Financial Summary (server/exec-summary-report.ts, /api/reports/financial-summary/:id, first card on the Reports tab): six tiles (budget, committed, projected with pending, projected over/under, work complete, paid/billed unpaid/retainage), a computed Watch List (lines over budget, pending COs vs remaining budget, COs 30+ days in a stage, approved COs without an executed copy, unpaid pay apps whose three-way check is off by $1+ (cents grouped as rounding), carry-forward breaks, unpaid 30+ days past period end, outstanding lien releases), Budget by category, Change Orders by stage, Contracts and Payments.
- Contingency + monthly snapshots (Adolfo, 2026-10-23):
  - `shared/financial-figures.ts`: `financialFigures(bundle, today)` (totals, contingency, COs, pay apps, rows) and `figuresDiff(prev, now)`.
  - Contingency = budget lines in `settings.contingencyKeys` (PUT /api/cost-projects/:id/settings) or any line named "contingenc*". Used = moved out (original less current budget) + spent (work to date on it); remaining; % used vs % complete; contingency carried inside contracts (SOV lines named contingency) noted.
  - `server/snapshots.ts`: table cost_snapshots (ADDITIVE_TABLES; unique project_id+kind+period). Scheduler (90 s after boot, then every 3 h, catch-up): a baseline for any active project without one; a "month" snapshot (period = month just ended) once a new month starts. GET/POST /api/cost-projects/:id/snapshots.
  - Financial Summary: 8 tiles (adds Billed Unpaid and Contingency Remaining), contingency Watch List items (overdrawn, used 10+ points ahead of complete), Contingency section, "Since <snapshot>" block (budget/committed/projected/complete/paid/contingency deltas + approved/new/rejected/moved COs, amount changes, new and paid pay apps, biggest line moves). ?since=<id> (0 = none; default latest before today). Card: Compare With picker, Save Snapshot Now, Contingency Line picker.
- Pay App Aging (server/aging-report.ts, /api/reports/aging/:id?asOf=, Reports card with bucket totals): open pay apps aged from the period-to date into Current (0–30), 31–60, 61–90, Over 90; summary by contractor with oldest, detail by pay app (entered date, last payment), retainage held shown apart (not aged).
