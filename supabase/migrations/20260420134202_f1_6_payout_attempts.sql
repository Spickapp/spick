-- ============================================================
-- Fas 1.6: payout_attempts-tabell (idempotency per försök)
-- ============================================================
-- Syfte: Spåra varje triggerStripeTransfer-försök per bokning.
--        stripe_idempotency_key UNIQUE skyddar mot double-submit.
--        Retry-försök får separata rader (attempt_count ökar).
-- Regler: #27 — primärkälla: docs/architecture/fas-1-6-stripe-transfer-design.md §3.3
--         #28 — central audit, ingen parallell Stripe-logg
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS payout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  attempt_count int NOT NULL DEFAULT 1,
  stripe_transfer_id text,
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'reversed')),
  stripe_idempotency_key text NOT NULL UNIQUE,
  error_message text,
  amount_sek int NOT NULL,
  destination_account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payout_attempts_booking
  ON payout_attempts(booking_id);

CREATE INDEX IF NOT EXISTS idx_payout_attempts_status
  ON payout_attempts(status);

-- RLS: bara service_role får skriva. Inga anon-läsningar.
ALTER TABLE payout_attempts ENABLE ROW LEVEL SECURITY;

-- Service-role-policies (via JWT role-check)
CREATE POLICY payout_attempts_service_all
  ON payout_attempts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE payout_attempts IS
  'Fas 1.6: en rad per triggerStripeTransfer-försök. stripe_idempotency_key UNIQUE.';
COMMENT ON COLUMN payout_attempts.attempt_count IS
  'Ökar vid retry-försök för samma booking.';
COMMENT ON COLUMN payout_attempts.stripe_idempotency_key IS
  'Format: payout-${booking_id}-${attempt_count}. Stripe dedupar via Idempotency-Key-header.';

COMMIT;
