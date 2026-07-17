-- Scope bundles: named reusable groups of catalog scope items (e.g. "Acclimatize
-- Warehouse"). A bundle expands into its component items as separate line items.
-- Bundles reference rom_scope_items by ID (single-source pricing). See
-- DESIGN-scope-bundles.md.
--
-- Auto-applied at boot via server/startup-migrations.ts (additive). This file documents
-- the full table shape for reference / manual apply if ever needed.

CREATE TABLE IF NOT EXISTS scope_bundles (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text,
  category text,
  is_active boolean DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scope_bundle_items (
  id serial PRIMARY KEY,
  bundle_id integer NOT NULL REFERENCES scope_bundles(id),
  scope_item_id integer NOT NULL REFERENCES rom_scope_items(id),
  default_quantity text,
  notes text,
  sort_order integer DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
