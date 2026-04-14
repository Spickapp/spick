-- Backfill företagsslug för existerande companies
-- Kör detta manuellt i Supabase SQL Editor (eller via supabase db push)
--
-- Mönster matchar admin-approve-cleaner/index.ts:
--   lowercase, å/ä → a, ö → o, alla icke-alfanumeriska → "-", trim "-"

UPDATE companies
SET slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(name, '[åä]', 'a', 'g'),
      'ö', 'o', 'g'),
    '[^a-z0-9]+', '-', 'g'),
  '^-|-$', '', 'g')
)
WHERE slug IS NULL OR slug = '';

-- Verifiera efteråt:
-- SELECT id, name, slug FROM companies;
