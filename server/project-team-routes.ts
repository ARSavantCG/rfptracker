/**
 * Project team — assignments and the cross-project directory report.
 *
 * Answers "who is on this deal" per project, and "who is on everything" across
 * the portfolio, without having to open each RFP and read it off the screen.
 */
import type { Express } from 'express';
import { db } from './db';
import {
  projectTeamMembers, contacts, rfpRequests, properties,
  insertProjectTeamMemberSchema, PROJECT_TEAM_ROLE_LABELS, PROJECT_TEAM_ROLES,
} from '@shared/schema';
import { eq, and, asc } from 'drizzle-orm';
import { requireAuth, requireAuthFlexible, checkPermission } from './middleware';
import { BRAND_COLOR_PRIMARY } from './lib/branding';

function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerProjectTeamRoutes(app: Express) {

  // ── Read the team for one RFP ────────────────────────────────────────────
  app.get('/api/rfp-requests/:rfpId/team', requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) return res.status(400).json({ message: 'Invalid RFP id' });

      // Project only the columns needed. A bare select().from() throws outright if
      // ANY column on the table has drifted, taking the whole endpoint with it.
      const rows = await db
        .select({
          id: projectTeamMembers.id,
          rfpId: projectTeamMembers.rfpId,
          contactId: projectTeamMembers.contactId,
          role: projectTeamMembers.role,
          isPrimary: projectTeamMembers.isPrimary,
          roleTitle: projectTeamMembers.roleTitle,
          notes: projectTeamMembers.notes,
          contactName: contacts.name,
          contactEmail: contacts.email,
          contactPhone: contacts.phone,
          company: contacts.company,
        })
        .from(projectTeamMembers)
        .leftJoin(contacts, eq(projectTeamMembers.contactId, contacts.id))
        .where(eq(projectTeamMembers.rfpId, rfpId))
        .orderBy(asc(projectTeamMembers.role), asc(projectTeamMembers.id));

      res.json(rows);
    } catch (error) {
      console.error('[project-team] fetch failed:', error);
      res.status(500).json({ message: 'Failed to load project team' });
    }
  });

  // ── Add a member ─────────────────────────────────────────────────────────
  app.post('/api/rfp-requests/:rfpId/team', requireAuth, checkPermission('rfp.edit'), async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) return res.status(400).json({ message: 'Invalid RFP id' });

      const parsed = insertProjectTeamMemberSchema.safeParse({ ...req.body, rfpId });
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid team member', errors: parsed.error.errors });
      }
      if (!PROJECT_TEAM_ROLES.includes(parsed.data.role as any)) {
        return res.status(400).json({ message: `Unknown role: ${parsed.data.role}` });
      }

      // One primary per role. Demote the incumbent rather than ending up with two,
      // which would make "who do I call" ambiguous on the report.
      if (parsed.data.isPrimary) {
        await db.update(projectTeamMembers)
          .set({ isPrimary: false })
          .where(and(eq(projectTeamMembers.rfpId, rfpId), eq(projectTeamMembers.role, parsed.data.role)));
      }

      const [created] = await db.insert(projectTeamMembers).values(parsed.data).returning();
      res.status(201).json(created);
    } catch (error) {
      console.error('[project-team] create failed:', error);
      res.status(500).json({ message: 'Failed to add team member' });
    }
  });

  // ── Remove a member ──────────────────────────────────────────────────────
  app.delete('/api/rfp-requests/:rfpId/team/:memberId', requireAuth, checkPermission('rfp.edit'), async (req, res) => {
    try {
      const memberId = parseInt(req.params.memberId);
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(memberId) || isNaN(rfpId)) return res.status(400).json({ message: 'Invalid id' });

      await db.delete(projectTeamMembers)
        .where(and(eq(projectTeamMembers.id, memberId), eq(projectTeamMembers.rfpId, rfpId)));
      res.json({ success: true });
    } catch (error) {
      console.error('[project-team] delete failed:', error);
      res.status(500).json({ message: 'Failed to remove team member' });
    }
  });

  // ── Cross-project directory report ───────────────────────────────────────
  // requireAuthFlexible so the printable report can be opened in a new tab with
  // ?token=, the way the other printable reports work.
  app.get('/api/reports/project-team', requireAuthFlexible, async (req, res) => {
    try {
      const rows = await db
        .select({
          rfpId: rfpRequests.id,
          rfpNumber: rfpRequests.rfpNumber,
          projectName: rfpRequests.projectName,
          tenantName: rfpRequests.tenantName,
          status: rfpRequests.status,
          propertyName: properties.propertyName,
          building: properties.building,
          role: projectTeamMembers.role,
          isPrimary: projectTeamMembers.isPrimary,
          roleTitle: projectTeamMembers.roleTitle,
          contactName: contacts.name,
          contactEmail: contacts.email,
          contactPhone: contacts.phone,
          company: contacts.company,
        })
        .from(projectTeamMembers)
        .leftJoin(rfpRequests, eq(projectTeamMembers.rfpId, rfpRequests.id))
        .leftJoin(contacts, eq(projectTeamMembers.contactId, contacts.id))
        .leftJoin(properties, eq(rfpRequests.property, properties.id))
        .orderBy(asc(rfpRequests.projectName), asc(projectTeamMembers.role));

      // Group by project. Projects with no team assigned do not appear here at
      // all — that absence is itself the useful signal, so it is stated in the
      // report rather than left for the reader to notice.
      const byProject = new Map<number, typeof rows>();
      for (const r of rows) {
        if (r.rfpId == null) continue;
        if (!byProject.has(r.rfpId)) byProject.set(r.rfpId, [] as any);
        byProject.get(r.rfpId)!.push(r);
      }

      if (req.query.format === 'json') {
        return res.json({ projects: Array.from(byProject.entries()).map(([id, members]) => ({ rfpId: id, members })) });
      }

      const sections = Array.from(byProject.values()).map((members) => {
        const first = members[0];
        const heading = [first.projectName, first.tenantName].filter(Boolean).join(' — ');
        const sub = [first.rfpNumber, first.propertyName && `${first.propertyName}${first.building ? ` (Bldg ${first.building})` : ''}`]
          .filter(Boolean).join(' · ');
        const memberRows = members.map((m) => `
          <tr>
            <td>${escapeHtml(PROJECT_TEAM_ROLE_LABELS[m.role] || m.role)}${m.isPrimary ? ' <strong>(primary)</strong>' : ''}</td>
            <td>${escapeHtml(m.company || '—')}</td>
            <td>${escapeHtml(m.contactName || '—')}${m.roleTitle ? `<br><span class="muted">${escapeHtml(m.roleTitle)}</span>` : ''}</td>
            <td>${escapeHtml(m.contactEmail || '—')}</td>
            <td>${escapeHtml(m.contactPhone || '—')}</td>
          </tr>`).join('');
        return `
        <div class="project">
          <div class="project-head">${escapeHtml(heading)}</div>
          <div class="project-sub">${escapeHtml(sub)}</div>
          <table>
            <thead><tr><th>Role</th><th>Firm</th><th>Contact</th><th>Email</th><th>Phone</th></tr></thead>
            <tbody>${memberRows}</tbody>
          </table>
        </div>`;
      }).join('');

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Project Team Directory</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; margin: 24px; color: #222; font-size: 12px; }
  .document-title { font-size: 22px; font-weight: bold; background: ${BRAND_COLOR_PRIMARY}; color: #fff; padding: 10px; border-radius: 5px; text-align: center; }
  .generated { text-align: right; color: #666; font-size: 10px; margin-top: 6px; }
  .project { margin-top: 18px; page-break-inside: avoid; }
  .project-head { font-weight: bold; font-size: 14px; border-bottom: 2px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 3px; }
  .project-sub { color: #666; font-size: 10px; margin: 3px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #eef2f9; text-align: left; padding: 5px; border: 1px solid #ccc; font-size: 11px; }
  td { padding: 5px; border: 1px solid #ddd; vertical-align: top; }
  .muted { color: #777; font-size: 10px; }
  .empty { padding: 20px; background: #fff8e1; border: 1px solid #ffe082; border-radius: 5px; }
</style></head><body>
  <div class="document-title">Project Team Directory</div>
  <div class="generated">Generated ${new Date().toLocaleString()}</div>
  ${byProject.size === 0
    ? `<div class="empty">No project team members have been assigned yet. Assign architects, engineers, and other roles on an RFP and they will appear here.</div>`
    : sections}
</body></html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('[project-team] report failed:', error);
      res.status(500).json({ message: 'Failed to generate project team report' });
    }
  });
}
