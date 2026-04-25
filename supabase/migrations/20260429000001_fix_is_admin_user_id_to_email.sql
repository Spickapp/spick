-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fix: is_admin() user_id → email (regression från Fas 8)
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Migration 20260427000009_fas8_rls_policies.sql gjorde CREATE OR
-- REPLACE FUNCTION public.is_admin() med en trasig body som
-- refererade admin_users.user_id — en kolumn som inte finns i prod.
-- Detta överskrev den fungerande email-baserade versionen från
-- 00000_fas_2_1_1_bootstrap_dependencies.sql (prod-schema rad 671-677).
--
-- KONSEKVENS
-- ~25 RLS-policies anropar is_admin(). Alla failar med 42703
-- "column user_id does not exist" vid SELECT. Effekt: admin.html
-- visar 0 städare, 0 kunder, 0 ansökningar — alla queries får 400/401
-- via olika kodvägar.
--
-- VERIFIERAT 2026-04-25 mot prod via curl:
--   - admin_users?select=user_id  → 42703 (kolumn saknas)
--   - admin_users?select=email    → 42501 (kolumn finns, RLS blockerar)
--   - rpc/is_admin                → 42703 (samma fel)
--
-- ROTORSAK
-- Rule #31-brott i Fas 8-migrationen: antog att admin_users hade
-- user_id-kolumn utan att verifiera mot prod. Primärnyckeln för
-- admin-identifiering har alltid varit email (matchar admin.html:1441
-- + admin.html:4975 + alla 25 befintliga policies som anropade den
-- ursprungliga email-versionen).
--
-- FIX
-- Återställ is_admin() till email-baserad lookup. Behåll defensiv
-- existence-check från Fas 8-versionen (skydd vid replay innan
-- admin_users-tabellen finns).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'admin_users' AND table_schema = 'public') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM admin_users WHERE email = (auth.jwt() ->> 'email')
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

-- ─────────────────────────────────────────────────────────────
-- VERIFIERING (kör efter migration i Studio)
-- ─────────────────────────────────────────────────────────────
-- 1. is_admin() returnerar utan fel:
--    SELECT public.is_admin();
--    -- Förväntat: false (kör som postgres-roll utan jwt) eller
--    -- true om körs i en authenticated session som admin.
--    -- INTE 42703-fel.
--
-- 2. Bookings-SELECT funkar igen för admin:
--    -- Logga in i admin.html → KPI-kort + städar-listan ska fyllas.
--    -- Console ska sluta visa "[reassignments] fetch error" + 400/401.
--
-- 3. Anon-fallet returnerar inte längre 42703 på bookings:
--    -- curl /rest/v1/bookings?select=id&limit=1
--    -- Förväntat: [] (RLS blockerar) eller specifika rader om
--    -- public read-policy finns. Tidigare: 42703 user_id error.
