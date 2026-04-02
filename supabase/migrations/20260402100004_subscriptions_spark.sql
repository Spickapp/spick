-- ============================================================
-- Migration 20260402100004: subscriptions patch, spark_levels,
-- commission_levels, commission_log, booking_status_log patch
-- ============================================================

-- ========== 1. SUBSCRIPTIONS — add missing columns ==========
-- Table already exists (20260326700001). Add columns used in code.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pause_reason     TEXT,
  ADD COLUMN IF NOT EXISTS paused_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason    TEXT,
  ADD COLUMN IF NOT EXISTS total_bookings   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT now();

-- ========== 2. SPARK LEVELS — gamification tiers ==========
CREATE TABLE IF NOT EXISTS spark_levels (
  id              SERIAL      PRIMARY KEY,
  name            TEXT        NOT NULL UNIQUE,
  min_points      INTEGER     NOT NULL DEFAULT 0,
  max_points      INTEGER,
  badge_emoji     TEXT        DEFAULT '⚡',
  perks           JSONB       DEFAULT '[]'::jsonb,
  commission_pct  DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Seed default spark levels
INSERT INTO spark_levels (name, min_points, max_points, badge_emoji, commission_pct, perks)
VALUES
  ('Brons',    0,    499,  '🥉', 15.00, '["Grundnivå"]'::jsonb),
  ('Silver',   500,  1499, '🥈', 12.00, '["Prioriterad synlighet","Snabbare utbetalning"]'::jsonb),
  ('Guld',     1500, 3999, '🥇', 10.00, '["Toppsynlighet","Snabb utbetalning","Bonus-leads"]'::jsonb),
  ('Diamant',  4000, NULL, '💎',  8.00, '["VIP-synlighet","Direktutbetalning","Exklusiva leads","Personlig kontakt"]'::jsonb)
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_spark_levels_points ON spark_levels (min_points);

-- Add spark columns to cleaners
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS spark_points    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spark_level_id  INTEGER REFERENCES spark_levels(id);

CREATE INDEX IF NOT EXISTS idx_cleaners_spark ON cleaners (spark_points DESC);

-- ========== 3. COMMISSION LEVELS ==========
CREATE TABLE IF NOT EXISTS commission_levels (
  id              SERIAL      PRIMARY KEY,
  name            TEXT        NOT NULL UNIQUE,
  min_bookings    INTEGER     NOT NULL DEFAULT 0,
  commission_pct  DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

INSERT INTO commission_levels (name, min_bookings, commission_pct, description)
VALUES
  ('Ny',          0,   18.00, 'Nya städare — 18% provision'),
  ('Etablerad',   20,  15.00, '20+ bokningar — 15% provision'),
  ('Erfaren',     50,  12.00, '50+ bokningar — 12% provision'),
  ('Expert',      100, 10.00, '100+ bokningar — 10% provision')
ON CONFLICT (name) DO NOTHING;

-- ========== 4. COMMISSION LOG ==========
CREATE TABLE IF NOT EXISTS commission_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  cleaner_id      UUID        NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  gross_amount    DECIMAL(10,2) NOT NULL,
  commission_pct  DECIMAL(5,2)  NOT NULL,
  commission_amt  DECIMAL(10,2) NOT NULL,
  net_amount      DECIMAL(10,2) NOT NULL,
  level_name      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cl_cleaner   ON commission_log (cleaner_id);
CREATE INDEX IF NOT EXISTS idx_cl_booking   ON commission_log (booking_id);
CREATE INDEX IF NOT EXISTS idx_cl_created   ON commission_log (created_at DESC);

-- ========== 5. BOOKING STATUS LOG — add missing cleaner_email column ==========
-- Table exists (20260330000001). Code in stadare-uppdrag.html inserts cleaner_email.
ALTER TABLE booking_status_log
  ADD COLUMN IF NOT EXISTS cleaner_email TEXT;

CREATE INDEX IF NOT EXISTS idx_bsl_cleaner_email
  ON booking_status_log (cleaner_email) WHERE cleaner_email IS NOT NULL;

-- ========== 6. RLS POLICIES ==========

-- spark_levels: public read
ALTER TABLE spark_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read spark levels" ON spark_levels;
CREATE POLICY "Anyone can read spark levels"
  ON spark_levels FOR SELECT USING (true);

-- commission_levels: public read
ALTER TABLE commission_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read commission levels" ON commission_levels;
CREATE POLICY "Anyone can read commission levels"
  ON commission_levels FOR SELECT USING (true);

-- commission_log: cleaners read own
ALTER TABLE commission_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Cleaners read own commission log" ON commission_log;
CREATE POLICY "Cleaners read own commission log"
  ON commission_log FOR SELECT
  USING (auth.uid() = cleaner_id);

DROP POLICY IF EXISTS "Service role inserts commission log" ON commission_log;
CREATE POLICY "Service role inserts commission log"
  ON commission_log FOR INSERT
  WITH CHECK (true);

-- ============================================================
SELECT 'MIGRATION 20260402100004 COMPLETE — subscriptions patch, spark_levels, commission_levels, commission_log, booking_status_log patch' AS result;
