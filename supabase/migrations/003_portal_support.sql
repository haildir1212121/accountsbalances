-- Migration 003: Portal support columns + budget_months table
-- Run AFTER 001 and 002.

-- Add portal-specific columns to accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS organization TEXT DEFAULT 'Imported';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auth_password TEXT DEFAULT 'Password';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auth_password_changed BOOLEAN DEFAULT false;

-- Budget months: per-account per-month spending limits
CREATE TABLE IF NOT EXISTS budget_months (
  id              BIGSERIAL PRIMARY KEY,
  account_ref     TEXT NOT NULL REFERENCES accounts(ref) ON DELETE CASCADE,
  month_label     TEXT NOT NULL,           -- "3/1/2026" format for portal compatibility
  monthly_limit   NUMERIC(10,2) DEFAULT 600,
  created_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_budget_month UNIQUE (account_ref, month_label)
);

ALTER TABLE budget_months ENABLE ROW LEVEL SECURITY;

-- Add description and source columns to trips for manual entries
ALTER TABLE trips ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'webhook';

-- Make booking_id nullable for manual entries
ALTER TABLE trips ALTER COLUMN booking_id DROP NOT NULL;

-- Drop the restrictive anon read-only policies
DROP POLICY IF EXISTS "anon_read_accounts" ON accounts;
DROP POLICY IF EXISTS "anon_read_trips" ON trips;

-- Grant anon full access (portal auth is handled at the app layer)
CREATE POLICY "anon_full_accounts" ON accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_trips" ON trips FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_budget_months" ON budget_months FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_budget_months" ON budget_months FOR ALL USING (auth.role() = 'service_role');
