/**
 * Backups: the whole app, database and every stored file.
 *
 *  1. Download Full Backup — a zip streamed to the browser: every table as JSON
 *     plus every file in Object Storage. Works with no setup.
 *  2. Automatic backup to Google Drive — once an admin connects a Drive account:
 *     a database snapshot each day (newest 30 kept, plus the first of each month
 *     for two years) and every stored file copied once, mirrored by folder.
 *
 * WHY "catch-up" instead of a fixed hour: production runs on Replit Autoscale,
 * which sleeps when nobody is using the app, so a 2 AM timer would never fire.
 * Instead every awake instance checks every 30 minutes and runs when the last
 * good backup is more than ~a day old. A lease row in app_settings keeps two
 * instances from running at once. File copying resumes where it stopped, so an
 * instance going to sleep mid-run loses nothing.
 *
 * Google endpoints can be pointed elsewhere (GOOGLE_OAUTH_BASE / GOOGLE_API_BASE)
 * only so the flow can be exercised against a local stand-in.
 */
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { PassThrough, type Readable } from 'stream';
import archiver from 'archiver';
import { sql, eq } from 'drizzle-orm';
import { db, pool } from './db';
import { appSettings, backupFiles } from '@shared/schema';
import { requireAuth, requireAdmin } from './middleware';
import { listObjectsWithMeta, objectReadStream, mimeFromName } from './storage-backup';

const admin = [requireAuth, requireAdmin] as const;
const OAUTH = () => process.env.GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com';
const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const API = () => process.env.GOOGLE_API_BASE || 'https://www.googleapis.com';
const APP_URL = () => (process.env.APP_BASE_URL || 'https://rfptracker.app').replace(/\/$/, '');
const REDIRECT = () => `${APP_URL()}/api/admin/backup/google/callback`;
const ROOT_FOLDER = 'RFPTracker Backups';

/** Never in a backup: live sign-in tokens, and the backup's own Drive credentials. */
const SKIP_TABLES = new Set(['auth_tokens', 'password_reset_tokens', 'session', 'sessions', 'backup_files']);

// ---------------------------------------------------------------- settings

const K = { drive: 'backup.drive', folders: 'backup.drive.folders', status: 'backup.status', lease: 'backup.lease', state: 'backup.oauth.state', tickets: 'backup.tickets' };
type DriveConn = { refreshToken: string; email: string | null; connectedAt: string; connectedBy: string | null };
type RunRecord = { at: string; ok: boolean; db?: { name: string; bytes: number }; filesCopied?: number; filesRemaining?: number; error?: string; by: string };
type Status = { lastRunAt?: string; lastSuccessAt?: string; running?: boolean; current?: string; filesBackedUp?: number; history: RunRecord[] };

async function getSetting<T>(key: string): Promise<T | null> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (!r) return null;
  try { return JSON.parse(r.value) as T; } catch { return null; }
}
async function setSetting(key: string, value: unknown, by: string | null = null) {
  const v = JSON.stringify(value);
  await db.insert(appSettings).values({ key, value: v, updatedBy: by, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedBy: by, updatedAt: new Date() } });
}
async function clearSetting(key: string) { await db.delete(appSettings).where(eq(appSettings.key, key)); }
const configured = () => !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);

// ---------------------------------------------------------------- database

/** Every table, as one JSON document, written gzipped to `out`. Streams table by table. */
export async function writeDatabaseDump(out: NodeJS.WritableStream, opts: { gzip: boolean }): Promise<{ tables: number; rows: number }> {
  const sink: NodeJS.WritableStream = opts.gzip ? (() => { const z = zlib.createGzip(); z.pipe(out); return z; })() : out;
  const write = (s: string) => new Promise<void>((res) => (sink.write(s) ? res() : sink.once('drain', () => res())));
  const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows
    .map((r: any) => String(r.table_name)).filter((t: string) => !SKIP_TABLES.has(t));
  await write(`{"meta":${JSON.stringify({ app: 'RFPTracker', createdAt: new Date().toISOString(), tables, note: 'Every table in the public schema, rows as JSON. Sign-in tokens are left out. Restore with server/scripts/restore-backup.ts.' })},"tables":{`);
  let rows = 0;
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    let list: any[] = (await pool.query(`SELECT * FROM "${t.replace(/"/g, '""')}"`)).rows;
    if (t === 'app_settings') list = list.filter((r) => !String(r.key).startsWith('backup.'));
    rows += list.length;
    await write(`${i ? ',' : ''}${JSON.stringify(t)}:${JSON.stringify(list)}`);
  }
  await write('}}');
  await new Promise<void>((res) => sink.end(() => res()));
  return { tables: tables.length, rows };
}

