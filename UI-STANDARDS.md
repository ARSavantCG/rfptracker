# RFP Tracker — UI & Data Conventions

Read this before building or modifying ANY user-facing feature. Agent prompts may
cite this file ("per UI-STANDARDS.md"); violations are bugs even if the feature
"works." Extend it whenever a new convention is settled — one paragraph per rule,
with the reason, so future sessions don't relitigate it.

## Numbers
- **Quantities display thousands separators everywhere**: 12,000 not 12000. In form
  inputs use `formatQuantityDisplay` (invitation-to-bid-modal.tsx) — formatted
  display, raw digits stored. In generated documents use `formatQty`
  (pdf-generator.ts). Any NEW surface that shows a quantity uses one of these or
  an equivalent; a bare `${item.quantity}` is a bug.
- **Currency** uses the existing `formatCurrency` helpers ($ + separators + 2dp).
- **Parsing formatted numbers: `parseFloat` + strip regex, NEVER `parseInt`.**
  `parseInt("1,000") === 1`. Pattern: `parseFloat(String(v).replace(/[^0-9.\-]/g, ''))`.
- **Costs in `property_existing_improvements` (and related) are stored in cents** —
  divide by 100 before any dollar display or comparison.

## Units
- Canonical unit strings (single source: the `units` array in
  rom-scope-items-modal.tsx): `sf.`, `lf.`, `ls.`, `ea.`, `$`, `%` — lowercase
  with trailing period ($ and % excepted).
- Anything writing units into scope rows normalizes via `normalizeUnit`
  (intake-parser-routes.ts). Fallback unit is `ea.`, never `EA`/`EA.`/`Ea`.

## Dynamic form tables (scope of work and anything like it)
- **Rows are keyed by a stable `_key` stored IN the row data** (`stableRowKey()` /
  `withRowKeys()` in invitation-to-bid-modal.tsx), NEVER by useFieldArray's
  generated `field.id`. Framework ids regenerate on replace/reset and remount
  every input — killing focus and snapping scroll (the 2026-07-18 scroll-jump bug).
- **Never `form.reset` or `replace()` a field array after a save** — the form
  already holds the saved values; "restoring" them remounts rows mid-typing.
- **Seed/populate effects run ONCE per modal open** (ref-gated), never on every
  background refetch. See the `seededForOpenRef` pattern.
- The evaluation screen's plain controlled inputs (local state, stable db-id keys)
  are the reference for "immune by construction" — prefer that shape for new tables.

## Row-level JSON fields (scopeOfWork and similar)
- **Any field carried on JSON rows MUST be declared in EVERY zod schema that
  touches those rows** (shared/schema.ts insert schemas AND component form
  schemas). zod strips undeclared keys silently — this destroyed the proposalId
  retraction stamp once already. Client-only fields (like `_key`) are exempt on
  purpose: schema stripping is how they stay unpersisted.
- Current scope-row fields: description, quantity, unit, masterItemId,
  masterItemSnapshot, proposalId (retraction stamp), category (soft-cost
  exclusion), _key (client-only).

## Data access & API
- **react-query keys are a single URL string**: [`/api/x/${id}`], never
  ["/api/x", id] — getQueryFn fetches queryKey[0] only, so the array form
  silently hits the wrong URL. (Exception: queries with a custom queryFn.)
- **apiRequest(url, method, data, timeoutMs?)** — url first, method second.
- `invitation_to_bid` is canonical for contractor/architect due dates, not
  rfp_requests.

## Components & icons
- Icons: lucide-react only. Inline/button icons `h-4 w-4`; section-header icons
  `h-5 w-5`.
- Non-input controls inside form-table rows (reorder arrows, drag handles) get
  `tabIndex={-1}` so keyboard flow skips them.
- Status colors in review UIs: green = accepted/linked, red = rejected/destructive,
  amber = custom/needs-attention, gray badges for metadata. Destructive confirm
  dialogs follow the AlertDialog pattern in admin.tsx (red action button,
  explicit consequence text).
- Collapsed-by-default secondary sections use `<details>`/summary bars with a
  count and "tap to review" affordance (see intake-proposals-panel.tsx).

## Documents (pdf-generator.ts)
- Scope tables render in SIX variants (GC/architect/broker/enhanced). Any change
  to scope rendering must hit all of them — grep before declaring done.
- Soft-cost rows (`Design / Soft Costs / Other Fees`) are excluded from ITB
  documents via `bidableScope()` (category field + masterItemId catalog lookup).
  The ROM catalog category is the single source of truth for biddability.

## Process
- Instrument before hypothesizing; verify by click-and-watch or on-screen/logged
  evidence, never narration. See HANDOFF.md for session history and open items.
