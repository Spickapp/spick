-- ═══════════════════════════════════════════════════════════
-- SPICK SYSTEM AUTOMATION - Komplett schema-tillägg
-- ═══════════════════════════════════════════════════════════

-- 1. Lägg till saknade kolumner i bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reminders_sent   TEXT[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS key_info         TEXT,
  ADD COLUMN IF NOT EXISTS customer_notes   TEXT,
  ADD COLUMN IF NOT EXISTS cleaner_email    TEXT,
  ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS is_recurring     BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_id  UUID;

-- 2. Lägg till saknade kolumner i cleaners
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS bio              TEXT,
  ADD COLUMN IF NOT EXISTS languages        TEXT,
  ADD COLUMN IF NOT EXISTS response_rate    INTEGER   DEFAULT 100,
  ADD COLUMN IF NOT EXISTS total_jobs       INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_account   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

-- 3. Lägg till saknade kolumner i customer_profiles
ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS favorite_cleaner_id UUID,
  ADD COLUMN IF NOT EXISTS notes              TEXT,
  ADD COLUMN IF NOT EXISTS allergies          TEXT,
  ADD COLUMN IF NOT EXISTS pets               TEXT,
  ADD COLUMN IF NOT EXISTS key_type           TEXT,    -- 'code' | 'key' | 'open' | 'portphone'
  ADD COLUMN IF NOT EXISTS key_info           TEXT;

-- 4. Prenumerationer - komplett schema
CREATE TABLE IF NOT EXISTS subscriptions (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name     TEXT    NOT NULL,
  customer_email    TEXT    NOT NULL,
  customer_phone    TEXT,
  address           TEXT    NOT NULL,
  city              TEXT    NOT NULL,
  service           TEXT    NOT NULL DEFAULT 'Hemstädning',
  frequency         TEXT    NOT NULL DEFAULT 'varannan-vecka', -- 'veckovis' | 'varannan-vecka' | 'månadsvis'
  preferred_day     TEXT,   -- 'måndag' etc
  preferred_time    TEXT,   -- '09:00'
  hours             INTEGER DEFAULT 3,
  total_price       DECIMAL(10,2),
  rut               BOOLEAN DEFAULT true,
  preferred_cleaner_id UUID,
  status            TEXT    DEFAULT 'aktiv',  -- 'aktiv' | 'pausad' | 'avslutad'
  next_booking_date DATE,
  discount_percent  INTEGER DEFAULT 0,
  key_info          TEXT,
  customer_notes    TEXT,
  stripe_subscription_id TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RLS för subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon kan skapa prenumeration" ON subscriptions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Auth kan läsa prenumerationer" ON subscriptions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth kan uppdatera prenumerationer" ON subscriptions FOR UPDATE TO authenticated USING (true);

-- 6. Avbokningstabellen
CREATE TABLE IF NOT EXISTS cancellations (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID    NOT NULL,
  cancelled_by      TEXT    NOT NULL, -- 'customer' | 'cleaner' | 'admin'
  reason            TEXT,
  refund_amount     DECIMAL(10,2) DEFAULT 0,
  refunded          BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Funktion: uppdatera städarens total_jobs automatiskt
CREATE OR REPLACE FUNCTION update_cleaner_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'klar' AND OLD.status != 'klar' AND NEW.cleaner_id IS NOT NULL THEN
    UPDATE cleaners
    SET total_jobs = total_jobs + 1,
        updated_at = NOW()
    WHERE id = NEW.cleaner_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_done_trigger ON bookings;
CREATE TRIGGER booking_done_trigger
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_cleaner_stats();

-- 8. Funktion: uppdatera customer_profiles automatiskt vid bokning
CREATE OR REPLACE FUNCTION upsert_customer_profile()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'paid' THEN
    INSERT INTO customer_profiles (email, name, phone, city, total_bookings, total_spent, last_visit)
    VALUES (
      COALESCE(NEW.customer_email, NEW.email),
      NEW.customer_name,
      NEW.customer_phone,
      NEW.city,
      1,
      COALESCE(NEW.total_price, 0),
      NOW()
    )
    ON CONFLICT (email) DO UPDATE SET
      total_bookings = customer_profiles.total_bookings + 1,
      total_spent    = customer_profiles.total_spent + COALESCE(NEW.total_price, 0),
      last_visit     = NOW(),
      name           = COALESCE(EXCLUDED.name, customer_profiles.name),
      updated_at     = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_customer_trigger ON bookings;
CREATE TRIGGER booking_customer_trigger
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION upsert_customer_profile();

-- 9. Index för prestanda
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
-- Borttaget 2026-04-22 (Fas 2.X iter 14): scheduled_date-kolumn finns inte i prod.
-- Prod har booking_date istället (index idx_bookings_date rad 3708).
-- CREATE INDEX IF NOT EXISTS idx_bookings_scheduled_date ON bookings(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_bookings_cleaner_email ON bookings(cleaner_email);
CREATE INDEX IF NOT EXISTS idx_bookings_reminders ON bookings USING GIN(reminders_sent);
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(customer_email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 10. Tvinga schema-cache reload
NOTIFY pgrst, 'reload schema';

SELECT 'System automation migration klar ✅' AS status;
