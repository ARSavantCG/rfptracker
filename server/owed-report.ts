/**
 * Owed by Vendor: for every pay app not yet paid in full, each vendor's conditional
 * waiver on it and their total (Adolfo, 2026-10-23). The GC's line covers its subs'.
 */
import type { OwedRow } from '@shared/cost-waivers';
import { REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, type ReportInfoRow } from './lib/report-shell';

const money2 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const nn = (n: number) => String(n).padStart(3, '0');

export function renderOwedHtml(x: { info: ReportInfoRow[]; asOf: string; outstandingOnly: boolean; apps: Array<{ id: number; docNumber: number; paid: boolean }>; rows: OwedRow[]; subTotal: number; subOwed: number; gcTotal: number; gcOwed: number; subByApp: Record<number, number>; generatedBy: string | null }): string {
  const head = x.apps.map((a) => `<th${a.paid ? ' style="color:#9ca3af"' : ''}>Pay App ${nn(a.docNumber)}${a.paid ? '<div style="font-size:7.5px;color:#166534">Paid</div>' : ''}</th>`).join('');
  const cell = (r: OwedRow, id: number) => {
    const v = r.byApp[id];
    const paid = x.apps.find((a) => a.id === id)?.paid;
    return v ? `<td class="num"${paid ? ' style="color:#9ca3af"' : ''}>${money2(v.amount)}${v.received || paid ? '' : '<div style="font-size:8px;color:#92400e">not received</div>'}</td>` : '<td class="num muted">—</td>';
  };
  const gc = x.rows.filter((r) => r.party === 'gc'), subs = x.rows.filter((r) => r.party === 'sub');
  const row = (r: OwedRow) => `<tr><td${r.party === 'gc' ? ' style="font-weight:700"' : ' style="padding-left:16px"'}>${escapeHtml(r.vendor)}</td>${x.apps.map((a) => cell(r, a.id)).join('')}${x.outstandingOnly ? '' : `<td class="num">${money2(r.total)}</td>`}<td class="num"><strong>${money2(r.owed)}</strong></td></tr>`;
  const body = `${gc.map(row).join('')}
    ${subs.length ? `<tr class="grp"><td colspan="${x.apps.length + (x.outstandingOnly ? 2 : 3)}">Subcontractors and Vendors (paid by the GC from the above)</td></tr>${subs.map(row).join('')}
    <tr class="total"><td>Subcontractors Total</td>${x.apps.map((a) => `<td class="num">${money2(x.subByApp[a.id] ?? 0)}</td>`).join('')}${x.outstandingOnly ? '' : `<td class="num">${money2(x.subTotal)}</td>`}<td class="num">${money2(x.subOwed)}</td></tr>` : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Owed by Vendor</title><style>${REPORT_SHELL_CSS}
    ${x.apps.length > 4 ? '@page { size: Letter landscape; margin: 0.5in; }' : ''}
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.5in; }
    .t { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    .t th { text-align: right; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; border-bottom: 2px solid #111827; padding: 4px 6px; background: #f3f4f6; }
    .t th.l { text-align: left; }
    .t td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .t tr.grp td { background: #e5e7eb; font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
    .t tr.total td { font-weight: 700; background: #f9fafb; border-top: 2px solid #111827; }
    .muted { color: #9ca3af; }
  </style></head><body>
  ${reportHeaderHtml({ title: 'Owed by Vendor', info: x.info, notes: [`${x.outstandingOnly ? 'Conditional releases on pay apps not yet paid in full' : 'Conditional releases on every pay app; still owed counts only pay apps not yet paid in full'}, as of ${new Date(x.asOf + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })}.`] })}
  ${x.apps.length ? `<table class="t"><thead><tr><th class="l">Vendor</th>${head}${x.outstandingOnly ? '' : '<th>Total Released</th>'}<th>Still Owed</th></tr></thead><tbody>${body}</tbody></table>` : `<p>${x.outstandingOnly ? 'Every pay app is paid.' : 'No pay apps yet.'}</p>`}
  ${reportFooterHtml({ generatedBy: x.generatedBy })}
  </body></html>`;
}
