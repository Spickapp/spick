-- ═══════════════════════════════════════════════════════════════
-- SPICK – companies.phone (företagstelefon för publika profiler)
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Företag behöver eget telefonnummer som visas på spick.se/f/<slug>.
-- Förr hämtade vi owner_cleaner.phone (personligt nummer) — men företag
-- vill ofta ha växel-nr eller företagsmobil separat.
--
-- DESIGN
-- - companies.phone (TEXT, valfri)
-- - v_company_owner_phone uppdateras: föredrar companies.phone om satt,
--   annars fallback till owner_cleaner.phone (bakåtkompat).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.companies.phone IS
  'Företagstelefon (visas publikt på foretag.html). Kan skilja sig från owner_cleaner.phone som är personligt.';

-- Uppdatera vyn att föredra companies.phone om satt
CREATE OR REPLACE VIEW public.v_company_owner_phone AS
SELECT
  comp.id   AS company_id,
  comp.slug AS company_slug,
  COALESCE(NULLIF(TRIM(comp.phone), ''), c.phone) AS owner_phone
FROM public.companies comp
LEFT JOIN public.cleaners c ON c.id = comp.owner_cleaner_id;

GRANT SELECT ON public.v_company_owner_phone TO anon, authenticated;

DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 20260427170000 COMPLETE — companies.phone + v_company_owner_phone-fallback';
END $$;
