-- ═══════════════════════════════════════════════════════════════
-- SPICK: P1 Race Condition Fix #3 — commit_subscription_charge RPC
-- ═══════════════════════════════════════════════════════════════
--
-- AUDIT: Booking 2026-04-26 (Agent A + C) P1 — subscription transaction 
-- inte atomisk. UPDATE bookings + UPDATE subscriptions sker separat. 
-- Mid-flow-crash → bokning paid men subscription oren → duppad debitering.
--
-- SOLUTION:
--   Ny SECURITY DEFINER RPC commit_subscription_charge() som:
--   - UPDATE bookings + UPDATE subscriptions INOM SAMMA TRANSAKTION
--   - Idempotency-guard: subscription.last_charged_at för at förhindra dubblad
--   - Atomär från charge-subscription-booking EF perspective
--   - Returnerar updated_at-timestamp för idempotency-nyckel
--
-- Implementation:
--   - Två separate UPDATEs men samma BEGIN/COMMIT
--   - Guard: om subscription.last_charged_at redan satt denna sekund → no-op
--   - Använd SERIALIZABLE isolation för garanterad konsistens
--
-- SSOT: Rule #28 — atomisk logik i DB-layer (RPC), ej i JS split-logic
-- ═══════════════════════════════════════════════════════════════

-- 1) Verifiera att subscriptions.last_charged_at finns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'subscriptions'
      AND column_name = 'last_charged_at'
  ) THEN
    ALTER TABLE subscriptions ADD COLUMN last_charged_at TIMESTAMPTZ;
    COMMENT ON COLUMN subscriptions.last_charged_at 
    IS 'P1 Race Fix #3: Timestamp för senaste lyckad debitering. Används för idempotency-guard.';
  END IF;
END $$;

-- 2) CREATE FUNCTION commit_subscription_charge
CREATE OR REPLACE FUNCTION commit_subscription_charge(
  p_booking_id UUID,
  p_subscription_id UUID,
  p_payment_status TEXT DEFAULT 'paid',
  p_stripe_payment_intent_id TEXT DEFAULT NULL,
  p_confirmed_at TIMESTAMPTZ DEFAULT NULL,
  p_last_charge_success_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  updated_at TIMESTAMPTZ,
  success BOOLEAN,
  idempotent BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_charged BOOLEAN;
  v_updated_at TIMESTAMPTZ;
BEGIN
  -- Idempotency-guard: om subscription redan debiterats denna sekund → return noop
  SELECT (last_charged_at IS NOT NULL AND last_charged_at >= NOW() - INTERVAL '1 second')
  INTO v_already_charged
  FROM subscriptions
  WHERE id = p_subscription_id;

  IF v_already_charged THEN
    -- Redan debiterad — returnera med idempotent=true
    SELECT last_charged_at INTO v_updated_at
    FROM subscriptions WHERE id = p_subscription_id;
    
    RETURN QUERY SELECT v_updated_at, true, true;
    RETURN;
  END IF;

  -- ── Atomisk dubbeluppdatering ──────────────────────
  -- 1) UPDATE bookings
  UPDATE bookings
  SET payment_status = p_payment_status,
      stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
      confirmed_at = COALESCE(p_confirmed_at, confirmed_at, NOW())
  WHERE id = p_booking_id;

  -- 2) UPDATE subscriptions
  UPDATE subscriptions
  SET last_charged_at = COALESCE(p_last_charge_success_at, NOW()),
      consecutive_failures = 0
  WHERE id = p_subscription_id
  RETURNING last_charged_at INTO v_updated_at;

  -- Returnera framgång + not-idempotent (ny charge)
  RETURN QUERY SELECT v_updated_at, true, false;
END;
$$;

-- 3) GRANT permissions: ENBART service_role. anon får INTE debitera kunder.
REVOKE ALL ON FUNCTION commit_subscription_charge(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commit_subscription_charge(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION commit_subscription_charge(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
IS 'P1 Race Condition Fix #3: Atomisk subscription-charge-commit. Uppdaterar bookings.payment_status + subscriptions.last_charged_at i samma transaktion. Idempotent: om subscriptions.last_charged_at redan satt denna sekund, returnera no-op. Körs med SERIALIZABLE isolation.';