// ---------------------------------------------------------------- files

type Stored = { key: string; size: number; created: string | null };
/** Every stored file in the app (Object Storage, or the local uploads folder in a dev workspace). */
async function allStoredFiles(): Promise<Stored[]> {
  if (process.env.PRIVATE_OBJECT_DIR) return listObjectsWithMeta('');
  const root = path.join(process.cwd(), 'uploads');
  const out: Stored[] = [];
  const walk = async (dir: string) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) { const st = await fsp.stat(p); out.push({ key: path.relative(root, p).split(path.sep).join('/'), size: st.size, created: st.mtime.toISOString() }); }
    }
  };
  await walk(root);
  return out;
}
const fileStream = (key: string): Readable | null => (process.env.PRIVATE_OBJECT_DIR
  ? (objectReadStream(key) as Readable | null)
  : fs.existsSync(path.join(process.cwd(), 'uploads', key)) ? fs.createReadStream(path.join(process.cwd(), 'uploads', key)) : null);
// ---------------------------------------------------------------- full download

const README = `RFPTracker full backup
======================

database/rfptracker-database.json   Every table, rows as JSON (sign-in tokens left out).
files/...                           Every stored file, at the same path it has in storage.
                                    Project cost files are under files/cost/<project id>/.

To restore into an empty database, run from the app's code:
  npx tsx server/scripts/restore-backup.ts <path to rfptracker-database.json>
with DATABASE_URL set to the target database (start the app against it once
first so every table exists). Files go back into Object Storage under uploads/
at the same paths.
`;

async function streamFullBackup(res: Response) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="RFPTracker Backup ${stamp}.zip"`);
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('warning', (e) => console.warn('[backup] zip warning', e.message));
  zip.on('error', (e) => { console.error('[backup] zip error', e); res.destroy(e); });
  zip.pipe(res);
  zip.append(README, { name: 'README.txt' });
  const dbStream = new PassThrough();
  zip.append(dbStream, { name: 'database/rfptracker-database.json' });
  await writeDatabaseDump(dbStream, { gzip: false });
  // One file at a time: each read starts only after the previous entry is written.
  const files = await allStoredFiles();
  for (const f of files) {
    const s = fileStream(f.key);
    if (!s) continue;
    await new Promise<void>((resolve) => { zip.once('entry', () => resolve()); s.on('error', (e) => { console.error('[backup] read', f.key, e.message); resolve(); }); zip.append(s, { name: `files/${f.key}` }); });
  }
  await zip.finalize();
}

// ---------------------------------------------------------------- Google Drive

async function accessToken(): Promise<string> {
  const conn = await getSetting<DriveConn>(K.drive);
  if (!conn) throw new Error('Google Drive is not connected.');
  const r = await fetch(`${OAUTH()}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, refresh_token: conn.refreshToken, grant_type: 'refresh_token' }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in expired or was revoked (${j.error || r.status}). Reconnect Google Drive.`);
  return j.access_token;
}
async function drive(tok: string, method: string, url: string, body?: unknown): Promise<any> {
  const r = await fetch(`${API()}${url}`, { method, headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return null;
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(`Google Drive: ${j?.error?.message || r.status}`); e.status = r.status; throw e; }
  return j;
}
async function folder(tok: string, cache: Record<string, string>, pathParts: string[]): Promise<string> {
  let parent = 'root', sofar = '';
  for (const name of [ROOT_FOLDER, ...pathParts]) {
    sofar = sofar ? `${sofar}/${name}` : name;
    if (!cache[sofar]) {
      const f = await drive(tok, 'POST', '/drive/v3/files?fields=id', { name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] });
      cache[sofar] = f.id;
    }
    parent = cache[sofar];
  }
  return parent;
}
async function upload(tok: string, parent: string, name: string, data: Buffer, mime: string): Promise<string> {
  const start = await fetch(`${API()}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(data.length) },
    body: JSON.stringify({ name, parents: [parent] }),
  });
  if (!start.ok) { const e: any = new Error(`Google Drive upload refused (${start.status})`); e.status = start.status; throw e; }
  const loc = start.headers.get('location');
  if (!loc) throw new Error('Google Drive gave no upload address');
  const put = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(data.length) }, body: data });
  const j: any = await put.json().catch(() => ({}));
  if (!put.ok || !j.id) throw new Error(`Google Drive upload failed (${put.status})`);
  return j.id;
}

