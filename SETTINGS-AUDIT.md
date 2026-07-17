# Hardcoded Values Audit — App Settings Candidates

**Purpose:** Map what's hardcoded in the codebase, sorted by whether it should become
an admin-editable setting. Principle (Adolfo's): constants that never change (cents,
unit conversions) stay hardcoded; anything that might reasonably be adjusted later
(rates, thresholds, branding, defaults) should be admin-editable.

**Status:** Audit complete. No settings infrastructure exists yet — building it is the
next step. Admin-only access.

---

## 🟢 LEAVE HARDCODED (true constants — will never change)
- **Dollar ↔ cents conversion** (`× 100` / `÷ 100`, ~62 occurrences). Cents are always
  1/100 of a dollar. Not config.
- **File paths** (`process.cwd()/uploads/...`). Infrastructure, not business config.
  (Could be env vars, but not user-facing settings.)
- **Unit conversions** (SF/acre = 43,560, etc. — none found hardcoded as magic numbers
  currently, but if added, they're constants, not settings.)

## 🟡 ALREADY EDITABLE (no action needed — confirm this is enough)
- **Soft-cost rates** (Builder's Risk 1.25%, CM 2.75%, Permit 3.5%, Contingency 5%).
  These live on **catalog items** (rom_scope_items.unitPrice) and are already editable
  via the ROM catalog. The rate is the unit price; the basis is now the Calculation
  Basis field. ✓ Not hardcoded in logic.
- **Denominator basis per item** — editable via the $/SF Basis dropdown (per improvement).

## 🔴 SHOULD BECOME SETTINGS (hardcoded now, might change) — build these
Priority order:

1. **Report branding** — highest count, clearest win.
   - Company name "Kurv" / "Kurv Industrial" hardcoded in **17 files**.
   - Brand color (`rgb(0,50,130)`, `#1e3a5f`, etc.) in **11 files**.
   - Logo loader (`getBridgeLogo`) **duplicated in 9 files** (each reads
     `bridge_logo_new_base64.txt`).
   - → Settings: `company_name`, `brand_color_primary`, `logo` (path or upload).
     Bonus: consolidate the 9 duplicate `getBridgeLogo` into one shared helper that
     reads the setting.

2. **Occupancy color thresholds** — `occupancy-report.ts:97-98`: green ≥90%, amber ≥70%.
   - → Settings: `occupancy_green_threshold` (90), `occupancy_amber_threshold` (70).

3. **Denominator basis defaults by category** — `DEFAULT_DENOMINATOR_BASIS_BY_CATEGORY`
   in shared/schema.ts (which category defaults to warehouse-net vs whole-property).
   - → Setting: a JSON map, or per-category dropdowns in admin. Lower priority (the
     per-item override already covers most needs).

---

## Proposed infrastructure (build next session)
- **Schema:** `app_settings` table — `key` (text, unique), `value` (text/json),
  `updatedAt`, `updatedBy`. Simple key/value.
- **Backend:** `GET /api/settings` (all) + `PATCH /api/settings/:key` (admin-only,
  gated on `admin.access`). A `getSetting(key, fallback)` helper so code reads a
  setting with a hardcoded fallback (safe if the row is missing).
- **Frontend:** Admin → **App Settings** page. Grouped sections (Branding, Report
  Thresholds). Each setting: label, current value, input, save.
- **Migration:** additive `app_settings` table; auto-applied via startup-migrations.
- **Pattern going forward:** any new adjustable value reads from `getSetting(key,
  default)` instead of a literal. The default is the fallback, so nothing breaks if the
  setting is unset.

## Notes
- Keep it a **foundation, not a big-bang migration.** Build the table + page + helper,
  seed with branding (the clear win), then move other values in over time.
- Every setting keeps a **hardcoded fallback** in code, so a missing/empty setting never
  breaks rendering — same safety principle as the startup schema guard.
