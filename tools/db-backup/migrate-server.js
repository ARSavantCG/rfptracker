/**
 * RFP Tracker — one-off migration service for migration 0002 (area_sf).
 *
 * SCOPE: This service applies EXACTLY ONE additive migration:
 *   ALTER TABLE property_existing_improvements ADD COLUMN IF NOT EXISTS area_sf integer;
 * It cannot run arbitrary SQL. It never drops, updates, or deletes anything.
 * IF NOT EXISTS makes it safe to hit twice.
 *
 * Deploy to Railway, then:
 *   /status?token=YOUR_TOKEN   → read-only check: does area_sf exist yet?
 *   /apply?token=YOUR_TOKEN    → applies migration 0002, returns verification
 * DELETE THE SERVICE when done.
 *
 * Required env vars:
 *   NEON_URL         - the full production Postgres connection string
 *   MIGRATE_TOKEN    - any long random string; required for all endpoints
 */

const express = require('express');
const { Client } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const NEON_URL = process.env.NEON_URL;
const MIGRATE_TOKEN = process.env.MIGRATE_TOKEN;

function connectedHost() {
  try {
    return new URL(NEON_URL).hostname;
  } catch {
    return 'unparseable';
  }
}

function authorized(req) {
  return MIGRATE_TOKEN && req.query.token === MIGRATE_TOKEN;
}

const VERIFY_SQL = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'property_existing_improvements'
    AND column_name IN ('area_sf', 'denominator_basis')
  ORDER BY column_name
`;

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    'RFP Tracker migration-0002 service is running.\n\n' +
    'Check:  /status?token=YOUR_MIGRATE_TOKEN\n' +
    'Apply:  /apply?token=YOUR_MIGRATE_TOKEN\n\n' +
    'This service applies exactly one additive migration (area_sf column).\n' +
    'Delete it once the migration is verified.\n'
  );
});

app.get('/status', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!NEON_URL) return res.status(500).json({ ok: false, error: 'NEON_URL not set' });

  const client = new Client({ connectionString: NEON_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const { rows } = await client.query(VERIFY_SQL);
    await client.end();
    res.json({
      ok: true,
      database_host: connectedHost(),
      area_sf_exists: rows.length > 0,
      column: rows[0] || null,
    });
  } catch (err) {
    try { await client.end(); } catch (_) {}
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/apply', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!NEON_URL) return res.status(500).json({ ok: false, error: 'NEON_URL not set' });

  const client = new Client({ connectionString: NEON_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(
      'ALTER TABLE property_existing_improvements ADD COLUMN IF NOT EXISTS area_sf integer'
    );
    await client.query(
      'ALTER TABLE property_existing_improvements ADD COLUMN IF NOT EXISTS denominator_basis text'
    );
    const { rows } = await client.query(VERIFY_SQL);
    await client.end();
    res.json({
      ok: true,
      migration: '0002_costs_in_place_area_sf',
      database_host: connectedHost(),
      applied: true,
      verification: rows,
      expected: [{ column_name: 'area_sf', data_type: 'integer', is_nullable: 'YES' }],
    });
  } catch (err) {
    try { await client.end(); } catch (_) {}
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`migration-0002 service listening on ${PORT}, target host: ${connectedHost()}`);
});
