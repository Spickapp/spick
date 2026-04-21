-- ============================================================
-- STUB: Admin SELECT-policies för 5 tabeller
-- Källa: [2026-04-19-view-as-impersonate-analys.md Uppgift 4]
--         bekräftade 401-errors från admin.html på:
--         customer_profiles, companies, admin_audit_log,
--         cleaner_service_prices, cleaner_availability
-- Regel #27-fix: lägg till admin-SELECT baserat på admin_users.
-- ============================================================
-- NOTE: admin_audit_log hanteras i 20260420_g4_admin_audit_log_insert.sql
-- Denna fil täcker de övriga 4.
-- ============================================================

BEGIN;

-- ── customer_profiles ─────────────────────────────────────
DROP POLICY IF EXISTS "Admin SELECT customer profiles" ON customer_profiles;

CREATE POLICY "Admin SELECT customer profiles"
  ON customer_profiles FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN (SELECT email FROM admin_users)
  );

-- ── companies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin SELECT companies" ON companies;

CREATE POLICY "Admin SELECT companies"
  ON companies FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN (SELECT email FROM admin_users)
  );

-- ── cleaner_service_prices ────────────────────────────────
DROP POLICY IF EXISTS "Admin SELECT cleaner service prices" ON cleaner_service_prices;

CREATE POLICY "Admin SELECT cleaner service prices"
  ON cleaner_service_prices FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN (SELECT email FROM admin_users)
  );

-- ── cleaner_availability (v1 — bör vara USING(true) redan) ──
-- OM SQL #3-output visar att v1 saknar policy för authenticated,
-- uncomment nedan:
-- DROP POLICY IF EXISTS "Admin SELECT cleaner availability v1" ON cleaner_availability;
-- CREATE POLICY "Admin SELECT cleaner availability v1"
--   ON cleaner_availability FOR SELECT
--   TO authenticated
--   USING (
--     auth.jwt() ->> 'email' IN (SELECT email FROM admin_users)
--   );

-- ── company_service_prices (om saknar RLS helt) ────────────
-- VERIFIERA FÖRST via SQL #2 om rowsecurity=true
-- OM true OCH inga admin-policies finns:
-- DROP POLICY IF EXISTS "Admin manage company service prices" ON company_service_prices;
-- CREATE POLICY "Admin manage company service prices"
--   ON company_service_prices FOR ALL
--   TO authenticated
--   USING (
--     auth.jwt() ->> 'email' IN (SELECT email FROM admin_users)
--   );

COMMIT;

-- Verifiering:
-- Logga in som admin.html → kontrollera att inga 401-errors
-- uppstår vid loadAll()-anrop.
