-- Fixa RLS-policy: "email" → "customer_email"
DROP POLICY IF EXISTS "Auth read own bookings" ON bookings;
CREATE POLICY "Auth read own bookings"
  ON bookings FOR SELECT TO authenticated
  USING (
    customer_email = (current_setting('request.jwt.claims', true)::json->>'email')
    OR cleaner_id = auth.uid()
  );
