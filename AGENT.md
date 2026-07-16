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
