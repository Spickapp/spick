-- ============================================================
-- Fas 0.2b Paket 2: cleaner_availability v1 RLS-skärpning
-- ============================================================
-- Kördes mot prod 2026-04-18 kväll (post-hoc dokumentation).
-- Ersätter qual=true-policies med auth-scoped hierarki (VD/Admin/Public).
--
-- Pre-requisite: Paket 1 (commit 5ca40ba) auth-hardening i frontend måste
-- vara live innan denna migration körs — annars svälts 401/403 tyst i
-- saveTeamMemberSchedule och UI visar success trots DB-fel.
--
-- Se docs/incidents/2026-04-18-paket-1-2-auth-hardening-and-v1-rls.md
-- för empirisk verifiering + logiktest (Rafael VD täcker 3 cleaners,
-- Zivar VD täcker 5, via company-join).
-- ============================================================

-- 1) DROP gamla läckor ──────────────────────────────────────
DROP POLICY IF EXISTS "Cleaners can manage own availability" ON cleaner_availability;
DROP POLICY IF EXISTS "Anon reads availability" ON cleaner_availability;
DROP POLICY IF EXISTS "Auth reads cleaner_availability" ON cleaner_availability;

-- 2) VD hanterar team-medlemmars availability via company-join ──
CREATE POLICY "VD manages team availability"
  ON cleaner_availability FOR ALL TO authenticated
  USING (
    cleaner_id IN (
      SELECT c.id FROM cleaners c
      WHERE c.company_id IN (
        SELECT company_id FROM cleaners
         WHERE auth_user_id = auth.uid() AND is_company_owner = true
      )
    )
  )
  WITH CHECK (
    cleaner_id IN (
      SELECT c.id FROM cleaners c
      WHERE c.company_id IN (
        SELECT company_id FROM cleaners
         WHERE auth_user_id = auth.uid() AND is_company_owner = true
      )
    )
  );

-- 3) Admin via is_admin() ──────────────────────────────────
CREATE POLICY "Admin manages all availability"
  ON cleaner_availability FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- 4) Konsoliderad publik SELECT (ersätter två dubletter) ───
CREATE POLICY "Public read cleaner_availability"
  ON cleaner_availability FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================================
-- BEHÅLLS (redan scoped, täcker cleaner själv):
--   "Cleaner sees own availability" — cleaner_id = (SELECT id FROM cleaners
--   WHERE auth_user_id = auth.uid())
-- ============================================================
