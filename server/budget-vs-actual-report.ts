/**
 * The two printable cost reports, on the shared report layout:
 *
 *   Budget vs Actual   by budget line: budget (after the deal), committed,
 *                      pending COs, spent, variance, tenant / outstanding share.
 *                      Shows the ORIGINAL budget beside the current one once
 *                      the budget has been confirmed and since revised.
 *   Cost Position      by contract, as of a date: billed, retainage, paid,
 *                      owed, left to pay — and every pay app's due / paid /
 *                      open. The page a refinance asks for.
 *
 * Renderers are pure; the routes only fetch.
 */
import type { Express } from "express";
import { requireAuth, requireAdmin } from "./middleware";
import { storage } from "./storage";
import { loadProjectBundle, todayEastern } from "./cost-tracking-routes";
import {
  REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, money2, generatedByName,
  rfpPropertyLabel, rfpRentableSf, type ReportInfoRow,
} from "./lib/report-shell";
import { UNALLOCATED_KEY, type BudgetVsActual } from "@shared/cost-tracking";
import { DEAL_DISCOUNT_KEY, coTotals, reasonLabel } from "@shared/cost-budget-approval";
import { positionAsOf, buildLedger, filterPositionInput, type LedgerEntry } from "@shared/cost-position";
import { fmtPct } from "@shared/format";
import { coLog, type CoLogRow } from "@shared/co-log";
import { waiversByPayApp, paidOfFrom, payAppLog, vendorKey, gcPaymentDue, type PayAppWaivers, type PayAppWaiverRow, type PayAppLogGroup, type PayAppLogRow } from "@shared/cost-waivers";

const BUCKETS: Array<[string, string]> = [
  ["contractor", "Contractor"], ["design", "Design"], ["cm", "Construction Management"], ["misc", "Miscellaneous"],
];

const fmt = (n: number) => (n < -0.005 ? `(${money2(-n)})` : money2(n));
const cell = (n: number, cls = "") => `<td class="num ${cls}">${fmt(n)}</td>`;
const negCls = (n: number) => (n < -0.005 ? "neg" : "");
const longDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" });
};

