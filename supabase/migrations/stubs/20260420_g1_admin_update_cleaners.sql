-- ============================================================
-- STUB: Admin UPDATE-policy på cleaners
-- Källa: Tidigare audit ([2026-04-19-admin-impersonation-vs-editing.md])
--         bekräftade att admin-UI uppdaterar cleaners i prod,
--         men ingen sådan policy finns i repo.
-- Regel #27-fix: dokumentera odokumenterad prod-policy.
-- ============================================================
-- INSTRUKTIONER:
-- 1. Kör SQL #3 från 2026-04-18-rls-full-audit.md
-- 2. Hitta policyn som matchar admin-update-mönster (troligen
--    policyname innehåller "admin" eller "hello@spick.se" eller
--    baseras på admin_users-lookup)
-- 3. Ersätt "FYLL I FRÅN PROD"-blocket med exakt qual+with_check
--    som visas i pg_policies-output.
-- 4. Byt namn på filen från stubs/ till faktisk migration
--    (20260420_admin_update_cleaners_policy.sql) och flytta
--    till supabase/migrations/.
-- ============================================================

BEGIN;

-- Dropa ev. existerande för att göra idempotent
DROP POLICY IF EXISTS "Admin can update cleaners" ON cleaners;

-- FYLL I FRÅN PROD:
-- Baserat på pg_policies-output, ersätt nedan med den faktiska
-- qual-klausulen. Exempel (FÖR-test, verifiera!):
--
-- CREATE POLICY "Admin can update cleaners"
--   ON cleaners FOR UPDATE
--   TO authenticated
--   USING (
--     auth.jwt() ->> 'email' IN (
--       SELECT email FROM admin_users
--     )
--   )
--   WITH CHECK (
--     auth.jwt() ->> 'email' IN (
--       SELECT email FROM admin_users
--     )
--   );

-- TODO: Ersätt med exakt policy från prod

COMMIT;

-- Verifiering efter körning:
-- SELECT policyname, cmd, qual FROM pg_policies
-- WHERE tablename = 'cleaners' AND cmd = 'UPDATE';
