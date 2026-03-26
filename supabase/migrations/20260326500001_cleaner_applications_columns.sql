-- Lägg till saknade kolumner i cleaner_applications
ALTER TABLE cleaner_applications
  ADD COLUMN IF NOT EXISTS available_days TEXT,
  ADD COLUMN IF NOT EXISTS languages      TEXT,
  ADD COLUMN IF NOT EXISTS hourly_rate    INTEGER DEFAULT 350,
  ADD COLUMN IF NOT EXISTS has_fskatt     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_insurance  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS bio            TEXT;

SELECT 'Migration 20260326500001 klar ✅' AS status;
