CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"user_id" text,
	"user_email" text,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"before_data" jsonb,
	"after_data" jsonb,
	"changed_fields" text[],
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "auth_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "bay_panel_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"bay_id" text NOT NULL,
	"main_panel_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_alternates" (
	"id" serial PRIMARY KEY NOT NULL,
	"bid_collection_id" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"cost" text NOT NULL,
	"include_in_evaluation" boolean DEFAULT false NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" integer NOT NULL,
	"contractor_id" integer NOT NULL,
	"contractor_name" text NOT NULL,
	"contractor_company" text NOT NULL,
	"contractor_email" text NOT NULL,
	"submission_date" timestamp DEFAULT now() NOT NULL,
	"total_amount" text,
	"cost_category" text DEFAULT 'construction' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"notes" text,
	"attachments" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_leveling_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" integer NOT NULL,
	"bid_collection_id" integer NOT NULL,
	"cost_bucket" text NOT NULL,
	"adjustment_amount" integer DEFAULT 0 NOT NULL,
	"adjustment_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"bid_collection_id" integer NOT NULL,
	"category" text,
	"description" text NOT NULL,
	"quantity" text,
	"unit" text,
	"unit_price" text,
	"total_price" text NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_clean_data" boolean DEFAULT false NOT NULL,
	"master_category_id" integer,
	"cost_bucket" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"type" text NOT NULL,
	"tags" json DEFAULT '[]'::json,
	"specialties" json DEFAULT '[]'::json,
	"notes" text,
	"has_system_access" boolean DEFAULT false,
	"permissions" json DEFAULT '[]'::json,
	"password_hash" text,
	"reset_token" text,
	"reset_token_expiry" timestamp,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "electrical_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"transformer_id" integer NOT NULL,
	"rfp_id" integer,
	"tenant_name" text NOT NULL,
	"reserved_kva" integer NOT NULL,
	"reservation_type" text NOT NULL,
	"reservation_date" timestamp DEFAULT now() NOT NULL,
	"release_date" timestamp,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_bid_carry" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" integer NOT NULL,
	"selected_bid_collection_id" integer NOT NULL,
	"cost_bucket" text NOT NULL,
	"original_total" integer DEFAULT 0 NOT NULL,
	"adjustment_amount" integer DEFAULT 0 NOT NULL,
	"carried_price" integer DEFAULT 0 NOT NULL,
	"is_overridden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_budget_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" integer NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_budget_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" integer NOT NULL,
	"report_name" varchar(255) NOT NULL,
	"generated_by" varchar(255) NOT NULL,
	"generated_content" text NOT NULL,
	"change_summary" text[] DEFAULT '{}',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" integer NOT NULL,
	"tenant_improvements" json DEFAULT '[]'::json,
	"design_soft_costs" json DEFAULT '[]'::json,
	"existing_improvements" json DEFAULT '[]'::json,
	"has_existing_improvements" boolean DEFAULT false,
	"include_existing_in_total" boolean DEFAULT false,
	"separate_design_costs" boolean DEFAULT true,
	"total_tenant_improvements" text,
	"total_design_soft_costs" text,
	"total_existing_improvements" text,
	"grand_total" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"line_item_rollups" json DEFAULT '{}'::json,
	"assemblies" json DEFAULT '{}'::json,
	"metadata" json DEFAULT '{}'::json
);
--> statement-breakpoint
CREATE TABLE "executed_leases" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"tenant_name" text NOT NULL,
	"assigned_bays" text[] DEFAULT '{}' NOT NULL,
	"lease_start_date" timestamp,
	"lease_end_date" timestamp,
	"rentable_square_footage" integer,
	"bay_numbers" text,
	"rentable_area_override" integer,
	"standard_parking" integer DEFAULT 0,
	"accessible_parking" integer DEFAULT 0,
	"ev_parking" integer DEFAULT 0,
	"trailer_parking" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invitation_to_bid" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" serial NOT NULL,
	"project_scope" text,
	"project_location" text,
	"estimated_budget" text,
	"project_timeline" text,
	"bid_submission_deadline" timestamp,
	"contractor_due_date" timestamp,
	"architect_due_date" timestamp,
	"project_start_date" timestamp,
	"project_end_date" timestamp,
	"special_requirements" json DEFAULT '[]'::json,
	"technical_specifications" text,
	"contract_terms" text,
	"payment_terms" text,
	"insurance_requirements" text,
	"bonding_requirements" text,
	"prequalification_criteria" json DEFAULT '[]'::json,
	"evaluation_criteria" json DEFAULT '[]'::json,
	"contact_for_questions" text,
	"site_visit_scheduled" timestamp,
	"additional_documents" json DEFAULT '[]'::json,
	"project_description" text,
	"documents_link" text,
	"key_dates" json DEFAULT '[]'::json,
	"scope_of_work" json DEFAULT '[]'::json,
	"architect_milestones" json DEFAULT '[]'::json,
	"contractor_milestones" json DEFAULT '[]'::json,
	"selected_contractor" text,
	"selected_architect" text,
	"rfp_variant" text DEFAULT 'standard' NOT NULL,
	"recipient_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" serial NOT NULL,
	"contact_id" serial NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"status" text NOT NULL,
	"sent_at" timestamp,
	"responded_at" timestamp,
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "main_panels" (
	"id" serial PRIMARY KEY NOT NULL,
	"transformer_id" integer NOT NULL,
	"panel_name" text NOT NULL,
	"max_capacity_kva" integer NOT NULL,
	"capacity_amps" integer,
	"voltage" text DEFAULT '480',
	"panel_location" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "master_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "master_item_review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_line_item_id" text,
	"custom_description" text NOT NULL,
	"suggested_csi_division" text,
	"suggested_unit" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"promoted_master_item_id" integer,
	"duplicate_of_master_item_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "pdf_mapping_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"contractor_id" integer,
	"template_name" text NOT NULL,
	"header_signature" text,
	"column_count" integer,
	"sample_headers" json,
	"mapping" json NOT NULL,
	"is_default" boolean DEFAULT false,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdf_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_key" text NOT NULL,
	"template_name" text NOT NULL,
	"template_type" text NOT NULL,
	"section" text NOT NULL,
	"content" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pdf_templates_template_key_unique" UNIQUE("template_key")
);
--> statement-breakpoint
CREATE TABLE "project_actual_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_actual_id" integer NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"total_cost" integer NOT NULL,
	"area_type" text DEFAULT 'combined',
	"area_sf" integer,
	"cost_per_sf" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_actuals" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" integer,
	"project_name" text NOT NULL,
	"tenant_name" text NOT NULL,
	"property_name" text NOT NULL,
	"completed_date" timestamp NOT NULL,
	"office_area_sf" integer DEFAULT 0,
	"warehouse_area_sf" integer DEFAULT 0,
	"total_area_sf" integer DEFAULT 0,
	"total_actual_cost" integer NOT NULL,
	"cost_per_sf" text,
	"source" text DEFAULT 'historical_import' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_alternates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" integer NOT NULL,
	"description" text NOT NULL,
	"option_a" text,
	"option_b" text,
	"master_category_id" integer,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"original_name" text NOT NULL,
	"workflow_step" text NOT NULL,
	"mime_type" text,
	"file_size" integer,
	"uploaded_by" text,
	"subfolder" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_name" text NOT NULL,
	"building" text NOT NULL,
	"is_single_building" boolean DEFAULT false,
	"street_address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"display_name" text NOT NULL,
	"bay_configurations" json DEFAULT '[]'::json,
	"mechanical_room_square_footage" integer DEFAULT 0,
	"first_bay_direction" text,
	"bay_progression_direction" text,
	"standard_parking" integer DEFAULT 0,
	"accessible_parking" integer DEFAULT 0,
	"ev_parking" integer DEFAULT 0,
	"trailer_parking" integer DEFAULT 0,
	"electrical_allocation" integer DEFAULT 0,
	"electrical_allocation_increment" integer DEFAULT 200,
	"building_depth" integer,
	"slab_thickness" text,
	"clear_height" text,
	"floor_flatness" text,
	"truck_apron_slab" text,
	"ramp_capacity" text,
	"roof_r_value" text,
	"fire_pump_info" text,
	"fire_sprinkler_info" text,
	"display_order" integer,
	"is_land_lease" boolean DEFAULT false,
	"beneficial_occupancy_date" timestamp,
	"lease_expiration_date" timestamp,
	"lease_extensions" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"file_type" text NOT NULL,
	"description" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_existing_improvements" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"total_cost" integer NOT NULL,
	"allocation_type" text NOT NULL,
	"allocation_value" integer,
	"units" text,
	"applicable_bays" json DEFAULT '[]'::json,
	"demising_wall_data" json,
	"forecast_cost" integer DEFAULT 0 NOT NULL,
	"committed_cost" integer DEFAULT 0 NOT NULL,
	"actuals_cost" integer DEFAULT 0 NOT NULL,
	"bucket" text DEFAULT 'ACTUALS' NOT NULL,
	"draw_captured" boolean DEFAULT false NOT NULL,
	"original_commitment" integer,
	"added_amount" integer,
	"draw_ref" text,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfp_generation_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_id" integer NOT NULL,
	"generation_type" text NOT NULL,
	"generated_by" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"invitation_data" json,
	"generated_content" text NOT NULL,
	"title" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "rfp_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfp_number" text NOT NULL,
	"parent_rfp_id" integer,
	"is_counter_offer" boolean DEFAULT false,
	"is_option" boolean DEFAULT false,
	"option_type" text,
	"property" text NOT NULL,
	"is_multi_building" boolean DEFAULT false,
	"properties" json,
	"selected_bays_per_building" json,
	"costs_per_building" json,
	"tenant_name" text NOT NULL,
	"project_name" text NOT NULL,
	"confidential" boolean DEFAULT false,
	"sent_by" text NOT NULL,
	"received_on" timestamp NOT NULL,
	"internal_due_date" timestamp NOT NULL,
	"response_to_broker_due" timestamp,
	"contractor_due_date" timestamp,
	"architect_due_date" timestamp,
	"anticipated_lease_execution_date" timestamp,
	"anticipated_occupancy_date" timestamp,
	"development_contact" text,
	"project_area" text,
	"request_types" json NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"workflow_phase" text DEFAULT 'rfp-entry' NOT NULL,
	"notes" text,
	"deal_metric_notes" text,
	"files" json DEFAULT '[]'::json NOT NULL,
	"selected_bay_configurations" json DEFAULT '[]'::json,
	"property_id" integer,
	"selected_bay_ids" json,
	"property_ids_per_building" json,
	"bay_ids_per_building" json,
	"is_validated" json DEFAULT 'false'::json,
	"validation_errors" json DEFAULT '[]'::json,
	"general_contractor" text,
	"architect" text,
	"additional_contractors" json DEFAULT '[]'::json,
	"additional_architects" json DEFAULT '[]'::json,
	"office_area_existing" text,
	"office_area_new" text,
	"warehouse_area" text,
	"warehouse_area_override" text,
	"warehouse_notes" text,
	"area_breakdown" json DEFAULT '[]'::json,
	"project_address" text,
	"project_size" text,
	"estimated_value" text,
	"timeline_requirements" text,
	"special_requirements" text,
	"contact_person" text,
	"contact_email" text,
	"due_date" timestamp,
	"project_description" text,
	"documents_link" text,
	"tenant_electrical_allocation" integer,
	"tenant_electrical_additional_request" integer,
	"tenant_electrical_voltage" text,
	"tenant_electrical_additional_voltage" text,
	"tenant_electrical_upgrade_timing" text,
	"tenant_electrical_notes" text,
	"completed_date" timestamp,
	"published_date" timestamp,
	"project_folder" text,
	"building_position" text,
	"adjacent_tenants" text,
	"clear_height" text,
	"sprinkler_spec" text,
	"existing_power" text,
	"dock_door_count" integer,
	"drive_in_door_count" integer,
	"parking_ratio" text,
	"bay_dimensions" text,
	"tenant_program_summary" text,
	"target_lxe" timestamp,
	"target_ntp" timestamp,
	"target_mobilization" timestamp,
	"target_permit_drawings" timestamp,
	"target_substantial_completion" timestamp,
	"target_rcd" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rfp_requests_rfp_number_unique" UNIQUE("rfp_number")
);
--> statement-breakpoint
CREATE TABLE "rom_pilot_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"rom_pilot_id" integer NOT NULL,
	"scope_item_id" integer NOT NULL,
	"quantity" text DEFAULT '0',
	"unit_price" text NOT NULL,
	"total_price" text DEFAULT '0',
	"tenant_share" integer DEFAULT 100,
	"notes" text,
	"category" text DEFAULT 'tenant-improvements',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rom_pilots" (
	"id" serial PRIMARY KEY NOT NULL,
	"rom_number" text,
	"project_name" text NOT NULL,
	"property" text NOT NULL,
	"selected_bay_configurations" json DEFAULT '[]'::json,
	"total_estimate" text DEFAULT '0',
	"notes" text,
	"status" text DEFAULT 'draft',
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rom_pilots_rom_number_unique" UNIQUE("rom_number")
);
--> statement-breakpoint
CREATE TABLE "rom_scope_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit" text NOT NULL,
	"unit_price" text NOT NULL,
	"minimum_cost" text,
	"has_minimum_cost" boolean DEFAULT false,
	"category" text NOT NULL,
	"csi_division" text,
	"csi_code" text,
	"source" text,
	"last_updated" timestamp,
	"is_active" boolean DEFAULT true,
	"include_by_default" boolean DEFAULT false,
	"attachments" json DEFAULT '[]'::json,
	"reference_pricing" json DEFAULT '[]'::json,
	"item_group" text,
	"min_square_footage" integer,
	"max_square_footage" integer,
	"pricing_mode" text DEFAULT 'average',
	"selected_contractor_name" text,
	"manual_override_price" text,
	"manual_override_reason" text,
	"active_price" text,
	"price_spread_percent" text,
	"last_quarterly_update" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_item_contractor_pricing" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope_item_id" integer NOT NULL,
	"contractor_id" integer,
	"contractor_name" text NOT NULL,
	"price" text NOT NULL,
	"unit" text NOT NULL,
	"quoted_date" timestamp NOT NULL,
	"quarter" text NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transformers" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"transformer_name" text NOT NULL,
	"total_capacity_kva" integer NOT NULL,
	"fpl_id" text,
	"installation_date" timestamp,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY NOT NULL,
	"username" varchar NOT NULL,
	"email" varchar,
	"password_hash" varchar NOT NULL,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"role" varchar DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true,
	"permissions" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "bay_panel_assignments" ADD CONSTRAINT "bay_panel_assignments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bay_panel_assignments" ADD CONSTRAINT "bay_panel_assignments_main_panel_id_main_panels_id_fk" FOREIGN KEY ("main_panel_id") REFERENCES "public"."main_panels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_alternates" ADD CONSTRAINT "bid_alternates_bid_collection_id_bid_collections_id_fk" FOREIGN KEY ("bid_collection_id") REFERENCES "public"."bid_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_collections" ADD CONSTRAINT "bid_collections_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_collections" ADD CONSTRAINT "bid_collections_contractor_id_contacts_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_leveling_adjustments" ADD CONSTRAINT "bid_leveling_adjustments_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_leveling_adjustments" ADD CONSTRAINT "bid_leveling_adjustments_bid_collection_id_bid_collections_id_fk" FOREIGN KEY ("bid_collection_id") REFERENCES "public"."bid_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_line_items" ADD CONSTRAINT "bid_line_items_bid_collection_id_bid_collections_id_fk" FOREIGN KEY ("bid_collection_id") REFERENCES "public"."bid_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_line_items" ADD CONSTRAINT "bid_line_items_master_category_id_master_categories_id_fk" FOREIGN KEY ("master_category_id") REFERENCES "public"."master_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electrical_reservations" ADD CONSTRAINT "electrical_reservations_transformer_id_transformers_id_fk" FOREIGN KEY ("transformer_id") REFERENCES "public"."transformers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electrical_reservations" ADD CONSTRAINT "electrical_reservations_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_bid_carry" ADD CONSTRAINT "evaluation_bid_carry_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_bid_carry" ADD CONSTRAINT "evaluation_bid_carry_selected_bid_collection_id_bid_collections_id_fk" FOREIGN KEY ("selected_bid_collection_id") REFERENCES "public"."bid_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_budget_attachments" ADD CONSTRAINT "evaluation_budget_attachments_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_budget_history" ADD CONSTRAINT "evaluation_budget_history_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_budgets" ADD CONSTRAINT "evaluation_budgets_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_to_bid" ADD CONSTRAINT "invitation_to_bid_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_panels" ADD CONSTRAINT "main_panels_transformer_id_transformers_id_fk" FOREIGN KEY ("transformer_id") REFERENCES "public"."transformers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_item_review_queue" ADD CONSTRAINT "master_item_review_queue_promoted_master_item_id_rom_scope_items_id_fk" FOREIGN KEY ("promoted_master_item_id") REFERENCES "public"."rom_scope_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_item_review_queue" ADD CONSTRAINT "master_item_review_queue_duplicate_of_master_item_id_rom_scope_items_id_fk" FOREIGN KEY ("duplicate_of_master_item_id") REFERENCES "public"."rom_scope_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_mapping_templates" ADD CONSTRAINT "pdf_mapping_templates_contractor_id_contacts_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actual_line_items" ADD CONSTRAINT "project_actual_line_items_project_actual_id_project_actuals_id_fk" FOREIGN KEY ("project_actual_id") REFERENCES "public"."project_actuals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actuals" ADD CONSTRAINT "project_actuals_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_alternates" ADD CONSTRAINT "project_alternates_project_id_rfp_requests_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."rfp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_alternates" ADD CONSTRAINT "project_alternates_master_category_id_master_categories_id_fk" FOREIGN KEY ("master_category_id") REFERENCES "public"."master_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_rfp_requests_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."rfp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_attachments" ADD CONSTRAINT "property_attachments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_existing_improvements" ADD CONSTRAINT "property_existing_improvements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_generation_history" ADD CONSTRAINT "rfp_generation_history_rfp_id_rfp_requests_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfp_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_item_contractor_pricing" ADD CONSTRAINT "scope_item_contractor_pricing_scope_item_id_rom_scope_items_id_fk" FOREIGN KEY ("scope_item_id") REFERENCES "public"."rom_scope_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_item_contractor_pricing" ADD CONSTRAINT "scope_item_contractor_pricing_contractor_id_contacts_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformers" ADD CONSTRAINT "transformers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mirq_status_idx" ON "master_item_review_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mirq_description_idx" ON "master_item_review_queue" USING btree ("custom_description");--> statement-breakpoint
CREATE INDEX "project_alternates_project_id_idx" ON "project_alternates" USING btree ("project_id");