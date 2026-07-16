# Database Migration Runbook — Move Neon DB into Your Own Account

**Goal:** Move the production database off the Replit-provisioned Neon instance
onto a Neon project in YOUR account (ar@savantcg.com), so a Replit lockout/billing
lapse can never cut you off from production data again.

**Safety model:** This is a COPY, not a move. The old DB keeps running and serving
the app the entire time. We copy → verify → repoint → confirm → and only later
decommission the old one. At no point is data deleted from the source. Plus we have
`backup.sql` (7.1M full dump) and the prior JSON backup as belt-and-suspenders.

**Total app downtime:** ~1–2 minutes (one app restart at the repoint step). Do this
OFF-HOURS, not during team training.

---

## Known source (old) DB
- Host: `ep-still-mud-a6uzawf6.us-west-2.aws.neon.tech`
- DB: `neondb` · User: `neondb_owner` · Region: us-west-2 (AWS)
- Connection string lives in Replit as `$DATABASE_URL`.

## Prereqs (already done)
- [x] `pg_dump`/`psql` available in Replit Shell (PostgreSQL 16.10)
- [x] Full backup taken: `backup.sql` (7.1M) — DOWNLOAD IT to your machine
- [ ] New Neon database created in your account (see Prep Step B)

---

## PREP (do now, zero downtime, safe during active use)

### Prep Step A — Confirm where the DB lives
In Neon console (console.neon.tech, as ar@savantcg.com), check if a project with
host `ep-still-mud-a6uzawf6` appears.
- If YES → the DB is already in your account; migration is optional (you already
  own it). You may only need to move it to a new project or just note the direct
  console access.
- If NO (only `savant-portal` shows) → it's under Replit's org. Proceed to create
  your own new DB below and copy into it.

### Prep Step B — Create the NEW database in your Neon account
1. console.neon.tech → **New Project**.
2. Name it e.g. `rfptracker-prod`. Region: **us-west-2 (AWS)** to match (lowest
   latency to keep things identical; any region works).
3. Postgres version: **16** (match the source).
4. After creation, copy the new connection string (starts `postgresql://...`,
   includes `?sslmode=require`). Keep it handy — call it NEW_DATABASE_URL.

### Prep Step C — Restore the backup into the NEW DB (dry run of the data copy)
In Replit Shell (replace the URL with your NEW one):
```
psql "NEW_DATABASE_URL" < backup.sql
```
This loads all tables + data into the new DB WITHOUT touching production or the app.
Safe to run now; if the team adds data afterward, we do a fresh final sync at cutover.

### Prep Step D — Verify the copy matches
Run against BOTH old and new and compare row counts:
```
psql "$DATABASE_URL" -c "SELECT schemaname,relname,n_live_tup FROM pg_stat_user_tables ORDER BY relname;"
psql "NEW_DATABASE_URL" -c "SELECT schemaname,relname,n_live_tup FROM pg_stat_user_tables ORDER BY relname;"
```
Table list and counts should match (new may differ slightly if team added rows after
the dump — that's why we do a FINAL sync at cutover).

---

## CUTOVER (do off-hours — ~10 min, ~1–2 min app restart)

1. **Tell the team to pause** for 10 minutes (or pick a genuinely idle window).
2. **Fresh final dump + restore** (captures anything added since the prep dump):
   ```
   pg_dump "$DATABASE_URL" > final.sql
   ```
   Create a clean new DB or drop+recreate the new DB's data, then:
   ```
   psql "NEW_DATABASE_URL" < final.sql
   ```
   (If reloading into the already-populated new DB, easiest is to create a second
   fresh Neon branch/project for the final load to avoid duplicate-key errors.)
3. **Verify counts match** (Prep Step D commands) — old vs new. MUST match before proceeding.
4. **Repoint the app:** Replit → Secrets → set `DATABASE_URL` = NEW_DATABASE_URL.
5. **Redeploy** (Republish). App restarts (~1–2 min). Startup schema guard runs
   against the new DB automatically.
6. **Verify production on the new DB:** log in, open a property, generate a report,
   check a recent lease/cost is present.
7. **Done.** Tell the team it's back.

---

## ROLLBACK (if anything looks wrong at step 6)
Set `DATABASE_URL` back to the OLD connection string in Replit Secrets, redeploy.
You're instantly back on the untouched original DB. Zero data loss — the old DB was
never modified.

## AFTER (a few days later, once confident)
- Decommission the old Replit-provisioned DB.
- Rotate credentials (Neon password on the new DB, GitHub PAT, any Railway tokens).
- Delete the Railway test project.
- Update HANDOFF/notes: production DB now at NEW host, in your Neon account.

---

## ✅ MIGRATION COMPLETED — 2026-07-16

Production database successfully moved to Adolfo's own Neon account.
- **New DB:** project `rfptracker-prod`, host `ep-icy-glitter-a6utlfwz`, region AWS us-west-2, in account ar@savantcg.com.
- **Old DB (decommission after a few days):** `ep-still-mud-a6uzawf6` (Replit-provisioned).
- Method: pg_dump → wipe new DB → restore → verified counts match (15 properties, 26 improvements, 7 leases) → swapped `DATABASE_URL` secret to the `-pooler` connection string → republished → verified all read/write paths on production.
- Team was offline during cutover; zero data-consistency risk. ~2 min app restart.

### Post-migration cleanup (do soon)
- [ ] Rotate the new DB password (it was exposed in a chat session). Neon console → rfptracker-prod → Roles → reset password → update the `DATABASE_URL` secret in Replit + `NEW_DB` if still used.
- [ ] After a few days of confidence: decommission the old `ep-still-mud-a6uzawf6` DB.
- [ ] Revoke the GitHub PAT used this session.
- [ ] Delete the Railway test project.
- [ ] Keep `backup.sql` / `final.sql` archived off-Replit.
