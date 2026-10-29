/**
 * Estimate to Complete report (Adolfo, 2026-10-29): for the executive team. Where the
 * project lands: by budget line (budget, committed, billed, left on commitments, pending
 * change orders, forecast items, estimate to complete and at completion, variance), the
 * forecast items behind it, and the commitments (contract sum, billed, paid, retainage,
 * still to bill). Built from the project bundle.
 */
import { REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, type ReportInfoRow } from './lib/report-shell';
import { FORECAST_KINDS, type ForecastRow } from '@shared/forecast';

const money2 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const sg = (v: number) => (Math.abs(v) < 0.005 ? '<span class="muted">—</span>' : v < 0 ? `(${money2(-v)})` : money2(v));
const shortD = (d: string) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function renderForecastHtml(b: any, x: { info: ReportInfoRow[]; today: string; generatedBy: string | null }): string {
  const F = b.forecast as { rows: ForecastRow[]; orphans: any[]; totals: any; includePending: boolean; kinds: Record<string, number> };
  const T = F.totals;
  const P = b.position.totals;
  const kindLabel = (k: string) => FORECAST_KINDS.find((x) => x.key === k)?.label ?? k;

  // By scope when the budget is grouped, as on screen.
  const used = new Set<string>();
  const groups: Array<{ name: string; rows: ForecastRow[] }> = [];
  for (const sc of (b.scopeSetup ?? []) as Array<{ name: string; lineKeys: string[] }>) {
    const rows = F.rows.filter((r) => sc.lineKeys.includes(r.key) && !used.has(r.key));
    rows.forEach((r) => used.add(r.key));
    if (rows.length) groups.push({ name: sc.name, rows });
  }
  const rest = F.rows.filter((r) => !used.has(r.key));
  if (rest.length) groups.push({ name: groups.length ? 'Other' : '', rows: rest });
  const pend = (r: { pending: number }) => (F.includePending ? r.pending : 0);
  const cells = (v: { budget: number; committed: number; toDate: number; remaining: number; pending: number; forecast: number; etc: number; eac: number; variance: number }) =>
    `<td class="num">${sg(v.budget)}</td><td class="num">${sg(v.committed)}</td><td class="num">${sg(v.toDate)}</td><td class="num">${sg(v.remaining)}</td><td class="num">${sg(pend(v))}</td><td class="num fc">${sg(v.forecast)}</td><td class="num">${sg(v.etc)}</td><td class="num"><strong>${sg(v.eac)}</strong></td><td class="num ${v.variance < -0.005 ? 'over' : 'under'}">${sg(v.variance)}</td>`;
  const sum = (rows: ForecastRow[]) => {
    const s = (k: keyof ForecastRow) => r2(rows.reduce((t, r) => t + (r[k] as number), 0));
    return { budget: s('budget'), committed: s('committed'), toDate: s('toDate'), remaining: s('remaining'), pending: s('pending'), forecast: s('forecast'), etc: s('etc'), eac: s('eac'), variance: s('variance') };
  };
  const lineTable = `
  <table class="t"><thead><tr><th class="l">Budget Line</th><th>Budget</th><th>Committed</th><th>Billed to Date</th><th>Left on Commitments</th><th>Pending COs</th><th>Forecast Items</th><th>Est. to Complete</th><th>Est. at Completion</th><th>Variance</th></tr></thead><tbody>
    ${groups.map((g) => `${g.name ? `<tr class="grp"><td colspan="10">${escapeHtml(g.name)}</td></tr>` : ''}
      ${g.rows.map((r) => `<tr${r.variance < -0.005 ? ' class="neg"' : ''}><td class="${g.name ? 'ind' : ''}">${escapeHtml(r.description)}</td>${cells(r)}</tr>`).join('')}
      ${g.name ? `<tr class="sub"><td>${escapeHtml(g.name)} Subtotal</td>${cells(sum(g.rows))}</tr>` : ''}`).join('')}
    ${F.orphans.length ? `<tr><td class="muted">Forecast on removed lines</td><td colspan="5"></td><td class="num fc">${sg(r2(F.orphans.reduce((t: number, i: any) => t + i.amount, 0)))}</td><td colspan="3"></td></tr>` : ''}
    <tr class="total"><td>Total</td>${cells(T)}</tr>
  </tbody></table>
  <p class="hint">Left on Commitments = committed less billed to date, assumed spent. Estimate to Complete = left on commitments${F.includePending ? ' + pending change orders' : ''} + forecast items. Estimate at Completion = billed to date + estimate to complete. Variance = budget less estimate at completion; (negative) is over budget. Budget not committed or forecast is not counted${T.uncommitted > 0.005 ? ` (${money2(T.uncommitted)} today)` : ''}.</p>`;

  const items = (b.forecastSetup?.items ?? []) as Array<{ key: string; kind: string; description: string; amount: number; note?: string | null; date: string; by?: string | null }>;
  const lineName = (k: string) => F.rows.find((r) => r.key === k)?.description ?? 'Removed line';
  const itemsHtml = items.length ? `<h3 class="sec">Forecast Items</h3>
  <table class="t"><thead><tr><th class="l">Budget Line</th><th class="l">Type</th><th class="l">Description</th><th class="l">Added</th><th>Amount</th></tr></thead><tbody>
    ${[...items].sort((a, c) => lineName(a.key).localeCompare(lineName(c.key))).map((i) => `<tr><td>${escapeHtml(lineName(i.key))}</td><td class="nw">${escapeHtml(kindLabel(i.kind))}</td><td>${escapeHtml(i.description)}${i.note ? `<div class="hint" style="margin:0">${escapeHtml(i.note)}</div>` : ''}</td><td class="nw">${escapeHtml(shortD(i.date))}${i.by ? `<div class="hint" style="margin:0">${escapeHtml(i.by)}</div>` : ''}</td><td class="num">${sg(i.amount)}</td></tr>`).join('')}
    ${FORECAST_KINDS.filter((k) => Math.abs(F.kinds[k.key] ?? 0) >= 0.005).map((k) => `<tr class="sub"><td colspan="4">${escapeHtml(k.label)}</td><td class="num">${sg(F.kinds[k.key])}</td></tr>`).join('')}
    <tr class="total"><td colspan="4">Total Forecast Items</td><td class="num">${sg(T.forecast)}</td></tr>
  </tbody></table>` : '';

  const cname = (cid: number) => { const c = b.contracts.find((y: any) => y.id === cid); return c ? `${c.counterparty}${c.contractNumber ? ` #${c.contractNumber}` : ''}` : 'Contract'; };
  const cs = (b.position.contracts as any[]);
  const commitHtml = cs.length ? `<h3 class="sec">Commitments</h3>
  <table class="t"><thead><tr><th class="l">Contract</th><th>Contract Sum</th><th>Pending COs</th><th>Billed to Date</th><th>%</th><th>Paid</th><th>Retainage Held</th><th>Billed, Unpaid</th><th>Left to Bill</th></tr></thead><tbody>
    ${cs.map((c) => `<tr><td>${escapeHtml(cname(c.contractId))}</td><td class="num">${sg(c.contractSum)}</td><td class="num">${sg(c.pendingChanges)}</td><td class="num">${sg(c.billedToDate)}</td><td class="num">${c.contractSum ? `${((c.billedToDate / c.contractSum) * 100).toFixed(1)}%` : '—'}</td><td class="num">${sg(c.paid)}</td><td class="num">${sg(c.retainageHeld)}</td><td class="num">${sg(c.owed)}</td><td class="num">${sg(c.leftToBill)}</td></tr>`).join('')}
    ${b.position.direct?.count ? `<tr><td>Direct Costs <span class="muted">(${b.position.direct.count})</span></td><td class="num">${sg(b.position.direct.total)}</td><td></td><td class="num">${sg(b.position.direct.total)}</td><td class="num">100.0%</td><td class="num">${sg(b.position.direct.total)}</td><td></td><td></td><td></td></tr>` : ''}
    <tr class="total"><td>Total</td><td class="num">${sg(P.contractSum)}</td><td class="num">${sg(r2(cs.reduce((t, c) => t + (c.pendingChanges || 0), 0)))}</td><td class="num">${sg(P.billedToDate)}</td><td class="num">${P.contractSum ? `${((P.billedToDate / P.contractSum) * 100).toFixed(1)}%` : '—'}</td><td class="num">${sg(P.paid)}</td><td class="num">${sg(P.retainageHeld)}</td><td class="num">${sg(P.owed)}</td><td class="num">${sg(P.leftToBill)}</td></tr>
  </tbody></table>` : '';

  const tile = (k: string, v: string, s = '', cls = '') => `<div class="tile"><div class="k">${k}</div><div class="v ${cls}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const tiles = `<div class="tiles">
    ${tile('Current Budget', money2(T.budget))}
    ${tile('Committed', money2(T.committed), T.budget ? `${((T.committed / T.budget) * 100).toFixed(1)}% of budget` : '')}
    ${tile('Billed to Date', money2(T.toDate), `paid ${money2(P.paid ?? 0)}`)}
    ${tile('Left on Commitments', money2(T.remaining), F.includePending && T.pending ? `+ ${money2(T.pending)} pending COs` : '')}
    ${tile('Forecast Items', sg(T.forecast), items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'none')}
    ${tile('Estimate at Completion', money2(T.eac), `to complete ${money2(T.etc)}`)}
    ${tile(T.variance < -0.005 ? 'Projected Over Budget' : 'Projected Under Budget', money2(Math.abs(T.variance)), '', T.variance < -0.005 ? 'over' : 'under')}
  </div>`;

  const longD = new Date(x.today + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Estimate to Complete</title><style>${REPORT_SHELL_CSS}
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.4in; }
    @page { size: letter landscape; margin: 0.4in; }
    .tiles { display: flex; gap: 6px; margin: 4px 0 10px; }
    .tile { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; }
    .tile .k { font-size: 8px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
    .tile .v { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .tile .s { font-size: 8.5px; color: #6b7280; }
    .t { width: 100%; border-collapse: collapse; font-size: 9.5px; }
    .t thead { display: table-header-group; }
    .t th { text-align: right; font-size: 8px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; border-bottom: 2px solid #111827; padding: 4px 5px; background: #f3f4f6; }
    .t th.l { text-align: left; }
    .t td { padding: 3px 5px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
    .t tr { page-break-inside: avoid; }
    .t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .t td.nw { white-space: nowrap; }
    .t td.ind { padding-left: 14px; }
    .t td.fc { color: #5b21b6; }
    .t tr.grp td { background: #e5e7eb; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; font-size: 9px; }
    .t tr.sub td { font-weight: 600; background: #fafafa; border-top: 1px solid #d1d5db; }
    .t tr.total td { font-weight: 700; background: #f3f4f6; border-top: 2px solid #111827; }
    .t tr.neg td:first-child { color: #991b1b; }
    .over { color: #991b1b; } .under { color: #166534; }
    .muted { color: #9ca3af; }
    .hint { font-size: 9px; color: #6b7280; margin: 4px 0 0; }
    .sec { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #374151; margin: 14px 0 6px; }
  </style></head><body>
  ${reportHeaderHtml({ title: 'Estimate to Complete', info: [...x.info, { label: 'As Of', value: longD }] })}
  ${tiles}
  <h3 class="sec">By Budget Line</h3>
  ${lineTable}
  ${itemsHtml}
  ${commitHtml}
  ${reportFooterHtml({ generatedBy: x.generatedBy })}
  </body></html>`;
}
