import { Express, Request, Response } from "express";
import multer from "multer";
import { db } from "./db";
import { requireAuth, checkPermission } from "./middleware";
import { projectActuals, projectActualLineItems, rfpRequests } from "@shared/schema";
import { eq, desc, and, isNotNull, sql } from "drizzle-orm";

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function dollarsToCents(d: number | string | null | undefined): number {
  if (d == null || d === "") return 0;
  const n = typeof d === "string" ? parseFloat(d.replace(/,/g, "")) : d;
  return Math.round((isNaN(n) ? 0 : n) * 100);
}

function centsToDollars(c: number | null | undefined): string {
  if (c == null) return "0.00";
  return (c / 100).toFixed(2);
}

function computeCostPerSf(costCents: number, areaSf: number | null | undefined): string | null {
  if (!areaSf || areaSf === 0) return null;
  return (costCents / 100 / areaSf).toFixed(2);
}

export function registerActualsRoutes(app: Express): void {

  // GET /api/project-actuals — all actuals with line items
  app.get("/api/project-actuals", requireAuth, async (req: Request, res: Response) => {
    try {
      const actuals = await db
        .select()
        .from(projectActuals)
        .orderBy(desc(projectActuals.completedDate));

      const ids = actuals.map((a) => a.id);
      let lineItems: any[] = [];
      if (ids.length > 0) {
        lineItems = await db
          .select()
          .from(projectActualLineItems)
          .where(sql`${projectActualLineItems.projectActualId} = ANY(ARRAY[${sql.raw(ids.join(","))}]::int[])`);
      }

      const result = actuals.map((a) => ({
        ...a,
        lineItems: lineItems.filter((li) => li.projectActualId === a.id),
      }));

      res.json(result);
    } catch (error) {
      console.error("Error fetching project actuals:", error);
      res.status(500).json({ message: "Failed to fetch project actuals" });
    }
  });

  // GET /api/project-actuals/benchmarks — intelligence endpoint (must be before /:id)
  app.get("/api/project-actuals/benchmarks", requireAuth, async (req: Request, res: Response) => {
    try {
      const items = await db
        .select({
          category: projectActualLineItems.category,
          areaType: projectActualLineItems.areaType,
          totalCost: projectActualLineItems.totalCost,
          areaSf: projectActualLineItems.areaSf,
          costPerSf: projectActualLineItems.costPerSf,
          completedDate: projectActuals.completedDate,
          totalAreaSf: projectActuals.totalAreaSf,
          officeAreaSf: projectActuals.officeAreaSf,
          warehouseAreaSf: projectActuals.warehouseAreaSf,
        })
        .from(projectActualLineItems)
        .innerJoin(projectActuals, eq(projectActualLineItems.projectActualId, projectActuals.id));

      // Group by category + areaType
      const groups: Record<string, { cpsfValues: number[]; dates: Date[]; count: Set<string> }> = {};

      for (const item of items) {
        const key = `${item.category}|||${item.areaType || "combined"}`;
        if (!groups[key]) groups[key] = { cpsfValues: [], dates: [], count: new Set() };

        // Determine the SF to use for cost/SF
        let sf = item.areaSf;
        if (!sf || sf === 0) {
          const areaType = item.areaType || "combined";
          if (areaType === "office") sf = item.officeAreaSf;
          else if (areaType === "warehouse") sf = item.warehouseAreaSf;
          else sf = item.totalAreaSf;
        }

        if (sf && sf > 0 && item.totalCost > 0) {
          const cpsf = item.totalCost / 100 / sf;
          groups[key].cpsfValues.push(cpsf);
          groups[key].dates.push(new Date(item.completedDate));
        }
      }

      const benchmarks = Object.entries(groups)
        .map(([key, data]) => {
          const [category, areaType] = key.split("|||");
          const values = data.cpsfValues;
          if (values.length === 0) return null;
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          const minVal = Math.min(...values);
          const maxVal = Math.max(...values);
          const spread = avg > 0 ? ((maxVal - minVal) / avg) * 100 : 0;
          const latestDate = new Date(Math.max(...data.dates.map((d) => d.getTime())));
          return {
            category,
            areaType,
            projectsSampled: values.length,
            avgCostPerSf: avg.toFixed(2),
            minCostPerSf: minVal.toFixed(2),
            maxCostPerSf: maxVal.toFixed(2),
            spreadPercent: spread.toFixed(1),
            lastProjectDate: latestDate,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.category.localeCompare(b.category));

      res.json(benchmarks);
    } catch (error) {
      console.error("Error fetching benchmarks:", error);
      res.status(500).json({ message: "Failed to fetch benchmarks" });
    }
  });

  // GET /api/rfp-requests/:rfpId/actuals — getOrCreate for leased RFPs
  app.get("/api/rfp-requests/:rfpId/actuals", requireAuth, async (req: Request, res: Response) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) return res.status(400).json({ message: "Invalid RFP ID" });

      // Return existing if found (never duplicate)
      const [existing] = await db
        .select()
        .from(projectActuals)
        .where(eq(projectActuals.rfpId, rfpId));

      if (existing) {
        const lineItems = await db
          .select()
          .from(projectActualLineItems)
          .where(eq(projectActualLineItems.projectActualId, existing.id));
        return res.json({ ...existing, lineItems });
      }

      // Auto-create from RFP fields
      const [rfp] = await db.select().from(rfpRequests).where(eq(rfpRequests.id, rfpId));
      if (!rfp) return res.status(404).json({ message: "RFP not found" });

      const [created] = await db
        .insert(projectActuals)
        .values({
          rfpId,
          projectName: rfp.projectName || rfp.rfpNumber,
          tenantName: rfp.tenantName,
          propertyName: rfp.property || "",
          completedDate: null,
          totalActualCost: null,
          source: "leased_actuals",
        })
        .returning();

      return res.json({ ...created, lineItems: [] });
    } catch (error) {
      console.error("Error in getOrCreate project actual:", error);
      res.status(500).json({ message: "Failed to get or create project actual" });
    }
  });

  // GET /api/project-actuals/:id
  app.get("/api/project-actuals/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const [actual] = await db.select().from(projectActuals).where(eq(projectActuals.id, id));
      if (!actual) return res.status(404).json({ message: "Not found" });

      const lineItems = await db
        .select()
        .from(projectActualLineItems)
        .where(eq(projectActualLineItems.projectActualId, id));

      res.json({ ...actual, lineItems });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project actual" });
    }
  });

  // POST /api/project-actuals
  app.post("/api/project-actuals", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const officeAreaSf = parseInt(body.officeAreaSf) || 0;
      const warehouseAreaSf = parseInt(body.warehouseAreaSf) || 0;
      const totalAreaSf = officeAreaSf + warehouseAreaSf;
      const totalActualCost = dollarsToCents(body.totalActualCost);
      const costPerSf = computeCostPerSf(totalActualCost, totalAreaSf);

      const [created] = await db
        .insert(projectActuals)
        .values({
          rfpId: body.rfpId ? parseInt(body.rfpId) : null,
          projectName: body.projectName,
          tenantName: body.tenantName,
          propertyName: body.propertyName,
          completedDate: new Date(body.completedDate),
          officeAreaSf,
          warehouseAreaSf,
          totalAreaSf,
          totalActualCost,
          costPerSf,
          source: body.source || "historical_import",
          notes: body.notes || null,
        })
        .returning();

      // Optionally insert line items
      if (body.lineItems && Array.isArray(body.lineItems) && body.lineItems.length > 0) {
        const liValues = body.lineItems.map((li: any) => {
          const liCost = dollarsToCents(li.totalCost);
          const liSf = li.areaSf ? parseInt(li.areaSf) : null;
          return {
            projectActualId: created.id,
            category: li.category,
            description: li.description || null,
            totalCost: liCost,
            areaType: li.areaType || "combined",
            areaSf: liSf,
            costPerSf: computeCostPerSf(liCost, liSf),
            notes: li.notes || null,
          };
        });
        await db.insert(projectActualLineItems).values(liValues);
      }

      const lineItems = await db
        .select()
        .from(projectActualLineItems)
        .where(eq(projectActualLineItems.projectActualId, created.id));

      res.json({ ...created, lineItems });
    } catch (error) {
      console.error("Error creating project actual:", error);
      res.status(500).json({ message: "Failed to create project actual" });
    }
  });

  // PATCH /api/project-actuals/:id
  app.patch("/api/project-actuals/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const body = req.body;
      const officeAreaSf = body.officeAreaSf != null ? parseInt(body.officeAreaSf) : undefined;
      const warehouseAreaSf = body.warehouseAreaSf != null ? parseInt(body.warehouseAreaSf) : undefined;

      const [existing] = await db.select().from(projectActuals).where(eq(projectActuals.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });

      const newOffice = officeAreaSf ?? existing.officeAreaSf ?? 0;
      const newWarehouse = warehouseAreaSf ?? existing.warehouseAreaSf ?? 0;
      const totalAreaSf = newOffice + newWarehouse;
      const totalActualCost = body.totalActualCost != null ? dollarsToCents(body.totalActualCost) : existing.totalActualCost;
      const costPerSf = computeCostPerSf(totalActualCost, totalAreaSf);

      const updateData: any = {
        updatedAt: new Date(),
        officeAreaSf: newOffice,
        warehouseAreaSf: newWarehouse,
        totalAreaSf,
        totalActualCost,
        costPerSf,
      };
      if (body.projectName !== undefined) updateData.projectName = body.projectName;
      if (body.tenantName !== undefined) updateData.tenantName = body.tenantName;
      if (body.propertyName !== undefined) updateData.propertyName = body.propertyName;
      if (body.completedDate !== undefined) updateData.completedDate = new Date(body.completedDate);
      if (body.source !== undefined) updateData.source = body.source;
      if (body.notes !== undefined) updateData.notes = body.notes;

      const [updated] = await db.update(projectActuals).set(updateData).where(eq(projectActuals.id, id)).returning();
      const lineItems = await db.select().from(projectActualLineItems).where(eq(projectActualLineItems.projectActualId, id));

      res.json({ ...updated, lineItems });
    } catch (error) {
      res.status(500).json({ message: "Failed to update project actual" });
    }
  });

  // DELETE /api/project-actuals/:id
  app.delete("/api/project-actuals/:id", requireAuth, checkPermission("admin.access"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(projectActualLineItems).where(eq(projectActualLineItems.projectActualId, id));
      await db.delete(projectActuals).where(eq(projectActuals.id, id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete project actual" });
    }
  });

  // POST /api/project-actuals/:id/line-items
  app.post("/api/project-actuals/:id/line-items", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectActualId = parseInt(req.params.id);
      const body = req.body;
      const liCost = dollarsToCents(body.totalCost);
      const liSf = body.areaSf ? parseInt(body.areaSf) : null;
      const [created] = await db
        .insert(projectActualLineItems)
        .values({
          projectActualId,
          category: body.category,
          description: body.description || null,
          totalCost: liCost,
          areaType: body.areaType || "combined",
          areaSf: liSf,
          costPerSf: computeCostPerSf(liCost, liSf),
          vendorName: body.vendorName || null,
          linkedMasterItemIds: body.linkedMasterItemIds || [],
          notes: body.notes || null,
        })
        .returning();
      res.json(created);
    } catch (error) {
      res.status(500).json({ message: "Failed to add line item" });
    }
  });

  // PATCH /api/project-actuals/:id/line-items/:lineItemId
  app.patch("/api/project-actuals/:id/line-items/:lineItemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const lineItemId = parseInt(req.params.lineItemId);
      const body = req.body;
      const liCost = body.totalCost != null ? dollarsToCents(body.totalCost) : undefined;
      const liSf = body.areaSf ? parseInt(body.areaSf) : undefined;

      const updateData: any = {};
      if (body.category !== undefined) updateData.category = body.category;
      if (body.description !== undefined) updateData.description = body.description;
      if (liCost !== undefined) updateData.totalCost = liCost;
      if (body.areaType !== undefined) updateData.areaType = body.areaType;
      if (liSf !== undefined) updateData.areaSf = liSf;
      if (body.vendorName !== undefined) updateData.vendorName = body.vendorName;
      if (body.linkedMasterItemIds !== undefined) updateData.linkedMasterItemIds = body.linkedMasterItemIds;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (liCost !== undefined || liSf !== undefined) {
        const [existing] = await db.select().from(projectActualLineItems).where(eq(projectActualLineItems.id, lineItemId));
        const finalCost = liCost ?? (existing?.totalCost || 0);
        const finalSf = liSf ?? existing?.areaSf;
        updateData.costPerSf = computeCostPerSf(finalCost, finalSf);
      }

      const [updated] = await db.update(projectActualLineItems).set(updateData).where(eq(projectActualLineItems.id, lineItemId)).returning();
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update line item" });
    }
  });

  // DELETE /api/project-actuals/:id/line-items/:lineItemId
  app.delete("/api/project-actuals/:id/line-items/:lineItemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const lineItemId = parseInt(req.params.lineItemId);
      await db.delete(projectActualLineItems).where(eq(projectActualLineItems.id, lineItemId));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete line item" });
    }
  });

  // POST /api/project-actuals/import-csv
  app.post("/api/project-actuals/import-csv", requireAuth, csvUpload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const csv = req.file.buffer.toString("utf-8");
      const lines = csv.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return res.status(400).json({ message: "CSV must have at least a header and one data row" });

      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
      const created: any[] = [];
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        if (row.length < 4) continue;
        const get = (col: string) => row[headers.indexOf(col)] || "";

        try {
          const officeAreaSf = parseInt(get("office_sf")) || 0;
          const warehouseAreaSf = parseInt(get("warehouse_sf")) || 0;
          const totalAreaSf = officeAreaSf + warehouseAreaSf;
          const totalActualCost = dollarsToCents(get("total_cost"));
          const costPerSf = computeCostPerSf(totalActualCost, totalAreaSf);

          const [actual] = await db
            .insert(projectActuals)
            .values({
              projectName: get("project_name") || `Project ${i}`,
              tenantName: get("tenant_name") || "Unknown",
              propertyName: get("property_name") || "Unknown",
              completedDate: new Date(get("completed_date") || new Date().toISOString()),
              officeAreaSf,
              warehouseAreaSf,
              totalAreaSf,
              totalActualCost,
              costPerSf,
              source: "historical_import",
              notes: get("notes") || null,
            })
            .returning();

          // Parse up to 10 category columns
          const liValues: any[] = [];
          for (let c = 1; c <= 10; c++) {
            const catName = get(`category_${c}_name`);
            const catCost = get(`category_${c}_cost`);
            if (catName && catCost) {
              const liCost = dollarsToCents(catCost);
              liValues.push({
                projectActualId: actual.id,
                category: catName,
                totalCost: liCost,
                areaType: "combined",
                costPerSf: computeCostPerSf(liCost, totalAreaSf),
              });
            }
          }
          if (liValues.length > 0) {
            await db.insert(projectActualLineItems).values(liValues);
          }

          created.push(actual);
        } catch (rowErr: any) {
          errors.push(`Row ${i}: ${rowErr.message}`);
        }
      }

      res.json({ created: created.length, errors });
    } catch (error: any) {
      res.status(500).json({ message: "CSV import failed", error: error.message });
    }
  });
}
