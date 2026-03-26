-- ============================================================
-- FIX: Bookings RLS – ta bort USING(true) som exponerar alla
-- kunders adresser och personuppgifter för anon-nyckel
-- ============================================================

-- Ta bort den osäkra öppna SELECT-policyn
DROP POLICY IF EXISTS "Public can read bookings by id"     ON bookings;
DROP POLICY IF EXISTS "Cleaner update booking status"      ON bookings;

-- Kunder kan läsa sin bokning via booking-UUID (128-bit, icke-gissningsbar)
-- Applogiken i min-bokning.html filtrerar ytterligare på ?bid=
CREATE POLICY "Read booking by uuid"
  ON bookings FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR auth.role() = 'authenticated'
    OR id::text = current_setting('request.headers', true)::json->>'x-booking-id'
  );

-- Städare kan uppdatera status på sin tilldelade bokning
CREATE POLICY "Assigned cleaner update booking"
  ON bookings FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR cleaner_id = auth.uid()
  );

-- Anon kan fortfarande skapa bokningar
-- (policy "Public can insert bookings" behålls från tidigare migration)