/**
 * A stored file to Drive in 8 MB pieces (resumable upload), read as a stream, so memory
 * stays flat whatever the file's size. Holding whole files in memory is what took the
 * server down on the first big run (2026-10-23).
 */
const CHUNK = 8 * 1024 * 1024; // a multiple of 256 KB, as Drive requires
async function uploadStream(tok: string, parent: string, name: string, key: string, size: number, mime: string): Promise<string> {
  const start = await fetch(`${API()}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify({ name, parents: [parent] }),
  });
  if (!start.ok) { const e: any = new Error(`Google Drive upload refused (${start.status})`); e.status = start.status; throw e; }
  const loc = start.headers.get('location');
  if (!loc) throw new Error('Google Drive gave no upload address');
  const src = fileStream(key);
  if (!src) throw new Error('file not found in storage');
  let pending: Buffer[] = [], pendingLen = 0, sent = 0, id: string | null = null;
  const put = async (last: boolean) => {
    const body = Buffer.concat(pending, pendingLen); pending = []; pendingLen = 0;
    const end = sent + body.length - 1;
    const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Length': String(body.length), 'Content-Range': body.length ? `bytes ${sent}-${end}/${last ? sent + body.length : '*'}` : `bytes */${sent}` }, body });
    sent += body.length;
    if (last) {
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) throw new Error(`Google Drive upload failed (${r.status})`);
      id = j.id;
    } else if (r.status !== 308) throw new Error(`Google Drive upload stopped (${r.status})`);
  };
  try {
    for await (const chunk of src as AsyncIterable<Buffer>) {
      let c = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      while (c.length) {
        const take = Math.min(CHUNK - pendingLen, c.length);
        pending.push(c.subarray(0, take)); pendingLen += take; c = c.subarray(take);
        if (pendingLen === CHUNK) await put(false);
      }
    }
    await put(true);
  } finally { (src as any).destroy?.(); }
  return id!;
}

// ---------------------------------------------------------------- the run

let running = false;
/** Short, and renewed before every file, so a server that dies mid-run frees it quickly. */
const LEASE_MIN = 5;
const INSTANCE = crypto.randomBytes(6).toString('hex');

/** Take the lease (or renew ours). False when another instance holds a live one. */
async function takeLease(minutes: number): Promise<boolean> {
  const until = new Date(Date.now() + minutes * 60000).toISOString();
  const v = JSON.stringify({ until, by: INSTANCE });
  const r = await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE (app_settings.value::json->>'until')::timestamptz < now() OR app_settings.value::json->>'by' = $3
     RETURNING key`, [K.lease, v, INSTANCE]);
  return (r.rowCount ?? 0) > 0;
}
async function dropLease() { await pool.query(`DELETE FROM app_settings WHERE key = $1 AND value::json->>'by' = $2`, [K.lease, INSTANCE]); }

