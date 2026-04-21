-- ============================================================
-- Fas 0.2b Paket 7: ENABLE RLS på tre tabeller + grant-cleanup
-- ============================================================
-- Kördes mot prod 2026-04-18 kväll (post-hoc dokumentation).
--
-- Före Paket 7: company_service_prices, tasks, spatial_ref_sys hade
-- rowsecurity=false. Första två är aktivt använda tabeller utan
-- RLS-skydd. spatial_ref_sys är PostGIS-systemtabell (read-only
-- konstanter, ingen RLS behövs).
--
-- Dessutom saknade anon-grants skärpning — båda tabellerna hade full
-- CRUD + TRUNCATE för anon-rollen trots att RLS-policies fanns på
-- company_service_prices (policies utvärderades aldrig pga
-- rowsecurity=false + raw grants släppte igenom).
--
-- Se docs/incidents/2026-04-18-paket-1-2-auth-hardening-and-v1-rls.md
-- för Paket 7-sektionen.
-- ============================================================

-- 1) REVOKE onödiga anon-grants ─────────────────────────────
REVOKE ALL ON tasks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON company_service_prices FROM anon;

-- 2) company_service_prices: DROP dubletter/läckor ─────────
DROP POLICY IF EXISTS "Admin can manage company prices" ON company_service_prices;
DROP POLICY IF EXISTS "Anyone can insert company prices" ON company_service_prices;
DROP POLICY IF EXISTS "Anyone can read company prices" ON company_service_prices;

-- 3) company_service_prices: CREATE nya ────────────────────
CREATE POLICY "Public read company_service_prices — intentional"
  ON company_service_prices FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Service role manages company_service_prices"
  ON company_service_prices FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER TABLE company_service_prices ENABLE ROW LEVEL SECURITY;

-- Befintliga VD-policy + Admin-policy från Fas 0.2a behålls (redan
-- korrekt scoped via cleaners.auth_user_id + is_admin()).

-- 4) tasks: ENABLE RLS + full hierarki ─────────────────────
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cleaner manages own tasks"
  ON tasks FOR ALL TO authenticated
  USING (
    assigned_to IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid())
    OR created_by IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    assigned_to IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid())
    OR created_by IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "VD manages team tasks"
  ON tasks FOR ALL TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM cleaners
       WHERE auth_user_id = auth.uid() AND is_company_owner = true
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM cleaners
       WHERE auth_user_id = auth.uid() AND is_company_owner = true
    )
  );

CREATE POLICY "Admin manages all tasks"
  ON tasks FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Service role manages tasks"
  ON tasks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5) spatial_ref_sys — PostGIS-systemtabell, ingen RLS ───
-- By design: read-only konstanter för koordinatreferens-system
-- (WGS84, SWEREF99 TM, etc). Ingen PII, ingen skriv-flöde. Se
-- docs/architecture/INTENTIONAL_ANON_POLICIES.md för motivering.
