/**
 * Monthly financial snapshots (Adolfo, 2026-10-23): history can't be rebuilt after the
 * fact, so each project's position is saved once a month (and whenever he asks), and the
 * Project Financial Summary says what moved since the last one, and why.
 *   baseline  the first snapshot for a project (when this started)
 *   month     taken in the first days of a month: the month just ended (period = that month)
 *   manual    Save Snapshot Now
 * The app sleeps when idle (Autoscale), so the scheduler catches up on wake; a unique
 * index stops two instances saving the same month twice.
 */
import type { Express } from 'express';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { requireAuth, requireAdmin } from './middleware';
import { loadProjectBundle, todayEastern } from './cost-tracking-routes';
import { financialFigures, type FinancialFigures } from '@shared/financial-figures';

export interface Snapshot { id: number; projectId: number; kind: string; period: string; takenAt: string; takenBy: string | null; data: FinancialFigures }

const rowOf = (r: any): Snapshot => ({ id: r.id, projectId: r.project_id, kind: r.kind, period: r.period, takenAt: new Date(r.taken_at).toISOString(), takenBy: r.taken_by, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data });

export async function listSnapshots(projectId: number): Promise<Snapshot[]> {
  const res: any = await db.execute(sql`SELECT * FROM cost_snapshots WHERE project_id = ${projectId} ORDER BY taken_at DESC`);
  return (res.rows ?? res).map(rowOf);
}

export async function takeSnapshot(projectId: number, kind: 'baseline' | 'month' | 'manual', period: string, by: string | null): Promise<Snapshot | null> {
  const b = await loadProjectBundle(projectId);
  if (!b) return null;
  const data = financialFigures(b, todayEastern());
  const res: any = await db.execute(sql`INSERT INTO cost_snapshots (project_id, kind, period, taken_by, data)
    VALUES (${projectId}, ${kind}, ${period}, ${by}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT DO NOTHING RETURNING *`);
  const r = (res.rows ?? res)[0];
  return r ? rowOf(r) : null;
}

const prevMonth = (today: string) => { const [y, m] = today.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

/** For each active project: a baseline if it has none, and last month's if it's missing. */
export async function snapshotTick() {
  const today = todayEastern();
  const projects: any = await db.execute(sql`SELECT id, created_at FROM cost_projects WHERE status <> 'closed'`);
  for (const p of (projects.rows ?? projects)) {
    try {
      const have: any = await db.execute(sql`SELECT kind, period FROM cost_snapshots WHERE project_id = ${p.id}`);
      const list = (have.rows ?? have) as Array<{ kind: string; period: string }>;
      if (!list.length) { await takeSnapshot(p.id, 'baseline', today.slice(0, 7), 'Automatic'); continue; }
      const last = prevMonth(today);
      // Only months that ended after tracking began (the baseline's month or later).
      const base = list.filter((s) => s.kind === 'baseline').map((s) => s.period).sort()[0] ?? last;
      if (last >= base && !list.some((s) => s.kind === 'month' && s.period === last)) await takeSnapshot(p.id, 'month', last, 'Automatic');
    } catch (e) { console.warn('[snapshots]', p.id, (e as Error).message); }
  }
}

export function startSnapshotScheduler() {
  const tick = () => snapshotTick().catch((e) => console.warn('[snapshots] tick:', e?.message));
  setTimeout(tick, 90 * 1000);
  setInterval(tick, 3 * 3600000);
}

export function registerSnapshotRoutes(app: Express) {
  app.get('/api/cost-projects/:id/snapshots', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid ID' });
    try { res.json((await listSnapshots(id)).map(({ data, ...s }) => ({ ...s, projected: data.projected }))); }
    catch (e: any) { res.status(500).json({ message: 'Could not read the snapshots', error: e?.message }); }
  });
  app.post('/api/cost-projects/:id/snapshots', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid ID' });
    try {
      const u: any = (req as any).user;
      const by = [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || null;
      const s = await takeSnapshot(id, 'manual', `${todayEastern()}-${Date.now()}`, by);
      if (!s) return res.status(404).json({ message: 'Project not found' });
      const { data, ...rest } = s;
      res.json({ ...rest, projected: data.projected });
    } catch (e: any) { res.status(500).json({ message: 'Could not save the snapshot', error: e?.message }); }
  });
}
