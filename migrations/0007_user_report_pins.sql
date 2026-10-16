-- Per-user pinned reports.
--
-- Additive only: one new table, no change to any existing column, so this
-- cannot affect data already in the database.
--
-- user_id is TEXT because contacts sign in alongside system users and arrive
-- as "contact_12". An integer would have excluded every contact.

CREATE TABLE IF NOT EXISTS user_report_pins (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  report_key  TEXT        NOT NULL,
  params      JSON        DEFAULT '{}'::json,
  position    INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_report_pins_user_idx ON user_report_pins (user_id);
