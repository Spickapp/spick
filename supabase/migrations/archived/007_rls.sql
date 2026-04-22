-- =====================================================
-- SPICK – Row Level Security (RLS) för alla tabeller
-- Kör i Supabase SQL Editor
-- =====================================================

-- ── CLEANERS ─────────────────────────────────────────
ALTER TABLE cleaners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read godkanda" ON cleaners;
DROP POLICY IF EXISTS "Alla kan läsa godkända städare" ON cleaners;
DROP POLICY IF EXISTS "Bara admin kan skriva" ON cleaners;

-- Vem som helst kan läsa godkända städare
CREATE POLICY "Public read godkanda cleaners"
  ON cleaners FOR SELECT
  USING (status = 'godkänd');

-- Service role kan göra allt (admin-panel + edge functions)
CREATE POLICY "Service role full access cleaners"
  ON cleaners FOR ALL
  USING (auth.role() = 'service_role');

-- ── BOOKINGS ─────────────────────────────────────────
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert bookings" ON bookings;
DROP POLICY IF EXISTS "Read own booking" ON bookings;

-- Vem som helst kan skapa bokning
CREATE POLICY "Public insert bookings"
  ON bookings FOR INSERT
  WITH CHECK (true);

-- Kund kan läsa sin egen bokning (via email)
CREATE POLICY "Read own booking by email"
  ON bookings FOR SELECT
  USING (
    email = current_setting('request.jwt.claims', true)::json->>'email'
    OR auth.role() = 'service_role'
  );

-- Service role kan uppdatera (admin + städare accepterar)
CREATE POLICY "Service role update bookings"
  ON bookings FOR UPDATE
  USING (auth.role() = 'service_role');

-- Anon kan uppdatera status (städare accepterar/avböjer)
CREATE POLICY "Cleaner update booking status"
  ON bookings FOR UPDATE
  USING (true)
  WITH CHECK (
    -- Får bara sätta status till bekräftad/avböjd/klar
    status IN ('bekräftad', 'avböjd', 'klar', 'avbokad', 'ny')
  );

-- ── CLEANER_APPLICATIONS ─────────────────────────────
ALTER TABLE cleaner_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert applications" ON cleaner_applications;

-- Vem som helst kan ansöka
CREATE POLICY "Public insert applications"
  ON cleaner_applications FOR INSERT
  WITH CHECK (true);

-- Bara service role kan läsa ansökningar (admin)
CREATE POLICY "Service role read applications"
  ON cleaner_applications FOR SELECT
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role update applications"
  ON cleaner_applications FOR UPDATE
  USING (auth.role() = 'service_role');

-- ── REVIEWS ──────────────────────────────────────────
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert reviews" ON reviews;
DROP POLICY IF EXISTS "Public read reviews" ON reviews;

-- Vem som helst kan läsa betyg
CREATE POLICY "Public read reviews"
  ON reviews FOR SELECT
  USING (true);

-- Vem som helst kan lämna betyg
CREATE POLICY "Public insert reviews"
  ON reviews FOR INSERT
  WITH CHECK (true);

-- ── CUSTOMER_PROFILES ────────────────────────────────
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public upsert customer profiles"
  ON customer_profiles FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Read own customer profile"
  ON customer_profiles FOR SELECT
  USING (
    email = current_setting('request.jwt.claims', true)::json->>'email'
    OR auth.role() = 'service_role'
  );

CREATE POLICY "Update own customer profile"
  ON customer_profiles FOR UPDATE
  USING (
    email = current_setting('request.jwt.claims', true)::json->>'email'
    OR auth.role() = 'service_role'
  );

-- ── ANALYTICS_EVENTS ─────────────────────────────────
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public insert events"
  ON analytics_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role read events"
  ON analytics_events FOR SELECT
  USING (auth.role() = 'service_role');

-- ── MESSAGES ─────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public insert messages"
  ON messages FOR INSERT
  WITH CHECK (true);

