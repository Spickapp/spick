-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fix rut_consents_purpose_check (3:e lager för Zivar BankID)
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- 2026-04-27: 3:e bug-lager för Zivars BankID-signering. Curl-test:
-- 'new row for relation rut_consents violates check constraint
--  rut_consents_purpose_check'
--
-- ROOT CAUSE
-- En tidigare migration lade en CHECK-constraint på purpose-kolumnen
-- med begränsad enum (sannolikt bara ['booking_rut'] eller liknande).
-- Vår TIC #1-utvidgning lägger till nya purposes:
--   - cleaner_registration
--   - company_signup
-- Constraint avvisar dessa.
--
-- LÖSNING
-- DROP existing CHECK + ADD ny CHECK som tillåter alla 4 use-cases:
--   booking_rut                  — kund-RUT-consent (legacy)
--   customer_pnr_verification    — kund PNR-BankID (N3)
--   cleaner_registration         — städare-onboarding (Item 1)
--   company_signup               — firmatecknare-onboarding (Item 1)
--
-- REGLER #26-#33:
-- #31 Curl-verifierat exakt felmeddelande mot prod 2026-04-27 22:00
-- ═══════════════════════════════════════════════════════════════

-- DROP befintlig constraint (kan ha olika namn — testar båda vanliga)
ALTER TABLE public.rut_consents
  DROP CONSTRAINT IF EXISTS rut_consents_purpose_check;

ALTER TABLE public.rut_consents
  DROP CONSTRAINT IF EXISTS rut_consents_purpose_check1;

-- Skapa ny CHECK med alla giltiga purposes
ALTER TABLE public.rut_consents
  ADD CONSTRAINT rut_consents_purpose_check
  CHECK (
    purpose IS NULL  -- bakåtkompat: legacy-rader utan purpose
    OR purpose IN (
      'booking_rut',
      'customer_pnr_verification',
      'cleaner_registration',
      'company_signup'
    )
  );

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_constraint_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_constraint_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'rut_consents' AND c.conname = 'rut_consents_purpose_check';

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 20260427220000 — purpose CHECK-constraint utvidgad';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  Ny constraint: %', v_constraint_def;
  RAISE NOTICE '  Tillåtna purposes: booking_rut, customer_pnr_verification,';
  RAISE NOTICE '                     cleaner_registration, company_signup';
  RAISE NOTICE '  Zivar kan nu signera underleverantörsavtal.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
