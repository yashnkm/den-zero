-- Den Zero — registrations schema
-- Run once:  psql "$DATABASE_URL" -f schema.sql

CREATE TABLE IF NOT EXISTS registrations (
  id               SERIAL PRIMARY KEY,
  ref_id           TEXT UNIQUE,
  team_name        TEXT NOT NULL,
  team_size        INT  NOT NULL CHECK (team_size BETWEEN 1 AND 3),
  members          JSONB NOT NULL,          -- [{name, college, course, email, phone, linkedin}]
  lead_name        TEXT NOT NULL,
  lead_whatsapp    TEXT NOT NULL,
  lead_email       TEXT NOT NULL,
  idea_name        TEXT NOT NULL,
  stage            TEXT NOT NULL,
  problem          TEXT NOT NULL,
  solution         TEXT NOT NULL,
  audience         TEXT NOT NULL,
  unique_edge      TEXT NOT NULL,
  progress         TEXT NOT NULL,
  ideal_investor   TEXT,
  deck_path        TEXT,
  utr              TEXT NOT NULL,           -- duplicates allowed; flagged in admin "Duplicates" tab
  screenshot_path  TEXT,
  source           TEXT,
  looking_for      TEXT[] DEFAULT '{}',
  payment_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registrations_created ON registrations (created_at DESC);
