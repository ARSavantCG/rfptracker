import { 
  rfpRequests, 
  contacts, 
  invitations,
  invitationToBid,
  bidCollections,
  bidLineItems,
  properties,
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
  type Property,
  type InsertProperty,
  type UpdateProperty,
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

  // Bid Collection management
  getBidCollectionsByRfp(rfpId: number): Promise<BidCollection[]>;
  getBidCollection(id: number): Promise<BidCollection | undefined>;
  createBidCollection(bidCollection: InsertBidCollection): Promise<BidCollection>;
  updateBidCollection(id: number, updates: Partial<UpdateBidCollection>): Promise<BidCollection | undefined>;
  deleteBidCollection(id: number): Promise<boolean>;
  
  // Bid Line Item management
  getBidLineItemsByBid(bidCollectionId: number): Promise<BidLineItem[]>;
  createBidLineItem(lineItem: InsertBidLineItem): Promise<BidLineItem>;
  updateBidLineItem(id: number, updates: Partial<UpdateBidLineItem>): Promise<BidLineItem | undefined>;
  deleteBidLineItem(id: number): Promise<boolean>;

  // Property management
  getAllProperties(): Promise<Property[]>;
  getProperty(id: number): Promise<Property | undefined>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(id: number, updates: Partial<UpdateProperty>): Promise<Property | undefined>;
  deleteProperty(id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private async generateRfpNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await db.$count(rfpRequests);
    const number = (count + 1).toString().padStart(3, '0');
    return `RFP-${year}-${number}`;
  }

  private async generateProjectName(propertyId: string, tenantName: string, confidential: boolean): Promise<string> {
    // Get property details to build the project name
    const [property] = await db.select().from(properties).where(eq(properties.id, parseInt(propertyId)));
    
    if (!property) {
      throw new Error('Property not found');
    }

    // Format property name with building (like in the property selector)
    const propertyDisplay = `${property.propertyName} - ${property.building}`;
    
    if (confidential) {
      return `Confidential @ ${propertyDisplay}`;
    } else {
      return `${tenantName} @ ${propertyDisplay}`;
    }
  }

  async getRfpRequest(id: number): Promise<RfpRequest | undefined> {
    const [rfp] = await db.select().from(rfpRequests).where(eq(rfpRequests.id, id));
    return rfp || undefined;
  }

  async getAllRfpRequests(): Promise<RfpRequest[]> {
    return await db.select().from(rfpRequests).orderBy(desc(rfpRequests.createdAt));
  }

  async createRfpRequest(request: InsertRfpRequest): Promise<RfpRequest> {
    const rfpNumber = await this.generateRfpNumber();
    
    const [rfp] = await db
      .insert(rfpRequests)
      .values({
        rfpNumber,
        property: request.property,
        tenantName: request.tenantName,
        projectName: request.projectName,
        confidential: request.confidential || false,
        sentBy: request.sentBy,
        receivedOn: request.receivedOn,
        dueOn: request.dueOn,
        developmentContact: request.developmentContact || null,
        projectArea: request.projectArea || null,
        requestTypes: request.requestTypes,
        notes: request.notes || null,
        files: request.files || [],
        status: "received",
        workflowPhase: "rfp-entry",
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
    try {
      console.log(`Attempting to delete RFP with ID: ${id}`);
      
      // Delete related data first to avoid foreign key constraints
      // First get all bid collections for this RFP
      const bidCollectionsToDelete = await db.select({ id: bidCollections.id })
        .from(bidCollections)
        .where(eq(bidCollections.rfpId, id));
      
      // Delete bid line items for each bid collection
      console.log('Deleting bid line items...');
      for (const bidCollection of bidCollectionsToDelete) {
        await db.delete(bidLineItems).where(eq(bidLineItems.bidCollectionId, bidCollection.id));
      }
      
      console.log('Deleting bid collections...');
      await db.delete(bidCollections).where(eq(bidCollections.rfpId, id));
      
      console.log('Deleting invitations...');
      await db.delete(invitations).where(eq(invitations.rfpId, id));
      
      console.log('Deleting invitation to bid...');
      await db.delete(invitationToBid).where(eq(invitationToBid.rfpId, id));
      
      // Now delete the RFP
      console.log('Deleting RFP...');
      const result = await db.delete(rfpRequests).where(eq(rfpRequests.id, id));
      
      const success = (result.rowCount || 0) > 0;
      console.log(`Delete result: rowCount=${result.rowCount}, success=${success}`);
      return success;
    } catch (error) {
      console.error('Error deleting RFP:', error);
      throw error;
    }
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
    return await db.select().from(rfpRequests).where(eq(rfpRequests.status, status)).orderBy(desc(rfpRequests.createdAt));
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

  // Bid Collection methods
  async getBidCollectionsByRfp(rfpId: number): Promise<BidCollection[]> {
    return await db.select().from(bidCollections).where(eq(bidCollections.rfpId, rfpId));
  }

  async getBidCollection(id: number): Promise<BidCollection | undefined> {
    const [bidCollection] = await db.select().from(bidCollections).where(eq(bidCollections.id, id));
    return bidCollection || undefined;
  }

  async createBidCollection(bidCollection: InsertBidCollection): Promise<BidCollection> {
    const [created] = await db.insert(bidCollections).values(bidCollection).returning();
    return created;
  }

  async updateBidCollection(id: number, updates: Partial<UpdateBidCollection>): Promise<BidCollection | undefined> {
    const [updated] = await db
      .update(bidCollections)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(bidCollections.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteBidCollection(id: number): Promise<boolean> {
    // First delete related line items
    await db.delete(bidLineItems).where(eq(bidLineItems.bidCollectionId, id));
    
    // Then delete the bid collection
    const result = await db.delete(bidCollections).where(eq(bidCollections.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Bid Line Item methods
  async getBidLineItemsByBid(bidCollectionId: number): Promise<BidLineItem[]> {
    return await db.select().from(bidLineItems).where(eq(bidLineItems.bidCollectionId, bidCollectionId));
  }

  async createBidLineItem(lineItem: InsertBidLineItem): Promise<BidLineItem> {
    const [created] = await db.insert(bidLineItems).values(lineItem).returning();
    return created;
  }

  async updateBidLineItem(id: number, updates: Partial<UpdateBidLineItem>): Promise<BidLineItem | undefined> {
    const [updated] = await db
      .update(bidLineItems)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(bidLineItems.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteBidLineItem(id: number): Promise<boolean> {
    const result = await db.delete(bidLineItems).where(eq(bidLineItems.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Property management methods
  async getAllProperties(): Promise<Property[]> {
    return await db.select().from(properties).orderBy(properties.displayName);
  }

  async getProperty(id: number): Promise<Property | undefined> {
    const [property] = await db.select().from(properties).where(eq(properties.id, id));
    return property || undefined;
  }

  async createProperty(property: InsertProperty): Promise<Property> {
    const displayName = `${property.propertyName} - Building ${property.building}, ${property.streetAddress}, ${property.city}, ${property.state} ${property.zip}`;
    
    const [created] = await db
      .insert(properties)
      .values({
        ...property,
        displayName,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }

  async updateProperty(id: number, updates: Partial<UpdateProperty>): Promise<Property | undefined> {
    const updateData: any = { ...updates, updatedAt: new Date() };
    
    // Regenerate display name if any fields changed
    if (updates.propertyName || updates.building || updates.streetAddress || updates.city || updates.state || updates.zip) {
      const current = await this.getProperty(id);
      if (current) {
        const propertyName = updates.propertyName || current.propertyName;
        const building = updates.building || current.building;
        const streetAddress = updates.streetAddress || current.streetAddress;
        const city = updates.city || current.city;
        const state = updates.state || current.state;
        const zip = updates.zip || current.zip;
        updateData.displayName = `${propertyName} - Building ${building}, ${streetAddress}, ${city}, ${state} ${zip}`;
      }
    }

    const [updated] = await db
      .update(properties)
      .set(updateData)
      .where(eq(properties.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteProperty(id: number): Promise<boolean> {
    const result = await db.delete(properties).where(eq(properties.id, id));
    return (result.rowCount || 0) > 0;
  }
}

export const storage = new DatabaseStorage();
