/**
 * G702 / G703 Comparison: one pay app, ours against the contractor's.
 *   G702  lines 1–9: ours (worked out from the G703 lines entered) beside theirs
 *         (as typed from their G702) and the difference; then line 8 against
 *         the GC's conditional waiver.
 *   G703  every line as entered — previous, this period, stored, to date,
 *         retainage — grouped base contract, then each change order, with the
 *         change orders approved by this pay app but not billed on it flagged
 *         (the usual reason ours comes out lower).
 *   Line by line, when the contractor's G703 has been read (AI, from the pay app
 *         PDF): each line's this period, total to date and retainage, ours beside
 *         theirs with the difference, and their rows that match no line of ours.
 *         That's where the real error shows: which line, and by how much.
 * Differences should all be zero; anything else is shaded.
 */
import { lineProgress } from '@shared/cost-tracking';
import { threeWayCheck, type Waiver } from '@shared/cost-waivers';
import { matchRows, workOfRow, type ReadRow } from '@shared/cost-payapp-read';
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
    // Line 1 is the base contract on the Contracts tab; their line 2 is their line 3 less line 1,
    // so a change order they carry that isn't approved here shows up on line 2.
    ['1', 'Original contract sum', g.originalContractSum, g.originalContractSum],
    ['2', 'Net change by change orders', g.netChangeOrders, theirs.contractSumToDate != null && g.originalContractSum != null ? r2(theirs.contractSumToDate - g.originalContractSum) : null],
    ['3', 'Contract sum to date', g.contractSumToDate, theirs.contractSumToDate],
    ['4', 'Total completed and stored to date', g.completedAndStored, theirs.completedAndStored],
    ['5', 'Retainage', g.retainage, theirs.retainage],
    ['6', 'Total earned less retainage', g.earnedLessRetainage, theirs.completedAndStored != null && theirs.retainage != null ? r2(theirs.completedAndStored - theirs.retainage) : null],
    ['7', 'Less previous certificates for payment', g.previousCertificates, theirs.previousCertificates],
    ['8', 'Current payment due', g.currentPaymentDue, theirs8],
    ['9', 'Balance to finish, including retainage', g.balanceToFinish, theirs.contractSumToDate != null && theirs.completedAndStored != null && theirs.retainage != null ? r2(theirs.contractSumToDate - (theirs.completedAndStored - theirs.retainage)) : null],
  ];
  const g702Rows = G702.map(([no, name, ours, t]) => `<tr${no === '8' ? ' style="font-weight:700"' : ''}><td>${no}</td><td>${escapeHtml(name)}${(no === '6' || no === '9') && t != null ? ' <span class="muted" style="font-size:9px">(theirs from lines 3–5)</span>' : no === '5' && Math.abs(Number(app.retainageAdj) || 0) >= 0.005 ? ` <span style="font-size:9px;color:#6d28d9">(ours includes an accepted rounding adjustment of ${Number(app.retainageAdj) > 0 ? '+' : ''}${money2(Number(app.retainageAdj))})</span>` : no === '1' ? ' <span class="muted" style="font-size:9px">(base contract, Contracts tab)</span>' : no === '2' && t != null ? ' <span class="muted" style="font-size:9px">(theirs: line 3 less line 1; ours: approved change orders)</span>' : ''}</td>
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

  // ---- Line by line against their G703 (when it has been read).
  const g703 = app.contractorG703 && Array.isArray(app.contractorG703.rows) ? app.contractorG703 : null;
  const lineDiffs: string[] = [];
  let lineTable = '';
  if (g703) {
    const ourLines = x.sovLines.filter((l) => l.contractId === contract.id && (l.changeOrderId == null || cos.some((c) => c.id === l.changeOrderId)));
    const m = matchRows({ applicationNumber: null, invoiceNumber: null, periodFrom: null, periodTo: null, contractor: null, g702: {}, rows: g703.rows as ReadRow[], warnings: [] },
      ourLines.map((l) => ({ id: l.id, itemNo: l.itemNo ?? null, description: l.description, scheduledValue: l.scheduledValue })));
    const theirsOf = new Map(m.matched.map((mm) => [mm.sovLineId, mm.row]));
    const theirToDate = (r: ReadRow) => (r.totalToDate != null ? r.totalToDate : r2((r.previous ?? 0) + workOfRow(r) + (r.stored ?? 0)));
    const T = { ow: 0, tw: 0, ot: 0, tt: 0, or: 0, tr: 0 };
    const cell = (v: number | null) => (v == null ? '<td class="num muted">—</td>' : `<td class="num">${money2(v)}</td>`);
    const dcell = (o: number, t: number | null) => {
      if (t == null) return '<td class="num muted">—</td>';
      const d = r2(o - t);
      return Math.abs(d) < 0.005 ? '<td class="num" style="color:#9ca3af">$0.00</td>' : `<td class="num" style="color:#991b1b;font-weight:700">${d > 0 ? '+' : ''}${money2(d)}</td>`;
    };
    const rowHtml = (item: string, desc: string, o: { w: number; t: number; r: number } | null, th: ReadRow | null, note = '') => {
      const tw = th ? r2(workOfRow(th)) : null, tt = th ? r2(theirToDate(th)) : null, tr = th && th.retainage != null ? r2(th.retainage) : null;
      const ow = o?.w ?? 0, ot = o?.t ?? 0, orr = o?.r ?? 0;
      T.ow += ow; T.ot += ot; T.or += orr; T.tw += tw ?? 0; T.tt += tt ?? 0; T.tr += tr ?? 0;
      const off = (t: number | null, ov: number) => t != null && Math.abs(r2(ov - t)) >= 0.005;
      // A line they didn't list counts as zero on theirs when ours has something on it.
      const missingTheirs = !th && (Math.abs(ow) >= 0.005 || Math.abs(ot) >= 0.005);
      const bad = off(tw, ow) || off(tt, ot) || off(tr, orr) || missingTheirs || (!o && th != null);
      if (bad) {
        const parts: string[] = [];
        if (!o && th) parts.push(`on their G703 only: ${money2(tw ?? 0)} this period, ${money2(tt ?? 0)} to date`);
        else if (missingTheirs) parts.push(`not on their G703: ours ${money2(ow)} this period, ${money2(ot)} to date`);
        else {
          if (off(tw, ow)) parts.push(`this period ours ${money2(ow)}, theirs ${money2(tw!)} (${r2(ow - tw!) > 0 ? '+' : ''}${money2(r2(ow - tw!))})`);
          if (off(tt, ot) && !(off(tw, ow) && Math.abs(r2(ot - tt!) - r2(ow - tw!)) < 0.005)) parts.push(`to date ours ${money2(ot)}, theirs ${money2(tt!)} (${r2(ot - tt!) > 0 ? '+' : ''}${money2(r2(ot - tt!))})`);
          if (off(tr, orr)) parts.push(`retainage ours ${money2(orr)}, theirs ${money2(tr!)}`);
        }
        lineDiffs.push(`${item ? `Item ${item} · ` : ''}${desc}: ${parts.join('; ')}`);
      }
      const theirsMissing = '<td class="num muted" colspan="1">—</td>';
      return `<tr${bad ? ' style="background:#fef2f2"' : ''}><td>${escapeHtml(item)}</td><td>${escapeHtml(desc)}${note}</td>
        ${o ? cell(ow) : '<td class="num muted">—</td>'}${cell(tw)}${o ? dcell(ow, th ? tw : (missingTheirs ? 0 : null)) : dcell(0, tw)}
        ${o ? cell(ot) : '<td class="num muted">—</td>'}${cell(tt)}${o ? dcell(ot, th ? tt : (missingTheirs ? 0 : null)) : dcell(0, tt)}
        ${o ? cell(orr) : '<td class="num muted">—</td>'}${th ? cell(tr) : theirsMissing}${o ? dcell(orr, th ? tr : (missingTheirs ? 0 : null)) : dcell(0, tr)}</tr>`;
    };
    const lgroups = [{ id: null as number | null, name: 'Base Contract' }, ...cos.map((c) => ({ id: c.id, name: `${c.number}${c.title ? ` — ${c.title}` : ''}` }))];
    let body2 = '';
    for (const gr of lgroups) {
      const rows = ourLines.filter((l) => (l.changeOrderId ?? null) === gr.id).map((l) => {
        const nw = now.get(l.id), t = thisApp.get(l.id) ?? { work: 0, stored: 0 };
        const o = { w: r2(t.work), t: r2(nw?.toDate ?? 0), r: r2(nw?.retainage ?? 0) };
        const th = theirsOf.get(l.id) ?? null;
        if (!th && Math.abs(o.w) < 0.005 && Math.abs(o.t) < 0.005 && Math.abs(o.r) < 0.005) return '';
        const sv = th?.scheduledValue != null && Math.abs(th.scheduledValue - l.scheduledValue) >= 0.005
          ? ` <span style="color:#92400e;font-size:9px">(their scheduled value ${money2(th.scheduledValue)}, ours ${money2(l.scheduledValue)})</span>` : '';
        return rowHtml(l.itemNo ?? '', l.description, o, th, sv);
      }).filter(Boolean);
      if (rows.length) body2 += `<tr class="grp"><td colspan="11">${escapeHtml(gr.name)}</td></tr>${rows.join('')}`;
    }
    const extra = m.unmatched.filter((r) => Math.abs(workOfRow(r)) >= 0.005 || Math.abs(theirToDate(r)) >= 0.005 || Math.abs(r.retainage ?? 0) >= 0.005);
    if (extra.length) body2 += `<tr class="grp" style="background:#fee2e2"><td colspan="11">On Their G703, Not Matched to a Line of Ours</td></tr>${extra.map((r) => rowHtml(r.itemNo ?? '', `${r.changeOrder ? `${r.changeOrder} · ` : ''}${r.description}`, null, r)).join('')}`;
    const tot2 = `<tr class="total" style="border-top:2px solid #111827"><td></td><td>Total</td><td class="num">${money2(r2(T.ow))}</td><td class="num">${money2(r2(T.tw))}</td>${dcell(r2(T.ow), r2(T.tw))}<td class="num">${money2(r2(T.ot))}</td><td class="num">${money2(r2(T.tt))}</td>${dcell(r2(T.ot), r2(T.tt))}<td class="num">${money2(r2(T.or))}</td><td class="num">${money2(r2(T.tr))}</td>${dcell(r2(T.or), r2(T.tr))}</tr>`;
    lineTable = `
  <h3 class="sec">G703 — Line by Line, Ours vs the Contractor's</h3>
  <p style="font-size:9.5px;color:#6b7280;margin:0 0 4px">Theirs: from ${escapeHtml(g703.fileName || 'their pay app')}. Difference is ours less theirs; ${lineDiffs.length ? `<strong style="color:#991b1b">${lineDiffs.length} line${lineDiffs.length === 1 ? '' : 's'} differ${lineDiffs.length === 1 ? 's' : ''}</strong> (shaded).` : '<strong style="color:#166534">every line agrees.</strong>'}</p>
  <table class="t lbl"><thead>
    <tr><th class="l" rowspan="2">Item</th><th class="l" rowspan="2">Description</th><th colspan="3" style="text-align:center;border-bottom:1px solid #d1d5db">This Period</th><th colspan="3" style="text-align:center;border-bottom:1px solid #d1d5db">Total to Date</th><th colspan="3" style="text-align:center;border-bottom:1px solid #d1d5db">Retainage</th></tr>
    <tr><th>Ours</th><th>Theirs</th><th>Difference</th><th>Ours</th><th>Theirs</th><th>Difference</th><th>Ours</th><th>Theirs</th><th>Difference</th></tr>
  </thead><tbody>${body2}${tot2}</tbody></table>`;
  }

  const rate = Number(contract.retainagePct) || 0;
  const verdict = tw.status === 'match' ? `<div class="verdict" style="background:#f0fdf4;border:1px solid #86efac;color:#166534;padding:8px 10px;border-radius:6px;font-weight:600">✓ All three agree on line 8: ${money2(g.currentPaymentDue ?? 0)}.</div>`
    : tw.status === 'partial' ? `<div class="verdict" style="background:#f0fdf4;border:1px solid #86efac;color:#166534;padding:8px 10px;border-radius:6px;font-weight:600">✓ The figures entered agree. ${escapeHtml(tw.summary)}.</div>`
    : tw.status === 'off' ? `<div class="verdict" style="background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;padding:8px 10px;border-radius:6px"><strong>⚠ Line 8 doesn't agree.</strong> ${escapeHtml(tw.summary)}.${tw.oursOff != null && tw.oursOff < 0 ? ` Ours is ${money2(-tw.oursOff)} lower: about ${money2(-tw.oursOff / (1 - rate / 100))} of work before retainage is missing from the G703 lines entered.` : tw.oursOff != null ? ` Ours is ${money2(tw.oursOff)} higher than theirs.` : ''}${(() => {
      // Where it comes from: if lines 3 and 7 agree, the contract sum and the earlier pay apps carry over fine.
      const eq = (a: unknown, b: unknown) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005;
      const d4 = theirs.completedAndStored != null && g.completedAndStored != null ? r2(g.completedAndStored - theirs.completedAndStored) : null;
      if (!eq(g.contractSumToDate, theirs.contractSumToDate) || !eq(g.previousCertificates, theirs.previousCertificates) || d4 == null || Math.abs(d4) < 0.005) return '';
      return `<div style="margin-top:4px">Lines 3 and 7 agree, so the contract sum and the earlier pay apps carry over correctly. The difference is in work completed and stored this period: line 4 is off ${money2(Math.abs(d4))}. Check their G703 column totals against their G702 line 4, and look for a line, a change order line, or stored materials (column F) entered short.</div>`;
    })()}${flags.length ? `<ul style="margin:6px 0 0 18px">${flags.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}</div>`
    : `<div class="verdict" style="background:#f9fafb;border:1px solid #e5e7eb;color:#4b5563;padding:8px 10px;border-radius:6px">The contractor's G702 isn't entered for this pay app yet: type their line 8 (and 3, 4, 5, 7) on the pay app, or in its lien waiver package, to compare.</div>`;

  const shown = lineDiffs.slice(0, 12);
  const lineNote = g703
    ? (lineDiffs.length ? `<div class="verdict" style="background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;padding:8px 10px;border-radius:6px;margin-top:6px"><strong>Line by line against their G703: ${lineDiffs.length} line${lineDiffs.length === 1 ? '' : 's'} differ${lineDiffs.length === 1 ? 's' : ''}.</strong><ul style="margin:4px 0 0 18px">${shown.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}${lineDiffs.length > shown.length ? `<li>and ${lineDiffs.length - shown.length} more, shaded below</li>` : ''}</ul></div>`
      : `<div class="verdict" style="background:#f0fdf4;border:1px solid #86efac;color:#166534;padding:6px 10px;border-radius:6px;margin-top:6px">✓ Line by line, every G703 line agrees with theirs.</div>`)
    : '';
  return `
  <h2 style="font-size:15px;margin:14px 0 6px">${escapeHtml(contract.counterparty)} — ${escapeHtml(label)}${app.invoiceNumber ? ` (${escapeHtml(app.invoiceNumber)})` : ''}${app.periodEnd ? ` · Period To ${escapeHtml(longDate(app.periodEnd))}` : ''}</h2>
  ${verdict}
  ${lineNote}
  <h3 class="sec">G702 — Application Summary</h3>
  <table class="t"><thead><tr><th class="l" style="width:28px">Line</th><th class="l"></th><th>Ours</th><th>Contractor's</th><th>Difference</th></tr></thead><tbody>${g702Rows}${condRow}</tbody></table>${lineTable}
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
  .t.lbl { font-size: 9.5px; }
  .t.lbl td { padding: 3px 4px; }
  .t.lbl th { padding: 3px 4px; }
`;

export function renderG702CompareHtml(info: ReportInfoRow[], sections: string[], generatedBy: string | null, notes: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>G702 / G703 Comparison</title><style>${REPORT_SHELL_CSS}${COMPARE_CSS}</style></head><body>
  ${reportHeaderHtml({ title: 'G702 / G703 Comparison', info, notes })}
  ${sections.map((s, i) => (i ? `<div class="page">${s}</div>` : s)).join('')}
  <h3 class="sec">Notes</h3>
  <ol style="font-size:10px;color:#4b5563;padding-left:18px">
    <li>Ours: worked out from the G703 lines entered on the pay app. Contractor's: their G702 as typed (line 8 may also be typed in the lien waiver package). Every difference should be $0.00; anything else is shaded.</li>
    <li>When ours is lower, lines are missing from what was entered, most often change order work billed that period. Change orders approved on the pay app with nothing entered for them are shaded in the G703.</li>
    <li>Line 1 is the base contract as entered on the Contracts tab; ours on line 2 is the change orders approved on the Contracts tab through this pay app, theirs is their line 3 less line 1. A difference on line 2 means they carry a change order that isn't approved here (or the reverse).</li>
    <li>Lines 6 and 9 for the contractor are worked out from their lines 3 to 5 when those are entered.</li>
    <li>Line by line (when their G703 lines are on file): each of their rows matched to our line by item number, description or scheduled value. Their total to date is column G (or D + E + F when G is blank). Rows of theirs that match no line of ours are listed at the end; a line of ours they don't list counts as zero on theirs.</li>
  </ol>
  ${reportFooterHtml({ generatedBy })}
  </body></html>`;
}
