-- Costs-in-Place report: optional per-item override for the $/SF denominator basis.
-- Null = use the smart default by category (lighting/hvac → warehouse-net,
-- fire-alarm/restrooms → whole-property, spec-office → own-area, demising → none).
--
-- Office SF itself lives in the bayConfigurations JSON (bay.officeSquareFootage),
-- so NO column is needed for that — it rides in the existing JSON column.
--
-- APPLY TO NEON BEFORE DEPLOYING (host: ep-still-mud-a6uzawf6.us-west-2.aws.neon.tech).
-- Verify with:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'property_existing_improvements' AND column_name = 'denominator_basis';
-- Expected: denominator_basis | text | YES

ALTER TABLE property_existing_improvements
  ADD COLUMN IF NOT EXISTS denominator_basis text;
