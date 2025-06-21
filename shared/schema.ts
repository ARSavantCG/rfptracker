import { pgTable, text, serial, integer, timestamp, json, boolean } from "drizzle-orm/pg-core";
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
  workflowPhase: text("workflow_phase").notNull().default("rfp-entry"), // rfp-entry, invitation-to-bid, bid-collection, evaluation, award, publish
  notes: text("notes"),
  files: json("files").$type<RfpFile[]>().notNull().default([]),
  
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
});

export const updateRfpRequestSchema = insertRfpRequestSchema.partial().extend({
  id: z.number(),
  workflowPhase: z.enum(["rfp-entry", "invitation-to-bid", "bid-collection", "evaluation", "award"]).optional(),
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
  specialties: json("specialties").$type<string[]>().default([]),
  notes: text("notes"),
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
  specialties: z.array(z.string()).default([]),
});

export const updateContactSchema = insertContactSchema.partial().extend({
  id: z.number(),
});

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
  architectMilestones: json("architect_milestones").$type<{description: string, dueDate: string}[]>().default([]),
  contractorMilestones: json("contractor_milestones").$type<{description: string, dueDate: string}[]>().default([]),
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
  bidSubmissionDeadline: z.string().optional().transform((val) => val && val.trim() ? new Date(val) : new Date()),
  contractorDueDate: z.string().optional().transform((val) => val && val.trim() ? new Date(val) : undefined),
  architectDueDate: z.string().optional().transform((val) => val && val.trim() ? new Date(val) : undefined),
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
    dueDate: z.string(),
  })).default([]),
  contractorMilestones: z.array(z.object({
    description: z.string(),
    dueDate: z.string(),
  })).default([]),
});

export const updateInvitationToBidSchema = insertInvitationToBidSchema.partial();

export type InvitationToBid = typeof invitationToBid.$inferSelect;
export type InsertInvitationToBid = z.infer<typeof insertInvitationToBidSchema>;
export type UpdateInvitationToBid = z.infer<typeof updateInvitationToBidSchema>;

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
  id: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
});

export const updatePropertySchema = insertPropertySchema.partial().extend({
  id: z.number(),
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
});

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
