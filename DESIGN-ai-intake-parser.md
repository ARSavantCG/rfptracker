# Design: AI Intake Parser (Step 1 → Step 2 scope proposals)

**Status:** Design agreed with Adolfo. Not yet built. Substantial feature — build in a
dedicated fresh session. Foundations already exist (see below).

## The vision
Everything that lands in Workflow **Step 1** — dropped files (broker RFP, work letter,
broker package PDFs), pasted teammate emails, free-typed description fields — gets read
by AI, which **proposes structured scope items in Step 2** for the development team to
review/accept/edit. The AI applies Adolfo's CRE domain rules (e.g. partial-building
lease → demising wall → electrical/fire-alarm/sprinkler reconfig cascade). Proposals feed
downstream: GC scoping OR direct-to-evaluation (using the ROM catalog).

## Foundations that already exist (reuse these)
- **Anthropic SDK wired**: `server/ai-routes.ts` already calls Claude
  (`claude-sonnet-4-5`, `client.messages.create`, JSON response pattern). Gated on
  `admin.access`. Copy this pattern.
- **Files organized by workflow step**: `rfp_files.workflowStep` (Step_1_Entry, etc.) +
  `server/file-organization.ts`. We can gather all Step-1 files for an RFP.
- **ROM catalog**: master scope items with pricing — the target for "catalog match"
  proposals.
- Claude API reads **PDFs and images natively** (send as document blocks) — so no separate
  extraction needed for those; fall back to text extraction only for odd formats.

## Design decisions (agreed)
1. **Inputs:** send raw files (PDF/image) + pasted email text + typed description fields
   to Claude directly. Text-extract only non-native formats.
2. **Proposals: hybrid** — match to ROM catalog when confident (comes with real pricing,
   flows to evaluation); propose generic/free-form when not (dev team maps to catalog).
   Tag each proposal `catalog-match` vs `needs-mapping`, with a confidence + a **reason**
   ("proposed because RFP describes a partial-building lease").
3. **Proposals are SUGGESTIONS, never auto-committed.** Step 2 UI = review/accept/edit/
   reject. Respects the click-and-watch principle.
4. **Rules live in a DB table + Admin page** (NOT hardcoded in the prompt). Adolfo
   edits/adds rules himself, no deploy. The AI prompt reads current rules at request time.
   Same "single source of truth, admin-editable" pattern as the settings system — may
   share that infrastructure. This is the crown jewel: living CRE knowledge, curated over
   time.

## Scope-inference rules — INITIAL brain-dump (seed the rules table with these)
Structure: TRIGGER (condition/keyword) → IMPLIES (scope items).

**R1. Partial-building lease** — IF the RFP is NOT for the balance/entirety of the
building → **demising wall**.

**R2. Demising wall cascade** — a demising wall triggers:
- Electrical reconfiguration
- Fire alarm reconfiguration
- Fire sprinkler reconfiguration
- (more to be added over time — Adolfo: "most of the big ones for now")

**R3. Keyword/category scan** — if the documents or text mention any of these, flag the
corresponding scope (anything construction-related):
- Power / power requirements / electrical → electrical scope
- HVAC / air conditioning → HVAC scope
- Plumbing → plumbing scope
- Office / office buildout → office construction scope
- Parking → parking scope
- Dock levelers / dock packages → dock/loading scope
- (general: ANY construction-related mention → propose a scope item + flag for review)

*(Rules R1-R3 are the seed. The table is designed for Adolfo to keep adding as deals
teach new cascades.)*

## Build plan (dedicated session)
1. **Schema:**
   - `scope_inference_rules` table: `id`, `triggerType` ('keyword' | 'condition'),
     `triggerValue` (text/keyword), `impliedScope` (text or JSON list of implied items),
     `notes`, `isActive`, timestamps. Admin-editable.
   - `intake_proposals` table (or store on the RFP): the AI's proposed scope items per
     RFP — `rfpId`, `description`, `catalogItemId` (nullable), `matchType`
     ('catalog-match' | 'needs-mapping'), `confidence`, `reason`, `status`
     ('proposed' | 'accepted' | 'rejected' | 'edited'), `sourceRef` (which file/field).
2. **Backend:** `POST /api/ai/intake-parse/:rfpId` (admin/dev-gated) — gather Step-1 files
   + text, load active rules, build prompt, call Claude with document blocks, parse JSON
   proposals, store them. Follow `ai-routes.ts` pattern.
3. **Prompt:** system prompt encodes: "you are a CRE construction scope analyst; here are
   the current inference rules: {rules}; here is the intake material: {files+text};
   propose scope items as JSON with description, catalogMatch, confidence, reason." Feed
   the ROM catalog (names) so it can match.
4. **Step 2 UI:** a "Proposed Scope (AI)" panel — list proposals with reason + confidence
   + source; accept/edit/reject each; accepted items flow into the eval/GC scope. Nothing
   auto-commits.
5. **Admin → Scope Inference Rules page:** CRUD for the rules table.

## Open questions for the build session
- Store proposals as their own table vs on the RFP? (Lean: own table for audit trail.)
- Confidence threshold for auto-suggesting catalog match vs needs-mapping?
- Should accepted proposals pre-fill the evaluation directly, or just the scope list?
- Cost/token budget per parse (large PDFs) — cap file size / page count?
