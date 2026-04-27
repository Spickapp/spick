-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fix rut_consents missing columns (drift repo vs prod)
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- 2026-04-27: Zivar (Solid Service VD) fick fel vid godkänn-avtals-
-- flowen: "Could not find the 'cleaner_id' column of 'rut_consents'".
--
-- ROOT CAUSE
-- rut_consents-tabellen skapades manuellt i prod tidigare (kund-RUT)
-- och hade bara: id, booking_id, customer_email, tic_session_id,
-- consent_text, pnr_hash, expires_at.
-- TIC #1-design förutsätter kolumner för cleaner-registration-purpose
-- + company-onboarding (per docs/implementation/2026-04-25-item1-bankid).
-- Dessa kolumner ANTOGS existera men gjorde det inte.
--
-- EFs som SKICKAR dessa kolumner:
-- - register-bankid-init (godkänn underleverantörsavtal) ← Zivar's flow
-- - rut-bankid-init (kund-RUT-consent)
-- - company-self-signup (företagsregistrering)
--
-- LÖSNING
-- Lägg till saknade kolumner via ALTER TABLE. Inga befintliga rader
-- påverkas (alla nya kolumner är nullable + utan default).
--
-- REGLER #26-#33:
-- #28 SSOT — purpose är enum-aware (cleaner_registration, customer_pnr_verification)
-- #31 Schema-curl-verifierat: "permission denied for table rut_consents"
--   (RLS-skyddad → tabell finns, men kolumner verifieras via INSERT-fel
--    i Sentry/console)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.rut_consents
  ADD COLUMN IF NOT EXISTS cleaner_id UUID REFERENCES public.cleaners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purpose TEXT,
  ADD COLUMN IF NOT EXISTS terms_versions JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.rut_consents.cleaner_id IS
  'FK till cleaner. NULL för kund-RUT-consents (där customer_email används istället).';
COMMENT ON COLUMN public.rut_consents.company_id IS
  'FK till företag. Används vid company-onboarding-purpose.';
COMMENT ON COLUMN public.rut_consents.purpose IS
  'Vad consent gäller: cleaner_registration | customer_pnr_verification | company_onboarding | booking_rut';
COMMENT ON COLUMN public.rut_consents.terms_versions IS
  'JSONB med vilka avtals-versioner som godkänts (ex: {"underleverantorsavtal":"v1.0","gdpr":"v1.0"}).';

-- Index för cleaner_id-lookup (Spick stadare-dashboard query:ar status)
CREATE INDEX IF NOT EXISTS idx_rut_consents_cleaner
  ON public.rut_consents(cleaner_id, created_at DESC)
  WHERE cleaner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rut_consents_company
  ON public.rut_consents(company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rut_consents_purpose
  ON public.rut_consents(purpose, created_at DESC)
  WHERE purpose IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- Force PostgREST schema-cache reload
-- ═══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
-- Verifiering
-- ═══════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_cleaner_id_exists BOOLEAN;
  v_company_id_exists BOOLEAN;
  v_purpose_exists BOOLEAN;
  v_versions_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rut_consents' AND column_name = 'cleaner_id'
  ) INTO v_cleaner_id_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rut_consents' AND column_name = 'company_id'
  ) INTO v_company_id_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rut_consents' AND column_name = 'purpose'
  ) INTO v_purpose_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rut_consents' AND column_name = 'terms_versions'
  ) INTO v_versions_exists;

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 20260427200000 — rut_consents missing columns';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  cleaner_id:        %', CASE WHEN v_cleaner_id_exists THEN '✓ EXISTS' ELSE '✗ MISSING' END;
  RAISE NOTICE '  company_id:        %', CASE WHEN v_company_id_exists THEN '✓ EXISTS' ELSE '✗ MISSING' END;
  RAISE NOTICE '  purpose:           %', CASE WHEN v_purpose_exists THEN '✓ EXISTS' ELSE '✗ MISSING' END;
  RAISE NOTICE '  terms_versions:    %', CASE WHEN v_versions_exists THEN '✓ EXISTS' ELSE '✗ MISSING' END;
  RAISE NOTICE '  PostgREST cache:   reload triggered';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Zivar kan nu signera underleverantörsavtal via BankID.';
END $$;
