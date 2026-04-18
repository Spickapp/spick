-- ============================================================
-- Fas 0.2b Paket 3: cleaner_availability_v2 RLS-skärpning
-- ============================================================
-- Kördes mot prod 2026-04-18 kväll (post-hoc dokumentation).
-- Speglar Paket 2-hierarkin på v2 för konsistens inför Fas 1 (droppar v1).
--
-- Pre-state: v2 hade inga qual=true-skriv-läckor men policies var på
-- {public}-roll istället för specifika roller. Saknad VD-team-policy
-- för framtida UI som riktar mot v2.
--
-- Post-state: Identisk policy-hierarki som cleaner_availability v1
-- (Paket 2), så att Fas 1 kan droppa v1 utan att ändra cross-table-
-- semantik.
--
-- Se docs/incidents/2026-04-18-paket-1-2-auth-hardening-and-v1-rls.md
-- för Paket 3-sektionen.
-- ============================================================

-- 1) DROP gamla policies (omskrivs till rätt roller + konsistenta namn) ─
DROP POLICY IF EXISTS "Admin can manage availability" ON cleaner_availability_v2;
DROP POLICY IF EXISTS "Authenticated users manage own availability_v2" ON cleaner_availability_v2;
DROP POLICY IF EXISTS "Service role manages availability_v2" ON cleaner_availability_v2;
DROP POLICY IF EXISTS "Anon can read availability_v2" ON cleaner_availability_v2;

-- 2) Cleaner egen — auth.uid via cleaners ────────────────
CREATE POLICY "Cleaner manages own availability_v2"
  ON cleaner_availability_v2 FOR ALL TO authenticated
  USING (cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()))
  WITH CHECK (cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()));

-- 3) VD hanterar team via company-join ───────────────────
CREATE POLICY "VD manages team availability_v2"
  ON cleaner_availability_v2 FOR ALL TO authenticated
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

-- 4) Admin via is_admin() ──────────────────────────────
CREATE POLICY "Admin manages all availability_v2"
  ON cleaner_availability_v2 FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- 5) Service role (bevaras för Edge Functions) ────────
CREATE POLICY "Service role manages availability_v2"
  ON cleaner_availability_v2 FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 6) Publik SELECT för boka.html ──────────────────────
CREATE POLICY "Public read availability_v2"
  ON cleaner_availability_v2 FOR SELECT TO anon, authenticated
  USING (true);
