/**
 * Ownership scoping (slice 0b, DESIGN-rom-mode-on-rfp.md, 2026-07-21).
 *
 * THE RULE (Adolfo): below admin, a person may MODIFY only records they created —
 * this includes managers (his call, 2026-07-21, which supersedes the design's
 * admin-or-owner-only sketch in one direction: managers are scoped too).
 * Reads stay unscoped — everyone sees the whole portfolio.
 *
 * Gate order per request:
 *   1. admin.access            → pass (admin modifies anything)
 *   2. records.editAny         → pass (per-user escape hatch, seeded to no
 *                                 role except admin; grant from the admin panel
 *                                 when e.g. a manager must cover a colleague's deal)
 *   3. record.createdByUserId === req.userId → pass
 *   4. otherwise 403. A NULL createdByUserId FAILS CLOSED (admin-only) — the
 *      backfill couldn't resolve an owner and "no owner" never means "anyone".
 *
 * Applied AFTER requireAuth (needs req.user/req.userId) on every mutating route
 * that targets a specific rfp_requests or rom_pilots record. Creation routes are
 * not scoped (nothing to own yet) — they STAMP createdByUserId instead.
 */
import { db } from './db';
import { sql } from 'drizzle-orm';
import { storage } from './storage';
import { requireAuth, requireAdmin } from './middleware';

function bypassesOwnership(user: any): boolean {
  const perms: string[] = user?.permissions || [];
  return user?.role === 'admin' || perms.includes('admin.access') || perms.includes('records.editAny');
}

/**
 * Middleware factory. `kind` picks the table; `param` names the route param
 * carrying the record id (':id' on some routes, ':rfpId' on others — pass it
 * explicitly, never guess).
 */
export function requireRecordOwnership(kind: 'rfp' | 'rom', param: string) {
  return async (req: any, res: any, next: any) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: 'Authentication required' });
      if (bypassesOwnership(user)) return next();

      const id = parseInt(req.params[param]);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid record ID' });

      const record: any = kind === 'rfp'
        ? await storage.getRfpRequest(id)
        : await storage.getRomPilot(id);
      if (!record) return res.status(404).json({ message: 'Record not found' });

      if (record.createdByUserId && record.createdByUserId === req.userId) {
        return next();
      }
      if (!record.createdByUserId) {
        // Fail closed: unresolved owner is admin-only, never "anyone".
        return res.status(403).json({
          message: "This record's owner could not be determined, so only an admin can modify it. Ask an admin to reassign it from the ownership report.",
        });
      }
      return res.status(403).json({
        message: 'You can only modify records you created. Ask an admin if you need access to this one.',
      });
    } catch (error) {
      console.error('[ownership] check failed:', error);
      // A broken ownership check must not silently grant access.
      return res.status(500).json({ message: 'Ownership check failed' });
    }
  };
}

export const requireRfpOwnership = (param = 'id') => requireRecordOwnership('rfp', param);
export const requireRomOwnership = (param = 'id') => requireRecordOwnership('rom', param);

/**
 * Admin routes: the backfill report (the number Adolfo asked to see before
 * trusting scoping) and the reassign escape hatch for locked-out teammates.
 */
export function registerOwnershipAdminRoutes(app: any) {
  app.get('/api/admin/ownership-report', requireAuth, requireAdmin, async (_req: any, res: any) => {
    try {
      const report: any = {};
      for (const t of [
        { key: 'rfpRequests', table: 'rfp_requests', label: 'rfp_number', name: 'project_name', source: 'sent_by' },
        { key: 'romPilots', table: 'rom_pilots', label: 'rom_number', name: 'project_name', source: 'created_by' },
      ]) {
        const totals: any = await db.execute(sql.raw(
          `SELECT COUNT(*)::int AS total,
                  COUNT(created_by_user_id)::int AS resolved,
                  COUNT(*) FILTER (WHERE created_by_user_id IS NULL)::int AS unresolved
             FROM ${t.table}`
        ));
        const trow = (totals.rows ?? totals)[0] || {};
        const unresolvedRows: any = await db.execute(sql.raw(
          `SELECT id, ${t.label} AS label, ${t.name} AS name, ${t.source} AS source_text
             FROM ${t.table} WHERE created_by_user_id IS NULL ORDER BY id`
        ));
        report[t.key] = {
          total: trow.total ?? 0,
          resolved: trow.resolved ?? 0,
          unresolved: trow.unresolved ?? 0,
          unresolvedRecords: (unresolvedRows.rows ?? unresolvedRows),
        };
      }
      const usersRes: any = await db.execute(
        sql`SELECT id, username, first_name, last_name, role FROM users WHERE is_active = true ORDER BY username`
      );
      report.assignableUsers = (usersRes.rows ?? usersRes);
      res.json(report);
    } catch (error) {
      console.error('[ownership] report failed:', error);
      res.status(500).json({ message: 'Failed to build ownership report' });
    }
  });

  // POST { table: 'rfp' | 'rom', id: number, userId: string }
  app.post('/api/admin/ownership-reassign', requireAuth, requireAdmin, async (req: any, res: any) => {
    try {
      const { table, id, userId } = req.body || {};
      if (!['rfp', 'rom'].includes(table) || !Number.isInteger(id) || typeof userId !== 'string' || !userId) {
        return res.status(400).json({ message: "Expected { table: 'rfp'|'rom', id, userId }" });
      }
      const userRes: any = await db.execute(sql`SELECT id FROM users WHERE id = ${userId} LIMIT 1`);
      if ((userRes.rows ?? userRes).length === 0) {
        return res.status(400).json({ message: 'Unknown user id' });
      }
      const tableName = table === 'rfp' ? 'rfp_requests' : 'rom_pilots';
      const result: any = await db.execute(sql.raw(
        `UPDATE ${tableName} SET created_by_user_id = '${userId.replace(/'/g, "''")}' WHERE id = ${Number(id)} RETURNING id`
      ));
      if ((result.rows ?? result).length === 0) {
        return res.status(404).json({ message: 'Record not found' });
      }
      console.log(`[ownership] admin ${req.userId} reassigned ${tableName} #${id} to ${userId}`);
      res.json({ message: 'Owner reassigned', table: tableName, id, userId });
    } catch (error) {
      console.error('[ownership] reassign failed:', error);
      res.status(500).json({ message: 'Failed to reassign owner' });
    }
  });
}
