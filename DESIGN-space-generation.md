# Design: First-Gen / Second-Gen Space Tracking

**Status:** Design agreed with Adolfo. Not yet built. Build next session.

## The domain concept
- **First generation** = space that has never been occupied (new building, first tenant;
  full TI buildout priced from shell; ties to construction-loan-to-perm milestone —
  typically 80-90% leased before switching to permanent financing).
- **Second generation** = a tenant was there and their lease ended (eviction, buyout,
  expiration). Re-tenanting, handled by property management. Already on permanent
  financing. Shell costs often N/A (harder to source), but capture when available —
  exec team may want them.

Examples: Bridge 595 is second-gen (had a 110k SF first-gen tenant; now possibly
splitting into 2 × 55k second-gen spaces via a demising wall). Most other properties are
first-gen currently.

## Model decisions (agreed)
1. **Manual, not auto-derived.** A 5-yr lease can end early (eviction, buyout), so
   deriving generation from lease expiration is fragile. Adolfo sets it.
2. **Two levels: property default + per-RFP/lease override** (override → falls back to
   property default; same pattern as denominator basis).
   - Property `spaceGeneration` default: e.g. 595 = 'second-gen'.
   - RFP/lease `spaceGeneration` override: for spaces that differ from the building
     default (first-gen building with a later re-tenanted space, or vice versa).
3. **NAMING:** use `spaceGeneration` (or `tenantGeneration`) — NOT plain `generation`.
   The schema already has `rfpGenerationHistory`/`generationType` for *document*
   generation (contractor/architect RFP docs). Different concept — avoid collision.
4. **The 110k → 2×55k split rides on existing features** — bay config + demising wall
   (built 2026-07-16). No special "split" machinery. Each resulting space is its own RFP
   carrying its own generation flag; or stays one RFP if not split. Not decided yet
   whether 595 splits — model must support both.
5. **Cost data: same structure, shell/TI all optional.** Second-gen leaves shell N/A when
   unknown; captures it when available.

## Reports
- **Occupancy report segments by generation:** First-Gen section (with lease-up progress
  toward the 80-90% perm-financing threshold), Second-Gen section (already perm), plus a
  combined portfolio total. Separate vacancy rates — they reflect different capital
  structures, so exec leadership wants them independent.
- Vacant second-gen space still enters the RFP pipeline identically (vacant is vacant for
  pipeline purposes). No pipeline change.

## Build plan (next session)
1. **Schema:** add `spaceGeneration text` (`'first-gen' | 'second-gen'`) to `properties`
   (the default) and to `rfp_requests` (nullable override). Additive; auto-apply via
   startup-migrations. Constant `SPACE_GENERATIONS` in shared/schema.ts + a
   `resolveSpaceGeneration(rfp, property)` helper (override ?? property default ??
   'first-gen').
2. **UI:** generation dropdown on the property form (default) and on the RFP/eval (override,
   showing "inherits from property: X" when unset). Admin-editable.
3. **Occupancy report:** group rows by resolved generation; two sub-tables + combined
   total; first-gen sub-table notes lease-up % vs the perm-financing threshold (make the
   threshold a setting later — see SETTINGS-AUDIT.md).
4. **Cost capture:** confirm shell/TI fields are already optional (they are) — no schema
   change, just ensure second-gen entry doesn't force shell.

## Open questions for next session
- Exact perm-financing threshold (80% vs 90%?) — and should it be per-property or global?
  Candidate for App Settings.
- Does the Costs-in-Place report also need generation segmentation, or just occupancy?
