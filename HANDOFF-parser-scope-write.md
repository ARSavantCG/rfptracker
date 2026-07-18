# AI Intake Parser — RESOLVED 2026-07-18 (scope-fix-v4-0718b)

## Status: WORKING END-TO-END, verified click-and-watch on rfptracker.app
Parse → Step 2 review → accept → rfp.scopeOfWork persists → Step 3 ITB modal
populates. Verified: PERSISTED matched intended, coltype=json, rawLen=429,
de-dup guard skipped an already-present item, Step 3 showed all accepted items.

## ROOT CAUSE of the scope-write bug
**`rfp_requests` never had a `scope_of_work` column — anywhere.** Not in
shared/schema.ts, not in prod Neon, not in helium. The only `scopeOfWork` in the
schema belonged to `invitation_to_bid` (easy to misread — both tables have long
field lists). Chain of failure:

1. `updateRfpRequest(rfpId, { scopeOfWork } as any)` — the **`as any` masked the
   TypeScript error** that would have flagged the missing field on day one.
2. **Drizzle silently drops unknown keys in `.set()`** — no error, no warning.
   The UPDATE only touched `updatedAt` and returned 200.
3. Reads returned `undefined` → treated as empty → "PERSISTED 0" forever.

## The fix (commit 5fc40dba)
- `shared/schema.ts`: `scopeOfWork` json column added to `rfpRequests`
  (mirrors the invitation_to_bid row shape incl. masterItemId/snapshot).
- `server/startup-migrations.ts`: additive
  `ALTER TABLE rfp_requests ADD COLUMN IF NOT EXISTS scope_of_work json DEFAULT '[]'::json`
  — fires on boot, so it reached **both helium and Neon** with zero manual SQL.
- `as any` removed from the write call.

## How it was found (one click, after 4+ failed hypothesis rounds)
On-screen diagnostic cascade in commit-to-scope reporting, in one response:
the UPDATE's own `.returning()` length, a **raw SQL read through the app's own
DB connection** (definitionally prod — sidesteps helium/Neon ambiguity), the
storage read-back, and a direct-Drizzle-write probe. The raw SQL error
`column "scope_of_work" does not exist` was the smoking gun; `returningLen=-1`
confirmed drizzle dropped the key silently. Cascade removed after verification.

## Permanent lessons (bank these)
- **Never `as any` a storage write.** It converts compile-time missing-field
  errors into silent runtime no-ops. If a write needs a cast, the schema is
  telling you something.
- **Drizzle `.set()` ignores unknown keys without erroring.** A 200 from an
  update proves nothing about which columns were actually SET.
- **`invitation_to_bid` and `rfp_requests` both have huge field lists** —
  verify which pgTable a schema line belongs to before concluding a column
  exists. grep hit ≠ right table.
- **Raw SQL through the app's own connection** is the trustworthy way to
  inspect prod state — no Replit-Agent/helium ambiguity possible.
- **Startup additive migrations** (ADD COLUMN IF NOT EXISTS on boot) are the
  reliable path for schema changes reaching Neon; drizzle-kit push from the
  workspace only reaches helium.

## Known behavior / watch items
- **Undo in Step 2 does not remove the row from scopeOfWork** — commit only
  adds. Retract manually in Step 3 for now; build removal later if needed.
- De-dup is by normalized description; editing a description in Step 3 then
  re-accepting a similar proposal can create near-duplicates.
- Quantities default to 1 with catalog units — dev team adjusts in Step 3.
