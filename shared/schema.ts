import { pgTable, text, serial, timestamp, json, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const rfpRequests = pgTable("rfp_requests", {
  id: serial("id").primaryKey(),
  rfpNumber: text("rfp_number").notNull().unique(),
  
  // Initial RFP Entry Fields
  property: text("property").notNull(),
  tenantName: text("tenant_name").notNull(),
  projectName: text("project_name").notNull(),
  confidential: json("confidential").default(false).$type<boolean>(),
  sentBy: text("sent_by").notNull(),
  sentOn: timestamp("sent_on").notNull(),
  developmentContact: text("development_contact"),
  projectArea: text("project_area"),
  requestTypes: json("request_types").$type<string[]>().notNull(), // pricing, schedule, space-plan
  
  // System fields
  status: text("status").notNull().default("received"), // received, in-progress, completed, on-hold
  workflowPhase: text("workflow_phase").notNull().default("rfp-entry"), // rfp-entry, invitation-to-bid, bid-collection, evaluation, award
  notes: text("notes"),
  files: json("files").$type<RfpFile[]>().notNull().default([]),
  
  // Validation fields for workflow progression
  isValidated: json("is_validated").default(false).$type<boolean>(),
  validationErrors: json("validation_errors").$type<string[]>().default([]),
  
  // Phase 2: Validation & Progression Fields (populated during validation step)
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
  sentOn: z.string().transform((val) => new Date(val)),
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
  type: z.enum(["architect", "contractor", "consultant"]),
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
  projectScope: text("project_scope").notNull(),
  projectLocation: text("project_location").notNull(),
  estimatedBudget: text("estimated_budget"),
  projectTimeline: text("project_timeline"),
  bidSubmissionDeadline: timestamp("bid_submission_deadline").notNull(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInvitationToBidSchema = createInsertSchema(invitationToBid).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  bidSubmissionDeadline: z.string().transform((val) => new Date(val)),
  projectStartDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  projectEndDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  siteVisitScheduled: z.string().optional().transform((val) => val ? new Date(val) : undefined),
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
