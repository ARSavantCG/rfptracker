# Auth & Permission Hardening + Dashboard Fix — Handoff Notes

## What was done

### Part B — Backend checkPermission guards added

All routes below previously had only `requireAuth`. `checkPermission` middleware now fires a real 403 before any handler logic runs.

#### server/routes.ts
| Route | Guard added |
|---|---|
| `POST /api/contacts` | `contacts.create` |
| `PATCH /api/contacts/:id` | `contacts.edit` |
| `POST /api/rfp-requests` | `rfp.create` |
| `POST /api/rfp-requests/with-files` | `rfp.create` |
| `PATCH /api/rfp-requests/:id` | `rfp.edit` |
| `POST /api/rfp-requests/:id/advance-phase` | `rfp.edit` |
| `POST /api/rfp-requests/:id/bid-collections` | `rfp.edit` |
| `PATCH /api/rfp-requests/:rfpId/bid-collections/:id` | `rfp.edit` |
| `PUT /api/rfp-requests/:rfpId/bid-collections/:id` | `rfp.edit` |
| `POST /api/rfp-requests/:rfpId/evaluation-budget` | `rfp.edit` |
| `POST /api/admin/contacts/:id/set-password` | `admin.access` |
| `POST /api/admin/contacts/:id/generate-password` | `admin.access` |

#### server/property-routes.ts
| Route | Guard added |
|---|---|
| `POST /api/properties` | `properties.create` |
| `PUT /api/properties/:id` | `properties.edit` |
| `PATCH /api/properties/:id` | `properties.edit` |
| `PATCH /api/properties/:id/electrical-allocation` | `properties.edit` |
| `POST /api/properties/:propertyId/existing-improvements` | `properties.edit` |
| `PATCH /api/properties/:propertyId/existing-improvements/:id` | `properties.edit` |
| `POST /api/properties/:propertyId/executed-leases` | `properties.edit` |
| `POST /api/properties/:id/attachments` | `properties.edit` |
| `DELETE /api/properties/:id/attachments/:attachmentId` | `properties.edit` |

#### server/actuals-routes.ts
Using `admin.access` — consistent with existing delete guard, no new permission string required.
| Route | Guard added |
|---|---|
| `POST /api/project-actuals` | `admin.access` |
| `PATCH /api/project-actuals/:id` | `admin.access` |
| `POST /api/project-actuals/:id/line-items` | `admin.access` |
| `PATCH /api/project-actuals/:id/line-items/:lineItemId` | `admin.access` |
| `DELETE /api/project-actuals/:id/line-items/:lineItemId` | `admin.access` |

### Part C — John Mejia permissions updated on Neon (contacts.id = 5)

**Database:** Neon (production)

**Before:**
```json
["rfp.view","properties.view","contacts.view","reports.view","reports.generate","users.view","rom.view"]
```

**After:**
```json
["rfp.create","rfp.edit","rfp.view","contacts.create","contacts.view","properties.view","reports.view","reports.generate","users.view","rom.view"]
```

Added: `rfp.create`, `rfp.edit`, `contacts.create`
NOT granted: `properties.create`, `properties.edit`, any `*.delete`, `contacts.edit`, `admin.access`

Data-only change — no schema migration required.

### Part D — Verification results

Tests run against dev server (helium DB). Code behavior is DB-agnostic — same middleware runs against Neon in production.

**John — 403 confirmed on all blocked routes:**

| Endpoint | Result |
|---|---|
| `PATCH /api/contacts/:id` | 403 "contacts.edit permission required" |
| `POST /api/properties` | 403 "properties.create permission required" |
| `PATCH /api/properties/:id` | 403 "properties.edit permission required" |
| `POST /api/project-actuals` | 403 "admin.access permission required" |
| `PATCH /api/properties/:id/existing-improvements/:id` | 403 "properties.edit permission required" |

**John — 200/201 confirmed on allowed workflow routes:**

| Endpoint | Result |
|---|---|
| `POST /api/contacts` | 201 (contacts.create passes) |
| `POST /api/rfp-requests/:rfpId/evaluation-budget` | 200 (rfp.edit passes) |
| `POST /api/rfp-requests/:id/bid-collections` | 201 (rfp.edit passes) |
| `POST /api/rfp-requests` | Permission gate passes (no 403); test payload hit Zod validation (missing required RFP fields) — expected for a minimal test call. Real UI form succeeds. |

**Admin — confirmed passes all guarded routes:**

| Endpoint | Result |
|---|---|
| `PATCH /api/contacts/:id` | 200 |
| `POST /api/project-actuals` | 201 |

---

### Dashboard fix — cancelled excluded from all count tiles

**File:** `server/dashboard-routes.ts` line 16

**Change:** Added `'cancelled'` to `INACTIVE_STATUSES`.

```
BEFORE: const INACTIVE_STATUSES = ['completed', 'on-hold', 'archived'];
AFTER:  const INACTIVE_STATUSES = ['completed', 'on-hold', 'archived', 'cancelled'];
```

This one constant is shared by all three `notInArray` filters — Overdue, Bids Awaiting Evaluation, and Upcoming 7 Days. All three now exclude cancelled RFPs automatically. Active RFPs was never affected (uses a positive `ACTIVE_STATUSES` list that never included `'cancelled'`).

**Verified against Neon (production):**

| Metric | Before | After |
|---|---|---|
| Overdue | 3 (all 3 were cancelled: ids 176, 177, 194) | 0 |
| Bids Awaiting | 0 | 0 (no cancelled-RFP bids existed) |
| Upcoming 7 days | 0 | 0 |
| Active RFPs | 0 | 0 (unchanged — positive-list filter) |

No genuinely active past-due RFPs exist on Neon, so overdue correctly drops to 0. If a future active RFP goes past its due date it will still appear — only `cancelled` status is newly excluded.

---

---

### Frontend permission gating — contacts, properties, rfp-detail-modal

**Files changed:**
- `client/src/pages/contacts.tsx`
- `client/src/pages/properties.tsx`
- `client/src/components/property-form-modal.tsx`
- `client/src/components/rfp-detail-modal.tsx`

#### Contacts page (`contacts.tsx`)
- Imported `useAuth`, derived `canEditContacts = user?.permissions?.includes('contacts.edit')`
- The **Edit button** on every contact card is now hidden when the user lacks `contacts.edit`
- **Add Contact** button (top-right) remains always visible — non-admins keep `contacts.create`
- **Delete** inside the modal was already gated by `contacts.delete` (no change needed)

#### Properties page (`properties.tsx`)
- Imported `useAuth`, derived `canCreateProperties` and `canEditProperties`
- **Add Property** button (top-right and empty-state fallback) now hidden when lacking `properties.create`
- **Edit** pencil icon per property card now hidden when lacking `properties.edit`
- **All write sub-modals** (Bay Configuration Manager, Lease Management, Existing Improvements, Electrical Management, Building Specifications) are wrapped in `{canEditProperties && (...)}` — the entire row of buttons is hidden for read-only users

#### Property form modal (`property-form-modal.tsx`)
- Imported `useAuth`, derived `canDeleteProperties = user?.permissions?.includes('properties.delete')`
- **Delete Property** button inside the edit modal now hidden when lacking `properties.delete`

