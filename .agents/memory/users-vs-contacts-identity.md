---
name: Users vs Contacts dual identity system
description: Two unrelated login-capable tables (users, contacts) merged only visually in Admin UI; reachability/soft-delete rules to keep in sync.
---

The app has two separate, unrelated identity/login systems, merged only visually in the Admin page under one "System Users" heading:
- `users` table: internal admin/staff accounts, authenticated first.
- `contacts` table (type=owner, hasSystemAccess=true): external contacts who can also log in, authenticated via a fallback path (email + bcrypt against `contacts.passwordHash` directly). A contact session's `req.user.id` is the synthetic string `contact_<id>` — there is no row created in `users` for a contact login.

No FK links the two tables together.

**Rule:** both tables must share the same reachability semantics — `isActive` (boolean, default true) gates login on both. Deleting a login-holding contact must never hard-delete the row (would destroy business contact data alongside the login); it must soft-deactivate (`isActive=false`) instead, mirroring `deleteUser`'s pattern. Any new delete/reactivate surface for one table should be mirrored on the other to avoid re-introducing this asymmetry.

**Why:** contacts.hasSystemAccess is a role/type flag, not a reachability flag — conflating the two allowed a deactivated-but-still-`hasSystemAccess` contact to keep logging in, or a hard delete to silently wipe business data. Any auth check must test `isActive`, not just `hasSystemAccess`.

**How to apply:** when adding new user/contact CRUD affecting login capability, check both `server/auth-routes.ts` (login gate) and the delete endpoints in `server/routes.ts` for parity between the two tables.
