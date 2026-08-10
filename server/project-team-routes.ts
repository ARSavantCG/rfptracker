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
      // NO JOIN TO properties HERE. rfp_requests.property is TEXT holding the
      // property id as a string, while properties.id is INTEGER - Postgres
      // rejects that comparison outright and the whole report 500s. Every other
      // caller in this codebase resolves it in JS with p.id.toString() === rfp.property.
      // Fetched separately and matched the same way.
      // Driven from rfpRequests, NOT from projectTeamMembers.
      //
      // Previously this started at the assignments table, so a project with
      // nobody assigned simply did not exist in the report. That hid exactly the
      // thing worth seeing: which projects have no architect or engineer on
      // record. Every project is listed now; the gaps are the point.
      const projectRows = await db
        .select({
          rfpId: rfpRequests.id,
          rfpNumber: rfpRequests.rfpNumber,
          projectName: rfpRequests.projectName,
          tenantName: rfpRequests.tenantName,
          status: rfpRequests.status,
          propertyRef: rfpRequests.property,
        })
        .from(rfpRequests)
        .orderBy(asc(rfpRequests.projectName));

      const memberRows = await db
        .select({
          rfpId: projectTeamMembers.rfpId,
          role: projectTeamMembers.role,
          isPrimary: projectTeamMembers.isPrimary,
          roleTitle: projectTeamMembers.roleTitle,
          contactName: contacts.name,
          contactEmail: contacts.email,
          contactPhone: contacts.phone,
          company: contacts.company,
        })
        .from(projectTeamMembers)
        .leftJoin(contacts, eq(projectTeamMembers.contactId, contacts.id))
        .orderBy(asc(projectTeamMembers.role));

      // Project only what is needed: a bare select().from(properties) throws if
      // ANY column on that wide table has drifted, taking the report with it.
      const propRows = await db
        .select({
          id: properties.id,
          propertyName: properties.propertyName,
          building: properties.building,
          streetAddress: properties.streetAddress,
          city: properties.city,
          state: properties.state,
          zip: properties.zip,
        })
        .from(properties);
      const propById = new Map(propRows.map((p) => [String(p.id), p]));

      const membersByRfp = new Map<number, typeof memberRows>();
      for (const m of memberRows) {
        if (m.rfpId == null) continue;
        if (!membersByRfp.has(m.rfpId)) membersByRfp.set(m.rfpId, [] as any);
        membersByRfp.get(m.rfpId)!.push(m);
      }

      // Only CANCELLED and ARCHIVED are hidden by default.
      //
      // 'completed' was originally excluded too, which was wrong: this is a
      // DIRECTORY, and a finished job is exactly the institutional memory it
      // exists to hold - "who did we use on MG Westside?" is most often asked
      // about work that is already done. Excluding it left a portfolio-wide
      // report showing a single project.
      //
      //   default        cancelled + archived hidden
      //   ?activeOnly=1  also hides completed
      //   ?includeAll=1  hides nothing
      const activeOnly = req.query.activeOnly === '1';
      const includeAll = req.query.includeAll === '1';
      const HIDDEN = activeOnly
        ? ['cancelled', 'archived', 'completed']
        : ['cancelled', 'archived'];

      const visibleProjects = includeAll
        ? projectRows
        : projectRows.filter((p) => !HIDDEN.includes(String(p.status || '')));

      const hiddenCount = projectRows.length - visibleProjects.length;

      const staffedCount = visibleProjects.filter((p) => (membersByRfp.get(p.rfpId) || []).length > 0).length;

      if (req.query.format === 'json') {
        return res.json({
          summary: { total: visibleProjects.length, staffed: staffedCount, unstaffed: visibleProjects.length - staffedCount },
          projects: visibleProjects.map((p) => ({ ...p, members: membersByRfp.get(p.rfpId) || [] })),
        });
      }

      // Roles always shown as rows even when unassigned, so the report doubles as
      // a coverage checklist. The rest appear only when someone is in them.
      const CORE_ROLES = ['architect', 'mep_engineer', 'general_contractor'];

      // GROUPED BY PARK, THEN BUILDING.
      //
      // properties.propertyName is the park ("Bridge Point Doral") and
      // properties.building is the building within it ("1", "B"). Most of the
      // portfolio is multi-building parks, so a flat project list scattered
      // buildings of the same park across the page. Park is the unit people think
      // in; building is the unit the deal sits in.
      type ProjRow = typeof visibleProjects[number];
      const parks = new Map<string, Map<string, { prop: any; projects: ProjRow[] }>>();
      const UNKNOWN_PARK = 'Unassigned property';

      for (const proj of visibleProjects) {
        const prop = proj.propertyRef ? propById.get(String(proj.propertyRef)) : undefined;
        const parkName = prop?.propertyName || UNKNOWN_PARK;
        const buildingKey = prop?.building ? String(prop.building) : '—';
        if (!parks.has(parkName)) parks.set(parkName, new Map());
        const buildings = parks.get(parkName)!;
        if (!buildings.has(buildingKey)) buildings.set(buildingKey, { prop, projects: [] });
        buildings.get(buildingKey)!.projects.push(proj);
      }

      // Parks alphabetical, but the unresolved bucket always last so it reads as
      // an exception rather than an entry.
      const sortedParks = Array.from(parks.entries()).sort((a, b) => {
        if (a[0] === UNKNOWN_PARK) return 1;
        if (b[0] === UNKNOWN_PARK) return -1;
        return a[0].localeCompare(b[0]);
      });

      const renderTeamTable = (proj: ProjRow) => {
        const members = membersByRfp.get(proj.rfpId) || [];
        const rolesToShow = Array.from(new Set([...CORE_ROLES, ...members.map((m) => m.role)]))
          .sort((a, b) => PROJECT_TEAM_ROLES.indexOf(a as any) - PROJECT_TEAM_ROLES.indexOf(b as any));

        const bodyRows = rolesToShow.map((role) => {
          const inRole = members.filter((m) => m.role === role);
          const label = PROJECT_TEAM_ROLE_LABELS[role] || role;
          if (inRole.length === 0) {
            // Blank row rather than an omitted one: an unassigned role is
            // information, and hiding it makes an incomplete team look complete.
            return `
            <tr class="unassigned"><td>${escapeHtml(label)}</td><td colspan="4">Not assigned</td></tr>`;
          }
          return inRole.map((m) => `
            <tr>
              <td>${escapeHtml(label)}${m.isPrimary ? ' <strong>(primary)</strong>' : ''}</td>
              <td>${escapeHtml(m.company || '—')}</td>
              <td>${escapeHtml(m.contactName || '—')}${m.roleTitle ? `<br><span class="muted">${escapeHtml(m.roleTitle)}</span>` : ''}</td>
              <td>${escapeHtml(m.contactEmail || '—')}</td>
              <td>${escapeHtml(m.contactPhone || '—')}</td>
            </tr>`).join('');
        }).join('');

        const projHead = [proj.projectName, proj.tenantName].filter(Boolean).join(' — ');
        return `
          <div class="project">
            <div class="project-head">${escapeHtml(projHead)}${
              proj.status && proj.status !== 'in-progress' && proj.status !== 'received'
                ? ` <span class="pill status">${escapeHtml(String(proj.status).replace('-', ' '))}</span>` : ''
            }${members.length === 0 ? ' <span class="pill">No team assigned</span>' : ''}</div>
            <div class="project-sub">${escapeHtml(proj.rfpNumber || '')}</div>
            <table>
              <thead><tr><th style="width:18%">Role</th><th style="width:22%">Firm</th><th style="width:22%">Contact</th><th style="width:22%">Email</th><th style="width:16%">Phone</th></tr></thead>
              <tbody>${bodyRows}</tbody>
            </table>
          </div>`;
      };

      const sections = sortedParks.map(([parkName, buildings]) => {
        const buildingKeys = Array.from(buildings.keys()).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }));
        const projectCount = Array.from(buildings.values()).reduce((n, b) => n + b.projects.length, 0);

        const buildingBlocks = buildingKeys.map((bk) => {
          const { prop, projects } = buildings.get(bk)!;
          const addressLine = prop
            ? [prop.streetAddress, [prop.city, prop.state].filter(Boolean).join(', '), prop.zip]
                .filter(Boolean).join(' · ')
            : null;
          return `
        <div class="building">
          <div class="building-head">${prop ? `Building ${escapeHtml(bk)}` : 'Building unknown'}</div>
          ${addressLine ? `<div class="project-address">${escapeHtml(addressLine)}</div>` : ''}
          ${!prop ? `<div class="project-address warn">Property record not found — address unavailable.</div>` : ''}
          ${projects.map(renderTeamTable).join('')}
        </div>`;
        }).join('');

        return `
      <div class="park">
        <div class="park-head">${escapeHtml(parkName)}
          <span class="park-count">${buildingKeys.length} building${buildingKeys.length === 1 ? '' : 's'} · ${projectCount} project${projectCount === 1 ? '' : 's'}</span>
        </div>
        ${buildingBlocks}
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
  .project-sub { color: #666; font-size: 10px; margin: 3px 0 2px; }
  .project-address { color: #444; font-size: 10px; margin: 0 0 6px; }
  .project-address.warn { color: #92400e; background: #fef3c7; padding: 2px 5px; border-radius: 3px; display: inline-block; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #eef2f9; text-align: left; padding: 5px; border: 1px solid #ccc; font-size: 11px; }
  td { padding: 5px; border: 1px solid #ddd; vertical-align: top; }
  .muted { color: #777; font-size: 10px; }
  .empty { padding: 20px; background: #fff8e1; border: 1px solid #ffe082; border-radius: 5px; }
  .unassigned td { color: #9a3412; background: #fff7ed; font-style: italic; }
  .pill { font-size: 9px; font-weight: normal; background: #fff7ed; color: #9a3412; border: 1px solid #fdba74; border-radius: 10px; padding: 1px 7px; vertical-align: middle; }
  .pill.status { background: #eef2f9; color: #1e3a5f; border-color: #b6c6dd; text-transform: capitalize; }
  .summary { margin-top: 10px; padding: 8px 10px; background: #eef2f9; border-radius: 4px; font-size: 11px; }
  .park { margin-top: 22px; page-break-inside: auto; }
  .park-head { font-size: 16px; font-weight: bold; color: #fff; background: ${BRAND_COLOR_PRIMARY}; padding: 6px 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: baseline; }
  .park-count { font-size: 10px; font-weight: normal; opacity: 0.9; }
  .building { margin: 10px 0 0 14px; }
  .building-head { font-size: 12px; font-weight: bold; color: ${BRAND_COLOR_PRIMARY}; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
  .project { margin: 8px 0 0 12px; page-break-inside: avoid; }
</style></head><body>
  <div class="document-title">Project Team Directory</div>
  <div class="generated">Generated ${new Date().toLocaleString()}</div>
  <div class="summary">
    <strong>${visibleProjects.length}</strong> project${visibleProjects.length === 1 ? '' : 's'} ·
    <strong>${staffedCount}</strong> with a team assigned ·
    <strong>${visibleProjects.length - staffedCount}</strong> with none
    ${hiddenCount > 0
      ? ` &nbsp;<span class="muted">(${hiddenCount} ${activeOnly ? 'cancelled, archived or completed' : 'cancelled or archived'} project${hiddenCount === 1 ? '' : 's'} hidden — add ?includeAll=1 to the URL to show everything)</span>`
      : ''}
  </div>
  ${visibleProjects.length === 0
    ? `<div class="empty">No active projects found.</div>`
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
