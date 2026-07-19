# Design: ROM Pilot ↔ Evaluation Convergence

**Status:** Design agreed with Adolfo 2026-07-17. Not yet built. Goal: make the ROM Pilot
and the Evaluation feel like one coherent system — same flow, same-looking output — while
keeping the ROM Pilot a fast, guardrailed quick-estimate tool.

## What the ROM Pilot is / should be
A quick order-of-magnitude estimate builder. Someone with access: selects bays in a
building, adds a tenant name, adds line items from the catalog, enters quantities, and
gets a report (mirroring the Evaluation output) that includes costs-in-place at the bottom.
It can OPTIONALLY pull data from an RFP opened in Step 1 of the workflow, OR stand alone.

## Current state (recon 2026-07-17) — already ~70% there
The ROM Pilot already has most of the structure:
- `rom_pilots`: `selectedBayConfigurations` (bays), `projectName` (tenant/project),
  `totalEstimate`, status.
- `rom_pilot_line_items`: `scopeItemId`, `quantity`, `unitPrice`, `totalPrice`,
  `tenantShare`, `category`.
- `rom-routes.ts` already fetches property existing improvements (costs-in-place)
  proportionally (~line 67).
So this is ALIGN + TIGHTEN, not a rebuild.

## Core principle (Adolfo 2026-07-17): the ROM Pilot draws from the SAME sources as the Evaluation
Not parallel copies — the SAME templates, report components, and allocation logic. The more
they share, the more they stay in sync automatically (add a template for the Evaluation → it
just appears for the ROM Pilot too). They differ ONLY in: (a) who can edit rates (ROM = rates
locked), and (b) where data originates (ROM can stand alone or pull from an RFP).

### Shared templates (confirmed buildable)
The ROM Pilot must offer the SAME templates the Evaluation offers (e.g. "Standard TI"), so a
user picks the template → standard line items populate → they just adjust quantities.
- Templates already load in the eval via `GET /api/templates/:id/for-import`
  (evaluation-budget.tsx ~line 727). The `templates` table is the source.
- Build: give the ROM Pilot a template picker calling the SAME endpoint + the same import
  logic (map template line items → ROM line items). No new template system.

### Full allocation output on the ROM report (confirmed present on eval)
The ROM report must show EVERYTHING the Evaluation report shows — allocated parking, allocated
electrical, costs-in-place — not a stripped-down version. Same report, ROM data.
- Allocation fields live on the eval: `vehicularParking`, `trailerParking`,
  `electricalAllocation`, `calculatedElectricalAllocation`, `electricalAllocationOverride`,
  `electricalAllocations[]` (evaluation-budget.tsx ~line 89-96).
- Build: the ROM Pilot needs to carry/compute these the same way (reuse the eval's allocation
  logic), and the ROM report reuses the eval report's allocation + costs-in-place sections.
  Ideal: extract the shared report sections so both render identically.

## The three pieces (sequenced by size/risk)

### 1. Rate-lock — quantities editable, unit rates NOT (DO FIRST — small, safe, high value)
The key guardrail Adolfo wants: ROM Pilot users can change quantities but NOT unit rates.
Rates come from the catalog and stay locked, so a quick ROM can't alter pricing (no
fat-fingered rates, ROMs stay consistent with real pricing).
- Currently `unitPrice` appears editable in `rom-pilot-scope-modal-new.tsx`.
- Change: render unit price as DISPLAY-ONLY (sourced from the catalog item), keep quantity
  editable. Total = quantity × locked rate.
- Consider a permission (`admin.access`?) that could still allow a rate override for
  admins, if Adolfo wants an escape hatch — confirm at build. Default: locked for all.
- Independently valuable; ship this first regardless of the other two.

### 2. Report mirrors the Evaluation output + costs-in-place at bottom (M)
Make the ROM Pilot's report render like the Evaluation's, with costs-in-place at the
bottom (data already fetched). Reuse the Evaluation/Costs-in-Place report templates where
possible rather than a separate ROM report style. Investigate: does a ROM Pilot report
endpoint exist today, or does it need building? (recon showed no dedicated rom-pilot
report file — likely needs creating, reusing costs-in-place-report.ts patterns.)

