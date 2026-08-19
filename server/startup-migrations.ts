/**
 * Startup schema guard — runs additive, idempotent column migrations against the
 * SAME database the app reads (process.env.DATABASE_URL), on every boot.
 *
 * WHY: The recurring production failure mode is "schema is ahead of the DB" —
 * new code does db.select() including a column that the production DB doesn't
 * have yet, and the whole query 500s. Applying migrations against a copied
 * connection string (e.g. a separate tool) doesn't guarantee the DB the app
 * actually reads got them. Running here, from inside the app, closes that gap.
 *
 * SAFETY: This ONLY runs `ADD COLUMN IF NOT EXISTS` — additive and idempotent.
 * It never drops or alters existing columns, so it can't lose data or break a
 * running app. If a statement fails, it logs and continues rather than crashing
 * boot — a schema hiccup should never take production down.
 *
 * ADDING A MIGRATION: when you add a nullable column to shared/schema.ts, add a
 * matching line here. Keep them additive. For anything destructive or structural,
 * use a real reviewed migration in /migrations and apply it deliberately — not here.
 */

import { db } from './db';
import { sql } from 'drizzle-orm';

interface ColumnMigration {
  table: string;
  column: string;
  type: string; // SQL type, e.g. 'integer', 'text'
}

// Additive columns that must exist for current code to run. Mirror of the
// nullable columns added over time. IF NOT EXISTS makes re-running a no-op.
const ADDITIVE_COLUMNS: ColumnMigration[] = [
  { table: 'property_existing_improvements', column: 'area_sf', type: 'integer' },
  { table: 'property_existing_improvements', column: 'denominator_basis', type: 'text' },
  { table: 'rom_scope_items', column: 'calculation_basis', type: 'text' },
  // AI intake parser bridge: accepted proposals land here, then flow to Step 3 (ITB).
  // This column never existed on rfp_requests — only invitation_to_bid had one.
  // The commit-to-scope write was a silent no-op until this migration.
  { table: 'rfp_requests', column: 'scope_of_work', type: "json DEFAULT '[]'::json" },
  // Allowance Fork (slice 2): pricing path on the RFP + back-link on the ROM.
  { table: 'rfp_requests', column: 'pricing_path', type: "text DEFAULT 'development'" },
  { table: 'rom_pilots', column: 'linked_rfp_id', type: 'integer' },
  // Four-bucket budget report: contract-COUNTERPARTY bucket on the catalog
  // (budget_bucket already exists there with pricing-mechanics semantics).
  // budget_bucket exists in prod's history but not necessarily fresh dev DBs
  // (initializeDefaultScopeItems races the migration on first boot) — additive
  // and idempotent, so declare it here too. (Mirrors the Agent's dev fix.)
  { table: 'rom_scope_items', column: 'budget_bucket', type: 'text' },
  { table: 'rom_scope_items', column: 'contract_bucket', type: 'text' },
  // Fee governance: recorded (not blocked) CM-fee deletions on ROM pilots.
  { table: 'rom_pilots', column: 'cm_fee_removed_by', type: 'text' },
  { table: 'rom_pilots', column: 'cm_fee_removed_at', type: 'timestamp' },
  // Spec Tags (context-aware pricing REFINEMENT): repeatable property-driven
  // tags per catalog item — quantity source + variant match conditions.
  { table: 'rom_scope_items', column: 'spec_tags', type: "json DEFAULT '[]'::json" },
  // Ownership scoping (slice 0b, DESIGN-rom-mode-on-rfp.md): the REAL owner id.
  // rfp_requests never had created_by at all; rom_pilots.created_by is a display
  // name. Backfilled below in runPermissionAndOwnershipBackfill(); NULL after
  // backfill means admin-only (fail closed).
  { table: 'rfp_requests', column: 'created_by_user_id', type: 'varchar' },
  { table: 'rom_pilots', column: 'created_by_user_id', type: 'varchar' },

  // 2026-08-04. Added here rather than via `npm run db:push`: drizzle-kit push
  // reconciles the WHOLE schema, and shared/schema.ts has drifted far enough from
  // the deployed database that a push now proposes dropping the session and
  // sessions tables and converting ~30 column types (including
  // property_existing_improvements.total_cost from numeric to integer, which would
  // truncate cents). See HANDOFF.md 2026-08-04. This path is additive only.
  //
  // It also solves a practical problem: the production Neon database is reachable
  // from Replit only through a READ-ONLY sandbox connection, so DDL cannot be run
  // against it from the shell. Running here means the app applies these columns
  // itself, on boot, using its own production connection.
  { table: 'executed_leases', column: 'lease_type', type: "text DEFAULT 'executed'" },
  { table: 'executed_leases', column: 'electrical_allocation', type: 'integer' },
  { table: 'properties', column: 'electrical_allocation_minimum', type: 'integer DEFAULT 200' },
  // Free-text discipline for project team members whose role is 'other'.
  { table: 'project_team_members', column: 'custom_role', type: 'text' },
  // Team can attach to an executed lease rather than an RFP (2026-08-10).
  { table: 'project_team_members', column: 'lease_id', type: 'integer REFERENCES executed_leases(id) ON DELETE CASCADE' },
  // Tenant performs its own construction: no landlord design team required.
  { table: 'executed_leases', column: 'construction_by_tenant', type: 'boolean DEFAULT false' },
];

