# Cancel / Void RFP — Handoff Notes

## What was built

A lightweight "Cancel RFP" feature across the full stack. Cancelled RFPs are removed from the forward-looking pipeline but kept fully accessible for history and reinstatement.

---

## Part A findings (recon)

- `rfp_requests.status` is a plain `text NOT NULL DEFAULT 'received'` column (not a DB enum). Validated by Zod in schema.ts. Values previously allowed: `received | in-progress | completed | on-hold | archived`.
- `rfp_requests.workflow_phase` tracks the 6-step position independently.
- Neon (production) had only `completed` (65) and `in-progress` (3) at scan time.
- Four nullable text columns exist for notes; none were appropriate for a cancellation reason (wrong semantic). Added 3 new columns instead.

---

## Schema changes (applied to BOTH helium and Neon before this commit)

```sql
ALTER TABLE rfp_requests
  ADD COLUMN IF NOT EXISTS cancellation_reason  text,
  ADD COLUMN IF NOT EXISTS cancelled_at         timestamp,
  ADD COLUMN IF NOT EXISTS prior_workflow_phase  text;
```

`shared/schema.ts` updated: new columns added to table def; `"cancelled"` added to Zod enum in both `insertRfpRequestSchema` and `updateRfpRequestSchema`.

---

## Backend changes (`server/routes.ts`)

| Endpoint | Change |
|---|---|
| `GET /api/rfp-requests/stats` | `activeRequests` now excludes `cancelled` AND `archived`; `cancelled` count added to stats response |
| `PATCH /api/rfp-requests/:id/cancel` | **New** — requires `{ reason }` body; stamps `cancelled_at`, `cancellation_reason`, `prior_workflow_phase`; rejects archived RFPs; rejects if already cancelled |
| `PATCH /api/rfp-requests/:id/reinstate` | **New** — restores `status → in-progress`, `workflow_phase → prior_workflow_phase`; rejects if not cancelled; audit fields (`cancelled_at`, `cancellation_reason`) left intact for history |

Default `GET /api/rfp-requests` list: **cancelled RFPs remain visible** (they appear in "All" and in the dedicated Cancelled filter pill). Only excluded from the pipeline *counts*.

---

## Frontend changes

| File | Change |
|---|---|
| `workflow-status.tsx` | Cancel button (ghost/rose) at bottom of active RFP panel; Dialog with required reason textarea; `isActive`/`isCompleted`/`isNext` updated for `cancelled`; Cancelled banner with date + reason + Reinstate button |
| `rfp-table.tsx` | Rose badge for `cancelled`; `title` attribute shows the reason on hover |
| `stats-cards.tsx` | `cancelled` added to Stats interface + a Cancelled stats card (rose) |
| `dashboard.tsx` | "Cancelled" filter pill (rose) added to status bar |
| `category-cost-breakdown-report.tsx` | `cancelled` added to `STATUS_LIST` and `statusColor`; default selection unchanged (`completed + in-progress`) |
| `lib/utils.ts` | `getStatusColor` and `getStatusIcon` extended for `cancelled` |

---

## Reports touched / left alone

| Report | Action | Reason |
|---|---|---|
| Dashboard pipeline stats card | **Changed** — excludes cancelled | Forward-looking |
| Dashboard status filter pills | **Changed** — Cancelled pill added | Navigation |
| `rfp-table.tsx` badge | **Changed** — rose badge | Label only |
| `stats-cards.tsx` | **Changed** — counts cancelled | Informational |
| `reports.tsx` | **Left alone** — user can manually filter by status | User-controlled; `cancelled` would show if selected |
| `category-cost-breakdown-report.tsx` | **Added to list, not default** | Opt-in only |
| `category-cost-breakdown-report.tsx` server endpoint | **Not changed** — queries by `statuses` param | Backend already filters by what user selects |
| Email scheduler status report | **Left alone — flagged** | Cancelled RFPs show in owner emails (ambiguous whether desired; leave for follow-up) |
| Historical/actuals (`project_actuals`) | **Not changed** | Actuals are stored independently of RFP status |

---

## Part C verification results (helium dev DB)

### Cancel test — RFP-2026-017 (id=193)
```
Before:  status=in-progress  workflow_phase=evaluation  reason=NULL  cancelled_at=NULL  prior=NULL
After:   status=cancelled     workflow_phase=evaluation  reason="per broker email 7/7…"  cancelled_at=2026-07-08 20:44:54  prior=evaluation
```

### Reinstate test — same RFP
```
After:   status=in-progress  workflow_phase=evaluation  (prior_workflow_phase still stored for audit)
```

### Pipeline count after 1 cancel:
```
pipeline_active=70  cancelled=1  completed=58  in-progress=12
```
→ Cancelled RFP correctly excluded from pipeline_active.

### Non-cancelled unaffected: confirmed (all other rows unchanged).

---

## Migration note

`ALTER TABLE` was run on **Neon first** (before any republish), then on helium. Both DBs confirmed:
```
cancellation_reason   text   nullable ✓
cancelled_at          timestamp  nullable ✓  
prior_workflow_phase  text   nullable ✓
```

---

## Remaining / follow-up

- **Email scheduler**: Owner status report currently includes cancelled RFPs in "incomplete" list. Decide whether Owner emails should show or hide cancelled — ambiguous per spec, left alone.
- **Git push + Republish**: Must be done manually via Git pane → Push, then Replit Dashboard → Republish.
