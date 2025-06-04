import { rfpRequests, type RfpRequest, type InsertRfpRequest, type UpdateRfpRequest, type RfpFile } from "@shared/schema";

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

export class MemStorage implements IStorage {
  private rfpRequests: Map<number, RfpRequest>;
  private currentId: number;
  private rfpCounter: number;

  constructor() {
    this.rfpRequests = new Map();
    this.currentId = 1;
    this.rfpCounter = 1;
  }

  private generateRfpNumber(): string {
    const year = new Date().getFullYear();
    const number = this.rfpCounter.toString().padStart(3, '0');
    this.rfpCounter++;
    return `RFP-${year}-${number}`;
  }

  async getRfpRequest(id: number): Promise<RfpRequest | undefined> {
    return this.rfpRequests.get(id);
  }

  async getAllRfpRequests(): Promise<RfpRequest[]> {
    return Array.from(this.rfpRequests.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createRfpRequest(request: InsertRfpRequest): Promise<RfpRequest> {
    const id = this.currentId++;
    const now = new Date();
    const rfpRequest: RfpRequest = {
      id,
      rfpNumber: this.generateRfpNumber(),
      client: request.client,
      project: request.project,
      status: request.status,
      requestTypes: request.requestTypes,
      contactPerson: request.contactPerson || null,
      contactEmail: request.contactEmail || null,
      dateReceived: request.dateReceived,
      dueDate: request.dueDate || null,
      notes: request.notes || null,
      files: [],
      createdAt: now,
      updatedAt: now,
    };
    this.rfpRequests.set(id, rfpRequest);
    return rfpRequest;
  }

  async updateRfpRequest(id: number, updates: Partial<UpdateRfpRequest>): Promise<RfpRequest | undefined> {
    const existing = this.rfpRequests.get(id);
    if (!existing) return undefined;

    const updated: RfpRequest = {
      ...existing,
      ...updates,
      id: existing.id, // Ensure ID doesn't change
      rfpNumber: existing.rfpNumber, // Ensure RFP number doesn't change
      updatedAt: new Date(),
    };

    this.rfpRequests.set(id, updated);
    return updated;
  }

  async deleteRfpRequest(id: number): Promise<boolean> {
    return this.rfpRequests.delete(id);
  }

  async addFileToRfp(rfpId: number, file: RfpFile): Promise<RfpRequest | undefined> {
    const rfp = this.rfpRequests.get(rfpId);
    if (!rfp) return undefined;

    const updatedFiles = [...(rfp.files || []), file];
    const updated: RfpRequest = {
      ...rfp,
      files: updatedFiles,
      updatedAt: new Date(),
    };

    this.rfpRequests.set(rfpId, updated);
    return updated;
  }

  async removeFileFromRfp(rfpId: number, fileId: string): Promise<RfpRequest | undefined> {
    const rfp = this.rfpRequests.get(rfpId);
    if (!rfp) return undefined;

    const updatedFiles = (rfp.files || []).filter(f => f.id !== fileId);
    const updated: RfpRequest = {
      ...rfp,
      files: updatedFiles,
      updatedAt: new Date(),
    };

    this.rfpRequests.set(rfpId, updated);
    return updated;
  }

  async searchRfpRequests(query: string): Promise<RfpRequest[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.rfpRequests.values()).filter(rfp => 
      rfp.client.toLowerCase().includes(lowerQuery) ||
      rfp.project.toLowerCase().includes(lowerQuery) ||
      rfp.rfpNumber.toLowerCase().includes(lowerQuery) ||
      (rfp.contactPerson && rfp.contactPerson.toLowerCase().includes(lowerQuery))
    );
  }

  async filterRfpRequestsByStatus(status: string): Promise<RfpRequest[]> {
    return Array.from(this.rfpRequests.values()).filter(rfp => rfp.status === status);
  }
}

export const storage = new MemStorage();
