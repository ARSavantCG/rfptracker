/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { pgTable, text, serial, integer, timestamp, json, jsonb, boolean, varchar, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { parseLocalDate } from "./date-utils";

export const rfpRequests = pgTable("rfp_requests", {
  id: serial("id").primaryKey(),
  rfpNumber: text("rfp_number").notNull().unique(),
  
  // Counter offer support
  parentRfpId: integer("parent_rfp_id"), // Reference to original RFP for counter offers
  isCounterOffer: boolean("is_counter_offer").default(false),
  
  // RFP Options support - for multiple design/scope alternatives
  isOption: boolean("is_option").default(false),
  optionType: text("option_type"), // design-alternative, scope-variation, build-option, etc.
  
  // Initial RFP Entry Fields
  property: text("property").notNull(), // Primary property for single-building RFPs
  
  // Multi-building support
  isMultiBuilding: boolean("is_multi_building").default(false),
  properties: json("properties").$type<string[]>(), // Array of property names for multi-building RFPs
  selectedBaysPerBuilding: json("selected_bays_per_building").$type<{[propertyName: string]: BayConfiguration[]}>(),
  costsPerBuilding: json("costs_per_building").$type<{[propertyName: string]: BuildingCosts}>(),
  
  tenantName: text("tenant_name").notNull(),
  projectName: text("project_name").notNull(),
  confidential: boolean("confidential").default(false),
  sentBy: text("sent_by").notNull(),
  receivedOn: timestamp("received_on").notNull(),
  internalDueDate: timestamp("internal_due_date").notNull(),
  responseToBrokerDue: timestamp("response_to_broker_due"),
  contractorDueDate: timestamp("contractor_due_date"),
  architectDueDate: timestamp("architect_due_date"),
  anticipatedLeaseExecutionDate: timestamp("anticipated_lease_execution_date"),
  anticipatedOccupancyDate: timestamp("anticipated_occupancy_date"),
  developmentContact: text("development_contact"),
  projectArea: text("project_area"),
  requestTypes: json("request_types").$type<string[]>().notNull(), // pricing, schedule, space-plan
  
  // System fields
  status: text("status").notNull().default("received"), // received, in-progress, completed, on-hold, archived, cancelled
  workflowPhase: text("workflow_phase").notNull().default("rfp-entry"), // rfp-entry, rfp-validation, invitation-to-bid, bid-collection, evaluation, publish
  notes: text("notes"), // Development Team Notes
  dealMetricNotes: text("deal_metric_notes"), // Deal Metric Notes for finance/metrics team
  files: json("files").$type<RfpFile[]>().notNull().default([]),
  selectedBayConfigurations: json("selected_bay_configurations").$type<BayConfiguration[]>().default([]),
  
  // Bay configuration references for real-time synchronization (new approach)
  propertyId: integer("property_id"), // Foreign key to properties table for single-building RFPs
  selectedBayIds: json("selected_bay_ids").$type<string[]>(), // Array of bay configuration IDs for single-building
  propertyIdsPerBuilding: json("property_ids_per_building").$type<{[propertyName: string]: number}>(), // Property IDs for multi-building
  bayIdsPerBuilding: json("bay_ids_per_building").$type<{[propertyName: string]: string[]}>(), // Bay IDs per building for multi-building
  
  // Validation fields for workflow progression
  isValidated: json("is_validated").default(false).$type<boolean>(),
  validationErrors: json("validation_errors").$type<string[]>().default([]),
  
  // Phase 2: Validation & Progression Fields (populated during validation step)
  generalContractor: text("general_contractor"),
  architect: text("architect"),
  additionalContractors: json("additional_contractors").$type<string[]>().default([]),
  additionalArchitects: json("additional_architects").$type<string[]>().default([]),
  officeAreaExisting: text("office_area_existing"),
  officeAreaNew: text("office_area_new"),
  warehouseArea: text("warehouse_area"),
  warehouseAreaOverride: text("warehouse_area_override"), // Manual override for existing tenant situations
  warehouseNotes: text("warehouse_notes"),
  areaBreakdown: json("area_breakdown").$type<{id: string, areaType: string, description: string, squareFootage: string, notes?: string}[]>().default([]),
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
  
  // Tenant Electrical Allocation (populated during validation step)
  tenantElectricalAllocation: integer("tenant_electrical_allocation"), // Base allocation in AMPS
  tenantElectricalAdditionalRequest: integer("tenant_electrical_additional_request"), // Additional request in AMPS
  tenantElectricalVoltage: text("tenant_electrical_voltage"), // Voltage for base allocation: "480" or "208"
  tenantElectricalAdditionalVoltage: text("tenant_electrical_additional_voltage"), // Voltage for additional request: "480" or "208"
  tenantElectricalUpgradeTiming: text("tenant_electrical_upgrade_timing"), // "immediate" or "future" - transformer upgrade timing
  tenantElectricalNotes: text("tenant_electrical_notes"), // Notes about electrical requirements
  
  // Cancellation tracking
  cancelledAt: timestamp("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
  priorWorkflowPhase: text("prior_workflow_phase"), // phase snapshot for Reinstate

  // Completion tracking
  completedDate: timestamp("completed_date"),
  publishedDate: timestamp("published_date"),

  // Lease status
  isLeased: boolean("is_leased").notNull().default(false),
  leasedAt: timestamp("leased_at"),
  
  // Project folder for file organization (auto-generated, sanitized from project name)
  projectFolder: text("project_folder"),

  // ── Enhanced RFP variant ──────────────────────────────────────────────────
  // All fields below are nullable. They only populate when the Enhanced variant
  // is used. Standard RFPs leave every field here as null.

  // Building context
  buildingPosition: text("building_position"),
  adjacentTenants: text("adjacent_tenants"),
  clearHeight: text("clear_height"),
  sprinklerSpec: text("sprinkler_spec"),
  existingPower: text("existing_power"),
  dockDoorCount: integer("dock_door_count"),
  driveInDoorCount: integer("drive_in_door_count"),
  parkingRatio: text("parking_ratio"),
  bayDimensions: text("bay_dimensions"),

  // Tenant program
  tenantProgramSummary: text("tenant_program_summary"),

  // Schedule targets (stored as timestamps; date-only usage is enforced at UI layer)
  targetLXE: timestamp("target_lxe"),
  targetNTP: timestamp("target_ntp"),
  targetMobilization: timestamp("target_mobilization"),
  targetPermitDrawings: timestamp("target_permit_drawings"),
  targetSubstantialCompletion: timestamp("target_substantial_completion"),
  targetRCD: timestamp("target_rcd"),
  // ─────────────────────────────────────────────────────────────────────────

  // AI intake parser bridge (Step 2 → Step 3): accepted proposals are committed
  // here, and the ITB modal seeds its own scopeOfWork from a fresh RFP fetch.
  // Mirrors invitation_to_bid.scope_of_work row shape. Column is created by a
  // startup migration (startup-migrations.ts) — NOT drizzle-kit push — so it
  // reaches both helium (dev) and Neon (prod) on boot.
  scopeOfWork: json("scope_of_work").$type<{
    description: string,
    quantity: number,
    unit: string,
    masterItemId?: number | null,
    masterItemSnapshot?: { description: string, unit: string, unitPrice: string } | null,
  }[]>().default([]),

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
  property: z.string(), // Explicitly define as string to match database text type
  propertyId: z.number().optional(), // Explicitly define as number
  requestTypes: z.array(z.string()).min(1, "At least one request type is required"),
  status: z.enum(["received", "in-progress", "completed", "on-hold", "archived", "cancelled"]).default("received"),
  workflowPhase: z.enum(["rfp-entry", "rfp-validation", "invitation-to-bid", "bid-collection", "evaluation", "publish"]).default("rfp-entry"),
  // Multi-building support validation
  isMultiBuilding: z.union([z.boolean(), z.string().transform(val => val === 'true')]).optional().default(false),
  properties: z.array(z.string()).optional(),
  selectedBaysPerBuilding: z.record(z.array(z.any())).optional(),
  costsPerBuilding: z.record(z.object({
    existing: z.number().default(0),
    improvements: z.number().default(0),
    rom: z.number().optional(),
    notes: z.string().optional()
  })).optional(),
  receivedOn: z.string().transform((val) => {
    if (!val) return new Date();
    return parseLocalDate(val);
  }),
  internalDueDate: z.string().transform((val) => {
    if (!val) return new Date();
    return parseLocalDate(val);
  }),
  responseToBrokerDue: z.string().optional().transform((val) => val ? parseLocalDate(val) : null),
  contractorDueDate: z.string().optional().transform((val) => val ? parseLocalDate(val) : null),
  architectDueDate: z.string().optional().transform((val) => val ? parseLocalDate(val) : null),
  anticipatedLeaseExecutionDate: z.string().optional().transform((val) => val ? parseLocalDate(val) : null),
  anticipatedOccupancyDate: z.string().optional().transform((val) => val ? parseLocalDate(val) : null),
  dueDate: z.string().optional().transform((val) => val ? parseLocalDate(val) : undefined),
  warehouseAreaOverride: z.string().optional().nullable(),
  areaBreakdown: z.array(z.object({
    id: z.string(),
    areaType: z.string().default("Miscellaneous"), // For backward compatibility
    description: z.string(),
    squareFootage: z.string(),
    notes: z.string().optional()
  })).optional().default([]),
});

export const updateRfpRequestSchema = insertRfpRequestSchema.partial().extend({
  id: z.number(),
  workflowPhase: z.enum(["rfp-entry", "rfp-validation", "invitation-to-bid", "bid-collection", "evaluation", "publish"]).optional(),
  status: z.enum(["received", "in-progress", "completed", "on-hold", "archived", "cancelled"]).optional(),
  completedDate: z.union([z.date(), z.string().transform((val) => val ? new Date(val) : null)]).optional().nullable(),
  publishedDate: z.union([z.date(), z.string().transform((val) => val ? new Date(val) : null)]).optional().nullable(),
  // Schedule target fields: accept Date objects, ISO strings, or null/undefined.
  // drizzle-zod generates z.date() for timestamp() columns which rejects ISO strings from the client.
  targetLXE: z.union([z.date(), z.string().transform((val) => val ? new Date(val) : null)]).optional().nullable(),
  targetNTP: z.union([z.date(), z.string().transform((val) => val ? new Date(val) : null)]).optional().nullable(),
  targetMobilization: z.union([z.date(), z.string().transform((val) => val ? new Date(val) : null)]).optional().nullable(),
  targetPermitDrawings: z.union([z.date(), z.string().transform((val) => val ? new Date(val) : null)]).optional().nullable(),
  targetSubstantialCompletion: z.union([z.date(), z.string().transform((val) => val ? new Date(val) : null)]).optional().nullable(),
  targetRCD: z.union([z.date(), z.string().transform((val) => val ? new Date(val) : null)]).optional().nullable(),
  leasedAt: z.union([z.date(), z.string().transform((val) => val ? new Date(val) : null)]).optional().nullable(),
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
  isActive: boolean("is_active").default(true),
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
  scopeOfWork: json("scope_of_work").$type<{
    description: string,
    quantity: number,
    unit: string,
    // Optional link to the ROM Pilot master scope catalog (rom_scope_items.id).
    // Existing rows predate these fields and will simply lack them — treat as
    // free-typed rows (no catalog link) when absent.
    masterItemId?: number | null,
    masterItemSnapshot?: { description: string, unit: string, unitPrice: string } | null,
  }[]>().default([]),
  architectMilestones: json("architect_milestones").$type<{description: string}[]>().default([]),
  contractorMilestones: json("contractor_milestones").$type<{description: string}[]>().default([]),
  selectedContractor: text("selected_contractor"),
  selectedArchitect: text("selected_architect"),

  // Enhanced RFP variant tracking
  rfpVariant: text("rfp_variant").notNull().default("standard"), // 'standard' | 'enhanced'
  recipientType: text("recipient_type"), // 'gc' | 'architect' — nullable; populated when per-recipient rows are used

  // RFP type selection flags — set true when the corresponding checkbox is checked and the
  // form is saved (standard OR enhanced both set the flag). Used by the workflow-phase
  // validator to condition due-date requirements: a due date is only required when its
  // type was actually selected. Default false preserves the pre-column behaviour for
  // rows that predate this column (backfill handled separately by admin SQL).
  contractorRfpRequired: boolean("contractor_rfp_required").notNull().default(false),
  architectRfpRequired: boolean("architect_rfp_required").notNull().default(false),

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
    masterItemId: z.number().nullable().optional(),
    masterItemSnapshot: z.object({
      description: z.string(),
      unit: z.string(),
      unitPrice: z.string(),
    }).nullable().optional(),
  })).default([]),
  architectMilestones: z.array(z.object({
    description: z.string(),
  })).default([]),
  contractorMilestones: z.array(z.object({
    description: z.string(),
  })).default([]),
  rfpVariant: z.string().default("standard"), // accepts 'standard', 'enhanced', or JSON {"gc":"...","architect":"..."}
  recipientType: z.enum(["gc", "architect"]).optional().nullable(),
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

// Master Categories for standardized cost classification
export const masterCategories = pgTable("master_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMasterCategorySchema = createInsertSchema(masterCategories).omit({
  id: true,
  createdAt: true,
});

