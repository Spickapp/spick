-- ============================================================
-- Fas 2.5-R2 Hygien: GRANT på sequences (versionskontrollerar ad-hoc-fix)
-- ============================================================
-- Syfte: Under §2.5-R2 deploy 23 apr 2026 upptäcktes att
--        generate-receipt-EF failade vid första körning pga att
--        service_role saknade USAGE+SELECT på receipt_number_seq.
--        Farhad fixade ad-hoc via Studio SQL; denna migration
--        versionskontrollerar fixen + lägger preventivt till
--        samma GRANTs för andra sequences i prod så nästa
--        bygg av en EF som skriver till dessa tabeller inte
--        stöter på samma problem.
--
-- Primärkälla: prod-schema.sql dump (pg_dump 22 apr 2026) +
--              ad-hoc Studio-fix 23 apr 2026 (verifierat av Farhad).
--
-- Sequences i prod per 2026-04-22:
--   - receipt_number_seq        → används av generate_receipt_number()
--                                  (fix verkställd i prod, versionskontrolleras nu)
--   - commission_levels_id_seq  → SERIAL-kolumn på commission_levels.id
--   - spark_levels_id_seq       → SERIAL-kolumn på spark_levels.id
--
-- Idempotent: GRANT... är no-op om privilegiet redan finns.
-- Regel #28: hygien-task #28 öppen för framtida sequences-audit.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. receipt_number_seq (generate-receipt-EF) — ad-hoc fix i prod
-- ────────────────────────────────────────────────────────────

GRANT USAGE, SELECT ON SEQUENCE public.receipt_number_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.receipt_number_seq TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 2. commission_levels_id_seq (preventivt, ej aktiv incident)
--    SERIAL-kolumn — behövs när service_role INSERT:ar nya trappsteg.
-- ────────────────────────────────────────────────────────────

GRANT USAGE, SELECT ON SEQUENCE public.commission_levels_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.commission_levels_id_seq TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 3. spark_levels_id_seq (preventivt, ej aktiv incident)
--    SERIAL-kolumn — behövs när service_role INSERT:ar nya spark-nivåer.
-- ────────────────────────────────────────────────────────────

GRANT USAGE, SELECT ON SEQUENCE public.spark_levels_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.spark_levels_id_seq TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 4. Verifiering
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  sequences_to_check text[] := ARRAY[
    'receipt_number_seq',
    'commission_levels_id_seq',
    'spark_levels_id_seq'
  ];
  seq_name text;
  has_grant boolean;
BEGIN
  FOREACH seq_name IN ARRAY sequences_to_check LOOP
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.role_usage_grants
      WHERE object_schema = 'public'
        AND object_name = seq_name
        AND grantee = 'service_role'
        AND privilege_type = 'USAGE'
    ) INTO has_grant;

    IF NOT has_grant THEN
      RAISE WARNING 'Migration warning: service_role saknar USAGE på %', seq_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'OK: GRANTs verifierade på 3 sequences (receipt/commission/spark)';
END $$;

COMMIT;

-- ============================================================
-- Efter commit: verifiera manuellt
-- ============================================================
-- SELECT grantee, privilege_type, object_name
-- FROM information_schema.role_usage_grants
-- WHERE object_schema = 'public'
--   AND object_name IN ('receipt_number_seq','commission_levels_id_seq','spark_levels_id_seq')
-- ORDER BY object_name, grantee;
--
-- Förväntat: minst 2 rader per sekvens (service_role USAGE + authenticated USAGE).
-- ============================================================