const keepNames = (names: Array<{ id: string; name: string }>) => {
  // Newest 30 daily snapshots, plus the first of each month for 24 months.
  const sorted = [...names].sort((a, b) => b.name.localeCompare(a.name));
  const keep = new Set(sorted.slice(0, 30).map((f) => f.id));
  const firstOfMonth = new Map<string, { id: string; name: string }>();
  for (const f of [...sorted].reverse()) { const m = /(\d{4}-\d{2})-\d{2}/.exec(f.name)?.[1]; if (m && !firstOfMonth.has(m)) firstOfMonth.set(m, f); }
  Array.from(firstOfMonth.values()).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 24).forEach((f) => keep.add(f.id));
  return sorted.filter((f) => !keep.has(f.id));
};

export async function runBackup(by: string, budgetMs = 20 * 60000): Promise<RunRecord> {
  if (running) throw new Error('A backup is already running.');
  if (!(await takeLease(LEASE_MIN))) throw new Error('A backup is already running on another server.');
  running = true;
  const t0 = Date.now();
  const status: Status = (await getSetting<Status>(K.status)) ?? { history: [] };
  const rec: RunRecord = { at: new Date().toISOString(), ok: false, by };
  const save = async (patch: Partial<Status>) => { Object.assign(status, patch); await setSetting(K.status, status); };
  try {
    await save({ running: true, current: 'Database', lastRunAt: rec.at });
    const tok0 = await accessToken();
    let tok = tok0, tokAt = Date.now();
    const fresh = async () => { if (Date.now() - tokAt > 40 * 60000) { tok = await accessToken(); tokAt = Date.now(); } return tok; };
    const cache = (await getSetting<Record<string, string>>(K.folders)) ?? {};
    const withFolder = async <T>(parts: string[], fn: (id: string) => Promise<T>): Promise<T> => {
      try { return await fn(await folder(await fresh(), cache, parts)); }
      catch (e: any) {
        // A folder someone deleted or moved out of reach: forget it and make it again, once.
        if (e?.status !== 404) throw e;
        for (const k of Object.keys(cache)) delete cache[k];
        return fn(await folder(await fresh(), cache, parts));
      }
    };

    // 1. Database snapshot.
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => sink.on('end', r));
    await writeDatabaseDump(sink, { gzip: true });
    await done;
    const dbBuf = Buffer.concat(chunks);
    const et = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const g = (t: string) => et.find((p) => p.type === t)?.value ?? '';
    const dbName = `rfptracker-database-${g('year')}-${g('month')}-${g('day')}-${g('hour')}${g('minute')}.json.gz`;
    const dbFolder = await withFolder(['Database'], async (id) => { await upload(await fresh(), id, dbName, dbBuf, 'application/gzip'); return id; });
    rec.db = { name: dbName, bytes: dbBuf.length };
    // Retention on the snapshots this app made.
    try {
      const list = await drive(await fresh(), 'GET', `/drive/v3/files?q=${encodeURIComponent(`'${dbFolder}' in parents and trashed = false`)}&fields=files(id,name)&pageSize=1000`);
      for (const f of keepNames(list?.files ?? [])) await drive(await fresh(), 'DELETE', `/drive/v3/files/${f.id}`).catch(() => null);
    } catch (e) { console.warn('[backup] retention skipped:', (e as Error).message); }

    // 2. Every stored file not copied yet (same key, same size).
    await save({ current: 'Files' });
    const done2 = new Map((await db.select().from(backupFiles)).map((r) => [r.key, r.sizeBytes ?? -1]));
    const todo = (await allStoredFiles()).filter((f) => done2.get(f.key) !== f.size);
    let copied = 0, failed = 0;
    for (const f of todo) {
      if (Date.now() - t0 > budgetMs) break;
      await takeLease(LEASE_MIN);
      const parts = f.key.split('/');
      const name = parts.pop()!;
      let id: string;
      try {
        id = await withFolder(['Files', ...parts], async (pid) => uploadStream(await fresh(), pid, name, f.key, f.size, mimeFromName(name)));
      } catch (e: any) {
        // One bad file doesn't stop the rest; it's tried again next run.
        if (e?.status === 401 || e?.status === 403) throw e;
        failed++; console.warn(`[backup] skipped ${f.key}: ${e?.message}`);
        continue;
      }
      await db.insert(backupFiles).values({ key: f.key, driveId: id, sizeBytes: f.size, backedUpAt: new Date() })
        .onConflictDoUpdate({ target: backupFiles.key, set: { driveId: id, sizeBytes: f.size, backedUpAt: new Date() } });
      copied++;
      if (copied % 25 === 0) await setSetting(K.folders, cache);
    }
    await setSetting(K.folders, cache);
    rec.filesCopied = copied;
    rec.filesRemaining = todo.length - copied;
    if (failed) rec.error = `${failed} file${failed === 1 ? '' : 's'} could not be copied; tried again next run`;
    rec.ok = true;
    const total = Number((await pool.query('SELECT count(*)::int AS n FROM backup_files')).rows[0]?.n ?? 0);
    // A run that ran out of time still counts for the database; the files carry on next time.
    await save({ running: false, current: undefined, lastSuccessAt: rec.at, filesBackedUp: total, history: [rec, ...status.history].slice(0, 14) });
    console.log(`[backup] ok: ${dbName} (${dbBuf.length} bytes), ${copied} files copied, ${rec.filesRemaining} left`);
    return rec;
  } catch (e: any) {
    rec.error = e?.message || String(e);
    console.error('[backup] failed:', rec.error);
    await save({ running: false, current: undefined, history: [rec, ...status.history].slice(0, 14) }).catch(() => null);
    return rec;
  } finally {
    running = false;
    await dropLease().catch(() => null);
  }
}