-- Kan läsa meddelanden om du är avsändare eller mottagare
CREATE POLICY "Read own messages"
  ON messages FOR SELECT
  USING (
    from_email = current_setting('request.jwt.claims', true)::json->>'email'
    OR to_email = current_setting('request.jwt.claims', true)::json->>'email'
    OR auth.role() = 'service_role'
  );

CREATE POLICY "Update own messages"
  ON messages FOR UPDATE
  USING (
    to_email = current_setting('request.jwt.claims', true)::json->>'email'
    OR auth.role() = 'service_role'
  );

-- ── KEY_METHODS ──────────────────────────────────────
ALTER TABLE key_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public insert key methods"
  ON key_methods FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Read own key method"
  ON key_methods FOR SELECT
  USING (
    customer_email = current_setting('request.jwt.claims', true)::json->>'email'
    OR cleaner_email = current_setting('request.jwt.claims', true)::json->>'email'
    OR auth.role() = 'service_role'
  );

-- ── REFERRALS ────────────────────────────────────────
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert referrals" ON referrals;

CREATE POLICY "Public insert referrals"
  ON referrals FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public read referral by code"
  ON referrals FOR SELECT
  USING (
    referrer_email = current_setting('request.jwt.claims', true)::json->>'email'
    OR auth.role() = 'service_role'
    OR status = 'pending'  -- kod kan verifieras publikt
  );

-- ── NOTIFICATIONS ──────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'notifications') THEN
    ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='notifications' AND policyname='Public insert notifications') THEN
      CREATE POLICY "Public insert notifications"
        ON notifications FOR INSERT WITH CHECK (true);
    END IF;
  END IF;
END $$;

-- ── TRIGGER: uppdatera avg_rating efter ny review ───
CREATE OR REPLACE FUNCTION update_cleaner_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cleaners SET
    avg_rating = (
      SELECT ROUND(AVG(cleaner_rating)::numeric, 2)
      FROM reviews
      WHERE cleaner_email = NEW.cleaner_email
        AND cleaner_rating IS NOT NULL
    ),
    review_count = (
      SELECT COUNT(*)
      FROM reviews
      WHERE cleaner_email = NEW.cleaner_email
        AND cleaner_rating IS NOT NULL
    )
  WHERE email = NEW.cleaner_email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_review_inserted ON reviews;
CREATE TRIGGER on_review_inserted
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_cleaner_rating();

-- ── TRIGGER: uppdatera customer_profiles vid bokning ─
CREATE OR REPLACE FUNCTION upsert_customer_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO customer_profiles (email, name, phone, city, total_bookings, last_visit)
  VALUES (NEW.email, NEW.name, NEW.phone, NEW.city, 1, NOW())
  ON CONFLICT (email) DO UPDATE SET
    total_bookings = customer_profiles.total_bookings + 1,
    last_visit = NOW(),
    phone = COALESCE(EXCLUDED.phone, customer_profiles.phone),
    city = COALESCE(EXCLUDED.city, customer_profiles.city);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_booking_inserted ON bookings;
CREATE TRIGGER on_booking_inserted
  AFTER INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION upsert_customer_profile();

-- ── ADMIN READ POLICIES (anon kan läsa med rätt filter) ──────────────────
-- Admin-panelen använder anon key + frontend-lösenord
-- Dessa policies tillåter läsning för admin-vyer

-- Bokningar: anon kan läsa alla (admin behöver det)
CREATE POLICY IF NOT EXISTS "Anon read bookings"
  ON bookings FOR SELECT
  USING (true);

-- Städaransökningar: anon kan läsa (admin)
CREATE POLICY IF NOT EXISTS "Anon read applications"
  ON cleaner_applications FOR SELECT
  USING (true);

-- Customer profiles: anon kan läsa (admin)
CREATE POLICY IF NOT EXISTS "Anon read customer profiles"
  ON customer_profiles FOR SELECT
  USING (true);

-- Analytics: anon kan läsa (admin dashboard)
CREATE POLICY IF NOT EXISTS "Anon read analytics"
  ON analytics_events FOR SELECT
  USING (true);

-- Messages: anon kan läsa (admin)
CREATE POLICY IF NOT EXISTS "Anon read messages"
  ON messages FOR SELECT
  USING (true);
 
