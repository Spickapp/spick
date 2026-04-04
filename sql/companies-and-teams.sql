-- ============================================================
-- Företagsmodell ("Team") — Companies & Teams
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Companies table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  org_number TEXT UNIQUE,
  owner_cleaner_id UUID REFERENCES cleaners(id),
  stripe_account_id TEXT,
  stripe_onboarding_status TEXT DEFAULT 'pending',
  commission_rate NUMERIC DEFAULT 0.17,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Alter cleaners — add company fields
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS is_company_owner BOOLEAN DEFAULT false;

-- 3. Alter cleaner_applications — add company fields
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS is_company BOOLEAN DEFAULT false;
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS org_number TEXT;
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS team_size INTEGER;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_cleaners_company_id ON cleaners(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner_cleaner_id);

-- 5. RLS on companies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Owner can read own company
CREATE POLICY "Company owner can read own company"
  ON companies FOR SELECT
  USING (owner_cleaner_id IN (
    SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
  ));

-- Owner can update own company
CREATE POLICY "Company owner can update own company"
  ON companies FOR UPDATE
  USING (owner_cleaner_id IN (
    SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
  ));

-- Service role can do everything (for edge functions)
CREATE POLICY "Service role full access on companies"
  ON companies FOR ALL
  USING (auth.role() = 'service_role');

-- 6. Company owner can read team members
CREATE POLICY "Company owner can read team members"
  ON cleaners FOR SELECT
  USING (
    company_id IN (
      SELECT c.company_id FROM cleaners c WHERE c.auth_user_id = auth.uid() AND c.is_company_owner = true
    )
  );

-- 7. Remove overly permissive anon INSERT on cleaners (if exists)
DROP POLICY IF EXISTS "Allow anon insert" ON cleaners;
DROP POLICY IF EXISTS "anon_insert" ON cleaners;
DROP POLICY IF EXISTS "Enable insert for anon" ON cleaners;
