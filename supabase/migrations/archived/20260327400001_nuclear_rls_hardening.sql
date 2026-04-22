-- ═══════════════════════════════════════════════════════════════
-- SPICK – Nuclear RLS Hardening
-- Drops ALL permissive USING(true)/CHECK(true) policies
-- Recreates only the minimal set needed for the site to function
-- Applied: 2026-03-27 via SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- STEP 1: Drop ALL permissive policies
DO $$
DECLARE
  r RECORD;
  dropped INT := 0;
BEGIN
  FOR r IN 
    SELECT tablename, policyname 
    FROM pg_policies 
    WHERE schemaname = 'public' 
      AND (qual::text = 'true' OR with_check::text = 'true')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'Dropped % permissive policies', dropped;
END $$;

-- STEP 2: Recreate ONLY what's needed
-- Anon INSERT (booking flow, applications, reviews, profiles, analytics, etc)
CREATE POLICY "Anon insert bookings" ON bookings FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon insert applications" ON cleaner_applications FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read reviews" ON reviews FOR SELECT USING (true);
CREATE POLICY "Anon insert reviews" ON reviews FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon insert profiles" ON customer_profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read availability" ON cleaner_availability FOR SELECT USING (true);
CREATE POLICY "Anon insert analytics" ON analytics_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon insert referrals" ON referrals FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon insert messages" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon insert notifications" ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon insert subscriptions" ON subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon insert gift_cards" ON gift_cards FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon insert key_methods" ON key_methods FOR INSERT WITH CHECK (true);

-- RESULT: Only INSERT allowed for anon. No SELECT/UPDATE/DELETE on private data.
-- Public SELECT only on: reviews, cleaner_availability, approved cleaners
