/**
 * G702 / G703 Comparison: one pay app, ours against the contractor's.
 *   G702  lines 1–9: ours (worked out from the G703 lines entered) beside theirs
 *         (as typed from their G702) and the difference; then line 8 against
 *         the GC's conditional waiver.
 *   G703  every line as entered — previous, this period, stored, to date,
 *         retainage — grouped base contract, then each change order, with the
 *         change orders approved by this pay app but not billed on it flagged
 *         (the usual reason ours comes out lower).
 * Differences should all be zero; anything else is shaded.
 */
import { lineProgress } from '@shared/cost-tracking';
import { threeWayCheck, type Waiver } from '@shared/cost-waivers';
import { REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, type ReportInfoRow } from './lib/report-shell';

const money2 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const nn = (n: number) => String(n).padStart(3, '0');
const isoDay = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const longDate = (iso: unknown) => (iso ? new Date(isoDay(iso) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) : '');

export interface CompareInput {
  info: ReportInfoRow[];
  contract: { id: number; counterparty: string; contractNumber?: string | null; retainagePct: number };
  app: any; // bundle application: id, number, docNumber, kind, periodEnd, invoiceNumber, g702, contractorG702
  apps: any[]; // every application on the contract (for previous / to date)
  sovLines: Array<{ id: number; contractId: number; changeOrderId: number | null; itemNo?: string | null; description: string; scheduledValue: number }>;
  changeOrders: Array<{ id: number; contractId: number; number: string; title: string | null; status: string; startApp?: number | null }>;
  waivers: Waiver[];
}

