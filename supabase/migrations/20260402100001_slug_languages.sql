-- ============================================================
-- Migration 20260402100001: slug, languages, specialties on cleaners
-- Adds missing columns referenced by stadare-profil.html and
-- referral-register edge function
-- ============================================================

-- 1. slug — unique human-readable URL identifier
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- Generate slugs from full_name for existing rows (lowercase, hyphens)
UPDATE cleaners
SET slug = lower(
  regexp_replace(
    regexp_replace(full_name, '[^a-zA-Z0-9åäöÅÄÖ ]', '', 'g'),
    '\s+', '-', 'g'
  )
) || '-' || left(id::text, 4)
WHERE slug IS NULL AND full_name IS NOT NULL;

-- Unique index so .eq('slug', slug) works efficiently
CREATE UNIQUE INDEX IF NOT EXISTS idx_cleaners_slug
  ON cleaners (slug) WHERE slug IS NOT NULL;

-- 2. languages — upgrade from TEXT to TEXT[] if needed, or add
DO $$
BEGIN
  -- If column exists as plain TEXT, drop and re-add as TEXT[]
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cleaners'
      AND column_name = 'languages'
      AND data_type = 'text'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE cleaners ALTER COLUMN languages TYPE TEXT[]
      USING CASE
        WHEN languages IS NULL THEN NULL
        WHEN languages = '' THEN '{}'::TEXT[]
        ELSE string_to_array(languages, ',')
      END;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cleaners' AND column_name = 'languages'
  ) THEN
    ALTER TABLE cleaners ADD COLUMN languages TEXT[];
  END IF;
END $$;

-- GIN index for array containment queries (@>)
CREATE INDEX IF NOT EXISTS idx_cleaners_languages
  ON cleaners USING gin (languages) WHERE languages IS NOT NULL;

-- 3. specialties — array of service specialties
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS specialties TEXT[];

CREATE INDEX IF NOT EXISTS idx_cleaners_specialties
  ON cleaners USING gin (specialties) WHERE specialties IS NOT NULL;

-- 4. RLS policies for new columns (table-level RLS already enabled)
-- Public read access on slug for profile lookups
DROP POLICY IF EXISTS "Anyone can read cleaner slug" ON cleaners;
CREATE POLICY "Anyone can read cleaner slug"
  ON cleaners FOR SELECT
  USING (true);

-- Cleaners can update their own slug, languages, specialties
DROP POLICY IF EXISTS "Cleaners can update own profile columns" ON cleaners;
CREATE POLICY "Cleaners can update own profile columns"
  ON cleaners FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================
SELECT 'MIGRATION 20260402100001 COMPLETE — slug, languages, specialties added to cleaners' AS result;