/** Every 30 minutes on every awake instance: back up when the last good one is over a day old, or files are still waiting. */
export function startBackupScheduler() {
  const tick = async () => {
    try {
      if (running || !configured() || process.env.BACKUP_AUTO === 'off') return;
      const conn = await getSetting<DriveConn>(K.drive);
      if (!conn) return;
      const st = await getSetting<Status>(K.status);
      const last = st?.lastSuccessAt ? Date.parse(st.lastSuccessAt) : 0;
      const behind = (st?.history?.[0]?.filesRemaining ?? 0) > 0;
      if (Date.now() - last < 22 * 3600000 && !behind) return;
      await runBackup('automatic');
    } catch (e) { console.warn('[backup] scheduler:', (e as Error).message); }
  };
  setTimeout(tick, 2 * 60000);
  setInterval(tick, 30 * 60000);
}

// ---------------------------------------------------------------- routes

const userName = (req: Request) => { const u: any = (req as any).user; return [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || u?.username || 'admin'; };

export function registerBackupRoutes(app: Express) {
  app.get('/api/admin/backup/status', ...admin, async (_req, res) => {
    try {
      const conn = await getSetting<DriveConn>(K.drive);
      const st = (await getSetting<Status>(K.status)) ?? { history: [] };
      const files = await allStoredFiles().catch(() => [] as Stored[]);
      const dbBytes = Number((await pool.query('SELECT pg_database_size(current_database())::bigint AS b').catch(() => ({ rows: [{ b: 0 }] }))).rows[0]?.b ?? 0);
      const copied = Number((await pool.query('SELECT count(*)::int AS n FROM backup_files').catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0);
      res.json({
        configured: configured(), redirectUri: REDIRECT(),
        drive: conn ? { email: conn.email, connectedAt: conn.connectedAt, connectedBy: conn.connectedBy, folder: ROOT_FOLDER } : null,
        status: { ...st, running: running || !!st.running },
        storage: { files: files.length, fileBytes: files.reduce((t, f) => t + f.size, 0), dbBytes, filesBackedUp: copied },
      });
    } catch (e: any) { res.status(500).json({ message: e?.message || 'Could not read backup status' }); }
  });

  app.post('/api/admin/backup/run', ...admin, async (req, res) => {
    if (!configured()) return res.status(400).json({ message: 'Google Drive backup is not set up on the server yet.' });
    if (!(await getSetting<DriveConn>(K.drive))) return res.status(400).json({ message: 'Connect Google Drive first.' });
    if (running) return res.status(409).json({ message: 'A backup is already running.' });
    const by = userName(req);
    runBackup(by).catch(() => null); // reports through the status
    res.json({ started: true });
  });

  // A download link good for one use within five minutes: the zip can be gigabytes,
  // so the browser downloads it directly instead of holding it in memory.
  app.post('/api/admin/backup/download-ticket', ...admin, async (req, res) => {
    const t = crypto.randomBytes(24).toString('hex');
    const list = ((await getSetting<Array<{ t: string; until: number }>>(K.tickets)) ?? []).filter((x) => x.until > Date.now());
    list.push({ t, until: Date.now() + 5 * 60000 });
    await setSetting(K.tickets, list, userName(req));
    res.json({ url: `/api/admin/backup/download?ticket=${t}` });
  });
  app.get('/api/admin/backup/download', async (req, res) => {
    try {
      const t = String(req.query.ticket || '');
      const list = (await getSetting<Array<{ t: string; until: number }>>(K.tickets)) ?? [];
      const hit = list.find((x) => x.t === t && x.until > Date.now());
      if (!hit) return res.status(403).send('This download link has expired. Start the download again from Admin → File Storage.');
      await setSetting(K.tickets, list.filter((x) => x.t !== t));
      console.log('[backup] full download started');
      await streamFullBackup(res);
    } catch (e: any) {
      console.error('[backup] download failed', e);
      if (!res.headersSent) res.status(500).send('The backup could not be built.'); else res.destroy();
    }
  });

  app.post('/api/admin/backup/google/start', ...admin, async (req, res) => {
    if (!configured()) return res.status(400).json({ message: 'Google Drive backup is not set up on the server yet.' });
    const state = crypto.randomBytes(16).toString('hex');
    await setSetting(K.state, { state, by: userName(req), until: Date.now() + 15 * 60000 });
    const q = new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, redirect_uri: REDIRECT(), response_type: 'code', state,
      // drive.file: the app sees only the files it creates, nothing else in the Drive.
      scope: 'https://www.googleapis.com/auth/drive.file openid email', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    });
    res.json({ url: `${AUTH_URL()}?${q}` });
  });
  app.get('/api/admin/backup/google/callback', async (req, res) => {
    const back = (msg: string) => res.redirect(`/admin?tab=storage&drive=${encodeURIComponent(msg)}`);
    try {
      const st = await getSetting<{ state: string; by: string; until: number }>(K.state);
      if (!st || st.state !== String(req.query.state || '') || st.until < Date.now()) return back('expired');
      if (req.query.error) return back('declined');
      const r = await fetch(`${OAUTH()}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(req.query.code || ''), client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, redirect_uri: REDIRECT(), grant_type: 'authorization_code' }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j.refresh_token) { console.error('[backup] token exchange', r.status, j?.error); return back('failed'); }
      let email: string | null = null;
      try { email = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString()).email ?? null; } catch { /* no id token */ }
      const before = await getSetting<DriveConn & { lastEmail?: string }>('backup.drive.last');
      await setSetting(K.drive, { refreshToken: j.refresh_token, email, connectedAt: new Date().toISOString(), connectedBy: st.by } satisfies DriveConn, st.by);
      await clearSetting(K.state);
      // A different Google account starts its own folders and copies every file again;
      // reconnecting the same account carries on where it was.
      if (!before || before.lastEmail !== email) { await clearSetting(K.folders); await db.delete(backupFiles); }
      await setSetting('backup.drive.last', { lastEmail: email });
      back('connected');
      runBackup(st.by).catch(() => null);
    } catch (e) { console.error('[backup] callback', e); back('failed'); }
  });
  app.post('/api/admin/backup/google/disconnect', ...admin, async (_req, res) => {
    await clearSetting(K.drive);
    res.json({ ok: true });
  });
}
