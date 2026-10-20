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
import { DEAL_DISCOUNT_KEY } from "@shared/cost-budget-approval";
import { positionAsOf, buildLedger, type LedgerEntry } from "@shared/cost-position";
import { fmtPct } from "@shared/format";
import { waiverLog, type WaiverLogRow } from "@shared/cost-waivers";

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
}

export interface BudgetCoView {
  number: string; title: string; date: string | null; status: string; billable: boolean;
  work: number; cm: number; total: number; cmFeePct: number; cmFee: boolean;
}

function budgetCoTable(cos: BudgetCoView[] | undefined): string {
  const list = (cos || []).filter((c) => c.status !== 'void');
  if (!list.length) return "";
  const approved = list.filter((c) => c.status === 'approved');
  const sum = (xs: BudgetCoView[], f: (c: BudgetCoView) => number) => xs.reduce((s, c) => s + f(c), 0);
  return `
  <h3 class="sec">Budget Change Orders</h3>
  <table class="t"><thead><tr><th class="l">No.</th><th class="l">For</th><th class="l">Date</th><th class="l">Tenant</th>
    <th>Cost of Work</th><th>CM Fee</th><th>Total</th><th class="l">Status</th></tr></thead><tbody>
    ${list.map((c) => `<tr><td>${escapeHtml(c.number)}</td><td>${escapeHtml(c.title)}</td><td style="white-space:nowrap">${escapeHtml(longDate(c.date))}</td>
      <td>${c.billable ? "Billable" : "Not billable"}</td>${cell(c.work)}<td class="num">${c.cm ? fmt(c.cm) : "—"}${c.cmFee ? ` <span class="muted">(${fmtPct(c.cmFeePct)})</span>` : ""}</td>${cell(c.total)}
      <td>${c.status === "approved" ? "Approved" : "Pending"}</td></tr>`).join("")}
    <tr class="total"><td colspan="4">Approved</td>${cell(sum(approved, (c) => c.work))}${cell(sum(approved, (c) => c.cm))}${cell(sum(approved, (c) => c.total))}<td></td></tr>
  </tbody></table>
  <div class="legend">Approved: billable ${money2(sum(approved.filter((c) => c.billable), (c) => c.total))} · not billable ${money2(sum(approved.filter((c) => !c.billable), (c) => c.total))}${list.some((c) => c.status === "pending") ? ` · pending ${money2(sum(list.filter((c) => c.status === "pending"), (c) => c.total))} (not in the budget)` : ""}.</div>`;
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
  </tbody></table>`;
}

type BvaRow = BudgetVsActual["rows"][number] & { originalBudget?: number | null };

export function renderBudgetVsActualHtml(input: {
  project: CostReportProject;
  propertyLabel?: string;
  rentableSf?: number;
  summary: BudgetVsActual & { rows: BvaRow[] };
  approval?: ApprovalView | null;
  cmFee?: CmFeeView | null;
  budgetCos?: BudgetCoView[];
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

  // The Original column earns its width only once the budget has moved since it was confirmed.
  const showOriginal = approval?.status === "confirmed"
    && allRows.some((r) => Math.abs((r.originalBudget ?? 0) - r.budget) >= 0.005);
  const cols = showOriginal ? 9 : 8;

  const row = (r: BvaRow) => {
    const cls = r.key === UNALLOCATED_KEY ? ' class="unalloc"' : r.key === DEAL_DISCOUNT_KEY ? ' class="deal"' : "";
    return `<tr${cls}><td>${escapeHtml(r.description)}</td>${showOriginal ? cell(r.originalBudget ?? 0, "muted") : ""}${cell(r.budget)}${cell(r.committed)}${cell(r.pending)}${cell(r.toDate)}
      ${cell(r.variance, negCls(r.variance))}${cell(r.committedTenant)}${cell(r.committedOutstanding)}</tr>`;
  };
  const sums = (rows: BvaRow[], label: string, cls: string) => {
    const sum = (f: (r: BvaRow) => number) => rows.reduce((a, r) => a + f(r), 0);
    const v = sum((r) => r.variance);
    return `<tr class="${cls}"><td>${escapeHtml(label)}</td>${showOriginal ? cell(sum((r) => r.originalBudget ?? 0)) : ""}${cell(sum((r) => r.budget))}${cell(sum((r) => r.committed))}${cell(sum((r) => r.pending))}
      ${cell(sum((r) => r.toDate))}${cell(v, negCls(v))}${cell(sum((r) => r.committedTenant))}${cell(sum((r) => r.committedOutstanding))}</tr>`;
  };
  const group = (key: string, label: string) => {
    const rows = allRows.filter((r) => (key === "misc" ? r.bucket === "misc" || !BUCKETS.some(([k]) => k === r.bucket) : r.bucket === key));
    if (!rows.length) return "";
    return `<tr class="grp"><td colspan="${cols}">${escapeHtml(label)}</td></tr>${rows.map(row).join("")}${sums(rows, `${label} subtotal`, "sub")}`;
  };

  return `<!doctype html><html><head><meta charset="utf-8"><title>Budget vs Actual</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
  </style></head><body>
  ${reportHeaderHtml({ title: "Budget vs Actual", eyebrow: "Cost Report", info, notes })}
  <table class="t"><thead><tr>
    <th>Description</th>${showOriginal ? "<th>Original Budget</th>" : ""}<th>${showOriginal ? "Current Budget" : "Budget"}</th><th>Committed</th><th>Pending COs</th><th>Spent to Date</th>
    <th>Variance</th><th>Tenant Share</th><th>Outstanding Share</th></tr></thead><tbody>
    ${BUCKETS.map(([k, l]) => group(k, l)).join("")}
    ${sums(allRows, "Total", "total")}
  </tbody></table>
  ${budgetCoTable(input.budgetCos)}
  ${cmFeeTable(input.cmFee)}
  <h3 class="sec">Notes</h3>
  <ol class="notes">
    ${[
      ...endNotes,
      ...(approval && Math.abs(approval.undistributed) >= 0.005 ? ["The Deal Discount line is the part of the LAF cut not yet put on a budget line."] : []),
      "Committed = contracts plus approved change orders. Variance = Budget less Committed; in parentheses when over budget.",
      `Spent to Date is work completed and stored to date, before retainage. Retainage held: ${money2(s.totals.retainageHeld)}.`,
      ...(input.cmFee ? [`CM fee at ${fmtPct(input.cmFee.pct)} of work billed on every other budget line.`] : []),
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
  generatedBy?: string | null;
}): string {
  const { position: p } = input;
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  info.push({ label: "As Of", value: longDate(p.asOf) });
  const name = new Map(input.contracts.map((c) => [c.id, c.counterparty + (c.contractNumber ? ` #${c.contractNumber}` : "")]));
  const t = p.totals;

  const contractRows = p.contracts.map((c) => `<tr><td>${escapeHtml(name.get(c.contractId) || "")}</td>
    ${cell(c.contractSum)}${cell(c.billedToDate)}<td class="num">${fmtPct(c.pctComplete)}</td>${cell(c.retainageHeld)}
    ${cell(c.netBilled)}${cell(c.paid)}${cell(c.owed, c.owed > 0.005 || c.owed < -0.005 ? "neg" : "")}${cell(c.leftToPay)}</tr>`).join("")
    + (p.direct && p.direct.count > 0 ? `<tr><td>Direct costs (${p.direct.count} ${p.direct.count === 1 ? "entry" : "entries"})</td>
    ${cell(p.direct.total)}${cell(p.direct.total)}<td class="num">100.00%</td>${cell(0)}${cell(p.direct.total)}${cell(p.direct.total)}${cell(0)}${cell(0)}</tr>` : "");

  const appRows = p.applications.length === 0
    ? `<tr><td colspan="6" class="muted">No pay apps or invoices dated on or before ${escapeHtml(longDate(p.asOf))}.</td></tr>`
    : p.applications.map((a) => `<tr><td>${escapeHtml(name.get(a.contractId) || "")}</td><td>App ${a.number}</td>
      <td>${escapeHtml(longDate(a.date))}</td>${cell(a.due)}${cell(a.paid)}${cell(a.open, a.open > 0.005 ? "neg" : "")}</tr>`).join("");

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
  <table class="t"><thead><tr><th>Contract</th><th class="l">No.</th><th class="l">Dated</th><th>Payment Due</th><th>Paid</th><th>Open</th></tr></thead><tbody>
    ${appRows}
  </tbody></table>
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
  items?: Array<{ date: string; vendor: string; item: string; amount: number; billable: number; thisInvoice: boolean }>;
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
  const info: ReportInfoRow[] = [
    { label: "Bill To", value: input.project.tenantName || "" },
    { label: "Property", value: input.propertyLabel || "" },
    { label: "Rentable Area", value: input.rentableSf ? `${Math.round(input.rentableSf).toLocaleString("en-US")} SF` : "" },
    { label: "Invoice No.", value: inv.number ?? "DRAFT — not yet issued" },
    { label: "Invoice Date", value: longDate(inv.date) },
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>CM Fee Invoice</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
    .due { margin-top: 10px; margin-left: auto; width: 55%; border-collapse: collapse; font-size: 12px; }
    .due td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
    .due td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .due tr.big td { font-size: 14px; font-weight: 700; border-top: 2px solid #111827; border-bottom: 2px solid #111827; background: #f9fafb; }
    .draft-mark { color: #b45309; font-weight: 700; }
  </style></head><body>
  ${reportHeaderHtml({ title: "Construction Management Fee Invoice", eyebrow: "Invoice", info,
    notes: inv.number ? [] : ["Draft — figures are as of today and change as more work is billed. Issue the invoice to fix them."] })}

  ${inv.items && inv.items.length ? `<h3 class="sec">Costs Billed to Date</h3>
  <table class="t"><thead><tr><th class="l">Date</th><th class="l">Paid To</th><th class="l">Item</th><th>Amount</th><th>Billable to Tenant</th><th class="l"></th></tr></thead><tbody>
    ${inv.items.map((it) => `<tr${it.thisInvoice ? ' style="background:#eff6ff"' : ""}><td style="white-space:nowrap">${escapeHtml(longDate(it.date))}</td><td>${escapeHtml(it.vendor)}</td>
      <td>${escapeHtml(it.item)}</td>${cell(it.amount)}${cell(it.billable)}<td style="font-size:9.5px;color:#1d4ed8;white-space:nowrap">${it.thisInvoice ? "This invoice" : ""}</td></tr>`).join("")}
    <tr class="total"><td colspan="3">Total</td>${cell(inv.items.reduce((s, i) => s + i.amount, 0))}${cell(inv.items.reduce((s, i) => s + i.billable, 0))}<td></td></tr>
  </tbody></table>` : ""}

  <h3 class="sec">${inv.items && inv.items.length ? "By Budget Line" : "Work Completed to Date"}</h3>
  <table class="t"><thead><tr><th class="l">Description</th><th>Completed &amp; Stored to Date</th><th>Tenant Share</th><th>Billable to Tenant</th></tr></thead><tbody>
    ${inv.lines.map((l) => `<tr><td>${escapeHtml(l.description)}</td>${cell(l.spent)}<td class="num">${fmtPct(l.tenantSharePct)}</td>${cell(l.billable)}</tr>`).join("")}
    <tr class="total"><td>Total</td>${cell(inv.lines.reduce((s, l) => s + l.spent, 0))}<td></td>${cell(inv.base)}</tr>
  </tbody></table>

  <table class="due"><tbody>
    <tr><td>Billable work completed to date</td><td class="num">${fmt(inv.base)}</td></tr>
    <tr><td>Construction management fee at ${fmtPct(inv.pct)}</td><td class="num">${fmt(inv.earned)}</td></tr>
    <tr><td>Less previously invoiced</td><td class="num">${inv.previous ? `(${money2(inv.previous)})` : money2(0)}</td></tr>
    <tr class="big"><td>Amount Due This Invoice</td><td class="num">${fmt(inv.due)}</td></tr>
  </tbody></table>

  ${inv.payApps.length && !(inv.items && inv.items.length) ? `<h3 class="sec">Contractor Pay Applications Included</h3>
  <table class="t"><thead><tr><th class="l">Contractor</th><th class="l">Through Pay App</th><th class="l">Period Ending</th><th>Billed to Date</th></tr></thead><tbody>
    ${inv.payApps.map((p) => `<tr><td>${escapeHtml(p.contract)}</td><td>No. ${p.number}</td><td>${escapeHtml(longDate(p.date))}</td>${cell(p.billedToDate)}</tr>`).join("")}
  </tbody></table>` : ""}

  <h3 class="sec">Notes</h3>
  <ol class="notes">
    <li>${escapeHtml(`Fee is ${fmtPct(inv.pct)} of work completed and stored to date that is billable to the tenant, per the tenant's share of each budget line.`)}</li>
    <li>Completed and stored to date is before retainage, as certified on the contractors' pay applications and invoices listed above. Direct charges are at cost.</li>
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
  rows: WaiverLogRow[];
  contractName: (id: number) => string;
  generatedBy?: string | null;
}): string {
  const info = infoRows(input.project, input.propertyLabel, input.rentableSf);
  const out = input.rows.filter((r) => r.status === "unconditional outstanding" || r.status === "conditional outstanding");
  const notes = out.length ? [`${out.length} waiver${out.length === 1 ? "" : "s"} outstanding, shaded.`] : [];
  const nn = (n: number) => String(n).padStart(2, "0");
  const STATUS: Record<string, string> = {
    complete: "Complete", "unconditional outstanding": "Unconditional outstanding", "conditional outstanding": "Conditional outstanding",
    "not needed": "Not needed", "awaiting next pay app": "Unconditional due with next pay app",
  };
  const byContract = new Map<number, WaiverLogRow[]>();
  for (const r of input.rows) byContract.set(r.contractId, [...(byContract.get(r.contractId) ?? []), r]);
  const body = Array.from(byContract).map(([cid, rows]) => `
    <tr class="grp"><td colspan="6">${escapeHtml(input.contractName(cid))}</td></tr>
    ${rows.map((r) => `<tr${r.status.includes("outstanding") ? ' style="background:#fef2f2"' : ""}>
      <td>Pay App ${nn(r.appNumber)}</td><td>${escapeHtml(r.vendor)}</td>${cell(r.conditionalAmount)}
      <td>${r.conditionalReceived ? "Received" : "—"}</td>
      <td>${r.unconditionalDueWith == null ? "—" : `${r.unconditionalReceived ? "Received" : "Due"} with Pay App ${nn(r.unconditionalDueWith)}${r.unconditionalAmount != null && Math.abs(r.unconditionalAmount - r.conditionalAmount) >= 0.005 ? ` (${money2(r.unconditionalAmount)})` : ""}${r.edited ? " — edited" : ""}`}</td>
      <td>${STATUS[r.status]}</td></tr>`).join("")}`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Lien Waiver Log</title><style>
    ${REPORT_SHELL_CSS}${TABLE_CSS}
  </style></head><body>
  ${reportHeaderHtml({ title: "Lien Waiver Log", eyebrow: "Cost Report", info, notes })}
  <table class="t"><thead><tr><th class="l">Pay App</th><th class="l">Vendor</th><th>Conditional</th><th class="l">Conditional</th><th class="l">Unconditional</th><th class="l">Status</th></tr></thead><tbody>
    ${body || `<tr><td colspan="6" class="muted">No waivers recorded yet.</td></tr>`}
  </tbody></table>
  <h3 class="sec">Notes</h3>
  <ol class="notes">
    <li>Each pay app's conditional waivers are answered by unconditional waivers delivered with the following pay app, for the same vendor and amount.</li>
    <li>"Edited" marks an unconditional whose vendor or amount was changed from the conditional it answers.</li>
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
        // Confirmations made before names were stored carry an email address;
        // when it is the reader's own, print the name.
        approval: (() => {
          const u: any = (req as any).user;
          const by = b.approval.confirmedBy;
          return by && by.includes('@') && u?.email && by.toLowerCase() === String(u.email).toLowerCase()
            ? { ...b.approval, confirmedBy: generatedByName(u) || by } : b.approval;
        })(),
        cmFee: b.cmFee,
        budgetCos: b.approval.changeOrders.map((c) => {
          const t = b.approval.changeOrderTotals.find((x) => x.id === c.id) ?? { work: 0, cm: 0, total: 0 };
          return { number: c.number, title: c.title, date: c.date, status: c.status, billable: c.billable, cmFee: c.cmFee, cmFeePct: c.cmFeePct, ...t };
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

  app.get("/api/reports/lien-waivers/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      const apps = b.applications.map((a) => ({ id: a.id, contractId: a.contractId, number: a.number }));
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderWaiverLogHtml({
        project: b.project, ...(await propertyFacts(b.project)),
        rows: waiverLog(apps, b.waivers),
        contractName: (cid) => b.contracts.find((c) => c.id === cid)?.counterparty ?? "Contract",
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("Lien waiver log error:", e);
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
        invoice = rec;
      } else {
        const d = b.cmInvoiceDraft;
        invoice = { number: null, date: todayEastern(), ...d,
          payApps: b.contracts.map((c) => {
            const apps = b.positionInput.applications.filter((a) => a.contractId === c.id);
            if (!apps.length) return null;
            const last = apps.reduce((m, a) => (a.number > m.number ? a : m), apps[0]);
            return { contract: c.counterparty, number: last.number, date: last.date, billedToDate: b.g702ByContract[c.id]?.completedAndStored ?? 0 };
          }).filter(Boolean) as CmInvoiceView["payApps"] };
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderCmInvoiceHtml({ project: b.project, ...(await propertyFacts(b.project)), invoice, generatedBy: generatedByName((req as any).user) }));
    } catch (e: any) {
      console.error("CM invoice report error:", e);
      res.status(500).json({ message: "Failed to generate the invoice", error: e?.message });
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
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderCostPositionHtml({
        project: b.project, ...(await propertyFacts(b.project)),
        position: positionAsOf(asOf, b.positionInput),
        contracts: b.contracts,
        // The fee is earned on what has been billed so far — today's figure.
        cmFee: asOf === todayEastern() ? b.cmFee : null,
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("Cost position report error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });
}