const TABLE_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.5in; }
  table.t { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .t th { text-align: right; background: #f3f4f6; padding: 5px 6px; border-bottom: 2px solid #374151; font-size: 10px; }
  .t th:first-child, .t th.l { text-align: left; }
  .t td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
  .t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .t td.neg { color: #b91c1c; font-weight: 700; }
  .t td.muted { color: #6b7280; }
  .t tr.grp td { background: #e5e7eb; font-weight: 700; text-transform: uppercase; font-size: 9.5px; letter-spacing: .06em; }
  .t tr.sub td { font-weight: 700; border-top: 1px solid #6b7280; }
  .t tr.unalloc td { background: #fef3c7; }
  .t tr.deal td { background: #eef2ff; font-style: italic; }
  .t tr.total td { font-weight: 700; border-top: 2px solid #111827; border-bottom: 2px solid #111827; background: #f9fafb; }
  .t tr { page-break-inside: avoid; }
  h3.sec { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #374151; margin: 16px 0 6px; }
  .legend { margin-top: 8px; font-size: 10px; color: #6b7280; }
  ol.notes { margin: 0; padding-left: 16px; font-size: 10px; color: #4b5563; line-height: 1.45; }
  .t tr.deal td.neg { color: #3730a3; }
  .draft { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; border-radius: 3px;
    padding: 1px 6px; font-weight: 700; font-size: 10px; letter-spacing: .06em; }
`;

export interface CostReportProject {
  name: string;
  projectNumber: string;
  tenantName?: string | null;
}

export interface CmFeeView {
  pct: number;
  base: number;
  earned: number;
  paidBase: number;
  earnedOnPaid: number;
  budget: number;
  remaining: number;
  supplemental?: { work: number; earned: number; earnedCp: number; earnedOnPaid: number; budget: number; remaining: number } | null;
}

export interface BudgetCoView {
  number: string; title: string; date: string | null; status: string; billable: boolean;
  work: number; cm: number; total: number; cmFeePct: number; cmFee: boolean;
  tenant?: number; absorbed?: number; cmAbsorbed?: number; credit?: number; reason?: string; markups?: number;
  /** Paid from other budget lines, and what the budget grows by after that. */
  funded?: number; budgetIncrease?: number; fundedNote?: string;
}

function budgetCoTable(cos: BudgetCoView[] | undefined): string {
  const list = (cos || []).filter((c) => c.status !== 'void');
  if (!list.length) return "";
  const approved = list.filter((c) => c.status === 'approved');
  const sum = (xs: BudgetCoView[], f: (c: BudgetCoView) => number) => xs.reduce((s, c) => s + f(c), 0);
  const tenantOf = (c: BudgetCoView) => c.tenant ?? (c.billable ? c.total : 0);
  const oursOf = (c: BudgetCoView) => c.absorbed ?? (c.billable ? 0 : c.total);
  return `
  <h3 class="sec">Budget Change Orders</h3>
  <table class="t"><thead><tr><th class="l">No.</th><th class="l">For</th><th class="l">Why</th><th class="l">Date</th>
    <th>Cost of Work</th><th>Markups</th><th>Partner CM Fee</th><th>Budget Increase</th><th>Tenant Pays</th><th>Absorbed</th><th class="l">Status</th></tr></thead><tbody>
    ${list.map((c) => `<tr><td>${escapeHtml(c.number)}</td><td>${escapeHtml(c.title)}${c.credit ? `<div class="muted" style="font-size:9px">Includes a ${money2(c.credit)} credit to the tenant</div>` : ""}</td><td>${escapeHtml(c.reason ? reasonLabel(c.reason) : "")}</td><td style="white-space:nowrap">${escapeHtml(longDate(c.date))}</td>
      ${cell(c.work)}${c.markups ? cell(c.markups) : `<td class="num muted">—</td>`}${c.cmAbsorbed ? cell(c.cmAbsorbed) : `<td class="num muted">—</td>`}<td class="num">${fmt(c.budgetIncrease ?? c.total)}${c.funded ? `<div class="muted" style="font-size:9px">${escapeHtml(c.fundedNote || `${money2(c.funded)} from budget lines`)}</div>` : ""}</td><td class="num">${fmt(tenantOf(c))}${c.cm ? `<div class="muted" style="font-size:9px">incl. ${money2(c.cm)} CM fee (${fmtPct(c.cmFeePct)})</div>` : ""}</td>${cell(oursOf(c))}
      <td>${c.status === "approved" ? "Approved" : "Pending"}</td></tr>`).join("")}
    <tr class="total"><td colspan="4">Approved</td>${cell(sum(approved, (c) => c.work))}${cell(sum(approved, (c) => c.markups ?? 0))}${cell(sum(approved, (c) => c.cmAbsorbed ?? 0))}${cell(sum(approved, (c) => c.budgetIncrease ?? c.total))}${cell(sum(approved, tenantOf))}${cell(sum(approved, oursOf))}<td></td></tr>
  </tbody></table>
  <div class="legend">Approved: tenant-funded ${money2(sum(approved, tenantOf))} · absorbed ${money2(sum(approved, oursOf))}${list.some((c) => c.status === "pending") ? ` · pending ${money2(sum(list.filter((c) => c.status === "pending"), (c) => c.budgetIncrease ?? c.total))} (not in the budget)` : ""}.</div>`;
}

export interface ApprovalView {
  status: "draft" | "confirmed";
  lafTotal: number | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  originalTotal: number | null;
  approvedTotal: number;
  discount: number;
  undistributed: number;
}

function infoRows(project: CostReportProject, propertyLabel?: string, rentableSf?: number): ReportInfoRow[] {
  return [
    { label: "Tenant", value: project.tenantName || "" },
    { label: "Property", value: propertyLabel || "" },
    { label: "Rentable Area", value: rentableSf ? `${Math.round(rentableSf).toLocaleString("en-US")} SF` : "" },
  ];
}

function cmFeeTable(fee: CmFeeView | null | undefined): string {
  if (!fee) return "";
  return `
  <h3 class="sec">CM Fee Earned to Date</h3>
  <table class="t"><thead><tr><th class="l">Basis</th><th>Base</th><th>Rate</th><th>Earned</th><th>CM Fee Budget</th><th>Remaining</th></tr></thead><tbody>
    <tr><td>On work billed to date</td>${cell(fee.base)}<td class="num">${fmtPct(fee.pct)}</td>${cell(fee.earned)}${cell(fee.budget)}${cell(fee.remaining, negCls(fee.remaining))}</tr>
    <tr><td>On payments made to date</td>${cell(fee.paidBase)}<td class="num">${fmtPct(fee.pct)}</td>${cell(fee.earnedOnPaid)}${cell(fee.budget)}${cell(fee.budget - fee.earnedOnPaid, negCls(fee.budget - fee.earnedOnPaid))}</tr>
  </tbody></table>
  ${fee.supplemental ? `<table class="t" style="margin-top:6px"><thead><tr><th class="l">Supplemental CM Fee (Change Orders)</th><th>Change Order Work</th><th>Earned — Capital Partner</th><th>Budget</th><th>Remaining</th></tr></thead><tbody>
    <tr><td>On work billed to date</td>${cell(fee.supplemental.work)}${cell(fee.supplemental.earned + fee.supplemental.earnedCp)}${cell(fee.supplemental.budget)}${cell(fee.supplemental.remaining, negCls(fee.supplemental.remaining))}</tr>
  </tbody></table>
  <div class="legend">The capital partner's fee: the original CM fee on the original scope, and the supplemental fee on change order work linked to tenant change orders, at each change order's partner rate. The tenant's fee on change orders is billed on the tenant invoice.</div>` : ""}`;
}

type BvaRow = BudgetVsActual["rows"][number] & { originalBudget?: number | null; original?: number; revisions?: number; transfers?: number; changeOrders?: number };

export type FundingView = { label: string; confirmed: boolean; original: number; revisions: number; tenant: number; absorbed: number; revised: number; projectedCost: number; projectedOverrun: number; supplemental: number; totalFunding: number; projectedVariance: number; pendingChangeOrders: number; need?: number; surplus?: number; absorbedFromSurplus?: number; contingency?: number; cmReserved?: number; projectCost?: number; cmOriginal?: number; cmCeiling?: number; spendable?: number };

export type StoryView = { original: number; revised: number; revisions: number; moved: number; transferCount: number;
  groups: Array<{ key: string; label: string; total: number; tenant: number; absorbed: number; funded?: number; cos: Array<{ number: string }> }> };

/** One invoice as issued, for the CM fee report: its fee to date, so the fee on each invoice can be told apart from costs. */
type FeeInvoice = { number: string; date: string; type?: "fee" | "reimbursable"; due: number; earned: number; suppFee?: number; billTo?: string };

/**
 * Every CM fee on the project, for the team: the two rates, what each party
 * owes to date (original scope and change orders), each change order's fees,
 * the invoices that asked for them, and the CM fee budget lines.
 */
export function renderCmFeeReportHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  rates: { partner: number; tenant: number; line: string | null };
  billing: { capital: BillingStream; tenant: BillingStream };
  changeOrders: Array<{ number: string; title: string; status: string; tenantWork: number; work: number; markups: number; credit: number; tenantBase: number; tenantRate: number; tenantFee: number; partnerBase: number; partnerRate: number; partnerBasis: string; partnerFee: number }>;
  invoices: FeeInvoice[];
  cmFee?: CmFeeView | null;
  generatedBy?: string | null;
}): string {
  const { billing: { capital: c, tenant: t } } = input;
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  info.push({ label: "As Of", value: longDate(todayEastern()) });
  const sub = (v: string) => `<div style="font-size:9px;color:#6b7280">${v}</div>`;
  // Anticipated = original fee + approved change order fees; earned so far on the chosen basis; the rest still to bill.
  const P = (s: BillingStream) => s.projected ?? { original: 0, changeOrders: 0, pending: 0, budget: 0, base: 0, fee: 0, coBase: 0, pendingBase: 0 };
  const earned = (s: BillingStream) => s.earned + s.suppFee;
  const inv = (s: BillingStream) => s.feeInvoiced ?? 0;
  const pend = (v: number) => (v > 0.005 ? sub(`<span style="color:#b45309">+ ${money2(v)} pending</span>`) : "");
  const party = (label: string, who: string, s: BillingStream) => `<tr><td>${escapeHtml(label)}${who ? sub(escapeHtml(who)) : ""}</td>
    <td class="num">${fmtPct(s.pct)}</td>${cell(P(s).base)}${cell(P(s).original)}
    <td class="num">${fmt(P(s).coBase ?? 0)}${pend(P(s).pendingBase ?? 0)}</td><td class="num">${fmt(P(s).changeOrders)}${pend(P(s).pending)}</td>
    ${cell(P(s).fee)}${cell(earned(s))}${cell(inv(s))}${cell(earned(s) - inv(s))}${cell(P(s).fee - inv(s))}</tr>`;
  const tot = (k: (s: BillingStream) => number) => cell(k(c) + k(t));

  // Fee on each invoice: its fee to date less the previous one's in the same stream.
  const last: Record<string, number> = { fee: 0, reimbursable: 0 };
  const invRows = input.invoices.map((i) => {
    const stream = i.type === "reimbursable" ? "reimbursable" : "fee";
    const feeToDate = (Number(i.earned) || 0) + (Number(i.suppFee) || 0);
    const fee = feeToDate - last[stream];
    last[stream] = feeToDate;
    return `<tr><td>${escapeHtml(i.number)}</td><td>${stream === "fee" ? "Capital partner" : "Tenant"}${i.billTo ? sub(escapeHtml(i.billTo)) : ""}</td><td>${escapeHtml(longDate(i.date))}</td>
      ${cell(i.due)}${cell(fee)}${cell(i.due - (stream === "fee" ? i.due : fee))}</tr>`;
  });
  const cos = input.changeOrders;
  const coSum = (k: keyof (typeof cos)[number]) => cos.reduce((s, x) => s + (Number(x[k]) || 0), 0);

  return `<!doctype html><html><head><meta charset="utf-8"><title>CM Fee Report</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
    /* Section ribbons in the Kurv grey. */
    h3.sec { background: #4b5563; color: #fff; padding: 5px 8px; margin: 16px 0 0; letter-spacing: .08em; }
    @page { size: Letter landscape; margin: 0.5in; }
  </style></head><body>
  ${reportHeaderHtml({ title: "CM Fee Report", info })}

  <h3 class="sec">CM Fees by Party</h3>
  <table class="t"><thead><tr><th class="l">Party</th><th>Rate</th><th>Original Budget</th><th>Original Fee</th>
    <th>Approved Change Orders<div style="font-weight:400">subject to fee</div></th><th>Change Order Fees</th><th>Total Anticipated Fees</th>
    <th>Earned to Date</th><th>Invoiced</th><th>Billable</th><th>Remaining to Bill</th></tr></thead><tbody>
    ${party("Capital partner", c.billTo, c)}
    ${party("Tenant", t.billTo, t)}
    <tr class="total"><td>Total CM fees</td><td></td><td></td>${tot((s) => P(s).original)}<td></td>${tot((s) => P(s).changeOrders)}${tot((s) => P(s).fee)}${tot(earned)}${tot(inv)}${tot((s) => earned(s) - inv(s))}${tot((s) => P(s).fee - inv(s))}</tr>
  </tbody></table>

  ${cos.length ? `<h3 class="sec">CM Fees on Change Orders</h3>
  <table class="t"><thead><tr><th class="l">Change Order</th><th class="l">Status</th><th>Cost of Work</th><th>Tenant Share</th><th>Markups</th><th>Credit</th>
    <th>Tenant Fee Base</th><th>Tenant Rate</th><th>Tenant CM Fee</th><th>Partner Fee Base</th><th>Partner Rate</th><th>Partner CM Fee</th></tr></thead><tbody>
    ${cos.map((x) => `<tr><td>${escapeHtml(x.number)}${x.title ? ` — ${escapeHtml(x.title)}` : ""}</td><td>${escapeHtml(x.status[0].toUpperCase() + x.status.slice(1))}</td>${cell(x.work)}${cell(x.tenantWork)}
      ${cell(x.markups)}${x.credit ? cell(-x.credit) : `<td class="num muted">—</td>`}${cell(x.tenantBase)}
      <td class="num">${x.tenantFee ? fmtPct(x.tenantRate) : "—"}</td>${cell(x.tenantFee)}${cell(x.partnerBase)}<td class="num">${x.partnerFee ? fmtPct(x.partnerRate) : "—"}${x.partnerFee ? sub(x.partnerBasis === "tenant" ? "tenant share" : x.partnerBasis === "absorbed" ? "difference only" : "all work") : ""}</td>${cell(x.partnerFee)}</tr>`).join("")}
    <tr class="total"><td colspan="2">Total</td>${cell(coSum("work"))}${cell(coSum("tenantWork"))}${cell(coSum("markups"))}${coSum("credit") ? cell(-coSum("credit")) : `<td class="num muted">—</td>`}${cell(coSum("tenantBase"))}<td></td>${cell(coSum("tenantFee"))}${cell(coSum("partnerBase"))}<td></td>${cell(coSum("partnerFee"))}</tr>
  </tbody></table>
` : ""}

  <h3 class="sec">CM Fee Earned to Date</h3>
  <table class="t"><thead><tr><th class="l">Party</th><th class="l">Basis</th><th>Base</th><th>Rate</th><th>Earned</th><th>Total Anticipated Fees</th><th>Remaining</th></tr></thead><tbody>
    ${([["Capital partner", c], ["Tenant", t]] as const).map(([label, s]) => {
      const rows: Array<[string, { base: number; fee: number } | undefined]> = [["On work billed to date", s.earnedBilled], ["On payments made to date", s.earnedPaid]];
      return rows.map(([basis, e], k) => `<tr${k === 0 ? ' style="border-top:1px solid #9ca3af"' : ""}><td>${k === 0 ? escapeHtml(label) : ""}</td><td>${basis}${s.basis === (k === 0 ? "billed" : "paid") ? sub("invoiced on this basis") : ""}</td>
        ${cell(e?.base ?? 0)}<td class="num">${fmtPct(s.pct)}</td>${cell(e?.fee ?? 0)}${cell(P(s).fee)}${cell(P(s).fee - (e?.fee ?? 0), negCls(P(s).fee - (e?.fee ?? 0)))}</tr>`).join("");
    }).join("")}
  </tbody></table>


  <h3 class="sec">CM Fee Invoices Issued</h3>
  <table class="t"><thead><tr><th class="l">Invoice</th><th class="l">To</th><th class="l">Date</th><th>Amount</th><th>CM Fee</th><th>Costs</th></tr></thead><tbody>
    ${invRows.length ? invRows.join("") : `<tr><td colspan="6" class="muted">No invoices issued yet.</td></tr>`}
  </tbody></table>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

/** Sources of funds (who pays) and why the budget changed, side by side. */
/** One invoice stream's figures to date: what's billable to the capital partner, or to the tenant. */
export type BillingStream = {
  billTo: string; basis: 'paid' | 'billed'; pct: number;
  incurred: number; paidToDate: number; base: number; earned: number; suppFee: number;
  toDate: number; invoicedToDate: number; invoices: number; due: number;
  /** The CM fee part of what has been invoiced (the rest of a tenant invoice is costs). */
  feeInvoiced?: number;
  tenantCosOnly?: boolean;
  earnedBilled?: { base: number; fee: number };
  earnedPaid?: { base: number; fee: number };
  projected?: { original: number; changeOrders: number; pending: number; budget: number; base: number; fee: number; coBase?: number; pendingBase?: number; total?: number; pendingTotal?: number };
};

/** Billable to the capital partner vs billable to the tenant, side by side. */
export function billingTable(b?: { capital: BillingStream; tenant: BillingStream } | null): string {
  if (!b) return "";
  const { capital: c, tenant: t } = b;
  const r = (label: string, cv: string, tv: string, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><td>${label}</td><td class="num">${cv}</td><td class="num">${tv}</td></tr>`;
  const dash = '<span style="color:#9ca3af">—</span>';
  return `<h3 class="sec">Billing Summary — Capital Partner vs Tenant</h3>
  <div style="font-size:10.5px;margin-bottom:6px">Project costs incurred to date <strong>${money2(c.incurred)}</strong> · paid <strong>${money2(c.paidToDate)}</strong> (excluding the CM fee line).</div>
  <table class="t" style="width:70%"><thead><tr><th class="l"></th><th>Capital Partner${c.billTo ? `<div style="font-weight:400">${escapeHtml(c.billTo)}</div>` : ""}</th><th>Tenant${t.billTo ? `<div style="font-weight:400">${escapeHtml(t.billTo)}</div>` : ""}</th></tr></thead><tbody>
    ${r(`Billable costs`, dash, `${fmt(t.base)}<div style="font-size:9px;color:#6b7280">${t.basis} to date</div>`)}
    ${r("CM fee — original scope", `${fmt(c.earned)}<div style="font-size:9px;color:#6b7280">${fmtPct(c.pct)} on costs ${c.basis}</div>`, `${fmt(t.earned)}<div style="font-size:9px;color:#6b7280">${fmtPct(t.pct)}</div>`)}
    ${c.suppFee || t.suppFee ? r("Supplemental CM fee — change orders", fmt(c.suppFee), fmt(t.suppFee)) : ""}
    ${r("Billable to date", fmt(c.toDate), fmt(t.toDate), "sub")}
    ${r("Invoiced to date", `${fmt(c.invoicedToDate)}<div style="font-size:9px;color:#6b7280">${c.invoices} invoice${c.invoices === 1 ? "" : "s"}</div>`, `${fmt(t.invoicedToDate)}<div style="font-size:9px;color:#6b7280">${t.invoices} invoice${t.invoices === 1 ? "" : "s"}</div>`)}
    ${r("Not yet invoiced", fmt(c.due), fmt(t.due), "total")}
    ${c.projected && t.projected ? r("Projected at completion", `${fmt(c.projected.fee)}${c.projected.pending ? `<div style="font-size:9px;color:#b45309">+ ${money2(c.projected.pending)} pending</div>` : ""}`,
      `${fmt(t.projected.total ?? t.projected.fee)}${t.projected.pendingTotal ? `<div style="font-size:9px;color:#b45309">+ ${money2(t.projected.pendingTotal)} pending</div>` : ""}`) : ""}
  </tbody></table>
  <div class="legend">Capital partner: the CM fee only (the project is funded by the approved budget up front); costs shown for reference. Tenant: ${t.tenantCosOnly === false ? "their share of costs (original scope and change orders)" : "their change orders only"}, markups and CM fee, less credits.</div>`;
}

function fundingBox(f?: FundingView | null, st?: StoryView | null): string {
  if (!f) return "";
  const r = (name: string, v: number, sub = "", cls = "") => `<tr class="${cls}"><td>${escapeHtml(name)}${sub ? `<div class="muted" style="font-size:9px">${escapeHtml(sub)}</div>` : ""}</td>${cell(v)}</tr>`;
  const over = f.projectedVariance < -0.005;
  return `<div style="display:flex;gap:18px;margin:0 0 12px">
    <table class="t" style="flex:1"><thead><tr><th class="l">Sources of Funds</th><th>Amount</th></tr></thead><tbody>
      ${r(f.confirmed ? "Approved budget (capital partner)" : "Budget (draft)", f.original)}
      ${Math.abs(f.revisions) >= 0.005 ? r("Budget revisions", f.revisions, "Lines edited after confirmation") : ""}
      ${r("Tenant-funded change orders", f.tenant, "Billable to the tenant, CM fee included")}
      ${r(f.label, f.supplemental, f.supplemental > 0.005 ? "Needed beyond the budget and the tenant's share" : f.absorbed > 0.005 ? `None needed — absorbed change orders ${money2(f.absorbed)} paid from the budget surplus` : "None needed")}
      ${r("Total funding", f.totalFunding, "", "total")}
      ${f.cmReserved != null ? r("CM fees — set aside", f.cmReserved, `Original CM fee ${money2(f.cmOriginal ?? 0)} (rate on the cost to complete; the ${money2(f.cmCeiling ?? 0)} budget is a ceiling)${(f.cmReserved - (f.cmOriginal ?? 0)) > 0.005 ? ` + change order CM fees ${money2(f.cmReserved - (f.cmOriginal ?? 0))}` : ""}`) : ""}
      ${f.projectCost != null ? r("Projected cost to complete", f.projectCost, "Lines with contracts at what's committed; lines not bought out yet at budget (contingency excluded); plus change order markups") : ""}
      ${f.surplus != null && f.surplus > 0.005 ? r("Projected surplus", f.surplus, `Spendable ${money2(f.spendable ?? f.surplus)} after the CM fee it earns${f.contingency ? ` · contingency unspent ${money2(f.contingency)}` : ""}`) : ""}
    </tbody></table>
    <table class="t" style="flex:1"><thead><tr><th class="l">Why the Budget Changed</th><th>Amount</th></tr></thead><tbody>
      ${r("Original budget", f.original, "", "sub")}
      ${(st?.groups || []).map((g) => r(g.label, g.total, `${g.cos.map((c) => c.number).join(", ")}${g.tenant ? ` · tenant pays ${money2(g.tenant)}` : ""}${g.absorbed ? ` · we absorb ${money2(g.absorbed)}` : ""}${g.funded ? ` (${money2(g.funded)} from budget lines)` : ""}`)).join("")}
      ${st && Math.abs(st.revisions) >= 0.005 ? r("Revisions", st.revisions, "Lines edited after confirmation") : ""}
      ${r("Revised budget", f.revised, st?.transferCount ? `${money2(st.moved)} moved between lines; total unchanged` : "", "sub")}
      ${r("Projected cost", f.projectedCost, "Committed plus pending change orders")}
      <tr class="total"><td>${over ? "Projected over revised budget" : "Projected under revised budget"}</td><td class="num${over ? " neg" : ""}">${money2(Math.abs(f.projectedVariance))}</td></tr>
    </tbody></table></div>`;
}

export function renderBudgetVsActualHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  summary: BudgetVsActual & { rows: BvaRow[] };
  approval?: ApprovalView | null;
  cmFee?: CmFeeView | null;
  budgetCos?: BudgetCoView[];
  transfers?: Array<{ date: string; amount: number; from: string; to: string; note: string }>;
  funding?: FundingView | null;
  story?: StoryView | null;
  billing?: { capital: BillingStream; tenant: BillingStream } | null;
  generatedBy?: string | null;
}): string {
  const { summary: s, project, approval } = input;
  const allRows = s.rows as BvaRow[];
  const info = infoRows(project, input.propertyLabel, input.rentableSf);
  const notes: string[] = [];
  // How the budget was set — kept to the notes at the end, not the header.
  const endNotes: string[] = [];
  if (approval?.status === "confirmed") {
    endNotes.push(`Budget confirmed against the LAF (${money2(approval.lafTotal ?? approval.approvedTotal)}) on ${longDate(approval.confirmedAt)}${approval.confirmedBy ? ` by ${approval.confirmedBy}` : ""}.`);
    if (approval.originalTotal != null && Math.abs(approval.originalTotal - approval.approvedTotal) >= 0.005) {
      endNotes.push(`Revised since confirmation: original ${money2(approval.originalTotal)}, current ${money2(approval.approvedTotal)}.`);
    }
  } else if (approval?.lafTotal != null) {
    endNotes.push(`Draft budget: LAF entered (${money2(approval.lafTotal)}) but not yet confirmed.`);
  } else {
    endNotes.push("Draft budget: priced budget, not yet confirmed against the LAF.");
  }
  if (!s.reconciles) notes.push("Lines do not add back to the contracts. Check Unallocated lines on the project page.");

  // Original → revised columns earn their width once something has moved a line.
  const anyMv = (k: "revisions" | "transfers" | "changeOrders") => allRows.some((r) => Math.abs(r[k] ?? 0) >= 0.005);
  const showRev = anyMv("revisions"), showTx = anyMv("transfers"), showCo = anyMv("changeOrders");
  const showOriginal = showRev || showTx || showCo;
  const cols = 8 + (showOriginal ? 1 : 0) + (showRev ? 1 : 0) + (showTx ? 1 : 0) + (showCo ? 1 : 0);
  const mv = (v: number | undefined) => (v && Math.abs(v) >= 0.005 ? cell(v, "muted") : `<td class="num muted"></td>`);
  const moves = (r: BvaRow) => (showOriginal ? cell(r.original ?? 0, "muted") : "") + (showRev ? mv(r.revisions) : "") + (showTx ? mv(r.transfers) : "") + (showCo ? mv(r.changeOrders) : "");

  const row = (r: BvaRow) => {
    const cls = r.key === UNALLOCATED_KEY ? ' class="unalloc"' : r.key === DEAL_DISCOUNT_KEY ? ' class="deal"' : "";
    return `<tr${cls}><td>${escapeHtml(r.description)}</td>${moves(r)}${cell(r.budget)}${cell(r.committed)}${cell(r.pending)}${cell(r.toDate)}
      ${cell(r.variance, negCls(r.variance))}${cell(r.committedTenant)}${cell(r.committedOutstanding)}</tr>`;
  };
  const sums = (rows: BvaRow[], label: string, cls: string) => {
    const sum = (f: (r: BvaRow) => number) => rows.reduce((a, r) => a + f(r), 0);
    const v = sum((r) => r.variance);
    const m = (showOriginal ? cell(sum((r) => r.original ?? 0)) : "") + (showRev ? cell(sum((r) => r.revisions ?? 0)) : "")
      + (showTx ? cell(sum((r) => r.transfers ?? 0)) : "") + (showCo ? cell(sum((r) => r.changeOrders ?? 0)) : "");
    return `<tr class="${cls}"><td>${escapeHtml(label)}</td>${m}${cell(sum((r) => r.budget))}${cell(sum((r) => r.committed))}${cell(sum((r) => r.pending))}
      ${cell(sum((r) => r.toDate))}${cell(v, negCls(v))}${cell(sum((r) => r.committedTenant))}${cell(sum((r) => r.committedOutstanding))}</tr>`;
  };
  const group = (key: string, label: string) => {
    const rows = allRows.filter((r) => (key === "misc" ? r.bucket === "misc" || !BUCKETS.some(([k]) => k === r.bucket) : r.bucket === key));
    if (!rows.length) return "";
    return `<tr class="grp"><td colspan="${cols}">${escapeHtml(label)}</td></tr>${rows.map(row).join("")}${sums(rows, `${label} subtotal`, "sub")}`;
  };

  return `<!doctype html><html><head><meta charset="utf-8"><title>Budget vs Actual</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
    ${showOriginal ? "@page { size: Letter landscape; margin: 0.5in; }" : ""}
  </style></head><body>
  ${reportHeaderHtml({ title: "Budget vs Actual", eyebrow: "Cost Report", info, notes, draft: !!approval && approval.status !== "confirmed" })}
  ${fundingBox(input.funding, input.story)}
  <table class="t"><thead><tr>
    <th>Description</th>${showOriginal ? "<th>Original Budget</th>" : ""}${showRev ? "<th>Revisions</th>" : ""}${showTx ? "<th>Transfers</th>" : ""}${showCo ? "<th>Approved COs</th>" : ""}<th>${showOriginal ? "Revised Budget" : "Budget"}</th><th>Committed</th><th>Pending COs</th><th>Spent to Date</th>
    <th>Variance</th><th>Tenant Share</th><th>Outstanding Share</th></tr></thead><tbody>
    ${BUCKETS.map(([k, l]) => group(k, l)).join("")}
    ${sums(allRows, "Total", "total")}
  </tbody></table>
  ${budgetCoTable(input.budgetCos)}
  ${cmFeeTable(input.cmFee)}
  ${billingTable(input.billing)}
  <h3 class="sec">Notes</h3>
  <ol class="notes">
    ${[
      ...endNotes,
      ...(approval && Math.abs(approval.undistributed) >= 0.005 ? ["The Deal Discount line is the part of the LAF cut not yet put on a budget line."] : []),
      showOriginal
        ? "Revised Budget = Original + Revisions + Transfers + Approved COs. Committed = contracts plus approved change orders. Variance = Revised Budget less Committed; in parentheses when over budget."
        : "Committed = contracts plus approved change orders. Variance = Budget less Committed; in parentheses when over budget.",
      `Spent to Date is work completed and stored to date, before retainage. Retainage held: ${money2(s.totals.retainageHeld)}.`,
      ...(input.cmFee ? [`CM fee at ${fmtPct(input.cmFee.pct)} of work billed on every other budget line.`] : []),
      ...(input.transfers || []).map((t) => `Transfer ${longDate(t.date)}: ${money2(t.amount)} from ${t.from} to ${t.to}${t.note ? ` — ${t.note}` : ""}. The total is unchanged.`),
    ].map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
  </ol>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

export function renderCostPositionHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  position: ReturnType<typeof positionAsOf>;
  contracts: Array<{ id: number; counterparty: string; contractNumber?: string | null }>;
  cmFee?: CmFeeView | null;
  /** "Nova Construction #300088" or "Direct costs only" when filtered; empty for everything. */
  scope?: string;
  /** Each pay app checked against the contractor's G702. */
  checks?: Map<number, { status: string; dueDiff: number | null } | undefined>;
  /** Budget line names, for the direct costs listed. */
  lineNames?: Map<string, string>;
  generatedBy?: string | null;
}): string {
  const { position: p } = input;
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  if (input.scope) info.push({ label: "Contract", value: input.scope });
  info.push({ label: "As Of", value: longDate(p.asOf) });
  const checkCell = (id: number) => {
    const c = input.checks?.get(id);
    if (!c || c.status === "none") return `<td class="muted">Not checked</td>`;
    if (c.status === "match") return `<td style="color:#15803d">✓ Matches</td>`;
    return `<td class="neg">⚠ Off${c.dueDiff != null ? ` ${money2(Math.abs(c.dueDiff))}` : ""}</td>`;
  };
  const name = new Map(input.contracts.map((c) => [c.id, c.counterparty + (c.contractNumber ? ` #${c.contractNumber}` : "")]));
  const t = p.totals;

  const contractRows = p.contracts.map((c) => `<tr><td>${escapeHtml(name.get(c.contractId) || "")}</td>
    <td class="num">${fmt(c.contractSum)}${c.pendingChanges ? `<div style="font-size:9px;color:#b45309">+ ${money2(c.pendingChanges)} pending CO</div>` : ""}</td>${cell(c.billedToDate)}<td class="num">${fmtPct(c.pctComplete)}</td>${cell(c.retainageHeld)}
    ${cell(c.netBilled)}${cell(c.paid)}${cell(c.owed, c.owed > 0.005 || c.owed < -0.005 ? "neg" : "")}${cell(c.leftToPay)}</tr>`).join("")
    + (p.direct && p.direct.count > 0 ? `<tr><td>Direct costs — no contract <span style="color:#6b7280">(${p.direct.count}, listed below)</span></td>
    ${cell(p.direct.total)}${cell(p.direct.total)}<td class="num">100.00%</td>${cell(0)}${cell(p.direct.total)}${cell(p.direct.total)}${cell(0)}${cell(0)}</tr>` : "");

  // Costs with no contract: spelled out one by one, under headings that fit them.
  const METHOD: Record<string, string> = { card: "Card", check: "Check", ach: "ACH", wire: "Wire", other: "Other" };
  const paidBy = (d: { method?: string | null; reference?: string | null }) => {
    const m = d.method ? METHOD[d.method] || d.method : "";
    const ref = d.reference || "";
    return m && ref.toLowerCase().startsWith(m.toLowerCase()) ? ref : [m, ref].filter(Boolean).join(" ");
  };
  const directRows = p.direct?.rows ?? [];
  const directTable = directRows.length === 0 ? "" : `
  <h3 class="sec">Direct Costs (No Contract)</h3>
  <table class="t"><thead><tr><th class="l">Date</th><th class="l">Paid To</th><th class="l">Description</th><th class="l">Budget Line</th><th class="l">Paid By</th><th>Amount</th></tr></thead><tbody>
    ${directRows.map((d) => `<tr><td class="l">${escapeHtml(longDate(d.date))}</td><td class="l">${escapeHtml(d.vendor || "")}</td><td class="l">${escapeHtml(d.description || "")}</td>
      <td class="l">${escapeHtml(d.key ? input.lineNames?.get(d.key) ?? "Removed line" : "Unallocated")}</td><td class="l">${escapeHtml(paidBy(d))}</td>${cell(d.amount)}</tr>`).join("")}
    <tr class="total"><td class="l" colspan="5">Total direct costs</td>${cell(p.direct.total)}</tr>
  </tbody></table>
  <div class="legend">Paid directly, with no contract or pay app behind them — billed and paid in one go, so nothing is owed or held.</div>`;

  const appRows = p.applications.length === 0
    ? `<tr><td colspan="7" class="muted">No pay apps or invoices dated on or before ${escapeHtml(longDate(p.asOf))}.</td></tr>`
    : p.applications.map((a) => `<tr><td>${escapeHtml(name.get(a.contractId) || "")}</td><td>${a.kind === 'invoice' ? 'Invoice' : 'App'} ${a.docNumber}</td>
      <td>${escapeHtml(longDate(a.date))}</td>${cell(a.due)}${cell(a.paid)}${cell(a.open, a.open > 0.005 ? "neg" : "")}${checkCell(a.applicationId)}</tr>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Pay App Status</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
  </style></head><body>
  ${reportHeaderHtml({ title: "Pay App Status", eyebrow: "Cost Report", info })}
  <table class="t"><thead><tr>
    <th>Contract</th><th>Contract Sum</th><th>Billed to Date</th><th>% Billed</th><th>Retainage Held</th>
    <th>Net Billed</th><th>Paid</th><th>Owed</th><th>Left to Pay</th></tr></thead><tbody>
    ${contractRows}
    <tr class="total"><td>Total</td>${cell(t.contractSum)}${cell(t.billedToDate)}<td class="num">${fmtPct(t.pctComplete)}</td>${cell(t.retainageHeld)}
      ${cell(t.netBilled)}${cell(t.paid)}${cell(t.owed)}${cell(t.leftToPay)}</tr>
  </tbody></table>
  <div class="legend">Billed to Date = work completed and stored. Net Billed = billed less retainage. Owed = net billed not yet paid.
    Left to Pay = contract sum less paid (owed + retainage + work not yet billed). Approved change orders only.</div>

  <h3 class="sec">Pay Apps &amp; Invoices</h3>
  <table class="t"><thead><tr><th>Contract</th><th class="l">No.</th><th class="l">Dated</th><th>Payment Due</th><th>Paid</th><th>Open</th><th class="l">vs Contractor G702</th></tr></thead><tbody>
    ${appRows}
  </tbody></table>
  ${directTable}
  ${cmFeeTable(input.cmFee)}
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

export function renderJobCostLedgerHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  ledger: ReturnType<typeof buildLedger>;
  from?: string | null;
  to?: string | null;
  generatedBy?: string | null;
}): string {
  const { ledger } = input;
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  const period = input.from || input.to
    ? `${input.from ? longDate(input.from) : "Start"} – ${input.to ? longDate(input.to) : "today"}`
    : "All entries to date";
  info.push({ label: "Period", value: period });
  const notes = ledger.unreconciledCount
    ? [`${ledger.unreconciledCount} ${ledger.unreconciledCount === 1 ? "entry is" : "entries are"} not yet reconciled (${money2(ledger.unreconciled)}), marked ○.`]
    : [];
  const METHOD: Record<string, string> = { card: "Card", check: "Check", ach: "ACH", wire: "Wire", other: "Other" };
  const how = (e: LedgerEntry) => {
    const m = e.method ? METHOD[e.method] || e.method : "";
    const ref = e.reference || "";
    // "WIRE 0912" already says how; don't print "Wire WIRE 0912".
    return m && ref.toLowerCase().startsWith(m.toLowerCase()) ? ref : [m, ref].filter(Boolean).join(" ");
  };

  const byPayee = new Map<string, number>();
  for (const e of ledger.entries) byPayee.set(e.vendor, (byPayee.get(e.vendor) ?? 0) + e.amount);
  const payees = Array.from(byPayee).sort((a, b) => b[1] - a[1]);

  return `<!doctype html><html><head><meta charset="utf-8"><title>Job Cost Ledger</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
    .t td.c { text-align: center; color: #059669; }
    .t td.c.open { color: #b45309; }
  </style></head><body>
  ${reportHeaderHtml({ title: "Job Cost Ledger", eyebrow: "Cost Report", info, notes })}
  <table class="t"><thead><tr>
    <th class="l">Date</th><th class="l">Paid To</th><th class="l">Description</th><th class="l">How Paid</th>
    <th class="l">Budget Line</th><th>Amount</th><th>Running Total</th><th title="Reconciled">✓</th></tr></thead><tbody>
    ${ledger.entries.length === 0 ? `<tr><td colspan="8" class="muted">No payments or charges in this period.</td></tr>` : ledger.entries.map((e) => `<tr>
      <td style="white-space:nowrap">${escapeHtml(longDate(e.date))}</td><td>${escapeHtml(e.vendor)}</td><td>${escapeHtml(e.description)}${e.notes ? `<div style="font-size:9.5px;color:#4b5563;font-style:italic">${escapeHtml(e.notes)}</div>` : ""}</td>
      <td>${escapeHtml(how(e))}</td><td>${escapeHtml(e.budgetLine)}</td>${cell(e.amount)}${cell(e.running, "muted")}
      <td class="c${e.reconciled ? "" : " open"}">${e.reconciled ? "✓" : "○"}</td></tr>`).join("")}
    <tr class="total"><td colspan="5">Total</td>${cell(ledger.total)}<td></td><td></td></tr>
  </tbody></table>
  ${payees.length > 1 ? `<h3 class="sec">By Payee</h3>
  <table class="t" style="width:60%"><thead><tr><th class="l">Paid To</th><th>Total</th></tr></thead><tbody>
    ${payees.map(([v, a]) => `<tr><td>${escapeHtml(v)}</td>${cell(a)}</tr>`).join("")}
    <tr class="total"><td>Total</td>${cell(ledger.total)}</tr></tbody></table>` : ""}
  <div class="legend">Payments against pay apps and invoices are split across budget lines by each line's schedule of values; see Budget vs Actual for that split.</div>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

export interface CmInvoiceView {
  number: string | null;          // null = draft
  date: string;
  base: number; pct: number; earned: number; previous: number; due: number;
  lines: Array<{ description: string; spent: number; tenantSharePct: number; billable: number }>;
  payApps: Array<{ contract: string; number: number; date: string; billedToDate: number }>;
  items?: Array<{ date: string; vendor: string; item: string; amount: number; billable: number; thisInvoice: boolean; paid?: number; retainage?: number }>;
  /** fee: the CM fee only. reimbursable: the billable costs plus the CM fee. */
  type?: 'fee' | 'reimbursable';
  basis?: 'paid' | 'billed';
  billTo?: string;
  toDate?: number;
  suppFee?: number;
  cpFee?: number;
  supplementalCos?: string[];
}

/**
 * The CM fee invoice, ready for accounting to send on: who it's to, the
 * work it's figured on (by budget line, and the pay apps behind it), the
 * rate, what was invoiced before, and what is due now.
 */
export function renderCmInvoiceHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  invoice: CmInvoiceView;
  generatedBy?: string | null;
}): string {
  const inv = input.invoice;
  const reimb = inv.type === 'reimbursable';
  const paid = inv.basis === 'paid';
  const info: ReportInfoRow[] = [
    { label: "Bill To", value: inv.billTo || input.project.tenantName || "" },
    ...(inv.billTo && input.project.tenantName && inv.billTo !== input.project.tenantName ? [{ label: "Tenant", value: input.project.tenantName }] : []),
    { label: "Property", value: input.propertyLabel || "" },
    { label: "Rentable Area", value: input.rentableSf ? `${Math.round(input.rentableSf).toLocaleString("en-US")} SF` : "" },
    { label: "Invoice No.", value: inv.number ?? "DRAFT — not yet issued" },
    { label: "Invoice Date", value: longDate(inv.date) },
  ];
  const title = reimb ? "Reimbursement & Construction Management Fee Invoice" : "Construction Management Fee Invoice";
  const costWord = paid ? "paid" : "billed";
  const showRet = !!inv.items?.some((i) => i.retainage !== undefined && Math.abs(i.retainage) >= 0.005);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${reimb ? "Reimbursement Invoice" : "CM Fee Invoice"}</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
    .due { margin-top: 10px; margin-left: auto; width: 55%; border-collapse: collapse; font-size: 12px; }
    .due td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
    .due td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .due tr.big td { font-size: 14px; font-weight: 700; border-top: 2px solid #111827; border-bottom: 2px solid #111827; background: #f9fafb; }
    .draft-mark { color: #b45309; font-weight: 700; }
  </style></head><body>
  ${reportHeaderHtml({ title, eyebrow: "Invoice", info, draft: !inv.number,
    notes: inv.number ? [] : ["Draft — figures are as of today and change as more work is billed. Issue the invoice to fix them."] })}

  ${!reimb && inv.items && inv.items.length && inv.items.some((i) => i.paid !== undefined) ? `<h3 class="sec">Costs Incurred and Paid to Date</h3>
  <table class="t"><thead><tr><th class="l">Date</th><th class="l">Paid To</th><th class="l">Item</th><th>Cost Incurred</th>${showRet ? "<th>Retainage Held</th>" : ""}<th>Paid</th><th class="l"></th></tr></thead><tbody>
    ${inv.items.map((it) => `<tr${it.thisInvoice ? ' style="background:#eff6ff"' : ""}><td style="white-space:nowrap">${escapeHtml(longDate(it.date))}</td><td>${escapeHtml(it.vendor)}</td>
      <td>${escapeHtml(it.item)}</td>${cell(it.amount)}${showRet ? (it.retainage ? cell(it.retainage) : '<td class="num muted">—</td>') : ""}${cell(it.paid ?? 0)}<td style="font-size:9.5px;color:#1d4ed8;white-space:nowrap">${it.thisInvoice ? "This invoice" : ""}</td></tr>`).join("")}
    <tr class="total"><td colspan="3">Total</td>${cell(inv.items.reduce((s, i) => s + i.amount, 0))}${showRet ? cell(inv.items.reduce((s, i) => s + (i.retainage ?? 0), 0)) : ""}${cell(inv.items.reduce((s, i) => s + (i.paid ?? 0), 0))}<td></td></tr>
  </tbody></table>
  <div class="legend">Shown for reference: this invoice is for the construction management fee only. The fee is figured on the costs ${paid ? "paid" : "billed"} to date.${showRet ? " Retainage held is the part of each pay app withheld until the contractor's work is complete — cost incurred less retainage is what the pay app certified for payment." : ""}</div>`
  : inv.items && inv.items.length ? `<h3 class="sec">Costs ${paid ? "Paid" : "Billed"} to Date</h3>
  <table class="t"><thead><tr><th class="l">Date</th><th class="l">Paid To</th><th class="l">Item</th><th>Amount</th><th>Billable to Tenant</th><th class="l"></th></tr></thead><tbody>
    ${inv.items.map((it) => `<tr${it.thisInvoice ? ' style="background:#eff6ff"' : ""}><td style="white-space:nowrap">${escapeHtml(longDate(it.date))}</td><td>${escapeHtml(it.vendor)}</td>
      <td>${escapeHtml(it.item)}</td>${cell(it.amount)}${cell(it.billable)}<td style="font-size:9.5px;color:#1d4ed8;white-space:nowrap">${it.thisInvoice ? "This invoice" : ""}</td></tr>`).join("")}
    <tr class="total"><td colspan="3">Total</td>${cell(inv.items.reduce((s, i) => s + i.amount, 0))}${cell(inv.items.reduce((s, i) => s + i.billable, 0))}<td></td></tr>
  </tbody></table>` : ""}

  ${inv.lines.length ? `<h3 class="sec">${inv.items && inv.items.length ? "By Budget Line" : "Work Completed to Date"}</h3>
  <table class="t"><thead><tr><th class="l">Description</th><th>Completed &amp; Stored to Date</th><th>Tenant Share</th><th>Billable to Tenant</th></tr></thead><tbody>
    ${inv.lines.map((l) => `<tr><td>${escapeHtml(l.description)}</td>${cell(l.spent)}<td class="num">${fmtPct(l.tenantSharePct)}</td>${cell(l.billable)}</tr>`).join("")}
    <tr class="total"><td>Total</td>${cell(inv.lines.reduce((s, l) => s + l.spent, 0))}<td></td>${cell(inv.base)}</tr>
  </tbody></table>` : ""}

  <table class="due"><tbody>
    <tr><td>${reimb ? "Billable costs" : "Costs the fee is figured on —"} ${costWord} to date</td><td class="num">${fmt(inv.base)}</td></tr>
    <tr><td>Construction management fee at ${fmtPct(inv.pct)}${inv.suppFee || inv.cpFee ? " — original scope" : ""}</td><td class="num">${fmt(inv.earned)}</td></tr>
    ${inv.suppFee ? `<tr><td>Supplemental CM fee — change orders${inv.supplementalCos?.length ? ` (${escapeHtml(inv.supplementalCos.join(", "))})` : ""}</td><td class="num">${fmt(inv.suppFee)}</td></tr>` : ""}
    ${inv.cpFee ? `<tr><td>Supplemental CM fee — change order work funded by the owner</td><td class="num">${fmt(inv.cpFee)}</td></tr>` : ""}
    ${reimb ? `<tr><td><strong>Total costs and fee to date</strong></td><td class="num"><strong>${fmt(inv.toDate ?? inv.base + inv.earned)}</strong></td></tr>`
      : inv.suppFee || inv.cpFee ? `<tr><td><strong>Total CM fees to date</strong></td><td class="num"><strong>${fmt(inv.toDate ?? inv.earned)}</strong></td></tr>` : ""}
    <tr><td>Less previously invoiced</td><td class="num">${inv.previous ? `(${money2(inv.previous)})` : money2(0)}</td></tr>
    <tr class="big"><td>Amount Due This Invoice</td><td class="num">${fmt(inv.due)}</td></tr>
  </tbody></table>

  ${inv.payApps.length && !(inv.items && inv.items.length) ? `<h3 class="sec">Contractor Pay Applications Included</h3>
  <table class="t"><thead><tr><th class="l">Contractor</th><th class="l">Through Pay App</th><th class="l">Period Ending</th><th>Billed to Date</th></tr></thead><tbody>
    ${inv.payApps.map((p) => `<tr><td>${escapeHtml(p.contract)}</td><td>No. ${p.number}</td><td>${escapeHtml(longDate(p.date))}</td>${cell(p.billedToDate)}</tr>`).join("")}
  </tbody></table>` : ""}

  <h3 class="sec">Notes</h3>
  <ol class="notes">
    <li>${escapeHtml(reimb ? `Reimbursement of the billable costs listed, plus a construction management fee of ${fmtPct(inv.pct)} on them. Billable means the tenant's share of each budget line.`
      : `A construction management fee of ${fmtPct(inv.pct)}. The project's costs are funded by the approved budget; they are listed for reference only.`)}</li>
    ${inv.suppFee || inv.cpFee ? `<li>${escapeHtml("Change order work is shown at the tenant's share of each change order; its CM fee is the supplemental fee, kept apart from the fee on the original scope.")}</li>` : ""}
    <li>${paid ? "Costs are amounts paid to date: payments against the contractors' pay applications and invoices listed, and direct charges at cost." : "Costs are work completed and stored to date, before retainage, as certified on the pay applications and invoices listed. Direct charges are at cost."}</li>
    ${inv.items && inv.items.some((i) => i.thisInvoice) && inv.previous ? `<li>Items shaded and marked "This invoice" are new since the last CM invoice.</li>` : ""}
    ${inv.previous ? `<li>${escapeHtml(`Previously invoiced CM fees of ${money2(inv.previous)} are deducted.`)}</li>` : ""}
  </ol>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

/** Every conditional waiver, and whether its unconditional has come in with the next pay app. */
export function renderWaiverLogHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  groups: PayAppWaivers[];
  contractName: (id: number) => string;
  /** What's been left out, said on the report ("Showing pay apps 01, 06 only"). */
  filter?: string;
  generatedBy?: string | null;
}): string {
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  const nn = (n: number) => String(n).padStart(2, "0");
  const all = input.groups.flatMap((g) => g.rows);
  const nMissing = all.filter((r) => r.status === "missing").length;
  const nCond = all.filter((r) => r.kind === "conditional" && r.status === "outstanding").length;
  const nUncond = all.filter((r) => r.kind === "unconditional" && r.status === "outstanding").length;
  const nWait = all.filter((r) => r.status === "awaiting payment").length;
  const okApps = input.groups.filter((g) => g.compliant).length;
  const outN = nMissing + nCond + nUncond;
  const notes = [
    ...(input.filter ? [input.filter.charAt(0).toUpperCase() + input.filter.slice(1)] : []),
    `${input.filter?.includes("outstanding waivers only") ? "" : `${okApps} of ${input.groups.length} pay app${input.groups.length === 1 ? "" : "s"} compliant.`}${outN ? ` ${outN} waiver${outN === 1 ? "" : "s"} outstanding, shaded: ${[
      nMissing ? `${nMissing} conditional${nMissing === 1 ? "" : "s"} not entered` : "",
      nCond ? `${nCond} conditional${nCond === 1 ? "" : "s"} not received` : "",
      nUncond ? `${nUncond} unconditional${nUncond === 1 ? "" : "s"} not received` : "",
    ].filter(Boolean).join(", ")}.` : ""}${nWait ? ` ${nWait} unconditional${nWait === 1 ? "" : "s"} pending funding.` : ""}`,
  ];
  const STATUS: Record<string, string> = { received: "Received", outstanding: "Outstanding", missing: "Not Entered", "not needed": "Not Needed", "awaiting payment": "Pending Funding" };
  const byContract = new Map<number, PayAppWaivers[]>();
  for (const g of input.groups) byContract.set(g.contractId, [...(byContract.get(g.contractId) ?? []), g]);
  const row = (r: PayAppWaiverRow) => {
    const bad = r.status === "outstanding" || r.status === "missing";
    const what = r.kind === "conditional" ? "Conditional" : r.releases != null ? `Unconditional — for Pay App ${nn(r.releases)}` : "Unconditional";
    const amt = r.status === "missing" ? `<td class="num muted">${r.amount ? `last ${money2(r.amount)}` : "—"}</td>` : cell(r.amount ?? 0);
    const wait = r.status === "awaiting payment";
    return `<tr${bad ? ' style="background:#fef2f2"' : wait ? ' style="background:#fffbeb"' : ""}><td></td><td${r.party === "gc" ? "" : ' style="padding-left:22px"'}>${escapeHtml(r.vendor)}</td>
      <td>${what}${r.edited ? " — edited" : ""}</td>${amt}<td style="${bad ? "color:#991b1b;font-weight:600" : wait ? "color:#92400e;font-weight:600" : r.status === "received" ? "color:#166534" : "color:#6b7280"}">${STATUS[r.status]}${r.note ? `<div style="font-weight:400;font-size:9px;color:#92400e">${escapeHtml(r.note)}</div>` : ""}</td></tr>`;
  };
  const body = Array.from(byContract).map(([cid, groups]) => `
    <tr class="grp"><td colspan="5">${escapeHtml(input.contractName(cid))}</td></tr>
    ${groups.map((g) => `
      <tr><td colspan="5" style="padding-top:8px;border-bottom:1px solid #d1d5db"><strong>Pay App ${nn(g.appNumber)}</strong>
        ${g.compliant
          ? '<span style="margin-left:8px;font-size:10px;font-weight:700;color:#166534;background:#dcfce7;border-radius:3px;padding:1px 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact">Compliant</span>'
          : `<span style="margin-left:8px;font-size:10px;font-weight:700;color:#991b1b;background:#fee2e2;border-radius:3px;padding:1px 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact">${g.outstanding} Outstanding</span>`}
        ${g.awaiting ? `<span style="margin-left:6px;font-size:10px;font-weight:700;color:#92400e;background:#fef3c7;border-radius:3px;padding:1px 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact">${g.awaiting} Pending Funding</span>` : ""}
        ${g.totals.count ? `<span class="muted" style="font-size:10px;margin-left:10px">Subs (${g.totals.subCount}) ${money2(g.totals.subs)} · GC ${money2(g.totals.gc)} · GC Less Subs ${money2(g.totals.gap)}${g.totals.gapPct != null ? ` (${g.totals.gapPct.toFixed(1)}% of the GC's release)` : ""}</span>` : ""}</td></tr>
      ${[...g.rows].filter((r) => !(r.kind === "conditional" && r.status === "not needed" && !(r.amount && Math.abs(r.amount) >= 0.005))).map((r, i) => ({ r, i }))
        // The GC leads each kind, its subs indented beneath in the order arranged.
        .sort((a, b) => (a.r.kind === b.r.kind ? 0 : a.r.kind === "conditional" ? -1 : 1) || (a.r.kind === b.r.kind ? (a.r.party === "gc" ? 0 : 1) - (b.r.party === "gc" ? 0 : 1) : 0) || a.i - b.i)
        .map(({ r }) => row(r)).join("")}
      ${(() => {
        // Subs not billing this pay app (marked not needed, nothing on it): one line, not $0.00 rows.
        const quiet = g.rows.filter((r) => r.kind === "conditional" && r.status === "not needed" && !(r.amount && Math.abs(r.amount) >= 0.005));
        return quiet.length ? `<tr><td></td><td colspan="4" class="muted" style="font-size:10px;padding-left:22px">Not billing this pay app: ${quiet.map((r) => escapeHtml(r.vendor)).join(", ")}</td></tr>` : "";
      })()}`).join("")}`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Lien Waiver Log</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
  </style></head><body>
  ${reportHeaderHtml({ title: "Lien Waiver Log", info, notes })}
  <table class="t"><thead><tr><th class="l" style="width:4%"></th><th class="l">Vendor</th><th class="l">Waiver</th><th>Amount</th><th class="l">Status</th></tr></thead><tbody>
    ${body || `<tr><td colspan="5" class="muted">No waivers recorded yet.</td></tr>`}
  </tbody></table>
  <h3 class="sec">Notes</h3>
  <ol class="notes">
    <li>A pay app is compliant when its conditional waivers are in and so are the unconditional waivers it carries for the pay app before. A pay app's own unconditionals come with the next pay app and are listed there.</li>
    <li>"Pending Funding": the pay app that unconditional releases hasn't been paid in full yet, so the contractor can't give it. Each row shows that vendor's conditional on the pay app it releases; the GC's row also shows what we've paid against that pay app. Subs are paid by the GC once it's funded. It isn't held against the contractor's compliance.</li>
    <li>"Not Entered": the GC gives a conditional with every pay app. Subs are listed only on the pay apps they bill.</li>
    <li>"Edited" marks an unconditional whose vendor or amount was changed from the conditional it answers.</li>
    <li>GC Less Subs: the GC's release less its subcontractors' — the GC's own work, fee and general conditions, or sub releases not yet in.</li>
  </ol>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

/**
 * Pay Application Log: each pay app's GC and sub pay applications — line 8
 * against the vendor's conditional, and whether the file is in — then the
 * same by vendor across the job.
 */
export function renderPayAppLogHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  groups: PayAppLogGroup[];
  contractName: (id: number) => string;
  filter?: string;
  generatedBy?: string | null;
}): string {
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  const nn = (n: number) => String(n).padStart(2, "0");
  const done = input.groups.filter((g) => g.complete).length;
  const miss = input.groups.reduce((t, g) => t + g.missingFiles, 0);
  const off = input.groups.reduce((t, g) => t + g.mismatched, 0);
  const notes = [
    ...(input.filter ? [input.filter.charAt(0).toUpperCase() + input.filter.slice(1)] : []),
    `${done} of ${input.groups.length} pay app${input.groups.length === 1 ? "" : "s"} complete.${miss ? ` ${miss} pay application${miss === 1 ? "" : "s"} not attached.` : ""}${off ? ` ${off} amount${off === 1 ? "" : "s"} not matching the conditional.` : ""}`,
  ];
  const tag = (txt: string, fg: string, bg: string) => `<span style="margin-left:8px;font-size:10px;font-weight:700;color:${fg};background:${bg};border-radius:3px;padding:1px 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact">${txt}</span>`;
  const row = (r: PayAppLogRow) => {
    const bad = r.diff != null && Math.abs(r.diff) >= 0.01;
    return `<tr${!r.files.length ? ' style="background:#fffbeb"' : ""}><td></td><td${r.party === "gc" ? "" : ' style="padding-left:22px"'}>${escapeHtml(r.vendor)}</td>
      ${r.due == null ? '<td class="num muted">Not entered</td>' : cell(r.due)}${r.conditional == null ? '<td class="num muted">—</td>' : cell(r.conditional)}
      <td style="${bad ? "color:#92400e;font-weight:600" : r.diff == null ? "color:#6b7280" : "color:#166534"}">${r.diff == null ? "—" : bad ? `Off by ${money2(Math.abs(r.diff))}` : "Matches"}</td>
      <td style="${r.files.length ? "color:#166534" : "color:#92400e;font-weight:600"}">${r.files.length ? `Attached${r.files.length > 1 ? ` (${r.files.length})` : ""}` : "Missing"}</td></tr>`;
  };
  const byContract = new Map<number, PayAppLogGroup[]>();
  for (const g of input.groups) byContract.set(g.contractId, [...(byContract.get(g.contractId) ?? []), g]);
  const body = Array.from(byContract).map(([cid, groups]) => `
    <tr class="grp"><td colspan="6">${escapeHtml(input.contractName(cid))}</td></tr>
    ${groups.map((g) => {
      const subs = g.rows.filter((r) => r.party === "sub");
      const subDue = subs.reduce((t, r) => t + (r.due ?? 0), 0), subCond = subs.reduce((t, r) => t + (r.conditional ?? 0), 0);
      return `
      <tr><td colspan="6" style="padding-top:8px;border-bottom:1px solid #d1d5db"><strong>Pay App ${nn(g.appNumber)}</strong>
        ${g.complete ? tag("Complete", "#166534", "#dcfce7") : ""}${g.missingFiles ? tag(`${g.missingFiles} Missing`, "#92400e", "#fef3c7") : ""}${g.mismatched ? tag(`${g.mismatched} Don't Match`, "#92400e", "#fef3c7") : ""}
        ${subs.length ? `<span class="muted" style="font-size:10px;margin-left:10px">Subs (${subs.length}) conditionals ${money2(subCond)} · ${(() => {
          const ent = subs.filter((r) => r.due != null);
          return ent.length ? `payment due ${money2(subDue)}${ent.length < subs.length ? ` (${ent.length} of ${subs.length} entered)` : ""}` : "payment due not entered";
        })()}</span>` : ""}</td></tr>
      ${g.rows.map(row).join("")}`;
    }).join("")}`).join("");
  // By vendor, across every pay app shown.
  // Conditionals across every pay app shown; payment due and the difference only where line 8 has
  // been entered — a pay app with no amount yet isn't a $0 pay app (Adolfo, 2026-10-22).
  type V = { vendor: string; party: string; apps: number; cond: number; entered: number; due: number; condEntered: number; dueMissing: number; filesMissing: number };
  const vend: V[] = [];
  for (const g of input.groups) for (const r of g.rows) {
    let v = vend.find((x) => vendorKey(x.vendor) === vendorKey(r.vendor));
    if (!v) { v = { vendor: r.vendor, party: r.party, apps: 0, cond: 0, entered: 0, due: 0, condEntered: 0, dueMissing: 0, filesMissing: 0 }; vend.push(v); }
    v.apps++; v.cond += r.conditional ?? 0;
    if (r.due != null) { v.entered++; v.due += r.due; v.condEntered += r.conditional ?? 0; } else v.dueMissing++;
    if (!r.files.length) v.filesMissing++;
  }
  vend.sort((a, b) => (a.party === "gc" ? -1 : b.party === "gc" ? 1 : 0));
  // The heading sits in the table head, so it can't be left alone at the foot of a page.
  const vendTable = vend.length ? `
  <table class="t" style="margin-top:14px"><thead>
    <tr><th colspan="6" class="l" style="background:none;border:0;padding:6px 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#374151">By Vendor</th></tr>
    <tr><th class="l">Vendor</th><th>Pay Apps</th><th>Conditionals</th><th title="Line 8 on the pay apps where it's been entered">Payment Due (Entered)</th><th title="Payment due less conditionals, on those same pay apps">Difference</th><th class="l">Missing</th></tr></thead><tbody>
    ${vend.map((v) => {
      const diff = Math.round((v.due - v.condEntered) * 100) / 100;
      return `<tr><td${v.party === "gc" ? "" : ' style="padding-left:22px"'}>${escapeHtml(v.vendor)}</td><td class="num">${v.apps}</td>${cell(v.cond)}
      ${v.entered ? `<td class="num">${money2(v.due)}${v.entered < v.apps ? `<div class="muted" style="font-size:9px">${v.entered} of ${v.apps} pay apps</div>` : ""}</td>` : '<td class="num muted">Not entered</td>'}
      ${!v.entered ? '<td class="num muted">—</td>' : Math.abs(diff) < 0.005 ? '<td class="num" style="color:#166534">Matches</td>' : `<td class="num" style="color:#92400e;font-weight:600">${fmt(diff)}</td>`}
      <td class="muted">${[v.filesMissing ? `${v.filesMissing} file${v.filesMissing === 1 ? "" : "s"}` : "", v.dueMissing ? `${v.dueMissing} amount${v.dueMissing === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "—"}</td></tr>`;
    }).join("")}
  </tbody></table>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pay Application Log</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
  </style></head><body>
  ${reportHeaderHtml({ title: "Pay Application Log", info, notes })}
  <table class="t"><thead><tr><th class="l" style="width:4%"></th><th class="l">Vendor</th><th>Payment Due (Line 8)</th><th>Conditional</th><th class="l">Check</th><th class="l">Pay App</th></tr></thead><tbody>
    ${body || `<tr><td colspan="6" class="muted">No pay applications recorded yet.</td></tr>`}
  </tbody></table>
  ${vendTable}
  <h3 class="sec">Notes</h3>
  <ol class="notes">
    <li>Each pay app's vendors come from its conditional waivers: the GC and every sub billing that pay app. Subs not billing are left out.</li>
    <li>Payment Due is line 8 (Current Payment Due) of the vendor's own pay application — the GC's from this pay app's G702, each sub's as entered from theirs — checked against that vendor's conditional waiver.</li>
    <li>Shaded: the vendor's pay application isn't attached yet.</li>
    <li>By Vendor: conditionals across every pay app shown; payment due and the difference only on the pay apps where line 8 has been entered.</li>
  </ol>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

/** Change Order Log: every vendor change order, its amount, the pay app it was approved on, and the executed copy. */
export function renderCoLogHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  rows: CoLogRow[];
  contractName: (id: number) => string;
  appLabel: (contractId: number, appNumber: number) => string;
  generatedBy?: string | null;
}): string {
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  const approved = input.rows.filter((r) => r.status === "approved");
  const notExec = approved.filter((r) => !r.executed).length;
  const pending = input.rows.filter((r) => r.status === "pending");
  const notes = [`${approved.length} approved change order${approved.length === 1 ? "" : "s"}, ${money2(approved.reduce((t, r) => t + r.amount, 0))}. ${notExec ? `${notExec} without an executed copy on file, shaded.` : "All executed copies on file."}${pending.length ? ` ${pending.length} pending, ${money2(pending.reduce((t, r) => t + r.amount, 0))}.` : ""}`];
  const STATUS: Record<string, string> = { approved: "Approved", pending: "Pending", void: "Void" };
  const byContract = new Map<number, CoLogRow[]>();
  for (const r of input.rows) byContract.set(r.contractId, [...(byContract.get(r.contractId) ?? []), r]);
  const body = Array.from(byContract).map(([cid, rows]) => {
    const tot = rows.filter((r) => r.status === "approved").reduce((t, r) => t + r.amount, 0);
    return `
    <tr class="grp"><td colspan="6">${escapeHtml(input.contractName(cid))}</td></tr>
    ${rows.map((r) => {
      const bad = r.status === "approved" && !r.executed;
      return `<tr${bad ? ' style="background:#fffbeb"' : r.status === "void" ? ' style="color:#9ca3af"' : ""}>
        <td>${escapeHtml(r.number)}</td><td>${escapeHtml(r.title ?? "")}</td>
        <td>${r.startApp != null ? escapeHtml(input.appLabel(r.contractId, r.startApp)) : '<span class="muted">—</span>'}</td>
        <td>${STATUS[r.status]}</td>${cell(r.amount)}
        <td style="${r.executed ? "color:#166534" : bad ? "color:#92400e;font-weight:600" : "color:#6b7280"}">${r.executed ? `Executed${r.files.length > 1 ? ` (${r.files.length} files)` : ""}` : r.status === "approved" ? "Not on file" : "—"}</td></tr>`;
    }).join("")}
    <tr class="total"><td colspan="4">Approved change orders</td>${cell(tot)}<td></td></tr>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Change Order Log</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
  </style></head><body>
  ${reportHeaderHtml({ title: "Change Order Log", info, notes })}
  <table class="t"><thead><tr><th class="l">Change Order</th><th class="l">Description</th><th class="l">Approved On</th><th class="l">Status</th><th>Amount</th><th class="l">Executed Copy</th></tr></thead><tbody>
    ${body || `<tr><td colspan="6" class="muted">No change orders recorded yet.</td></tr>`}
  </tbody></table>
  <h3 class="sec">Notes</h3>
  <ol class="notes">
    <li>Approved On: the pay app whose G702 first carries the change order ("approved this period").</li>
    <li>Executed Copy: the signed change order attached on the Contracts tab. Shaded: approved, but no signed copy on file yet.</li>
  </ol>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

/**
 * Why the budget is what it is: when it was confirmed and at what, every
 * change since in date order (transfers, change orders, edits) with the
 * budget after each, and the change orders and transfers in full.
 */
export function renderBudgetLogHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  approval: { status: string; lafTotal: number | null; confirmedAt: string | null; confirmedBy: string | null; originalTotal: number | null; approvedTotal: number; currentTotal: number;
    revisions: Array<{ at: string; by: string | null; total: number; note: string }>; coSummary: { approved: number; pending: number } };
  transfers: Array<{ date: string; amount: number; from: string; to: string; note: string; by: string | null }>;
  budgetCos: BudgetCoView[];
  generatedBy?: string | null;
}): string {
  const a = input.approval;
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  const confirmedDay = a.confirmedAt ? a.confirmedAt.slice(0, 10) : null;
  type Ev = { at: string; what: string; by: string | null; total: number | null };
  const events: Ev[] = [];
  if (a.confirmedAt) events.push({ at: a.confirmedAt, what: `Budget confirmed against the LAF (${money2(a.lafTotal ?? a.approvedTotal)})`, by: a.confirmedBy, total: a.originalTotal });
  for (const v of a.revisions) events.push({ at: v.at, what: v.note, by: v.by, total: v.total });
  // Transfers made while the budget was still a draft aren't in the revision log.
  for (const t of input.transfers) {
    if (!confirmedDay || t.date < confirmedDay) {
      events.push({ at: `${t.date}T00:00:00Z`, what: `Transfer ${money2(t.amount)}: ${t.from} → ${t.to}${t.note ? ` (${t.note})` : ""} — before confirmation`, by: t.by, total: null });
    }
  }
  events.sort((x, y) => x.at.localeCompare(y.at));
  const statusLine = a.status === "confirmed"
    ? `Confirmed ${longDate(a.confirmedAt)}${a.confirmedBy ? ` by ${a.confirmedBy}` : ""}`
    : "Draft — not yet confirmed";
  info.push({ label: "Budget", value: statusLine });

  return `<!doctype html><html><head><meta charset="utf-8"><title>Budget Log</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
    .sum { width: 55%; border-collapse: collapse; font-size: 12px; margin-bottom: 6px; }
    .sum td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; }
    .sum td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .sum tr.big td { font-weight: 700; border-top: 2px solid #111827; border-bottom: 2px solid #111827; background: #f9fafb; }
  </style></head><body>
  ${reportHeaderHtml({ title: "Budget Log", eyebrow: "Cost Report", info, draft: a.status !== "confirmed" })}
  <table class="sum"><tbody>
    <tr><td>Original budget${a.status === "confirmed" ? "" : " (draft)"}</td><td class="num">${money2(a.originalTotal ?? a.approvedTotal)}</td></tr>
    ${a.status === "confirmed" && Math.abs(a.approvedTotal - (a.originalTotal ?? a.approvedTotal)) >= 0.005 ? `<tr><td>Budget edits since confirmation</td><td class="num">${fmt(a.approvedTotal - (a.originalTotal ?? 0))}</td></tr>` : ""}
    <tr><td>Approved change orders</td><td class="num">${fmt(a.coSummary.approved)}</td></tr>
    <tr><td>Transfers between lines (${input.transfers.length})</td><td class="num">${money2(0)}</td></tr>
    <tr class="big"><td>Current budget</td><td class="num">${money2(a.currentTotal)}</td></tr>
  </tbody></table>
  ${a.coSummary.pending ? `<div class="legend">Pending change orders of ${money2(a.coSummary.pending)} are not in the budget until approved.</div>` : ""}

  <h3 class="sec">Log</h3>
  <table class="t"><thead><tr><th class="l">Date</th><th class="l">What Changed</th><th class="l">By</th><th>Budget After</th></tr></thead><tbody>
    ${events.length ? events.map((e) => `<tr><td style="white-space:nowrap">${escapeHtml(longDate(e.at))}</td><td>${escapeHtml(e.what)}</td><td style="white-space:nowrap">${escapeHtml(e.by || "")}</td><td class="num">${e.total == null ? "—" : money2(e.total)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">Nothing logged yet. Confirm the budget on the Budget tab to start the log.</td></tr>`}
  </tbody></table>

  ${budgetCoTable(input.budgetCos)}

  ${input.transfers.length ? `<h3 class="sec">Transfers</h3>
  <table class="t"><thead><tr><th class="l">Date</th><th>Amount</th><th class="l">From</th><th class="l">To</th><th class="l">Why</th><th class="l">By</th></tr></thead><tbody>
    ${input.transfers.map((t) => `<tr><td style="white-space:nowrap">${escapeHtml(longDate(t.date))}</td>${cell(t.amount)}<td>${escapeHtml(t.from)}</td><td>${escapeHtml(t.to)}</td><td>${escapeHtml(t.note)}</td><td style="white-space:nowrap">${escapeHtml(t.by || "")}</td></tr>`).join("")}
  </tbody></table>` : ""}

  <h3 class="sec">Notes</h3>
  <ol class="notes">
    <li>The original budget is fixed when the budget is confirmed; everything after it is listed above, oldest first.</li>
    <li>Transfers move money between budget lines and never change the total. Change orders change it only once approved.</li>
  </ol>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

async function propertyFacts(project: { propertyId: number | null; rfpId: number | null }) {
  const property: any = project.propertyId ? await storage.getProperty(project.propertyId).catch(() => undefined) : undefined;
  const rfp: any = project.rfpId ? await storage.getRfpRequest(project.rfpId).catch(() => undefined) : undefined;
  return {
    propertyLabel: rfp ? rfpPropertyLabel(rfp, property) : (property?.name ?? ""),
    rentableSf: rfp ? rfpRentableSf(rfp, property) : 0,
  };
}

export function registerBudgetVsActualReportRoutes(app: Express): void {
  app.get("/api/reports/budget-vs-actual/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderBudgetVsActualHtml({
        project: b.project, ...(await propertyFacts(b.project)),
        summary: b.summary,
        funding: b.funding.confirmed || b.approval.changeOrders.length ? b.funding : null,
        story: b.story,
        billing: b.cmInvoiceDrafts,
        // Confirmations made before names were stored carry an email address;
        // when it is the reader's own, print the name.
        approval: (() => {
          const u: any = (req as any).user;
          const by = b.approval.confirmedBy;
          return by && by.includes('@') && u?.email && by.toLowerCase() === String(u.email).toLowerCase()
            ? { ...b.approval, confirmedBy: generatedByName(u) || by } : b.approval;
        })(),
        cmFee: b.cmFee,
        transfers: b.approval.transfers.map((t) => ({
          date: t.date, amount: t.amount, note: t.note,
          from: b.project.baseline.find((x: any) => x.key === t.fromKey)?.description ?? 'a removed line',
          to: b.project.baseline.find((x: any) => x.key === t.toKey)?.description ?? 'a removed line',
        })),
        budgetCos: b.approval.changeOrders.map((c) => {
          const t = b.approval.changeOrderTotals.find((x) => x.id === c.id) ?? { work: 0, cm: 0, total: 0 };
          const ln = (k: string) => b.project.baseline.find((l: any) => l.key === k)?.description ?? "a budget line";
          const fundedNote = (c.fundedFrom || []).length ? `Paid from ${(c.fundedFrom || []).map((f: any) => `${ln(f.key)} ${money2(f.amount)}`).join(", ")}` : undefined;
          return { number: c.number, title: c.title, date: c.date, status: c.status, billable: c.billable, cmFee: c.cmFee, cmFeePct: c.cmFeePct, reason: c.reason, ...t, fundedNote };
        }),
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("Budget vs actual report error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });

  app.get("/api/reports/job-cost-ledger/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
      const from = day(req.query.from), to = day(req.query.to);
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      // Re-filter the bundle's ledger for the period; running totals restart at the period's start.
      const all = b.ledger.entries;
      const inPeriod = all.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
      let running = 0;
      const entries = inPeriod.map((e) => { running = Math.round((running + e.amount) * 100) / 100; return { ...e, running }; });
      const open = entries.filter((e) => !e.reconciled);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderJobCostLedgerHtml({
        project: b.project, ...(await propertyFacts(b.project)),
        ledger: { entries, total: running, unreconciled: Math.round(open.reduce((s, e) => s + e.amount, 0) * 100) / 100, unreconciledCount: open.length },
        from, to, generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("Job cost ledger report error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });

  app.get("/api/reports/budget-log/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      const lineName = (k: string) => b.project.baseline.find((x: any) => x.key === k)?.description ?? "a removed line";
      const u: any = (req as any).user;
      const nameFor = (by: string | null) => (by && by.includes("@") && u?.email && by.toLowerCase() === String(u.email).toLowerCase() ? generatedByName(u) || by : by);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderBudgetLogHtml({
        project: b.project, ...(await propertyFacts(b.project)),
        approval: { ...b.approval, confirmedBy: nameFor(b.approval.confirmedBy), revisions: b.approval.revisions.map((v) => ({ ...v, by: nameFor(v.by) })) },
        transfers: b.approval.transfers.map((t) => ({ date: t.date, amount: t.amount, note: t.note, by: nameFor(t.by), from: lineName(t.fromKey), to: lineName(t.toKey) })),
        budgetCos: b.approval.changeOrders.map((c) => {
          const t = b.approval.changeOrderTotals.find((x) => x.id === c.id) ?? { work: 0, cm: 0, total: 0 };
          return { number: c.number, title: c.title, date: c.date, status: c.status, billable: c.billable, cmFee: c.cmFee, cmFeePct: c.cmFeePct, reason: c.reason, ...t };
        }),
        generatedBy: generatedByName(u),
      }));
    } catch (e: any) {
      console.error("Budget log error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });

  app.get("/api/reports/pay-app-log/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      const apps = b.applications.map((a: any) => ({ id: a.id, contractId: a.contractId, number: a.number, docNumber: a.docNumber }));
      const cname = (cid: number) => b.contracts.find((c) => c.id === cid)?.counterparty ?? "";
      const want = String(req.query.apps || "").split(",").map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
      const issuesOnly = String(req.query.issues || "") === "1";
      const groups = payAppLog(apps, b.waivers, b.documents as any, cname, (aid) => { const a: any = b.applications.find((x: any) => x.id === aid); return a ? gcPaymentDue(a, b.waivers, cname(a.contractId)).due : null; })
        .filter((g) => !want.length || want.includes(g.appId))
        .map((g) => (issuesOnly ? { ...g, rows: g.rows.filter((r) => !r.files.length || (r.diff != null && Math.abs(r.diff) >= 0.01)) } : g))
        .filter((g) => !issuesOnly || g.rows.length);
      const parts: string[] = [];
      if (want.length) parts.push(`Showing ${want.length === 1 ? "pay app" : "pay apps"} ${apps.filter((a) => want.includes(a.id)).sort((x, y) => x.number - y.number).map((a) => String(a.docNumber || a.number).padStart(2, "0")).join(", ")} only`);
      if (issuesOnly) parts.push("missing files and amounts that don't match only");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderPayAppLogHtml({
        project: b.project, ...(await propertyFacts(b.project)), groups,
        contractName: (cid) => b.contracts.find((c) => c.id === cid)?.counterparty ?? "Contract",
        filter: parts.length ? `${parts.join("; ")}.` : "",
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("Pay app log error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });

  app.get("/api/reports/co-log/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      const rows = coLog(b.changeOrders as any, b.sovLines as any, b.documents as any);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderCoLogHtml({
        project: b.project, ...(await propertyFacts(b.project)), rows,
        contractName: (cid) => b.contracts.find((c) => c.id === cid)?.counterparty ?? "Contract",
        appLabel: (cid, n) => { const a: any = b.applications.find((x: any) => x.contractId === cid && x.number === n); return a ? `${a.kind === "invoice" ? "Invoice" : "Pay App"} ${String(a.docNumber ?? n).padStart(2, "0")}` : "Next pay app"; },
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("CO log error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });

  app.get("/api/reports/lien-waivers/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      const apps = b.applications.map((a: any) => ({ id: a.id, contractId: a.contractId, number: a.number, docNumber: a.docNumber }));
      const cname = (cid: number) => b.contracts.find((c) => c.id === cid)?.counterparty ?? "";
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderWaiverLogHtml({
        project: b.project, ...(await propertyFacts(b.project)),
        groups: (() => {
          // Only the pay apps asked for (?apps=12,15), and only what's outstanding (?outstanding=1).
          const want = new Set(String(req.query.apps || "").split(",").map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0));
          const outOnly = String(req.query.outstanding || "") === "1";
          const paidOf = paidOfFrom(b.payments, (aid) => { const a: any = b.applications.find((x: any) => x.id === aid); return a ? gcPaymentDue(a, b.waivers, cname(a.contractId)).due : null; });
          return waiversByPayApp(apps, b.waivers, cname, paidOf)
            .filter((g) => !want.size || want.has(g.appId))
            .map((g) => (outOnly ? { ...g, rows: g.rows.filter((r) => r.status === "outstanding" || r.status === "missing" || r.status === "awaiting payment") } : g))
            .filter((g) => !outOnly || g.rows.length);
        })(),
        filter: (() => {
          const want = String(req.query.apps || "").split(",").map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
          const parts: string[] = [];
          if (want.length) parts.push(`Showing ${want.length === 1 ? "pay app" : "pay apps"} ${apps.filter((a) => want.includes(a.id)).sort((x, y) => x.number - y.number).map((a) => String(a.docNumber || a.number).padStart(2, "0")).join(", ")} only`);
          if (String(req.query.outstanding || "") === "1") parts.push("outstanding waivers only");
          return parts.length ? `${parts.join("; ")}.` : "";
        })(),
        contractName: (cid) => b.contracts.find((c) => c.id === cid)?.counterparty ?? "Contract",
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("Lien waiver log error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });

  // Every CM fee on the project — capital partner and tenant — for the team.
  app.get("/api/reports/cm-fees/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      const lineName = b.cmSettings.key ? b.project.baseline.find((l: any) => l.key === b.cmSettings.key)?.description ?? null : null;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderCmFeeReportHtml({
        project: b.project, ...(await propertyFacts(b.project)),
        rates: { partner: b.cmSettings.pct, tenant: b.cmSettings.tenantPct, line: lineName },
        billing: b.cmInvoiceDrafts,
        changeOrders: b.approval.changeOrders.filter((c) => c.status !== "void").map((c) => {
          const t = coTotals(c);
          // Fee bases shown so each row ties: tenant share + markups − credit = what the tenant's fee is on.
          return { number: c.number, title: c.title, status: c.status, work: t.work, tenantWork: t.tenantWork, markups: t.markups, credit: t.credit,
            tenantBase: t.tenantFeeBase, tenantRate: c.cmFeePct, tenantFee: t.cm,
            partnerBase: t.partnerBase, partnerRate: c.partnerFeePct ?? 0, partnerBasis: c.partnerFeeBasis ?? "all", partnerFee: t.cmAbsorbed };
        }),
        invoices: b.cmInvoices,
        cmFee: b.cmFee,
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("CM fee report error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });

  app.get("/api/reports/cm-invoice/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      const want = String(req.query.invoice || "");
      let invoice: CmInvoiceView;
      if (want) {
        const rec = b.cmInvoices.find((i) => i.number === want);
        if (!rec) return res.status(404).json({ message: "Invoice not found" });
        // Issued before retainage was kept on the backup: a pay app's retainage doesn't change, so take today's.
        const held = new Map<string, number>();
        for (const it of [...(b.cmInvoiceDrafts.capital.items || []), ...(b.cmInvoiceDrafts.tenant.items || [])] as any[]) if (it.retainage !== undefined) held.set(it.ref, it.retainage);
        invoice = { ...rec, items: rec.items?.map((it: any) => (it.retainage === undefined && held.has(it.ref) ? { ...it, retainage: held.get(it.ref) } : it)) } as any;
      } else {
        const stream = String(req.query.stream || "");
        const d = stream === "tenant" ? b.cmInvoiceDrafts.tenant : stream === "capital" ? b.cmInvoiceDrafts.capital : b.cmInvoiceDraft;
        invoice = { number: null, date: todayEastern(), ...d,
          payApps: b.contracts.map((c) => {
            const apps = b.positionInput.applications.filter((a) => a.contractId === c.id);
            if (!apps.length) return null;
            const last = apps.reduce((m, a) => (a.number > m.number ? a : m), apps[0]);
            return { contract: c.counterparty, number: last.docNumber ?? last.number, date: last.date, billedToDate: b.g702ByContract[c.id]?.completedAndStored ?? 0 };
          }).filter(Boolean) as CmInvoiceView["payApps"] };
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderCmInvoiceHtml({ project: b.project, ...(await propertyFacts(b.project)), invoice, generatedBy: generatedByName((req as any).user) }));
    } catch (e: any) {
      console.error("CM invoice report error:", e);
      res.status(500).json({ message: "Failed to generate the invoice", error: e?.message });
    }
  });

  // One billable budget change order, laid out to send the tenant for signature.
  app.get("/api/reports/tenant-co/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      const co = b.approval.changeOrders.find((c) => c.id === String(req.query.co || ""));
      if (!co) return res.status(404).json({ message: "Change order not found" });
      const t = coTotals(co);
      if (t.tenant <= 0.005 && t.tenantWork <= 0.005) return res.status(400).json({ message: "The tenant pays none of this change order." });
      const lineName = new Map(b.project.baseline.map((l: any) => [l.key, l.description]));
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderTenantCoHtml({
        project: b.project, ...(await propertyFacts(b.project)),
        co: {
          number: co.number, title: co.title, date: co.date, status: co.status, cmFeePct: co.cmFee ? co.cmFeePct : 0,
          // Only what the tenant pays: each line at the tenant's share.
          lines: co.lines.map((l) => ({ budgetLine: String(lineName.get(l.key) ?? ""), description: l.description, amount: Math.round(l.amount * (l.tenantPct ?? 100)) / 100 }))
            .filter((l) => Math.abs(l.amount) >= 0.005),
          work: t.tenantWork, cm: t.cm, credit: t.credit, total: t.tenant,
          markups: t.markupLines.filter((m) => m.amount).map((m) => ({ label: m.fixed ? m.label : `${m.label} (${fmtPct(m.pct)})`, amount: m.amount })),
          backup: b.documents.filter((d: any) => d.budgetCoId === co.id).map((d: any) => d.originalName),
        },
        billTo: String(((b.project as any).settings || {}).billTo || b.project.tenantName || ""),
        previousApproved: b.approval.changeOrders.filter((c) => c.status === "approved" && c.id !== co.id)
          .reduce((s2, c) => s2 + coTotals(c).tenant, 0),
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("Tenant CO report error:", e);
      res.status(500).json({ message: "Failed to generate the change order", error: e?.message });
    }
  });

  // "Pay App Status" is the name now; the old path keeps working.
  app.get(["/api/reports/pay-app-status/:id", "/api/reports/cost-position/:id"], requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const asOfRaw = String(req.query.asOf || "");
      const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : todayEastern();
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      // One contract, direct costs only, or everything.
      const want = String(req.query.contract || "all");
      const one = /^\d+$/.test(want) ? b.contracts.find((c) => c.id === Number(want)) : null;
      if (/^\d+$/.test(want) && !one) return res.status(404).json({ message: "Contract not found" });
      const input = filterPositionInput(b.positionInput, want);
      const checks = new Map(b.applications.map((a: any) => [a.id, a.check]));
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderCostPositionHtml({
        project: b.project, ...(await propertyFacts(b.project)),
        position: positionAsOf(asOf, input),
        contracts: b.contracts,
        // The fee is earned on what has been billed so far — today's figure, and only for the whole project.
        cmFee: asOf === todayEastern() && !one && want !== "direct" ? b.cmFee : null,
        scope: one ? one.counterparty + (one.contractNumber ? ` #${one.contractNumber}` : "") : want === "direct" ? "Direct costs only" : "",
        checks,
        lineNames: new Map(((b.project.baseline || []) as any[]).map((x) => [x.key, x.description])),
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("Cost position report error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });
}

/** A tenant change order: scope, cost of work, CM fee, total, signatures. */
export function renderTenantCoHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  co: { number: string; title: string; date: string | null; status: string; cmFeePct: number;
    lines: Array<{ budgetLine: string; description: string; amount: number }>; work: number; cm: number; credit?: number; total: number; backup: string[];
    markups?: Array<{ label: string; amount: number }> };
  billTo: string;
  previousApproved: number;
  generatedBy?: string | null;
}): string {
  const { co } = input;
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  info.push({ label: "Change Order", value: co.number });
  info.push({ label: "Date", value: longDate(co.date) });
  if (input.billTo && input.billTo.trim().toLowerCase() !== String(input.project.tenantName ?? "").trim().toLowerCase()) info.push({ label: "To", value: input.billTo });
  // The tenant sees what the work is, not how it maps to our budget lines.
  const lines = co.lines.map((l) => `<tr><td>${escapeHtml(l.description || l.budgetLine)}</td>${cell(l.amount)}</tr>`).join("");
  const sig = (who: string) => `<div style="flex:1"><div style="font-weight:700;font-size:11px;margin-bottom:28px">${escapeHtml(who)}</div>
    <div style="border-top:1px solid #111827;padding-top:3px;font-size:10px;color:#6b7280">Signature</div>
    <div style="display:flex;gap:12px;margin-top:22px"><div style="flex:2;border-top:1px solid #111827;padding-top:3px;font-size:10px;color:#6b7280">Name / Title</div>
    <div style="flex:1;border-top:1px solid #111827;padding-top:3px;font-size:10px;color:#6b7280">Date</div></div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tenant Change Order ${escapeHtml(co.number)}</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
  </style></head><body>
  ${reportHeaderHtml({ title: "Tenant Change Order", info })}
  ${co.title ? `<p style="font-size:13px;margin:0 0 10px"><strong>Scope:</strong> ${escapeHtml(co.title)}</p>` : ""}
  <table class="t"><thead><tr><th class="l">Description</th><th>Amount</th></tr></thead><tbody>
    ${lines}
    <tr class="sub"><td>Cost of work</td>${cell(co.work)}</tr>
    ${(co.markups || []).map((m) => `<tr><td>${escapeHtml(m.label)}</td>${cell(m.amount)}</tr>`).join("")}
    ${co.cm ? `<tr><td>Construction management fee (${fmtPct(co.cmFeePct)})</td>${cell(co.cm)}</tr>` : ""}
    ${co.credit ? `<tr><td>Credit</td>${cell(-co.credit)}</tr>` : ""}
    <tr class="total"><td>Change order total</td>${cell(co.total)}</tr>
  </tbody></table>
  <table class="t" style="margin-top:12px;width:60%"><tbody>
    <tr><td>Change orders previously approved</td>${cell(input.previousApproved)}</tr>
    <tr><td>This change order</td>${cell(co.total)}</tr>
    <tr class="total"><td>Total approved change orders with this one</td>${cell(input.previousApproved + co.total)}</tr>
  </tbody></table>
  ${co.backup.length ? `<h3 class="sec">Backup Attached</h3><ol class="notes">${co.backup.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ol>` : ""}
  <p style="font-size:11px;margin:16px 0 22px">Signing below approves this change order and the amount above, to be billed with the project's costs.</p>
  <div style="display:flex;gap:40px">${sig("Approved by (Tenant)")}${sig("Submitted by")}</div>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}
