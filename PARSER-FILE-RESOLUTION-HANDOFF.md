# AI Intake Parser — one remaining issue: file resolution

## Status: 95% done. Everything works EXCEPT reading the file bytes off the server.

The parser (server/intake-parser-routes.ts) successfully:
- ✅ Finds the RFP's files (from the rfp.files JSON array)
- ✅ Handles formats: PDF, image, .docx (mammoth), .msg (msgreader), text
- ✅ Full UI: rules admin, Step-2 review panel with accept/reject + diagnostics
- ❌ Cannot locate the file BYTES on disk/object-storage to read them → "0 files read"

## The exact failing case (from live diagnostics)
Two files on RFP-2026-024, reported as:
`not found on disk or object storage (path: uploads/projects/Stone_Collection_TEST___Bridge_Point_826_-_Bldg__2_RFP-2026-024/Step_1_Entry/1784296963161_RFP Kurve Doral II 062326 .docx)`

So `rf.path` in the RFP's `files` JSON = that full nested `uploads/projects/.../Step_1_Entry/<file>` path.

## What was tried (all failed to find the bytes)
In the parser, for each file we try, in order:
1. `path.join(process.cwd(), f.filePath)`  ← full nested path (this MIRRORS the working /uploads/* server)
2. `path.join(process.cwd(), 'uploads', bare)`
3. `path.join(process.cwd(), 'uploads', 'projects', bare)`
4. `downloadFromObjectStorage(bare, f.filePath)` (server/storage-backup.ts) — tries
   `.private/uploads/<bare>`, `.private/<fullpath>`, `<fullpath>`

## Why this needs in-environment debugging (can't solve from sandbox)
The WORKING file server at `app.get('/uploads/*')` (server/routes.ts ~line 96) uses the
SAME candidates and succeeds when you download a file in the app. Our parser uses the same
candidates and fails. The difference must be environment-specific and only visible with
live server access:
- Does `process.cwd()` differ between the two code paths at runtime?
- Are these files actually only in Object Storage under a key our fallback doesn't try?
  (Add logging in downloadFromObjectStorage to print the candidate keys + which bucket.)
- Is there a leading-slash / normalization difference in `f.filePath` vs what /uploads/* sees?

## The fix (for whoever has server logs — likely the Replit Agent)
1. In the parser's resolution loop, `console.log` each candidate path + `existsSync` result,
   and log the object-storage candidate keys tried. Run a parse, read the server logs.
2. Whichever candidate the WORKING /uploads/* handler hits for this file is the one to use.
   Easiest: factor the working handler's resolution into a shared helper both use.
3. Alternative robust fix: since the app already serves these via `/uploads/*` with auth,
   the parser could fetch the file via an internal authenticated request to its own
   `/uploads/<path>` endpoint instead of touching the filesystem directly — guaranteed to
   match the working path.

## Everything else is DONE and shipped
Schema, storage, rules CRUD + admin UI, parse endpoint (Claude call, prompt with rules +
catalog), Step-2 review panel (accept/reject/bulk, confidence sort, diagnostics). Once file
bytes are readable, the feature is complete. Also: remember to seed at least one inference
rule (ROM Pilot → AI Rules) — "Rules applied: 0" in tests because none were added yet.
