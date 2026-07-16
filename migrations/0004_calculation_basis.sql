-- Catalog calculation basis: how a rom_scope_items entry derives its quantity in
-- RFP evaluations (lump-sum / % of TI / % of construction / per rentable SF / manual).
-- Replaces brittle description-matching. Nullable = treated as manual.
--
-- Auto-applied at boot via server/startup-migrations.ts; this file documents it.
-- Verify:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name='rom_scope_items' AND column_name='calculation_basis';

ALTER TABLE rom_scope_items
  ADD COLUMN IF NOT EXISTS calculation_basis text;
