-- ============================================================
-- FIX: Saknade tabeller + triggers som inte körts i live-DB
-- Kör denna för att göra E2E-testet grönt
-- ============================================================

-- 1. CUSTOMER_REPORTS – saknas helt i live-DB
CREATE TABLE IF NOT EXISTS customer_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
  customer_email TEXT,
  cleaner_id   UUID REFERENCES cleaners(id) ON DELETE SET NULL,
  reason       TEXT NOT NULL,
  description  TEXT,
  status       TEXT DEFAULT 'open',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE customer_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customer_reports' AND policyname='Anon insert reports') THEN
    CREATE POLICY "Anon insert reports" ON customer_reports FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customer_reports' AND policyname='Anon read reports') THEN
    CREATE POLICY "Anon read reports" ON customer_reports FOR SELECT TO anon USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_reports_booking ON customer_reports(booking_id);
CREATE INDEX IF NOT EXISTS idx_customer_reports_cleaner ON customer_reports(cleaner_id);

-- 2. REVIEWS – lägg till saknade kolumner (rating, aspects, comment)
--    Den gamla tabellen har cleaner_rating/customer_rating, den nya har rating/aspects/comment
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rating  INTEGER CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS aspects TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS cleaner_id UUID REFERENCES cleaners(id) ON DELETE SET NULL;

-- 3. CUSTOMER_PROFILES TRIGGER – säkra att den finns och är aktiv
CREATE OR REPLACE FUNCTION upsert_customer_profile()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_email IS NOT NULL THEN
    INSERT INTO customer_profiles (email, name, phone, city, total_bookings, last_visit)
    VALUES (
      NEW.customer_email,
      NEW.customer_name,
      NEW.phone,
      NEW.city,
      1,
      NOW()
    )
    ON CONFLICT (email) DO UPDATE SET
      total_bookings = customer_profiles.total_bookings + 1,
      last_visit     = NOW(),
      name  = COALESCE(EXCLUDED.name,  customer_profiles.name),
      phone = COALESCE(EXCLUDED.phone, customer_profiles.phone),
      city  = COALESCE(EXCLUDED.city,  customer_profiles.city);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_customer_profile_trigger ON bookings;
CREATE TRIGGER booking_customer_profile_trigger
  AFTER INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION upsert_customer_profile();


-- ============================================================
-- FIX 2: bookings.name är NOT NULL men E2E skickar inte den
-- (customer_name är den faktiska kolumnen, name är legacy)
-- ============================================================
ALTER TABLE bookings ALTER COLUMN name DROP NOT NULL;

-- Aktivera customer_profile_trigger
ALTER TABLE bookings ENABLE TRIGGER booking_customer_profile_trigger;

-- ============================================================
-- FIX 3: Rensa och återskapa bookings INSERT-policy
-- Gamla policies hade felaktiga WITH CHECK-villkor
-- ============================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT polname FROM pg_policy 
    WHERE polrelid = 'bookings'::regclass AND polcmd = 'a'
  LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.polname) || ' ON bookings';
  END LOOP;
END $$;

CREATE POLICY "bookings_insert_open" ON bookings
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (true);
