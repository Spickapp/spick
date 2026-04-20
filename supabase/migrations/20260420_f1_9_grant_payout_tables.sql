-- ============================================================
-- Fas 1.9 patch: GRANT-fix for payout-tabeller
-- ============================================================
-- Rot-orsak: 20260420_f1_6_payout_audit_log.sql +
-- 20260420_f1_6_payout_attempts.sql glomde GRANT till
-- service_role + authenticated. Detta blockerade Edge Functions
-- (som anvander service_role) att skriva audit-log.
--
-- Upptackt 2026-04-20 via nuklear debug i reconcile-payouts EF:
--   "permission denied for table payout_audit_log" (code 42501)
--
-- Fix kord direkt i prod 2026-04-20 17:38 CEST.
-- Denna migration ar for konsistens i framtida environments
-- (staging, nya dev-setups).
-- ============================================================

BEGIN;

-- payout_audit_log: full-access for service_role, read for authenticated
GRANT SELECT, INSERT, UPDATE ON payout_audit_log TO service_role;
GRANT SELECT ON payout_audit_log TO authenticated;

-- payout_attempts: full-access for service_role, read for authenticated
GRANT SELECT, INSERT, UPDATE ON payout_attempts TO service_role;
GRANT SELECT ON payout_attempts TO authenticated;

-- Verifiering
DO $$
DECLARE
  audit_grants int;
  attempts_grants int;
BEGIN
  SELECT COUNT(*) INTO audit_grants
  FROM information_schema.role_table_grants
  WHERE table_name = 'payout_audit_log'
    AND grantee IN ('service_role', 'authenticated');

  SELECT COUNT(*) INTO attempts_grants
  FROM information_schema.role_table_grants
  WHERE table_name = 'payout_attempts'
    AND grantee IN ('service_role', 'authenticated');

  IF audit_grants < 4 THEN
    RAISE EXCEPTION 'payout_audit_log grants missing: expected 4, got %', audit_grants;
  END IF;

  IF attempts_grants < 4 THEN
    RAISE EXCEPTION 'payout_attempts grants missing: expected 4, got %', attempts_grants;
  END IF;

  RAISE NOTICE 'OK: GRANT-migration verified';
  RAISE NOTICE '  payout_audit_log:  % grants', audit_grants;
  RAISE NOTICE '  payout_attempts:   % grants', attempts_grants;
END $$;

COMMIT;