### 3. Optionally pull from a Step-1 RFP (M)
If an RFP exists in the workflow, the ROM Pilot can pick up its data (bays, tenant name,
and — once the AI parser exists — proposed scope). If not, the user builds from scratch
(current behavior). Data-plumbing: a "start ROM from RFP" path that pre-fills the ROM
Pilot from the RFP's property/bays/tenant.

## Ties to other work
- Rate-lock pairs naturally with **context-aware pricing** (the locked rate should be the
  RIGHT rate — clear-height/SF-tier resolved). Build rate-lock first with the current
  rate source; upgrade to context-aware when that lands.
- Pulling scope from an RFP overlaps with the **AI intake parser** (RFP → proposed scope).
  The ROM-from-RFP path can start with just bays/tenant, add parsed scope later.
- Report mirroring overlaps with the existing **Costs-in-Place / Occupancy** report work
  (reuse `getBrandLogo`/branding, the report HTML patterns).

## Build order recommendation
1. **Rate-lock** (small, safe, independently valuable) — first.
2. **Report mirroring** (reuse existing report templates).
3. **RFP pull** (after AI parser exists, so scope can come too).

## Open questions for build
- Should admins get a rate-override escape hatch, or is the rate lock absolute?
- Does the ROM Pilot report need to be identical to the Evaluation report, or "same family
  / same costs-in-place footer" is enough?
- When pulling from an RFP: copy the data into the ROM (snapshot) or live-link it?

## ADDENDUM 2026-07-19 — The Allowance Fork (agreed with Adolfo)
Step 1 gains a path chooser at the bottom (button, NOT a request-type checkbox — allowance
is always coupled with the ROM, and the dev team never issues allowances):
- **"Route to Development Team"** — the traditional path (validation → ITB → bids → eval).
- **"Allowance — ROM Pilot"** — sets `pricingPath='rom_allowance'` on the RFP (additive
  startup-migration column), SNAPSHOTS Step-1 data (property/bays/tenant/project) into a
  linked rom_pilot, skips steps 2–3 entirely, and lands the requester in the ROM Pilot.
  The requester adds scope + quantities; unit rates are LOCKED (piece 1). Ownership is
  unambiguous: sentBy is already the requester.

Decisions locked today:
- **Rate lock is absolute for the leasing team** (that IS the review gate — structural,
  not procedural). Admin escape hatch deferred; admins can edit the catalog itself.
- **CM fee auto-capture — INSIDE the allowance, not on top (Adolfo 2026-07-19):** the
  quoted allowance INCLUDES the 2.75% CM fee. A $15/sf allowance means the tenant's real
  TI purchasing power is $15 × (1 − 0.0275) ≈ $14.59/sf. The auto-populated CM line is a
  DEDUCTION within the allowance: report shows gross allowance, less CM fee (2.75%), net
  available for TI. Deletable — but deletion is RECORDED (who/when) and surfaced in fee
  reporting, so removed fees trigger the "let's make sure the lease language mirrors that"
  conversation instead of silent leakage. Portfolio CM-fee reports include allowances.
- **Catalog-only for the leasing team (Adolfo 2026-07-19, ENFORCED server-side in
  rom-routes.ts):** non-admin ROM users cannot add custom (non-catalog) line items — no
  catalog item means no price, which defeats the purpose. Missing scope → ask the dev team
  to add it to the database. admin.access retains custom-item ability. Additionally, for
  ALL users, any line item with a scopeItemId has its unitPrice FORCED from the catalog
  (activePrice ?? unitPrice) and totalPrice recomputed server-side — the read-only UI is
  backed by an API that doesn't trust the request body. Slice 1 (rate-lock) is now DONE:
  UI was already read-only; server enforcement added 2026-07-19.
