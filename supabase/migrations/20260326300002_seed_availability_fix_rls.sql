-- ============================================================
-- FIX: cleaner_availability seed + säker bookings RLS
-- ============================================================

-- 1. Ge alla godkända städare som saknar schema ett standard mån-fre 08-17
INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time, is_active)
SELECT c.id, d.day, '08:00'::time, '17:00'::time, true
FROM cleaners c
CROSS JOIN (VALUES (1),(2),(3),(4),(5)) AS d(day)  -- mån=1 ... fre=5
WHERE c.status = 'godkänd'
  AND NOT EXISTS (
    SELECT 1 FROM cleaner_availability a
    WHERE a.cleaner_id = c.id AND a.day_of_week = d.day
  );

-- 2. Ta bort den osäkra öppna SELECT-policyn som exponerar alla kunders data
DROP POLICY IF EXISTS "Public can read bookings by id"      ON bookings;
DROP POLICY IF EXISTS "Cleaner update booking status"       ON bookings;

-- 3. Kunder kan läsa sin bokning via authenticated session (magic link)
DROP POLICY IF EXISTS "Read booking by uuid" ON bookings;
CREATE POLICY "Read booking by uuid"
  ON bookings FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR (auth.role() = 'authenticated' AND (
      email = auth.jwt()->>'email'
      OR customer_email = auth.jwt()->>'email'
    ))
  );

-- 4. Städare kan uppdatera status på sin tilldelade bokning
DROP POLICY IF EXISTS "Assigned cleaner update booking" ON bookings;
CREATE POLICY "Assigned cleaner update booking"
  ON bookings FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR cleaner_id = auth.uid()
  );

-- 5. Index på cleaner_availability för snabbare kalenderrendering
CREATE INDEX IF NOT EXISTS idx_availability_dow
  ON cleaner_availability(day_of_week) WHERE is_active = true;
