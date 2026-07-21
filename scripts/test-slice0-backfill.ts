/**
 * Live gate for slice 0/0b startup migration + backfill (NOT narration):
 * seeds a real Postgres with PRE-migration tables and mixed-quality data, runs
 * the actual runStartupMigrations + runPermissionAndOwnershipBackfill, then
 * asserts the resulting rows with raw SELECTs.
 *
 * Run: DATABASE_URL=postgres://... npx tsx scripts/test-slice0-backfill.ts
 * (DATABASE_URL must be set to SOMETHING for server/db.ts to import; the test
 * itself uses TEST_DATABASE_URL via node-postgres.)
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import { runStartupMigrations, runPermissionAndOwnershipBackfill } from '../server/startup-migrations';

const url = process.env.TEST_DATABASE_URL!;
const pool = new Pool({ connectionString: url });
const dbi = drizzle(pool);

let failures = 0;
function check(name: string, cond: boolean, detail?: any) {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`, detail ?? ''); }
}

async function q(text: string): Promise<any[]> {
  const r = await pool.query(text);
  return r.rows;
}

async function main() {
  // ── Seed PRE-migration schema (only the tables the backfill touches, in
  //    their BEFORE state: no created_by_user_id anywhere, rfp_requests has
  //    sent_by but no created_by — matching production reality) ─────────────
  await pool.query(`
    DROP TABLE IF EXISTS users, rfp_requests, rom_pilots CASCADE;
    CREATE TABLE users (
      id varchar PRIMARY KEY, username varchar UNIQUE NOT NULL,
      first_name varchar, last_name varchar,
      role varchar NOT NULL DEFAULT 'user',
      permissions json DEFAULT '[]', is_active boolean DEFAULT true,
      updated_at timestamp DEFAULT now()
    );
    CREATE TABLE rfp_requests (
      id serial PRIMARY KEY, rfp_number text NOT NULL,
      project_name text NOT NULL, sent_by text NOT NULL
    );
    CREATE TABLE rom_pilots (
      id serial PRIMARY KEY, rom_number text,
      project_name text NOT NULL, created_by text
    );
    INSERT INTO users (id, username, first_name, last_name, role, permissions) VALUES
      ('u-adolfo', 'adolfo', 'Adolfo', 'Reutlinger', 'admin', '["admin.access","rfp.view"]'),
      ('u-jj',     'jj',     'JJ',     'Leasing',    'user',  '["rfp.view","properties.view","contacts.view","reports.view","rom.view"]'),
      ('u-brenda', 'brenda', 'Brenda', 'Gonzalez',   'manager','["rfp.create","rfp.edit","rfp.view"]'),
      -- name collision pair: two users both displaying as "Sam Smith"
      ('u-sam1',   'sam1',   'Sam',    'Smith',      'user',  '[]'),
      ('u-sam2',   'sam2',   'Sam',    'Smith',      'user',  '[]');
    INSERT INTO rfp_requests (rfp_number, project_name, sent_by) VALUES
      ('RFP-1', 'Match by display name',      'Adolfo Reutlinger'),
      ('RFP-2', 'Match with company suffix',  'JJ Leasing - Savant CG'),
      ('RFP-3', 'Broker string, no match',    'Jane Broker - CBRE'),
      ('RFP-4', 'Ambiguous name collision',   'Sam Smith'),
      ('RFP-5', 'Match by username',          'brenda');
    INSERT INTO rom_pilots (rom_number, project_name, created_by) VALUES
      ('ROM-1', 'Owned pilot',   'JJ Leasing'),
      ('ROM-2', 'Null creator',  NULL),
      ('ROM-3', 'Unknown text',  'Francis Roura');
  `);

  // ── Run the real functions ────────────────────────────────────────────────
  await runStartupMigrations(dbi);
  await runPermissionAndOwnershipBackfill(dbi);

  console.log('\n── Column migration ──');
  const cols = await q(`SELECT table_name, column_name FROM information_schema.columns
    WHERE column_name = 'created_by_user_id' AND table_name IN ('rfp_requests','rom_pilots')`);
  check('created_by_user_id exists on rfp_requests', cols.some(c => c.table_name === 'rfp_requests'));
  check('created_by_user_id exists on rom_pilots', cols.some(c => c.table_name === 'rom_pilots'));

  console.log('\n── Permission top-up (checkPermission reads users.permissions) ──');
  const jj = (await q(`SELECT permissions FROM users WHERE id = 'u-jj'`))[0].permissions;
  check("JJ gained rfp.create", jj.includes('rfp.create'), jj);
  check("JJ gained rfp.edit", jj.includes('rfp.edit'), jj);
  check("JJ gained rom.create + rom.edit", jj.includes('rom.create') && jj.includes('rom.edit'), jj);
  check("JJ did NOT gain pricing.edit", !jj.includes('pricing.edit'), jj);
  check("JJ did NOT gain records.editAny", !jj.includes('records.editAny'), jj);
  const brenda = (await q(`SELECT permissions FROM users WHERE id = 'u-brenda'`))[0].permissions;
  check('Manager gained pricing.edit', brenda.includes('pricing.edit'), brenda);
  check('Manager kept hand-set perms + gained role baseline (rom.edit)', brenda.includes('rom.edit'), brenda);
  check('Manager did NOT gain records.editAny', !brenda.includes('records.editAny'), brenda);
  const adolfo = (await q(`SELECT permissions FROM users WHERE id = 'u-adolfo'`))[0].permissions;
  check('Admin gained pricing.edit + records.editAny', adolfo.includes('pricing.edit') && adolfo.includes('records.editAny'), adolfo);
  check('Admin kept pre-existing perms (union, no removal)', adolfo.includes('rfp.view'), adolfo);

  console.log('\n── Ownership backfill ──');
  const rfps = await q(`SELECT rfp_number, created_by_user_id FROM rfp_requests ORDER BY id`);
  const byNum = Object.fromEntries(rfps.map(r => [r.rfp_number, r.created_by_user_id]));
  check('RFP-1 display-name match → u-adolfo', byNum['RFP-1'] === 'u-adolfo', byNum);
  check('RFP-2 "Name - Company" suffix stripped → u-jj', byNum['RFP-2'] === 'u-jj', byNum);
  check('RFP-3 broker string stays NULL (fail closed)', byNum['RFP-3'] === null, byNum);
  check('RFP-4 ambiguous collision stays NULL (fail closed)', byNum['RFP-4'] === null, byNum);
  check('RFP-5 username match → u-brenda', byNum['RFP-5'] === 'u-brenda', byNum);
  const roms = await q(`SELECT rom_number, created_by_user_id FROM rom_pilots ORDER BY id`);
  const byRom = Object.fromEntries(roms.map(r => [r.rom_number, r.created_by_user_id]));
  check('ROM-1 created_by match → u-jj', byRom['ROM-1'] === 'u-jj', byRom);
  check('ROM-2 NULL creator stays NULL', byRom['ROM-2'] === null, byRom);
  check('ROM-3 offboarded user stays NULL (fail closed)', byRom['ROM-3'] === null, byRom);

  console.log('\n── Idempotency (second boot changes nothing) ──');
  await runStartupMigrations(dbi);
  await runPermissionAndOwnershipBackfill(dbi);
  const jj2 = (await q(`SELECT permissions FROM users WHERE id = 'u-jj'`))[0].permissions;
  check('JJ permission count stable on re-run', jj2.length === jj.length, { before: jj.length, after: jj2.length });
  const rfps2 = await q(`SELECT rfp_number, created_by_user_id FROM rfp_requests ORDER BY id`);
  check('Ownership unchanged on re-run', JSON.stringify(rfps2) === JSON.stringify(rfps));

  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
