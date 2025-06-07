import { 
  rfpRequests, 
  contacts, 
  invitations,
  invitationToBid,
  bidCollections,
  bidLineItems,
  type RfpRequest, 
  type InsertRfpRequest, 
  type UpdateRfpRequest,
  type Contact,
  type InsertContact,
  type UpdateContact,
  type Invitation,
  type InsertInvitation,
  type UpdateInvitation,
  type InvitationToBid,
  type InsertInvitationToBid,
  type UpdateInvitationToBid,
  type BidCollection,
  type InsertBidCollection,
  type UpdateBidCollection,
  type BidLineItem,
  type InsertBidLineItem,
  type UpdateBidLineItem,
  type RfpFile 
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, like, or } from "drizzle-orm";

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
  
  // Workflow phase management
  advanceWorkflowPhase(rfpId: number, newPhase: string): Promise<RfpRequest | undefined>;
  getProjectsByPhase(phase: string): Promise<RfpRequest[]>;
  
  // Invitation to Bid management
  createInvitationToBid(invitation: InsertInvitationToBid): Promise<InvitationToBid>;
  getInvitationToBid(rfpId: number): Promise<InvitationToBid | undefined>;
  updateInvitationToBid(rfpId: number, updates: Partial<UpdateInvitationToBid>): Promise<InvitationToBid | undefined>;
  deleteInvitationToBid(rfpId: number): Promise<boolean>;
  
  // Contact management
  getAllContacts(): Promise<Contact[]>;
  getContact(id: number): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: number, updates: Partial<UpdateContact>): Promise<Contact | undefined>;
  deleteContact(id: number): Promise<boolean>;
  getContactsByType(type: string): Promise<Contact[]>;
  
  // Invitation management
  getAllInvitations(): Promise<Invitation[]>;
  getInvitation(id: number): Promise<Invitation | undefined>;
  getInvitationsByRfp(rfpId: number): Promise<Invitation[]>;
  createInvitation(invitation: InsertInvitation): Promise<Invitation>;
  updateInvitation(id: number, updates: Partial<UpdateInvitation>): Promise<Invitation | undefined>;
  deleteInvitation(id: number): Promise<boolean>;
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
        confidential: request.confidential || false,
        files: request.files || [],
      })
      .returning();
    
    return rfp;
  }

  async updateRfpRequest(id: number, updates: Partial<UpdateRfpRequest>): Promise<RfpRequest | undefined> {
    // Handle confidential field type conversion
    const updateData: any = { ...updates };
    if (updateData.confidential !== undefined) {
      updateData.confidential = Boolean(updateData.confidential);
    }
    
    const [updated] = await db
      .update(rfpRequests)
      .set({
        ...updateData,
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

  // Contact management methods
  async getAllContacts(): Promise<Contact[]> {
    return await db.select().from(contacts).orderBy(desc(contacts.createdAt));
  }

  async getContact(id: number): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact || undefined;
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const [created] = await db.insert(contacts).values(contact).returning();
    return created;
  }

  async updateContact(id: number, updates: Partial<UpdateContact>): Promise<Contact | undefined> {
    const [updated] = await db
      .update(contacts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteContact(id: number): Promise<boolean> {
    const result = await db.delete(contacts).where(eq(contacts.id, id));
    return (result.rowCount || 0) > 0;
  }

  async getContactsByType(type: string): Promise<Contact[]> {
    return await db.select().from(contacts).where(eq(contacts.type, type));
  }

  // Invitation management methods
  async getAllInvitations(): Promise<Invitation[]> {
    return await db.select().from(invitations).orderBy(desc(invitations.createdAt));
  }

  async getInvitation(id: number): Promise<Invitation | undefined> {
    const [invitation] = await db.select().from(invitations).where(eq(invitations.id, id));
    return invitation || undefined;
  }

  async getInvitationsByRfp(rfpId: number): Promise<Invitation[]> {
    return await db.select().from(invitations).where(eq(invitations.rfpId, rfpId));
  }

  async createInvitation(invitation: InsertInvitation): Promise<Invitation> {
    const [created] = await db.insert(invitations).values(invitation).returning();
    return created;
  }

  async updateInvitation(id: number, updates: Partial<UpdateInvitation>): Promise<Invitation | undefined> {
    const [updated] = await db
      .update(invitations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(invitations.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteInvitation(id: number): Promise<boolean> {
    const result = await db.delete(invitations).where(eq(invitations.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Workflow phase management
  async advanceWorkflowPhase(rfpId: number, newPhase: string): Promise<RfpRequest | undefined> {
    const [updated] = await db
      .update(rfpRequests)
      .set({ workflowPhase: newPhase, updatedAt: new Date() })
      .where(eq(rfpRequests.id, rfpId))
      .returning();
    return updated || undefined;
  }

  async getProjectsByPhase(phase: string): Promise<RfpRequest[]> {
    return await db.select().from(rfpRequests).where(eq(rfpRequests.workflowPhase, phase));
  }

  // Invitation to Bid management
  async createInvitationToBid(invitation: InsertInvitationToBid): Promise<InvitationToBid> {
    const [created] = await db.insert(invitationToBid).values(invitation).returning();
    return created;
  }

  async getInvitationToBid(rfpId: number): Promise<InvitationToBid | undefined> {
    const [invitation] = await db.select().from(invitationToBid).where(eq(invitationToBid.rfpId, rfpId));
    return invitation || undefined;
  }

  async updateInvitationToBid(rfpId: number, updates: Partial<UpdateInvitationToBid>): Promise<InvitationToBid | undefined> {
    try {
      console.log("Updating invitation with data:", updates);
      const [updated] = await db
        .update(invitationToBid)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(invitationToBid.rfpId, rfpId))
        .returning();
      return updated || undefined;
    } catch (error) {
      console.error("Database update error:", error);
      throw error;
    }
  }

  async deleteInvitationToBid(rfpId: number): Promise<boolean> {
    const result = await db.delete(invitationToBid).where(eq(invitationToBid.rfpId, rfpId));
    return (result.rowCount || 0) > 0;
  }
}

export const storage = new DatabaseStorage();
