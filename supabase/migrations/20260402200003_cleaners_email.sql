-- ============================================================
-- Migration 20260402200003: Add email column to cleaners
-- Several edge functions and admin views need cleaner email
-- but the column was missing from the original schema.
-- ============================================================

ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill from auth.users where auth_user_id is set
UPDATE cleaners c
SET email = u.email
FROM auth.users u
WHERE c.auth_user_id = u.id::text
  AND c.email IS NULL;

SELECT 'MIGRATION 20260402200003 COMPLETE — email column added to cleaners' AS result;
