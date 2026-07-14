/**
 * RFP Tracker — one-off production database backup service.
 *
 * SAFETY: This service is strictly READ-ONLY. It issues SELECT statements only.
 * It never writes, alters, or drops anything.
 *
 * Deploy to Railway, hit /backup?token=YOUR_TOKEN, download the JSON.
 * DELETE THE SERVICE when the backup is safely stored.
 *
 * Required env vars:
 *   NEON_URL      - the full production Postgres connection string
 *   BACKUP_TOKEN  - any long random string; required to access /backup
 */

const express = require('express');
const { Client } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const NEON_URL = process.env.NEON_URL;
const BACKUP_TOKEN = process.env.BACKUP_TOKEN;

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    'RFP Tracker DB backup service is running.\n\n' +
    'Usage:  /backup?token=YOUR_BACKUP_TOKEN\n' +
    'Health: /health\n\n' +
    'This service is READ-ONLY. Delete it once your backup is saved.\n'
  );
});

app.get('/health', async (_req, res) => {
  if (!NEON_URL) return res.status(500).json({ ok: false, error: 'NEON_URL not set' });
  if (!BACKUP_TOKEN) return res.status(500).json({ ok: false, error: 'BACKUP_TOKEN not set' });

  const client = new Client({
    connectionString: NEON_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    await client.end();
    res.json({
      ok: true,
      connected: true,
      tableCount: rows.length,
      tables: rows.map(r => r.table_name),
    });
  } catch (err) {
    try { await client.end(); } catch (_) {}
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/backup', async (req, res) => {
  if (!BACKUP_TOKEN || req.query.token !== BACKUP_TOKEN) {
    return res.status(403).type('text/plain').send('Forbidden: bad or missing ?token=');
  }
  if (!NEON_URL) {
    return res.status(500).type('text/plain').send('NEON_URL env var is not set.');
  }

  const client = new Client({
    connectionString: NEON_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Discover every table in the public schema.
    const { rows: tableRows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );

    const dump = {
      _meta: {
        generatedAt: new Date().toISOString(),
        source: 'production Neon database',
        note: 'Logical data backup. Schema lives in shared/schema.ts in the repo. Read-only SELECT dump.',
        tableCount: tableRows.length,
      },
      tables: {},
      rowCounts: {},
    };

    for (const { table_name } of tableRows) {
      // Identifier is quoted; table names come from information_schema, not user input.
      const { rows } = await client.query(`SELECT * FROM "${table_name}"`);
      dump.tables[table_name] = rows;
      dump.rowCounts[table_name] = rows.length;
    }

    await client.end();

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="rfptracker-backup-${stamp}.json"`
    );
    res.send(JSON.stringify(dump, null, 2));
  } catch (err) {
    try { await client.end(); } catch (_) {}
    res.status(500).type('text/plain').send('Backup failed: ' + String(err.message || err));
  }
});

app.listen(PORT, () => {
  console.log(`DB backup service listening on ${PORT}`);
});
