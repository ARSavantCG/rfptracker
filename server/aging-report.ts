/**
 * Pay App Aging (Adolfo, 2026-10-27): every pay app not yet paid in full, by how long
 * it's been outstanding: Current (0–30 days), 31–60, 61–90, Over 90, counted from the
 * period-to date (the pay app's date), as of a date. By contractor, then each pay app.
 * Retainage is held under the contract, not overdue, so it's shown apart.
 */
import { REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, type ReportInfoRow } from './lib/report-shell';

const money2 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const nn = (n: number) => String(n).padStart(3, '0');
const isoDay = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const shortD = (v: unknown) => { const d = isoDay(v); return d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'; };
const days = (from: string, to: string) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000);

export const AGING_BUCKETS = [
  { key: 'current', label: 'Current (0–30)', max: 30 },
  { key: 'd60', label: '31–60 Days', max: 60 },
  { key: 'd90', label: '61–90 Days', max: 90 },
  { key: 'over', label: 'Over 90 Days', max: Infinity },
] as const;
export const bucketOf = (d: number) => AGING_BUCKETS.find((b) => d <= b.max)!.key;

export function renderAgingHtml(x: {
  info: ReportInfoRow[]; asOf: string;
  contracts: Array<{ id: number; name: string }>;
  apps: Array<{ applicationId: number; contractId: number; docNumber: number; kind: string; date: string; due: number; paid: number; open: number; enteredAt?: string | null; lastPaid?: string | null }>;
  retainage: Array<{ contractId: number; held: number }>;
  generatedBy: string | null;
}): string {
  const name = (cid: number) => x.contracts.find((c) => c.id === cid)?.name ?? 'Contract';
  const open = x.apps.filter((a) => a.open > 0.005 && isoDay(a.date) <= x.asOf)
    .map((a) => { const d = Math.max(0, days(isoDay(a.date), x.asOf)); return { ...a, age: d, bucket: bucketOf(d) }; })
    .sort((a, b) => a.contractId - b.contractId || b.age - a.age);
  const cids = Array.from(new Set(open.map((a) => a.contractId)));
  const sumB = (list: typeof open, k: string) => r2(list.filter((a) => a.bucket === k).reduce((s, a) => s + a.open, 0));
  const tot = (list: typeof open) => r2(list.reduce((s, a) => s + a.open, 0));
  const cell = (v: number, k: string) => `<td class="num${v > 0.005 && (k === 'd90' || k === 'over') ? ' late' : ''}">${v > 0.005 ? money2(v) : '<span class="muted">—</span>'}</td>`;
  const summary = `
  <table class="t"><thead><tr><th class="l">Contractor</th>${AGING_BUCKETS.map((b) => `<th>${b.label}</th>`).join('')}<th>Total Open</th><th>Oldest</th></tr></thead><tbody>
    ${cids.map((cid) => { const l = open.filter((a) => a.contractId === cid); return `<tr><td>${escapeHtml(name(cid))}</td>${AGING_BUCKETS.map((b) => cell(sumB(l, b.key), b.key)).join('')}<td class="num"><strong>${money2(tot(l))}</strong></td><td class="num">${Math.max(...l.map((a) => a.age))} days</td></tr>`; }).join('')}
    <tr class="total"><td>Total</td>${AGING_BUCKETS.map((b) => `<td class="num">${money2(sumB(open, b.key))}</td>`).join('')}<td class="num">${money2(tot(open))}</td><td class="num">${open.length ? `${Math.max(...open.map((a) => a.age))} days` : '—'}</td></tr>
    <tr><td class="muted">Share of open</td>${AGING_BUCKETS.map((b) => `<td class="num muted">${tot(open) ? `${((sumB(open, b.key) / tot(open)) * 100).toFixed(0)}%` : '—'}</td>`).join('')}<td></td><td></td></tr>
  </tbody></table>`;
  const detail = open.length ? `
  <h3 class="sec">By Pay App</h3>
  <table class="t"><thead><tr><th class="l">Contractor</th><th class="l">Pay App</th><th class="l">Period To</th><th class="l">Entered</th><th>Payment Due</th><th>Paid</th><th>Open</th><th>Days Outstanding</th><th class="l" style="text-align:center">Aging</th></tr></thead><tbody>
    ${open.map((a) => `<tr${a.bucket === 'over' || a.bucket === 'd90' ? ' style="background:#fef2f2"' : a.bucket === 'd60' ? ' style="background:#fffbeb"' : ''}><td>${escapeHtml(name(a.contractId))}</td><td class="nw">${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${nn(a.docNumber)}</td><td class="nw">${shortD(a.date)}</td><td class="nw">${a.enteredAt ? shortD(a.enteredAt) : '—'}</td><td class="num">${money2(a.due)}</td><td class="num">${money2(a.paid)}${a.lastPaid ? `<div class="muted" style="font-size:8.5px">last ${shortD(a.lastPaid)}</div>` : ''}</td><td class="num"><strong>${money2(a.open)}</strong></td><td class="num">${a.age}</td><td class="nw" style="text-align:center">${AGING_BUCKETS.find((b) => b.key === a.bucket)!.label}</td></tr>`).join('')}
  </tbody></table>` : '';
  const ret = x.retainage.filter((r) => r.held > 0.005);
  const retHtml = ret.length ? `
  <h3 class="sec">Retainage Held (Not Aged)</h3>
  <table class="t" style="width:60%"><thead><tr><th class="l">Contractor</th><th>Retainage Held</th></tr></thead><tbody>
    ${ret.map((r) => `<tr><td>${escapeHtml(name(r.contractId))}</td><td class="num">${money2(r.held)}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td class="num">${money2(r2(ret.reduce((s, r) => s + r.held, 0)))}</td></tr>
  </tbody></table>
  <p class="hint">Withheld under the contracts and released at completion, so not counted as past due.</p>` : '';
  const longD = new Date(x.asOf + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pay App Aging</title><style>${REPORT_SHELL_CSS}
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.5in; }
    .t { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    .t th { text-align: right; font-size: 8.5px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; border-bottom: 2px solid #111827; padding: 4px 6px; background: #f3f4f6; }
    .t th.l { text-align: left; }
    .t td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .t td.nw { white-space: nowrap; }
    .t td.late { color: #991b1b; font-weight: 700; }
    .t tr.total td { font-weight: 700; background: #f9fafb; border-top: 2px solid #111827; }
    .muted { color: #9ca3af; }
    .hint { font-size: 9.5px; color: #6b7280; margin: 4px 0 0; }
    .sec { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #374151; margin: 14px 0 6px; }
  </style></head><body>
  ${reportHeaderHtml({ title: 'Pay App Aging', info: [...x.info, { label: 'As Of', value: longD }], notes: [`Open on pay apps as of ${longD}, by days since the period-to date: ${money2(tot(open))} on ${open.length} pay app${open.length === 1 ? '' : 's'}.`] })}
  ${open.length ? summary : '<p>Nothing is open: every pay app is paid.</p>'}
  ${detail}
  ${retHtml}
  ${reportFooterHtml({ generatedBy: x.generatedBy })}
  </body></html>`;
}
