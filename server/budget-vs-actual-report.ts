/**
 * Budget vs Actual — printable. Pure renderer plus a thin route.
 * Same shell as every other report. Columns: Description, Budget, Committed
 * (contract + approved COs), Pending COs, Billed to date, Variance, and the
 * tenant/outstanding split of committed cost.
 */
import type { Express } from "express";
import { requireAuth, requireAdmin } from "./middleware";
import { storage } from "./storage";
import { loadProjectBundle } from "./cost-tracking-routes";
import {
  REPORT_SHELL_CSS, reportHeaderHtml, reportFooterHtml, escapeHtml, money2, generatedByName, rfpPropertyLabel, rfpRentableSf,
} from "./lib/report-shell";
import { UNALLOCATED_KEY, type BudgetVsActual } from "@shared/cost-tracking";

const BUCKETS: Array<[string, string]> = [
  ["contractor", "Contractor"], ["design", "Design"], ["cm", "Construction Management"], ["misc", "Miscellaneous"],
];

export function renderBudgetVsActualHtml(input: {
  project: { name: string; projectNumber: string; tenantName?: string | null };
  propertyLabel?: string;
  rentableSf?: number;
  summary: BudgetVsActual;
  generatedBy?: string | null;
}): string {
  const { summary: s, project } = input;
  const info = [
    { label: "Tenant", value: project.tenantName || "" },
    { label: "Property", value: input.propertyLabel || "" },
    { label: "Rentable Area", value: input.rentableSf ? `${Math.round(input.rentableSf).toLocaleString("en-US")} SF` : "" },
  ];
  const notes = s.reconciles ? [] : ["Lines do not add back to the contracts. Check Unallocated lines on the project page."];
  const fmt = (n: number) => (n < -0.005 ? `(${money2(-n)})` : money2(n));
  const cell = (n: number, cls = "") => `<td class="num ${cls}">${fmt(n)}</td>`;
  const varCls = (n: number) => (n < -0.005 ? "neg" : "");

  const group = (key: string, label: string) => {
    const rows = s.rows.filter((r) => (key === "misc" ? r.bucket === "misc" || !BUCKETS.some(([k]) => k === r.bucket) : r.bucket === key));
    if (!rows.length) return "";
    const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
    return `<tr class="grp"><td colspan="8">${escapeHtml(label)}</td></tr>` + rows.map((r) => `
      <tr${r.key === UNALLOCATED_KEY ? ' class="unalloc"' : ""}>
        <td>${escapeHtml(r.description)}</td>${cell(r.budget)}${cell(r.committed)}${cell(r.pending)}${cell(r.toDate)}
        ${cell(r.variance, varCls(r.variance))}${cell(r.committedTenant)}${cell(r.committedOutstanding)}
      </tr>`).join("") + `
      <tr class="sub"><td>${escapeHtml(label)} subtotal</td>${cell(sum((r) => r.budget))}${cell(sum((r) => r.committed))}${cell(sum((r) => r.pending))}
        ${cell(sum((r) => r.toDate))}${cell(sum((r) => r.variance))}${cell(sum((r) => r.committedTenant))}${cell(sum((r) => r.committedOutstanding))}</tr>`;
  };

  const t = s.totals;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Budget vs Actual</title><style>
    ${REPORT_SHELL_CSS}
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 0.5in; }
    table.bva { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    .bva th { text-align: right; background: #f3f4f6; padding: 5px 6px; border-bottom: 2px solid #374151; font-size: 10px; }
    .bva th:first-child { text-align: left; }
    .bva td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
    .bva td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .bva td.neg { color: #b91c1c; font-weight: 700; }
    .bva tr.grp td { background: #e5e7eb; font-weight: 700; text-transform: uppercase; font-size: 9.5px; letter-spacing: .06em; }
    .bva tr.sub td { font-weight: 700; border-top: 1px solid #6b7280; }
    .bva tr.unalloc td { background: #fef3c7; }
    .bva tr.total td { font-weight: 700; border-top: 2px solid #111827; border-bottom: 2px solid #111827; background: #f9fafb; }
    .bva tr { page-break-inside: avoid; }
    .legend { margin-top: 8px; font-size: 10px; color: #6b7280; }
  </style></head><body>
  ${reportHeaderHtml({ title: "Budget vs Actual", eyebrow: "Cost Report", info, notes })}
  <table class="bva"><thead><tr>
    <th>Description</th><th>Budget</th><th>Committed</th><th>Pending COs</th><th>Spent to Date</th>
    <th>Variance</th><th>Tenant Share</th><th>Outstanding Share</th></tr></thead><tbody>
    ${BUCKETS.map(([k, l]) => group(k, l)).join("")}
    <tr class="total"><td>Total</td>${cell(t.budget)}${cell(t.committed)}${cell(t.pending)}${cell(t.toDate)}
      ${cell(t.variance, varCls(t.variance))}${cell(t.committedTenant)}${cell(t.committedOutstanding)}</tr>
  </tbody></table>
  <div class="legend">Committed = contracts plus approved change orders. Variance = Budget less Committed (negative is over budget).
    Spent to Date is work completed and stored to date, before retainage. Retainage held: ${money2(t.retainageHeld)}.</div>
  ${reportFooterHtml({ generatedBy: input.generatedBy })}
  </body></html>`;
}

export function registerBudgetVsActualReportRoutes(app: Express): void {
  app.get("/api/reports/budget-vs-actual/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid ID" });
      const b = await loadProjectBundle(id);
      if (!b) return res.status(404).json({ message: "Project not found" });
      const property: any = b.project.propertyId
        ? await storage.getProperty(b.project.propertyId).catch(() => undefined) : undefined;
      const rfp: any = b.project.rfpId ? await storage.getRfpRequest(b.project.rfpId).catch(() => undefined) : undefined;
      const label = rfp ? rfpPropertyLabel(rfp, property) : (property?.name ?? "");
      const sf = rfp ? rfpRentableSf(rfp, property) : 0;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderBudgetVsActualHtml({
        project: b.project, propertyLabel: label, rentableSf: sf,
        summary: b.summary, generatedBy: generatedByName((req as any).user),
      }));
    } catch (e: any) {
      console.error("Budget vs actual report error:", e);
      res.status(500).json({ message: "Failed to generate the report", error: e?.message });
    }
  });
}
