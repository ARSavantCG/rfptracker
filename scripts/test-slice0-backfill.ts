/**
 * Live gate for slice 0/0b — CONTACTS identity model (rebuilt 2026-07-21).
 * Seeds a real Postgres the way production actually looks: accounts in
 * `contacts` (empty `users` table), RFP/ROM rows referencing contacts by name/
 * email, then runs the REAL migration + backfill and asserts owners resolve to
 * "contact_<id>" strings that will match req.userId.
 *
 * Run: TEST_DATABASE_URL=postgres://... DATABASE_URL=$TEST_DATABASE_URL npx tsx scripts/test-slice0-backfill.ts
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import { runStartupMigrations, runPermissionAndOwnershipBackfill } from '../server/startup-migrations';

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
const dbi = drizzle(pool);
let failures = 0;
const check = (n: string, c: boolean, d?: any) => {
  if (c) console.log(`  PASS  ${n}`); else { failures++; console.error(`  FAIL  ${n}`, d ?? ''); }
};
const q = async (t: string) => (await pool.query(t)).rows;

async function main() {
  await pool.query(`
    DROP TABLE IF EXISTS users, contacts, rfp_requests, rom_pilots CASCADE;
    -- users exists but is EMPTY, exactly like production
    CREATE TABLE users (
      id varchar PRIMARY KEY, username varchar, first_name varchar,
      last_name varchar, role varchar DEFAULT 'user', permissions json DEFAULT '[]',
      is_active boolean DEFAULT true, updated_at timestamp DEFAULT now()
    );
    CREATE TABLE contacts (
      id serial PRIMARY KEY, name text NOT NULL, email text NOT NULL,
      company text, is_active boolean DEFAULT true, permissions json DEFAULT '[]'
    );
    CREATE TABLE rfp_requests (
      id serial PRIMARY KEY, rfp_number text NOT NULL,
      project_name text NOT NULL, sent_by text NOT NULL
    );
    CREATE TABLE rom_pilots (
      id serial PRIMARY KEY, rom_number text, project_name text NOT NULL, created_by text
    );
    INSERT INTO contacts (name, email, company, permissions) VALUES
      ('Adolfo Reutlinger', 'areutlinger@bridgeindustrial.com', 'Bridge', '["admin.access"]'),
      ('JJ Leasing',        'jj@bridgeindustrial.com',          'Bridge', '["rfp.view","rfp.create","rom.create"]'),
      ('Brenda Gonzalez',   'brenda@bridgeindustrial.com',      'Bridge', '["rfp.create","rfp.edit","pricing.edit"]');
    INSERT INTO rfp_requests (rfp_number, project_name, sent_by) VALUES
      ('RFP-1', 'By display name',       'JJ Leasing'),
      ('RFP-2', 'By email',              'brenda@bridgeindustrial.com'),
      ('RFP-3', 'Name - Company suffix', 'Adolfo Reutlinger - Bridge Industrial'),
      ('RFP-4', 'Unknown broker',        'Someone External - CBRE');
    INSERT INTO rom_pilots (rom_number, project_name, created_by) VALUES
      ('ROM-1', 'By contact name', 'JJ Leasing'),
      ('ROM-2', 'Null creator',    NULL);
  `);

  await runStartupMigrations(dbi);
  await runPermissionAndOwnershipBackfill(dbi);

  console.log('\n── Columns ──');
  const cols = await q(`SELECT table_name FROM information_schema.columns
    WHERE column_name='created_by_user_id' AND table_name IN ('rfp_requests','rom_pilots')`);
  check('created_by_user_id on rfp_requests', cols.some(c => c.table_name === 'rfp_requests'));
  check('created_by_user_id on rom_pilots', cols.some(c => c.table_name === 'rom_pilots'));

  console.log('\n── Ownership resolves to contact_<id> ──');
  const jj = (await q(`SELECT id FROM contacts WHERE email='jj@bridgeindustrial.com'`))[0].id;
  const brenda = (await q(`SELECT id FROM contacts WHERE email='brenda@bridgeindustrial.com'`))[0].id;
  const adolfo = (await q(`SELECT id FROM contacts WHERE email='areutlinger@bridgeindustrial.com'`))[0].id;
  const rfps = Object.fromEntries((await q(`SELECT rfp_number, created_by_user_id FROM rfp_requests ORDER BY id`))
    .map((r: any) => [r.rfp_number, r.created_by_user_id]));
  check('RFP-1 name → contact_JJ', rfps['RFP-1'] === `contact_${jj}`, rfps);
  check('RFP-2 email → contact_Brenda', rfps['RFP-2'] === `contact_${brenda}`, rfps);
  check('RFP-3 "Name - Company" strip → contact_Adolfo', rfps['RFP-3'] === `contact_${adolfo}`, rfps);
  check('RFP-4 unknown → NULL (fail closed)', rfps['RFP-4'] === null, rfps);
  const roms = Object.fromEntries((await q(`SELECT rom_number, created_by_user_id FROM rom_pilots ORDER BY id`))
    .map((r: any) => [r.rom_number, r.created_by_user_id]));
  check('ROM-1 name → contact_JJ', roms['ROM-1'] === `contact_${jj}`, roms);
  check('ROM-2 null → NULL', roms['ROM-2'] === null, roms);

  console.log('\n── The stored id matches what auth produces ──');
  // resolveUserFromToken sets req.userId = "contact_<id>" for a contact login.
  check('Owner string is directly comparable to req.userId', rfps['RFP-1'] === `contact_${jj}`);

  console.log('\n── Legacy users top-up is a no-op on empty prod-like users ──');
  const uCount = (await q(`SELECT COUNT(*)::int c FROM users`))[0].c;
  check('users table empty (prod-like), backfill did not error', uCount === 0);

  console.log('\n── Idempotent ──');
  await runStartupMigrations(dbi);
  await runPermissionAndOwnershipBackfill(dbi);
  const rfps2 = Object.fromEntries((await q(`SELECT rfp_number, created_by_user_id FROM rfp_requests ORDER BY id`))
    .map((r: any) => [r.rfp_number, r.created_by_user_id]));
  check('Ownership unchanged on re-run', JSON.stringify(rfps2) === JSON.stringify(rfps));

  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
