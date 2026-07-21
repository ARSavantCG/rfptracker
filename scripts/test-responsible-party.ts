/**
 * Live gate for the Responsible Party column (2026-07-21).
 * Reproduces the exact derivation used in GET /api/rfp-requests against a real
 * Postgres, across every combination of pricingPath / createdByUserId /
 * developmentContact / sentBy that exists in production data.
 *
 * Run: TEST_DATABASE_URL=postgres://... npx tsx scripts/test-responsible-party.ts
 */
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
let failures = 0;
function check(name: string, cond: boolean, detail?: any) {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`, detail ?? ''); }
}

async function main() {
  await pool.query(`
    DROP TABLE IF EXISTS users, rfp_requests CASCADE;
    CREATE TABLE users (
      id varchar PRIMARY KEY, username varchar, first_name varchar, last_name varchar
    );
    CREATE TABLE rfp_requests (
      id serial PRIMARY KEY, rfp_number text, sent_by text,
      pricing_path text DEFAULT 'development',
      created_by_user_id varchar, development_contact text
    );
    INSERT INTO users VALUES
      ('u-jj', 'jj', 'JJ', 'Leasing'),
      ('u-nouser', 'shortname', NULL, NULL);
    INSERT INTO rfp_requests (rfp_number, sent_by, pricing_path, created_by_user_id, development_contact) VALUES
      ('R1', 'JJ Leasing',      'rom_pilot',   'u-jj',     NULL),
      ('R2', 'Jane Broker',     'rom_pilot',   NULL,       NULL),
      ('R3', 'Adolfo R',        'development', 'u-jj',     'Brenda Gonzalez'),
      ('R4', 'Adolfo R',        'development', 'u-jj',     NULL),
      ('R5', 'Someone',         'rom_pilot',   'u-nouser', NULL),
      ('R6', 'Legacy',          NULL,          NULL,       'Andrew Hurwitz');
  `);

  // ── Mirror of the server derivation ──
  const users = (await pool.query('SELECT * FROM users')).rows;
  const ownerNameById = new Map<string, string>();
  for (const u of users) {
    const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    ownerNameById.set(u.id, full || u.username);
  }
  const rows = (await pool.query('SELECT * FROM rfp_requests ORDER BY id')).rows;
  const derived = Object.fromEntries(rows.map((r: any) => {
    const isRom = r.pricing_path === 'rom_pilot';
    const ownerName = r.created_by_user_id ? ownerNameById.get(r.created_by_user_id) : undefined;
    return [r.rfp_number, {
      type: isRom ? 'rom' : 'development',
      name: isRom ? (ownerName || r.sent_by || null) : (r.development_contact || null),
    }];
  }));

  console.log('\n── Responsible party derivation ──');
  check('R1 ROM + owner → ROM / JJ Leasing',
    derived.R1.type === 'rom' && derived.R1.name === 'JJ Leasing', derived.R1);
  check('R2 ROM, no owner → falls back to sentBy text',
    derived.R2.type === 'rom' && derived.R2.name === 'Jane Broker', derived.R2);
  check('R3 dev route → shows developmentContact, NOT the creator',
    derived.R3.type === 'development' && derived.R3.name === 'Brenda Gonzalez', derived.R3);
  check('R4 dev route, no contact → null (renders "Unassigned")',
    derived.R4.type === 'development' && derived.R4.name === null, derived.R4);
  check('R5 ROM, owner has no first/last → username fallback',
    derived.R5.name === 'shortname', derived.R5);
  check('R6 NULL pricing_path → treated as development (legacy rows)',
    derived.R6.type === 'development' && derived.R6.name === 'Andrew Hurwitz', derived.R6);
  check('No row produced an undefined name field',
    Object.values(derived).every((d: any) => d.name === null || typeof d.name === 'string'), derived);

  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
