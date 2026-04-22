-- ============================================================
-- FIX: Skapa cleaner_availability om den saknas, seeda data
-- och säkra bookings RLS
-- ============================================================

-- 1. Skapa tabellen om den inte redan finns
CREATE TABLE IF NOT EXISTS cleaner_availability (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_id    UUID NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME NOT NULL DEFAULT '08:00',
  end_time      TIME NOT NULL DEFAULT '17:00',
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cleaner_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS cleaner_blocked_dates (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_id   UUID NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  reason       TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cleaner_id, blocked_date)
);

-- 2. Index
CREATE INDEX IF NOT EXISTS idx_avail_cleaner    ON cleaner_availability(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_avail_dow        ON cleaner_availability(day_of_week) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_blocked_cleaner  ON cleaner_blocked_dates(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_blocked_date     ON cleaner_blocked_dates(blocked_date);

-- 3. RLS
ALTER TABLE cleaner_availability  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_blocked_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read availability"     ON cleaner_availability;
DROP POLICY IF EXISTS "Public read blocked dates"    ON cleaner_blocked_dates;
DROP POLICY IF EXISTS "Service role manage availability" ON cleaner_availability;
DROP POLICY IF EXISTS "Service role manage blocked"  ON cleaner_blocked_dates;

CREATE POLICY "Public read availability"
  ON cleaner_availability FOR SELECT USING (true);
CREATE POLICY "Public read blocked dates"
  ON cleaner_blocked_dates FOR SELECT USING (true);
CREATE POLICY "Service role manage availability"
  ON cleaner_availability FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manage blocked"
  ON cleaner_blocked_dates FOR ALL USING (auth.role() = 'service_role');

-- 4. Seed: ge alla godkända städare mån–fre 08-17 om de saknar schema
INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time, is_active)
SELECT c.id, d.day, '08:00'::time, '17:00'::time, true
FROM cleaners c
CROSS JOIN (VALUES (1),(2),(3),(4),(5)) AS d(day)
WHERE c.status = 'godkänd'
  AND NOT EXISTS (
    SELECT 1 FROM cleaner_availability a
    WHERE a.cleaner_id = c.id AND a.day_of_week = d.day
  );

-- =============================================================
-- Fas 2.X iter 11 (2026-04-22): rad 60-80 kommenterade ut
-- =============================================================
-- Ursprungligen: "Säkra bookings RLS" — drop/create 2 policies på
-- bookings ("Read booking by uuid", "Assigned cleaner update booking").
--
-- Problem: båda policies refererar bookings.email som inte existerar
-- i prod (ersatt av customer_email). CREATE POLICY validerar kolumn-
-- refs inline → fail vid db reset.
--
-- Verifiering: båda policy-namnen saknas i prod-schema.sql. Dead code.
-- Aktuella bookings-policies finns i 20260422130000_all_policies.sql.
-- =============================================================

-- DROP POLICY IF EXISTS "Public can read bookings by id"   ON bookings;
-- DROP POLICY IF EXISTS "Cleaner update booking status"    ON bookings;
-- DROP POLICY IF EXISTS "Read booking by uuid"             ON bookings;
-- DROP POLICY IF EXISTS "Assigned cleaner update booking"  ON bookings;
--
-- CREATE POLICY "Read booking by uuid"
--   ON bookings FOR SELECT
--   USING (
--     auth.role() = 'service_role'
--     OR (auth.role() = 'authenticated' AND (
--       email = auth.jwt()->>'email'
--       OR customer_email = auth.jwt()->>'email'
--     ))
--   );
--
-- CREATE POLICY "Assigned cleaner update booking"
--   ON bookings FOR UPDATE
--   USING (
--     auth.role() = 'service_role'
--     OR cleaner_id = auth.uid()
--   );
