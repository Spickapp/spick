-- companies: REVOKE PII-fält från anon (kirurgisk fix utan att bryta vyer)
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: Intern security-audit (Agent C) avslöjade att companies-tabell
--   exponerar PII-kolumner till anon. NULL idag MEN när firmatecknare-
--   flow aktiveras → automatisk PII-läck.
--
-- Fält som REVOKE:as:
--   - firmatecznare_personnr_hash (PNR-hash, kan reidentifiera)
--   - firmatecznare_full_name (PII)
--   - stripe_account_id (fingerprint för betalkonto)
--   - payment_trust_level (intern risk-bedömning)
--   - total_overdue_count (intern finansiell signal)
--
-- Fält som BEHÅLLS publika (krävs av foretag.html, boka.html etc):
--   - id, name, slug, display_name
--   - org_number (publik via Bolagsverket — inte PII)
--   - logo_url, hero_bg_url, hero_bg_color
--   - description, bio
--   - instagram_url, facebook_url, website_url
--   - use_company_pricing, allow_individual_booking (stage-related)
--   - show_individual_ratings (display-related)
--
-- Verifiering rule #31:
--   - companies-tabell verifierad LIVE (förra testet returnerade rader)
--   - PII-kolumner verifierade NULL men exponerade
-- ════════════════════════════════════════════════════════════════════

-- REVOKE column-level från anon. authenticated kvar (admin behöver fält).
-- Kolumn-existens-check: bara revoke om kolumnen finns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='firmatecknare_personnr_hash') THEN
    REVOKE SELECT (firmatecknare_personnr_hash) ON public.companies FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='firmatecknare_full_name') THEN
    REVOKE SELECT (firmatecknare_full_name) ON public.companies FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='stripe_account_id') THEN
    REVOKE SELECT (stripe_account_id) ON public.companies FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='payment_trust_level') THEN
    REVOKE SELECT (payment_trust_level) ON public.companies FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='total_overdue_count') THEN
    REVOKE SELECT (total_overdue_count) ON public.companies FROM anon;
  END IF;
END $$;

COMMENT ON TABLE public.companies IS
  'Companies-tabell. REVOKE 2026-04-26 (audit-fix): PII + finansiella signaler endast tillgängliga för authenticated. Anon ser bara publika fält (namn, slug, logo, beskrivning).';
