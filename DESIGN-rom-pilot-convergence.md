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
