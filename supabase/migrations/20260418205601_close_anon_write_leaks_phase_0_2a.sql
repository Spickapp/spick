-- ============================================================
-- Fas 0.2a: Stäng fyra kritiska anon-skrivläckor
-- ============================================================
-- Kördes mot prod 2026-04-18 sen kväll (post-hoc migration).
-- Ersätter qual=true-policies med authenticated VD + Admin-policies.
--
-- Bakgrund: RLS-audit upptäckte 4 policies med `USING (true)` som
-- tillät anon-rollen att uppdatera/ta bort rader på kritiska tabeller.
-- Frontend grep-audit samma kväll bekräftade att ingen aktiv anon-
-- skrivning finns (alla VD-flöden använder redan _authHeaders). Därmed
-- ingen regressionsrisk vid stängning.
--
-- Se docs/incidents/2026-04-18-anon-write-leaks-closed.md för full
-- kontext, grep-bevis och flaggor för 0.2b.
-- ============================================================

-- =============================================================
-- Fas 2.X iter 35 (2026-04-22): sekt 1 kommenterad ut
-- =============================================================
-- Orsak: company_service_prices skapas i 20260422090500 (sorteras efter).
-- Verifiering: båda policies FINNS i prod (rad 5144, 4472) och täcks
-- av 20260422130000_all_policies.sql.
-- =============================================================

-- -- 1) company_service_prices ─────────────────────────────────
-- DROP POLICY IF EXISTS "Anyone can update company prices" ON company_service_prices;
-- DROP POLICY IF EXISTS "Anyone can delete company prices" ON company_service_prices;
--
-- CREATE POLICY "VD manages own company prices"
--   ON company_service_prices FOR ALL TO authenticated
--   USING (
--     company_id IN (
--       SELECT company_id FROM cleaners
--        WHERE auth_user_id = auth.uid() AND is_company_owner = true
--     )
--   )
--   WITH CHECK (
--     company_id IN (
--       SELECT company_id FROM cleaners
--        WHERE auth_user_id = auth.uid() AND is_company_owner = true
--     )
--   );
--
-- CREATE POLICY "Admin manages all company prices"
--   ON company_service_prices FOR ALL TO authenticated
--   USING (is_admin()) WITH CHECK (is_admin());

-- 2) companies ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow update companies" ON companies;

CREATE POLICY "VD updates own company"
  ON companies FOR UPDATE TO authenticated
  USING (
    id IN (
      SELECT company_id FROM cleaners
       WHERE auth_user_id = auth.uid() AND is_company_owner = true
    )
  )
  WITH CHECK (
    id IN (
      SELECT company_id FROM cleaners
       WHERE auth_user_id = auth.uid() AND is_company_owner = true
    )
  );

CREATE POLICY "Admin updates all companies"
  ON companies FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- =============================================================
-- Fas 2.X iter 35 (2026-04-22): sekt 3 kommenterad ut
-- =============================================================
-- Orsak: booking_slots-tabellen finns INGENSTANS i lokal repo.
-- Prod har tabellen (rad 1521) men create-migration saknas.
-- Bör läggas till i framtida bootstrap-migration tillsammans med
-- sync_booking_to_slot-trigger + constraints.
--
-- Verifiering: båda policies FINNS i prod (rad 5068, 4484) och täcks
-- av 20260422130000_all_policies.sql.
-- =============================================================

-- -- 3) booking_slots ──────────────────────────────────────────
-- DROP POLICY IF EXISTS "System can update slots" ON booking_slots;
--
-- CREATE POLICY "Service role manages booking_slots"
--   ON booking_slots FOR ALL TO service_role
--   USING (true) WITH CHECK (true);
--
-- CREATE POLICY "Admin manages booking_slots"
--   ON booking_slots FOR ALL TO authenticated
--   USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- KVAR för Fas 0.2b (ej stängt här):
--   - cleaner_availability (v1) "Cleaners can manage own availability"
--     qual=true FOR ALL — kräver kod-fix först eftersom Rafael +
--     stadare-dashboard använder den; regression skulle bryta
--     schema-redigering.
--   - booking_checklists — stadare-dashboard.html:8717/8784 skickar
--     med anon-headers, måste ändras till _authHeaders innan RLS
--     stängs.
--   - 60+ SELECT-policies med qual=true → separat läs-audit.
-- ============================================================
