import { rfpRequests, type RfpRequest, type InsertRfpRequest, type UpdateRfpRequest, type RfpFile } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  getRfpRequest(id: number): Promise<RfpRequest | undefined>;
  getAllRfpRequests(): Promise<RfpRequest[]>;
  createRfpRequest(request: InsertRfpRequest): Promise<RfpRequest>;
  updateRfpRequest(id: number, updates: Partial<UpdateRfpRequest>): Promise<RfpRequest | undefined>;
  deleteRfpRequest(id: number): Promise<boolean>;
  addFileToRfp(rfpId: number, file: RfpFile): Promise<RfpRequest | undefined>;
  removeFileFromRfp(rfpId: number, fileId: string): Promise<RfpRequest | undefined>;
  searchRfpRequests(query: string): Promise<RfpRequest[]>;
  filterRfpRequestsByStatus(status: string): Promise<RfpRequest[]>;
}

export class DatabaseStorage implements IStorage {
  private async generateRfpNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await db.$count(rfpRequests);
    const number = (count + 1).toString().padStart(3, '0');
    return `RFP-${year}-${number}`;
  }

  async getRfpRequest(id: number): Promise<RfpRequest | undefined> {
    const [rfp] = await db.select().from(rfpRequests).where(eq(rfpRequests.id, id));
    return rfp || undefined;
  }

  async getAllRfpRequests(): Promise<RfpRequest[]> {
    return await db.select().from(rfpRequests).orderBy(rfpRequests.createdAt);
  }

  async createRfpRequest(request: InsertRfpRequest): Promise<RfpRequest> {
    const rfpNumber = await this.generateRfpNumber();
    
    const [rfp] = await db
      .insert(rfpRequests)
      .values({
        ...request,
        rfpNumber,
        files: [],
      })
      .returning();
    
    return rfp;
  }

  async updateRfpRequest(id: number, updates: Partial<UpdateRfpRequest>): Promise<RfpRequest | undefined> {
    const [updated] = await db
      .update(rfpRequests)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(rfpRequests.id, id))
      .returning();
    
    return updated || undefined;
  }

  async deleteRfpRequest(id: number): Promise<boolean> {
    const result = await db.delete(rfpRequests).where(eq(rfpRequests.id, id));
    return result.rowCount > 0;
  }

  async addFileToRfp(rfpId: number, file: RfpFile): Promise<RfpRequest | undefined> {
    const existing = await this.getRfpRequest(rfpId);
    if (!existing) return undefined;

    const updatedFiles = [...existing.files, file];
    
    const [updated] = await db
      .update(rfpRequests)
      .set({
        files: updatedFiles,
        updatedAt: new Date(),
      })
      .where(eq(rfpRequests.id, rfpId))
      .returning();
    
    return updated || undefined;
  }

  async removeFileFromRfp(rfpId: number, fileId: string): Promise<RfpRequest | undefined> {
    const existing = await this.getRfpRequest(rfpId);
    if (!existing) return undefined;

    const updatedFiles = existing.files.filter(f => f.id !== fileId);
    
    const [updated] = await db
      .update(rfpRequests)
      .set({
        files: updatedFiles,
        updatedAt: new Date(),
      })
      .where(eq(rfpRequests.id, rfpId))
      .returning();
    
    return updated || undefined;
  }

  async searchRfpRequests(query: string): Promise<RfpRequest[]> {
    // For now, we'll get all and filter client-side
    // In production, you'd want to use proper SQL LIKE queries
    const allRfps = await this.getAllRfpRequests();
    const lowerQuery = query.toLowerCase();
    
    return allRfps.filter(rfp => 
      rfp.client.toLowerCase().includes(lowerQuery) ||
      rfp.project.toLowerCase().includes(lowerQuery) ||
      rfp.rfpNumber.toLowerCase().includes(lowerQuery) ||
      (rfp.contactPerson && rfp.contactPerson.toLowerCase().includes(lowerQuery))
    );
  }

  async filterRfpRequestsByStatus(status: string): Promise<RfpRequest[]> {
    return await db.select().from(rfpRequests).where(eq(rfpRequests.status, status));
  }
}

export const storage = new DatabaseStorage();
