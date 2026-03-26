-- Lägg till sqm-kolumn (fix för schema cache-miss)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sqm INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photo_before_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photo_after_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_lat NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_lng NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_accuracy INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_hold BOOLEAN DEFAULT true;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS swish_payment_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bankid_verified BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bankid_personal_number_hash TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Referrals-tabell
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_email TEXT NOT NULL,
  referred_email TEXT NOT NULL,
  ref_code TEXT NOT NULL,
  status TEXT DEFAULT 'skickad',
  converted_at TIMESTAMPTZ,
  reward_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_ref_code ON referrals(ref_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_email ON referrals(referred_email);
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referrals' AND policyname='Anon kan insertera referral') THEN
    CREATE POLICY "Anon kan insertera referral" ON referrals FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

-- Customer reports
CREATE TABLE IF NOT EXISTS customer_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID,
  customer_email TEXT,
  cleaner_id UUID,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'ny',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE customer_reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customer_reports' AND policyname='Städare kan rapportera') THEN
    CREATE POLICY "Städare kan rapportera" ON customer_reports FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

-- Cleaners kolumner
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT false;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS terms_version TEXT;

-- Index
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_customer_reports_customer ON customer_reports(customer_email);

NOTIFY pgrst, 'reload schema';
SELECT 'Migration 20260326000005 klar ✅' AS status;
