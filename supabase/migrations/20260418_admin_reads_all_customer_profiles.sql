-- ============================================================
-- Migration 20260418: Admin reads all customer_profiles
-- ============================================================
-- Komplement till "Customer reads own profile" — admin (via
-- admin_users-lookup) kan läsa alla rader för support/audit.
--
-- Uppdaterad 2026-04-22 (§2.4) efter prod-verifiering:
-- - Originalmigration (filnamn `admin_reads_all_customers.sql`) hade
--   fel tabellnamn: `customers` existerar inte i prod, tabellen heter
--   `customer_profiles`. Migrationen kunde aldrig köras.
-- - Filnamn bytt: ..._customers.sql → ..._customer_profiles.sql
-- - Target-tabell: customers → customer_profiles
-- - Policy-namn: "Admin reads all customers" → "admin_reads_all_customer_profiles"
--   (snake_case matchar prod-schema.sql rad 5385)
-- - DROP IF EXISTS för båda namnen för idempotens (om någon kört
--   originalmigrationen på en alternativ DB)
--
-- Hygien-notering: prod har TVÅ policies med identisk logik på
-- customer_profiles — denna policy + "Admin SELECT customer profiles"
-- (rad 4473). Konsolidering flaggad som hygien-task i
-- docs/v3-phase1-progress.md.
--
-- Referens: docs/audits/2026-04-18-rls-full-audit.md Del D.1
-- Regel #27: stänger 401-errors från admin.html på customer_profiles.
-- ============================================================

BEGIN;

-- Idempotens: rensa både gamla (felaktiga) och nya policy-namn
DROP POLICY IF EXISTS "Admin reads all customers" ON customer_profiles;
DROP POLICY IF EXISTS "admin_reads_all_customer_profiles" ON customer_profiles;

CREATE POLICY "admin_reads_all_customer_profiles"
  ON customer_profiles FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN (SELECT email FROM admin_users)
  );

COMMIT;

-- Verifiering:
-- Logga in som admin (hello@spick.se) i admin.html.
-- Navigera till "Kunder" → listan ska visa alla rader utan 401.
-- SQL: SELECT policyname, cmd FROM pg_policies
--      WHERE tablename='customer_profiles' AND policyname='admin_reads_all_customer_profiles';
