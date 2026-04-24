-- ============================================================
-- Fas 5 §5.4.2 — subscription_slot_holds
-- ============================================================
-- Soft Reservation: recurring subscriptions reserverar återkommande
-- veckoslots hos en städare. Används för conflict-check vid:
--   - auto-rebook (skapa bokning: varna om hold från annan sub krockar)
--   - change-time i customer-subscription-manage
--   - resume efter pause (check om någon annan tog slot)
--
-- Isolerad från calendar_events (ingen påverkan på no_booking_overlap).
-- Overlap-skydd sker via app-logic i EFs (samma mönster som auto-rebook dedup).
--
-- Primärkälla: docs/planning/spick-arkitekturplan-v3.md §5.4
-- Skapad: 2026-04-24 (Farhad + Claude marknadsledande-bundle)
-- Rule #28: Separat tabell för subscription-specific holds —
--           calendar_events hanterar bookings/blocked/external oförändrat.
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_slot_holds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  cleaner_id      uuid NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  weekday         smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- 1=mån, 7=sön (matchar cleaner_availability_v2)
  start_time      time NOT NULL,
  duration_hours  numeric NOT NULL CHECK (duration_hours > 0 AND duration_hours <= 24),
  active          boolean NOT NULL DEFAULT true,
  paused_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- En sub har bara EN hold (tid kan ändras via UPDATE, inte multiple parallel holds)
  CONSTRAINT unique_subscription_hold UNIQUE (subscription_id)
);

-- Index för conflict-check (cleaner + veckodag + aktiv)
CREATE INDEX IF NOT EXISTS idx_slot_holds_cleaner_day_active
  ON subscription_slot_holds (cleaner_id, weekday)
  WHERE active = true;

-- Index för reverse-lookup (subscription → hold)
CREATE INDEX IF NOT EXISTS idx_slot_holds_subscription
  ON subscription_slot_holds (subscription_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_slot_holds_updated_at()
RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_slot_holds_updated_at ON subscription_slot_holds;
CREATE TRIGGER trg_slot_holds_updated_at
  BEFORE UPDATE ON subscription_slot_holds
  FOR EACH ROW
  EXECUTE FUNCTION update_slot_holds_updated_at();

-- ============================================================
-- RLS-policies
-- ============================================================
ALTER TABLE subscription_slot_holds ENABLE ROW LEVEL SECURITY;

-- Anon kan läsa (för cleaner-dashboard visning senare)
DROP POLICY IF EXISTS "Anon can read slot_holds" ON subscription_slot_holds;
CREATE POLICY "Anon can read slot_holds"
  ON subscription_slot_holds FOR SELECT USING (true);

-- Service role hanterar alla mutations (via EFs)
DROP POLICY IF EXISTS "Service role manages slot_holds" ON subscription_slot_holds;
CREATE POLICY "Service role manages slot_holds"
  ON subscription_slot_holds FOR ALL USING (auth.role() = 'service_role');

-- Städaren får se sina egna holds
DROP POLICY IF EXISTS "Cleaner sees own holds" ON subscription_slot_holds;
CREATE POLICY "Cleaner sees own holds"
  ON subscription_slot_holds FOR SELECT USING (
    cleaner_id IN (
      SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
    )
  );

GRANT SELECT ON subscription_slot_holds TO anon, authenticated;
GRANT ALL    ON subscription_slot_holds TO service_role;

-- ============================================================
-- VERIFIERING (kör manuellt efter deploy)
-- ============================================================
-- SELECT to_regclass('subscription_slot_holds');        -- ska ge 'subscription_slot_holds'
-- SELECT constraint_name, constraint_type FROM information_schema.table_constraints
--   WHERE table_name = 'subscription_slot_holds';
-- SELECT * FROM subscription_slot_holds LIMIT 5;        -- ska vara tom initialt
