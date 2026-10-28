/**
 * Contract SOV (Adolfo, 2026-10-28): a contract's schedule of values as a printed report.
 * Base contract (by G703 section, with subtotals), then each change order with a subtotal
 * and a Change Orders total, then the contract total. Per line: scheduled value, billed to
 * date, percent complete, balance to finish, retainage held, and the budget line it maps to.
 * Billed figures run through the latest pay app (or ?through=). One contract or all.
 */
import { REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, type ReportInfoRow } from './lib/report-shell';
import { lineProgress, retainageLedger } from '@shared/cost-tracking';

const money2 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const nn = (n: number) => String(n).padStart(3, '0');
const shortD = (v: unknown) => { const d = (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10); return d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '—');

type Line = { id: number; contractId: number; changeOrderId: number | null; itemNo?: string | null; section?: string | null; description: string; scheduledValue: number; allocationMode?: string; allocations?: Array<{ baselineKey: string; pct: number }> };
type Co = { id: number; contractId: number; number: string; title?: string | null; status: string };
type App = { id: number; contractId: number; number: number; docNumber: number; kind?: string; periodEnd?: string | null; lines: any[]; retainageAdj?: number | null };

export function renderSovHtml(x: {
  info: ReportInfoRow[];
  contracts: Array<{ id: number; counterparty: string; contractNumber?: string | null; retainagePct?: number | null }>;
  sovLines: Line[]; changeOrders: Co[]; applications: App[];
  budgetNames: Map<string, string>;
  contractId: number | null; through: number | null;
  generatedBy: string | null;
}): string {
  const contracts = x.contracts.filter((c) => (x.contractId == null || c.id === x.contractId) && x.sovLines.some((l) => l.contractId === c.id));
  const budgetOf = (l: Line) => {
    if (l.allocationMode === 'spread') return 'Spread with the work';
    const al = l.allocations ?? [];
    if (l.allocationMode !== 'direct' || !al.length) return '<span class="warn">Not mapped</span>';
    return escapeHtml(al.map((a) => `${x.budgetNames.get(a.baselineKey) ?? 'Removed line'}${al.length > 1 || a.pct !== 100 ? ` ${Number(a.pct).toFixed(2)}%` : ''}`).join(' · '));
  };

  const sections = contracts.map((c, ci) => {
    const apps = x.applications.filter((a) => a.contractId === c.id && (x.through == null || a.number <= x.through)).sort((a, b) => a.number - b.number);
    const last = apps[apps.length - 1];
    const prog = lineProgress(apps as any);
    const led = retainageLedger(apps as any);
    // Once retainage has been released, show withheld / released / held instead of one column.
    const rel = led.released > 0.005;
    const cols = rel ? 10 : 8;
    const lm = (id: number) => led.lines.get(id) ?? { withheld: 0, released: 0, held: 0 };
    const dash = (v: number) => (Math.abs(v) >= 0.005 ? money2(v) : '<span class="muted">—</span>');
    const lines = x.sovLines.filter((l) => l.contractId === c.id);
    const cos = x.changeOrders.filter((co) => co.contractId === c.id && co.status !== 'void' && lines.some((l) => l.changeOrderId === co.id));
    const sum = (ls: Line[]) => {
      const s = r2(ls.reduce((t, l) => t + l.scheduledValue, 0));
      const d = r2(ls.reduce((t, l) => t + (prog.get(l.id)?.toDate ?? 0), 0));
      const ret = r2(ls.reduce((t, l) => t + (prog.get(l.id)?.retainage ?? 0), 0));
      const w = r2(ls.reduce((t, l) => t + lm(l.id).withheld, 0));
      const rl = r2(ls.reduce((t, l) => t + lm(l.id).released, 0));
      return { s, d, ret, w, rl };
    };
    const row = (l: Line) => {
      const p = prog.get(l.id);
      const d = p?.toDate ?? 0;
      return `<tr><td class="it">${escapeHtml(l.itemNo ?? '')}</td><td class="ind">${escapeHtml(l.description)}</td><td class="num">${money2(l.scheduledValue)}</td><td class="num">${money2(d)}</td><td class="num">${pct(d, l.scheduledValue)}</td><td class="num">${money2(r2(l.scheduledValue - d))}</td>${rel ? `<td class="num">${dash(lm(l.id).withheld)}</td><td class="num">${dash(lm(l.id).released)}</td>` : ''}<td class="num">${dash(p?.retainage ?? 0)}</td><td class="bl">${budgetOf(l)}</td></tr>`;
    };
    const total = (label: string, ls: Line[], cls: string) => {
      const t = sum(ls);
      return `<tr class="${cls}"><td></td><td>${escapeHtml(label)}</td><td class="num">${money2(t.s)}</td><td class="num">${money2(t.d)}</td><td class="num">${pct(t.d, t.s)}</td><td class="num">${money2(r2(t.s - t.d))}</td>${rel ? `<td class="num">${money2(t.w)}</td><td class="num">${money2(t.rl)}</td>` : ''}<td class="num">${money2(t.ret)}</td><td></td></tr>`;
    };
    const head = (label: string, cls: string) => `<tr class="${cls}"><td colspan="${cols}">${escapeHtml(label)}</td></tr>`;

    const base = lines.filter((l) => l.changeOrderId == null);
    const secs = Array.from(new Set(base.map((l) => (l.section ?? '').trim())));
    let body = '';
    if (base.length) {
      body += head('Base Contract', 'h1');
      if (secs.length < 2 && !secs[0]) body += base.map(row).join('');
      else for (const sec of secs) {
        const ls = base.filter((l) => (l.section ?? '').trim() === sec);
        body += head(sec || 'No Section', 'h2') + ls.map(row).join('') + total(`${sec || 'No Section'} Subtotal`, ls, 'sub');
      }
      body += total('Base Contract Total', base, 'grp');
    }
    const approved = cos.filter((co) => co.status === 'approved');
    const pending = cos.filter((co) => co.status !== 'approved');
    const coBlock = (list: Co[], title: string, totalLabel: string) => {
      if (!list.length) return '';
      let h = head(title, 'h1');
      for (const co of list) {
        const ls = lines.filter((l) => l.changeOrderId === co.id);
        h += head(`${co.number}${co.title ? ` — ${co.title}` : ''}`, 'h2') + ls.map(row).join('') + total(`${co.number} Subtotal`, ls, 'sub');
      }
      return h + total(totalLabel, lines.filter((l) => list.some((co) => co.id === l.changeOrderId)), 'grp');
    };
    body += coBlock(approved, 'Change Orders', 'Change Orders Total');
    const all = lines.filter((l) => l.changeOrderId == null || approved.some((co) => co.id === l.changeOrderId));
    body += total('Contract Total', all, 'grand');
    const pend = coBlock(pending, 'Pending Change Orders (Not in the Contract Sum)', 'Pending Total');
    if (pend) body += `<tr class="gap"><td colspan="${cols}"></td></tr>` + pend;
    const t = sum(all);
    const adj = r2(apps.reduce((s, a) => s + (Number(a.retainageAdj) || 0), 0));
    const through = last ? `${last.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${nn(last.docNumber)}${last.periodEnd ? ` (Period To ${shortD(last.periodEnd)})` : ''}` : 'No pay apps yet';
    const tiles = [
      ['Contract Sum to Date', money2(t.s)],
      ['Billed to Date', `${money2(t.d)} · ${pct(t.d, t.s)}`],
      ['Balance to Finish', money2(r2(t.s - t.d))],
      ...(rel ? [['Retainage Withheld', money2(led.withheld)], ['Retainage Released', money2(led.released)]] : []),
      ['Retainage Held', money2(r2(t.ret + adj))],
    ];
    return `<section${ci ? ' class="pb"' : ''}>
      <h2 class="ct">${escapeHtml(c.counterparty)}${c.contractNumber ? ` · Contract #${escapeHtml(c.contractNumber)}` : ''}</h2>
      <div class="meta">Billed through ${escapeHtml(through)}${c.retainagePct ? ` · Retainage ${Number(c.retainagePct).toFixed(2)}%` : ''}</div>
      <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
      <table class="t"><thead><tr><th class="l it">Item</th><th class="l">Description</th><th>Scheduled Value</th><th>Billed to Date</th><th>%</th><th>Balance to Finish</th>${rel ? '<th>Retainage Withheld</th><th>Retainage Released</th><th>Retainage Held</th>' : '<th>Retainage</th>'}<th class="l">Budget Line</th></tr></thead>
      <tbody>${body}</tbody></table>
      ${Math.abs(adj) >= 0.005 ? `<p class="hint">Retainage Held includes accepted rounding adjustments of ${money2(adj)}.</p>` : ''}
    </section>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Contract Schedule of Values</title><style>${REPORT_SHELL_CSS}
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.4in; }
    @page { size: letter landscape; margin: 0.4in; }
    .ct { font-size: 14px; margin: 10px 0 2px; }
    .meta { font-size: 10px; color: #4b5563; margin-bottom: 8px; }
    .tiles { display: flex; gap: 8px; margin-bottom: 10px; }
    .tile { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; }
    .tile .k { font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
    .tile .v { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .t { width: 100%; border-collapse: collapse; font-size: 9.5px; }
    .t thead { display: table-header-group; }
    .t th { text-align: right; font-size: 8px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; border-bottom: 2px solid #111827; padding: 4px 5px; background: #f3f4f6; }
    .t th.l { text-align: left; }
    .t td { padding: 3px 5px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
    .t tr { page-break-inside: avoid; }
    .t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .t td.it, .t th.it { width: 34px; color: #6b7280; }
    .t td.ind { padding-left: 14px; }
    .t td.bl { color: #4b5563; font-size: 8.5px; max-width: 190px; }
    .t tr.h1 td { background: #e5e7eb; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; font-size: 9px; padding-top: 5px; }
    .t tr.h2 td { background: #f8fafc; font-weight: 600; color: #334155; font-size: 9px; padding-left: 10px; }
    .t tr.sub td { font-weight: 600; background: #fafafa; border-top: 1px solid #d1d5db; }
    .t tr.grp td { font-weight: 700; background: #f3f4f6; border-top: 2px solid #9ca3af; }
    .t tr.grand td { font-weight: 700; background: #f3f4f6; border-top: 2px solid #111827; font-size: 10.5px; }
    .t tr.gap td { border: 0; height: 12px; }
    .muted { color: #9ca3af; }
    .warn { color: #b45309; }
    .hint { font-size: 9px; color: #6b7280; margin: 4px 0 0; }
    .pb { page-break-before: always; }
  </style></head><body>
  ${reportHeaderHtml({ title: 'Contract Schedule of Values', info: x.info })}
  ${sections || '<p>No contract lines entered yet.</p>'}
  ${reportFooterHtml({ generatedBy: x.generatedBy })}
  </body></html>`;
}
