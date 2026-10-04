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
  source           TEXT,
  looking_for      TEXT[] DEFAULT '{}',
  payment_method   TEXT NOT NULL DEFAULT 'razorpay' CHECK (payment_method IN ('razorpay', 'upi_manual')),
  payment_verified BOOLEAN NOT NULL DEFAULT FALSE,   -- razorpay: set on confirmed capture; upi_manual: set by admin
  -- Razorpay (payment_status is NULL for upi_manual rows)
  payment_status      TEXT CHECK (payment_status IN ('awaiting_payment', 'paid', 'failed')),
  razorpay_order_id   TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  amount_paid         INT,                  -- ₹, as captured by Razorpay
  paid_at             TIMESTAMPTZ,
  -- Legacy manual UPI (registrations before Razorpay)
  utr              TEXT,                    -- duplicates flagged in admin "Duplicates" tab
  screenshot_path  TEXT,
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

-- Migration to Razorpay (safe to re-run). Rows that exist before this point
-- were paid by manual UPI: the column default tags them, then flips to razorpay.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'upi_manual'
  CHECK (payment_method IN ('razorpay', 'upi_manual'));
ALTER TABLE registrations ALTER COLUMN payment_method SET DEFAULT 'razorpay';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_status TEXT
  CHECK (payment_status IN ('awaiting_payment', 'paid', 'failed'));
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS razorpay_order_id   TEXT UNIQUE;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT UNIQUE;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS amount_paid INT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE registrations ALTER COLUMN utr DROP NOT NULL;
