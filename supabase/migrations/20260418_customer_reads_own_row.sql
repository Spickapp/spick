-- ============================================================
-- Migration 20260418: Customer reads own row (customers-tabell)
-- ============================================================
-- Ersättning för "Auth reads customers" (USING true) som droppa-
-- des 2026-04-19 kvällen. Begränsar anon/authenticated till att
-- bara se sin egen rad baserat på email.
--
-- Referens: docs/audits/2026-04-18-rls-full-audit.md Del A+C
-- Verifierat: SET ROLE anon returnerar 0 rader efter fix.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Customer reads own row" ON customers;

CREATE POLICY "Customer reads own row"
  ON customers FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

COMMIT;

-- Verifiering:
-- SET ROLE anon; SELECT COUNT(*) FROM customers;  -- 0
-- Logga in som kund → hämta /rest/v1/customers?select=* → bara egen rad.
