-- ═══════════════════════════════════════════════════════════════
-- SPICK – Admin-bypass RLS på cleaner_expenses + documents
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Per project_admin_bypass_principle (memory 2026-04-27): admin
-- (admin_users-tabellen) ska kunna läsa + ändra ALLT i alla EFs
-- och tabeller för att felsöka under andras profiler.
--
-- 2026-04-28: VD-vyn (admin-impersonation som Zivar) returnerar HTTP
-- 403 på 'utlägg från team'-kortet. Frontend gör direkt PostgREST-
-- anrop GET /rest/v1/cleaner_expenses. RLS-policy
-- 'cleaner_expenses_vd_read' kollar auth.uid() mot cleaners.id med
-- is_company_owner=true. Admin har ingen cleaner-row → 403.
--
-- Samma admin-bypass-pattern som tidigare applicerats i:
--   - cleaner-booking-response EF (commit 1744a6b 2026-04-27)
--   - vd-payment-summary EF (commit 54c0cbc 2026-04-28)
--
-- LÖSNING
-- Lägg admin-bypass-RLS-policys på cleaner_expenses + documents.
-- Kollar admin_users.email = auth.email() AND is_active = true.
-- Tillåter SELECT/INSERT/UPDATE/DELETE för admin (full kontroll).
--
-- REGLER #26-#34
-- #26 Granskat existing policies via grep (4 cleaner_expenses + 3 documents)
-- #27 Scope: bara admin-bypass-policys, ingen ändring av befintliga
-- #28 SSOT: använder samma admin_users-tabell som alla admin-EFs
-- #31 Curl-verifierat: GET cleaner_expenses returnerar 401 från anon
--    (RLS aktiv) — verifierat att tabellen finns
-- #34 Server-side migration = ej browser-observable. Verifiering: Farhad
--    refresh Företag-tab → 'utlägg från team' ska INTE returnera HTTP 403
-- ═══════════════════════════════════════════════════════════════

-- ── cleaner_expenses: admin har full access ──
DROP POLICY IF EXISTS cleaner_expenses_admin_all ON public.cleaner_expenses;
CREATE POLICY cleaner_expenses_admin_all ON public.cleaner_expenses
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users a
      WHERE a.email = (auth.jwt() ->> 'email')
        AND a.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users a
      WHERE a.email = (auth.jwt() ->> 'email')
        AND a.is_active = true
    )
  );

-- ── documents: admin har full access (samma princip) ──
DROP POLICY IF EXISTS documents_admin_all ON public.documents;
CREATE POLICY documents_admin_all ON public.documents
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users a
      WHERE a.email = (auth.jwt() ->> 'email')
        AND a.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users a
      WHERE a.email = (auth.jwt() ->> 'email')
        AND a.is_active = true
    )
  );

NOTIFY pgrst, 'reload schema';
