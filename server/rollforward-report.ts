/**
 * Billing Roll-Forward: what's been billed through the end of each pay app, so the
 * total at the end of one pay app can be checked against the Previous column on the
 * next (Adolfo, 2026-10-23: "at the end of pay app 7 I should see what they've billed
 * through, and that should be the previous on pay app 8").
 *   By pay app  previous, this period, total to date (from the G703 lines entered),
 *               beside their G702 line 4, and whether their previous rolls forward
 *               from the pay app before (their line 4 less this period's work).
 *   By line     each line's total to date at the end of every pay app; the column for
 *               one pay app is the Previous column on the next.
 */
import { lineProgress } from '@shared/cost-tracking';
import { REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, type ReportInfoRow } from './lib/report-shell';

const money2 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const nn = (n: number) => String(n).padStart(3, '0');
const isoDay = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const shortD = (v: unknown) => { const d = isoDay(v); return d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'; };

export interface RollForwardInput {
  info: ReportInfoRow[];
  contracts: Array<{ id: number; counterparty: string; contractNumber?: string | null }>;
  sovLines: Array<{ id: number; contractId: number; changeOrderId: number | null; itemNo?: string | null; description: string; scheduledValue: number }>;
  changeOrders: Array<{ id: number; contractId: number; number: string; title: string | null; status: string }>;
  applications: any[]; // bundle applications: id, contractId, number, docNumber, kind, periodEnd, createdAt, lines, contractorG702
  generatedBy: string | null;
}

export function renderRollForwardHtml(x: RollForwardInput): string {
  const sections = x.contracts.map((c) => {
    const apps = x.applications.filter((a) => a.contractId === c.id).sort((a, b) => a.number - b.number);
    if (!apps.length) return '';
    const toDateAt = apps.map((_, i) => lineProgress(apps.slice(0, i + 1)));
    const totalAt = toDateAt.map((m) => r2(Array.from(m.values()).reduce((s, v) => s + v.toDate, 0)));
    const label = (a: any) => `${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${nn(a.docNumber ?? a.number)}`;

    // ---- By pay app
    let breaks = 0;
    const rows = apps.map((a, i) => {
      const prev = i ? totalAt[i - 1] : 0;
      const period = r2(totalAt[i] - prev);
      const t4 = a.contractorG702?.completedAndStored;
      const theirPrev = t4 != null ? r2(t4 - period) : null;
      const priorTheirs = i ? apps[i - 1].contractorG702?.completedAndStored : 0;
      const shouldBe = i ? (priorTheirs != null ? priorTheirs : prev) : 0;
      const off = theirPrev != null ? r2(theirPrev - shouldBe) : null;
      if (off != null && Math.abs(off) >= 0.005) breaks++;
      const check = off == null ? '<td class="muted" style="text-align:center">—</td>'
        : Math.abs(off) < 0.005 ? '<td style="text-align:center;color:#166534">✓ Rolls forward</td>'
        : `<td style="text-align:center;color:#991b1b;font-weight:700">Off ${money2(Math.abs(off))}</td>`;
      return `<tr${off != null && Math.abs(off) >= 0.005 ? ' style="background:#fef2f2"' : ''}><td>${label(a)}</td><td>${shortD(a.periodEnd ?? a.createdAt)}</td>
        <td class="num">${money2(prev)}</td><td class="num">${money2(period)}</td><td class="num"><strong>${money2(totalAt[i])}</strong></td>
        <td class="num">${t4 != null ? money2(t4) : '<span class="muted">Not entered</span>'}</td><td class="num">${theirPrev != null ? money2(theirPrev) : '—'}</td>${check}</tr>`;
    }).join('');
    const byApp = `
    <h3 class="sec">By Pay App: Billed Through the End of Each</h3>
    <table class="t"><thead><tr><th class="l">Pay App</th><th class="l">Period To</th><th>Previous</th><th>This Period</th><th>Total Billed to Date</th><th>Their G702 Line 4</th><th>Their Previous<br>(Line 4 Less This Period)</th><th style="text-align:center">Carries Forward?</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="hint">Total billed to date at the end of one pay app should be the previous on the next. "Their previous" is their line 4 less this period's work on the lines; it should equal their line 4 on the pay app before.${breaks ? ` <strong style="color:#991b1b">${breaks} pay app${breaks === 1 ? '' : 's'} where theirs doesn't carry forward.</strong>` : ''}</p>`;

    // ---- By line: total to date at the end of each pay app
    const cos = x.changeOrders.filter((o) => o.contractId === c.id && o.status !== 'void');
    const groups = [{ id: null as number | null, name: 'Base Contract' }, ...cos.map((o) => ({ id: o.id, name: `${o.number}${o.title ? ` — ${o.title}` : ''}` }))]
      .map((g) => ({ ...g, lines: x.sovLines.filter((l) => l.contractId === c.id && (l.changeOrderId ?? null) === g.id) }))
      .filter((g) => g.lines.length);
    const head = apps.map((a) => `<th>${escapeHtml(label(a))}</th>`).join('');
    const body = groups.map((g) => {
      const lineRows = g.lines.map((l) => {
        const cells = apps.map((_, i) => {
          const v = r2(toDateAt[i].get(l.id)?.toDate ?? 0);
          const before = i ? r2(toDateAt[i - 1].get(l.id)?.toDate ?? 0) : 0;
          const moved = Math.abs(v - before) >= 0.005;
          return `<td class="num"${moved ? ' style="font-weight:700"' : ' style="color:#9ca3af"'}>${v ? money2(v) : '—'}</td>`;
        }).join('');
        return `<tr><td>${escapeHtml(l.itemNo ?? '')}</td><td>${escapeHtml(l.description)}</td><td class="num">${money2(l.scheduledValue)}</td>${cells}</tr>`;
      }).join('');
      const sub = apps.map((_, i) => `<td class="num">${money2(r2(g.lines.reduce((s, l) => s + (toDateAt[i].get(l.id)?.toDate ?? 0), 0)))}</td>`).join('');
      return `<tr class="grp"><td colspan="${3 + apps.length}">${escapeHtml(g.name)}</td></tr>${lineRows}
        <tr class="total"><td></td><td>Subtotal</td><td class="num">${money2(r2(g.lines.reduce((s, l) => s + l.scheduledValue, 0)))}</td>${sub}</tr>`;
    }).join('');
    const grand = `<tr class="total" style="border-top:2px solid #111827"><td></td><td>Total Billed to Date</td><td class="num">${money2(r2(groups.reduce((s, g) => s + g.lines.reduce((t, l) => t + l.scheduledValue, 0), 0)))}</td>${totalAt.map((t) => `<td class="num">${money2(t)}</td>`).join('')}</tr>`;
    const byLine = `
    <h3 class="sec">By Line: Total to Date at the End of Each Pay App</h3>
    <p class="hint" style="margin-top:0">Each pay app's column is what the next pay app's G703 should show as Previous (Column D), line by line. Bold: billed on that pay app.</p>
    <table class="t wide"><thead><tr><th class="l">Item</th><th class="l">Description</th><th>Scheduled Value</th>${head}</tr></thead><tbody>${body}${grand}</tbody></table>`;

    return `<h2 style="font-size:15px;margin:14px 0 4px">${escapeHtml(c.counterparty)}${c.contractNumber ? ` #${escapeHtml(c.contractNumber)}` : ''}</h2>${byApp}${byLine}`;
  }).filter(Boolean);

  return `<!doctype html><html><head><meta charset="utf-8"><title>Billing Roll-Forward</title><style>${REPORT_SHELL_CSS}
    @page { size: Letter landscape; margin: 0.4in; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.4in; }
    .t { width: 100%; border-collapse: collapse; font-size: 10px; }
    .t.wide { font-size: 8.5px; }
    .t th { text-align: right; font-size: 8.5px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; border-bottom: 2px solid #111827; padding: 4px 5px; background: #f3f4f6; vertical-align: bottom; }
    .t th.l { text-align: left; }
    .t td { padding: 3px 5px; border-bottom: 1px solid #e5e7eb; }
    .t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .t tr.grp td { background: #e5e7eb; font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
    .t tr.total td { font-weight: 700; background: #f9fafb; }
    .muted { color: #9ca3af; }
    .hint { font-size: 9.5px; color: #6b7280; margin: 4px 0 0; }
    .sec { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #374151; margin: 14px 0 6px; }
  </style></head><body>
  ${reportHeaderHtml({ title: 'Billing Roll-Forward', info: x.info, notes: [] })}
  ${sections.length ? sections.join('<div style="page-break-before:always"></div>') : '<p>No pay apps yet.</p>'}
  ${reportFooterHtml({ generatedBy: x.generatedBy })}
  </body></html>`;
}
