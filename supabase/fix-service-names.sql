-- Spick: Rensa emoji-prefixade tjänstnamn i cleaners.services
-- Påverkar: 6 städare med emoji-tjänstnamn
-- Säkert: Ändrar bara text, ingen strukturell ändring

-- Steg 1: Ersätt emoji-varianter med rena namn
UPDATE cleaners
SET services = (
  SELECT jsonb_agg(
    CASE
      WHEN elem::text LIKE '%Hemstädning%' THEN '"Hemstädning"'::jsonb
      WHEN elem::text LIKE '%Storstädning%' THEN '"Storstädning"'::jsonb
      WHEN elem::text LIKE '%Flyttstädning%' THEN '"Flyttstädning"'::jsonb
      WHEN elem::text LIKE '%Fönsterputs%' THEN '"Fönsterputs"'::jsonb
      WHEN elem::text LIKE '%Kontor%' THEN '"Kontorsstädning"'::jsonb
      ELSE elem
    END
  )
  FROM jsonb_array_elements(services) AS elem
)
WHERE services::text LIKE '%🏠%'
   OR services::text LIKE '%✨%'
   OR services::text LIKE '%📦%'
   OR services::text LIKE '%🪟%'
   OR services::text LIKE '%🏢%';

-- Steg 2: Samma för cleaner_applications
UPDATE cleaner_applications
SET services = (
  SELECT jsonb_agg(
    CASE
      WHEN elem::text LIKE '%Hemstädning%' THEN '"Hemstädning"'::jsonb
      WHEN elem::text LIKE '%Storstädning%' THEN '"Storstädning"'::jsonb
      WHEN elem::text LIKE '%Flyttstädning%' THEN '"Flyttstädning"'::jsonb
      WHEN elem::text LIKE '%Fönsterputs%' THEN '"Fönsterputs"'::jsonb
      WHEN elem::text LIKE '%Kontor%' THEN '"Kontorsstädning"'::jsonb
      ELSE elem
    END
  )
  FROM jsonb_array_elements(services) AS elem
)
WHERE services::text LIKE '%🏠%'
   OR services::text LIKE '%✨%'
   OR services::text LIKE '%📦%'
   OR services::text LIKE '%🪟%'
   OR services::text LIKE '%🏢%';

-- Steg 3: Verifiera — inga emojis kvar
SELECT id, full_name, services FROM cleaners WHERE services::text ~ '[^\x00-\x7F]' AND services::text NOT LIKE '%ä%' AND services::text NOT LIKE '%ö%' AND services::text NOT LIKE '%å%' AND services::text NOT LIKE '%Å%';