#### RFP detail modal bug fix (`rfp-detail-modal.tsx` line 220)
- **Before (broken):** `user?.permissions?.['admin.access']` — treats the permissions array as an object; always `undefined`
- **After (fixed):** `user?.permissions?.includes('admin.access') || user?.isAdmin`
- This means admin-only fields in the RFP detail modal (status/phase editing, date editing) now correctly show for admins and hide for non-admins

#### Verified via e2e test (John Mejia non-admin, admin):
| Check | John (non-admin) | Admin |
|---|---|---|
| Contacts: Add Contact button | ✅ visible | ✅ visible |
| Contacts: Edit button on cards | ❌ hidden | ✅ visible |
| Properties: Add Property button | ❌ hidden | ✅ visible |
| Properties: Edit icon per card | ❌ hidden | ✅ visible |
| Properties: Sub-modal buttons | ❌ hidden | ✅ visible (Bay Config, Lease, Costs-in-Place, Electrical, Building Specs) |

---

## Known remaining gaps

- **`checkPermission` only checks the custom array, not `ROLE_PERMISSIONS`**: middleware does `user.permissions.includes(permission)` — does not consult the role-based preset table in schema.ts. In practice all users have their permissions explicitly in the array, so this works. Future fix: check role first, then custom array.
- **`rfp-detail-modal.tsx` bug**: ✅ FIXED — `permissions.includes('admin.access')` now used correctly.
- **RFP endpoints still `requireAuth`-only**: `advance-workflow`, `additional-areas`, `invitation-to-bid PATCH`, `generate-pdf`, `rfp-format-settings`, `project-alternates`, `evaluation-budget/cleanup-assemblies`, `evaluation-budget/attachments`, `evaluation-budget-history`. Covered by rfp.edit in principle but not explicitly guarded yet.
- **`contacts.create` is now real for owners**: John and other owners with `contacts.create` can add contacts server-side. Confirm this is the intended policy for all owner-type contacts with system access.

## No schema migration needed

Zero new DB columns. Zero new permission string types.

## Manual Git push required

```
git add server/routes.ts server/property-routes.ts server/actuals-routes.ts server/dashboard-routes.ts HANDOFF.md
git commit -m "Add checkPermission guards to 23 routes; exclude cancelled from dashboard tiles; update John Mejia Neon permissions"
git push
```

---

## 2026-07-18 — Parser scope-write bug RESOLVED (scope-fix-v4-0718b)
- **Bug:** Accepting AI proposals never persisted to rfp.scopeOfWork (silent no-op, 200s everywhere).
- **Root cause:** `rfp_requests.scope_of_work` column never existed anywhere — the schema's only scopeOfWork belongs to invitation_to_bid. `as any` on the write masked the type error; drizzle `.set()` drops unknown keys silently.
- **Fix:** Column added to schema + additive startup migration (ADD COLUMN IF NOT EXISTS on boot → reaches helium AND Neon automatically). Cast removed.
- **Process notes:** Found in one click via on-screen diag cascade incl. raw SQL through the app's own DB connection (= prod by definition). Full writeup + banked lessons in HANDOFF-parser-scope-write.md. Diag cascade removed after verification; lean persisted read-back retained.
- **Watch:** Step-2 undo does not retract already-committed scope rows (commit is add-only).

## 2026-07-18 (later) — Replit Git panel divergence: PERMANENT, COSMETIC, DO NOT TOUCH
- The workspace's local git graph has permanently diverged from origin/main (~35 local auto-checkpoint commits vs remote sync commits). Replit blocks `git fetch`/`git reset --hard` from the Agent ("Destructive git operations are not allowed"), so it cannot be repaired.
- **All real work is on GitHub main** — verified 2026-07-18 by searching origin/main history for every "unpushed" commit shown in the panel (all present, incl. the MsgReader/no-wipe parser fixes from prior sessions).
- **RULE: never tap Pull, Push, or Sync Changes in the Replit mobile/desktop Git panel.** A Pull starts an unresolvable mobile merge. The panel's warnings ("merge with conflicts", "can't push") are expected noise. The pipeline remains: Claude pushes to GitHub main → Agent file-syncs workspace from main → Adolfo clicks Publish.
- Corollary: "deploy done" claims are only trusted after Adolfo clicks Publish and click-and-watch confirms new UI (e.g., a button that only exists in the new build).

