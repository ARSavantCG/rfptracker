/**
 * RFP Tracker — Four-Bucket Budget Report
 * Copyright (c) 2026 Savant Consulting Group LLC. All rights reserved.
 *
 * Groups a project's full budget by CONTRACT COUNTERPARTY (Adolfo 2026-07-19):
 *   1. Contractor — construction costs (the GC's contract)
 *   2. Design     — the designer's contract
 *   3. CM Fees    — construction management
 *   4. Balance    — contingency, permits, testing, everything else
 *
 * Works for BOTH paths: bid-based evaluations (evaluation_budgets line items)
 * and ROM-path RFPs (linked rom_pilot line items). Bucket resolution:
 * explicit catalog contractBucket wins; otherwise inference in this order —
 * contingency/permit/testing/inspection -> balance; construction management ->
 * cm; design/architect/engineer -> design; everything else -> contractor.
 * Existing improvements (costs-in-place) are informational, not a contract:
 * shown as a separate line, never bucketed.
 */
import type { Express } from "express";
import { storage } from "./storage";
import { requireAuth } from "./middleware";
import { getBrandLogo as getBridgeLogo, BRAND_COLOR_PRIMARY, COMPANY_NAME } from './lib/branding';

type Bucket = "contractor" | "design" | "cm" | "balance";
const BUCKETS: Bucket[] = ["contractor", "design", "cm", "balance"];
const BUCKET_LABELS: Record<Bucket, string> = {
  contractor: "Contractor (Construction)",
  design: "Design",
  cm: "CM Fees",
  balance: "Balance / Miscellaneous",
};

