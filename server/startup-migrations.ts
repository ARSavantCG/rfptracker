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
];

// Additive new tables (CREATE TABLE IF NOT EXISTS — idempotent, never drops).
// Same safety as columns: if creation fails, log and continue, never crash boot.
const ADDITIVE_TABLES: string[] = [
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

export async function runStartupMigrations(): Promise<void> {
  // Additive tables first (columns may target them).
  for (const ddl of ADDITIVE_TABLES) {
    try {
      await db.execute(sql.raw(ddl));
    } catch (error) {
      console.warn(`⚠️  Startup table migration skipped:`, (error as Error).message);
    }
  }
  for (const m of ADDITIVE_COLUMNS) {
    try {
      // Table/column/type are hardcoded constants above (never user input),
      // so building the DDL string here is safe.
      await db.execute(
        sql.raw(`ALTER TABLE ${m.table} ADD COLUMN IF NOT EXISTS ${m.column} ${m.type}`)
      );
    } catch (error) {
      // Log and continue — a failed additive migration should not crash boot.
      console.warn(`⚠️  Startup migration skipped for ${m.table}.${m.column}:`, (error as Error).message);
    }
  }
}
