-- ============================================================
-- Sprint 1: Saknade tabeller, priskolumner, vyer & RPC
-- ============================================================

-- ── 1. platform_settings ────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read platform_settings"
  ON platform_settings FOR SELECT USING (true);

CREATE POLICY "Service role manage platform_settings"
  ON platform_settings FOR ALL USING (auth.role() = 'service_role');

-- Seed defaults
INSERT INTO platform_settings (key, value) VALUES
  ('base_price_per_hour',   '399'),
  ('commission_standard',   '17'),
  ('commission_top',        '14'),
  ('subscription_price',    '349')
ON CONFLICT (key) DO NOTHING;


-- ── 2. discounts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discounts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  percent_off   NUMERIC DEFAULT 0,
  fixed_off_sek NUMERIC DEFAULT 0,
  min_hours     NUMERIC DEFAULT 0,
  max_uses      INT DEFAULT 100,
  current_uses  INT DEFAULT 0,
  active        BOOLEAN DEFAULT true,
  valid_from    TIMESTAMPTZ DEFAULT now(),
  valid_until   TIMESTAMPTZ DEFAULT (now() + interval '1 year'),
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manage discounts"
  ON discounts FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public read active discounts"
  ON discounts FOR SELECT USING (active = true);


-- ── 3. discount_usage ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS discount_usage (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discount_id     UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  booking_id      UUID NOT NULL,
  customer_email  TEXT NOT NULL,
  percent_applied NUMERIC DEFAULT 0,
  amount_saved_sek NUMERIC DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE discount_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manage discount_usage"
  ON discount_usage FOR ALL USING (auth.role() = 'service_role');


-- ── 4. customer_credits ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_credits (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_email  TEXT NOT NULL,
  original_sek    NUMERIC NOT NULL DEFAULT 0,
  remaining_sek   NUMERIC NOT NULL DEFAULT 0,
  reason          TEXT,
  expires_at      TIMESTAMPTZ DEFAULT (now() + interval '1 year'),
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manage customer_credits"
  ON customer_credits FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Customers read own credits"
  ON customer_credits FOR SELECT
  USING (customer_email = auth.jwt() ->> 'email');


-- ── 5. booking_events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id  UUID NOT NULL,
  event_type  TEXT NOT NULL,
  actor_type  TEXT DEFAULT 'system',
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manage booking_events"
  ON booking_events FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_booking_events_booking
  ON booking_events(booking_id);


-- ── 6. log_booking_event RPC ────────────────────────────────
CREATE OR REPLACE FUNCTION log_booking_event(
  p_booking_id UUID,
  p_event_type TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_metadata   JSONB DEFAULT '{}'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO booking_events (booking_id, event_type, actor_type, metadata)
  VALUES (p_booking_id, p_event_type, p_actor_type, p_metadata);
END;
$$;


-- ── 7. Priskolumner på bookings ─────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS base_price_per_hour    NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_price_per_hour NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_price_per_hour  NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_pct          NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_pct            NUMERIC DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_code           TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS spick_gross_sek         NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS spick_net_sek           NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS net_margin_pct          NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_fee_sek          NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS credit_applied_sek      NUMERIC DEFAULT 0;


-- =============================================================
-- Fas 2.X iter 25 (2026-04-22): VIEW-sektion kommenterad ut
-- =============================================================
-- Ursprungligen: CREATE OR REPLACE VIEW v_cleaners_for_booking
-- och v_cleaner_availability_int + GRANT SELECT på båda.
--
-- Problem: v_cleaner_availability_int refererar cleaner_availability
-- kolumner (day_mon..day_sun) som inte finns vid denna replay-punkt.
-- Gamla 20260326300002 skapar tabellen med day_of_week INT (gammalt
-- schema). Prod har konverterats till day_mon..day_sun booleans via
-- Studio — den konverteringen saknar migration.
--
-- Verifiering: båda vyerna FINNS i prod (rad 2923, 2977). Filens
-- definitioner är levande, bara replay-ordningen är trasig.
--
-- Hanteras i senare iteration med dedikerad cleaner_availability-
-- schema-konvertering + VIEW-recreate (analog iter 4 reviews→VIEW).
-- =============================================================

-- CREATE OR REPLACE VIEW v_cleaners_for_booking AS ...
-- CREATE OR REPLACE VIEW v_cleaner_availability_int AS ...
-- GRANT SELECT ON v_cleaners_for_booking TO anon, authenticated;
-- GRANT SELECT ON v_cleaner_availability_int TO anon, authenticated;
