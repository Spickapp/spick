-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fix rut_consents.customer_email NOT NULL constraint
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- 2026-04-27: Zivar (Solid Service VD) BankID-signering misslyckades med:
-- "null value in column 'customer_email' of relation 'rut_consents'
--  violates not-null constraint"
--
-- ROOT CAUSE
-- rut_consents-tabellen designades ursprungligen för kund-RUT-consents
-- där customer_email = obligatorisk. När TIC #1 utvidgades till
-- cleaner_registration + company_signup-purposes, är customer_email
-- inte applicable (det är inte en kund som signerar). EFs skickar
-- customer_email: null → fail på NOT NULL-constraint.
--
-- LÖSNING
-- DROP NOT NULL på customer_email. Constraint per purpose hanteras
-- istället via EF-validering (booking_rut kräver email, cleaner_registration
-- gör inte).
--
-- VERIFIERING
-- - INSERT med purpose='cleaner_registration' + customer_email=null → OK
-- - INSERT med purpose='booking_rut' + customer_email=null → fångas av EF
--
-- REGLER #26-#33:
-- #31 Curl-verifierat exakt felmeddelande mot prod (2026-04-27 21:33)
-- #28 Constraint-flytt från DB till EF-validering är acceptabelt eftersom
--    purpose-aware logic kräver app-level decision (inte DB-trigger)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.rut_consents
  ALTER COLUMN customer_email DROP NOT NULL;

COMMENT ON COLUMN public.rut_consents.customer_email IS
  'Kundens email. Obligatorisk för purpose=booking_rut, NULL för cleaner_registration/company_signup. EF validerar per-purpose.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_is_nullable TEXT;
BEGIN
  SELECT is_nullable INTO v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'rut_consents'
    AND column_name = 'customer_email';

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 20260427210000 — rut_consents.customer_email NULLABLE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  customer_email is_nullable: %', v_is_nullable;
  RAISE NOTICE '  Zivar kan nu signera underleverantörsavtal.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
