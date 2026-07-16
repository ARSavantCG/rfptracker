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
];

export async function runStartupMigrations(): Promise<void> {
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
