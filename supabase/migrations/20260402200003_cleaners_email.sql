-- ============================================================
-- Migration 20260402200003: Add email column to cleaners
-- Several edge functions and admin views need cleaner email
-- but the column was missing from the original schema.
-- ============================================================

ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS email TEXT;

-- =============================================================
-- Fas 2.X iter 32 (2026-04-22): UPDATE kommenterad ut
-- =============================================================
-- Original: Backfill email från auth.users via auth_user_id.
--
-- Bug: c.auth_user_id är UUID, u.id::text är TEXT. uuid=text failar.
-- Prod cleaners.auth_user_id är UUID (rad 1891), vår 00004 likaså (rad 17).
-- Filen har aldrig kunnat köra mot prod utan manuell cast-fix.
-- cleaners.email-kolumnen fylldes troligen via Studio-backfill.
--
-- I fresh DB är auth.users tom ändå → UPDATE är no-op även utan fel.
-- =============================================================

-- UPDATE cleaners c
-- SET email = u.email
-- FROM auth.users u
-- WHERE c.auth_user_id = u.id::text
--   AND c.email IS NULL;

SELECT 'MIGRATION 20260402200003 COMPLETE — email column added to cleaners' AS result;
