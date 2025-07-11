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
  propertyExistingImprovements,
  evaluationBudgets,
  evaluationBudgetAttachments,
  evaluationBudgetHistory,
  romPilots,
  romScopeItems,
  romPilotLineItems,
  rfpGenerationHistory,
  executedLeases,
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
  type PropertyExistingImprovement,
  type InsertPropertyExistingImprovement,
  type UpdatePropertyExistingImprovement,
  type EvaluationBudget,
  type InsertEvaluationBudget,
  type UpdateEvaluationBudget,
  type EvaluationBudgetAttachment,
  type InsertEvaluationBudgetAttachment,
  type EvaluationBudgetHistory,
  type InsertEvaluationBudgetHistory,
  type RomPilot,
  type InsertRomPilot,
  type UpdateRomPilot,
  type RfpGenerationHistory,
  type InsertRfpGenerationHistory,
  type RomScopeItem,
  type InsertRomScopeItem,
  type UpdateRomScopeItem,
  type RomPilotLineItem,
  type InsertRomPilotLineItem,
  type UpdateRomPilotLineItem,
  type ExecutedLease,
  type InsertExecutedLease,
  type RfpFile,
  users,
  type User,
  type UpsertUser,
  type UpdateUser,
  pdfTemplates,
  type PdfTemplate,
  type InsertPdfTemplate,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, like, or, and, asc, gte, lte } from "drizzle-orm";

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
  deleteBidLineItemsByBidCollection(bidCollectionId: number): Promise<boolean>;

  // Property management
  getAllProperties(): Promise<Property[]>;
  getProperty(id: number): Promise<Property | undefined>;
  getNextPropertyId(): Promise<number>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(id: number, updates: Partial<UpdateProperty>): Promise<Property | undefined>;
  deleteProperty(id: number): Promise<boolean>;

  // Property Existing Improvements management
  getPropertyExistingImprovements(propertyId: number): Promise<PropertyExistingImprovement[]>;
  getPropertyExistingImprovement(id: number): Promise<PropertyExistingImprovement | undefined>;
  createPropertyExistingImprovement(improvement: InsertPropertyExistingImprovement): Promise<PropertyExistingImprovement>;
  updatePropertyExistingImprovement(id: number, updates: Partial<UpdatePropertyExistingImprovement>): Promise<PropertyExistingImprovement | undefined>;
  deletePropertyExistingImprovement(id: number): Promise<boolean>;

  // Evaluation Budget management
  getEvaluationBudget(rfpId: number): Promise<EvaluationBudget | undefined>;
  createEvaluationBudget(budget: InsertEvaluationBudget): Promise<EvaluationBudget>;
  updateEvaluationBudget(rfpId: number, updates: Partial<UpdateEvaluationBudget>): Promise<EvaluationBudget | undefined>;
  
  // Evaluation Budget Attachment management
  getEvaluationBudgetAttachments(rfpId: number): Promise<EvaluationBudgetAttachment[]>;
  getEvaluationBudgetAttachment(attachmentId: number): Promise<EvaluationBudgetAttachment | undefined>;
  createEvaluationBudgetAttachment(attachment: InsertEvaluationBudgetAttachment): Promise<EvaluationBudgetAttachment>;
  deleteEvaluationBudgetAttachment(attachmentId: number): Promise<boolean>;

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

  // User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  // Admin user management
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, updates: UpdateUser): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  
  // Contact operations for access control
  getContactsByType(type: string): Promise<Contact[]>;
  
  // Evaluation Budget Attachments
  createEvaluationBudgetAttachment(attachment: InsertEvaluationBudgetAttachment): Promise<EvaluationBudgetAttachment>;
  getEvaluationBudgetAttachments(rfpId: number): Promise<EvaluationBudgetAttachment[]>;
  getEvaluationBudgetAttachment(attachmentId: number): Promise<EvaluationBudgetAttachment | undefined>;
  deleteEvaluationBudgetAttachment(attachmentId: number): Promise<boolean>;
  
  // Evaluation Budget History
  createEvaluationBudgetHistory(history: InsertEvaluationBudgetHistory): Promise<EvaluationBudgetHistory>;
  getEvaluationBudgetHistory(rfpId: number): Promise<EvaluationBudgetHistory[]>;
  getEvaluationBudgetHistoryById(id: number): Promise<EvaluationBudgetHistory | undefined>;
  updateEvaluationBudgetHistory(id: number, updates: Partial<EvaluationBudgetHistory>): Promise<EvaluationBudgetHistory | undefined>;
  deleteEvaluationBudgetHistory(id: number): Promise<boolean>;

  // RFP Generation History management
  getRfpGenerationHistory(rfpId: number): Promise<RfpGenerationHistory[]>;
  getGenerationHistoryItem(id: number): Promise<RfpGenerationHistory | undefined>;
  createGenerationHistoryItem(historyItem: InsertRfpGenerationHistory): Promise<RfpGenerationHistory>;
  deleteGenerationHistoryItem(id: number): Promise<boolean>;
  
  // Executed Leases management
  getExecutedLeases(propertyId: number): Promise<ExecutedLease[]>;
  createExecutedLease(lease: InsertExecutedLease): Promise<ExecutedLease>;
  updateExecutedLease(id: number, updates: Partial<ExecutedLease>): Promise<ExecutedLease | undefined>;
  deleteExecutedLease(id: number): Promise<boolean>;
  getExecutedLease(id: number): Promise<ExecutedLease | undefined>;
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
    const propertyDisplay = property.building && property.building.trim() !== '' 
      ? `${property.propertyName} - Bldg. ${property.building}`
      : property.propertyName;
    
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
        status: "in-progress",
        workflowPhase: "rfp-validation",
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
    
    // Auto-calculate warehouse area from bay configurations if provided
    if (updateData.selectedBayConfigurations && Array.isArray(updateData.selectedBayConfigurations)) {
      const totalRentableArea = updateData.selectedBayConfigurations.reduce((sum: number, bay: any) => {
        return sum + (bay.rentableSquareFootage || 0);
      }, 0);
      
      if (totalRentableArea > 0) {
        updateData.warehouseArea = Math.round(totalRentableArea).toString();
      }
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
      
      // Delete bid line items and attachments for each bid collection
      console.log('Deleting bid line items and attachments...');
      for (const bidCollection of bidCollectionsToDelete) {
        await db.delete(bidLineItems).where(eq(bidLineItems.bidCollectionId, bidCollection.id));
        await db.delete(bidAttachments).where(eq(bidAttachments.bidCollectionId, bidCollection.id));
      }
      
      console.log('Deleting bid collections...');
      await db.delete(bidCollections).where(eq(bidCollections.rfpId, id));
      
      console.log('Deleting invitations...');
      await db.delete(invitations).where(eq(invitations.rfpId, id));
      
      console.log('Deleting invitation to bid...');
      await db.delete(invitationToBid).where(eq(invitationToBid.rfpId, id));

      console.log('Deleting RFP generation history...');
      await db.delete(rfpGenerationHistory).where(eq(rfpGenerationHistory.rfpId, id));

      console.log('Deleting evaluation budget history...');
      await db.delete(evaluationBudgetHistory).where(eq(evaluationBudgetHistory.rfpId, id));

      console.log('Deleting evaluation budget attachments...');
      await db.delete(evaluationBudgetAttachments).where(eq(evaluationBudgetAttachments.rfpId, id));

      console.log('Deleting RFP files...');
      await db.delete(rfpFiles).where(eq(rfpFiles.rfpRequestId, id));
      
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
    // Determine the appropriate status based on the workflow phase
    let newStatus = "in-progress"; // Default status for most phases
    
    if (newPhase === "rfp-entry") {
      newStatus = "received";
    }
    // Note: 'publish' phase stays 'in-progress' until explicitly marked complete
    
    const [updated] = await db
      .update(rfpRequests)
      .set({ 
        workflowPhase: newPhase, 
        status: newStatus,
        updatedAt: new Date() 
      })
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

  async deleteBidLineItemsByBidCollection(bidCollectionId: number): Promise<boolean> {
    const result = await db.delete(bidLineItems).where(eq(bidLineItems.bidCollectionId, bidCollectionId));
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

  async getNextPropertyId(): Promise<number> {
    const [result] = await db
      .select({ maxId: sql<number>`COALESCE(MAX(id), 0)` })
      .from(properties);
    return (result?.maxId || 0) + 1;
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

  // Property Existing Improvements management
  async getPropertyExistingImprovements(propertyId: number): Promise<PropertyExistingImprovement[]> {
    return await db.select().from(propertyExistingImprovements).where(eq(propertyExistingImprovements.propertyId, propertyId));
  }

  async getPropertyExistingImprovement(id: number): Promise<PropertyExistingImprovement | undefined> {
    const [improvement] = await db.select().from(propertyExistingImprovements).where(eq(propertyExistingImprovements.id, id));
    return improvement || undefined;
  }

  async createPropertyExistingImprovement(improvement: InsertPropertyExistingImprovement): Promise<PropertyExistingImprovement> {
    const [created] = await db
      .insert(propertyExistingImprovements)
      .values({
        ...improvement,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }

  async updatePropertyExistingImprovement(id: number, updates: Partial<UpdatePropertyExistingImprovement>): Promise<PropertyExistingImprovement | undefined> {
    const updateData: any = { ...updates, updatedAt: new Date() };

    const [updated] = await db
      .update(propertyExistingImprovements)
      .set(updateData)
      .where(eq(propertyExistingImprovements.id, id))
      .returning();
    return updated || undefined;
  }

  async deletePropertyExistingImprovement(id: number): Promise<boolean> {
    const result = await db.delete(propertyExistingImprovements).where(eq(propertyExistingImprovements.id, id));
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
    return (result.rowCount || 0) > 0;
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
      // Save all line items including custom items (scopeItemId = 0)
      if (item.scopeItemId !== undefined && item.scopeItemId >= 0) {
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

  // Evaluation Budget Attachment implementation
  async getEvaluationBudgetAttachments(rfpId: number): Promise<EvaluationBudgetAttachment[]> {
    return await db.select().from(evaluationBudgetAttachments).where(eq(evaluationBudgetAttachments.rfpId, rfpId));
  }

  async getAllEvaluationBudgetAttachments(): Promise<EvaluationBudgetAttachment[]> {
    return await db.select().from(evaluationBudgetAttachments);
  }

  // File cleanup utility methods - working with JSON file storage
  async getAllRfpFiles(): Promise<{ filename: string; name: string; size: number }[]> {
    const rfps = await db.select({
      id: rfpRequests.id,
      files: rfpRequests.files
    }).from(rfpRequests);
    
    const allFiles: { filename: string; name: string; size: number }[] = [];
    for (const rfp of rfps) {
      if (rfp.files && Array.isArray(rfp.files)) {
        for (const file of rfp.files) {
          allFiles.push({
            filename: file.filename,
            name: file.name,
            size: file.size || 0
          });
        }
      }
    }
    return allFiles;
  }

  async getAllBidFiles(): Promise<{ filename: string; originalName: string; size: number }[]> {
    // Note: Currently bid files are not stored separately - they would be in bid attachments
    // This is a placeholder for future implementation
    return [];
  }

  async getRfpFiles(rfpId: number): Promise<{ filename: string; name: string; size: number }[]> {
    const [rfp] = await db.select({
      files: rfpRequests.files
    }).from(rfpRequests).where(eq(rfpRequests.id, rfpId));
    
    if (!rfp || !rfp.files || !Array.isArray(rfp.files)) {
      return [];
    }
    
    return rfp.files.map(file => ({
      filename: file.filename,
      name: file.name,
      size: file.size || 0
    }));
  }

  async getBidFiles(bidId: number): Promise<{ filename: string; originalName: string; size: number }[]> {
    // Note: Currently bid files are not stored separately - placeholder
    return [];
  }

  async getEvaluationBudgetAttachment(attachmentId: number): Promise<EvaluationBudgetAttachment | undefined> {
    const [attachment] = await db.select().from(evaluationBudgetAttachments).where(eq(evaluationBudgetAttachments.id, attachmentId));
    return attachment || undefined;
  }

  async createEvaluationBudgetAttachment(attachment: InsertEvaluationBudgetAttachment): Promise<EvaluationBudgetAttachment> {
    const [created] = await db
      .insert(evaluationBudgetAttachments)
      .values({
        ...attachment,
        uploadedAt: new Date(),
      })
      .returning();
    return created;
  }

  async deleteEvaluationBudgetAttachment(attachmentId: number): Promise<boolean> {
    const result = await db.delete(evaluationBudgetAttachments).where(eq(evaluationBudgetAttachments.id, attachmentId));
    return result.rowCount > 0;
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

  // RFP Generation History methods
  async getRfpGenerationHistory(rfpId: number): Promise<RfpGenerationHistory[]> {
    return await db
      .select()
      .from(rfpGenerationHistory)
      .where(eq(rfpGenerationHistory.rfpId, rfpId))
      .orderBy(desc(rfpGenerationHistory.generatedAt));
  }

  async getGenerationHistoryItem(id: number): Promise<RfpGenerationHistory | undefined> {
    const [item] = await db
      .select()
      .from(rfpGenerationHistory)
      .where(eq(rfpGenerationHistory.id, id));
    return item || undefined;
  }

  async createGenerationHistoryItem(historyItem: InsertRfpGenerationHistory): Promise<RfpGenerationHistory> {
    const [created] = await db
      .insert(rfpGenerationHistory)
      .values(historyItem)
      .returning();
    return created;
  }

  async deleteGenerationHistoryItem(id: number): Promise<boolean> {
    const result = await db.delete(rfpGenerationHistory).where(eq(rfpGenerationHistory.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Evaluation Budget History methods
  async createEvaluationBudgetHistory(historyData: {
    rfpId: number;
    reportName: string;
    generatedBy: string;
    generatedContent: string;
    changeSummary?: string[];
    notes?: string;
  }) {
    const [history] = await db
      .insert(evaluationBudgetHistory)
      .values(historyData)
      .returning();
    return history;
  }

  async getEvaluationBudgetHistory(rfpId: number) {
    return await db
      .select()
      .from(evaluationBudgetHistory)
      .where(eq(evaluationBudgetHistory.rfpId, rfpId))
      .orderBy(desc(evaluationBudgetHistory.createdAt));
  }

  async getEvaluationBudgetHistoryById(id: number) {
    const [item] = await db
      .select()
      .from(evaluationBudgetHistory)
      .where(eq(evaluationBudgetHistory.id, id));
    return item;
  }

  async updateEvaluationBudgetHistory(id: number, updates: { reportName?: string; notes?: string }) {
    const [updated] = await db
      .update(evaluationBudgetHistory)
      .set(updates)
      .where(eq(evaluationBudgetHistory.id, id))
      .returning();
    return updated;
  }

  async deleteEvaluationBudgetHistory(id: number): Promise<boolean> {
    const result = await db
      .delete(evaluationBudgetHistory)
      .where(eq(evaluationBudgetHistory.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Generate change summary for evaluation budget
  generateEvaluationChangeSummary(previousBudget: any, currentBudget: any): string[] {
    const changes: string[] = [];
    
    if (!previousBudget) {
      changes.push("Initial evaluation budget created");
      return changes;
    }
    
    // Handle legacy HTML reports where we can't extract budget data
    if (previousBudget.isLegacyReport) {
      changes.push("Budget modifications since previous report");
      return changes;
    }

    // Check for line item changes
    const prevTI = previousBudget.tenantImprovements || [];
    const currTI = currentBudget.tenantImprovements || [];
    if (prevTI.length !== currTI.length) {
      if (currTI.length > prevTI.length) {
        changes.push("Added line items");
      } else {
        changes.push("Removed line items");
      }
    }

    // Enhanced rollup change detection
    const prevRollups = previousBudget.lineItemRollups || {};
    const currRollups = currentBudget.lineItemRollups || {};
    
    // Check if rollup configuration changed (not just count)
    const prevRollupKeys = Object.keys(prevRollups);
    const currRollupKeys = Object.keys(currRollups);
    
    let rollupsChanged = false;
    if (prevRollupKeys.length !== currRollupKeys.length) {
      rollupsChanged = true;
    } else {
      // Check if rollup values changed
      for (const key of currRollupKeys) {
        if (prevRollups[key] !== currRollups[key]) {
          rollupsChanged = true;
          break;
        }
      }
    }
    
    if (rollupsChanged) {
      changes.push("Changes to line item rollups");
    }

    // Check for assembly changes
    const prevAssemblies = Object.keys(previousBudget.assemblies || {}).length;
    const currAssemblies = Object.keys(currentBudget.assemblies || {}).length;
    if (prevAssemblies !== currAssemblies) {
      changes.push("Changes to assemblies");
    }

    // Check for design/soft cost changes
    const prevDesign = previousBudget.designSoftCosts || [];
    const currDesign = currentBudget.designSoftCosts || [];
    if (prevDesign.length !== currDesign.length) {
      changes.push("Changes to design/soft costs");
    }

    // Check for existing improvements changes
    const prevExisting = previousBudget.existingImprovements || [];
    const currExisting = currentBudget.existingImprovements || [];
    if (prevExisting.length !== currExisting.length) {
      changes.push("Changes to existing improvements");
    }

    // Check for total amount changes
    if (previousBudget.grandTotal !== currentBudget.grandTotal) {
      changes.push("Updated total amounts");
    }

    // Check for door information changes
    const prevDoors = previousBudget.metadata?.oversizedDoors || 0;
    const currDoors = currentBudget.metadata?.oversizedDoors || 0;
    if (prevDoors !== currDoors) {
      changes.push("Updated door configuration");
    }

    if (changes.length === 0) {
      changes.push("Minor adjustments");
    }

    return changes;
  }

  async deleteEvaluationBudgetHistory(id: number): Promise<boolean> {
    try {
      const result = await db.delete(evaluationBudgetHistory).where(eq(evaluationBudgetHistory.id, id));
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error("Error deleting evaluation budget history:", error);
      return false;
    }
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

  async getContactsByType(type: string): Promise<Contact[]> {
    return await db.select().from(contacts).where(eq(contacts.type, type));
  }

  async getAuthorizedContacts(): Promise<Contact[]> {
    try {
      // Get all owner contacts and filter by hasSystemAccess
      const ownerContacts = await db.select().from(contacts).where(eq(contacts.type, "owner"));
      const result = ownerContacts.filter(contact => contact.hasSystemAccess === true);
      console.log("Authorized contacts query result:", result);
      return result;
    } catch (error) {
      console.error("Error in getAuthorizedContacts:", error);
      throw error;
    }
  }

  async getUsers(): Promise<User[]> {
    try {
      const result = await db.select().from(users);
      console.log("Users query result:", result);
      return result;
    } catch (error) {
      console.error("Error in getUsers:", error);
      throw error;
    }
  }

  async getAllUsers(): Promise<User[]> {
    return this.getUsers();
  }

  async updateUser(id: string, updates: UpdateUser): Promise<User | undefined> {
    try {
      const [user] = await db
        .update(users)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      return user;
    } catch (error) {
      console.error("Error updating user:", error);
      throw error;
    }
  }

  async deleteUser(id: string): Promise<boolean> {
    try {
      const result = await db.delete(users).where(eq(users.id, id));
      return result.rowCount! > 0;
    } catch (error) {
      console.error("Error deleting user:", error);
      throw error;
    }
  }

  // Evaluation Budget Attachments
  async createEvaluationBudgetAttachment(attachment: InsertEvaluationBudgetAttachment): Promise<EvaluationBudgetAttachment> {
    const [created] = await db
      .insert(evaluationBudgetAttachments)
      .values(attachment)
      .returning();
    return created;
  }

  async getEvaluationBudgetAttachments(rfpId: number): Promise<EvaluationBudgetAttachment[]> {
    return await db
      .select()
      .from(evaluationBudgetAttachments)
      .where(eq(evaluationBudgetAttachments.rfpId, rfpId));
  }

  async getEvaluationBudgetAttachment(attachmentId: number): Promise<EvaluationBudgetAttachment | undefined> {
    const [attachment] = await db
      .select()
      .from(evaluationBudgetAttachments)
      .where(eq(evaluationBudgetAttachments.id, attachmentId));
    return attachment || undefined;
  }

  async deleteEvaluationBudgetAttachment(attachmentId: number): Promise<boolean> {
    const result = await db
      .delete(evaluationBudgetAttachments)
      .where(eq(evaluationBudgetAttachments.id, attachmentId));
    return result.rowCount! > 0;
  }

  // Executed Leases management
  async getAllExecutedLeases(): Promise<ExecutedLease[]> {
    return await db
      .select()
      .from(executedLeases)
      .orderBy(desc(executedLeases.tenantName));
  }

  async getExecutedLeases(propertyId: number): Promise<ExecutedLease[]> {
    return await db
      .select()
      .from(executedLeases)
      .where(eq(executedLeases.propertyId, propertyId))
      .orderBy(desc(executedLeases.tenantName));
  }

  async createExecutedLease(lease: InsertExecutedLease): Promise<ExecutedLease> {
    const [created] = await db
      .insert(executedLeases)
      .values(lease)
      .returning();
    return created;
  }

  async updateExecutedLease(id: number, updates: Partial<ExecutedLease>): Promise<ExecutedLease | undefined> {
    const [updated] = await db
      .update(executedLeases)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(executedLeases.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteExecutedLease(id: number): Promise<boolean> {
    const result = await db
      .delete(executedLeases)
      .where(eq(executedLeases.id, id));
    return result.rowCount! > 0;
  }

  async getExecutedLease(id: number): Promise<ExecutedLease | undefined> {
    const [lease] = await db
      .select()
      .from(executedLeases)
      .where(eq(executedLeases.id, id));
    return lease || undefined;
  }

  // PDF Template management
  async getPdfTemplates(): Promise<PdfTemplate[]> {
    const templates = await db.select().from(pdfTemplates).orderBy(pdfTemplates.templateType, pdfTemplates.section);
    return templates;
  }

  async getPdfTemplate(id: number): Promise<PdfTemplate | undefined> {
    const [template] = await db.select().from(pdfTemplates).where(eq(pdfTemplates.id, id));
    return template;
  }

  async getPdfTemplateByKey(templateKey: string): Promise<PdfTemplate | undefined> {
    const [template] = await db.select().from(pdfTemplates).where(eq(pdfTemplates.templateKey, templateKey));
    return template;
  }

  async createPdfTemplate(templateData: InsertPdfTemplate): Promise<PdfTemplate> {
    const [template] = await db.insert(pdfTemplates).values({
      ...templateData,
      updatedAt: new Date()
    }).returning();
    return template;
  }

  async updatePdfTemplate(id: number, templateData: Partial<InsertPdfTemplate>): Promise<PdfTemplate> {
    const [template] = await db.update(pdfTemplates)
      .set({
        ...templateData,
        updatedAt: new Date()
      })
      .where(eq(pdfTemplates.id, id))
      .returning();
    return template;
  }

  async deletePdfTemplate(id: number): Promise<void> {
    await db.delete(pdfTemplates).where(eq(pdfTemplates.id, id));
  }

  async getAllPdfTemplates(): Promise<PdfTemplate[]> {
    return await db.select().from(pdfTemplates).orderBy(asc(pdfTemplates.templateKey));
  }
}

export const storage = new ExtendedDatabaseStorage();
