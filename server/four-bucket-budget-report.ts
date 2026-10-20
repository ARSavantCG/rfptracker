/**
 * RFP Tracker — Budget by Contract Counterparty (route)
 * Copyright (c) 2026 Savant Consulting Group LLC. All rights reserved.
 *
 * Groups a project's budget by CONTRACT COUNTERPARTY (Adolfo 2026-07-19):
 * contractor, design, CM fees, and miscellaneous. Works for both bid-based
 * evaluations and ROM-path RFPs.
 *
 * The model and the page live in ./budget-by-contract, which has no database
 * import and is tested on its own. This file only fetches.
 */
import type { Express } from "express";
import { storage } from "./storage";
import { requireAuth } from "./middleware";
import { buildFromEvaluation, buildFromRom, renderBudgetByContractHtml } from "./budget-by-contract";
import { generatedByName } from "./lib/report-shell";

export function registerFourBucketBudgetReportRoutes(app: Express): void {
  app.get("/api/reports/budget-buckets/:rfpId", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) return res.status(400).json({ message: "Invalid RFP ID" });
      const rfp: any = await storage.getRfpRequest(rfpId);
      if (!rfp) return res.status(404).json({ message: "RFP not found" });

      const catalog = await storage.getAllRomScopeItems();
      const byId = new Map<number, any>(catalog.map((c: any) => [c.id, c]));

      // rfp.property holds the property ID as text.
      const propertyId = parseInt(String(rfp.property ?? ''), 10);
      const property = Number.isFinite(propertyId)
        ? await storage.getProperty(propertyId).catch(() => undefined)
        : undefined;

      let model;
      if (rfp.pricingPath === "rom_pilot") {
        const pilots = await storage.getAllRomPilots();
        const pilot: any = pilots.find((r: any) => r.linkedRfpId === rfpId);
        if (!pilot) return res.status(404).json({ message: "No ROM Pilot linked to this ROM-path RFP" });
        const items = await storage.getRomPilotLineItems(pilot.id);
        model = buildFromRom(pilot, items as any[], byId);
      } else {
        const budget: any = await storage.getEvaluationBudget(rfpId);
        if (!budget) return res.status(404).json({ message: "No evaluation budget exists for this RFP yet" });
        model = buildFromEvaluation(budget, byId);
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderBudgetByContractHtml({
        model,
        rfp,
        property: property ?? null,
        generatedBy: generatedByName((req as any).user),
      }));
    } catch (error: any) {
      console.error("Budget by contract report error:", error);
      res.status(500).json({ message: "Failed to generate the budget by contract report", error: error?.message });
    }
  });
}
