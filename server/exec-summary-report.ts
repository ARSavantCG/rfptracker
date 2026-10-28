/**
 * Project Financial Summary: one report for the boss (Adolfo, 2026-10-23): where the
 * project stands against budget, change orders approved and pending, contracts and
 * payments, and a Watch List of what needs attention, worked out from the data so the
 * reader gets the "so what" first. Not the payoff (that's for a refinance or sale).
 */
import { coLog } from '@shared/co-log';
import { threeWayCheck, waiversByPayApp, paidOfFrom, gcPaymentDue } from '@shared/cost-waivers';
import { carryForwardCheck } from '@shared/cost-tracking';
import { financialFigures, figuresDiff, type FinancialFigures } from '@shared/financial-figures';
import { REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, type ReportInfoRow } from './lib/report-shell';

const money0 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const money2 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const nn = (n: number) => String(n).padStart(3, '0');
const isoDay = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const BUCKET: Record<string, string> = { contractor: 'Contractor', design: 'Design', cm: 'CM', misc: 'Miscellaneous' };

type Item = { level: 'red' | 'amber' | 'info'; text: string };

export function renderExecSummaryHtml(b: any, x: { info: ReportInfoRow[]; today: string; generatedBy: string | null; since?: { takenAt: string; kind: string; period: string; data: FinancialFigures } | null }): string {
  const F = financialFigures(b, x.today);
  const C = F.contingency;
  const t = b.summary.totals;
  const cname = (cid: number) => b.contracts.find((c: any) => c.id === cid)?.counterparty ?? '';
  const pos = b.position;
  const P = pos.totals;

  // ---- Change orders (contractor)
  const cos = coLog(b.changeOrders, b.sovLines, b.documents, x.today);
  const approved = cos.filter((c) => c.status === 'approved');
  const pending = cos.filter((c) => c.status === 'pending');
  const sum = (l: typeof cos) => r2(l.reduce((s, c) => s + c.amount, 0));
  const byStage = new Map<string, typeof cos>();
  for (const c of pending) { const k = c.routing.label; byStage.set(k, [...(byStage.get(k) ?? []), c]); }

  // ---- Budget position
  const budget = r2(t.budget), committed = r2(t.committed), pend = r2(t.pending), toDate = r2(t.toDate);
  const projected = r2(committed + pend);
  const uncommitted = r2(budget - committed);
  const afterPending = r2(budget - projected);

  // ---- Watch list: what needs attention, worked out
  const watch: Item[] = [];
  const over = (b.summary.rows as any[]).filter((r) => r.variance < -0.005).sort((p, q) => p.variance - q.variance);
  for (const r of over.slice(0, 5)) watch.push({ level: 'red', text: `${r.description} is committed ${money0(-r.variance)} over its budget (${money0(r.committed)} against ${money0(r.budget)}).` });
  if (pend > 0.005) {
    watch.push(afterPending < -0.005
      ? { level: 'red', text: `Pending change orders (${money0(pend)}) would put the project ${money0(-afterPending)} over budget if all are approved.` }
      : { level: 'info', text: `Pending change orders total ${money0(pend)}; if all are approved, ${money0(afterPending)} of the budget stays uncommitted.` });
  }
  const stuck = pending.filter((c) => (c.routing.daysInStage ?? 0) >= 30).sort((p, q) => (q.routing.daysInStage ?? 0) - (p.routing.daysInStage ?? 0));
  if (stuck.length) watch.push({ level: 'amber', text: `${stuck.length} change order${stuck.length === 1 ? ' has' : 's have'} sat 30+ days in the same stage: ${stuck.slice(0, 4).map((c) => `${c.number} (${c.routing.label}${c.routing.with ? `, with ${c.routing.with}` : ''}, ${c.routing.daysInStage} days)`).join('; ')}.` });
  const unexecuted = approved.filter((c) => !c.executed);
  if (unexecuted.length) watch.push({ level: 'amber', text: `${unexecuted.length} approved change order${unexecuted.length === 1 ? ' has' : 's have'} no executed copy on file: ${unexecuted.slice(0, 5).map((c) => c.number).join(', ')}.` });

  const apps = [...(b.applications as any[])].sort((p, q) => p.contractId - q.contractId || p.number - q.number);
  const label = (a: any) => `${cname(a.contractId)} ${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${nn(a.docNumber ?? a.number)}`;
  // Only pay apps still to be paid are actionable; a difference of cents is rounding, noted once.
  const openIds = new Set((pos.applications as any[]).filter((a) => a.open > 0.005).map((a) => a.applicationId));
  let cents = 0;
  for (const a of apps) {
    const tw = threeWayCheck(a, b.waivers, cname(a.contractId));
    if (tw.status === 'off' && openIds.has(a.id)) {
      const vals = [tw.ours, tw.contractor, tw.conditional].filter((v): v is number => v != null);
      if (Math.max(...vals) - Math.min(...vals) < 1) cents++;
      else watch.push({ level: 'red', text: `${label(a)}: payment due doesn't agree (${tw.summary}).` });
    }
    const prev = apps.filter((p) => p.contractId === a.contractId && p.number < a.number).pop();
    if (prev) {
      const cf = carryForwardCheck(a.contractorG702, prev.contractorG702, a.g702, prev.g702);
      if (cf.status === 'off') watch.push({ level: 'red', text: `${label(a)}: the contractor's G702 doesn't tie to their previous pay app${cf.periodDiff != null && Math.abs(cf.periodDiff) >= 0.005 ? ` (completed to date off ${money2(Math.abs(cf.periodDiff))})` : ''}; revision requested.` });
    }
  }
  if (cents) watch.push({ level: 'info', text: `${cents} unpaid pay app${cents === 1 ? '' : 's'} differ from the contractor's by cents (retainage rounding); accepted at approval.` });
  const openApps = (pos.applications as any[]).filter((a) => a.open > 0.005);
  const late = openApps.filter((a) => daysBetween(isoDay(a.date), x.today) > 30);
  if (late.length) watch.push({ level: 'amber', text: `${late.length} pay app${late.length === 1 ? ' is' : 's are'} unpaid more than 30 days after the period ended: ${late.map((a) => `${cname(a.contractId)} ${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${nn(a.docNumber)} (${money0(a.open)})`).join('; ')}.` });
  const paidOf = paidOfFrom(b.payments, (aid) => { const a = apps.find((q) => q.id === aid); return a ? gcPaymentDue(a, b.waivers, cname(a.contractId)).due : null; });
  const wg = waiversByPayApp(apps.map((a) => ({ id: a.id, contractId: a.contractId, number: a.number, docNumber: a.docNumber })), b.waivers, cname, paidOf);
  const missingRel = wg.flatMap((g: any) => g.rows.filter((r: any) => r.status === 'outstanding' || r.status === 'missing'));
  if (missingRel.length) watch.push({ level: 'amber', text: `${missingRel.length} lien release${missingRel.length === 1 ? ' is' : 's are'} outstanding (conditionals or unconditionals not yet received). See the Lien Waiver Log.` });
  // Contingency used ahead of the work: the burn most bosses ask about first.
  if (C && C.original > 0.005) {
    if (C.remaining < -0.005) watch.push({ level: 'red', text: `Contingency is overdrawn: ${money0(C.used)} used of ${money0(C.original)} (${C.usedPct.toFixed(0)}%).` });
    else if (C.usedPct > C.completePct + 10) watch.push({ level: 'amber', text: `Contingency is being used ahead of the work: ${C.usedPct.toFixed(0)}% used at ${C.completePct.toFixed(0)}% complete (${money0(C.remaining)} left).` });
  }
  // Funding by scope: who covers the overages.
  const SC = b.scopes;
  if (SC?.scopes?.length) {
    for (const s of SC.scopes) {
      if (s.overageProjected > 0.005) watch.push(s.overage === 'tenant'
        ? { level: 'amber', text: `${s.name} is projected ${money0(s.overageProjected)} over its allowances: billable to the tenant.` }
        : { level: 'red', text: `${s.name} is projected ${money0(s.overageProjected)} over our budget for it: Supplemental funding needed.` });
    }
    if (SC.unassigned?.lines?.length) watch.push({ level: 'amber', text: `${SC.unassigned.lines.length} budget line${SC.unassigned.lines.length === 1 ? ' isn\'t' : 's aren\'t'} in any funding scope (${money0(SC.unassigned.projected)} projected): ${SC.unassigned.lines.slice(0, 4).join(', ')}.` });
  }
  const rank = { red: 0, amber: 1, info: 2 } as const;
  watch.sort((p, q) => rank[p.level] - rank[q.level]);
  if (!watch.length) watch.push({ level: 'info', text: 'Nothing needs attention: every line is within budget, pay apps agree, and releases are in.' });

  // ---- Sections
  const tile = (k: string, v: string, sub?: string, tone = '#003087') => `<div class="tile"><div class="k">${k}</div><div class="v" style="color:${tone}">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const tiles = `<div class="tiles">
    ${tile('Current Budget', money0(budget))}
    ${tile('Committed', money0(committed), `${pct(committed, budget)} of budget`)}
    ${tile('Projected at Completion', money0(projected), `with ${money0(pend)} pending`, afterPending < -0.005 ? '#991b1b' : '#003087')}
    ${tile(afterPending < -0.005 ? 'Projected Over Budget' : 'Projected Under Budget', money0(Math.abs(afterPending)), `uncommitted today ${money0(uncommitted)}`, afterPending < -0.005 ? '#991b1b' : '#166534')}
    ${tile('Work Complete', money0(toDate), `${pct(toDate, committed)} of committed`)}
    ${tile('Paid to Date', money0(P.paid ?? 0), `${pct(P.paid ?? 0, committed)} of committed`)}
    ${tile('Billed, Unpaid', money0(P.owed ?? 0), `plus ${money0(P.retainageHeld ?? 0)} retainage held`)}
    ${C ? tile('Contingency Remaining', money0(C.remaining), `${C.usedPct.toFixed(0)}% used at ${C.completePct.toFixed(0)}% complete${C.inContracts.amount > 0.005 ? ` · ${money0(C.inContracts.amount - C.inContracts.billed)} more in contracts` : ''}`, C.remaining < -0.005 || C.usedPct > C.completePct + 10 ? '#b45309' : '#166534')
      : tile('Contingency', '—', 'No budget line named Contingency; pick one in the report settings')}
  </div>`;

  // ---- Since the last snapshot: what moved, and the change orders and pay apps behind it
  let sinceHtml = '';
  if (x.since) {
    const D = figuresDiff(x.since.data, F);
    const when = new Date(x.since.takenAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
    const label = x.since.kind === 'month' ? `${new Date(x.since.period + '-15T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })} month-end (saved ${when})` : x.since.kind === 'baseline' ? `tracking began, ${when}` : when;
    const sign = (v: number) => (Math.abs(v) < 0.005 ? '<span class="muted">no change</span>' : `<span style="color:${v > 0 ? '#991b1b' : '#166534'}">${v > 0 ? '+' : '−'}${money0(Math.abs(v))}</span>`);
    const signPlain = (v: number) => (Math.abs(v) < 0.005 ? '<span class="muted">no change</span>' : `${v > 0 ? '+' : '−'}${money0(Math.abs(v))}`);
    const why: string[] = [];
    if (D.newlyApproved.length) why.push(`Approved: ${D.newlyApproved.map((c) => `${escapeHtml(c.number)}${c.title ? ` ${escapeHtml(c.title)}` : ''} (${money0(c.amount)})`).join('; ')}.`);
    if (D.newPending.length) why.push(`New pending: ${D.newPending.map((c) => `${escapeHtml(c.number)} (${money0(c.amount)})`).join('; ')}.`);
    if (D.rejected.length) why.push(`Rejected: ${D.rejected.map((c) => escapeHtml(c.number)).join(', ')}.`);
    if (D.changedAmount.length) why.push(`Amounts changed: ${D.changedAmount.map((c) => `${escapeHtml(c.number)} ${money0(c.was)} → ${money0(c.amount)}`).join('; ')}.`);
    if (D.moved.length) why.push(`Moved along: ${D.moved.map((c) => `${escapeHtml(c.number)} ${escapeHtml(c.from)} → ${escapeHtml(c.stage)}`).join('; ')}.`);
    if (D.newApps.length) why.push(`New pay apps: ${D.newApps.map((a) => `${escapeHtml(a.label)} (${money0(a.due)})`).join('; ')}.`);
    if (D.paidOff.length) why.push(`Paid: ${D.paidOff.map((a) => escapeHtml(a.label)).join('; ')}.`);
    const lines = D.rowMoves.slice(0, 4).filter((r) => Math.abs(r.projected) >= 0.005);
    if (lines.length) why.push(`Biggest moves by line: ${lines.map((r) => `${escapeHtml(r.description)} ${r.projected > 0 ? '+' : '−'}${money0(Math.abs(r.projected))}`).join('; ')}.`);
    sinceHtml = `<h3 class="sec">Since ${escapeHtml(label)}</h3>
    <table class="t"><thead><tr><th>Budget</th><th>Committed</th><th>Projected</th><th>Work Complete</th><th>Paid</th>${D.contingencyUsed != null ? '<th>Contingency Used</th>' : ''}</tr></thead><tbody><tr>
      <td class="num">${signPlain(D.budget)}</td><td class="num">${sign(D.committed)}</td><td class="num"><strong>${sign(D.projected)}</strong></td><td class="num">${signPlain(D.toDate)}</td><td class="num">${signPlain(D.paid)}</td>${D.contingencyUsed != null ? `<td class="num">${sign(D.contingencyUsed)}</td>` : ''}
    </tr></tbody></table>
    ${why.length ? `<ul class="why">${why.map((w) => `<li>${w}</li>`).join('')}</ul>` : '<p class="hint">No change orders or pay apps moved.</p>'}`;
  }
  const contHtml = C ? `<h3 class="sec">Contingency</h3>
  <table class="t" style="width:80%"><thead><tr><th class="l">Line</th><th>Original</th><th>Moved to Other Lines</th><th>Spent</th><th>Used</th><th>Remaining</th><th>% Used</th><th>% Complete</th></tr></thead><tbody>
    <tr><td>${escapeHtml(C.names.join(', '))}</td><td class="num">${money0(C.original)}</td><td class="num">${money0(C.movedOut)}</td><td class="num">${money0(C.spent)}</td><td class="num"><strong>${money0(C.used)}</strong></td><td class="num" style="color:${C.remaining < -0.005 ? '#991b1b' : '#166534'}"><strong>${money0(C.remaining)}</strong></td><td class="num">${C.usedPct.toFixed(1)}%</td><td class="num">${C.completePct.toFixed(1)}%</td></tr>
  </tbody></table>
  ${C.inContracts.amount > 0.005 ? `<p class="hint">Also carried inside contracts (lines named contingency): ${money0(C.inContracts.amount)}, ${money0(C.inContracts.billed)} billed so far.</p>` : ''}` : '';
  const scopeHtml = SC?.scopes?.length ? `<h3 class="sec">Funding by Scope</h3>
  ${SC.scopes.map((s: any) => `<table class="t" style="margin-bottom:8px"><thead>
    <tr><th class="l" style="text-transform:none;font-size:10px;color:#111827">${escapeHtml(s.name)} <span style="font-weight:400;color:#6b7280">· projected ${money0(s.projected)} · overage: ${s.overage === 'tenant' ? 'tenant pays' : 'Supplemental'}</span></th><th>Amount</th><th>Used at Projected</th><th>Left</th><th>Used to Date</th></tr></thead><tbody>
    ${s.absorbed > 0.005 ? `<tr><td>Absorbed by us (change orders not billed to the tenant)</td><td class="num">—</td><td class="num">${money0(s.absorbed)}</td><td></td><td></td></tr>` : ''}
    ${s.sources.map((x: any) => `<tr><td>${escapeHtml(x.label)}${x.kind === 'amortized' ? ' <span style="color:#6d28d9;font-size:9px">repaid through rent</span>' : ''}${x.kind === 'tenant' ? ` <span class="muted" style="font-size:9px">${money0(x.leftToDate)} on hand</span>` : ''}</td><td class="num">${money0(x.amount)}</td><td class="num">${money0(x.projected)}</td><td class="num">${money0(x.leftProjected)}</td><td class="num">${money0(x.toDate)}</td></tr>`).join('')}
    <tr class="total"><td>${s.overageProjected > 0.005 ? (s.overage === 'tenant' ? 'Over the allowances: tenant pays' : 'Over our budget: Supplemental needed') : 'Within the funding'}</td><td class="num">${money0(s.funding)}</td><td class="num" style="color:${s.overageProjected > 0.005 ? '#991b1b' : '#166534'}">${money0(s.overageProjected)}</td><td class="num">${s.unused > 0.005 ? money0(s.unused) : ''}</td><td class="num">${s.overageToDate > 0.005 ? money0(s.overageToDate) : ''}</td></tr>
  </tbody></table>`).join('')}
  ${SC.amortized > 0.005 ? `<p class="hint">Additional allowance used at projected cost (repaid through rent): ${money0(SC.amortized)}.</p>` : ''}` : '';
  const watchHtml = `<h3 class="sec">Watch List</h3><ul class="watch">${watch.map((w) => `<li class="${w.level}">${escapeHtml(w.text)}</li>`).join('')}</ul>`;

  // Budget by bucket
  const buckets = new Map<string, { budget: number; committed: number; pending: number; toDate: number }>();
  for (const r of b.summary.rows as any[]) {
    const k = r.bucket || 'misc';
    const cur = buckets.get(k) ?? { budget: 0, committed: 0, pending: 0, toDate: 0 };
    cur.budget += r.budget; cur.committed += r.committed; cur.pending += r.pending; cur.toDate += r.toDate;
    buckets.set(k, cur);
  }
  const bRow = (name: string, v: { budget: number; committed: number; pending: number; toDate: number }, cls = '') => {
    const proj = v.committed + v.pending, rem = v.budget - proj;
    return `<tr${cls}><td>${escapeHtml(name)}</td><td class="num">${money0(v.budget)}</td><td class="num">${money0(v.committed)}</td><td class="num">${money0(v.pending)}</td><td class="num">${money0(proj)}</td><td class="num" style="color:${rem < -0.5 ? '#991b1b' : '#166534'}">${rem < -0.5 ? `(${money0(-rem)})` : money0(rem)}</td><td class="num">${money0(v.toDate)}</td><td class="num">${pct(v.toDate, v.committed)}</td></tr>`;
  };
  const budgetHtml = `<h3 class="sec">Budget</h3>
  <table class="t"><thead><tr><th class="l">Category</th><th>Budget</th><th>Committed</th><th>Pending COs</th><th>Projected</th><th>Remaining</th><th>Work Complete</th><th>% of Committed</th></tr></thead><tbody>
    ${Array.from(buckets.entries()).map(([k, v]) => bRow(BUCKET[k] ?? k, v)).join('')}
    ${bRow('Total', { budget, committed, pending: pend, toDate }, ' class="total"')}
  </tbody></table>
  ${over.length ? `<p class="hint">Over budget: ${over.map((r) => `${escapeHtml(r.description)} (${money0(-r.variance)})`).join('; ')}.</p>` : ''}`;

  // Change orders
  const stageRows = Array.from(byStage.entries()).map(([k, l]) => {
    const oldest = Math.max(...l.map((c) => c.routing.daysOpen ?? 0));
    return `<tr><td style="padding-left:16px">${escapeHtml(k)}</td><td class="num">${l.length}</td><td class="num">${money0(sum(l))}</td><td class="num">${oldest ? `${oldest} days` : '—'}</td></tr>`;
  }).join('');
  const coHtml = cos.length ? `<h3 class="sec">Change Orders</h3>
  <table class="t" style="width:70%"><thead><tr><th class="l">Status</th><th>Count</th><th>Amount</th><th>Oldest Open</th></tr></thead><tbody>
    <tr><td><strong>Approved</strong></td><td class="num">${approved.length}</td><td class="num"><strong>${money0(sum(approved))}</strong></td><td class="num">—</td></tr>
    <tr><td><strong>Pending</strong></td><td class="num">${pending.length}</td><td class="num"><strong>${money0(sum(pending))}</strong></td><td class="num"></td></tr>
    ${stageRows}
    ${cos.some((c) => c.status === 'void') ? `<tr><td>Rejected</td><td class="num">${cos.filter((c) => c.status === 'void').length}</td><td class="num muted">${money0(sum(cos.filter((c) => c.status === 'void')))}</td><td></td></tr>` : ''}
  </tbody></table>
  ${pending.length ? `<p class="hint">Largest pending: ${[...pending].sort((p, q) => q.amount - p.amount).slice(0, 3).map((c) => `${escapeHtml(c.number)}${c.title ? ` ${escapeHtml(c.title)}` : ''} (${money0(c.amount)}, ${escapeHtml(c.routing.label)})`).join('; ')}.</p>` : ''}` : '';

  // Contracts and payments
  const lastApp = (cid: number) => apps.filter((a) => a.contractId === cid).pop();
  const cRows = (pos.contracts as any[]).filter((c) => c.contractSum > 0.005 || c.billedToDate > 0.005).map((c) => {
    const la = lastApp(c.contractId);
    const tw = la ? threeWayCheck(la, b.waivers, cname(c.contractId)) : null;
    return `<tr><td>${escapeHtml(cname(c.contractId) || 'Direct Costs')}</td><td class="num">${money0(c.contractSum)}</td><td class="num">${money0(c.billedToDate)}</td><td class="num">${pct(c.billedToDate, c.contractSum)}</td><td class="num">${money0(c.paid)}</td><td class="num">${c.owed > 0.005 ? `<strong>${money0(c.owed)}</strong>` : '$0.00'}</td><td class="num">${money0(c.retainageHeld)}</td><td class="num">${money0(c.leftToBill)}</td><td style="text-align:center">${la ? `${la.kind === 'invoice' ? 'Inv' : 'PA'} ${nn(la.docNumber ?? la.number)}${tw?.status === 'off' ? ' <span style="color:#991b1b">⚠</span>' : ''}` : '—'}</td></tr>`;
  }).join('');
  const payHtml = `<h3 class="sec">Contracts and Payments</h3>
  <table class="t"><thead><tr><th class="l">Contract</th><th>Contract Sum</th><th>Billed to Date</th><th>% Billed</th><th>Paid</th><th>Billed, Unpaid</th><th>Retainage Held</th><th>Left to Bill</th><th style="text-align:center">Latest</th></tr></thead><tbody>
    ${cRows}
    <tr class="total"><td>Total</td><td class="num">${money0(P.contractSum ?? 0)}</td><td class="num">${money0(P.billedToDate ?? 0)}</td><td class="num">${pct(P.billedToDate ?? 0, P.contractSum ?? 0)}</td><td class="num">${money0(P.paid ?? 0)}</td><td class="num">${money0(P.owed ?? 0)}</td><td class="num">${money0(P.retainageHeld ?? 0)}</td><td class="num">${money0(P.leftToBill ?? 0)}</td><td></td></tr>
  </tbody></table>
  ${openApps.length ? `<p class="hint">Unpaid: ${openApps.map((a) => `${escapeHtml(cname(a.contractId))} ${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${nn(a.docNumber)} ${money0(a.open)}`).join('; ')}.</p>` : ''}`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Project Financial Summary</title><style>${REPORT_SHELL_CSS}
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.5in; }
    .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 6px 0 10px; }
    .tile { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
    .tile .k { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #4b5563; font-weight: 700; }
    .tile .v { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
    .tile .s { font-size: 9.5px; color: #6b7280; margin-top: 1px; }
    .watch { margin: 0; padding: 0; list-style: none; font-size: 10.5px; }
    .watch li { padding: 5px 8px 5px 22px; border-radius: 4px; margin-bottom: 3px; position: relative; break-inside: avoid; }
    .watch li::before { position: absolute; left: 8px; top: 5px; font-weight: 700; }
    .watch li.red { background: #fef2f2; color: #7f1d1d; } .watch li.red::before { content: '!'; color: #b91c1c; }
    .watch li.amber { background: #fffbeb; color: #78350f; } .watch li.amber::before { content: '•'; color: #b45309; }
    .watch li.info { background: #f0f9ff; color: #0c4a6e; } .watch li.info::before { content: 'i'; color: #0369a1; }
    .t { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    .t th { text-align: right; font-size: 8.5px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; border-bottom: 2px solid #111827; padding: 4px 6px; background: #f3f4f6; }
    .t th.l { text-align: left; }
    .t td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
    .t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .t tr.total td { font-weight: 700; background: #f9fafb; border-top: 2px solid #111827; }
    .muted { color: #9ca3af; }
    .hint { font-size: 9.5px; color: #6b7280; margin: 4px 0 0; }
    .why { margin: 4px 0 0; padding-left: 16px; font-size: 10px; color: #374151; }
    .why li { margin-bottom: 2px; }
    .sec { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #374151; margin: 14px 0 6px; break-after: avoid; }
  </style></head><body>
  ${reportHeaderHtml({ title: 'Project Financial Summary', info: [...x.info, { label: 'As Of', value: new Date(x.today + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) }], notes: [] })}
  ${tiles}
  ${watchHtml}
  ${sinceHtml}
  ${budgetHtml}
  ${scopeHtml}
  ${contHtml}
  ${coHtml}
  ${payHtml}
  <p class="hint" style="margin-top:12px">Detail behind each section: Budget vs Actual, Change Order Log, Pay App Status, Owed by Vendor and Lien Waiver Log (Reports tab).</p>
  ${reportFooterHtml({ generatedBy: x.generatedBy })}
  </body></html>`;
}
