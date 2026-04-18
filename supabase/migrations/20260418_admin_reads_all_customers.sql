-- ============================================================
-- Migration 20260418: Admin reads all customers
-- ============================================================
-- Komplement till "Customer reads own row" — admin (via
-- admin_users-lookup) kan läsa alla rader för support/audit.
--
-- Referens: docs/audits/2026-04-18-rls-full-audit.md Del D.1
-- Regel #27: stänger 401-errors från admin.html på customers.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Admin reads all customers" ON customers;

CREATE POLICY "Admin reads all customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN (SELECT email FROM admin_users)
  );

COMMIT;

-- Verifiering:
-- Logga in som admin (hello@spick.se) i admin.html.
-- Navigera till "Kunder" → listan ska visa alla kunder utan 401.
