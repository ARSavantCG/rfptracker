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