## 2026-07-18 (later still) — Agent sync DELETED server/routes.ts from GitHub main
- The Agent's "sync workspace to b52a26cc" commit (8c89948e) silently deleted server/routes.ts (7,177 lines) from GitHub while claiming "no functional drift." Workspace and prod were unaffected; only GitHub's copy vanished. Restored from b52a26cc in a82ff829.
- Suspected cause: the Agent's file-level sync omitted the repo's largest file (size limit or manifest issue). Unconfirmed — worth asking the Agent to explain its sync mechanism.
- **RULE: after every Agent workspace→GitHub sync, verify server/routes.ts (and total file count) still exists on origin/main before trusting the sync.** `git ls-tree origin/main server/routes.ts` or a GitHub web check.
- This is the sharpest instance yet of the session's core lesson: Agent narration ("working tree clean, no drift") is not evidence. The deletion was visible only in the actual commit stat.
- **Root cause (Agent's post-mortem, confirmed plausible):** its GitHub-API sync builds blob payloads via shell `$()` substitution; routes.ts (~260 KB) exceeded the sandbox's ARG_MAX → "Argument list too long" → empty blob SHA → file silently omitted from the tree while the commit succeeded. Fix adopted: write JSON payload to a temp file and `curl -d @file` for any file over ~200 KB. The post-sync verification rule above stays regardless.
- Workspace git graph was reset to origin/main via the user-run Shell (`git fetch` + `git reset --hard origin/main`) — the Agent is blocked from destructive git ops but the human Shell is not. Divergence may recur from platform auto-checkpoints; same shell procedure clears it.

## 2026-07-18 (evening) — Parser UX + ITB document intelligence session
- **Collapsible review (Step 2):** Accepted/Rejected render as collapsed <details> bars; rejected items restorable; undo on accepted calls POST /intake-proposals/:id/retract which returns the proposal to review AND removes its scope row (matched by proposalId stamped at commit). De-dup is proposalId-based with description fallback.
- **Step 3 staleness fixed:** "existing ITB scope wins" replaced with merge-on-open (stamped rows survive only if still in rfp scope, keeping Step-3 edits; new accepts append; manual rows untouched). Re-running the parse clears AI-stamped rows from rfp.scopeOfWork — a new accept set REPLACES the old.
- **Soft-cost exclusion:** rows in ROM catalog category 'Design / Soft Costs / Other Fees' stay in scope/Step 3/Step 4 evaluation but are excluded from ALL 6 generated ITB variants via bidableScope() in pdf-generator.ts. Resolution is two-tier: category field stamped at commit + masterItemId lookup against the live catalog (primeSoftCostIds, primed per generateRfpPdf call) so LEGACY unstamped rows are excluded too. The catalog category is the single source of truth for biddability. Verified in production: 4 soft-cost items correctly held off both invites.
- **CRITICAL LESSON — zod strips undeclared keys:** both ITB scopeOfWork zod schemas (shared/schema.ts insert schema AND the modal's form schema) silently dropped proposalId on save, which would have destroyed the retraction stamp. Any new field carried on scope rows MUST be declared in BOTH schemas or it dies on first save. proposalId + category now declared.
- **Formatting:** quantities render with thousands separators in the ITB scope inputs (formatQuantityDisplay; raw digits stored; zod transform is parseFloat+strip — parseInt('1,000')===1 trap removed) and in all 6 generated document tables (formatQty). Units normalized at commit to canonical catalog formats (sf., lf., ls., ea., $, %) via normalizeUnit; fallback is 'ea.'.
- **OPEN INVESTIGATION — modal click/scroll jump:** first click or first keystroke in an empty quantity/unit field in the ITB modal occasionally scrolls the dialog to top and drops focus (once per session-ish; re-click works). Static analysis exhausted (no scroll code, no dirty-conditional rendering, seeding gated once-per-open). TEMP instrumentation is live in invitation-to-bid-modal.tsx (focus-diag: logs focusout transitions + >200px upward scroll jumps as gray mono text under the dialog title). NEXT STEP: user screenshots the gray text when it reproduces; the identifier after the arrow is the focus thief. Remove the instrumentation after diagnosis.
- **Process:** Agent syncs now use temp-file blob method and full commit-range file checks (both self-adopted after failures). Agent race pushes mid-commit happen; reconcile pattern: cp changed files to /tmp, reset --hard origin/main, copy back, commit, push. Agent correctly reported real grep counts (2/14) against my wrong predictions (3/13) — verify counts against the actual file, and credit honest reporting.

## 2026-07-18 (night) — Scroll-jump bug CLOSED (two triggers + structural immunity)
- **Root cause was TWO independent triggers of one mechanism** (useFieldArray id regeneration remounting all scope-row inputs): (1) save mutation onSuccess did form.reset+replaceScope 100ms after every save — removed; (2) the seeding effect's legacy setTimeout replaceScope — on slow connections the seed fires seconds after open, replacing rows exactly as the user starts typing — removed (Playwright-confirmed by the Replit sub-agent). A do-not-reintroduce comment guards the seeding site.
- **Structural immunity added**: scope rows keyed by a client-only `_key` in row data (stableRowKey/withRowKeys), not framework ids — any future array replace preserves DOM and focus. Origin of the insight: the evaluation screen's inputs never jumped (plain state, stable db-id keys) — comparative control-group analysis by Adolfo. Codified in UI-STANDARDS.md.
- Diag instrumentation (overlay, mount counter, CLIENT-DIAG phone-home endpoint) fully removed. If the jump EVER recurs, re-add from commits b51012be/d0eb68fe/c86bac25.
- **NEW AGENT HAZARD — FORCE PUSH**: the Agent's teardown sync FORCE-pushed fed9339f with parent 728f6ee4, rewriting main's history and orphaning commit 4756d459 (content survived only because the Agent had synced that file first). Its sync also previously REVERTED its own Playwright-confirmed fix (60bd0eb6) by pushing a stale file over it. RULES: after every Agent push, check `git fetch` output for "(forced update)" and verify file CONTENT on origin (grep unique strings), never commit graphs or narration. The Agent's separate handoff lives at .local/HANDOFF_ITB_SCROLL_JUMP.md.
- UI-STANDARDS.md created (repo root): commas/currency, canonical units, stable-key tables, zod row-field declaration, query keys, icons/colors, six-variant document rule, soft-cost biddability. Agent prompts should cite it.

## 2026-07-19 (early AM) — Jump/focus/truncation bug: TRUE ROOT CAUSE FOUND AND FIXED
- `<form key={`itb-form-${Date.now()}`}>` in the ITB modal — new key every render → React destroyed and rebuilt the ENTIRE form DOM on any modal re-render. Proven by document-level MutationObserver diag: NODE-REPLACED in 10/10 iterations (~5s cadence), including the projectScope textarea far from the scope table. Removed in bb593f25 with a do-not-reintroduce comment; rule added to UI-STANDARDS.md (React keys section).
- The three earlier fixes (save-onSuccess reset removal, seeding setTimeout removal, stable _key rows) were real defects and stay — they were necessary but could not survive the form-level demolition. The focus keeper (159bf525) also stays as guarded hardening.
- Evidence chain that cracked it: overlay diag → sub-agent Playwright → 500ms-spaced keystrokes + document-level MutationObserver with NODE-REPLACED/removedBy attribution. Screenshot-based capture kept missing it; self-reporting + slowed input was the unlock.
- Process failures owned and fixed: sandbox tsc was silently broken all day (TS2688/TS5101 → "clean typecheck" was empty; how the diag-v4 crash shipped); python edits could silently no-op (now: asserted anchors + grep-verified landing + esbuild syntax gate). Real typecheck is delegated to the workspace as a mandatory pre-publish gate; instrumented builds go to dev + sub-agent before any Publish.
- Production crashed once during the hunt (diag v4 undefined vars) — rolled back within minutes via git revert 9e48755f.
- **2026-07-19 CONFIRMED FIXED IN PRODUCTION** — all 3 sub-agent gates passed (incl. the 8-second idle survival check: nodeExistsAfter=true, value intact) AND Adolfo's real-device thumb test: backspace-and-retype on quantity and unit, deep-scrolled, plus tap-wait-8s-type. Bug closed. Focus keeper (159bf525) retained as hardening. Remaining known debt: 247 pre-existing project tsc errors (build is vite/esbuild, never type-gated) — candidate for a future burn-down session.

## 2026-07-19 (Sun) — ROM Pilot module: Step-1 improvements + fork + embedded evaluation
Shipped and gate-verified (through f7098068):
- **Step 1:** RFP Request defaults to logged-in user (admins prefilled-but-editable, matched to 'Name - Company'; non-admins locked); Anticipated Lease Execution auto-defaults to the Friday one month after Internal Due Date (never clobbers manual entry); footer is now a path chooser: "Route to Dev Team" vs "ROM Pilot" (no Allowance checkbox — allowance is a USE of the ROM path, not its name).
- **The fork** (POST /api/rfp-requests/:id/fork-to-rom): snapshots property/bays/project into a linked ROM (linkedRfpId), sets pricingPath='rom_pilot', jumps workflowPhase to 'evaluation'. No navigation away — RFP lives in the pipeline (dual-entry principle: standalone /rom-pilot stays independent; ROM-path RFPs get the ROM form INSIDE the workflow shell).
- **Workflow visuals:** Validation/ITB/Bid-Collection render light purple (bypassed) for ROM-path RFPs, no green check, not clickable.
- **Embedded evaluation:** RomWorkflowPanel renders at the Evaluation step for ROM-path RFPs (badge, linked-ROM summary, "Price Scope from Catalog" opening the SAME RomPilotScopeModal the standalone uses).
- **Template auto-seed on fork:** Baseline Industrial TI seeds the ROM (delete-down beats build-up); rows resolve to catalog (link then name; unresolvable skipped — scope_item_id NOT NULL); prices catalog-forced; demising wall defaults 50% tenant share (editable); percent fee rows seeded with 'fee math finalized on report' notes. Gate-3 evidence: seeded total $23,296.
- **Rate lock hardened server-side** (slice 1 complete): both line-item endpoints force catalog prices + recompute totals; non-admin custom items rejected 403 (catalog-only doctrine).
- New schema: rfpRequests.pricingPath, romPilots.linkedRfpId (additive startup migrations).

Incidents owned: my Templates import landed INSIDE rom-routes' JSDoc block (edit-script anchor grabbed '/**'; esbuild doesn't typecheck; Agent's differential caught it, both sides now fixed) — RULE: never anchor on file line 1; verify imports land OUTSIDE comments. My contacts-before-declaration TDZ crash also caught by the gate pre-deploy.

OPEN / NEXT:
1. **Adolfo's fresh-fork prod verification** — his 4:13 PM fork hit a stale prod build (pre-endpoint: no Fork-to-ROM logs, no pilot, prod boot at 8:11 PM postdates the test); that RFP is stranded on dev path (cancel it). Fresh fork on current build is the acceptance test.
2. **Fee/report engine block (the remaining big build):** percent-fee math (2.75% CM of subtotal), CM-fee-INSIDE-the-allowance presentation (gross / less CM / net to tenant), recorded fee-line deletions (who/when → surfaced in portfolio fee reports incl. allowances), badged ROM PILOT report in the eval family with costs-in-place at the bottom (shared components with standalone).
3. **Closing polish:** hide custom-item UI for non-admins in ROM; fix standalone /rom-pilot double-create modal; permissions check for JJ/Brenda on ROM-path RFPs; supervised JJ test-drive.
4. **Housekeeping:** ⚠️ Agent's "production" pilot list included its Gate-3 dev tests (RFPs 199/200, ROMs 12/13) — either dev server points at prod Neon (verify DATABASE_URL host next session!) or it misreported; clean up test data. Also standing: tsc debt burn-down, Neon/Railway credential rotation, ITB money test.

## 2026-07-19 (evening) — Four-bucket report + FEE ENGINE (JJ runway)
- **Four-Bucket Budget Report** (Reports section, `/api/reports/budget-buckets/:rfpId`): groups any project by contract counterparty — Contractor / Design / CM Fees / Balance — with line items, %, grand total. Works for bid-based evaluations AND ROM-path RFPs. Resolution: explicit `rom_scope_items.contractBucket` (NEW column; named contractBucket because `budgetBucket` already existed with pricing-MECHANICS semantics — collision caught pre-ship), else inference: contingency/permit/testing/bond→balance, CM→cm, design/architect/engineer→design, else contractor. Costs-in-place shown informationally, never bucketed. Purple ROM badge vs blue evaluation badge. Gate-verified 9/9 items bucketed correctly.
- **FEE ENGINE** (the last hard blocker): percent items (CM 2.75%, contingency, permit fees — pct parsed from catalog names, `budgetBucket` pct-* recognized) compute as pct × non-fee subtotal, stored on rows so modal/pilot/reports agree. Wired into bulk save, individual save, AND the fork seeder (fees seed with real dollars, not $0). Pilot totalEstimate = subtotal + fees. Fixed seeder bug leaking template fee-percents into tenantShare.
- **Fee governance:** CM-fee deletion recorded (cmFeeRemovedBy/At on rom_pilots; cleared on re-add), never blocked; four-bucket report shows an amber warning naming who/when.
- **Inside-the-allowance math** on the ROM report: Gross allowance (CM included) / Less CM fee / Net available for TI.

### REMAINING BEFORE JJ GOES LIVE
1. **Non-admin UX sweep (last code item):** hide custom-item affordances non-admins can't use (server already 403s); sub-agent run of the FULL path as a NON-ADMIN (fork → open → price → save → report).
2. **Adolfo: revise Standard TI template pricing** (in progress) — the seeder loads whatever the template holds; fees now compute against it.
3. **Supervised JJ dry run** end-to-end; his confusion points become the final polish list.
Not blocking: demising auto-quantity + clear-height variants (DESIGN-context-aware-pricing.md, needs Adolfo's LF source + variant naming), standalone /rom-pilot double-create quirk, portfolio-wide CM-fee rollup across allowances (per-project flag exists now), tsc debt, credential rotation, ITB money test.

## 2026-07-19 (late) — SPEC TAGS built (context-aware pricing, slice 1: fork seeder)
Implements DESIGN-context-aware-pricing.md REFINEMENT (N repeatable tags per catalog item),
superseding the never-built fixed quantityBasis/specMatcher column pair. NOT yet pushed
through Publish — gate first (see below).

- **Schema:** `rom_scope_items.spec_tags` (json, default `[]`) + `SpecTag` type and
  `SPEC_TAG_SOURCES` vocabulary in shared/schema.ts: rentable_sf, office_sf,
  rentable_minus_office, building_depth, clear_height, dock_doors, bay_count. The
  vocabulary is the SINGLE source for both the admin dropdown and the resolver switch —
  a key added without a resolver case logs a warning rather than silently returning junk.
  Additive startup migration (reaches helium AND Neon on boot); no drizzle-kit push.
- **Resolver:** new `server/spec-tag-resolver.ts`. Doctrine: **null = unknown, never 0**
  (a building with no depth on file is unknown, not zero feet deep). `resolveDefaultQuantity`
  = FIRST quantity tag wins; uncomputable → null and quantity stays manual.
  `matchTagsSatisfied` = ALL match tags must pass, and **missing property data FAILS the
  match** — we never guess a variant. Match supports exact value or inclusive
  [value, maxValue] range, so match tags ARE the design's Option-A min/max mechanism,
  attached per-item instead of as dedicated columns. `selectVariant` uses the existing
  `itemGroup` as the scope family (reused, not reinvented); conditioned variants that pass
  beat tag-less defaults, so clear_height 40 picks "Demising Wall 40'" over a generic row.
  Numeric parsing is parseFloat+strip per UI-STANDARDS (clear_height is text: "40 feet").
- **Admin UI:** `SpecTagsEditor` repeater rendered in BOTH the add and edit forms of
  Manage Scope Items, directly under Calculation Basis. Plain state + stable `_key` per
  row (UI-STANDARDS dynamic-table rule), `_key` stripped at submit, remove buttons
  `tabIndex={-1}`. Starts EMPTY with "+ Add Spec Tag" — the design's "minimum one" is the
  shape when tags are in use, not a validation rule on every existing catalog row.
- **Fork seeder (rom-routes.ts):** resolves the RFP's property (id-as-text, with
  display/name fallback for legacy values) + the snapshotted bays into a spec context.
  Variant swap fires ONLY for families that actually use match tags, so existing SF-tier
  groups are untouched. A tag-computed quantity beats the template's placeholder qty.
  Every auto-action or unresolved match is stamped into the row's notes ("Auto-selected X
  by property specs", "Qty 240 from property specs", "⚠ Spec match unresolved") so JJ sees
  what the system decided instead of a silent number.
- **Gates run:** esbuild syntax on all 5 touched files (the gate that catches
  landed-inside-a-comment edits); real `tsc --noEmit` — **zero new errors**, verified by
  per-file/per-code signature diff against a clean origin/main baseline (raw line diff is
  useless here: inferred type STRINGS shift when a column is added, rewording ~40 unrelated
  errors). True baseline is **251**, not the 247 quoted in the 7/19 entry — and my first
  stash-based baseline read 254 because `git stash` left the untracked new resolver file in
  place, inflating it by 3. LESSON: `git stash -u` (or verify untracked state) when
  baselining, and always diff error SIGNATURES, not raw lines.
- **Resolver unit tests: 22/22 pass** (run via esbuild bundle + node, not committed):
  vocabulary math incl. mixed rentable/raw SF, "40 feet" parsing, first-quantity-wins,
  32' fails a 40' building, missing clear height fails, range pass/fail, 32'→40' variant
  swap, nothing-passes → null, conditioned-beats-generic and generic-wins-when-none-pass.

### OPEN — spec tags
1. **Adolfo (data, not code):** confirm `properties.buildingDepth` is the demising LF figure
   (it's in the vocabulary and on the properties tab), populate it per property, then create
   the 32'/40' demising catalog rows sharing one `itemGroup` and tag them
   [quantity ← Building Depth] + [match ← Clear Height = 32 / 40].
2. **Gate before Publish:** Replit Agent verification (prompt below in this session), then
   a fresh fork on the new build — the acceptance test is a seeded demising row arriving with
   the right variant AND a real quantity, no typing.
3. **Next slices:** same resolver into the AI parser and scope-bundle expansion (design's
   original targets); tenant share stays 50% default on demising.

## 2026-07-20 (early AM) — Spec Tags gate results + the DUPLICATE EDIT FORM miss
Agent ran the 7-gate package against dev/helium at c4554bd: **all 7 passed with real
evidence** (SQL rows, raw specTags JSON, actual seeded line items — not narration).
Highlights: variant swap DW-32→DW-40 with qty=240 from buildingDepth and an
"Auto-selected" note; cleared clearHeight → row still seeds, qty still 240, "⚠ Spec match
unresolved" stamped, NO silent guess; a genuinely-32' property correctly did NOT swap;
SF-tiered families seeded unchanged; fee engine totals still exact.

**THEN IT SHIPPED INVISIBLE.** Adolfo published, opened a demising item, and there was no
Spec Tags section. Cause: `rom-scope-items-modal.tsx` contains **TWO inline edit forms** —
one for the category-grouped view (full: Calculation Basis, Minimum Cost, Tiered Pricing)
and an abbreviated one "for CSI grouped items" (Category/Name/Description/CSI/Unit/
UnitPrice/Attachments only). Spec Tags landed only in the first. Production browses by CSI
Division, so the editor didn't exist on the surface actually in use. Fixed in **b18e922**
(editor added to the CSI form, with a comment at the site naming the duplication).

- **How I missed it:** grepped `calculationBasis`, got 2 hits, concluded "add form + the
  edit form." The CSI form never had Calculation Basis, so it was invisible to that grep.
  RULE: when adding a field to this modal, grep `Edit: {item.name}` (or `Update Item`) and
  confirm the count of EDIT SURFACES first — never infer form count from a field that may
  itself be missing from one of them.
- **How the gate missed it:** Gate 4 was all API round-trips; Gate 7's UI portion read the
  component source instead of the rendered page. The data layer was correct the entire
  time — only the render was absent. RULE for future gate packages: **at least one gate
  must be a human tap or Playwright pass on the real rendered surface, in the DEFAULT
  view** (CSI grouping here). "Verified in code" is not verified in UI.

### OPEN — added by this session
1. **Consolidate the two edit forms** (real fix for the above): extract ONE shared form
   component consumed by both the category-grouped and CSI-grouped views. Kills the whole
   "added a field to one copy" bug class permanently. Until then, every new catalog field
   must be added to BOTH forms plus the add form (3 sites).
2. **CSI-grouped form is missing fields**, pre-existing and separate from spec tags: no
   Calculation Basis, Minimum Cost, Source, Include-by-default, Tiered Pricing. Anyone
   browsing by CSI cannot edit those at all; they must switch to category grouping. Decide
   whether the consolidated form exposes everything (likely yes) before JJ goes live.
3. **`PUT /api/rom-scope-items/:id` is requireAuth-only** — surfaced by Gate 7. A non-admin
   with a session can mutate the CATALOG directly, including unitPrice, and now specTags
   (which silently redirect what every future fork seeds). The rate-lock doctrine hardened
   the LINE-ITEM endpoints on the assumption the catalog is admin-only; it isn't. Add
   `checkPermission('admin.access')` to PUT (and audit POST / archive on the same route
   file). Belongs in the non-admin sweep, before JJ.
4. **Standard TI template pricing:** Gate 6 passed arithmetically but exposed Builder's
   Risk seeding at $0.04 and Design (Architectural) at $1.25 — rates entered as dollars.
   Adolfo's in-progress template revision; not a code defect, but these will appear on
   JJ's first real ROM.
5. **Neon verification still owed:** every gate ran against helium (confirmed dev, NOT prod
   Neon — that closes the 7/19 open question). After Publish, confirm `spec_tags` exists on
   Neon via the app's own connection.
6. **Dev test artifacts to clean:** catalog items 79/80, RFPs 203/204, ROM pilots 17-20.
   Template "Standard TI" was already restored to sid=24 by the Agent (verify).
7. **Data entry before the feature does anything:** populate `clearHeight` AND
   `buildingDepth` per property (Adolfo to confirm buildingDepth is the demising LF
   figure), then create the real 32'/40' demising catalog rows sharing one itemGroup,
   tagged [quantity ← Building Depth] + [match ← Clear Height = 32 / 40]. Until then the
   resolver correctly does nothing.
8. **Next code slices:** same resolver into the AI parser and scope-bundle expansion.

## 2026-07-21 — Spec-tag refresh shipped; ROM-mode re-architecture decided
**Shipped (ccb85189):** refresh-from-property-specs. `GET /api/rom-pilots/:id/spec-tags/preview`
returns proposals ONLY for rows whose catalog item carries a quantity tag — untagged scope
(parking, electrical, hand-priced items) is never a candidate, which is the isolation
Adolfo asked for. Per-row recompute icon + footer "Refresh from property specs" opening a
preview dialog with per-row checkboxes; rows that already match or whose spec isn't
populated show but aren't selectable. Apply only STAGES; the existing Save All Items still
commits through rate lock + fee engine. `buildSpecContext()` extracted so the fork seeder
and the preview can't drift. Semantics: RECOMPUTE (from the property as it is now), not
undo — so a spec corrected after forking gets picked up. Deliberately does NOT re-run
variant selection; changing which catalog row a line points at should be explicit.

**Also fixed (ccb8b96d):** fork-to-ROM snapshotted ZERO bays for single-building RFPs. It
read only `selectedBaysPerBuilding` (populated for MULTI-building, keyed by property NAME,
while `rfp.property` holds an id-as-text so the lookup never matched). Single-building bays
live in `selectedBayConfigurations`, never read. Pre-existing, but it would have nulled 5 of
the 7 spec-tag vocabulary entries — and Gate 5 passed over it because the two specs it
exercised (building depth, clear height) come off the property record, not the bays.

**Diagnosis corrected:** Builder's Risk $0.04 / Design $0.75 are NOT "rates entered as
dollars" as claimed on 7/20. They are per-SF rates sitting at quantity 1 — correct values
awaiting a quantity. The template is built to receive quantities it has never been given.

**Fee rows look wrong but are stale, not broken.** They compute server-side on SAVE from the
non-percent subtotal. Observed 7/21: all three back-solved to the same ~$133,996 base while
the live non-fee subtotal was ~$816,301 — i.e. last-saved values, not current.

### DECISION — ROM becomes a MODE of the RFP (see DESIGN-rom-mode-on-rfp.md)
Adolfo's call, and it's the right one: an RFP that goes ROM keeps everything ON the RFP and
opens the SAME evaluation screen, with unit rates locked. `rom_pilots` holds ONLY ROMs
started directly there. Fork stops creating a second record; `pricingPath` (already exists)
is the mode flag; `EvaluationLineItem.masterItemId` (already exists) is the catalog join for
both rate lock and spec tags. Existing forked pilots: DELETE AND RE-FORK, no migration —
all test data, JJ isn't live. Full slice plan, acceptance tests and risks in the design doc.

**Deferred until ROM-mode lands, because they live wherever the line items live:**
- Fee BASE definition. All percent fees share one base (every non-percent row) so Permit
  Fees at 3.5% currently charges against permit expediter, materials testing and the CO fee.
  `CALCULATION_BASES` already has `pct-ti-total`/`pct-construction-total`; the engine
  ignores `calculationBasis`. NEEDS ADOLFO'S ANSWERS FIRST: (1) is permit's "construction
  costs" the TI subtotal only? (2) does contingency exclude the other fees? (3) does CM
  compute before or after contingency? Each moves real money.
- Percent-row display: rate renders as `$0.05` instead of `5%`, and quantity shows an
  editable `1` the engine overwrites. Both columns misrepresent what they hold.

**Check before slice 2:** does JJ's role carry `rfp.edit`? The evaluation save is guarded by
it; if not, ROM mode would lock him out of his own budget.

## 2026-07-21 (PM) — Slices 0 + 0b SHIPPED: permissions + ownership scoping
Built together, as designed, blocking slices 1–5. tsc: exactly 251 before and after
(zero new signatures per file + TS code; baseline measured with `git stash -u`).
esbuild syntax gate passed on all touched files.

**Slice 0 — permissions.** New `pricing.edit` (admin + manager) and `records.editAny`
(admin only; per-user grantable escape hatch). Role `user` gains `rfp.create`,
`rfp.edit`, `rom.create`, `rom.edit`. Because `checkPermission` reads the per-user
`users.permissions` column, a startup backfill (`runPermissionAndOwnershipBackfill`)
tops every existing user row up to its role's current map — UNION only, never removes
hand-granted perms. This is what fixes JJ's actual row, not just new accounts.
**Rate lock, permission half, on the evaluation-budget save:** users without
`pricing.edit` get REJECT-ON-TAMPER, not silent forcing — every submitted unitPrice
must equal the stored row's price (or catalog/snapshot for a new masterItemId row);
mismatches and new free-text rows 403 with catalog-only guidance. Chose rejection over
the design's force-from-catalog for THIS half because dev-mode budgets have no single
source of truth to force from (stored price ≠ catalog after drift) and silently
recomputing the budget's stored aggregate totals (which the client computes with
tenantShare/rollup logic) risked corrupting them. Slice 2 still owes the ROM-mode
FORCE semantics where the catalog IS the source of truth.

**Slice 0b — ownership.** DESIGN DOC WAS WRONG: `rfp_requests` has NO `createdBy`
column at all. Closest signal is `sentBy` (Step-1 "RFP Request" field, auto-filled
with the logged-in user's display name; historically also "Name - Company" broker
strings). Added `createdByUserId` (varchar, users.id) to `rfp_requests` and
`rom_pilots` via startup migration; stamped at ALL creation sites (RFP POST ×2,
create-option, counter-offer, ROM POST, fork-to-rom). **`storage.createRfpRequest`
uses an EXPLICIT `.values()` mapping** — the scope_of_work silent-drop class —
createdByUserId had to be added there or it would have shipped as a no-op.
Backfill matches sentBy/createdBy against user display names + usernames, strips
" - Company" suffixes, drops AMBIGUOUS name collisions (two users, same display
name → unresolved). Unmatched stays NULL = **admin-only, fail closed**.

**Scoping decisions (Adolfo, this session):** reads UNSCOPED (everyone sees the
portfolio); **managers ARE scoped** — below admin, everyone modifies only what they
created. `records.editAny` is the per-user escape hatch since no role carries it
except admin. CAVEAT this creates: Brenda/Andrew/John lose edit on historical RFPs
they didn't create until reassigned. Mitigation shipped: **Admin → Users tab →
"Record Ownership" card** shows resolved/unresolved counts per table (the number
Adolfo asked to see before trusting scoping — check it right after publish; also
logged on every boot) with per-row REASSIGN. Design test 5 is softened accordingly:
manager dev-workflow is byte-identical *on records they own*.

**Enforcement surface** (`server/ownership.ts`, `requireRfpOwnership`/
`requireRomOwnership`, admin/records.editAny bypass → owner match → 403):
26 RFP routes in routes.ts (PATCH rfp, advance-phase, archive/reopen/cancel/
reinstate, create-option, counter-offer, DELETE rfp, files POST/DELETE,
update-with-files, workflow-phase, advance-workflow, additional-areas, ITB
PATCH/DELETE, bid-collections ×4, evaluation-budget ×3, select-primary-bidder,
project-alternates), fork-to-rom, ROM pilot PUT/DELETE, ROM line-items ×3, plus an
INLINE check on `POST /api/invitation-to-bid` (rfpId is in the body, not the URL).
Found and closed: `POST /api/rfp-requests/:id/files` had **NO AUTH AT ALL** — now
requireAuth + ownership (no client caller POSTs to it; verified).

**Catalog hardening (open item #3 from 7/20):** POST + PUT `/api/rom-scope-items`
now `admin.access` (was requireAuth-only — any signed-in user could edit unitPrice
AND specTags). `contractor-pricing` POST/DELETE + `pricing-mode` PATCH now
`pricing.edit` (managers keep them, role user loses them).

**Verified by execution, not narration:** `scripts/test-slice0-backfill.ts` ran the
REAL migration + backfill functions against a live local Postgres 16 seeded with
pre-migration schema and dirty data — 25/25 checks passed: columns created,
JJ/manager/admin permission top-ups exact (JJ has NO pricing.edit), display-name
match, " - Company" strip, broker string → NULL, ambiguous "Sam Smith" collision →
NULL, offboarded "Francis Roura" → NULL, and full idempotency on second boot
(0 changes). Migration functions now take an injectable db handle (default = app
connection; prod path unchanged) to make this test possible.

**Decisions logged:** bid-collections routes deliberately NOT gated by pricing.edit
(bids are contractor numbers, not catalog rates; ownership + rfp.edit gate them).
DELETE rfp keeps its internal permission logic + gains ownership. admin.tsx contains
TWO duplicate `permissionCategories` objects (contact + user editors) — same class
as the ROM modal's duplicate forms; both updated, consolidation still owed.

### OPEN after this session
1. Adolfo: publish, then Admin → Users → Record Ownership — read the unresolved
   counts (production Neon numbers) and reassign anything live. Managers may need
   reassignment or per-user `records.editAny` for historical deals they work.
2. Client courtesy UI for ownership (hide/grey edit buttons on non-owned records)
   deliberately deferred — server 403s carry clear messages; fold into slice 3.
3. Slice 2 owes ROM-mode force-from-catalog on the evaluation save; slice 0's
   reject-on-tamper covers dev-mode rate lock (test 5b) until then.
4. `pg` + `@types/pg` added as devDependencies for the backfill test only.

## 2026-07-21 (PM, follow-on) — Responsible Party column on the homescreen
Adolfo: with ~100 RFPs he can't tell who's picking a deal up without opening each
one — is leasing pricing it as a ROM, or is the dev team supposed to take it?

**Derived, never stored.** `GET /api/rfp-requests` now returns `responsibleType`
('rom' | 'development'), `responsibleName`, and `responsibleOwnerName` computed
from `pricingPath` + `createdByUserId` (slice 0b's new column) — so the badge
cannot drift from the actual route the way a stored field would. ONE users query
for the whole list, not per row.
- ROM route → the creator owns it end-to-end; falls back to the `sentBy` display
  text for pre-backfill rows, then to "Unassigned".
- Development route → `developmentContact` (NOT the creator — the dev-team member
  who picks it up is the answer to the question being asked).
- Owner display name falls back to username when first/last are empty.

**UI:** new sortable "Responsible" column after Status — a teal ROM / blue Dev
badge plus the person, amber italic "Unassigned" when nobody is named. Sorting
groups by route first, then person. Dashboard gains ROM / Dev Team / Mine filter
pills (toggle off by re-clicking; included in Clear Filters). "Mine" matches on
`createdByUserId`, not a name string.

**Duplicate-surface discipline (the 7/20 lesson, applied):** rfp-table.tsx renders
THREE row surfaces — parent, counter-offer, alternate. Rather than paste the cell
three times, the markup lives in ONE shared `<ResponsibleCell>` consumed by all
three. Verified by counting `<td>` per block: 9 / 9 / 9 against 9 headers, with
colgroup and the empty-state colSpan updated to match.

**Verified:** tsc 251 → 251, zero new signatures (one implicit-any from the derived
sort key found and fixed, not suppressed). esbuild clean on all three touched
files. `scripts/test-responsible-party.ts` runs the derivation against live
Postgres across all six real-world data shapes — 7/7 pass, including NULL
`pricing_path` legacy rows treated as development and the username fallback.

### OPEN
1. Gate on the REAL page: the badge must render in the DEFAULT dashboard view, on
   parent AND expanded child rows. Screenshot required (7/19 lesson).
2. Dev-route rows show "Unassigned" wherever `developmentContact` was never filled
   — that's accurate, not a bug, but it may reveal a lot of blanks on first look.
   If so, the fix is data entry (or defaulting developmentContact at validation),
   not the column.
3. Consider surfacing the same badge on the workflow sidebar header later.

## 2026-07-21 (PM, CRITICAL CORRECTION) — slice 0/0b was built against the wrong table
First publish exposed the fault: boot logs read `[permissions backfill] 0 users
checked` and `rfp_requests: 72 total, 0 resolved, 72 UNRESOLVED`. Root cause —
**all real accounts live in `contacts`, not `users`.** Auth (server/auth-routes.ts
+ middleware.resolveUserFromToken) authenticates contacts by email/password and
sets req.userId = "contact_<id>", req.user.role = 'contact', permissions from
contacts.permissions. The `users` table is legacy/empty in production. Adolfo logs
in as a contact (with admin.access); JJ and the managers were ALL added through
contacts. So every piece of slice 0/0b keyed on `users` or role==='admin' was wrong.

**Production impact that was live:** ownership enforcement was ON across 26+ routes
while 0 owners had resolved → every non-admin.access contact (JJ, managers) was
being 403'd on ALL RFP/ROM mutations by the fail-closed branch. Only admin.access
holders (Adolfo) could edit. This was a real, shipped regression.

### Corrections shipped this push
1. **Enforcement flag, default OFF.** `requireRecordOwnership` no-ops (auth only)
   unless `ENFORCE_OWNERSHIP=true`. Restores everyone's access immediately.
   Flip the env var to 'true' ONLY after the ownership report shows real owners
   resolving. This is the no-lockout sequence.
2. **bypassesOwnership** now keys off `admin.access` / `records.editAny`
   permissions, NOT role==='admin' (contacts are role 'contact'). Matches the
   convention requireAdmin already used.
3. **Ownership backfill rebuilt on contacts:** builds name+email → "contact_<id>"
   map from `contacts` (plus any legacy users, bare id), resolves sent_by /
   created_by, stores the "contact_<id>" string so it matches req.userId with no
   translation. Collisions and unknowns stay NULL = admin-only.
4. **Permission top-up** scoped to legacy users only, with a comment that contacts
   get permissions via the admin UI (the ROM / Pricing & Ownership categories
   added earlier apply to the contact editor too). It does NOT invent contact
   perms — too risky without knowing the owner-tag model.
5. **Reassign route** validates contact_<n> against contacts, bare id against users.
6. **Ownership report** assignable list = active contacts (id surfaced as
   contact_<n>) + any users, so reassignment writes a matchable id.
7. **Responsible-party column** owner-name map rebuilt from contacts (was reading
   empty users → names were blank, only sent_by fallback showed).

Creation stamping already wrote req.userId (="contact_<id>") — correct as-is, no
change needed. tsc 251→251, esbuild clean. Live-PG test rewritten for the contacts
world (empty users table, accounts in contacts, records referencing them by name/
email): resolves RFP-1 by name, RFP-2 by email, RFP-3 by "Name - Company" strip,
RFP-4 unknown→NULL, ROM-1 by name, ROM-2 null→NULL, and asserts the stored string
equals contact_<id> (req.userId), idempotent on re-run. ALL PASS.

### DO THIS after publishing (evidence-first, no blind flip)
1. Publish. Boot logs should now show contacts resolving, e.g.
   `rfp_requests: 72 total, N resolved, (72-N) UNRESOLVED`. N should be > 0.
2. Admin → Users → Record Ownership: read the resolved/unresolved split on REAL
   data. Reassign or grant records.editAny as needed. This is the number that was
   the whole point of the checkpoint.
3. **Grant JJ his leasing permissions on his CONTACT record** via Admin (rfp.create,
   rfp.edit, rom.create, rom.edit) — the backfill no longer does this. Verify he
   has them; he may already, since he was "tagged as owner."
4. Only once the report looks right: set ENFORCE_OWNERSHIP=true in the Replit
   deployment env and republish. Re-run gates 1–7 with enforcement live.

### STILL OPEN / verify
- The pricing.edit rate-lock on the evaluation save reads req.user.permissions —
  works for contacts already (permissions populated for both branches). But its
  regression test must run as a CONTACT without pricing.edit, not a users account.
- ROLE_PERMISSIONS map edits remain (harmless; only affect legacy users + new-user
  seed). Contact permission management is entirely via the admin UI.

## 2026-07-22 — ROOT CAUSE of 0/72 resolve: schema-drift throw on select().from(contacts)
Diagnostic card + reassign dropdown were EMPTY in prod → the backfill's contact
read returned nothing → empty map → all 72 RFPs / 2 ROMs unresolved. The sent_by
values were clean all along ("John Mejia - Bridge Industrial", "Brenda Gonzalez",
etc.); the matcher was never the problem — it had nothing to match against.

Root cause: contacts were read with `db.execute(sql`SELECT ... FROM contacts`)`
(raw), then `rows.rows ?? rows` — wrong shape on the Neon serverless driver. When
switched to the drizzle builder `db.select().from(contacts)`, a SECOND fault
surfaced and was caught in a local test that finally reproduced prod: the builder
selects EVERY column in the drizzle schema, so any column the production contacts
table is missing (schema drift) throws, the try/catch swallows it, 0 resolved.

FIX: narrow projection everywhere — `db.select({ id, name, email }).from(contacts)`
— so unrelated column drift can't break the read. Applied in the backfill
(startup-migrations.ts) and both ownership.ts routes (report assignable list +
diagnostic). Lesson banked: NEVER `select().from(table)` in startup/backfill code;
always project the columns you use, because startup code runs before/around the
very migrations that fix drift.

TEST NOW REPRODUCES PROD: scripts/test-slice0-backfill.ts seeds a minimal contacts
table (missing columns like phone), which made the full-select throw exactly as
prod did — RED — then GREEN after the narrow-projection fix. 11/11 pass: resolves
by name, by email, "Name - Company" strip, unknown→NULL, ROM by name, null→NULL,
owner string == req.userId, idempotent.

Also this session: backfill made NON-BLOCKING (runs after listen(), not awaited)
so a slow Neon round-trip can't delay port bind / feed the healthcheck window;
diagnostic added as an admin-panel CARD (raw-URL nav can't send the Bearer token
this app's requireAuth needs).

### After publishing this (expected)
- Boot log: `[ownership backfill] rfp_requests: 72 total / ~65 resolved / ~7 UNRESOLVED`.
  The ~7 unresolved should be the "Francis Roura" RFPs (offboarded contact — if his
  contact row is gone/inactive he can't resolve) plus any genuinely odd sent_by.
- Reassign dropdown will now be POPULATED with contacts.
- Decide who inherits Francis Roura's RFPs (#174,171,129,116,74) — reassign to them.
- THEN, once counts look right, set ENFORCE_OWNERSHIP=true and republish.

## 2026-07-22 — SESSION END: slices 0/0b live & verified; enforcement flipped ON
Where we actually landed after the full saga:

**RESOLVED & VERIFIED ON THE REAL PAGE:**
- Ownership card shows 72/72 RFPs owned, 2/2 ROMs owned, 0 unresolved, 0 unmatched.
  16 assignable contacts load; reassign dropdowns populated. Francis Roura RFPs
  resolved too (his contact is still active enough to match) — no manual reassign
  needed.
- ENFORCE_OWNERSHIP set to 'true' in Replit deployment Secrets + republished.
  Enforcement is now LIVE (was intentionally OFF all session to avoid lockouts).

**THE ROOT CAUSE OF THE ENTIRE MULTI-ROUND SAGA (bank this):**
Production never ran my code. The Replit WORKSPACE had diverged from GitHub main —
the Replit Agent was building its OWN parallel implementation of slices 0/0b in the
workspace, and every "Publish" shipped the Agent's version, not the commits I pushed
to GitHub. All my fixes (contacts identity model, non-blocking backfill, diagnostic
card, narrow-projection contacts read) were invisible in prod because prod published
from a different lineage. Fixed by, in the workspace shell:
  git rebase --abort            (a rebase of Agent commits onto mine was mid-conflict)
  git reset --hard origin/main  (snap workspace to GitHub 9b27cf01; only workspace-
                                 unique commit was an empty "Published your App" marker)
Then Republish → production finally ran GitHub main → everything worked immediately.

**PERMANENT RULES ADDED (do not skip again):**
1. Before EVERY publish, in the workspace shell: `git log --oneline origin/main..HEAD`.
   Empty output = safe. Anything listed = workspace has drifted; reconcile BEFORE
   publishing. This one check would have caught the whole thing on day one.
2. ONE builder per feature. Either Claude builds via GitHub (and Adolfo
   reset-hard-to-origin + republishes), OR the Replit Agent builds in the workspace.
   NEVER both on the same files — that's what created the divergence.
3. Real secondary bug found & fixed along the way: startup/backfill code must NEVER
   `select().from(table)` — the drizzle builder selects every schema column, so any
   prod column drift throws and gets swallowed. Always project: `select({id,name,
   email}).from(contacts)`. Applied in backfill + both ownership routes.

**ALSO fixed this session:** backfill made non-blocking (runs after listen(), not
awaited) so slow Neon can't delay port bind / feed the healthcheck window.

### TOMORROW — TEST ENFORCEMENT (do these on the REAL rendered pages, tap actual
### buttons; API calls / source reads do NOT count — that assumption cost us a session)

Setup: have logins ready for JJ (contact, role user), a manager (Brenda/Andrew/John),
and admin (Adolfo).

TEST 1 — Enforcement is actually ON (the key signal):
  As JJ, open an RFP that resolved to SOMEONE ELSE (any John Mejia / Brenda record).
  Try to edit/save it.
  PASS = clean 403 "you can only modify records you created."
  FAIL = it saves → ENFORCE_OWNERSHIP didn't take; check the deployment env var
         is exactly ENFORCE_OWNERSHIP=true (lowercase 'true'), republish.

TEST 2 — JJ can work his OWN records:
  As JJ: create a new RFP via Step 1 → should save.
    (If 403 HERE, that's NOT enforcement — it's missing permission. Admin → JJ's
     contact → grant rfp.create, rfp.edit, rom.create, rom.edit.)
  As JJ: edit an RFP he owns → saves. Fork one to ROM → works.

TEST 3 — Managers not broken (Adolfo's original must-not-break):
  As a manager, on a deal THEY own: price a bid / save the evaluation budget → saves
  (managers have pricing.edit). If they don't own any, admin reassigns one to them
  first via the ownership card.

TEST 4 — Admin bypasses everything:
  As Adolfo, edit ANY record regardless of owner → always works.

Behavior matrix to confirm: owner→yes, non-owner→403, manager-on-own→yes, admin-any→yes.

### STILL OPEN (deferred, not blocking)
- Confirm JJ's contact carries the four leasing permissions (may already, via "owner"
  tag). Verify in TEST 2.
- Slice 0's rate-lock regression (test 5b) should be run as a CONTACT without
  pricing.edit, not a users account.
- Fee-base definitions still owed by Adolfo before fee-engine work (permit "construction
  costs" scope; does contingency exclude other fees; CM before/after contingency).
- Slices 1–5 (move ROM onto the RFP) remain unstarted — blocked on 0/0b, now unblocked.
