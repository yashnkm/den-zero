-- Den Zero — registrations schema
-- Run once:  psql "$DATABASE_URL" -f schema.sql

CREATE TABLE IF NOT EXISTS registrations (
  id               SERIAL PRIMARY KEY,
  ref_id           TEXT UNIQUE,
  city             TEXT NOT NULL CHECK (city IN ('Pune', 'Bangalore', 'Mumbai')),
  fee              INT  NOT NULL,           -- ₹ charged at submission, set server-side from city
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

-- Migration for tables created before city pricing (safe to re-run).
-- Registrations taken before then were all Pune at a flat ₹999.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS fee  INT;
UPDATE registrations SET city = 'Pune' WHERE city IS NULL;
UPDATE registrations SET fee  = 999    WHERE fee  IS NULL;
ALTER TABLE registrations ALTER COLUMN city SET NOT NULL;
ALTER TABLE registrations ALTER COLUMN fee  SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_city_check') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_city_check CHECK (city IN ('Pune', 'Bangalore', 'Mumbai'));
  END IF;
END $$;
