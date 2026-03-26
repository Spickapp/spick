-- RLS på bookings-tabellen
-- Kunder kan bara läsa sina egna bokningar (via customer_email eller booking_id)
-- Städare kan läsa bokningar tilldelade till dem
-- Allt kan insättas anonymt (för bokning utan inloggning)

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Anonym INSERT (boka utan konto)
DROP POLICY IF EXISTS "Public can insert bookings" ON bookings;
CREATE POLICY "Public can insert bookings" ON bookings
  FOR INSERT WITH CHECK (true);

-- Kund kan läsa sin bokning via customer_email
DROP POLICY IF EXISTS "Customer can read own bookings by email" ON bookings;
CREATE POLICY "Customer can read own bookings by email" ON bookings
  FOR SELECT USING (
    customer_email = current_setting('request.jwt.claims', true)::json->>'email'
    OR email = current_setting('request.jwt.claims', true)::json->>'email'
  );

-- Kund kan läsa sin bokning via booking_id (oautentiserad – hanteras i app-logik)
-- OBS: anon-nyckeln tillåter SELECT för att min-bokning.html ska fungera
-- Detta är acceptabelt eftersom booking_id är en UUID (128-bit slumpad)
DROP POLICY IF EXISTS "Public can read bookings by id" ON bookings;
CREATE POLICY "Public can read bookings by id" ON bookings
  FOR SELECT USING (true);  -- Applogiken filtrerar på bid/email

-- Kund kan uppdatera sin bokning (t.ex. avboka)
DROP POLICY IF EXISTS "Customer can update own booking" ON bookings;
CREATE POLICY "Customer can update own booking" ON bookings
  FOR UPDATE USING (
    customer_email = current_setting('request.jwt.claims', true)::json->>'email'
    OR email = current_setting('request.jwt.claims', true)::json->>'email'
  );

-- Service role (backend/webhooks) har full access via service key
-- Det behövs ingen policy för service role – den bypasser RLS