export const updateMasterCategorySchema = insertMasterCategorySchema.partial().extend({
  id: z.number(),
});

export type MasterCategory = typeof masterCategories.$inferSelect;
export type InsertMasterCategory = z.infer<typeof insertMasterCategorySchema>;
export type UpdateMasterCategory = z.infer<typeof updateMasterCategorySchema>;

// Project Alternates — Enhanced RFP variant
// Stores the A/B option pairs that appear in an Enhanced RFP document.
// Each row belongs to one RFP (projectId) and can optionally be tied to a
// master cost category for analytics. Standard RFPs will have zero rows here.
export const projectAlternates = pgTable("project_alternates", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: integer("project_id").notNull().references(() => rfpRequests.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  optionA: text("option_a"),
  optionB: text("option_b"),
  masterCategoryId: integer("master_category_id").references(() => masterCategories.id, { onDelete: "set null" }),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => ({
  projectIdIdx: index("project_alternates_project_id_idx").on(table.projectId),
}));

export const insertProjectAlternateSchema = createInsertSchema(projectAlternates).omit({
  id: true,
});

export const updateProjectAlternateSchema = insertProjectAlternateSchema.partial().extend({
  id: z.string().uuid(),
});

export type ProjectAlternate = typeof projectAlternates.$inferSelect;
export type InsertProjectAlternate = z.infer<typeof insertProjectAlternateSchema>;
export type UpdateProjectAlternate = z.infer<typeof updateProjectAlternateSchema>;

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
  costCategory: text("cost_category").notNull().default("construction"), // "architectural", "construction"
  status: text("status").notNull().default("received"), // received, under-review, shortlisted, rejected, awarded
  notes: text("notes"),
  attachments: json("attachments").$type<RfpFile[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Cost bucket options for bid leveling: Office, Warehouse Office, Warehouse, Other
export const costBucketEnum = ["Office", "Warehouse Office", "Warehouse", "Other"] as const;
export type CostBucket = typeof costBucketEnum[number];

export const bidLineItems = pgTable("bid_line_items", {
  id: serial("id").primaryKey(),
  bidCollectionId: integer("bid_collection_id").notNull().references(() => bidCollections.id),
  category: text("category"), // e.g., "Labor", "Materials", "Equipment" - now optional (raw category from contractor)
  description: text("description").notNull(),
  quantity: text("quantity"),
  unit: text("unit"), // e.g., "sq ft", "lf", "ea"
  unitPrice: text("unit_price"),
  totalPrice: text("total_price").notNull(),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  isCleanData: boolean("is_clean_data").notNull().default(false), // Whether this line item has clean, reliable pricing for benchmarking
  masterCategoryId: integer("master_category_id").references(() => masterCategories.id), // Standardized category for analytics
  costBucket: text("cost_bucket"), // Office, Warehouse Office, Warehouse, Other - for bid leveling
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const bidAlternates = pgTable("bid_alternates", {
  id: serial("id").primaryKey(),
  bidCollectionId: integer("bid_collection_id").notNull().references(() => bidCollections.id),
  title: text("title").notNull().default(""),
  description: text("description").notNull(),
  cost: text("cost").notNull(),
  includeInEvaluation: boolean("include_in_evaluation").notNull().default(false),
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
  costCategory: z.enum(["architectural", "construction"]).default("construction"),
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

export const insertBidAlternateSchema = createInsertSchema(bidAlternates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateBidAlternateSchema = insertBidAlternateSchema.partial().extend({
  id: z.number(),
});

export type BidCollection = typeof bidCollections.$inferSelect;
export type InsertBidCollection = z.infer<typeof insertBidCollectionSchema>;
export type UpdateBidCollection = z.infer<typeof updateBidCollectionSchema>;

export type BidLineItem = typeof bidLineItems.$inferSelect;
export type InsertBidLineItem = z.infer<typeof insertBidLineItemSchema>;
export type UpdateBidLineItem = z.infer<typeof updateBidLineItemSchema>;

export type BidAlternate = typeof bidAlternates.$inferSelect;
export type InsertBidAlternate = z.infer<typeof insertBidAlternateSchema>;
export type UpdateBidAlternate = z.infer<typeof updateBidAlternateSchema>;

// Simple bay configuration type
// Building-specific cost tracking for multi-building RFPs
export type BuildingCosts = {
  existing: number; // Existing building costs
  improvements: number; // Building improvement costs
  rom?: number; // ROM (Rough Order of Magnitude) costs
  notes?: string; // Cost notes specific to this building
};

export type BayConfiguration = {
  id: string;
  bayName: string; // e.g., "Bay 1-2", "Bay 2-3", etc.
  squareFootage: number;
  standardDockDoors: number; // Count of standard overhead dock doors
  oversizedDockDoors: number; // Count of oversized dock doors
  mechanicalRoomAllocation?: number; // Calculated mechanical room square footage allocation for this bay
  rentableSquareFootage?: number; // Calculated rentable area (squareFootage + mechanicalRoomAllocation)
  hasStorefrontEntry?: boolean; // Whether this bay has storefront entry door(s)
  hasSpeculativeOffice?: boolean; // Whether this bay has speculative office space
  officeSquareFootage?: number; // SF of the office portion within this bay (single source of truth for office area; a portion of squareFootage, not the whole bay)
  hasRestroom?: boolean; // Whether this bay has restroom facilities
  
  // Cross-dock splitting support - controlled per bay
  canBeSplit?: boolean; // Whether this bay can be split into north/south halves for RFP selection
  splitNorthDockDoors?: number; // How many dock doors would be on north side if split
  splitSouthDockDoors?: number; // How many dock doors would be on south side if split
  splitNorthOversizedDoors?: number; // How many oversized doors on north side if split
  splitSouthOversizedDoors?: number; // How many oversized doors on south side if split
  splitNorthSquareFootage?: string; // Square footage for north half (can be formula)
  splitSouthSquareFootage?: string; // Square footage for south half (can be formula)
  
  // Split bay amenities
  splitNorthStorefront?: boolean; // Whether north half has storefront entry
  splitSouthStorefront?: boolean; // Whether south half has storefront entry
  splitNorthOffice?: boolean; // Whether north half has speculative office
  splitSouthOffice?: boolean; // Whether south half has speculative office
  splitNorthOfficeSquareFootage?: number; // Office SF within the north half (portion of splitNorthSquareFootage)
  splitSouthOfficeSquareFootage?: number; // Office SF within the south half (portion of splitSouthSquareFootage)
  splitNorthRestroom?: boolean; // Whether north half has restroom
  splitSouthRestroom?: boolean; // Whether south half has restroom
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
  
  // Directional orientation configuration
  firstBayDirection: text("first_bay_direction"), // "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"
  bayProgressionDirection: text("bay_progression_direction"), // "north", "south", "east", "west"
  
  standardParking: integer("standard_parking").default(0),
  accessibleParking: integer("accessible_parking").default(0),
  evParking: integer("ev_parking").default(0),
  trailerParking: integer("trailer_parking").default(0),
  
  // Electrical Allocation
  electricalAllocation: integer("electrical_allocation").default(0), // Total electrical allocation in amps
  electricalAllocationIncrement: integer("electrical_allocation_increment").default(200), // Increment for tenant allocation rounding (default 200 AMPS)
  
  // Building Specifications
  buildingDepth: integer("building_depth"), // Building depth in feet (used for demising wall calculations)
  slabThickness: text("slab_thickness"), // e.g., "6 inches @ 4000 PSI"
  clearHeight: text("clear_height"), // e.g., "32 feet"
  floorFlatness: text("floor_flatness"), // FF/FL values e.g., "FF 25 / FL 20"
  truckApronSlab: text("truck_apron_slab"), // e.g., "8 inches @ 4000 PSI"
  rampCapacity: text("ramp_capacity"), // e.g., "80,000 lbs"
  roofRValue: text("roof_r_value"), // e.g., "R-30"
  firePumpInfo: text("fire_pump_info"), // e.g., "1500 GPM @ 100 PSI"
  fireSprinklerInfo: text("fire_sprinkler_info"), // e.g., "Standard ESFR system"
  
  // Display ordering for alphabetical organization
  displayOrder: integer("display_order"),
  
  // Land Lease Information
  isLandLease: boolean("is_land_lease").default(false), // Whether property is on a land lease vs outright ownership
  beneficialOccupancyDate: timestamp("beneficial_occupancy_date"), // Date of beneficial occupancy for land lease
  leaseExpirationDate: timestamp("lease_expiration_date"), // Land lease expiration date
  leaseExtensions: text("lease_extensions"), // Description of lease extension options, e.g., "2 x 10-year options"
  
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

// Electrical Capacity Management System
// Transformers table - tracks FPL-provided transformers per property
export const transformers = pgTable("transformers", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  transformerName: text("transformer_name").notNull(), // e.g., "Main Transformer", "Secondary Transformer"
  totalCapacityKva: integer("total_capacity_kva").notNull(), // Total transformer capacity in kVA
  fplId: text("fpl_id"), // FPL transformer identification
  installationDate: timestamp("installation_date"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Main Panels table - electrical panels connected to transformers
export const mainPanels = pgTable("main_panels", {
  id: serial("id").primaryKey(),
  transformerId: integer("transformer_id").notNull().references(() => transformers.id, { onDelete: "cascade" }),
  panelName: text("panel_name").notNull(), // e.g., "Panel A", "Main Panel 1"
  maxCapacityKva: integer("max_capacity_kva").notNull(), // Panel's maximum capacity in kVA
  capacityAmps: integer("capacity_amps"), // Panel's capacity in AMPS (optional, can be entered directly or calculated)
  voltage: text("voltage").default("480"), // Voltage configuration: "480", "208", "240" - defaults to 480V 3-phase
  panelLocation: text("panel_location"), // Physical location description
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Bay Panel Assignments - associates tenant bays with main panels
export const bayPanelAssignments = pgTable("bay_panel_assignments", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  bayId: text("bay_id").notNull(), // References BayConfiguration.id
  mainPanelId: integer("main_panel_id").notNull().references(() => mainPanels.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Electrical Reservations - tracks both hard allocations and soft holds
export const electricalReservations = pgTable("electrical_reservations", {
  id: serial("id").primaryKey(),
  transformerId: integer("transformer_id").notNull().references(() => transformers.id, { onDelete: "cascade" }),
  rfpId: integer("rfp_id").references(() => rfpRequests.id, { onDelete: "cascade" }), // For soft holds
  tenantName: text("tenant_name").notNull(),
  reservedKva: integer("reserved_kva").notNull(), // kVA reserved for this tenant
  reservationType: text("reservation_type").notNull(), // "hard_allocation" (signed lease) or "soft_hold" (pending RFP)
  reservationDate: timestamp("reservation_date").defaultNow().notNull(),
  releaseDate: timestamp("release_date"), // When reservation was released
  isActive: boolean("is_active").default(true),
  notes: text("notes"),
  createdBy: text("created_by").notNull(), // User who created the reservation
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Create insert schemas for electrical capacity tables
export const insertTransformerSchema = createInsertSchema(transformers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  installationDate: z.string().optional().transform((val) => val && val.trim() ? new Date(val) : undefined),
});

export const insertMainPanelSchema = createInsertSchema(mainPanels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBayPanelAssignmentSchema = createInsertSchema(bayPanelAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertElectricalReservationSchema = createInsertSchema(electricalReservations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  reservationDate: z.string().optional().transform((val) => val && val.trim() ? new Date(val) : new Date()),
  releaseDate: z.string().optional().transform((val) => val && val.trim() ? new Date(val) : undefined),
  reservationType: z.enum(["hard_allocation", "soft_hold"]),
});

// Update schemas
export const updateTransformerSchema = insertTransformerSchema.partial().extend({
  id: z.number(),
});

export const updateMainPanelSchema = insertMainPanelSchema.partial().extend({
  id: z.number().optional(),
});

export const updateElectricalReservationSchema = insertElectricalReservationSchema.partial().extend({
  id: z.number(),
});

// Export types
export type Transformer = typeof transformers.$inferSelect;
export type InsertTransformer = z.infer<typeof insertTransformerSchema>;
export type UpdateTransformer = z.infer<typeof updateTransformerSchema>;

export type MainPanel = typeof mainPanels.$inferSelect;
export type InsertMainPanel = z.infer<typeof insertMainPanelSchema>;
export type UpdateMainPanel = z.infer<typeof updateMainPanelSchema>;

export type BayPanelAssignment = typeof bayPanelAssignments.$inferSelect;
export type InsertBayPanelAssignment = z.infer<typeof insertBayPanelAssignmentSchema>;

export type ElectricalReservation = typeof electricalReservations.$inferSelect;
export type InsertElectricalReservation = z.infer<typeof insertElectricalReservationSchema>;
export type UpdateElectricalReservation = z.infer<typeof updateElectricalReservationSchema>;

// Property Existing Improvements table
export const propertyExistingImprovements = pgTable("property_existing_improvements", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),
  category: text("category").notNull(), // lighting, restrooms, spec-office, hvac, fire-alarm, demising-wall, custom
  description: text("description").notNull(),
  totalCost: integer("total_cost").notNull(), // Computed total cost in cents (forecast + committed + actuals)
  allocationType: text("allocation_type").notNull(), // "prorated", "bay-specific", "whole-property", "demising-wall"
  allocationValue: integer("allocation_value"), // For percentage-based or custom allocations
  units: text("units"), // Units for the allocation (sf, percentage, etc.)
  areaSf: integer("area_sf"), // Optional improvement-specific area in SF (e.g., office buildout SF). Used for $/SF on the Costs-in-Place report; when null, whole-property items fall back to the property's derived rentable SF.
  denominatorBasis: text("denominator_basis"), // Optional override for Costs-in-Place $/SF basis ('own-area' | 'warehouse-net' | 'whole-property' | 'none'). Null = category default.
  
  // For bay-specific items - which bays this improvement applies to
  applicableBays: json("applicable_bays").$type<string[]>().default([]), // Array of bay IDs
  
  // Demising wall specific fields
  demisingWallData: json("demising_wall_data").$type<{
    leftBayId?: string;
    rightBayId?: string;
    leftPercentage?: number;
    rightPercentage?: number;
    wallLocation?: string; // description of wall location
  }>(),
  
  // Per-stage cost tracking (in cents for precision)
  // Each improvement tracks costs across all three lifecycle stages
  forecastCost: integer("forecast_cost").default(0).notNull(), // Budget/projected cost in cents
  committedCost: integer("committed_cost").default(0).notNull(), // Contracted cost in cents
  actualsCost: integer("actuals_cost").default(0).notNull(), // Paid/spent cost in cents
  
  // Legacy bucket field - kept for backward compatibility during migration
  // New records should use the per-stage cost fields above
  bucket: text("bucket").notNull().default("ACTUALS"), // 'ACTUALS', 'COMMITTED', 'FORECAST', or 'PIPELINE' (legacy)
  drawCaptured: boolean("draw_captured").default(false).notNull(), // True when included in lender draw
  originalCommitment: integer("original_commitment"), // Initial commitment amount in cents (for pipeline items)
  addedAmount: integer("added_amount"), // Additional amounts/change orders in cents (for pipeline items)
  drawRef: text("draw_ref"), // Draw number or reference when captured
  
  // Additional metadata
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPropertyExistingImprovementSchema = createInsertSchema(propertyExistingImprovements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  totalCost: z.number().min(0),
  areaSf: z.number().int().min(0).nullable().optional(),
  denominatorBasis: z.enum(['own-area', 'warehouse-net', 'whole-property', 'none']).nullable().optional(),
  // Per-stage cost fields (in cents)
  forecastCost: z.number().min(0).default(0),
  committedCost: z.number().min(0).default(0),
  actualsCost: z.number().min(0).default(0),
  // Legacy bucket field - kept for backward compatibility
  bucket: z.enum(["ACTUALS", "COMMITTED", "FORECAST", "PIPELINE"]).default("ACTUALS"),
  drawCaptured: z.boolean().default(false),
  originalCommitment: z.number().min(0).optional(),
  addedAmount: z.number().min(0).optional(),
  drawRef: z.string().optional(),
  demisingWallData: z.object({
    leftBayId: z.string().optional(),
    rightBayId: z.string().optional(),
    leftPercentage: z.number().min(0).max(100).optional(),
    rightPercentage: z.number().min(0).max(100).optional(),
    wallLocation: z.string().optional(),
  }).optional(),
});

export const updatePropertyExistingImprovementSchema = insertPropertyExistingImprovementSchema.partial().extend({
  id: z.number(),
});

export type PropertyExistingImprovement = typeof propertyExistingImprovements.$inferSelect;
export type InsertPropertyExistingImprovement = z.infer<typeof insertPropertyExistingImprovementSchema>;
export type UpdatePropertyExistingImprovement = z.infer<typeof updatePropertyExistingImprovementSchema>;

// Existing improvement categories
export const EXISTING_IMPROVEMENT_CATEGORIES = {
  lighting: 'Lighting',
  restrooms: 'Restrooms', 
  'spec-office': 'Spec Office',
  hvac: 'HVAC (Ventilation)',
  'fire-alarm': 'Fire Alarm',
  'demising-wall': 'Demising Wall',
  custom: 'Custom'
} as const;

export const ALLOCATION_TYPES = {
  prorated: 'Prorated by Square Footage',
  'bay-specific': 'Bay-Specific',
  'whole-property': 'Whole Property',
  'demising-wall': 'Demising Wall (50/50 Split)'
} as const;

// $/SF denominator basis for the Costs-in-Place report. Determines what area an
// improvement's cost is divided by:
//   own-area      → the improvement's own areaSf (e.g. a specific office buildout)
//   warehouse-net → rentable SF minus total office SF (warehouse-floor systems
//                   like LED lighting that don't cover the offices, which have
//                   their own fixtures)
//   whole-property→ full rentable SF (building-wide systems: fire alarm, etc.)
//   none          → no meaningful $/SF (demising walls)
export const DENOMINATOR_BASES = {
  'own-area': 'Own Area (entered SF)',
  'warehouse-net': 'Warehouse (rentable − office)',
  'whole-property': 'Whole Property',
  'none': 'Not Applicable',
} as const;

export type DenominatorBasis = keyof typeof DENOMINATOR_BASES;

// Smart default basis per category. Warehouse-floor systems net out office area;
// building-wide systems use the full footprint; demising walls get no $/SF.
// spec-office uses its own entered area. Overridable per-item via
// property_existing_improvements.denominator_basis when set.
export const DEFAULT_DENOMINATOR_BASIS_BY_CATEGORY: Record<string, DenominatorBasis> = {
  lighting: 'warehouse-net',
  hvac: 'warehouse-net',
  'spec-office': 'own-area',
  restrooms: 'whole-property',
  'fire-alarm': 'whole-property',
  'demising-wall': 'none',
  custom: 'whole-property',
};

export function resolveDenominatorBasis(
  category: string,
  override?: string | null,
  allocationType?: string | null,
): DenominatorBasis {
  // Demising walls never get a $/SF regardless of category default.
  if (allocationType === 'demising-wall' || category === 'demising-wall') return 'none';
  if (override && override in DENOMINATOR_BASES) return override as DenominatorBasis;
  return DEFAULT_DENOMINATOR_BASIS_BY_CATEGORY[category] ?? 'whole-property';
}

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
  changeSummary: text("change_summary").array().default([]),
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

// Executed Leases Table
export const executedLeases = pgTable("executed_leases", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  assignedBays: text("assigned_bays").array().notNull().default([]), // Bay IDs like ["A1", "A2", "B3"]
  
  // Essential lease information for space management only (no financial data)
  leaseStartDate: timestamp("lease_start_date"),
  leaseEndDate: timestamp("lease_end_date"),
  rentableSquareFootage: integer("rentable_square_footage"), // Actual leased square footage for space management
  bayNumbers: text("bay_numbers"), // Human readable bay numbers (e.g., "Bay 1-2, Bay 3-4")
  
  // Override and parking allocation
  rentableAreaOverride: integer("rentable_area_override"), // Override calculated area with actual lease terms
  standardParking: integer("standard_parking").default(0),
  accessibleParking: integer("accessible_parking").default(0),
  evParking: integer("ev_parking").default(0),
  trailerParking: integer("trailer_parking").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertExecutedLeaseSchema = createInsertSchema(executedLeases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ExecutedLease = typeof executedLeases.$inferSelect;
export type InsertExecutedLease = z.infer<typeof insertExecutedLeaseSchema>;

export type EvaluationLineItem = {
  id: string;
  description: string;
  quantity: number;
  unit: string; // e.g., "sq ft", "lf", "ea"
  unitPrice: string;
  totalPrice: string;
  tenantShare: number; // Percentage of cost attributed to tenant (0-100)
  bidCollectionId?: number; // Reference to original bid if applicable
  bidLineItemId?: number; // Reference to original bid line item if applicable
  bucket?: 'ACTUALS' | 'COMMITTED' | 'FORECAST' | 'PIPELINE'; // Cost lifecycle bucket for existing improvements
  // Controlled vocabulary fields — added May 2026
  // masterItemId=null means "Other" (custom free-text entry)
  masterItemId?: number | null;
  masterItemSnapshot?: {
    description: string;
    csiDivision?: string;
    unit: string;
    unitPrice: string;
  } | null; // captured at selection time; null when masterItemId is null
  customDescription?: string | null; // populated when masterItemId=null ("Other" entries)
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
  romNumber: text("rom_number").unique(),
  projectName: text("project_name").notNull(),
  property: text("property").notNull(),
  selectedBayConfigurations: json("selected_bay_configurations").$type<BayConfiguration[]>().default([]),
  totalEstimate: text("total_estimate").default("0"),
  notes: text("notes"),
  status: text("status").default("draft"), // draft, active, archived
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
  minimumCost: text("minimum_cost"), // Minimum total cost regardless of quantity
  hasMinimumCost: boolean("has_minimum_cost").default(false), // Enable/disable minimum cost logic
  // How this item's quantity is derived in RFP evaluations. Replaces brittle
  // description-matching (e.g. "if name has 'builder' + 'risk' → qty = TI total").
  // null/'manual' = quantity is entered by hand and preserved.
  calculationBasis: text("calculation_basis"), // 'lump-sum' | 'pct-ti-total' | 'pct-construction-total' | 'pct-rentable-sf' | 'manual'
  category: text("category").notNull(), // "office", "warehouse", "general", etc.
  // CSI (Construction Specifications Institute) Division codes for grouping
  csiDivision: text("csi_division"), // e.g., "16 - Electrical", "22 - Plumbing", "26 - Electrical (MasterFormat)"
  csiCode: text("csi_code"), // User-assigned specific CSI code, e.g., "16-0001", "26 05 00"
  source: text("source"), // Who provided the price
  lastUpdated: timestamp("last_updated"), // When the price was last updated
  isActive: boolean("is_active").default(true),
  includeByDefault: boolean("include_by_default").default(false), // Auto-include in new ROMs
  attachments: json("attachments").$type<RfpFile[]>().default([]),
  // Reference pricing for quarterly contractor verification (not used in ROMs/Evaluations)
  referencePricing: json("reference_pricing").$type<{contractorName: string, price: string, date: string}[]>().default([]),
  // Tiered pricing metadata for automatic tier selection
  itemGroup: text("item_group"), // e.g., "Office Area", "Warehouse Office" - groups related tiers together
  minSquareFootage: integer("min_square_footage"), // Minimum square footage for this tier (null = no minimum)
  maxSquareFootage: integer("max_square_footage"), // Maximum square footage for this tier (null = no maximum)
  // Quarterly pricing intelligence fields
  pricingMode: text("pricing_mode").default('average'), // 'average' | 'contractor' | 'manual'
  selectedContractorName: text("selected_contractor_name"), // which contractor's price to use when mode is 'contractor'
  manualOverridePrice: text("manual_override_price"), // manual price when mode is 'manual'
  manualOverrideReason: text("manual_override_reason"), // why override was set
  activePrice: text("active_price"), // computed price used in ROMs (average, contractor, or manual)
  priceSpreadPercent: text("price_spread_percent"), // spread % across contractor quotes
  lastQuarterlyUpdate: timestamp("last_quarterly_update"), // when pricing was last refreshed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// How a catalog item's quantity is derived in RFP evaluations. Set on the catalog
// item so the relationship is explicit and data-driven — no more description-matching.
export const CALCULATION_BASES = {
  'manual': 'Manual (enter quantity by hand)',
  'lump-sum': 'Lump Sum (quantity = 1)',
  'pct-ti-total': '% of TI Total',
  'pct-construction-total': '% of Construction Total',
  'pct-rentable-sf': 'Per Rentable SF',
} as const;

export type CalculationBasis = keyof typeof CALCULATION_BASES;

export const scopeItemContractorPricing = pgTable("scope_item_contractor_pricing", {
  id: serial("id").primaryKey(),
  scopeItemId: integer("scope_item_id").notNull().references(() => romScopeItems.id),
  contractorId: integer("contractor_id").references(() => contacts.id),
  contractorName: text("contractor_name").notNull(),
  price: text("price").notNull(),
  unit: text("unit").notNull(),
  quotedDate: timestamp("quoted_date").notNull(),
  quarter: text("quarter").notNull(), // e.g. 'Q1 2026'
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const romPilotLineItems = pgTable("rom_pilot_line_items", {
  id: serial("id").primaryKey(),
  romPilotId: integer("rom_pilot_id").notNull(),
  scopeItemId: integer("scope_item_id").notNull(),
  quantity: text("quantity").default("0"),
  unitPrice: text("unit_price").notNull(),
  totalPrice: text("total_price").default("0"),
  tenantShare: integer("tenant_share").default(100), // Percentage of cost attributed to tenant (0-100)
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

export const insertScopeItemContractorPricingSchema = createInsertSchema(scopeItemContractorPricing).omit({
  id: true,
  createdAt: true,
});

export const updateScopeItemContractorPricingSchema = insertScopeItemContractorPricingSchema.partial().extend({
  id: z.number(),
});

export type ScopeItemContractorPricing = typeof scopeItemContractorPricing.$inferSelect;
export type InsertScopeItemContractorPricing = z.infer<typeof insertScopeItemContractorPricingSchema>;

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

// ============================================================================
// SCOPE BUNDLES — named, reusable groups of catalog scope items (e.g.
// "Acclimatize Warehouse", "Demising Wall + Cascade"). A bundle is an
// "add these N at once" template: when pulled/expanded it drops in its
// component items as SEPARATE line items (never a lumped package line).
// Bundles reference catalog items by ID so pricing stays single-source.
// See DESIGN-scope-bundles.md.
// ============================================================================
export const scopeBundles = pgTable("scope_bundles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),                 // e.g. "Acclimatize Warehouse"
  description: text("description"),
  category: text("category"),                    // optional grouping, e.g. "warehouse"
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Join: which catalog items belong to a bundle, with optional default quantity.
export const scopeBundleItems = pgTable("scope_bundle_items", {
  id: serial("id").primaryKey(),
  bundleId: integer("bundle_id").notNull().references(() => scopeBundles.id),
  scopeItemId: integer("scope_item_id").notNull().references(() => romScopeItems.id),
  defaultQuantity: text("default_quantity"),     // optional; null = fill at use time
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertScopeBundleSchema = createInsertSchema(scopeBundles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateScopeBundleSchema = insertScopeBundleSchema.partial().extend({
  id: z.number(),
});
export const insertScopeBundleItemSchema = createInsertSchema(scopeBundleItems).omit({
  id: true,
  createdAt: true,
});

export type ScopeBundle = typeof scopeBundles.$inferSelect;
export type InsertScopeBundle = z.infer<typeof insertScopeBundleSchema>;
export type ScopeBundleItem = typeof scopeBundleItems.$inferSelect;
export type InsertScopeBundleItem = z.infer<typeof insertScopeBundleItemSchema>;

// ============================================================================
// AI INTAKE PARSER — reads Step-1 intake (files/email/text), proposes scope.
// See DESIGN-ai-intake-parser.md.
//
// scope_inference_rules = the editable CRE knowledge (the crown jewel). Admin
// curates these; the AI prompt reads active rules at request time. NOT hardcoded.
// intake_proposals = the AI's proposed scope items per RFP, reviewed in Step 2.
// ============================================================================
export const scopeInferenceRules = pgTable("scope_inference_rules", {
  id: serial("id").primaryKey(),
  triggerType: text("trigger_type").notNull(),   // 'keyword' | 'condition'
  triggerValue: text("trigger_value").notNull(), // e.g. "partial building", "demising wall", "office"
  impliedScope: text("implied_scope").notNull(), // what to propose (comma/JSON list of item names or a description)
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const intakeProposals = pgTable("intake_proposals", {
  id: serial("id").primaryKey(),
  rfpId: integer("rfp_id").notNull(),
  description: text("description").notNull(),          // proposed scope item
  catalogItemId: integer("catalog_item_id"),          // nullable; set when matched to a catalog item
  matchType: text("match_type").notNull().default("needs-mapping"), // 'catalog-match' | 'needs-mapping'
  confidence: text("confidence"),                     // 'high' | 'medium' | 'low' (or a number as text)
  reason: text("reason"),                             // why proposed ("RFP is for suite 200 only")
  sourceRef: text("source_ref"),                      // which file/field it came from
  status: text("status").notNull().default("proposed"), // 'proposed' | 'accepted' | 'rejected' | 'edited'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertScopeInferenceRuleSchema = createInsertSchema(scopeInferenceRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateScopeInferenceRuleSchema = insertScopeInferenceRuleSchema.partial().extend({
  id: z.number(),
});
export const insertIntakeProposalSchema = createInsertSchema(intakeProposals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ScopeInferenceRule = typeof scopeInferenceRules.$inferSelect;
export type InsertScopeInferenceRule = z.infer<typeof insertScopeInferenceRuleSchema>;
export type IntakeProposal = typeof intakeProposals.$inferSelect;
export type InsertIntakeProposal = z.infer<typeof insertIntakeProposalSchema>;
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
  | 'rom.create' | 'rom.edit' | 'rom.delete' | 'rom.view'
  | 'admin.access';

export type UserRole = 'admin' | 'manager' | 'user';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'rfp.create', 'rfp.edit', 'rfp.delete', 'rfp.view',
    'properties.create', 'properties.edit', 'properties.delete', 'properties.view',
    'contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.view',
    'reports.view', 'reports.generate',
    'users.create', 'users.edit', 'users.delete', 'users.view',
    'rom.create', 'rom.edit', 'rom.delete', 'rom.view',
    'admin.access'
  ],
  manager: [
    'rfp.create', 'rfp.edit', 'rfp.view',
    'properties.create', 'properties.edit', 'properties.view',
    'contacts.create', 'contacts.edit', 'contacts.view',
    'reports.view', 'reports.generate',
    'rom.create', 'rom.edit', 'rom.delete', 'rom.view'
  ],
  user: [
    'rfp.view',
    'properties.view',
    'contacts.view',
    'reports.view',
    'rom.view'
  ]
};

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type UpdateUser = Partial<Omit<User, 'id' | 'createdAt'>>;

// PDF Templates for customizable RFP content
export const pdfTemplates = pgTable("pdf_templates", {
  id: serial("id").primaryKey(),
  templateKey: text("template_key").notNull().unique(), // e.g., "broker_architect_intro", "contractor_deliverables"
  templateName: text("template_name").notNull(), // Human readable name
  templateType: text("template_type").notNull(), // "broker-architect", "broker-contractor", "architect", "contractor"
  section: text("section").notNull(), // "introduction", "deliverables", "pricing_considerations", etc.
  content: text("content").notNull(), // The actual HTML/text content
  description: text("description"), // Optional description for admin
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPdfTemplateSchema = createInsertSchema(pdfTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PdfTemplate = typeof pdfTemplates.$inferSelect;
export type InsertPdfTemplate = z.infer<typeof insertPdfTemplateSchema>;

// Property Attachments table for storing PDFs and DWG files
export const propertyAttachments = pgTable("property_attachments", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  size: integer("size").notNull(),
  mimeType: text("mime_type").notNull(),
  fileType: text("file_type").notNull(), // "pdf", "dwg", "other"
  description: text("description"), // Optional description of the file
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export const insertPropertyAttachmentSchema = createInsertSchema(propertyAttachments).omit({
  id: true,
  uploadedAt: true,
});

export type PropertyAttachment = typeof propertyAttachments.$inferSelect;
export type InsertPropertyAttachment = z.infer<typeof insertPropertyAttachmentSchema>;

// Project Files table for tracking files per workflow step
export const projectFiles = pgTable("project_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => rfpRequests.id, { onDelete: "cascade" }).notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  workflowStep: text("workflow_step").notNull(), // Step_1_Entry, Step_2_Validation, etc. or integer as string
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  uploadedBy: text("uploaded_by"),
  subfolder: text("subfolder"), // Optional subfolder like Architect_Docs, GC_Docs
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export const insertProjectFileSchema = createInsertSchema(projectFiles).omit({
  id: true,
  uploadedAt: true,
});

export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;

// Bid Leveling Adjustments - stores manual adjustments (plugs) per bucket per GC
export const bidLevelingAdjustments = pgTable("bid_leveling_adjustments", {
  id: serial("id").primaryKey(),
  rfpId: integer("rfp_id").references(() => rfpRequests.id, { onDelete: "cascade" }).notNull(),
  bidCollectionId: integer("bid_collection_id").references(() => bidCollections.id, { onDelete: "cascade" }).notNull(),
  costBucket: text("cost_bucket").notNull(), // Office, Warehouse Office, Warehouse, Other
  adjustmentAmount: integer("adjustment_amount").notNull().default(0), // Stored in cents for precision
  adjustmentReason: text("adjustment_reason"), // Description of why adjustment was made (e.g., "Pit Levelers", "Fans")
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBidLevelingAdjustmentSchema = createInsertSchema(bidLevelingAdjustments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BidLevelingAdjustment = typeof bidLevelingAdjustments.$inferSelect;
export type InsertBidLevelingAdjustment = z.infer<typeof insertBidLevelingAdjustmentSchema>;

// Evaluation Bid Carry - stores selected bidder data for Step 5 with original/adjustment/carried prices
export const evaluationBidCarry = pgTable("evaluation_bid_carry", {
  id: serial("id").primaryKey(),
  rfpId: integer("rfp_id").references(() => rfpRequests.id, { onDelete: "cascade" }).notNull(),
  selectedBidCollectionId: integer("selected_bid_collection_id").references(() => bidCollections.id).notNull(),
  costBucket: text("cost_bucket").notNull(), // Office, Warehouse Office, Warehouse, Other
  originalTotal: integer("original_total").notNull().default(0), // GC's raw bid total in cents
  adjustmentAmount: integer("adjustment_amount").notNull().default(0), // Plugs/adjustments in cents
  carriedPrice: integer("carried_price").notNull().default(0), // Final price carried to Step 5 (can be overridden)
  isOverridden: boolean("is_overridden").notNull().default(false), // Whether user manually overrode carried price
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEvaluationBidCarrySchema = createInsertSchema(evaluationBidCarry).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type EvaluationBidCarry = typeof evaluationBidCarry.$inferSelect;
export type InsertEvaluationBidCarry = z.infer<typeof insertEvaluationBidCarrySchema>;

// PDF Mapping Templates - stores learned contractor-specific PDF column mappings
export const pdfMappingTemplates = pgTable("pdf_mapping_templates", {
  id: serial("id").primaryKey(),
  contractorId: integer("contractor_id").references(() => contacts.id, { onDelete: "cascade" }),
  templateName: text("template_name").notNull(),
  headerSignature: text("header_signature"), // Normalized header string for auto-matching
  columnCount: integer("column_count"),
  sampleHeaders: json("sample_headers").$type<string[]>(), // Original headers from PDF
  mapping: json("mapping").$type<{
    description?: number;
    quantity?: number;
    unit?: number;
    unitPrice?: number;
    totalPrice?: number;
  }>().notNull(),
  isDefault: boolean("is_default").default(false), // If true, use as fallback when no match found
  usageCount: integer("usage_count").default(0), // Track how often this template is used
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPdfMappingTemplateSchema = createInsertSchema(pdfMappingTemplates).omit({
  id: true,
  usageCount: true,
  createdAt: true,
  updatedAt: true,
});

export type PdfMappingTemplate = typeof pdfMappingTemplates.$inferSelect;
export type InsertPdfMappingTemplate = z.infer<typeof insertPdfMappingTemplateSchema>;

// ── Project Actuals & Historical Intelligence ────────────────────────────────

export const projectActuals = pgTable("project_actuals", {
  id: serial("id").primaryKey(),
  rfpId: integer("rfp_id").references(() => rfpRequests.id),
  projectName: text("project_name").notNull(),
  tenantName: text("tenant_name").notNull(),
  propertyName: text("property_name").notNull(),
  completedDate: timestamp("completed_date"),
  officeAreaSf: integer("office_area_sf").default(0),
  warehouseAreaSf: integer("warehouse_area_sf").default(0),
  totalAreaSf: integer("total_area_sf").default(0),
  totalActualCost: integer("total_actual_cost"),
  costPerSf: text("cost_per_sf"),
  source: text("source").notNull().default("historical_import"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectActualLineItems = pgTable("project_actual_line_items", {
  id: serial("id").primaryKey(),
  projectActualId: integer("project_actual_id").notNull().references(() => projectActuals.id),
  category: text("category").notNull(),
  description: text("description"),
  totalCost: integer("total_cost").notNull(),
  areaType: text("area_type").default("combined"),
  areaSf: integer("area_sf"),
  costPerSf: text("cost_per_sf"),
  vendorName: text("vendor_name"),
  linkedMasterItemIds: json("linked_master_item_ids").$type<number[]>().notNull().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProjectActualSchema = createInsertSchema(projectActuals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateProjectActualSchema = insertProjectActualSchema.partial().extend({
  id: z.number(),
});

export const insertProjectActualLineItemSchema = createInsertSchema(projectActualLineItems).omit({
  id: true,
  createdAt: true,
});

export const updateProjectActualLineItemSchema = insertProjectActualLineItemSchema.partial().extend({
  id: z.number(),
});

export type ProjectActual = typeof projectActuals.$inferSelect;
export type InsertProjectActual = z.infer<typeof insertProjectActualSchema>;
export type ProjectActualLineItem = typeof projectActualLineItems.$inferSelect;
export type InsertProjectActualLineItem = z.infer<typeof insertProjectActualLineItemSchema>;

// Audit log — append-only event record for security and compliance review.
// Known event types (open-ended; add new values without schema changes):
//   'login_success'  — user authenticated successfully
//   'login_failure'  — authentication attempt rejected
// Future: 'rfp_updated', 'property_deleted', 'existing_improvement_created', etc.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  userId: text("user_id"),
  userEmail: text("user_email"),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  beforeData: jsonb("before_data"),
  afterData: jsonb("after_data"),
  changedFields: text("changed_fields").array(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;

// Master Item Review Queue — captures "Other" entries from Evaluation Budget
// and legacy free-typed items for admin review and promotion to the master list.
// Status lifecycle: pending → promoted | rejected | duplicate
export const masterItemReviewQueue = pgTable(
  "master_item_review_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 'evaluation_budget' | 'bid_collection' | 'legacy_freetype'
    sourceType: text("source_type").notNull(),
    // client-generated EvaluationLineItem.id or bid_line_items.id
    sourceLineItemId: text("source_line_item_id"),
    customDescription: text("custom_description").notNull(),
    suggestedCsiDivision: text("suggested_csi_division"),
    suggestedUnit: text("suggested_unit"),
    // 'pending' | 'promoted' | 'rejected' | 'duplicate'
    status: text("status").notNull().default("pending"),
    // set when status='promoted' — the newly created master scope item
    promotedMasterItemId: integer("promoted_master_item_id").references(() => romScopeItems.id),
    // set when status='duplicate' — the existing master item this duplicates
    duplicateOfMasterItemId: integer("duplicate_of_master_item_id").references(() => romScopeItems.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    notes: text("notes"),
  },
  (table) => [
    index("mirq_status_idx").on(table.status),
    index("mirq_description_idx").on(table.customDescription),
  ]
);

export const insertMasterItemReviewQueueSchema = createInsertSchema(masterItemReviewQueue).omit({
  id: true,
  createdAt: true,
});

export type MasterItemReviewQueueEntry = typeof masterItemReviewQueue.$inferSelect;
export type InsertMasterItemReviewQueueEntry = z.infer<typeof insertMasterItemReviewQueueSchema>;

