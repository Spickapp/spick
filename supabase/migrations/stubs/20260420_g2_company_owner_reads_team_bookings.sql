-- ============================================================
-- STUB: "Company owner reads team bookings" på bookings
-- Källa: Farhad bekräftade i tidigare session att denna policy
--         finns i prod. Den möjliggör att stadare-dashboard.html
--         (rad 6171-6175) kan visa team-bokningar för VD.
-- Regel #27-fix: dokumentera odokumenterad prod-policy.
-- ============================================================
-- INSTRUKTIONER:
-- 1. Kör SQL #4 från 2026-04-18-rls-full-audit.md
-- 2. Hitta policyn med "Company owner" eller "company" i namnet
-- 3. Ersätt USING-blocket nedan med exakt qual från prod
-- 4. Flytta från stubs/ till supabase/migrations/
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Company owner reads team bookings" ON bookings;

-- FYLL I FRÅN PROD:
-- Troligt mönster baserat på sql/companies-and-teams.sql:55-61
-- (samma logik men på bookings istället för cleaners):
--
-- CREATE POLICY "Company owner reads team bookings"
--   ON bookings FOR SELECT
--   TO authenticated
--   USING (
--     cleaner_id IN (
--       SELECT c.id FROM cleaners c
--       WHERE c.company_id IN (
--         SELECT c2.company_id FROM cleaners c2
--         WHERE c2.auth_user_id = auth.uid()
--           AND c2.is_company_owner = true
--       )
--     )
--   );

-- TODO: Ersätt med exakt policy från prod

COMMIT;

-- Verifiering:
-- SELECT policyname, cmd, qual FROM pg_policies
-- WHERE tablename = 'bookings' AND policyname LIKE '%ompany%';
