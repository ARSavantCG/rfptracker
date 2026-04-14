import type { Express } from "express";
import { db } from "./db";
import { bidCollections, rfpRequests, scopeItemContractorPricing } from "@shared/schema";
import { eq, desc, or, ilike, sql } from "drizzle-orm";
import { requireAuth } from "./middleware";

export function registerProposalsRoutes(app: Express): void {

  // GET /api/proposals — all bid collections that have attachments, joined with RFP + contact info
  app.get("/api/proposals", requireAuth, async (req, res) => {
    try {
      const rows = await db
        .select({
          bidCollectionId: bidCollections.id,
          rfpId: bidCollections.rfpId,
          contractorId: bidCollections.contractorId,
          contractorName: bidCollections.contractorName,
          contractorCompany: bidCollections.contractorCompany,
          contractorEmail: bidCollections.contractorEmail,
          submissionDate: bidCollections.submissionDate,
          totalAmount: bidCollections.totalAmount,
          attachments: bidCollections.attachments,
          rfpNumber: rfpRequests.rfpNumber,
          projectName: rfpRequests.projectName,
          tenantName: rfpRequests.tenantName,
        })
        .from(bidCollections)
        .innerJoin(rfpRequests, eq(bidCollections.rfpId, rfpRequests.id))
        .where(sql`jsonb_array_length(${bidCollections.attachments}::jsonb) > 0`)
        .orderBy(desc(bidCollections.submissionDate));

      res.json(rows);
    } catch (error) {
      console.error("Failed to fetch proposals:", error);
      res.status(500).json({ message: "Failed to fetch proposals" });
    }
  });

  // GET /api/proposals/by-contractor/:contractorId
  app.get("/api/proposals/by-contractor/:contractorId", requireAuth, async (req, res) => {
    try {
      const contractorId = parseInt(req.params.contractorId);
      if (isNaN(contractorId)) return res.status(400).json({ message: "Invalid contractor ID" });

      const rows = await db
        .select({
          bidCollectionId: bidCollections.id,
          rfpId: bidCollections.rfpId,
          contractorId: bidCollections.contractorId,
          contractorName: bidCollections.contractorName,
          contractorCompany: bidCollections.contractorCompany,
          contractorEmail: bidCollections.contractorEmail,
          submissionDate: bidCollections.submissionDate,
          totalAmount: bidCollections.totalAmount,
          attachments: bidCollections.attachments,
          rfpNumber: rfpRequests.rfpNumber,
          projectName: rfpRequests.projectName,
          tenantName: rfpRequests.tenantName,
        })
        .from(bidCollections)
        .innerJoin(rfpRequests, eq(bidCollections.rfpId, rfpRequests.id))
        .where(
          sql`${bidCollections.contractorId} = ${contractorId} AND jsonb_array_length(${bidCollections.attachments}::jsonb) > 0`
        )
        .orderBy(desc(bidCollections.submissionDate));

      res.json(rows);
    } catch (error) {
      console.error("Failed to fetch proposals by contractor:", error);
      res.status(500).json({ message: "Failed to fetch proposals by contractor" });
    }
  });

  // GET /api/proposals/search?q=
  app.get("/api/proposals/search", requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) {
        return res.redirect("/api/proposals");
      }
      const pattern = `%${q}%`;

      const rows = await db
        .select({
          bidCollectionId: bidCollections.id,
          rfpId: bidCollections.rfpId,
          contractorId: bidCollections.contractorId,
          contractorName: bidCollections.contractorName,
          contractorCompany: bidCollections.contractorCompany,
          contractorEmail: bidCollections.contractorEmail,
          submissionDate: bidCollections.submissionDate,
          totalAmount: bidCollections.totalAmount,
          attachments: bidCollections.attachments,
          rfpNumber: rfpRequests.rfpNumber,
          projectName: rfpRequests.projectName,
          tenantName: rfpRequests.tenantName,
        })
        .from(bidCollections)
        .innerJoin(rfpRequests, eq(bidCollections.rfpId, rfpRequests.id))
        .where(
          sql`jsonb_array_length(${bidCollections.attachments}::jsonb) > 0 AND (
            ${bidCollections.contractorName} ILIKE ${pattern} OR
            ${bidCollections.contractorCompany} ILIKE ${pattern} OR
            ${rfpRequests.projectName} ILIKE ${pattern} OR
            ${rfpRequests.tenantName} ILIKE ${pattern}
          )`
        )
        .orderBy(desc(bidCollections.submissionDate));

      res.json(rows);
    } catch (error) {
      console.error("Failed to search proposals:", error);
      res.status(500).json({ message: "Failed to search proposals" });
    }
  });

  // POST /api/proposals/:bidCollectionId/tag-line-items
  // Body: { tags: [{ description, totalPrice, unitPrice, quantity, unit, scopeItemId, contractorName, quarter, notes }] }
  app.post("/api/proposals/:bidCollectionId/tag-line-items", requireAuth, async (req, res) => {
    try {
      const bidCollectionId = parseInt(req.params.bidCollectionId);
      if (isNaN(bidCollectionId)) return res.status(400).json({ message: "Invalid bid collection ID" });

      const { tags } = req.body;
      if (!Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ message: "tags array is required and must not be empty" });
      }

      let savedCount = 0;
      const errors: string[] = [];

      for (const tag of tags) {
        const { scopeItemId, contractorName, price, unit, quarter, notes, totalPrice, unitPrice } = tag;

        if (!scopeItemId || !contractorName || !quarter) {
          errors.push(`Skipped tag missing required fields: scopeItemId=${scopeItemId}, contractorName=${contractorName}, quarter=${quarter}`);
          continue;
        }

        const priceValue = price ?? unitPrice ?? totalPrice;
        if (!priceValue || !unit) {
          errors.push(`Skipped tag for scopeItem ${scopeItemId}: missing price or unit`);
          continue;
        }

        try {
          await db.insert(scopeItemContractorPricing).values({
            scopeItemId: parseInt(String(scopeItemId)),
            contractorId: null,
            contractorName: String(contractorName),
            price: String(priceValue),
            unit: String(unit),
            quotedDate: new Date(),
            quarter: String(quarter),
            notes: notes ? String(notes) : null,
            isActive: true,
          });
          savedCount++;
        } catch (insertError) {
          errors.push(`Failed to save tag for scopeItem ${scopeItemId}: ${insertError}`);
        }
      }

      res.json({ saved: savedCount, errors });
    } catch (error) {
      console.error("Failed to tag line items:", error);
      res.status(500).json({ message: "Failed to tag line items" });
    }
  });
}
