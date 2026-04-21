-- ============================================================
-- Migration 20260418: Admin UPDATE-policy på cleaners
-- ============================================================
-- Dokumenterar policy som finns i prod sedan tidigare men
-- saknades i repo. Verifierad via pg_policies-query
-- 2026-04-19 kvällen (Fas 0.1 RLS-audit).
--
-- Uppdaterad 2026-04-22 (§2.4): TO authenticated borttagen för
-- match mot prod (prod-schema.sql rad 4514 saknar TO-klausul =
-- implicit TO public). Säkerhets-uppgradering till TO authenticated
-- flaggad som hygien-task i docs/v3-phase1-progress.md.
--
-- Referens: docs/audits/2026-04-18-rls-full-audit.md Del C.1
-- Regel #27: prod ≠ repo stängs här.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Admin can update any cleaner" ON cleaners;

CREATE POLICY "Admin can update any cleaner"
  ON cleaners FOR UPDATE
  USING (auth.jwt() ->> 'email' = 'hello@spick.se')
  WITH CHECK (auth.jwt() ->> 'email' = 'hello@spick.se');

COMMIT;

-- Verifiering:
-- SELECT policyname, cmd, qual FROM pg_policies
--   WHERE tablename = 'cleaners' AND policyname = 'Admin can update any cleaner';
