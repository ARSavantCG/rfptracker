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
  // Archiving as a timestamp rather than a status, so a cancelled RFP can be
  // archived and stay cancelled. See the column comment in shared/schema.ts.
  { table: 'rfp_requests', column: 'archived_at', type: 'timestamp' },
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
  // Per-owner notification opt-out (2026-08-17). Default true so existing owners
  // keep receiving alerts.
  { table: 'contacts', column: 'receives_notifications', type: 'boolean DEFAULT true' },
  // Who hit publish (2026-08-19). Distinct from sent_by, the inbound broker.
  { table: 'rfp_requests', column: 'published_by', type: 'text' },
  // Route: development | rom_pilot | allowance (2026-08-19).
  { table: 'rfp_requests', column: 'track_type', type: "text DEFAULT 'development'" },
  // Custom assemblies on the evaluation budget (2026-08-19).
  { table: 'evaluation_budgets', column: 'custom_assemblies', type: "json DEFAULT '[]'::json" },
  // Team can attach to an executed lease rather than an RFP (2026-08-10).
  { table: 'project_team_members', column: 'lease_id', type: 'integer REFERENCES executed_leases(id) ON DELETE CASCADE' },
  // Tenant performs its own construction: no landlord design team required.
  { table: 'executed_leases', column: 'construction_by_tenant', type: 'boolean DEFAULT false' },
  // Suite number for the demised premises (2026-10-19). An OVERRIDE: suites
  // normally come from the bays the lease holds. The Project Team Directory
  // selected executed_leases.suite_number for two months before the column
  // existed, and threw on every request as a result.
  { table: 'executed_leases', column: 'suite_number', type: 'text' },
  // Budget confirmation against the LAF, and CM fee settings (2026-10-20).
  // cost_projects shipped earlier the same day without them.
  { table: 'cost_projects', column: 'budget_approval', type: "json NOT NULL DEFAULT '{}'::json" },
  { table: 'cost_projects', column: 'settings', type: "json NOT NULL DEFAULT '{}'::json" },
  // Job cost ledger (2026-10-20): reconciliation and receipts.
  { table: 'cost_payments', column: 'method', type: 'text' },
  { table: 'cost_payments', column: 'reconciled', type: 'boolean NOT NULL DEFAULT false' },
  { table: 'cost_documents', column: 'direct_cost_id', type: 'integer' },
  // Pay app packages (2026-10-20).
  { table: 'cost_documents', column: 'doc_type', type: 'text' },
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
  // Cost tracking (2026-10-20): budget vs actual on a job being built. Shapes
  // mirror shared/schema.ts exactly; money in bigint cents. No foreign keys —
  // a constraint that fails against an existing row would stop the boot.
  `CREATE TABLE IF NOT EXISTS cost_projects (
    id serial PRIMARY KEY,
    project_number text NOT NULL,
    name text NOT NULL,
    rfp_id integer,
    property_id integer,
    tenant_name text,
    status text NOT NULL DEFAULT 'active',
    baseline json NOT NULL DEFAULT '[]'::json,
    notes text,
    budget_approval json NOT NULL DEFAULT '{}'::json,
    settings json NOT NULL DEFAULT '{}'::json,
    created_by text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cost_contracts (
    id serial PRIMARY KEY,
    project_id integer NOT NULL,
    counterparty text NOT NULL,
    bucket text NOT NULL DEFAULT 'contractor',
    contract_number text,
    retainage_bp integer NOT NULL DEFAULT 1000,
    notes text,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cost_change_orders (
    id serial PRIMARY KEY,
    contract_id integer NOT NULL,
    number text NOT NULL,
    title text,
    status text NOT NULL DEFAULT 'pending',
    approved_date timestamp,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cost_sov_lines (
    id serial PRIMARY KEY,
    contract_id integer NOT NULL,
    change_order_id integer,
    item_no text,
    code text,
    description text NOT NULL,
    scheduled_value_cents bigint NOT NULL DEFAULT 0,
    allocation_mode text NOT NULL DEFAULT 'unallocated',
    allocations json NOT NULL DEFAULT '[]'::json,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cost_applications (
    id serial PRIMARY KEY,
    contract_id integer NOT NULL,
    number integer NOT NULL,
    kind text NOT NULL DEFAULT 'pay_app',
    invoice_number text,
    period_start timestamp,
    period_end timestamp,
    notes text,
    created_by text,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cost_application_lines (
    id serial PRIMARY KEY,
    application_id integer NOT NULL,
    sov_line_id integer NOT NULL,
    work_this_period_cents bigint NOT NULL DEFAULT 0,
    stored_to_date_cents bigint NOT NULL DEFAULT 0,
    retainage_to_date_cents bigint NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS cost_payments (
    id serial PRIMARY KEY,
    contract_id integer NOT NULL,
    application_id integer,
    amount_cents bigint NOT NULL,
    paid_date timestamp NOT NULL,
    reference text,
    method text,
    reconciled boolean NOT NULL DEFAULT false,
    notes text,
    created_by text,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cost_direct_costs (
    id serial PRIMARY KEY,
    project_id integer NOT NULL,
    date timestamp NOT NULL,
    vendor text NOT NULL,
    description text NOT NULL DEFAULT '',
    amount_cents bigint NOT NULL,
    method text,
    reference text,
    baseline_key text,
    reconciled boolean NOT NULL DEFAULT false,
    notes text,
    created_by text,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cost_waivers (
    id serial PRIMARY KEY,
    project_id integer NOT NULL,
    contract_id integer NOT NULL,
    application_id integer NOT NULL,
    kind text NOT NULL,
    vendor text NOT NULL,
    amount_cents bigint NOT NULL DEFAULT 0,
    from_waiver_id integer,
    received boolean NOT NULL DEFAULT false,
    not_needed boolean NOT NULL DEFAULT false,
    document_id integer,
    notes text,
    created_by text,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cost_documents (
    id serial PRIMARY KEY,
    project_id integer NOT NULL,
    application_id integer,
    contract_id integer,
    change_order_id integer,
    direct_cost_id integer,
    doc_type text,
    original_name text NOT NULL,
    mime_type text,
    size_bytes integer,
    storage_key text NOT NULL,
    storage text NOT NULL DEFAULT 'object',
    uploaded_by text,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  // Who the invitation to bid went to, and whether it arrived (2026-10-20).
  // No FK to contacts: an address can be typed for someone not in the
  // directory, and deleting a contact must not erase the record of a send.
  `CREATE TABLE IF NOT EXISTS itb_sends (
    id serial PRIMARY KEY,
    rfp_id integer NOT NULL,
    contact_id integer,
    recipient_email text NOT NULL,
    recipient_name text,
    recipient_company text,
    recipient_type text NOT NULL DEFAULT 'contractor',
    subject text,
    status text NOT NULL DEFAULT 'sent',
    error text,
    sent_by text,
    sent_at timestamp NOT NULL DEFAULT now()
  )`,
  // Password reset tokens (2026-08-20). Hash stored, never the token.
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id serial PRIMARY KEY,
    user_id varchar NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp NOT NULL,
    used_at timestamp,
    requested_ip text,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  // Operational settings (2026-08-17). Key/value so a new switch needs no migration.
  // Column names quoted defensively. NOTE: key and value are NON-reserved in
  // Postgres, so the unquoted form parses fine - I initially blamed this and was
  // wrong. Quoting costs nothing and removes the question permanently.
  `CREATE TABLE IF NOT EXISTS app_settings (
    "key" text PRIMARY KEY,
    "value" text NOT NULL,
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
  // Per-user pinned reports (2026-10-16).
  //
  // user_id is TEXT and has NO foreign key, deliberately. Contacts sign in
  // alongside system users and arrive as "contact_12", which is not a row in
  // users — an integer column or an FK to users would have silently excluded
  // every contact, who are most of the people this is meant to reach.
  //
  // params holds the report's SCOPE ({"property":"Kurv Doral II"}), never a
  // built URL, so shared/report-catalog can rebuild the link, drop parameters a
  // report no longer declares, and flag a pin whose property was deleted.
  `CREATE TABLE IF NOT EXISTS user_report_pins (
    id serial PRIMARY KEY,
    user_id text NOT NULL,
    report_key text NOT NULL,
    params json DEFAULT '{}'::json,
    position integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
];

// Indexes for the tables above. Separate from ADDITIVE_TABLES because CREATE
// TABLE IF NOT EXISTS skips its whole body on a table that already exists, so an
// index added to an existing table's definition would never be created.
const ADDITIVE_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS user_report_pins_user_idx ON user_report_pins (user_id)`,
  // The send log is always read for one RFP at a time.
  `CREATE INDEX IF NOT EXISTS itb_sends_rfp_idx ON itb_sends (rfp_id)`,
  `CREATE INDEX IF NOT EXISTS cost_projects_rfp_idx ON cost_projects (rfp_id)`,
  `CREATE INDEX IF NOT EXISTS cost_contracts_project_idx ON cost_contracts (project_id)`,
  `CREATE INDEX IF NOT EXISTS cost_change_orders_contract_idx ON cost_change_orders (contract_id)`,
  `CREATE INDEX IF NOT EXISTS cost_sov_lines_contract_idx ON cost_sov_lines (contract_id)`,
  `CREATE INDEX IF NOT EXISTS cost_applications_contract_idx ON cost_applications (contract_id)`,
  `CREATE INDEX IF NOT EXISTS cost_application_lines_app_idx ON cost_application_lines (application_id)`,
  `CREATE INDEX IF NOT EXISTS cost_documents_project_idx ON cost_documents (project_id)`,
  `CREATE INDEX IF NOT EXISTS cost_payments_contract_idx ON cost_payments (contract_id)`,
  `CREATE INDEX IF NOT EXISTS cost_direct_costs_project_idx ON cost_direct_costs (project_id)`,
  `CREATE INDEX IF NOT EXISTS cost_waivers_application_idx ON cost_waivers (application_id)`,
  // One line per SOV line per application: entering a pay app twice must
  // replace, never double, what it says was done.
  `CREATE UNIQUE INDEX IF NOT EXISTS cost_application_lines_unique ON cost_application_lines (application_id, sov_line_id)`,
  // Two applications with the same number on one contract would make
  // "previous certificates" ambiguous.
  `CREATE UNIQUE INDEX IF NOT EXISTS cost_applications_number_unique ON cost_applications (contract_id, number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cost_projects_number_unique ON cost_projects (project_number)`,
];

