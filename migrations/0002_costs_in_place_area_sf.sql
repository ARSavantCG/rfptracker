-- Costs-in-Place report: optional improvement-specific area for $/SF calculation.
-- Nullable by design: when null, whole-property items fall back to the property's
-- derived rentable SF; demising walls never use $/SF at all.
--
-- APPLY TO NEON BEFORE DEPLOYING (host: ep-still-mud-a6uzawf6.us-west-2.aws.neon.tech).
-- Verify with:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'property_existing_improvements' AND column_name = 'area_sf';
-- Expected: area_sf | integer | YES

ALTER TABLE property_existing_improvements
  ADD COLUMN IF NOT EXISTS area_sf integer;
