# Agent task: read production [getFileBuffer] logs during a parse

The AI intake parser still returns "not found on disk or object storage" in PRODUCTION
(rfptracker.app) for RFP-2026-024's two files, even after the getFileBuffer fix was
deployed. getFileBuffer (server/storage-backup.ts) already logs every step. We need you to
SEE those logs, because they contain the exact answer and we cannot read production logs
from outside.

## Do this:
1. Confirm production is running the current code (getFileBuffer present in the deployed
   build). If not, deploy first.
2. Trigger a parse: open RFP-2026-024's validation modal → "Run AI parse" (or POST
   /api/ai/intake-parse/24 directly).
3. Read the PRODUCTION server logs. Capture every line starting with `[getFileBuffer]`.
   For each of the 2 files there should be:
   - 3 lines: `local candidate: <path> exists=true|false`
   - then either `trying Object Storage key: bucket=<b> key=<k>` + found/not-found,
     or `PRIVATE_OBJECT_DIR not set`.

## What the logs will tell us (and the fix for each):
- **All local candidates `exists=false` AND object-storage key "not found":** the file is
  stored under a DIFFERENT key/path than we're trying. Compare to how the WORKING
  `/uploads/*` route serves this exact file (it uses `path.join(cwd, req.path)` where
  req.path is the URL). Find the real key: list the object-storage bucket under
  `.private/uploads/` (and any `projects/` prefix) and/or `ls -R uploads/` on disk, locate
  the actual stored object for "1784296963161_RFP Kurve Doral II 062326 .docx", and update
  getFileBuffer to try that key/path.
- **`PRIVATE_OBJECT_DIR not set`:** object storage isn't configured in production → the
  files must be on disk; find where (`find / -name '*062326*' 2>/dev/null`) and fix the
  local candidate.
- **A candidate `exists=true` but readFileSync failed:** it's a permissions/encoding issue
  — the error line will say which.

## Most likely root cause to check FIRST
The stored path has a SPACE and the object key may be stored WITH the full
`projects/<folder>/Step_1_Entry/` prefix, not just the bare filename. The working route
succeeds because when the browser requests the file, req.path carries the full URL path,
so `path.join(cwd, req.path)` hits it — but the object-storage fallback in BOTH the route
and getFileBuffer only tries the bare filename. If these files are object-storage-only AND
keyed by full path, neither finds them. FIX: in getFileBuffer's object-storage fallback,
also try the full path key: `${dirPrefix}/${filePath}` (and the raw `filePath`), not just
`${dirPrefix}/uploads/${bare}`.

Please run the parse, paste the [getFileBuffer] log lines here, and apply the matching fix,
then push to GitHub main.
