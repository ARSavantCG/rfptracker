import { pgTable, text, serial, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const rfpRequests = pgTable("rfp_requests", {
  id: serial("id").primaryKey(),
  rfpNumber: text("rfp_number").notNull().unique(),
  client: text("client").notNull(),
  project: text("project").notNull(),
  status: text("status").notNull(), // received, in-progress, completed, on-hold
  requestTypes: json("request_types").$type<string[]>().notNull(), // pricing, space-plans, schedule
  contactPerson: text("contact_person"),
  contactEmail: text("contact_email"),
  dateReceived: timestamp("date_received").notNull(),
  dueDate: timestamp("due_date"),
  notes: text("notes"),
  files: json("files").$type<RfpFile[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRfpRequestSchema = createInsertSchema(rfpRequests).omit({
  id: true,
  rfpNumber: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  requestTypes: z.array(z.string()).min(1, "At least one request type is required"),
  status: z.enum(["received", "in-progress", "completed", "on-hold"]),
  dateReceived: z.string().transform((val) => new Date(val)),
  dueDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
});

export const updateRfpRequestSchema = insertRfpRequestSchema.partial().extend({
  id: z.number(),
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

export type RfpFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  path?: string; // For file system storage
};