function resolveContractBucket(itemName: string, cat: any): Bucket {
  const explicit = (cat?.contractBucket || "").toLowerCase();
  if ((BUCKETS as string[]).includes(explicit)) return explicit as Bucket;
  const name = `${cat?.name || ""} ${itemName || ""}`.toLowerCase();
  if (/contingency|permit|testing|inspection|bond/.test(name)) return "balance";
  if (/construction management|cm fee|\bcm\b/.test(name)) return "cm";
  if (/design|architect|engineer/.test(name)) return "design";
  const category = (cat?.category || "").toLowerCase();
  if (category.includes("soft") || category.includes("design")) return "balance";
  return "contractor";
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function registerFourBucketBudgetReportRoutes(app: Express): void {
  app.get("/api/reports/budget-buckets/:rfpId", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) return res.status(400).json({ message: "Invalid RFP ID" });
      const rfp: any = await storage.getRfpRequest(rfpId);
      if (!rfp) return res.status(404).json({ message: "RFP not found" });

      const catalog = await storage.getAllRomScopeItems();
      const byId = new Map(catalog.map((c: any) => [c.id, c]));

      // Collect line items from whichever path this RFP took.
      type Row = { description: string; total: number; source: string };
      const rows: { bucket: Bucket; row: Row }[] = [];
      let existingImprovementsTotal: number | null = null;
      let sourceLabel = "";

      if (rfp.pricingPath === "rom_pilot") {
        const pilots = await storage.getAllRomPilots();
        const pilot: any = pilots.find((r: any) => r.linkedRfpId === rfpId);
        if (!pilot) return res.status(404).json({ message: "No ROM Pilot linked to this ROM-path RFP" });
        sourceLabel = `ROM Pilot ${pilot.romNumber}`;
        var romPilotMeta: any = pilot; // for allowance summary + fee governance flag
        const items = await storage.getRomPilotLineItems(pilot.id);
        for (const it of items as any[]) {
          const cat = byId.get(it.scopeItemId);
          rows.push({
            bucket: resolveContractBucket(cat?.name || "", cat),
            row: { description: cat?.name || `Item #${it.scopeItemId}`, total: parseFloat(it.totalPrice) || 0, source: "ROM" },
          });
        }
      } else {
        const budget: any = await storage.getEvaluationBudget(rfpId);
        if (!budget) return res.status(404).json({ message: "No evaluation budget exists for this RFP yet" });
        sourceLabel = "Evaluation Budget";
        const push = (items: any[], src: string) => {
          for (const it of items || []) {
            const cat = it.masterItemId != null ? byId.get(it.masterItemId) : undefined;
            rows.push({
              bucket: resolveContractBucket(it.description, cat),
              row: { description: it.description, total: parseFloat(it.totalPrice) || 0, source: src },
            });
          }
        };
        push(budget.tenantImprovements, "TI");
        push(budget.designSoftCosts, "Design/Soft");
        if (budget.hasExistingImprovements) {
          existingImprovementsTotal = (budget.existingImprovements || [])
            .reduce((s: number, it: any) => s + (parseFloat(it.totalPrice) || 0), 0);
        }
      }

      const buckets = BUCKETS.map((b) => {
        const items = rows.filter((r) => r.bucket === b).map((r) => r.row);
        return { key: b, label: BUCKET_LABELS[b], total: items.reduce((s, r) => s + r.total, 0), items };
      });
      const grandTotal = buckets.reduce((s, b) => s + b.total, 0);

      const isRom = rfp.pricingPath === "rom_pilot";
      const bucketRowsHtml = buckets
        .map(
          (b) => `
        <tr class="bucket"><td>${b.label}</td><td class="num">${money(b.total)}</td>
          <td class="num">${grandTotal ? ((b.total / grandTotal) * 100).toFixed(1) : "0.0"}%</td></tr>
        ${b.items
          .map((it) => `<tr class="item"><td class="indent">${it.description}</td><td class="num">${money(it.total)}</td><td></td></tr>`)
          .join("")}`
        )
        .join("");

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Budget by Contract — ${rfp.rfpNumber}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 40px; color: #111827; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .badge { display:inline-block; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:700;
    letter-spacing:.05em; text-transform:uppercase;
    ${isRom ? "background:#f3e8ff;color:#7e22ce;border:2px solid #d8b4fe;" : "background:#dbeafe;color:#1d4ed8;"} }
  .meta { color:#6b7280; font-size:13px; margin:8px 0 24px; }
  table { border-collapse: collapse; width: 100%; max-width: 760px; }
  td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
  tr.bucket td { font-weight: 700; background: #f9fafb; border-top: 2px solid #d1d5db; }
  td.indent { padding-left: 32px; color: #4b5563; }
  td.num { text-align: right; white-space: nowrap; }
  tr.grand td { font-weight: 800; font-size: 16px; border-top: 3px double #111827; }
  tr.info td { color: #6b7280; font-style: italic; }
  .header { border-bottom: 3px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 10px; margin-bottom: 14px; }
  .document-title { font-size: 22px; font-weight: bold; background: ${BRAND_COLOR_PRIMARY}; color: #fff; padding: 10px; border-radius: 5px; text-align: center; }
</style></head><body>
  <div class="header">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
      <img src="${getBridgeLogo()}" alt="${COMPANY_NAME}" style="height: 30px; width: auto;" />
      <div style="font-size: 12px; color: #999;">Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
    <div class="document-title">Budget by Contract Counterparty</div>
  </div>
  <span class="badge">${isRom ? "ROM PILOT — ALLOWANCE / SELF-SERVE" : "BID-BASED EVALUATION"}</span>
  <div class="meta">${rfp.rfpNumber} — ${rfp.projectName || ""} · ${rfp.property || ""} · Source: ${sourceLabel}
    · Generated ${new Date().toLocaleDateString("en-US")}</div>
  <table>
    <tr><td style="font-weight:700">Bucket / Line Item</td><td class="num" style="font-weight:700">Amount</td><td class="num" style="font-weight:700">% of Total</td></tr>
    ${bucketRowsHtml}
    <tr class="grand"><td>Total</td><td class="num">${money(grandTotal)}</td><td class="num">100%</td></tr>
    ${
      isRom
        ? (() => {
            const cm = buckets.find((x) => x.key === "cm")?.total || 0;
            const removed = (typeof romPilotMeta !== "undefined" && romPilotMeta?.cmFeeRemovedBy)
              ? `<tr class="info"><td colspan="3" style="color:#b45309">⚠ CM fee line was removed by ${romPilotMeta.cmFeeRemovedBy}${romPilotMeta.cmFeeRemovedAt ? " on " + new Date(romPilotMeta.cmFeeRemovedAt).toLocaleDateString("en-US") : ""} — confirm the lease language mirrors this.</td></tr>`
              : "";
            // Inside-the-allowance math (Adolfo): the quoted allowance INCLUDES
            // the CM fee — tenant's real TI purchasing power is gross less CM.
            return `
    <tr class="info"><td colspan="3" style="padding-top:18px;border-bottom:none;font-style:normal;font-weight:700;color:#111827">Allowance Summary</td></tr>
    <tr><td>Gross allowance (total, CM fee included)</td><td class="num">${money(grandTotal)}</td><td></td></tr>
    <tr><td>Less: CM fee</td><td class="num">(${money(cm)})</td><td></td></tr>
    <tr class="grand"><td>Net available for tenant improvements</td><td class="num">${money(grandTotal - cm)}</td><td></td></tr>
    ${removed}`;
          })()
        : ""
    }
    ${
      existingImprovementsTotal != null
        ? `<tr class="info"><td>Existing improvements (costs-in-place — informational, not a contract)</td>
           <td class="num">${money(existingImprovementsTotal)}</td><td></td></tr>`
        : ""
    }
  </table>
</body></html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error: any) {
      console.error("Four-bucket report error:", error);
      res.status(500).json({ message: "Failed to generate budget bucket report", error: error?.message });
    }
  });
}
