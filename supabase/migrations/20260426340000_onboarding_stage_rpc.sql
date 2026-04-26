-- ═══════════════════════════════════════════════════════════════
-- SPICK – Sprint 1D race-condition-fix: atomisk stage-uppdatering
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- cleaner-onboarding-emails-EF gjorde read-modify-write på
-- cleaners.onboarding_emails_sent. Vid samtidiga cron-körningar
-- eller failover kunde två processer skriva över varandras
-- stage-stämplar (Mail 3 sätts → Mail 1 av annan process →
-- senare cron tror Mail 2/3 ska skickas).
--
-- DESIGN
-- RPC update_cleaner_onboarding_stage gör:
--   1. UPDATE med jsonb_set (atomisk per-row)
--   2. WHERE-villkor: stage får INTE redan vara satt (idempotent)
--   3. RETURNS TRUE om uppdaterat, FALSE om redan satt
--
-- REGLER:
-- - #28 SSOT: en RPC som gör atomic merge, inte spread över EF-kod
-- - #31 schema-verifierat: cleaners.onboarding_emails_sent (jsonb)
--   adderad av migration 20260426330000
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_cleaner_onboarding_stage(
  p_cleaner_id UUID,
  p_stage TEXT,
  p_timestamp TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  -- Validera stage-namn (whitelist)
  IF p_stage NOT IN ('day_1', 'day_3', 'week_1', 'month_1') THEN
    RAISE EXCEPTION 'Invalid onboarding stage: %', p_stage;
  END IF;

  -- Atomisk UPDATE med villkor: stage får inte redan vara satt
  UPDATE public.cleaners
  SET onboarding_emails_sent = jsonb_set(
        COALESCE(onboarding_emails_sent, '{}'::jsonb),
        ARRAY[p_stage],
        to_jsonb(p_timestamp::text),
        true
      )
  WHERE id = p_cleaner_id
    AND (
      onboarding_emails_sent IS NULL
      OR onboarding_emails_sent ->> p_stage IS NULL
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END $$;

REVOKE ALL ON FUNCTION public.update_cleaner_onboarding_stage(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_cleaner_onboarding_stage(UUID, TEXT, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.update_cleaner_onboarding_stage IS
  'Sprint 1D race-condition-fix: atomisk stage-uppdatering via jsonb_set + WHERE-skydd. Returnerar TRUE om stage sattes nu, FALSE om redan satt.';

DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 20260426340000 COMPLETE — atomic onboarding-stage RPC';
END $$;
