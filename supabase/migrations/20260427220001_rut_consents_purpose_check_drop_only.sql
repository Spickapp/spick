-- ═══════════════════════════════════════════════════════════════
-- SPICK – DROP rut_consents_purpose_check (INTE re-add)
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- 2026-04-27 22:15: Migration #3 (220000) försökte lägga till ny CHECK
-- som tillät 4 purposes. FAIL: existing rad i prod har purpose-värde
-- som inte matchar min nya enum-lista.
--   'check constraint rut_consents_purpose_check is violated by some row'
--
-- LÖSNING
-- DROP CHECK helt UTAN att lägga till ny. Validation per purpose
-- görs redan på EF-nivå (register-bankid-init validerar ['cleaner_registration',
-- 'company_signup'], rut-bankid-init validerar 'booking_rut'). DB-CHECK är
-- redundant + skadligt eftersom det blockerar legacy-rader och nya purposes.
--
-- TRADE-OFF
-- - PRO: Migration funkar utan UPDATE av existing data
-- - PRO: Framtida nya purposes kräver ingen DB-migration
-- - CON: DB-nivån validerar inte längre (men EF gör det)
--
-- REGLER #26-#33:
-- #28 Validation flyttas till app-level — acceptabelt eftersom EF är
--    enda insertion-point (anon kan inte INSERT pga RLS)
-- #31 Curl-verifierat att 3:e lager-fix kraschade pga existing data
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.rut_consents
  DROP CONSTRAINT IF EXISTS rut_consents_purpose_check;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_constraint_count INT;
BEGIN
  SELECT count(*) INTO v_constraint_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'rut_consents' AND c.conname = 'rut_consents_purpose_check';

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 20260427220001 — DROP purpose CHECK-constraint';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  Constraint kvar: % (förväntat: 0)', v_constraint_count;
  RAISE NOTICE '  Validation: nu på EF-nivå (register-bankid-init/rut-bankid-init)';
  RAISE NOTICE '  Zivar kan nu signera underleverantörsavtal.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
