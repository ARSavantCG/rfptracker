# Agent task: finish the AI intake parser — diagnose the 502 "unreadable response"

## Status
- File resolution is FIXED (getFileBuffer suffix-scan finds the nanoid-keyed OS files). ✅
- Files are now READ and sent to Claude. ✅
- New failure: parse returns 502 "AI returned an unreadable response" — Claude's response
  fails JSON.parse in server/intake-parser-routes.ts (~line 273).

## Do this:
1. **Deploy current GitHub main (HEAD ac51dbe0 or later)** to production. Confirm the
   deployed code has `max_tokens: 4096` in intake-parser-routes.ts (the response-parsing
   fix). The generic error with NO "cut off" hint suggests prod may still be on OLD code —
   verify the deploy took.
2. Trigger a parse on RFP-2026-024 → "Run AI parse".
3. Read the PRODUCTION logs and paste back the lines:
   - `Intake parser: JSON parse failed. stop_reason=... length=... raw start: ...`
   - `Intake parser: raw end: ...`
   These show EXACTLY what Claude returned and why it won't parse.

## Interpret + fix based on what the raw response shows:
- **stop_reason=max_tokens** (truncated): raise max_tokens further (e.g. 8192), OR reduce
  input size — the .docx + .msg text may be huge; cap each extracted text (currently sliced
  to 20000 chars for text/msg, but the .docx via mammoth is NOT capped — cap it too, e.g.
  .slice(0, 30000)).
- **Response has preamble/markdown around the JSON**: the code already extracts the
  outermost {...}; if Claude is still wrapping oddly, tighten the system prompt or use
  Anthropic's tool/JSON mode.
- **Response is empty / non-text block** (e.g. Claude returned only a stop or refusal):
  log response.content types; if the .msg extraction produced garbage bytes that Claude
  refused, sanitize the extracted text (strip non-printable chars) before sending.
- **Response is valid JSON but not the expected shape**: adjust parsing.

## Most likely cause
The .docx extracted via mammoth is not length-capped, so a big RFP doc + the email can
blow past max_tokens on the RESPONSE side (Claude tries to echo/enumerate too much) or make
the input so large the model truncates. Recommend: cap mammoth output to ~30k chars, keep
max_tokens 4096, and confirm.

Please paste the raw-response log lines, apply the matching fix, redeploy, confirm "Files
read by AI: 2" AND proposals appear, then push to GitHub main.
