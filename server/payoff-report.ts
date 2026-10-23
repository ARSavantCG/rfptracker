/**
 * Payoff Statement: what it takes, as of a date, to bring every contractor to
 * zero — every pay app billed and not yet paid, plus the retainage held — and
 * the lien releases to collect once it's paid. Built for a refinance or a sale,
 * where the new lender needs every lien right cleared to take first position
 * (Adolfo, 2026-10-23).
 */
import type { PayAppWaivers } from '@shared/cost-waivers';
import { REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, type ReportInfoRow } from './lib/report-shell';

const money2 = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const r2 = (v: number) => Math.round(v * 100) / 100;
const nn = (n: number) => String(n).padStart(3, '0');
const longDate = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const shortD = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

export interface PayoffInput {
  info: ReportInfoRow[];
  asOf: string;
  contracts: Array<{ id: number; name: string; retainagePct: number }>;
  /** From positionAsOf: per contract. */
  positions: Array<{ contractId: number; contractSum: number; billedToDate: number; paid: number; owed: number; retainageHeld: number; leftToBill: number }>;
  /** From positionAsOf: per pay app. */
  applications: Array<{ applicationId: number; contractId: number; docNumber: number; kind: string; date: string; due: number; paid: number; open: number }>;
  /** The lien waiver log by pay app (statuses as of today). */
  waiverGroups: PayAppWaivers[];
  generatedBy: string | null;
}

