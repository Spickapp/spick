-- ============================================================
-- STUB: is_admin()-funktion
-- Källa: Refereras i booking_staff/adjustments/messages/photos/
--         modifications-policies ([add-booking-architecture-
--         tables.sql:34, 55, 71, 87, 108]) men definitionen
--         finns INTE i repo.
-- Regel #27-fix: dokumentera funktion från prod (eller skapa).
-- ============================================================
-- INSTRUKTIONER:
-- 1. Kör SQL #5 från 2026-04-18-rls-full-audit.md
-- 2. Om routine_definition returneras → kopiera den exakt
-- 3. Om tom → funktionen saknas i prod också → de 5 policies
--    som refererar den är sannolikt trasiga. Skapa funktionen.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS is_admin();

-- FYLL I FRÅN PROD:
-- Troligt mönster baserat på hur admin_users används på andra
-- ställen (20260402200002_admin_users_read_policy.sql:12):
--
-- CREATE OR REPLACE FUNCTION is_admin()
-- RETURNS boolean
-- LANGUAGE sql SECURITY DEFINER STABLE
-- AS $$
--   SELECT EXISTS (
--     SELECT 1 FROM admin_users
--     WHERE email = (auth.jwt() ->> 'email')
--   );
-- $$;
--
-- GRANT EXECUTE ON FUNCTION is_admin() TO anon, authenticated;

-- TODO: Ersätt med exakt definition från prod (eller om
-- funktionen saknas i prod: skapa med ovanstående mönster
-- och kör den i prod för att aktivera de 5 beroende policies).

COMMIT;

-- Verifiering:
-- SELECT is_admin();  -- returnerar true om inloggad som admin
-- SELECT routine_definition FROM information_schema.routines
-- WHERE routine_name = 'is_admin';
