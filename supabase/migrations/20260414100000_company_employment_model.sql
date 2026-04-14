-- Lägg till employment_model på companies
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS employment_model TEXT DEFAULT 'employed'
CHECK (employment_model IN ('employed', 'contractor'));

COMMENT ON COLUMN companies.employment_model IS 'employed = anställda (utbetalning till företag), contractor = underleverantörer (utbetalning per person)';
