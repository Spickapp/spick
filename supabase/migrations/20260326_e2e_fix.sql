-- =====================================================
-- E2E FIX – Saknade kolumner + triggers
-- =====================================================

-- Lägg till saknade kolumner i bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ny';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_requested BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_reminded BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS winback_sent BOOLEAN DEFAULT false;

-- Lägg till saknade kolumner i cleaners
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'godkänd';
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN DEFAULT false;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS bonus_level INTEGER DEFAULT 0;

-- ── TRIGGER: upsert kundprofil vid ny bokning ────────
CREATE OR REPLACE FUNCTION upsert_customer_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO customer_profiles (email, name, phone, city, total_bookings, last_visit)
  VALUES (
    COALESCE(NEW.customer_email, NEW.email),
    COALESCE(NEW.customer_name, NEW.name),
    NEW.phone,
    NEW.city,
    1,
    NOW()
  )
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

-- ── TRIGGER: uppdatera avg_rating efter ny review ───
CREATE OR REPLACE FUNCTION update_cleaner_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cleaners SET
    avg_rating = (
      SELECT ROUND(AVG(rating)::numeric, 2)
      FROM reviews
      WHERE cleaner_id = NEW.cleaner_id
    ),
    review_count = (
      SELECT COUNT(*)
      FROM reviews
      WHERE cleaner_id = NEW.cleaner_id
    )
  WHERE id = NEW.cleaner_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_review_inserted ON reviews;
CREATE TRIGGER on_review_inserted
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_cleaner_rating();

SELECT 'E2E fix migration klar! ✅' AS status;
