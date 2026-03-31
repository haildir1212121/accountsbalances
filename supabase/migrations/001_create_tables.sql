-- Supabase schema for iCabbi completed-trip webhook logging
-- Run this migration to set up the accounts and trips tables.

-- ============================================================================
-- ACCOUNTS TABLE
-- Populated from accounts.csv via the seed script.
-- The worker queries this table to validate incoming trips.
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounts (
  id            BIGSERIAL PRIMARY KEY,
  icabbi_id     TEXT UNIQUE,                      -- iCabbi numeric ID (e.g. "80102906")
  ref           TEXT NOT NULL UNIQUE,              -- account ref (e.g. "202-002")
  name          TEXT NOT NULL,                     -- account holder name
  account_group TEXT NOT NULL,                     -- prefix: "202", "671", "542"
  active        BOOLEAN DEFAULT true,
  sc            TEXT DEFAULT '0.00%',
  disc_price    TEXT DEFAULT '0.00%',
  disc_cost     TEXT DEFAULT '0.00%',
  bc            TEXT DEFAULT '0.00%',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes for the lookup patterns the worker uses
CREATE INDEX IF NOT EXISTS idx_accounts_ref ON accounts (ref);
CREATE INDEX IF NOT EXISTS idx_accounts_icabbi_id ON accounts (icabbi_id);
CREATE INDEX IF NOT EXISTS idx_accounts_account_group ON accounts (account_group);
CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts (name);

-- ============================================================================
-- TRIPS TABLE
-- Every matched completed trip from iCabbi is logged here.
-- ============================================================================
CREATE TABLE IF NOT EXISTS trips (
  id              BIGSERIAL PRIMARY KEY,
  booking_id      TEXT NOT NULL,
  account_ref     TEXT NOT NULL REFERENCES accounts(ref),
  account_name    TEXT,
  account_group   TEXT NOT NULL,                   -- denormalized for fast filtering
  fare            NUMERIC(10,2) NOT NULL DEFAULT 0,
  trip_date       DATE NOT NULL,
  raw_payload     JSONB,                           -- full webhook payload for audit
  created_at      TIMESTAMPTZ DEFAULT now(),

  -- Prevent duplicate bookings for the same account+month
  CONSTRAINT uq_booking_account UNIQUE (booking_id, account_ref)
);

CREATE INDEX IF NOT EXISTS idx_trips_account_ref ON trips (account_ref);
CREATE INDEX IF NOT EXISTS idx_trips_account_group ON trips (account_group);
CREATE INDEX IF NOT EXISTS idx_trips_trip_date ON trips (trip_date);
CREATE INDEX IF NOT EXISTS idx_trips_booking_id ON trips (booking_id);

-- ============================================================================
-- MONTHLY SUMMARY VIEW
-- Aggregates trips per account per month, matching the portal's budgetData.
-- ============================================================================
CREATE OR REPLACE VIEW monthly_account_summary AS
SELECT
  a.ref                                          AS account_ref,
  a.name                                         AS account_name,
  a.account_group,
  DATE_TRUNC('month', t.trip_date)::DATE         AS month,
  COUNT(*)                                       AS trip_count,
  SUM(t.fare)                                    AS total_spent,
  600.00 - SUM(t.fare)                           AS remaining_budget
FROM trips t
JOIN accounts a ON a.ref = t.account_ref
GROUP BY a.ref, a.name, a.account_group, DATE_TRUNC('month', t.trip_date)
ORDER BY a.account_group, a.ref, month;

-- ============================================================================
-- RLS (Row-Level Security) — enable but allow service_role full access
-- ============================================================================
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

-- Service-role (used by the worker via service key) gets full access
CREATE POLICY "service_role_accounts" ON accounts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_role_trips" ON trips FOR ALL
  USING (auth.role() = 'service_role');

-- Anon can read accounts (for the portal frontend, if needed)
CREATE POLICY "anon_read_accounts" ON accounts FOR SELECT
  USING (auth.role() = 'anon');

-- Anon can read trips (for the portal frontend, if needed)
CREATE POLICY "anon_read_trips" ON trips FOR SELECT
  USING (auth.role() = 'anon');
