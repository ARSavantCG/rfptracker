# AI Intake Parser — STATUS + the one remaining bug

## WORKING (deployed, verified on rfptracker.app)
- Parser reads Step-1 files from `rfp.files` JSON array (NOT project_files table)
- Reads .docx (mammoth), Outlook .msg (@kenjiuno/msgreader), PDF, images, text
- File bytes resolved via `getFileBuffer()` in server/storage-backup.ts — 3-stage:
  local disk (3 candidates) -> direct Object Storage key -> **suffix-scan of
  `.private/uploads/` matching `-<originalName>`** (files are stored with a nanoid
  prefix by DiskWithBackupStorage, but rfp.files records a `<timestamp>_` path —
  incompatible naming from two different upload routes)
- Calls claude-sonnet-4-5, max_tokens 4096, mammoth text capped at 30k chars
- Produces good proposals (22-25) with reason, confidence, catalog-match badges
- Step 2 review UI: "TO REVIEW (n)" + "✓ ACCEPTED — ADDED TO SCOPE OF WORK (n)"
  sections, per-item accept/reject, bulk accept/reject, undo, rejected hidden
- Accept auto-fires POST /api/intake-proposals/:rfpId/commit-to-scope

## THE BUG (unresolved)
Accepting writes nothing to `rfp.scopeOfWork`. On-screen diagnostic in the panel shows:

  `RFP Scope of Work currently has 0 items — last write: added 7, intended 7, PERSISTED 0 (type object)`

Meaning: `commit-to-scope` builds 7 rows, calls
`storage.updateRfpRequest(rfpId, { scopeOfWork: updatedScope })`, then immediately
re-reads via `storage.getRfpRequest(rfpId)` and gets an **empty array** back.
So the update executes without throwing but does not persist the value.

Because existing scope always reads empty, every accept re-adds everything
("added 7" each time) — consistent with nothing ever persisting.

### Already ruled out
- NOT duplicate class methods (only one `updateRfpRequest`, one `getRfpRequest`)
- NOT a stale read in the UI (server-side read-back also returns 0)
- NOT the route/permissions (no error; endpoint returns 200)
- NOT a JSON-string type issue (persistedType came back `object`, Array.isArray true)
- `updateRfpRequest` does `.set({ ...updateData, updatedAt })` with updateData spread
  from `updates`, so scopeOfWork should pass through

### Next diagnostics to run (needs server logs / DB access — use the Replit Agent)
1. In `updateRfpRequest`, log `updates.scopeOfWork?.length` on entry and
   `updated.scopeOfWork?.length` from the `.returning()` result. Determines whether
   Drizzle is sending the value at all.
2. Run raw SQL against the **production Neon DB** (NOT helium — Replit Agent SQL
   targets helium/dev by default):
   `SELECT id, jsonb_array_length(scope_of_work::jsonb) FROM rfp_requests WHERE id = 24;`
   right after an accept.
3. Check for anything else writing `scope_of_work` immediately after (another
   auto-save from the validation modal form could be overwriting with []).
   Grep for `scopeOfWork` in client components that PATCH/PUT the RFP.
4. Try a direct write bypassing updateRfpRequest:
   `db.update(rfpRequests).set({ scopeOfWork: rows }).where(eq(rfpRequests.id, id))`
   inside the commit endpoint. If that persists, the bug is inside updateRfpRequest.

## Downstream (blocked by the above, already coded)
- Step 3 Invitation-to-Bid modal now seeds `scopeOfWork` from a **fresh** RFP fetch
  (`freshRfp` useQuery on `/api/rfp-requests/${rfp?.id}`), falling back to the prop.
  Previously it hardcoded `scopeOfWork: []` and only read the ITB record — that was
  a real bug and is fixed. It will populate once the write above persists.

## PROJECT CONVENTIONS (important, learned the hard way)
- **Query keys must be a single URL string.** `getQueryFn` fetches `queryKey[0]` ONLY.
  `["/api/x", id]` silently fetches `/api/x`. Use `` [`/api/x/${id}`] ``.
- `apiRequest(url, method, data, timeoutMs?)` — url FIRST, method SECOND. Default
  fetch timeout 20s; the AI parse call passes 90_000.
- **Deploys:** GitHub main is source of truth. The Replit workspace drifts, and Replit
  deploys from *workspace files*. Ask the Replit Agent to sync workspace to GitHub main
  and republish; confirm with a grep of a distinctive string in the changed file.
- Two DBs: helium = dev, Neon = prod. Agent SQL hits helium unless told otherwise.
- Verify with click-and-watch + on-screen diagnostics; do not accept "it should work".
