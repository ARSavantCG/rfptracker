/**
 * Open items — the Tuesday meeting sheet.
 *
 * Everything not yet closed, grouped by route, ordered by urgency. Built to be
 * read top-down in a standing meeting: overdue first, then due this week, then
 * everything else.
 *
 * Allowance deals appear in their own section. They close on creation, so an OPEN
 * allowance record means someone started one and did not finish it — worth seeing,
 * but never mixed in with priced work.
 */
import type { Express } from 'express';
import { db } from './db';
import { rfpRequests, properties } from '@shared/schema';
import { asc } from 'drizzle-orm';
import { requireAuthFlexible } from './middleware';
import { getBrandLogo as getBridgeLogo, BRAND_COLOR_PRIMARY, COMPANY_NAME } from './lib/branding';

function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
}

function daysBetween(a: Date, b: Date): number {
  const d1 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const d2 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

const PHASE_LABELS: Record<string, string> = {
  'rfp-entry': 'Step 1 — Entry',
  'rfp-validation': 'Step 2 — Validation',
  'invitation-to-bid': 'Step 3 — Invitation to Bid',
  'bid-collection': 'Step 4 — Bid Collection',
  'evaluation': 'Step 5 — Evaluation',
  'publish': 'Step 6 — Publish',
};

export function registerOpenItemsReport(app: Express) {
  app.get('/api/reports/open-items', requireAuthFlexible, async (req, res) => {
    try {
      const rows = await db
        .select({
          id: rfpRequests.id,
          rfpNumber: rfpRequests.rfpNumber,
          projectName: rfpRequests.projectName,
          tenantName: rfpRequests.tenantName,
          propertyRef: rfpRequests.property,
          status: rfpRequests.status,
          workflowPhase: rfpRequests.workflowPhase,
          trackType: rfpRequests.trackType,
          pricingPath: rfpRequests.pricingPath,
          sentBy: rfpRequests.sentBy,
          receivedOn: rfpRequests.receivedOn,
          internalDueDate: rfpRequests.internalDueDate,
        })
        .from(rfpRequests)
        .orderBy(asc(rfpRequests.internalDueDate));

      const propRows = await db
        .select({ id: properties.id, propertyName: properties.propertyName, building: properties.building })
        .from(properties);
      const propById = new Map(propRows.map((p) => [String(p.id), p]));
      const propLabel = (ref: string | null) => {
        const p = ref ? propById.get(String(ref)) : undefined;
        if (!p) return '—';
        return p.building ? `${p.propertyName} - Bldg. ${p.building}` : p.propertyName;
      };

      // Open = not finished and not abandoned. 'completed' is excluded, which is
      // also what closes an allowance deal on creation.
      const CLOSED = ['completed', 'cancelled', 'archived'];
      const open = rows.filter((r) => !CLOSED.includes(String(r.status || '')));

      const now = new Date();
      const withAge = open.map((r) => {
        const due = r.internalDueDate ? new Date(r.internalDueDate) : null;
        const overdueBy = due ? daysBetween(due, now) : null;
        return {
          ...r,
          overdueBy,
          // Route label. rom_pilot is an RFP - it prices against the database -
          // but worth distinguishing in a meeting, since nobody on the
          // development team is working it.
          route: r.trackType === 'allowance'
            ? 'allowance'
            : (r.pricingPath === 'rom_pilot' ? 'rom_pilot' : 'development'),
        };
      });

      const overdue = withAge.filter((r) => (r.overdueBy ?? -1) > 0);
      const dueSoon = withAge.filter((r) => r.overdueBy !== null && r.overdueBy <= 0 && r.overdueBy >= -7);
      const later = withAge.filter((r) => r.overdueBy === null || r.overdueBy < -7);

      const byRoute = (list: typeof withAge, route: string) => list.filter((r) => r.route === route);

      if (req.query.format === 'json') {
        return res.json({
          summary: {
            open: withAge.length,
            overdue: overdue.length,
            dueThisWeek: dueSoon.length,
            development: byRoute(withAge, 'development').length,
            romPilot: byRoute(withAge, 'rom_pilot').length,
            allowance: byRoute(withAge, 'allowance').length,
          },
          items: withAge,
        });
      }

      const rowHtml = (r: typeof withAge[number]) => `
        <tr${(r.overdueBy ?? -1) > 0 ? ' class="od"' : ''}>
          <td>${escapeHtml(r.rfpNumber || '')}</td>
          <td>${escapeHtml(r.projectName || r.tenantName || '')}</td>
          <td>${escapeHtml(propLabel(r.propertyRef))}</td>
          <td>${escapeHtml(PHASE_LABELS[String(r.workflowPhase)] || r.workflowPhase || '—')}</td>
          <td>${escapeHtml(r.sentBy || '—')}</td>
          <td>${fmtDate(r.internalDueDate)}</td>
          <td>${(r.overdueBy ?? -1) > 0
            ? `<span class="late">${r.overdueBy}d over</span>`
            : r.overdueBy !== null
              ? `<span class="muted">${Math.abs(r.overdueBy!)}d left</span>`
              : '<span class="muted">no due date</span>'}</td>
        </tr>`;

      const table = (list: typeof withAge) => `
        <table>
          <thead><tr>
            <th style="width:12%">Number</th>
            <th style="width:26%">Project</th>
            <th style="width:20%">Property</th>
            <th style="width:16%">Stage</th>
            <th style="width:12%">Sent By</th>
            <th style="width:7%">Due</th>
            <th style="width:7%">Status</th>
          </tr></thead>
          <tbody>${list.map(rowHtml).join('')}</tbody>
        </table>`;

      const section = (title: string, list: typeof withAge, note?: string) => {
        if (list.length === 0) return '';
        return `<h3>${escapeHtml(title)} <span class="count">${list.length}</span></h3>
          ${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}
          ${table(list)}`;
      };

      const routeBlock = (label: string, route: string, note?: string) => {
        const list = byRoute(withAge, route);
        if (list.length === 0) return '';
        const od = list.filter((r) => (r.overdueBy ?? -1) > 0);
        const rest = list.filter((r) => (r.overdueBy ?? -1) <= 0);
        return `
        <div class="route">
          <div class="route-head">${escapeHtml(label)}
            <span class="route-count">${list.length} open${od.length ? ` · ${od.length} overdue` : ''}</span>
          </div>
          ${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}
          ${section('Overdue', od)}
          ${section('On track', rest)}
        </div>`;
      };

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Open Items</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; margin: 24px; color: #222; font-size: 12px; }
  .document-title { font-size: 22px; font-weight: bold; background: ${BRAND_COLOR_PRIMARY}; color: #fff; padding: 10px; border-radius: 5px; text-align: center; }
  .report-subtitle { text-align: center; color: #666; font-size: 12px; margin-top: 4px; }
  .cards { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
  .card { flex: 1; min-width: 110px; border: 1px solid #ddd; border-radius: 5px; padding: 8px 10px; }
  .card .label { font-size: 10px; color: #666; }
  .card .value { font-size: 20px; font-weight: bold; }
  .route { margin-top: 20px; }
  .route-head { font-size: 15px; font-weight: bold; color: #fff; background: ${BRAND_COLOR_PRIMARY}; padding: 6px 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: baseline; }
  .route-count { font-size: 10px; font-weight: normal; opacity: 0.9; }
  h3 { margin: 12px 0 4px; font-size: 13px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
  h3 .count { font-size: 11px; font-weight: normal; color: #666; }
  .note { font-size: 10px; color: #666; margin: 2px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th { background: #eef2f9; text-align: left; padding: 5px; border: 1px solid #ccc; font-size: 11px; }
  td { padding: 5px; border: 1px solid #ddd; }
  tr.od td { background: #fef2f2; }
  .late { color: #991b1b; font-weight: 600; }
  .muted { color: #888; }
  .empty { padding: 20px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 5px; margin-top: 12px; }
  tr { page-break-inside: avoid; }
</style></head><body>
  <div class="header">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <img src="${getBridgeLogo()}" alt="${COMPANY_NAME}" style="height: 30px; width: auto;" />
      <div style="font-size: 12px; color: #999;">Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
    <div class="document-title">Open Items</div>
    <div class="report-subtitle">Everything still in flight, by route</div>
  </div>

  <div class="cards">
    <div class="card"><div class="label">Open</div><div class="value">${withAge.length}</div></div>
    <div class="card"><div class="label">Overdue</div><div class="value" style="color:${overdue.length ? '#991b1b' : 'inherit'}">${overdue.length}</div></div>
    <div class="card"><div class="label">Due within 7 days</div><div class="value">${dueSoon.length}</div></div>
    <div class="card"><div class="label">Development</div><div class="value">${byRoute(withAge, 'development').length}</div></div>
    <div class="card"><div class="label">ROM Pilot</div><div class="value">${byRoute(withAge, 'rom_pilot').length}</div></div>
  </div>

  ${withAge.length === 0
    ? `<div class="empty"><strong>Nothing open.</strong> Every request is completed, cancelled or archived.</div>`
    : `
      ${routeBlock('Development requests', 'development', 'Priced by the development team.')}
      ${routeBlock('ROM Pilot — self-served', 'rom_pilot', 'Priced against the database by the leasing team.')}
      ${routeBlock('Allowance deals', 'allowance', 'Allowance deals close on creation, so anything here was started and not finished.')}
    `}
</body></html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('[open-items-report] failed:', error);
      res.status(500).json({ message: 'Failed to generate open items report' });
    }
  });
}
