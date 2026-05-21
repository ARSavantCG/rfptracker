-- Add RFP type selection flags to invitation_to_bid.
-- These record whether a contractor or architect RFP was selected in Step 3
-- so the workflow-phase validator can condition due-date requirements on type selection.
-- Default false: rows that predate this migration are backfilled separately via admin SQL.
ALTER TABLE "invitation_to_bid" ADD COLUMN IF NOT EXISTS "contractor_rfp_required" boolean NOT NULL DEFAULT false;
ALTER TABLE "invitation_to_bid" ADD COLUMN IF NOT EXISTS "architect_rfp_required" boolean NOT NULL DEFAULT false;