// dbi is injectable for tests (a drizzle handle over any pg driver); production
// callers pass nothing and get the app's own connection.
export async function runStartupMigrations(dbi: any = db): Promise<void> {
  // Additive tables first (columns may target them).
  for (const ddl of ADDITIVE_TABLES) {
    try {
      await dbi.execute(sql.raw(ddl));
    } catch (error) {
      // LOUD. These are CREATE TABLE IF NOT EXISTS statements: they are
      // idempotent and should never fail. A failure means the DDL itself is
      // wrong, and the table simply will not exist - every read of it then 500s
      // at runtime, far from the cause. A quiet console.warn hid exactly that
      // for app_settings (unquoted reserved words) until the endpoint failed.
      const first = ddl.trim().split('\n')[0];
      console.error(`❌ STARTUP TABLE MIGRATION FAILED — the table does not exist.`);
      console.error(`   ${first}`);
      console.error(`   ${(error as Error).message}`);
    }
  }
  // Indexes come after the tables, since an index needs its table to exist.
  // Failures are warnings, not errors: a missing index costs speed on a table
  // holding a handful of rows per person, where a missing TABLE costs a 500.
  for (const ddl of ADDITIVE_INDEXES) {
    try {
      await dbi.execute(sql.raw(ddl));
    } catch (error) {
      console.warn(`⚠️  Startup index skipped:`, (error as Error).message);
    }
  }

  // Verify the tables the loop was supposed to create actually exist. A
  // CREATE TABLE IF NOT EXISTS that fails leaves NO trace at runtime except a
  // 500 from whatever reads it later, so this states the outcome directly at
  // boot rather than leaving it to be discovered from a stack frame.
  for (const name of [
    'app_settings', 'project_team_members', 'user_report_pins', 'itb_sends',
    'cost_projects', 'cost_contracts', 'cost_change_orders', 'cost_sov_lines',
    'cost_applications', 'cost_application_lines', 'cost_documents', 'cost_payments', 'cost_direct_costs', 'cost_waivers',
  ]) {
    try {
      await dbi.execute(sql.raw(`SELECT 1 FROM ${name} LIMIT 1`));
      console.log(`✅ table ${name} present`);
    } catch (error) {
      console.error(`❌ TABLE ${name} IS MISSING — every read of it will 500.`);
      console.error(`   ${(error as Error).message}`);
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