export function renderPayoffHtml(x: PayoffInput): string {
  const name = (cid: number) => x.contracts.find((c) => c.id === cid)?.name ?? 'Contract';
  const open = x.applications.filter((a) => a.open > 0.005).sort((a, b) => a.contractId - b.contractId || a.docNumber - b.docNumber);
  const rows = x.positions.map((p) => {
    const apps = open.filter((a) => a.contractId === p.contractId);
    const openAmt = r2(apps.reduce((t, a) => t + a.open, 0));
    // Payments ahead of billing (owed below zero) don't reduce retainage owed; show what's open on the pay apps.
    return { ...p, apps, openAmt, payoff: r2(openAmt + p.retainageHeld) };
  }).filter((r) => r.payoff > 0.005 || r.apps.length);
  const total = { open: r2(rows.reduce((t, r) => t + r.openAmt, 0)), ret: r2(rows.reduce((t, r) => t + r.retainageHeld, 0)), payoff: r2(rows.reduce((t, r) => t + r.payoff, 0)), unbilled: r2(rows.reduce((t, r) => t + r.leftToBill, 0)) };
  const notes = [
    `Payoff as of ${longDate(x.asOf)}: ${money2(total.payoff)} — ${money2(total.open)} billed and unpaid on ${open.length} pay app${open.length === 1 ? '' : 's'}, plus ${money2(total.ret)} retainage held.`,
  ];

  const summary = `
  <table class="t"><thead><tr><th class="l">Contractor</th><th>Open Pay Apps</th><th>Billed, Unpaid</th><th>Retainage Held</th><th>Payoff</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${escapeHtml(name(r.contractId))}</td><td class="num">${r.apps.length || '—'}</td><td class="num">${money2(r.openAmt)}</td><td class="num">${money2(r.retainageHeld)}</td><td class="num"><strong>${money2(r.payoff)}</strong></td></tr>`).join('')}
    <tr class="total"><td>Total Payoff</td><td class="num">${open.length}</td><td class="num">${money2(total.open)}</td><td class="num">${money2(total.ret)}</td><td class="num" style="font-size:12px">${money2(total.payoff)}</td></tr>
  </tbody></table>`;

  const detail = open.length ? `
  <h3 class="sec">Open Pay Apps</h3>
  <table class="t"><thead><tr><th class="l">Contractor</th><th class="l">Pay App</th><th class="l">Period To</th><th>Payment Due</th><th>Paid</th><th>Open</th></tr></thead><tbody>
    ${open.map((a) => `<tr><td>${escapeHtml(name(a.contractId))}</td><td>${a.kind === 'invoice' ? 'Invoice' : 'Pay App'} ${nn(a.docNumber)}</td><td>${shortD(a.date)}</td><td class="num">${money2(a.due)}</td><td class="num">${money2(a.paid)}</td><td class="num"><strong>${money2(a.open)}</strong></td></tr>`).join('')}
    <tr class="total"><td colspan="5">Total billed, unpaid</td><td class="num">${money2(total.open)}</td></tr>
  </tbody></table>` : '';

  const retain = rows.some((r) => r.retainageHeld > 0.005) ? `
  <h3 class="sec">Retainage Held</h3>
  <table class="t"><thead><tr><th class="l">Contractor</th><th>Contract Sum</th><th>Completed &amp; Stored</th><th>Rate</th><th>Retainage Held</th></tr></thead><tbody>
    ${rows.filter((r) => r.retainageHeld > 0.005).map((r) => `<tr><td>${escapeHtml(name(r.contractId))}</td><td class="num">${money2(r.contractSum)}</td><td class="num">${money2(r.billedToDate)}</td><td class="num">${(x.contracts.find((c) => c.id === r.contractId)?.retainagePct ?? 0).toFixed(2)}%</td><td class="num"><strong>${money2(r.retainageHeld)}</strong></td></tr>`).join('')}
  </tbody></table>` : '';

  // Releases to collect once paid: an unconditional for each conditional on an open pay app,
  // any earlier unconditional still outstanding, and a final release for the retainage.
  const releases: Array<{ vendor: string; party: string; what: string; amount: number | null; status: string; app: number; seq: number }> = [];
  let seq = 0;
  const openIds = new Set(open.map((a) => a.applicationId));
  for (const g of x.waiverGroups) {
    const no = nn(g.appNumber);
    if (openIds.has(g.appId)) {
      for (const r of g.rows.filter((r) => r.kind === 'conditional')) {
        releases.push({ vendor: r.vendor, party: r.party, what: `Unconditional for Pay App ${no}, on payment`, amount: r.amount, status: r.status === 'missing' ? 'Conditional not entered' : r.status === 'outstanding' ? 'Conditional not received' : 'Due on payment', app: g.appNumber, seq: seq++ });
      }
    }
    for (const r of g.rows.filter((r) => r.kind === 'unconditional' && r.status === 'outstanding')) {
      releases.push({ vendor: r.vendor, party: r.party, what: `Unconditional for Pay App ${r.releases != null ? nn(r.releases) : '—'}`, amount: r.amount, status: 'Outstanding now', app: r.releases ?? g.appNumber, seq: seq++ });
    }
  }
  for (const r of rows.filter((r) => r.retainageHeld > 0.005)) {
    releases.push({ vendor: name(r.contractId), party: 'gc', what: 'Final unconditional release, on payment of retainage', amount: r.retainageHeld, status: 'Due on payment', app: 1e9, seq: seq++ });
  }
  // Outstanding now first (they're already late), then by pay app, GC before its subs.
  releases.sort((a, b) => (a.status === 'Outstanding now' ? 0 : 1) - (b.status === 'Outstanding now' ? 0 : 1) || a.app - b.app || a.seq - b.seq);
  const relTable = releases.length ? `
  <h3 class="sec">Releases to Collect at Payoff</h3>
  <table class="t"><thead><tr><th class="l">Vendor</th><th class="l">Release</th><th>Amount</th><th class="l">Status</th></tr></thead><tbody>
    ${releases.map((r) => `<tr${r.status === 'Outstanding now' || /not/.test(r.status) ? ' style="background:#fef2f2"' : ''}><td${r.party === 'gc' ? '' : ' style="padding-left:20px"'}>${escapeHtml(r.vendor)}</td><td>${escapeHtml(r.what)}</td><td class="num">${r.amount != null ? money2(r.amount) : '—'}</td><td style="${r.status === 'Due on payment' ? 'color:#374151' : 'color:#991b1b;font-weight:600'}">${escapeHtml(r.status)}</td></tr>`).join('')}
  </tbody></table>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Payoff Statement</title><style>${REPORT_SHELL_CSS}
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.5in; }
    .t { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 4px; }
    .t th { text-align: right; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; border-bottom: 2px solid #111827; padding: 4px 6px; background: #f3f4f6; }
    .t th.l { text-align: left; }
    .t td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
    .t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .t tr.total td { font-weight: 700; background: #f9fafb; border-top: 2px solid #111827; }
    .sec { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #374151; margin: 16px 0 6px; }
    .big { margin: 10px 0 14px; padding: 10px 12px; border: 2px solid #003087; border-radius: 6px; display: flex; justify-content: space-between; align-items: baseline; }
    .big .n { font-size: 20px; font-weight: 700; color: #003087; font-variant-numeric: tabular-nums; }
  </style></head><body>
  ${reportHeaderHtml({ title: 'Payoff Statement', info: [...x.info, { label: 'As Of', value: longDate(x.asOf) }], notes })}
  <div class="big"><div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#374151">Total to Bring Every Contractor to Zero</div>
    <div style="font-size:10.5px;color:#4b5563">${money2(total.open)} billed and unpaid + ${money2(total.ret)} retainage held</div></div><div class="n">${money2(total.payoff)}</div></div>
  ${rows.length ? summary : '<p>Nothing is owed: every pay app is paid and no retainage is held.</p>'}
  ${detail}
  ${retain}
  ${relTable}
  <h3 class="sec">Notes</h3>
  <ol style="font-size:10px;color:#4b5563;padding-left:18px">
    <li>Billed, unpaid: each pay app's current payment due (G702 line 8) less payments recorded against it, on or before the as-of date.</li>
    <li>Retainage held: withheld on work completed and stored to date; released with final payment.</li>
    <li>Work not yet billed is not included: ${money2(total.unbilled)} of the contract sums remains to be billed by these contractors.</li>
    <li>On payment, collect the unconditional releases listed (and a final release for the retainage) so no lien rights remain ahead of the new lender.</li>
  </ol>
  ${reportFooterHtml({ generatedBy: x.generatedBy })}
  </body></html>`;
}
