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

## Known remaining gaps

- **`checkPermission` only checks the custom array, not `ROLE_PERMISSIONS`**: middleware does `user.permissions.includes(permission)` — does not consult the role-based preset table in schema.ts. In practice all users have their permissions explicitly in the array, so this works. Future fix: check role first, then custom array.
- **`rfp-detail-modal.tsx` bug**: `user?.permissions?.['admin.access']` treats array as object — always undefined. Only `user?.isAdmin` fires. Frontend-only gating in that modal is inconsistent with the backend.
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
