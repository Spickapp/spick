-- ============================================================
-- Migration 20260402200001: Add availability_schedule JSONB to cleaners
-- Referenced by admin.html (fallback schedule display) and
-- cleaner-job-match edge function (availability scoring).
-- Format: { "Måndag": { "active": true, "start": "08:00", "end": "17:00" }, ... }
-- ============================================================

ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS availability_schedule JSONB;

CREATE INDEX IF NOT EXISTS idx_cleaners_availability_schedule
  ON cleaners USING gin (availability_schedule) WHERE availability_schedule IS NOT NULL;

SELECT 'MIGRATION 20260402200001 COMPLETE — availability_schedule added to cleaners' AS result;