// Additive new tables (CREATE TABLE IF NOT EXISTS — idempotent, never drops).
// Same safety as columns: if creation fails, log and continue, never crash boot.
// Constraint relaxations. NOT destructive - dropping NOT NULL loses no data and
// cannot fail against existing rows. Kept separate from ADDITIVE_TABLES so the
// distinction stays visible.
const SAFE_ALTERS: string[] = [
  // project_team_members.rfp_id was NOT NULL. A member attached to an executed
  // lease has no RFP, so the constraint has to go. The API enforces
  // exactly-one-of rfp_id / lease_id in its place.
  `ALTER TABLE project_team_members ALTER COLUMN rfp_id DROP NOT NULL`,
];

const ADDITIVE_TABLES: string[] = [
  // Operational settings (2026-08-17). Key/value so a new switch needs no migration.
  `CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now(),
    updated_by text
  )`,
  // Project team (2026-08-05): who is working on an RFP, in what role. Roles are
  // per-assignment rather than taken from contacts.type, because the same person
  // can be architect on one deal and consultant on another, and a project needs
  // several people in one role. Firm comes from contacts.company.
  `CREATE TABLE IF NOT EXISTS project_team_members (
    id serial PRIMARY KEY,
    rfp_id integer NOT NULL REFERENCES rfp_requests(id) ON DELETE CASCADE,
    contact_id integer NOT NULL REFERENCES contacts(id),
    role text NOT NULL,
    is_primary boolean DEFAULT false,
    role_title text,
    notes text,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS scope_bundles (
    id serial PRIMARY KEY,
    name text NOT NULL,
    description text,
    category text,
    is_active boolean DEFAULT true,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS scope_bundle_items (
    id serial PRIMARY KEY,
    bundle_id integer NOT NULL REFERENCES scope_bundles(id),
    scope_item_id integer NOT NULL REFERENCES rom_scope_items(id),
    default_quantity text,
    notes text,
    sort_order integer DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS scope_inference_rules (
    id serial PRIMARY KEY,
    trigger_type text NOT NULL,
    trigger_value text NOT NULL,
    implied_scope text NOT NULL,
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS intake_proposals (
    id serial PRIMARY KEY,
    rfp_id integer NOT NULL,
    description text NOT NULL,
    catalog_item_id integer,
    match_type text NOT NULL DEFAULT 'needs-mapping',
    confidence text,
    reason text,
    source_ref text,
    status text NOT NULL DEFAULT 'proposed',
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
];

// dbi is injectable for tests (a drizzle handle over any pg driver); production
// callers pass nothing and get the app's own connection.
export async function runStartupMigrations(dbi: any = db): Promise<void> {
  // Additive tables first (columns may target them).
  for (const ddl of ADDITIVE_TABLES) {
    try {
      await dbi.execute(sql.raw(ddl));
    } catch (error) {
      console.warn(`⚠️  Startup table migration skipped:`, (error as Error).message);
    }
  }
  for (const ddl of SAFE_ALTERS) {
    try {
      await dbi.execute(sql.raw(ddl));
    } catch (error) {
      console.warn(`⚠️  Startup constraint relaxation skipped:`, (error as Error).message);
    }
  }
  for (const m of ADDITIVE_COLUMNS) {
    try {
      // Table/column/type are hardcoded constants above (never user input),
      // so building the DDL string here is safe.
      await dbi.execute(
        sql.raw(`ALTER TABLE ${m.table} ADD COLUMN IF NOT EXISTS ${m.column} ${m.type}`)
      );
    } catch (error) {
      // Log and continue — a failed additive migration should not crash boot.
      console.warn(`⚠️  Startup migration skipped for ${m.table}.${m.column}:`, (error as Error).message);
    }
  }
}

/**
 * Slice 0 + 0b backfills (2026-07-21). Idempotent — safe on every boot.
 *
 * PERMISSIONS: checkPermission reads the per-user users.permissions JSON column,
 * NOT ROLE_PERMISSIONS — the role map is only a seed for NEW accounts. Updating
 * the map does nothing for JJ's existing row. So on boot, every active user row
 * is topped up to at least its role's current map (union — never removes a
 * permission an admin granted by hand).
 *
 * OWNERSHIP: adds no rows, only resolves created_by_user_id where NULL by
 * matching display-name text against users:
 *   - rom_pilots.created_by holds "First Last" (or a username) from the fork.
 *   - rfp_requests has NO created_by; sent_by (the "RFP Request" field) is the
 *     closest signal — auto-filled with the logged-in user's display name, but
 *     historically also "Name - Company" contact strings. We strip a
 *     " - Company" suffix and match the remainder. Unmatched rows STAY NULL =
 *     admin-only, per the fail-closed rule.
 * Counts are logged every boot; GET /api/admin/ownership-report shows the same
 * numbers plus the unresolved rows, with a reassign action.
 */
export async function runPermissionAndOwnershipBackfill(dbi: any = db): Promise<void> {
  // ── Permission top-up (LEGACY users only) ──────────────────────────────────
  // Contacts (the real accounts) do NOT use role→permission seeding — their
  // permissions are set explicitly in the admin panel (which now includes the
  // ROM / Pricing & Ownership categories). So JJ gets rfp.create/rom.create by
  // an admin granting them on his CONTACT record, not from this loop. This only
  // tops up any legacy `users` rows to their role baseline (a no-op in prod,
  // where users is empty) and must never invent permissions for contacts.
  try {
    const { ROLE_PERMISSIONS } = await import('@shared/schema');
    const rows: any = await dbi.execute(sql`SELECT id, role, permissions FROM users`);
    const userRows: any[] = rows.rows ?? rows;
    let updated = 0;
    for (const u of userRows) {
      const rolePerms: string[] = (ROLE_PERMISSIONS as any)[u.role] || [];
      const current: string[] = Array.isArray(u.permissions)
        ? u.permissions
        : (typeof u.permissions === 'string' ? JSON.parse(u.permissions || '[]') : []);
      const merged = Array.from(new Set([...current, ...rolePerms]));
      if (merged.length !== current.length) {
        await dbi.execute(
          sql`UPDATE users SET permissions = ${JSON.stringify(merged)}::json, updated_at = NOW() WHERE id = ${u.id}`
        );
        updated++;
      }
    }
    console.log(`[permissions backfill] legacy users: ${userRows.length} checked, ${updated} topped up (contacts manage perms via admin UI)`);
  } catch (error) {
    console.warn('⚠️  Permission backfill skipped:', (error as Error).message);
  }

  // ── Ownership backfill ─────────────────────────────────────────────────────
  // REBUILT for the contacts identity model: accounts are `contacts`, and the
  // owner id we store must equal req.userId, i.e. "contact_<id>". Any legacy
  // `users` rows are included with their bare id for completeness.
  try {
    // Map of normalized name/email → owner-id STRING. Collisions across two
    // accounts drop to null (ambiguous = leave unresolved = admin-only).
    const nameToId = new Map<string, string | null>();
    const claim = (key: string | null | undefined, id: string) => {
      const k = (key || '').trim().toLowerCase();
      if (!k) return;
      if (nameToId.has(k) && nameToId.get(k) !== id) nameToId.set(k, null); // collision
      else nameToId.set(k, id);
    };

    // Read contacts via the drizzle QUERY BUILDER (dbi.select().from(contacts)),
    // the same path the working contacts UI and reassign dropdown use. The prior
    // raw db.execute(sql`SELECT ... FROM contacts`) returned an unexpected shape
    // on the Neon serverless driver, so `rows.rows ?? rows` iterated nothing →
    // empty map → 0/72 resolved. Query-builder path returns a plain array.
    // Project ONLY the columns we use. `select().from(contacts)` would request
    // every column in the drizzle schema, so any column the production table is
    // missing (schema drift — the very thing startup-migrations patches) throws
    // and the whole backfill gets caught/skipped → 0 resolved. Narrow select is
    // drift-proof.
    const { contacts } = await import('@shared/schema');
    const allContacts: any[] = await dbi
      .select({ id: contacts.id, name: contacts.name, email: contacts.email })
      .from(contacts);
    for (const c of allContacts) {
      const ownerId = `contact_${c.id}`;
      claim(c.name, ownerId);   // display name as seen in sent_by / created_by
      claim(c.email, ownerId);  // some records store the login email
    }
    // Legacy users (usually none in prod) — bare id, no prefix.
    try {
      const usersRes: any = await dbi.execute(
        sql`SELECT id, username, first_name, last_name FROM users`
      );
      for (const u of (usersRes.rows ?? usersRes)) {
        claim(`${u.first_name || ''} ${u.last_name || ''}`, u.id);
        claim(u.username, u.id);
      }
    } catch { /* users may not exist */ }

    const resolve = (text: string | null | undefined): string | null => {
      if (!text) return null;
      // "Name - Company" strings: match on the part before " - ".
      const base = text.split(' - ')[0].trim().toLowerCase();
      return nameToId.get(base) ?? nameToId.get(text.trim().toLowerCase()) ?? null;
    };

    for (const t of [
      { table: 'rfp_requests', sourceCol: 'sent_by' },
      { table: 'rom_pilots', sourceCol: 'created_by' },
    ]) {
      const res: any = await dbi.execute(
        sql.raw(`SELECT id, ${t.sourceCol} AS source_text FROM ${t.table} WHERE created_by_user_id IS NULL`)
      );
      const pending: any[] = res.rows ?? res;
      let resolved = 0;
      for (const row of pending) {
        const ownerId = resolve(row.source_text);
        if (ownerId) {
          await dbi.execute(
            sql.raw(`UPDATE ${t.table} SET created_by_user_id = '${ownerId.replace(/'/g, "''")}' WHERE id = ${Number(row.id)}`)
          );
          resolved++;
        }
      }
      const totalRes: any = await dbi.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM ${t.table}`));
      const total = (totalRes.rows ?? totalRes)[0]?.c ?? 0;
      const unresolvedRes: any = await dbi.execute(
        sql.raw(`SELECT COUNT(*)::int AS c FROM ${t.table} WHERE created_by_user_id IS NULL`)
      );
      const unresolved = (unresolvedRes.rows ?? unresolvedRes)[0]?.c ?? 0;
      console.log(
        `[ownership backfill] ${t.table}: ${total} total, ${resolved} newly resolved this boot, ${unresolved} UNRESOLVED (admin-only)`
      );
    }
  } catch (error) {
    console.warn('⚠️  Ownership backfill skipped:', (error as Error).message);
  }
}
