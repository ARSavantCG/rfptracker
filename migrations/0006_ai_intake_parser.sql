-- AI intake parser tables. See DESIGN-ai-intake-parser.md.
-- scope_inference_rules: editable CRE rules the AI applies (admin-curated, not hardcoded).
-- intake_proposals: the AI's proposed scope items per RFP, reviewed/accepted in Step 2.
-- Auto-applied at boot via server/startup-migrations.ts (additive/idempotent).

CREATE TABLE IF NOT EXISTS scope_inference_rules (
  id serial PRIMARY KEY,
  trigger_type text NOT NULL,           -- 'keyword' | 'condition'
  trigger_value text NOT NULL,          -- e.g. "partial building", "office"
  implied_scope text NOT NULL,          -- proposed scope (list of item names / description)
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intake_proposals (
  id serial PRIMARY KEY,
  rfp_id integer NOT NULL,
  description text NOT NULL,
  catalog_item_id integer,
  match_type text NOT NULL DEFAULT 'needs-mapping',  -- 'catalog-match' | 'needs-mapping'
  confidence text,                                    -- 'high' | 'medium' | 'low'
  reason text,
  source_ref text,
  status text NOT NULL DEFAULT 'proposed',            -- proposed | accepted | rejected | edited
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
