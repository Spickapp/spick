-- ============================================================
-- Fas 1.6: payout_audit_log + payout_trigger_mode-seed
-- ============================================================
-- Syfte: Audit-trail for alla payout-event (transfer, reversal,
--        reconciliation). Separate fran payout_attempts: attempts
--        = per-forsok-idempotency, audit_log = alla state-andringar
--        inkl. reconciliation mismatches (F1.8).
-- Regler: #27 — primarkalla: docs/architecture/fas-1-6-stripe-transfer-design.md §3.4
--         #28 — central audit-kalla, ingen parallell logg
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS payout_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  action text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'alert', 'critical')),
  amount_sek int,
  stripe_transfer_id text,
  diff_kr int,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_audit_booking
  ON payout_audit_log(booking_id);

CREATE INDEX IF NOT EXISTS idx_payout_audit_created
  ON payout_audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_payout_audit_severity
  ON payout_audit_log(severity)
  WHERE severity != 'info';

ALTER TABLE payout_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_audit_log_service_all
  ON payout_audit_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE payout_audit_log IS
  'Fas 1.6: audit-trail for alla payout-relaterade events.';
COMMENT ON COLUMN payout_audit_log.action IS
  'transfer_created | transfer_reversed | transfer_failed | reconcile_mismatch | payout_marked_paid';
COMMENT ON COLUMN payout_audit_log.diff_kr IS
  'Anvands av F1.8 reconciliation for Stripe-DB-belopp-diff.';

-- ────────────────────────────────────────────────────────────
-- Seed: payout_trigger_mode (default 'immediate')
-- ────────────────────────────────────────────────────────────
-- 'immediate' = transfer efter payment_status=paid (F1.9 aktivering)
-- 'on_attest' = transfer efter kund-attest eller 24h (Fas 8)
-- 'manual'    = admin maste trigga via markPayoutPaid (F1.7)
INSERT INTO platform_settings (key, value)
VALUES ('payout_trigger_mode', 'immediate')
ON CONFLICT (key) DO NOTHING;

-- Verifiering
DO $$
DECLARE
  missing int;
BEGIN
  SELECT COUNT(*) INTO missing FROM (
    SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE key = 'payout_trigger_mode')
  ) m;

  IF missing > 0 THEN
    RAISE EXCEPTION 'F1.6 seed failed: payout_trigger_mode saknas';
  END IF;

  RAISE NOTICE 'OK: F1.6 migrations + seed klara';
END $$;

COMMIT;
