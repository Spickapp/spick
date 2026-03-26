-- ═══════════════════════════════════════════════════════════════════════
-- SPICK – Timbaserad bokningsspärr
-- Lägger till end_time på bookings + uppdaterar alla existerende rader
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Lägg till time_end på bookings (beräknad kolumn baserat på time + hours)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS time_end TEXT; -- '12:00' = start '09:00' + 3h

-- 2. Beräkna time_end för alla befintliga bokningar
UPDATE bookings
SET time_end = TO_CHAR(
  (CONCAT(date::text, ' ', COALESCE(time, '09:00'))::TIMESTAMPTZ + (COALESCE(hours, 3) || ' hours')::INTERVAL),
  'HH24:MI'
)
WHERE time_end IS NULL AND date IS NOT NULL;

-- 3. Trigger: sätt time_end automatiskt vid INSERT/UPDATE
CREATE OR REPLACE FUNCTION set_booking_time_end()
RETURNS TRIGGER AS $$
BEGIN
  NEW.time_end := TO_CHAR(
    (CONCAT(NEW.date::text, ' ', COALESCE(NEW.time, '09:00'))::TIMESTAMPTZ
     + (COALESCE(NEW.hours, 3) || ' hours')::INTERVAL),
    'HH24:MI'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_time_end_trigger ON bookings;
CREATE TRIGGER booking_time_end_trigger
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_booking_time_end();

-- 4. Index för snabb tidsfråga
CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(date, time, time_end, cleaner_id);

-- 5. Säkerställ att cleaner_availability kan läsas av anon (för boka.html)
ALTER TABLE cleaner_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon kan läsa availability" ON cleaner_availability;
CREATE POLICY "Anon kan läsa availability" ON cleaner_availability
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Auth kan skriva availability" ON cleaner_availability;
CREATE POLICY "Auth kan skriva availability" ON cleaner_availability
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Samma för blocked_dates
ALTER TABLE cleaner_blocked_dates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon kan läsa blocked" ON cleaner_blocked_dates;
CREATE POLICY "Anon kan läsa blocked" ON cleaner_blocked_dates
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Auth kan skriva blocked" ON cleaner_blocked_dates;
CREATE POLICY "Auth kan skriva blocked" ON cleaner_blocked_dates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. Reload schema cache
NOTIFY pgrst, 'reload schema';

SELECT 
  'Migration klar ✅' AS status,
  COUNT(*) FILTER (WHERE time_end IS NOT NULL) AS bookings_med_time_end,
  COUNT(*) FILTER (WHERE time_end IS NULL) AS bookings_utan_time_end
FROM bookings;
