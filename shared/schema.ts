/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { pgTable, text, serial, integer, timestamp, json, jsonb, boolean, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const rfpRequests = pgTable("rfp_requests", {
  id: serial("id").primaryKey(),
  rfpNumber: text("rfp_number").notNull().unique(),
  
  // Initial RFP Entry Fields
  property: text("property").notNull(),
  tenantName: text("tenant_name").notNull(),
  projectName: text("project_name").notNull(),
  confidential: boolean("confidential").default(false),
  sentBy: text("sent_by").notNull(),
  receivedOn: timestamp("received_on").notNull(),
  internalDueDate: timestamp("internal_due_date").notNull(),
  contractorDueDate: timestamp("contractor_due_date"),
  architectDueDate: timestamp("architect_due_date"),
  developmentContact: text("development_contact"),
  projectArea: text("project_area"),
  requestTypes: json("request_types").$type<string[]>().notNull(), // pricing, schedule, space-plan
  
  // System fields
  status: text("status").notNull().default("received"), // received, in-progress, completed, on-hold
  workflowPhase: text("workflow_phase").notNull().default("rfp-entry"), // rfp-entry, rfp-validation, invitation-to-bid, bid-collection, evaluation, publish
  notes: text("notes"),
  files: json("files").$type<RfpFile[]>().notNull().default([]),
  selectedBayConfigurations: json("selected_bay_configurations").$type<BayConfiguration[]>().default([]),
  
  // Validation fields for workflow progression
  isValidated: json("is_validated").default(false).$type<boolean>(),
  validationErrors: json("validation_errors").$type<string[]>().default([]),
  
  // Phase 2: Validation & Progression Fields (populated during validation step)
  generalContractor: text("general_contractor"),
  architect: text("architect"),
  officeAreaExisting: text("office_area_existing"),
  officeAreaNew: text("office_area_new"),
  warehouseArea: text("warehouse_area"),
  warehouseNotes: text("warehouse_notes"),
  areaBreakdown: json("area_breakdown").$type<{id: string, description: string, squareFootage: string, notes?: string}[]>().default([]),
  projectAddress: text("project_address"),
  projectSize: text("project_size"),
  estimatedValue: text("estimated_value"),
  timelineRequirements: text("timeline_requirements"),
  specialRequirements: text("special_requirements"),
  contactPerson: text("contact_person"),
  contactEmail: text("contact_email"),
  dueDate: timestamp("due_date"),
  projectDescription: text("project_description"),
  documentsLink: text("documents_link"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRfpRequestSchema = createInsertSchema(rfpRequests).omit({
  id: true,
  rfpNumber: true,
  createdAt: true,
  updatedAt: true,
  isValidated: true,
  validationErrors: true,
}).extend({
  requestTypes: z.array(z.string()).min(1, "At least one request type is required"),
  status: z.enum(["received", "in-progress", "completed", "on-hold"]).default("received"),
  workflowPhase: z.enum(["rfp-entry", "invitation-to-bid", "bid-collection", "evaluation", "award"]).default("rfp-entry"),
  receivedOn: z.string().transform((val) => new Date(val)),
  internalDueDate: z.string().transform((val) => new Date(val)),
  contractorDueDate: z.string().optional().transform((val) => val ? new Date(val) : null),
  architectDueDate: z.string().optional().transform((val) => val ? new Date(val) : null),
  dueDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  areaBreakdown: z.array(z.object({
    id: z.string(),
    description: z.string(),
    squareFootage: z.string(),
    notes: z.string().optional()
  })).optional().default([]),
});

export const updateRfpRequestSchema = insertRfpRequestSchema.partial().extend({
  id: z.number(),
  workflowPhase: z.enum(["rfp-entry", "rfp-validation", "invitation-to-bid", "bid-collection", "evaluation", "publish"]).optional(),
  status: z.enum(["received", "in-progress", "completed", "on-hold"]).optional(),
});

export type InsertRfpRequest = z.infer<typeof insertRfpRequestSchema>;
export type UpdateRfpRequest = z.infer<typeof updateRfpRequestSchema>;
export type RfpRequest = typeof rfpRequests.$inferSelect;
// Contacts table for architects and contractors
export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  type: text("type").notNull(), // architect, contractor, consultant
  tags: json("tags").$type<string[]>().default([]), // development, property-management, leasing, etc.
  specialties: json("specialties").$type<string[]>().default([]),
  notes: text("notes"),
  hasSystemAccess: boolean("has_system_access").default(false),
  permissions: json("permissions").$type<Permission[]>().default([]),
  passwordHash: text("password_hash"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Invitations table
export const invitations = pgTable("invitations", {
  id: serial("id").primaryKey(),
  rfpId: serial("rfp_id").references(() => rfpRequests.id).notNull(),
  contactId: serial("contact_id").references(() => contacts.id).notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(), // draft, sent, opened, responded, declined
  sentAt: timestamp("sent_at"),
  respondedAt: timestamp("responded_at"),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Schemas for contacts
export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  type: z.enum(["architect", "contractor", "owner", "other"]),
  tags: z.array(z.string()).default([]),
  specialties: z.array(z.string()).default([]),
  hasSystemAccess: z.boolean().optional(),
});

export const updateContactSchema = insertContactSchema.partial();

// Schemas for invitations
export const insertInvitationSchema = createInsertSchema(invitations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(["draft", "sent", "opened", "responded", "declined"]),
  sentAt: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  respondedAt: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  dueDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
});

export const updateInvitationSchema = insertInvitationSchema.partial().extend({
  id: z.number(),
});

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type UpdateContact = z.infer<typeof updateContactSchema>;

export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type UpdateInvitation = z.infer<typeof updateInvitationSchema>;

// Invitation to Bid data table
export const invitationToBid = pgTable("invitation_to_bid", {
  id: serial("id").primaryKey(),
  rfpId: serial("rfp_id").notNull().references(() => rfpRequests.id),
  projectScope: text("project_scope"),
  projectLocation: text("project_location"),
  estimatedBudget: text("estimated_budget"),
  projectTimeline: text("project_timeline"),
  bidSubmissionDeadline: timestamp("bid_submission_deadline"),
  contractorDueDate: timestamp("contractor_due_date"),
  architectDueDate: timestamp("architect_due_date"),
  projectStartDate: timestamp("project_start_date"),
  projectEndDate: timestamp("project_end_date"),
  specialRequirements: json("special_requirements").$type<string[]>().default([]),
  technicalSpecifications: text("technical_specifications"),
  contractTerms: text("contract_terms"),
  paymentTerms: text("payment_terms"),
  insuranceRequirements: text("insurance_requirements"),
  bondingRequirements: text("bonding_requirements"),
  prequalificationCriteria: json("prequalification_criteria").$type<string[]>().default([]),
  evaluationCriteria: json("evaluation_criteria").$type<string[]>().default([]),
  contactForQuestions: text("contact_for_questions"),
  siteVisitScheduled: timestamp("site_visit_scheduled"),
  additionalDocuments: json("additional_documents").$type<RfpFile[]>().default([]),
  projectDescription: text("project_description"),
  documentsLink: text("documents_link"),
  keyDates: json("key_dates").$type<{label: string, date: string}[]>().default([]),
  scopeOfWork: json("scope_of_work").$type<{description: string, quantity: number, unit: string}[]>().default([]),
  architectMilestones: json("architect_milestones").$type<{description: string}[]>().default([]),
  contractorMilestones: json("contractor_milestones").$type<{description: string}[]>().default([]),
  selectedContractor: text("selected_contractor"),
  selectedArchitect: text("selected_architect"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInvitationToBidSchema = createInsertSchema(invitationToBid).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  projectScope: z.string().default(""),
  projectLocation: z.string().default(""),
  bidSubmissionDeadline: z.union([z.string(), z.null()]).optional().transform((val) => val && typeof val === 'string' && val.trim() ? new Date(val) : new Date()),
  contractorDueDate: z.union([z.string(), z.null()]).optional().transform((val) => val && typeof val === 'string' && val.trim() ? new Date(val) : undefined),
  architectDueDate: z.union([z.string(), z.null()]).optional().transform((val) => val && typeof val === 'string' && val.trim() ? new Date(val) : undefined),
  projectStartDate: z.string().optional().transform((val) => val && val.trim() ? new Date(val) : undefined),
  projectEndDate: z.string().optional().transform((val) => val && val.trim() ? new Date(val) : undefined),
  siteVisitScheduled: z.string().optional().transform((val) => val && val.trim() ? new Date(val) : undefined),
  scopeOfWork: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unit: z.string(),
  })).default([]),
  architectMilestones: z.array(z.object({
    description: z.string(),
  })).default([]),
  contractorMilestones: z.array(z.object({
    description: z.string(),
  })).default([]),
});

export const updateInvitationToBidSchema = insertInvitationToBidSchema.partial();

export type InvitationToBid = typeof invitationToBid.$inferSelect;
export type InsertInvitationToBid = z.infer<typeof insertInvitationToBidSchema>;
export type UpdateInvitationToBid = z.infer<typeof updateInvitationToBidSchema>;

// RFP Generation History table
export const rfpGenerationHistory = pgTable("rfp_generation_history", {
  id: serial("id").primaryKey(),
  rfpId: integer("rfp_id").notNull().references(() => rfpRequests.id),
  generationType: text("generation_type").notNull(), // "contractor" or "architect"
  generatedBy: text("generated_by").notNull(), // user who generated it
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  // Store the data that was used to generate this version
  invitationData: json("invitation_data"),
  // Store the HTML content that was generated
  generatedContent: text("generated_content").notNull(),
  title: text("title").notNull(), // e.g., "Contractor RFP - Bridge Point Gratigny - Dec 27, 2025"
  notes: text("notes"), // Optional notes about this generation
});

export const insertRfpGenerationHistorySchema = createInsertSchema(rfpGenerationHistory).omit({
  id: true,
  generatedAt: true,
});

export type RfpGenerationHistory = typeof rfpGenerationHistory.$inferSelect;
export type InsertRfpGenerationHistory = z.infer<typeof insertRfpGenerationHistorySchema>;

export type RfpFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  path?: string; // For file system storage
};

// Bid Collection tables
export const bidCollections = pgTable("bid_collections", {
  id: serial("id").primaryKey(),
  rfpId: integer("rfp_id").notNull().references(() => rfpRequests.id),
  contractorId: integer("contractor_id").notNull().references(() => contacts.id),
  contractorName: text("contractor_name").notNull(),
  contractorCompany: text("contractor_company").notNull(),
  contractorEmail: text("contractor_email").notNull(),
  submissionDate: timestamp("submission_date").defaultNow().notNull(),
  totalAmount: text("total_amount"),
  status: text("status").notNull().default("received"), // received, under-review, shortlisted, rejected, awarded
  notes: text("notes"),
  attachments: json("attachments").$type<RfpFile[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const bidLineItems = pgTable("bid_line_items", {
  id: serial("id").primaryKey(),
  bidCollectionId: integer("bid_collection_id").notNull().references(() => bidCollections.id),
  category: text("category"), // e.g., "Labor", "Materials", "Equipment" - now optional
  description: text("description").notNull(),
  quantity: text("quantity"),
  unit: text("unit"), // e.g., "sq ft", "lf", "ea"
  unitPrice: text("unit_price"),
  totalPrice: text("total_price").notNull(),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBidCollectionSchema = createInsertSchema(bidCollections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  submissionDate: z.string().optional().transform((val) => val ? new Date(val) : new Date()),
});

export const updateBidCollectionSchema = insertBidCollectionSchema.partial().extend({
  id: z.number(),
});

export const insertBidLineItemSchema = createInsertSchema(bidLineItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateBidLineItemSchema = insertBidLineItemSchema.partial().extend({
  id: z.number(),
});

export type BidCollection = typeof bidCollections.$inferSelect;
export type InsertBidCollection = z.infer<typeof insertBidCollectionSchema>;
export type UpdateBidCollection = z.infer<typeof updateBidCollectionSchema>;

export type BidLineItem = typeof bidLineItems.$inferSelect;
export type InsertBidLineItem = z.infer<typeof insertBidLineItemSchema>;
export type UpdateBidLineItem = z.infer<typeof updateBidLineItemSchema>;

// Simple bay configuration type
export type BayConfiguration = {
  id: string;
  bayName: string; // e.g., "Bay 1-2", "Bay 2-3", etc.
  squareFootage: number;
  standardDockDoors: number; // Count of standard overhead dock doors
  oversizedDockDoors: number; // Count of oversized dock doors
  mechanicalRoomAllocation?: number; // Calculated mechanical room square footage allocation for this bay
  rentableSquareFootage?: number; // Calculated rentable area (squareFootage + mechanicalRoomAllocation)
};

// Properties table
export const properties = pgTable("properties", {
  id: serial("id").primaryKey(),
  propertyName: text("property_name").notNull(),
  building: text("building").notNull(), // A, B, 1, 2, etc.
  isSingleBuilding: boolean("is_single_building").default(false),
  streetAddress: text("street_address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  displayName: text("display_name").notNull(), // Computed field like "Property Name - Building A, 123 Main St, New York, NY 10001"
  bayConfigurations: json("bay_configurations").$type<BayConfiguration[]>().default([]), // Simple bay configurations with square footage
  mechanicalRoomSquareFootage: integer("mechanical_room_square_footage").default(0), // Total mechanical room square footage for allocation
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPropertySchema = createInsertSchema(properties).omit({
  displayName: true,
  createdAt: true,
  updatedAt: true,
});

export const updatePropertySchema = insertPropertySchema.partial().extend({
  id: z.number().optional(),
});

export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type UpdateProperty = z.infer<typeof updatePropertySchema>;

// Evaluation Budget table
export const evaluationBudgets = pgTable("evaluation_budgets", {
  id: serial("id").primaryKey(),
  rfpId: integer("rfp_id").references(() => rfpRequests.id, { onDelete: "cascade" }).notNull(),
  tenantImprovements: json("tenant_improvements").$type<EvaluationLineItem[]>().default([]),
  designSoftCosts: json("design_soft_costs").$type<EvaluationLineItem[]>().default([]),
  existingImprovements: json("existing_improvements").$type<EvaluationLineItem[]>().default([]),
  hasExistingImprovements: boolean("has_existing_improvements").default(false),
  includeExistingInTotal: boolean("include_existing_in_total").default(false),
  separateDesignCosts: boolean("separate_design_costs").default(true),
  totalTenantImprovements: text("total_tenant_improvements"),
  totalDesignSoftCosts: text("total_design_soft_costs"),
  totalExistingImprovements: text("total_existing_improvements"),
  grandTotal: text("grand_total"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lineItemRollups: json("line_item_rollups").$type<Record<string, 'tenantImprovements' | 'designSoftCosts' | 'existingImprovements' | 'tiAndDesign'>>().default({}),
  assemblies: json("assemblies").$type<Record<string, { total: number; components: string[] }>>().default({}),
  metadata: json("metadata").$type<{ oversizedDoors?: number; regularDoors?: number; [key: string]: any }>().default({}),
});

// Evaluation Budget Attachments table
export const evaluationBudgetAttachments = pgTable("evaluation_budget_attachments", {
  id: serial("id").primaryKey(),
  rfpId: integer("rfp_id").references(() => rfpRequests.id, { onDelete: "cascade" }).notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  size: integer("size").notNull(),
  mimeType: text("mime_type").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export const insertEvaluationBudgetAttachmentSchema = createInsertSchema(evaluationBudgetAttachments).omit({
  id: true,
  uploadedAt: true,
});

export type EvaluationBudgetAttachment = typeof evaluationBudgetAttachments.$inferSelect;
export type InsertEvaluationBudgetAttachment = z.infer<typeof insertEvaluationBudgetAttachmentSchema>;

// Evaluation Budget History Table
export const evaluationBudgetHistory = pgTable("evaluation_budget_history", {
  id: serial("id").primaryKey(),
  rfpId: integer("rfp_id").notNull().references(() => rfpRequests.id, { onDelete: "cascade" }),
  reportName: varchar("report_name", { length: 255 }).notNull(),
  generatedBy: varchar("generated_by", { length: 255 }).notNull(),
  generatedContent: text("generated_content").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEvaluationBudgetHistorySchema = createInsertSchema(evaluationBudgetHistory).omit({
  id: true,
  createdAt: true,
});

export type EvaluationBudgetHistory = typeof evaluationBudgetHistory.$inferSelect;
export type InsertEvaluationBudgetHistory = z.infer<typeof insertEvaluationBudgetHistorySchema>;

export type EvaluationLineItem = {
  id: string;
  description: string;
  quantity: number;
  unit: string; // e.g., "sq ft", "lf", "ea"
  unitPrice: string;
  totalPrice: string;
  bidCollectionId?: number; // Reference to original bid if applicable
  bidLineItemId?: number; // Reference to original bid line item if applicable
};

export const insertEvaluationBudgetSchema = createInsertSchema(evaluationBudgets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateEvaluationBudgetSchema = insertEvaluationBudgetSchema.partial().extend({
  id: z.number(),
});

export type EvaluationBudget = typeof evaluationBudgets.$inferSelect;
export type InsertEvaluationBudget = z.infer<typeof insertEvaluationBudgetSchema>;
export type UpdateEvaluationBudget = z.infer<typeof updateEvaluationBudgetSchema>;

// ROM Pilot Tables
export const romPilots = pgTable("rom_pilots", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  property: text("property").notNull(),
  selectedBayConfigurations: json("selected_bay_configurations").$type<BayConfiguration[]>().default([]),
  totalEstimate: text("total_estimate").default("0"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const romScopeItems = pgTable("rom_scope_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  unit: text("unit").notNull(), // "sf", "lf", "ea", etc.
  unitPrice: text("unit_price").notNull(),
  category: text("category").notNull(), // "office", "warehouse", "general", etc.
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const romPilotLineItems = pgTable("rom_pilot_line_items", {
  id: serial("id").primaryKey(),
  romPilotId: integer("rom_pilot_id").notNull(),
  scopeItemId: integer("scope_item_id").notNull(),
  quantity: text("quantity").default("0"),
  unitPrice: text("unit_price").notNull(),
  totalPrice: text("total_price").default("0"),
  notes: text("notes"),
  category: text("category").default("tenant-improvements"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Authentication tokens table for persistent session management
export const authTokens = pgTable("auth_tokens", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

// ROM Pilot Insert/Update Schemas
export const insertRomPilotSchema = createInsertSchema(romPilots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateRomPilotSchema = insertRomPilotSchema.partial().extend({
  id: z.number(),
});

export const insertRomScopeItemSchema = createInsertSchema(romScopeItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateRomScopeItemSchema = insertRomScopeItemSchema.partial().extend({
  id: z.number(),
});

export const insertRomPilotLineItemSchema = createInsertSchema(romPilotLineItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateRomPilotLineItemSchema = insertRomPilotLineItemSchema.partial().extend({
  id: z.number(),
});

// ROM Pilot Types
export type RomPilot = typeof romPilots.$inferSelect;
export type InsertRomPilot = z.infer<typeof insertRomPilotSchema>;
export type UpdateRomPilot = z.infer<typeof updateRomPilotSchema>;

export type RomScopeItem = typeof romScopeItems.$inferSelect;
export type InsertRomScopeItem = z.infer<typeof insertRomScopeItemSchema>;
export type UpdateRomScopeItem = z.infer<typeof updateRomScopeItemSchema>;

export type RomPilotLineItem = typeof romPilotLineItems.$inferSelect;
export type InsertRomPilotLineItem = z.infer<typeof insertRomPilotLineItemSchema>;
export type UpdateRomPilotLineItem = z.infer<typeof updateRomPilotLineItemSchema>;

// User management types
// User management table for admin system
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  username: varchar("username").unique().notNull(),
  email: varchar("email").unique(),
  passwordHash: varchar("password_hash").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role").notNull().default("user"), // admin, manager, user
  isActive: boolean("is_active").default(true),
  permissions: json("permissions").$type<Permission[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Permission = 
  | 'rfp.create' | 'rfp.edit' | 'rfp.delete' | 'rfp.view'
  | 'properties.create' | 'properties.edit' | 'properties.delete' | 'properties.view'
  | 'contacts.create' | 'contacts.edit' | 'contacts.delete' | 'contacts.view'
  | 'reports.view' | 'reports.generate'
  | 'users.create' | 'users.edit' | 'users.delete' | 'users.view'
  | 'admin.access';

export type UserRole = 'admin' | 'manager' | 'user';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'rfp.create', 'rfp.edit', 'rfp.delete', 'rfp.view',
    'properties.create', 'properties.edit', 'properties.delete', 'properties.view',
    'contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.view',
    'reports.view', 'reports.generate',
    'users.create', 'users.edit', 'users.delete', 'users.view',
    'admin.access'
  ],
  manager: [
    'rfp.create', 'rfp.edit', 'rfp.view',
    'properties.create', 'properties.edit', 'properties.view',
    'contacts.create', 'contacts.edit', 'contacts.view',
    'reports.view', 'reports.generate'
  ],
  user: [
    'rfp.view',
    'properties.view',
    'contacts.view',
    'reports.view'
  ]
};

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type UpdateUser = Partial<Omit<User, 'id' | 'createdAt'>>;



