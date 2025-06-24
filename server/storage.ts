/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { 
  rfpRequests, 
  contacts, 
  invitations,
  invitationToBid,
  bidCollections,
  bidLineItems,
  properties,
  evaluationBudgets,
  romPilots,
  romScopeItems,
  romPilotLineItems,
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
  type EvaluationBudget,
  type InsertEvaluationBudget,
  type UpdateEvaluationBudget,
  type RomPilot,
  type InsertRomPilot,
  type UpdateRomPilot,
  type RomScopeItem,
  type InsertRomScopeItem,
  type UpdateRomScopeItem,
  type RomPilotLineItem,
  type InsertRomPilotLineItem,
  type UpdateRomPilotLineItem,
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

  // Evaluation Budget management
  getEvaluationBudget(rfpId: number): Promise<EvaluationBudget | undefined>;
  createEvaluationBudget(budget: InsertEvaluationBudget): Promise<EvaluationBudget>;
  updateEvaluationBudget(rfpId: number, updates: Partial<UpdateEvaluationBudget>): Promise<EvaluationBudget | undefined>;

  // ROM Pilot management
  getAllRomPilots(): Promise<RomPilot[]>;
  getRomPilot(id: number): Promise<RomPilot | undefined>;
  createRomPilot(romPilot: InsertRomPilot): Promise<RomPilot>;
  updateRomPilot(id: number, updates: Partial<UpdateRomPilot>): Promise<RomPilot | undefined>;
  deleteRomPilot(id: number): Promise<boolean>;

  // ROM Scope Item management
  getAllRomScopeItems(): Promise<RomScopeItem[]>;
  getRomScopeItem(id: number): Promise<RomScopeItem | undefined>;
  createRomScopeItem(scopeItem: InsertRomScopeItem): Promise<RomScopeItem>;
  updateRomScopeItem(id: number, updates: Partial<UpdateRomScopeItem>): Promise<RomScopeItem | undefined>;
  deleteRomScopeItem(id: number): Promise<boolean>;

  // ROM Pilot Line Item management
  getRomPilotLineItems(romPilotId: number): Promise<RomPilotLineItem[]>;
  createRomPilotLineItem(lineItem: InsertRomPilotLineItem): Promise<RomPilotLineItem>;
  updateRomPilotLineItem(id: number, updates: Partial<UpdateRomPilotLineItem>): Promise<RomPilotLineItem | undefined>;
  deleteRomPilotLineItem(id: number): Promise<boolean>;
  saveRomPilotLineItems(romPilotId: number, lineItems: any[]): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    this.initializeDefaultScopeItems();
  }

  private async initializeDefaultScopeItems(): Promise<void> {
    try {
      // Check if scope items already exist
      const existingItems = await db.select().from(romScopeItems).limit(1);
      if (existingItems.length > 0) {
        return; // Already initialized
      }

      // Create default scope items
      const defaultScopeItems = [
        { name: "Office Build-Out", description: "Standard office construction with partition walls, doors, and basic finishes", unit: "sf", unitPrice: "85.00", category: "office" },
        { name: "Conference Room", description: "Conference room with A/V capabilities and glass partitions", unit: "sf", unitPrice: "120.00", category: "office" },
        { name: "Reception Area", description: "Reception desk, waiting area, and custom millwork", unit: "sf", unitPrice: "95.00", category: "office" },
        { name: "Break Room", description: "Employee break room with kitchenette and appliances", unit: "sf", unitPrice: "110.00", category: "office" },
        { name: "Private Office", description: "Private office with upgraded finishes", unit: "sf", unitPrice: "90.00", category: "office" },
        { name: "Open Office", description: "Open office space with workstations", unit: "sf", unitPrice: "75.00", category: "office" },
        { name: "Warehouse Racking", description: "Heavy-duty warehouse racking system", unit: "lf", unitPrice: "150.00", category: "warehouse" },
        { name: "Mezzanine", description: "Steel mezzanine construction", unit: "sf", unitPrice: "45.00", category: "warehouse" },
        { name: "Dock Equipment", description: "Dock levelers, seals, and equipment", unit: "ea", unitPrice: "8500.00", category: "warehouse" },
        { name: "Overhead Doors", description: "Sectional overhead doors", unit: "ea", unitPrice: "3200.00", category: "warehouse" },
        { name: "HVAC System", description: "Heating, ventilation, and air conditioning", unit: "sf", unitPrice: "12.50", category: "general" },
        { name: "Electrical Work", description: "Electrical rough-in and fixtures", unit: "sf", unitPrice: "8.75", category: "general" },
        { name: "Plumbing", description: "Plumbing rough-in and fixtures", unit: "sf", unitPrice: "6.25", category: "general" },
        { name: "Flooring - Carpet", description: "Commercial grade carpet installation", unit: "sf", unitPrice: "4.50", category: "general" },
        { name: "Flooring - VCT", description: "Vinyl composite tile flooring", unit: "sf", unitPrice: "3.25", category: "general" },
        { name: "Flooring - Concrete Polish", description: "Polished concrete flooring", unit: "sf", unitPrice: "8.00", category: "general" },
        { name: "Paint & Wall Finishes", description: "Interior paint and wall coverings", unit: "sf", unitPrice: "2.75", category: "general" },
        { name: "Fire Sprinkler System", description: "Fire protection sprinkler system", unit: "sf", unitPrice: "4.00", category: "general" },
        { name: "Security System", description: "Access control and security cameras", unit: "sf", unitPrice: "3.50", category: "general" },
        { name: "Data/Communications", description: "Network cabling and telecommunications", unit: "sf", unitPrice: "5.25", category: "general" }
      ];

      for (const item of defaultScopeItems) {
        await db.insert(romScopeItems).values({
          ...item,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    } catch (error) {
      console.error("Error initializing scope items:", error);
    }
  }

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
    return await db.select().from(rfpRequests).orderBy(desc(rfpRequests.id));
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
        internalDueDate: request.internalDueDate,
        contractorDueDate: request.contractorDueDate || null,
        architectDueDate: request.architectDueDate || null,
        developmentContact: request.developmentContact || null,
        projectArea: request.projectArea || null,
        requestTypes: request.requestTypes,
        notes: request.notes || null,
        files: request.files || [],
        selectedBayConfigurations: request.selectedBayConfigurations || [],
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
    return await db.select().from(rfpRequests).where(eq(rfpRequests.status, status)).orderBy(desc(rfpRequests.id));
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
    const buildingPart = property.building ? ` - Building ${property.building}` : '';
    const displayName = `${property.propertyName}${buildingPart}, ${property.streetAddress}, ${property.city}, ${property.state} ${property.zip}`;
    
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
        const buildingPart = building ? ` - Building ${building}` : '';
        updateData.displayName = `${propertyName}${buildingPart}, ${streetAddress}, ${city}, ${state} ${zip}`;
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

  // Evaluation Budget management
  async getEvaluationBudget(rfpId: number): Promise<EvaluationBudget | undefined> {
    const [budget] = await db.select().from(evaluationBudgets).where(eq(evaluationBudgets.rfpId, rfpId));
    return budget || undefined;
  }

  async createEvaluationBudget(budget: InsertEvaluationBudget): Promise<EvaluationBudget> {
    const [created] = await db
      .insert(evaluationBudgets)
      .values({
        ...budget,
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }

  async updateEvaluationBudget(rfpId: number, updates: Partial<UpdateEvaluationBudget>): Promise<EvaluationBudget | undefined> {
    const [updated] = await db
      .update(evaluationBudgets)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(evaluationBudgets.rfpId, rfpId))
      .returning();
    return updated || undefined;
  }

  // ROM Pilot implementation
  async getAllRomPilots(): Promise<RomPilot[]> {
    return await db.select().from(romPilots).orderBy(desc(romPilots.createdAt));
  }

  async getRomPilot(id: number): Promise<RomPilot | undefined> {
    const [pilot] = await db.select().from(romPilots).where(eq(romPilots.id, id));
    return pilot || undefined;
  }

  async createRomPilot(romPilot: InsertRomPilot): Promise<RomPilot> {
    const [created] = await db
      .insert(romPilots)
      .values({
        ...romPilot,
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }

  async updateRomPilot(id: number, updates: Partial<UpdateRomPilot>): Promise<RomPilot | undefined> {
    const [updated] = await db
      .update(romPilots)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(romPilots.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRomPilot(id: number): Promise<boolean> {
    // Delete related line items first
    await db.delete(romPilotLineItems).where(eq(romPilotLineItems.romPilotId, id));
    
    const result = await db.delete(romPilots).where(eq(romPilots.id, id));
    return result.rowCount > 0;
  }

  // ROM Scope Item implementation
  async getAllRomScopeItems(): Promise<RomScopeItem[]> {
    return await db.select().from(romScopeItems).where(eq(romScopeItems.isActive, true)).orderBy(romScopeItems.category, romScopeItems.name);
  }

  async getRomScopeItem(id: number): Promise<RomScopeItem | undefined> {
    const [item] = await db.select().from(romScopeItems).where(eq(romScopeItems.id, id));
    return item || undefined;
  }

  async createRomScopeItem(scopeItem: InsertRomScopeItem): Promise<RomScopeItem> {
    const [created] = await db
      .insert(romScopeItems)
      .values({
        ...scopeItem,
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }

  async updateRomScopeItem(id: number, updates: Partial<UpdateRomScopeItem>): Promise<RomScopeItem | undefined> {
    const [updated] = await db
      .update(romScopeItems)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(romScopeItems.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRomScopeItem(id: number): Promise<boolean> {
    const result = await db.delete(romScopeItems).where(eq(romScopeItems.id, id));
    return result.rowCount > 0;
  }

  // ROM Pilot Line Item implementation
  async getRomPilotLineItems(romPilotId: number): Promise<RomPilotLineItem[]> {
    return await db.select().from(romPilotLineItems).where(eq(romPilotLineItems.romPilotId, romPilotId));
  }

  async createRomPilotLineItem(lineItem: InsertRomPilotLineItem): Promise<RomPilotLineItem> {
    const [created] = await db
      .insert(romPilotLineItems)
      .values({
        ...lineItem,
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }

  async updateRomPilotLineItem(id: number, updates: Partial<UpdateRomPilotLineItem>): Promise<RomPilotLineItem | undefined> {
    const [updated] = await db
      .update(romPilotLineItems)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(romPilotLineItems.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRomPilotLineItem(id: number): Promise<boolean> {
    const result = await db.delete(romPilotLineItems).where(eq(romPilotLineItems.id, id));
    return result.rowCount > 0;
  }

  async saveRomPilotLineItems(romPilotId: number, lineItems: any[]): Promise<any[]> {
    // Delete existing line items for this ROM Pilot
    await db.delete(romPilotLineItems).where(eq(romPilotLineItems.romPilotId, romPilotId));
    
    // Insert new line items
    const savedItems = [];
    for (const item of lineItems) {
      if (item.scopeItemId && item.scopeItemId > 0) {
        const [created] = await db
          .insert(romPilotLineItems)
          .values({
            romPilotId,
            scopeItemId: item.scopeItemId,
            quantity: item.quantity || "0",
            unitPrice: item.unitPrice || "0",
            totalPrice: item.totalPrice || "0",
            notes: item.notes || null,
            category: item.category || 'tenant-improvements',
            updatedAt: new Date(),
          })
          .returning();
        savedItems.push(created);
      }
    }
    
    return savedItems;
  }

  // ROM Scope Items methods
  async getAllRomScopeItems(): Promise<RomScopeItem[]> {
    return await db.select().from(romScopeItems).where(eq(romScopeItems.isActive, true));
  }

  async createRomScopeItem(scopeItem: InsertRomScopeItem): Promise<RomScopeItem> {
    const [created] = await db
      .insert(romScopeItems)
      .values({
        ...scopeItem,
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }

  async updateRomScopeItem(id: number, updates: Partial<UpdateRomScopeItem>): Promise<RomScopeItem | undefined> {
    const [updated] = await db
      .update(romScopeItems)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(romScopeItems.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRomScopeItem(id: number): Promise<boolean> {
    const result = await db.delete(romScopeItems).where(eq(romScopeItems.id, id));
    return (result.rowCount || 0) > 0;
  }
}

// Temporary in-memory storage for ROM Pilots until database schema is updated
class MemoryRomPilotStorage {
  private romPilots: Map<number, any> = new Map();
  private nextId = 1;

  getAllRomPilots(): Promise<any[]> {
    return Promise.resolve(Array.from(this.romPilots.values()));
  }

  getRomPilot(id: number): Promise<any | undefined> {
    return Promise.resolve(this.romPilots.get(id));
  }

  createRomPilot(data: any): Promise<any> {
    const romPilot = {
      id: this.nextId++,
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.romPilots.set(romPilot.id, romPilot);
    return Promise.resolve(romPilot);
  }

  updateRomPilot(id: number, updates: any): Promise<any | undefined> {
    const existing = this.romPilots.get(id);
    if (!existing) return Promise.resolve(undefined);
    
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.romPilots.set(id, updated);
    return Promise.resolve(updated);
  }

  deleteRomPilot(id: number): Promise<boolean> {
    return Promise.resolve(this.romPilots.delete(id));
  }
}

const memoryRomPilotStorage = new MemoryRomPilotStorage();

// Extended DatabaseStorage class with ROM Pilot methods
class ExtendedDatabaseStorage extends DatabaseStorage {
  async getAllRomPilots() {
    return memoryRomPilotStorage.getAllRomPilots();
  }

  async getRomPilot(id: number) {
    return memoryRomPilotStorage.getRomPilot(id);
  }

  async createRomPilot(data: any) {
    return memoryRomPilotStorage.createRomPilot(data);
  }

  async updateRomPilot(id: number, updates: any) {
    return memoryRomPilotStorage.updateRomPilot(id, updates);
  }

  async deleteRomPilot(id: number) {
    return memoryRomPilotStorage.deleteRomPilot(id);
  }
}

export const storage = new ExtendedDatabaseStorage();
