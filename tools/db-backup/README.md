# One-off production DB backup service

Read-only. Dumps every table from the production Neon database to a downloadable JSON file.

## Deploy (Railway)
1. New Project -> Deploy from GitHub -> `ARSavantCG/rfptracker`
2. Branch: `tools/db-backup`
3. Settings -> Root Directory: `tools/db-backup`
4. Variables:
   - `NEON_URL` = production Postgres connection string
   - `BACKUP_TOKEN` = any long random string
5. Deploy, then open the public URL.

## Use
- `/health` - confirms connection, lists tables
- `/backup?token=YOUR_BACKUP_TOKEN` - downloads the JSON backup

## After
Delete the Railway service. Rotate the Neon password.