export function renderG702CompareSection(x: CompareInput): string {
  const { app, contract } = x;
  const label = `${app.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${nn(app.docNumber ?? app.number)}`;
  const g = app.g702 || {};
  const theirs = app.contractorG702 || {};
  const tw = threeWayCheck(app, x.waivers, contract.counterparty);
  const theirs8 = tw.contractor;
  const diffCell = (ours: number | null | undefined, t: number | null | undefined) => {
    if (t == null || ours == null) return '<td class="num muted">—</td>';
    const d = r2(ours - t);
    return Math.abs(d) < 0.005 ? '<td class="num" style="color:#166534">$0.00</td>' : `<td class="num" style="color:#991b1b;font-weight:700;background:#fef2f2">${d > 0 ? '+' : ''}${money2(d)}</td>`;
  };
  const G702: Array<[string, string, number | null, number | null | undefined]> = [
    ['1', 'Original contract sum', g.originalContractSum, null],
    ['2', 'Net change by change orders', g.netChangeOrders, null],
    ['3', 'Contract sum to date', g.contractSumToDate, theirs.contractSumToDate],
    ['4', 'Total completed and stored to date', g.completedAndStored, theirs.completedAndStored],
    ['5', 'Retainage', g.retainage, theirs.retainage],
    ['6', 'Total earned less retainage', g.earnedLessRetainage, theirs.completedAndStored != null && theirs.retainage != null ? r2(theirs.completedAndStored - theirs.retainage) : null],
    ['7', 'Less previous certificates for payment', g.previousCertificates, theirs.previousCertificates],
    ['8', 'Current payment due', g.currentPaymentDue, theirs8],
    ['9', 'Balance to finish, including retainage', g.balanceToFinish, theirs.contractSumToDate != null && theirs.completedAndStored != null && theirs.retainage != null ? r2(theirs.contractSumToDate - (theirs.completedAndStored - theirs.retainage)) : null],
  ];
  const g702Rows = G702.map(([no, name, ours, t]) => `<tr${no === '8' ? ' style="font-weight:700"' : ''}><td>${no}</td><td>${escapeHtml(name)}${(no === '6' || no === '9') && t != null ? ' <span class="muted" style="font-size:9px">(theirs from lines 3–5)</span>' : ''}</td>
    <td class="num">${ours != null ? money2(ours) : '—'}</td><td class="num">${t != null ? money2(t) : '<span class="muted">Not entered</span>'}</td>${diffCell(ours, t)}</tr>`).join('');
  const condRow = `<tr style="font-weight:700"><td></td><td>GC conditional waiver (should equal line 8)</td><td class="num">${money2(g.currentPaymentDue ?? 0)}</td>
    <td class="num">${tw.conditional != null ? money2(tw.conditional) : '<span class="muted">Not entered</span>'}</td>${diffCell(g.currentPaymentDue, tw.conditional)}</tr>`;

  // G703, as entered: previous (apps before this one), this period, stored, to date, retainage.
  const mine = x.apps.filter((a) => a.contractId === contract.id).sort((a, b) => a.number - b.number);
  const upTo = mine.filter((a) => a.number <= app.number);
  const before = mine.filter((a) => a.number < app.number);
  const now = lineProgress(upTo);
  const prev = lineProgress(before);
  const thisApp = new Map<number, { work: number; stored: number }>((app.lines || []).map((l: any) => [l.sovLineId, { work: Number(l.workThisPeriod) || 0, stored: Number(l.storedToDate) || 0 }]));
  const cos = x.changeOrders.filter((c) => c.contractId === contract.id && c.status !== 'void');
  const onThisApp = (coId: number | null) => {
    if (coId == null) return true;
    const co = cos.find((c) => c.id === coId);
    if (!co || co.status !== 'approved') return false;
    return co.startApp == null || co.startApp <= app.number;
  };
  const groups = [{ id: null as number | null, name: 'Base Contract', co: null as any }, ...cos.map((c) => ({ id: c.id, name: `${c.number}${c.title ? ` — ${c.title}` : ''}`, co: c }))]
    .filter((gr) => onThisApp(gr.id))
    .map((gr) => ({ ...gr, lines: x.sovLines.filter((l) => l.contractId === contract.id && (l.changeOrderId ?? null) === gr.id) }))
    .filter((gr) => gr.lines.length);
  const tot = { sched: 0, prev: 0, work: 0, stored: 0, toDate: 0, ret: 0 };
  const flags: string[] = [];
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '—');
  const body = groups.map((gr) => {
    const sub = { sched: 0, prev: 0, work: 0, stored: 0, toDate: 0, ret: 0 };
    const rows = gr.lines.map((l) => {
      const p = prev.get(l.id), nw = now.get(l.id), t = thisApp.get(l.id) ?? { work: 0, stored: 0 };
      const prevDone = r2((p?.completed ?? 0));
      const toDate = r2(nw?.toDate ?? 0);
      const ret = r2(nw?.retainage ?? 0);
      const v = { sched: r2(l.scheduledValue), prev: prevDone, work: r2(t.work), stored: r2(t.stored), toDate, ret };
      (Object.keys(sub) as (keyof typeof sub)[]).forEach((k) => { sub[k] += v[k]; });
      return `<tr><td>${escapeHtml(l.itemNo ?? '')}</td><td>${escapeHtml(l.description)}</td><td class="num">${money2(v.sched)}</td><td class="num">${money2(v.prev)}</td><td class="num">${money2(v.work)}</td><td class="num">${money2(v.stored)}</td><td class="num">${money2(v.toDate)}</td><td class="num">${pct(v.toDate, v.sched)}</td><td class="num">${money2(r2(v.sched - v.toDate))}</td><td class="num">${money2(v.ret)}</td></tr>`;
    }).join('');
    (Object.keys(tot) as (keyof typeof tot)[]).forEach((k) => { tot[k] += sub[k]; });
    // Approved on this pay app (or before) and nothing billed this period: the usual missing piece.
    const flag = gr.co && gr.co.startApp === app.number && Math.abs(sub.work) < 0.005 && Math.abs(sub.stored) < 0.005;
    if (flag) flags.push(`${gr.co.number} was approved on this pay app (${money2(sub.sched)}) but nothing is entered for it this period.`);
    return `<tr class="grp"${flag ? ' style="background:#fef3c7"' : ''}><td colspan="10">${escapeHtml(gr.name)}${gr.co?.startApp != null ? ` · approved on Pay App ${nn(gr.co.startApp)}` : ''}${flag ? ' · <span style="color:#92400e">nothing entered this period</span>' : ''}</td></tr>${rows}
      <tr class="total"><td></td><td>${escapeHtml(gr.id == null ? 'Base contract' : gr.co.number)} subtotal</td><td class="num">${money2(sub.sched)}</td><td class="num">${money2(sub.prev)}</td><td class="num">${money2(sub.work)}</td><td class="num">${money2(sub.stored)}</td><td class="num">${money2(sub.toDate)}</td><td class="num">${pct(sub.toDate, sub.sched)}</td><td class="num">${money2(r2(sub.sched - sub.toDate))}</td><td class="num">${money2(sub.ret)}</td></tr>`;
  }).join('');
  const grand = `<tr class="total" style="border-top:2px solid #111827"><td></td><td>Total</td><td class="num">${money2(tot.sched)}</td><td class="num">${money2(tot.prev)}</td><td class="num">${money2(tot.work)}</td><td class="num">${money2(tot.stored)}</td><td class="num">${money2(tot.toDate)}</td><td class="num">${pct(tot.toDate, tot.sched)}</td><td class="num">${money2(r2(tot.sched - tot.toDate))}</td><td class="num">${money2(tot.ret)}</td></tr>`;

  const rate = Number(contract.retainagePct) || 0;
  const verdict = tw.status === 'match' ? `<div class="verdict" style="background:#f0fdf4;border:1px solid #86efac;color:#166534;padding:8px 10px;border-radius:6px;font-weight:600">✓ All three agree on line 8: ${money2(g.currentPaymentDue ?? 0)}.</div>`
    : tw.status === 'partial' ? `<div class="verdict" style="background:#f0fdf4;border:1px solid #86efac;color:#166534;padding:8px 10px;border-radius:6px;font-weight:600">✓ The figures entered agree. ${escapeHtml(tw.summary)}.</div>`
    : tw.status === 'off' ? `<div class="verdict" style="background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;padding:8px 10px;border-radius:6px"><strong>⚠ Line 8 doesn't agree.</strong> ${escapeHtml(tw.summary)}.${tw.oursOff != null && tw.oursOff < 0 ? ` Ours is ${money2(-tw.oursOff)} lower: about ${money2(-tw.oursOff / (1 - rate / 100))} of work before retainage is missing from the G703 lines entered.` : tw.oursOff != null ? ` Ours is ${money2(tw.oursOff)} higher than theirs.` : ''}${flags.length ? `<ul style="margin:6px 0 0 18px">${flags.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}</div>`
    : `<div class="verdict" style="background:#f9fafb;border:1px solid #e5e7eb;color:#4b5563;padding:8px 10px;border-radius:6px">The contractor's G702 isn't entered for this pay app yet: type their line 8 (and 3, 4, 5, 7) on the pay app, or in its lien waiver package, to compare.</div>`;

  return `
  <h2 style="font-size:15px;margin:14px 0 6px">${escapeHtml(contract.counterparty)} — ${escapeHtml(label)}${app.invoiceNumber ? ` (${escapeHtml(app.invoiceNumber)})` : ''}${app.periodEnd ? ` · period to ${escapeHtml(longDate(app.periodEnd))}` : ''}</h2>
  ${verdict}
  <h3 class="sec">G702 — Application Summary</h3>
  <table class="t"><thead><tr><th class="l" style="width:28px">Line</th><th class="l"></th><th>Ours</th><th>Contractor's</th><th>Difference</th></tr></thead><tbody>${g702Rows}${condRow}</tbody></table>
  <h3 class="sec">G703 — Continuation Sheet, as Entered</h3>
  <table class="t" style="font-size:10px"><thead><tr><th class="l">Item</th><th class="l">Description</th><th>Scheduled Value</th><th>Previous</th><th>This Period</th><th>Stored</th><th>Total to Date</th><th>%</th><th>Balance to Finish</th><th>Retainage</th></tr></thead><tbody>${body}${grand}</tbody></table>`;
}

export const COMPARE_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.5in; }
  .verdict { font-size: 11px; line-height: 1.45; }
  .t { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .t th { text-align: right; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; border-bottom: 2px solid #111827; padding: 4px 6px; background: #f3f4f6; }
  .t th.l { text-align: left; }
  .t td { padding: 3px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .t tr.grp td { background: #e5e7eb; font-weight: 700; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; }
  .t tr.total td { font-weight: 700; background: #f9fafb; }
  .muted { color: #9ca3af; }
  .sec { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #374151; margin: 14px 0 6px; }
  .page { page-break-before: always; }
`;

export function renderG702CompareHtml(info: ReportInfoRow[], sections: string[], generatedBy: string | null, notes: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>G702 / G703 Comparison</title><style>${REPORT_SHELL_CSS}${COMPARE_CSS}</style></head><body>
  ${reportHeaderHtml({ title: 'G702 / G703 Comparison', info, notes })}
  ${sections.map((s, i) => (i ? `<div class="page">${s}</div>` : s)).join('')}
  <h3 class="sec">Notes</h3>
  <ol style="font-size:10px;color:#4b5563;padding-left:18px">
    <li>Ours: worked out from the G703 lines entered on the pay app. Contractor's: their G702 as typed (line 8 may also be typed in the lien waiver package). Every difference should be $0.00; anything else is shaded.</li>
    <li>When ours is lower, lines are missing from what was entered, most often change order work billed that period. Change orders approved on the pay app with nothing entered for them are shaded in the G703.</li>
    <li>Lines 6 and 9 for the contractor are worked out from their lines 3 to 5 when those are entered.</li>
  </ol>
  ${reportFooterHtml({ generatedBy })}
  </body></html>`;
}
