-- ============================================================
-- Migration 20260418: self_invoices — stäng anon-läcka
-- ============================================================
-- Två problem funna 2026-04-19:
-- 1. Policy "Anon read all invoices" tillät anon läsa alla
--    fakturor.
-- 2. Policy "Service role full access" var för permissiv
--    (USING true utan role-restriktion) → bidrog till läckan.
--
-- Referens: docs/audits/2026-04-18-rls-full-audit.md Del A
-- ============================================================

BEGIN;

-- Stäng anon-läckan
DROP POLICY IF EXISTS "Anon read all invoices" ON self_invoices;

-- Återskapa service_role-policy korrekt scopad
DROP POLICY IF EXISTS "Service role full access" ON self_invoices;

CREATE POLICY "Service role full access"
  ON self_invoices FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;

-- Verifiering:
-- SET ROLE anon; SELECT COUNT(*) FROM self_invoices;  -- 0
-- Admin i admin.html: "Självfakturor" visar SF-2026-0001 intakt.