- **Report:** same family as the Evaluation, with a prominent "ROM ALLOWANCE" heading so
  it can never be confused with a bid-based evaluation. Costs-in-place at the bottom is
  MANDATORY — it's the core of the allowance model.
- **Deal-grows conversion:** rare; when it happens it flows through the existing
  counter-response infrastructure — a counter RFP sub to the original, on the development
  path. Parked as future work, by design.
- Snapshot (not live-link) when forking from Step 1.

## Revised build order
1. Rate-lock (unchanged — first, small, independently valuable)
2. Step-1 fork: pricingPath column + two-button footer + snapshot into rom_pilot + phase jump
3. CM fee auto-line + deletion recording
4. ROM Allowance report (eval family + badge + costs-in-place) feeding portfolio fee reports

## NAMING (Adolfo 2026-07-19, pre-deploy): the fork is "ROM Pilot", not "Allowance"
Buttons: "Route to Dev Team" / "ROM Pilot". The ROM path covers BOTH self-assembled
ROMs and allowance deals — allowance is one use of the tool, not the tool's name.
pricingPath value is 'rom_pilot' (renamed from 'rom_allowance' before anything
deployed). The CM-fee-inside-the-allowance behavior (slice 3) still applies when
the ROM is used for an allowance.

## NAVIGATION CORRECTION (Adolfo 2026-07-19, after first live test)
The fork must NOT navigate away to the standalone /rom-pilot page — that orphans the
user from the pipeline (and the landing page's auto-modal tried to double-create,
throwing "Failed to create ROM" even though the fork had already succeeded). Correct
behavior: stay on the dashboard; the forked RFP appears in the pipeline at the
Evaluation phase like any other RFP. Same landing page, same navigation — ONLY the
workflow content differs. NEXT (slices 3-4, now including this): opening the workflow
on a pricingPath='rom_pilot' RFP surfaces the ROM pricing experience (locked rates,
CM-fee-inside-allowance, badged report) INSIDE the normal workflow UI, in place of
the bid-based evaluation — not on a separate page.

## DUAL-ENTRY PRINCIPLE (Adolfo 2026-07-19 — the governing architecture)
Two doors, one machine:
1. **Standalone ROM Pilot** (/rom-pilot) stays fully independent — for someone who
   wants a quick ROM with NO RFP at all. Untouched. It was the template that guided
   the fork, not something the fork absorbs.
2. **Pipeline-embedded ROM** — a pricingPath='rom_pilot' RFP uses the SAME workflow
   shell as every RFP; at the Evaluation step a DIFFERENT FORM renders (the ROM
   pricing form: locked rates, CM fee inside the allowance, badged report with
   costs-in-place) in place of the bid-based evaluation. Never a jump to the
   standalone page.
Both doors drive the same ROM data, components, templates, and catalog — build
slices 3-4 as shared components consumed by both, per the convergence principle.

## FOUR-BUCKET BUDGET REPORT (Adolfo 2026-07-19 — part of the fee/report engine block)
End-of-project / moving-forward report grouping the full budget by CONTRACT COUNTERPARTY:
1. **Contractor** — construction costs (the GC's contract)
2. **Design** — the designer's contract
3. **CM Fees** — construction management (ties into the portfolio CM-fee reporting incl.
   allowances and recorded deletions)
4. **Balance / Misc** — contingency, permits (pending confirmation), everything else
Example target: $2.0M total → $1.5M contractor / $300k design / CM / balance, each bucket
expandable to line items. Works identically for bid-based evaluations AND ROM allowances.
Mechanism: `budgetBucket` on rom_scope_items (admin-set, single source of truth like the
soft-cost category), with inference defaults (TI category → contractor; design/architect/
engineering names → design; CM items → cm; remaining soft costs → misc). This bucket field
is the SHARED grouping engine for this report, the CM-fee rollup, and the
inside-the-allowance presentation — build once.
CONFIRMED (Adolfo 2026-07-19): (a) permits, contingency, testing, and similar all
default to the Balance/Misc bucket; (b) the report lives in the REPORTS section.
No open questions remain on this feature — build-ready.
