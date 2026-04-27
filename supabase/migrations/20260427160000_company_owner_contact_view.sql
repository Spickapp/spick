-- ═══════════════════════════════════════════════════════════════
-- SPICK – Public view: company-owner phone (för foretag.html "Ring oss")
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- foretag.html (publik företagsprofil) hade hardcoded Spick-supportnr
-- på "Ring oss"-knappen. Korrekt beteende = ringa företaget direkt
-- (owner_cleaner.phone). Men cleaners-tabellen är RLS-skyddad → anon
-- kan inte läsa phone direkt.
--
-- LÖSNING: minimal view som exponerar BARA owner-phone (inget annat).
-- Kunder som besöker spick.se/f/<slug> kan se företagets telefon
-- — samma exposure-nivå som om företaget hade phone-fältet på sin
-- public profile (vilket är affärs-syftet).
--
-- SÄKERHET
-- - Bara phone exponeras (inte email/personnr/adress)
-- - Bara company-owners (inte alla cleaners)
-- - Anon SELECT — för publika företagsprofiler
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_company_owner_phone AS
SELECT
  comp.id   AS company_id,
  comp.slug AS company_slug,
  c.phone   AS owner_phone
FROM public.companies comp
LEFT JOIN public.cleaners c ON c.id = comp.owner_cleaner_id;

GRANT SELECT ON public.v_company_owner_phone TO anon, authenticated;

DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 20260427160000 COMPLETE — v_company_owner_phone view';
END $$;
