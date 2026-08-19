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
  insertProjectTeamMemberSchema, PROJECT_TEAM_ROLE_LABELS, PROJECT_TEAM_ROLES, executedLeases,
  PROJECT_TEAM_CORE_ROLES,
} from '@shared/schema';
import { eq, and, asc } from 'drizzle-orm';
import { requireAuth, requireAuthFlexible, checkPermission } from './middleware';
import { getBrandLogo as getBridgeLogo, BRAND_COLOR_PRIMARY, COMPANY_NAME } from './lib/branding';

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
          customRole: projectTeamMembers.customRole,
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
      // 'other' without a discipline produces a directory row labelled "Other",
      // which tells a reader nothing. Reject it rather than store it.
      if (parsed.data.role === 'other' && !String(parsed.data.customRole || '').trim()) {
        return res.status(400).json({ message: 'Specify the discipline when the role is Other.' });
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

  // ── Lease-scoped team (what the directory report reads) ──────────────────
  app.get('/api/executed-leases/:leaseId/team', requireAuth, async (req, res) => {
    try {
      const leaseId = parseInt(req.params.leaseId);
      if (isNaN(leaseId)) return res.status(400).json({ message: 'Invalid lease id' });
      const rows = await db
        .select({
          id: projectTeamMembers.id,
          leaseId: projectTeamMembers.leaseId,
          contactId: projectTeamMembers.contactId,
          role: projectTeamMembers.role,
          isPrimary: projectTeamMembers.isPrimary,
          roleTitle: projectTeamMembers.roleTitle,
          customRole: projectTeamMembers.customRole,
          notes: projectTeamMembers.notes,
          contactName: contacts.name,
          contactEmail: contacts.email,
          contactPhone: contacts.phone,
          company: contacts.company,
        })
        .from(projectTeamMembers)
        .leftJoin(contacts, eq(projectTeamMembers.contactId, contacts.id))
        .where(eq(projectTeamMembers.leaseId, leaseId))
        .orderBy(asc(projectTeamMembers.role), asc(projectTeamMembers.id));
      res.json(rows);
    } catch (error) {
      console.error('[project-team] lease fetch failed:', error);
      res.status(500).json({ message: 'Failed to load lease team' });
    }
  });

  app.post('/api/executed-leases/:leaseId/team', requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const leaseId = parseInt(req.params.leaseId);
      if (isNaN(leaseId)) return res.status(400).json({ message: 'Invalid lease id' });

      const parsed = insertProjectTeamMemberSchema.safeParse({ ...req.body, leaseId, rfpId: null });
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid team member', errors: parsed.error.errors });
      }
      if (!PROJECT_TEAM_ROLES.includes(parsed.data.role as any)) {
        return res.status(400).json({ message: `Unknown role: ${parsed.data.role}` });
      }
      if (parsed.data.role === 'other' && !String(parsed.data.customRole || '').trim()) {
        return res.status(400).json({ message: 'Specify the discipline when the role is Other.' });
      }

      if (parsed.data.isPrimary) {
        await db.update(projectTeamMembers)
          .set({ isPrimary: false })
          .where(and(eq(projectTeamMembers.leaseId, leaseId), eq(projectTeamMembers.role, parsed.data.role)));
      }

      const [created] = await db.insert(projectTeamMembers).values(parsed.data).returning();
      res.status(201).json(created);
    } catch (error) {
      console.error('[project-team] lease create failed:', error);
      res.status(500).json({ message: 'Failed to add team member' });
    }
  });

  app.delete('/api/executed-leases/:leaseId/team/:memberId', requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const memberId = parseInt(req.params.memberId);
      const leaseId = parseInt(req.params.leaseId);
      if (isNaN(memberId) || isNaN(leaseId)) return res.status(400).json({ message: 'Invalid id' });
      await db.delete(projectTeamMembers)
        .where(and(eq(projectTeamMembers.id, memberId), eq(projectTeamMembers.leaseId, leaseId)));
      res.json({ success: true });
    } catch (error) {
      console.error('[project-team] lease delete failed:', error);
      res.status(500).json({ message: 'Failed to remove team member' });
    }
  });

  // ── Cross-project directory report ───────────────────────────────────────
  // requireAuthFlexible so the printable report can be opened in a new tab with
  // ?token=, the way the other printable reports work.
  app.get('/api/reports/project-team', requireAuthFlexible, async (req, res) => {
    try {
      // SPINE IS PROPERTIES AND EXECUTED LEASES, not RFPs.
      //
      // An RFP is a deal being priced; many never sign, and several can exist for
      // one space. The thing that actually gets built is the LEASE. Driving the
      // directory from RFPs listed speculative deals and omitted signed ones.
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

      const leaseRows = await db
        .select({
          id: executedLeases.id,
          propertyId: executedLeases.propertyId,
          tenantName: executedLeases.tenantName,
          suiteNumber: executedLeases.suiteNumber,
          bayNumbers: executedLeases.bayNumbers,
          leaseStartDate: executedLeases.leaseStartDate,
          leaseEndDate: executedLeases.leaseEndDate,
          constructionByTenant: executedLeases.constructionByTenant,
        })
        .from(executedLeases);

      const memberRows = await db
        .select({
          leaseId: projectTeamMembers.leaseId,
          role: projectTeamMembers.role,
          isPrimary: projectTeamMembers.isPrimary,
          roleTitle: projectTeamMembers.roleTitle,
          customRole: projectTeamMembers.customRole,
          contactName: contacts.name,
          contactEmail: contacts.email,
          contactPhone: contacts.phone,
          company: contacts.company,
        })
        .from(projectTeamMembers)
        .leftJoin(contacts, eq(projectTeamMembers.contactId, contacts.id))
        .orderBy(asc(projectTeamMembers.role));

      const membersByLease = new Map<number, typeof memberRows>();
      for (const m of memberRows) {
        if (m.leaseId == null) continue;
        if (!membersByLease.has(m.leaseId)) membersByLease.set(m.leaseId, [] as any);
        membersByLease.get(m.leaseId)!.push(m);
      }

      const leasesByProperty = new Map<number, typeof leaseRows>();
      for (const l of leaseRows) {
        if (l.propertyId == null) continue;
        if (!leasesByProperty.has(l.propertyId)) leasesByProperty.set(l.propertyId, [] as any);
        leasesByProperty.get(l.propertyId)!.push(l);
      }

      // Every building is listed, including those with no leases — an empty
      // building is real information on a portfolio report.
      const parks = new Map<string, typeof propRows>();
      for (const prop of propRows) {
        const park = prop.propertyName || 'Unnamed property';
        if (!parks.has(park)) parks.set(park, [] as any);
        parks.get(park)!.push(prop);
      }
      const sortedParks = Array.from(parks.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      const allLeases = leaseRows.length;
      const naLeases = leaseRows.filter((l) => l.constructionByTenant).length;
      const staffedLeases = leaseRows.filter(
        (l) => !l.constructionByTenant && (membersByLease.get(l.id) || []).length > 0
      ).length;
      const gapLeases = allLeases - naLeases - staffedLeases;

      if (req.query.format === 'json') {
        return res.json({
          summary: { leases: allLeases, staffed: staffedLeases, tenantBuilt: naLeases, unstaffed: gapLeases },
          properties: propRows.map((p) => ({
            ...p,
            leases: (leasesByProperty.get(p.id) || []).map((l) => ({ ...l, members: membersByLease.get(l.id) || [] })),
          })),
        });
      }

      const CORE_ROLES = [...PROJECT_TEAM_CORE_ROLES];

      const renderLease = (lease: typeof leaseRows[number]) => {
        const members = membersByLease.get(lease.id) || [];
        const label = [
          lease.tenantName,
          lease.suiteNumber ? `Suite ${lease.suiteNumber}` : null,
          lease.bayNumbers || null,
        ].filter(Boolean).join(' · ');

        // Tenant-built work is a DECISION, not a gap. Rendering blank core roles
        // here would report it as missing a design team it was never going to have.
        if (lease.constructionByTenant) {
          return `
          <div class="project">
            <div class="project-head">${escapeHtml(label)} <span class="pill na">Construction by tenant — N/A</span></div>
          </div>`;
        }

        const rolesToShow = Array.from(new Set([...CORE_ROLES, ...members.map((m) => m.role)]))
          .sort((a, b) => PROJECT_TEAM_ROLES.indexOf(a as any) - PROJECT_TEAM_ROLES.indexOf(b as any));

        const bodyRows = rolesToShow.map((role) => {
          const inRole = members.filter((m) => m.role === role);
          const baseLabel = PROJECT_TEAM_ROLE_LABELS[role] || role;
          const roleLabel = role === 'other'
            ? (inRole.find((m) => m.customRole)?.customRole || baseLabel)
            : baseLabel;
          if (inRole.length === 0) {
            return `
              <tr class="unassigned"><td>${escapeHtml(roleLabel)}</td><td colspan="4">Not assigned</td></tr>`;
          }
          return inRole.map((m) => `
              <tr>
                <td>${escapeHtml(roleLabel)}${m.isPrimary ? ' <strong>(primary)</strong>' : ''}</td>
                <td>${escapeHtml(m.company || '—')}</td>
                <td>${escapeHtml(m.contactName || '—')}${m.roleTitle ? `<br><span class="muted">${escapeHtml(m.roleTitle)}</span>` : ''}</td>
                <td>${escapeHtml(m.contactEmail || '—')}</td>
                <td>${escapeHtml(m.contactPhone || '—')}</td>
              </tr>`).join('');
        }).join('');

        return `
          <div class="project">
            <div class="project-head">${escapeHtml(label)}${members.length === 0 ? ' <span class="pill">No team assigned</span>' : ''}</div>
            <table>
              <thead><tr><th style="width:18%">Role</th><th style="width:22%">Firm</th><th style="width:22%">Contact</th><th style="width:22%">Email</th><th style="width:16%">Phone</th></tr></thead>
              <tbody>${bodyRows}</tbody>
            </table>
          </div>`;
      };

      const sections = sortedParks.map(([parkName, buildings]) => {
        const sortedBuildings = [...buildings].sort((a, b) =>
          String(a.building || '').localeCompare(String(b.building || ''), undefined, { numeric: true }));
        const leaseCount = sortedBuildings.reduce((n, b) => n + (leasesByProperty.get(b.id) || []).length, 0);

        const buildingBlocks = sortedBuildings.map((prop) => {
          const leases = leasesByProperty.get(prop.id) || [];
          const addressLine = [prop.streetAddress, [prop.city, prop.state].filter(Boolean).join(', '), prop.zip]
            .filter(Boolean).join(' · ');
          return `
        <div class="building">
          <div class="building-head">Building ${escapeHtml(prop.building || '—')}
            <span class="muted">${leases.length} lease${leases.length === 1 ? '' : 's'}</span>
          </div>
          ${addressLine ? `<div class="project-address">${escapeHtml(addressLine)}</div>` : ''}
          ${leases.length === 0
            ? `<div class="project-address muted">No executed leases on this building.</div>`
            : leases.map(renderLease).join('')}
        </div>`;
        }).join('');

        return `
      <div class="park">
        <div class="park-head">${escapeHtml(parkName)}
          <span class="park-count">${sortedBuildings.length} building${sortedBuildings.length === 1 ? '' : 's'} · ${leaseCount} lease${leaseCount === 1 ? '' : 's'}</span>
        </div>
        ${buildingBlocks}
      </div>`;
      }).join('');

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Project Team Directory</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; margin: 24px; color: #222; font-size: 12px; }
  .report-subtitle { text-align: center; color: #666; font-size: 12px; margin-top: 4px; }
  .document-title { font-size: 22px; font-weight: bold; background: ${BRAND_COLOR_PRIMARY}; color: #fff; padding: 10px; border-radius: 5px; text-align: center; }
  .generated { text-align: right; color: #666; font-size: 10px; margin-top: 6px; }
  .summary { margin-top: 10px; padding: 8px 10px; background: #eef2f9; border-radius: 4px; font-size: 11px; }
  .park { margin-top: 22px; }
  .park-head { font-size: 16px; font-weight: bold; color: #fff; background: ${BRAND_COLOR_PRIMARY}; padding: 6px 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: baseline; }
  .park-count { font-size: 10px; font-weight: normal; opacity: 0.9; }
  .building { margin: 10px 0 0 14px; }
  .building-head { font-size: 12px; font-weight: bold; color: ${BRAND_COLOR_PRIMARY}; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
  .project { margin: 8px 0 0 12px; page-break-inside: avoid; }
  .project-head { font-weight: bold; font-size: 12px; padding-bottom: 3px; }
  .project-address { color: #444; font-size: 10px; margin: 2px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #eef2f9; text-align: left; padding: 5px; border: 1px solid #ccc; font-size: 11px; }
  td { padding: 5px; border: 1px solid #ddd; vertical-align: top; }
  .muted { color: #777; font-size: 10px; font-weight: normal; }
  .empty { padding: 20px; background: #fff8e1; border: 1px solid #ffe082; border-radius: 5px; }
  .unassigned td { color: #9a3412; background: #fff7ed; font-style: italic; }
  .pill { font-size: 9px; font-weight: normal; background: #fff7ed; color: #9a3412; border: 1px solid #fdba74; border-radius: 10px; padding: 1px 7px; vertical-align: middle; }
  .pill.na { background: #eef2f9; color: #1e3a5f; border-color: #b6c6dd; }
</style></head><body>
  <div class="header">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <img src="${getBridgeLogo()}" alt="${COMPANY_NAME}" style="height: 30px; width: auto;" />
      <div style="font-size: 12px; color: #999;">Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
    <div class="document-title">Project Team Directory</div>
    <div class="report-subtitle">Who is working on each executed lease</div>
  </div>
  <div class="summary">
    <strong>${propRows.length}</strong> building${propRows.length === 1 ? '' : 's'} ·
    <strong>${allLeases}</strong> executed lease${allLeases === 1 ? '' : 's'} ·
    <strong>${staffedLeases}</strong> with a team ·
    <strong>${gapLeases}</strong> needing one ·
    <strong>${naLeases}</strong> built by tenant (N/A)
  </div>
  ${propRows.length === 0
    ? `<div class="empty">No properties on record.</div>`
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
