-- 1. Ta bort osäkra boknings-policyer
DROP POLICY IF EXISTS "Anon reads bookings" ON bookings;
DROP POLICY IF EXISTS "select_bookings_customer" ON bookings;
DROP POLICY IF EXISTS "update_bookings_cancel" ON bookings;

-- 2. Skapa säkra boknings-policyer
CREATE POLICY "Customer reads own bookings" ON bookings
  FOR SELECT TO anon, authenticated
  USING (customer_email = current_setting('request.jwt.claims', true)::json->>'email'
    OR current_setting('role') = 'service_role');

CREATE POLICY "Anon reads by email header" ON bookings
  FOR SELECT TO anon
  USING (customer_email = current_setting('request.headers', true)::json->>'x-customer-email');

-- 3. Fixa cleaners OR true
DROP POLICY IF EXISTS "Cleaner sees own data" ON cleaners;
CREATE POLICY "Cleaner sees own data" ON cleaners
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- 4. Fixa customer_profiles
DROP POLICY IF EXISTS "Public select customer profiles" ON customer_profiles;
DROP POLICY IF EXISTS "Public update customer profiles" ON customer_profiles;
CREATE POLICY "Owner reads own profile" ON customer_profiles
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR email = current_setting('request.jwt.claims', true)::json->>'email');
CREATE POLICY "Owner updates own profile" ON customer_profiles
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid());

-- 5. Ta bort duplicerade cleaners-policyer
DROP POLICY IF EXISTS "Anon reads cleaners" ON cleaners;

-- 6. Service role full access
CREATE POLICY "Service role full bookings" ON bookings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full profiles" ON customer_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);
