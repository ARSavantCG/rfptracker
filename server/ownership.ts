/**
 * Ownership scoping (slice 0b — REBUILT 2026-07-21 for the contacts identity model).
 *
 * PRODUCTION REALITY: all real accounts are `contacts` rows (JJ, managers, and
 * Adolfo all log in as contacts). The `users` table is legacy/empty in prod.
 * The canonical owner id is therefore `req.userId` — the string auth already
 * produces: "contact_<n>" for a contact, a bare id for a rare users account.
 * created_by_user_id stores exactly that string, so it matches req.userId with
 * no translation and works uniformly across both account types.
 *
 * THE RULE (Adolfo): below admin, a person may MODIFY only records they created —
 * managers included. Reads stay unscoped. Admin is identified by the
 * `admin.access` PERMISSION (contacts have role 'contact', never 'admin' — same
 * convention requireAdmin already uses), NOT by a role string.
 *
 * Gate order: admin.access | records.editAny → pass; owner id match → pass;
 * else 403, with a NULL owner failing closed to admin-only.
 *
 * ENFORCEMENT IS FLAGGED. Because the first backfill ran against the wrong
 * (empty) table and resolved 0 owners, turning enforcement on blind would 403
 * every non-admin contact on every RFP/ROM mutation. So enforcement is OFF
 * unless ENFORCE_OWNERSHIP=true. Sequence: ship OFF → Adolfo runs the ownership
 * report against real contacts data → confirm owners resolve → flip the flag on.
 */
import { db } from './db';
import { sql } from 'drizzle-orm';
import { storage } from './storage';
import { requireAuth, requireAdmin } from './middleware';

// Default OFF. Flip to 'true' in the deployment env only AFTER the ownership
// report shows owners resolving on real data (see registerOwnershipAdminRoutes).
const OWNERSHIP_ENFORCED = process.env.ENFORCE_OWNERSHIP === 'true';

function bypassesOwnership(user: any): boolean {
  const perms: string[] = user?.permissions || [];
  // admin.access is the real admin signal (contacts are role 'contact').
  return perms.includes('admin.access') || perms.includes('records.editAny');
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
      // Flagged off → behave exactly as before this slice (auth + whatever
      // permission checks already ran earlier in the chain). No lockouts.
      if (!OWNERSHIP_ENFORCED) return next();
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
  // DIAGNOSTIC (2026-07-22): why is the backfill resolving 0/72? Shows the ACTUAL
  // distinct sent_by / created_by values that failed to match, next to the contact
  // names/emails the matcher knows about — so the transform is built from real data,
  // not assumptions. Admin-only; read-only; returns no secrets (names/emails only).
  app.get('/api/admin/ownership-diagnostic', requireAuth, requireAdmin, async (_req: any, res: any) => {
    try {
      const contactsRes: any = await db.execute(sql`SELECT id, name, email, company, type FROM contacts WHERE is_active = true ORDER BY name`);
      const contactList = (contactsRes.rows ?? contactsRes).map((c: any) => ({
        ownerId: `contact_${c.id}`, name: c.name, email: c.email, company: c.company, type: c.type,
      }));
      const knownKeys = new Set<string>();
      for (const c of contactList) {
        if (c.name) knownKeys.add(String(c.name).trim().toLowerCase());
        if (c.email) knownKeys.add(String(c.email).trim().toLowerCase());
      }
      const out: any = { contacts: contactList, tables: {} };
      for (const t of [
        { key: 'rfp_requests', col: 'sent_by' },
        { key: 'rom_pilots', col: 'created_by' },
      ]) {
        const distinctRes: any = await db.execute(sql.raw(
          `SELECT ${t.col} AS source_text, COUNT(*)::int AS n
             FROM ${t.key}
            WHERE created_by_user_id IS NULL
            GROUP BY ${t.col} ORDER BY n DESC`
        ));
        const rows = (distinctRes.rows ?? distinctRes).map((r: any) => {
          const raw = r.source_text;
          const base = raw ? String(raw).split(' - ')[0].trim().toLowerCase() : '';
          const full = raw ? String(raw).trim().toLowerCase() : '';
          return {
            value: raw,
            count: r.n,
            matchesContact: knownKeys.has(base) || knownKeys.has(full),
          };
        });
        out.tables[t.key] = rows;
      }
      res.json(out);
    } catch (error) {
      console.error('[ownership] diagnostic failed:', error);
      res.status(500).json({ message: 'Diagnostic failed' });
    }
  });

  app.get('/api/admin/ownership-report', requireAuth, requireAdmin, async (_req: any, res: any) => {    try {
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
      // Assignable owners = CONTACTS (the real accounts), surfaced with the
      // same id string auth uses (contact_<n>) so a reassignment writes a value
      // that will actually match req.userId. Any real users rows are appended.
      const contactsRes: any = await db.execute(
        sql`SELECT id, name, email, company FROM contacts WHERE is_active = true ORDER BY name`
      );
      const contactRows = (contactsRes.rows ?? contactsRes).map((c: any) => ({
        id: `contact_${c.id}`,
        username: c.email,
        first_name: c.name,
        last_name: '',
        role: 'contact',
        company: c.company,
      }));
      let userRows: any[] = [];
      try {
        const usersRes: any = await db.execute(
          sql`SELECT id, username, first_name, last_name, role FROM users WHERE is_active = true ORDER BY username`
        );
        userRows = usersRes.rows ?? usersRes;
      } catch { /* users table may be empty/absent in prod */ }
      report.assignableUsers = [...contactRows, ...userRows];
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
      // Validate the target owner id. contact_<n> → contacts; anything else → users.
      let ownerExists = false;
      if (typeof userId === 'string' && userId.startsWith('contact_')) {
        const cid = parseInt(userId.replace('contact_', ''));
        const r: any = await db.execute(sql`SELECT id FROM contacts WHERE id = ${cid} LIMIT 1`);
        ownerExists = (r.rows ?? r).length > 0;
      } else {
        const r: any = await db.execute(sql`SELECT id FROM users WHERE id = ${userId} LIMIT 1`);
        ownerExists = (r.rows ?? r).length > 0;
      }
      if (!ownerExists) {
        return res.status(400).json({ message: 'Unknown owner id' });
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
