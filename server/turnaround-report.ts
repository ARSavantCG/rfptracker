/**
 * Turnaround report — internal due date vs. the date an RFP actually published.
 *
 * Accountability, not blame. It answers three questions:
 *   - did we hit the internal deadline, and by how much
 *   - how long did the work actually take from receipt to publish
 *   - which are still open and already late
 *
 * NOTE ON DATA AGE: publishedDate was only auto-stamped from 2026-08-19. RFPs
 * published before then have a blank date unless someone typed it in by hand, so
 * they cannot be scored. Those are reported SEPARATELY as unmeasurable rather
 * than counted as misses — scoring the team against records the app never
 * captured would be worse than not scoring at all.
 */
import type { Express } from 'express';
import { db } from './db';
import { rfpRequests, properties } from '@shared/schema';
import { asc } from 'drizzle-orm';
import { requireAuthFlexible, checkPermission } from './middleware';
import { getBrandLogo as getBridgeLogo, BRAND_COLOR_PRIMARY, COMPANY_NAME } from './lib/branding';

function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Whole days between two dates, ignoring time of day. */
function daysBetween(a: Date, b: Date): number {
  const d1 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const d2 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

export function registerTurnaroundReport(app: Express) {
  app.get('/api/reports/turnaround', requireAuthFlexible, checkPermission('admin.access'), async (req, res) => {
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
          receivedOn: rfpRequests.receivedOn,
          internalDueDate: rfpRequests.internalDueDate,
          publishedDate: rfpRequests.publishedDate,
        })
        .from(rfpRequests)
        .orderBy(asc(rfpRequests.internalDueDate));

      // Property names resolved in JS: rfp_requests.property is TEXT holding the
      // id, properties.id is serial, and Postgres rejects that join.
      const propRows = await db
        .select({ id: properties.id, propertyName: properties.propertyName, building: properties.building })
        .from(properties);
      const propById = new Map(propRows.map((p) => [String(p.id), p]));
      const propLabel = (ref: string | null) => {
        const p = ref ? propById.get(String(ref)) : undefined;
        if (!p) return '—';
        return p.building ? `${p.propertyName} - Bldg. ${p.building}` : p.propertyName;
      };

      const now = new Date();
      const HIDDEN = ['cancelled', 'archived'];

      type Scored = {
        row: typeof rows[number];
        variance: number | null;   // + = late, - = early, null = unmeasurable
        elapsed: number | null;    // received -> published
        state: 'on-time' | 'late' | 'open-late' | 'open' | 'unmeasurable';
      };

      const scored: Scored[] = rows
        .filter((r) => !HIDDEN.includes(String(r.status || '')))
        .map((r) => {
          const due = r.internalDueDate ? new Date(r.internalDueDate) : null;
          const pub = r.publishedDate ? new Date(r.publishedDate) : null;
          const rec = r.receivedOn ? new Date(r.receivedOn) : null;
          const isPublished = r.workflowPhase === 'publish' || r.status === 'completed';

          if (pub && due) {
            const variance = daysBetween(due, pub);
            return {
              row: r,
              variance,
              elapsed: rec ? daysBetween(rec, pub) : null,
              state: variance <= 0 ? 'on-time' : 'late',
            };
          }

          // Published but no date recorded — predates the auto-stamp. Reporting
          // this as a miss would blame the team for a gap in the app.
          if (isPublished && !pub) {
            return { row: r, variance: null, elapsed: null, state: 'unmeasurable' };
          }

          if (due) {
            const overdueBy = daysBetween(due, now);
            return {
              row: r,
              variance: overdueBy > 0 ? overdueBy : null,
              elapsed: null,
              state: overdueBy > 0 ? 'open-late' : 'open',
            };
          }

          return { row: r, variance: null, elapsed: null, state: 'unmeasurable' };
        });

      const measured = scored.filter((s) => s.variance !== null && (s.state === 'on-time' || s.state === 'late'));
      const onTime = measured.filter((s) => s.state === 'on-time');
      const late = measured.filter((s) => s.state === 'late');
      const openLate = scored.filter((s) => s.state === 'open-late');
      const open = scored.filter((s) => s.state === 'open');
      const unmeasurable = scored.filter((s) => s.state === 'unmeasurable');

      const avgVariance = measured.length
        ? measured.reduce((sum, s) => sum + (s.variance ?? 0), 0) / measured.length
        : null;
      const elapsedVals = measured.map((s) => s.elapsed).filter((n): n is number => n != null);
      const avgElapsed = elapsedVals.length
        ? elapsedVals.reduce((a, b) => a + b, 0) / elapsedVals.length
        : null;
      const onTimePct = measured.length ? Math.round((onTime.length / measured.length) * 100) : null;

      if (req.query.format === 'json') {
        return res.json({
          summary: {
            measured: measured.length,
            onTime: onTime.length,
            late: late.length,
            onTimePct,
            avgVarianceDays: avgVariance,
            avgElapsedDays: avgElapsed,
            openLate: openLate.length,
            open: open.length,
            unmeasurable: unmeasurable.length,
          },
          rows: scored.map((s) => ({ ...s.row, variance: s.variance, elapsed: s.elapsed, state: s.state })),
        });
      }

      const varianceCell = (s: Scored) => {
        if (s.state === 'unmeasurable') return '<span class="muted">no publish date</span>';
        if (s.state === 'open') return '<span class="muted">in progress</span>';
        if (s.variance === null) return '—';
        if (s.state === 'open-late') return `<span class="late">${s.variance}d overdue</span>`;
        if (s.variance === 0) return '<span class="ontime">on time</span>';
        return s.variance < 0
          ? `<span class="ontime">${Math.abs(s.variance)}d early</span>`
          : `<span class="late">${s.variance}d late</span>`;
      };

      const section = (title: string, list: Scored[], note?: string) => {
        if (list.length === 0) return '';
        return `
        <h3>${escapeHtml(title)} <span class="count">${list.length}</span></h3>
        ${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}
        <table>
          <thead>
            <tr>
              <th style="width:12%">RFP #</th>
              <th style="width:30%">Project</th>
              <th style="width:22%">Property</th>
              <th style="width:11%">Received</th>
              <th style="width:11%">Internal Due</th>
              <th style="width:11%">Published</th>
              <th style="width:13%">Variance</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((s) => `
              <tr>
                <td>${escapeHtml(s.row.rfpNumber || '')}</td>
                <td>${escapeHtml(s.row.projectName || s.row.tenantName || '')}</td>
                <td>${escapeHtml(propLabel(s.row.propertyRef))}</td>
                <td>${fmtDate(s.row.receivedOn)}</td>
                <td>${fmtDate(s.row.internalDueDate)}</td>
                <td>${fmtDate(s.row.publishedDate)}</td>
                <td>${varianceCell(s)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
      };

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>RFP Turnaround Report</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; margin: 24px; color: #222; font-size: 12px; }
  .report-subtitle { text-align: center; color: #666; font-size: 12px; margin-top: 4px; }
  .document-title { font-size: 22px; font-weight: bold; background: ${BRAND_COLOR_PRIMARY}; color: #fff; padding: 10px; border-radius: 5px; text-align: center; }
  .generated { text-align: right; color: #666; font-size: 10px; margin-top: 6px; }
  .cards { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
  .card { flex: 1; min-width: 130px; border: 1px solid #ddd; border-radius: 5px; padding: 8px 10px; }
  .card .label { font-size: 10px; color: #666; }
  .card .value { font-size: 20px; font-weight: bold; }
  h3 { margin: 22px 0 4px; font-size: 14px; border-bottom: 2px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 3px; }
  h3 .count { font-size: 11px; font-weight: normal; color: #666; }
  .note { font-size: 10px; color: #666; margin: 2px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #eef2f9; text-align: left; padding: 5px; border: 1px solid #ccc; font-size: 11px; }
  td { padding: 5px; border: 1px solid #ddd; }
  .ontime { color: #065f46; font-weight: 600; }
  .late { color: #991b1b; font-weight: 600; }
  .muted { color: #888; }
  .empty { padding: 20px; background: #fff8e1; border: 1px solid #ffe082; border-radius: 5px; margin-top: 12px; }
  tr { page-break-inside: avoid; }
</style></head><body>
  <div class="header">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <img src="${getBridgeLogo()}" alt="${COMPANY_NAME}" style="height: 30px; width: auto;" />
      <div style="font-size: 12px; color: #999;">Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
    <div class="document-title">RFP Turnaround Report</div>
    <div class="report-subtitle">Internal Due Date vs. Actual Publish Date</div>
  </div>

  <div class="cards">
    <div class="card"><div class="label">On-time rate</div><div class="value">${onTimePct === null ? '—' : onTimePct + '%'}</div></div>
    <div class="card"><div class="label">Measured</div><div class="value">${measured.length}</div></div>
    <div class="card"><div class="label">Avg vs. due date</div><div class="value">${avgVariance === null ? '—' : (avgVariance > 0 ? '+' : '') + avgVariance.toFixed(1) + 'd'}</div></div>
    <div class="card"><div class="label">Avg receipt → publish</div><div class="value">${avgElapsed === null ? '—' : avgElapsed.toFixed(1) + 'd'}</div></div>
    <div class="card"><div class="label">Open &amp; overdue</div><div class="value" style="color:${openLate.length ? '#991b1b' : 'inherit'}">${openLate.length}</div></div>
  </div>

  ${measured.length === 0 && openLate.length === 0 && open.length === 0
    ? `<div class="empty">Nothing to measure yet. publishedDate began recording automatically on 19 Aug 2026, so this report fills in as RFPs are published from now on.</div>`
    : ''}

  ${section('Open and overdue', openLate, 'Past the internal due date and not yet published.')}
  ${section('Missed the internal date', late)}
  ${section('Met the internal date', onTime)}
  ${section('In progress', open, 'Not yet due.')}
  ${section('Not measurable', unmeasurable,
      'Published before publish dates were recorded automatically (19 Aug 2026), or missing an internal due date. Excluded from the on-time rate rather than counted as misses.')}
</body></html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('[turnaround-report] failed:', error);
      res.status(500).json({ message: 'Failed to generate turnaround report' });
    }
  });
}
