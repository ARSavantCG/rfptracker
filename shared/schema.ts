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
  files: json("files").$type<{ id: string; name: string; size: number; type: string; uploadedAt: string; }[]>().default([]),
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
export type RfpFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
};
