/**
 * Restore a database backup made by server/backup.ts.
 *
 *   DATABASE_URL=postgres://... npx tsx server/scripts/restore-backup.ts <rfptracker-database.json | .json.gz> [--wipe]
 *
 * Start the app against the target database once first, so every table exists.
 * Rows are inserted table by table; a row whose key already exists is skipped,
 * unless --wipe is given, which empties each table in the backup first.
 * Serial ids are moved past the highest restored id afterwards.
 * Files: copy the backup's files/ folder back into Object Storage under uploads/.
 */
import fs from 'fs';
import zlib from 'zlib';
import pg from 'pg';

async function main() {
  const file = process.argv[2];
  const wipe = process.argv.includes('--wipe');
  if (!file || !process.env.DATABASE_URL) {
    console.error('Usage: DATABASE_URL=... npx tsx server/scripts/restore-backup.ts <backup.json|.json.gz> [--wipe]');
    process.exit(1);
  }
  const raw = fs.readFileSync(file);
  const text = (file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8');
  const dump = JSON.parse(text) as { meta: { createdAt: string }; tables: Record<string, any[]> };
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  console.log(`Backup from ${dump.meta.createdAt}: ${Object.keys(dump.tables).length} tables`);
  // Tables refer to each other, so rows that point at something not restored yet wait
  // for the next pass; passes repeat while anything new goes in.
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const types = new Map<string, Map<string, string>>();
  for (const table of Object.keys(dump.tables)) {
    const cols = (await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows;
    if (!cols.length) { console.warn(`  ${table}: not in the target database — skipped`); continue; }
    types.set(table, new Map(cols.map((c: any) => [c.column_name, c.data_type])));
    if (wipe) await pool.query(`TRUNCATE ${q(table)} CASCADE`);
  }
  let pending = Array.from(types.keys()).map((t) => ({ table: t, rows: dump.tables[t] }));
  const done = new Map<string, number>();
  for (let pass = 1; pending.length && pass <= 10; pass++) {
    const next: typeof pending = [];
    let progress = 0;
    for (const { table, rows } of pending) {
      const type = types.get(table)!;
      const waiting: any[] = [];
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => type.has(k));
        const vals = keys.map((k) => (row[k] != null && /json/.test(String(type.get(k))) ? JSON.stringify(row[k]) : row[k]));
        try {
          const r = await pool.query(`INSERT INTO ${q(table)} (${keys.map(q).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING`, vals);
          done.set(table, (done.get(table) ?? 0) + (r.rowCount ?? 0)); progress++;
        } catch (e: any) {
          if (e?.code === '23503') waiting.push(row); // points at a row not restored yet
          else console.warn(`  ${table}: a row was not restored — ${e?.message}`);
        }
      }
      if (waiting.length) next.push({ table, rows: waiting });
    }
    pending = next;
    if (!progress) break;
  }
  for (const [table, type] of Array.from(types)) {
    if (type.has('id')) await pool.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${q(table)}), 1))`, [table]).catch(() => null);
    const left = pending.find((p) => p.table === table)?.rows.length ?? 0;
    console.log(`  ${table}: ${done.get(table) ?? 0} of ${dump.tables[table].length} rows restored${left ? ` (${left} refer to rows that are not in the backup)` : ''}`);
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
