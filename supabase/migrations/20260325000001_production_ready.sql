-- Production-ready migration för Spick
-- Lägger till alla kolumner som automation-scripten använder

-- bookings-tabellen: automation kolumner
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_requested DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_reminded DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS winback_sent DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_id UUID REFERENCES cleaners(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'card';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS scheduled_time TEXT DEFAULT '09:00';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hours INTEGER DEFAULT 3;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rut BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_pnr_hash TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_price NUMERIC(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS address TEXT;

-- reviews-tabell
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  cleaner_id UUID,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  aspects TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- cleaners-tabellen: saknade kolumner
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,1) DEFAULT 5.0;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS services TEXT DEFAULT 'Hemstädning';
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS payout_status TEXT DEFAULT 'pending';

-- cleaner_applications
CREATE TABLE IF NOT EXISTS cleaner_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  services TEXT,
  hourly_rate INTEGER DEFAULT 350,
  bio TEXT,
  has_fskatt BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes för snabbare queries
-- Ändrat 2026-04-22 (Fas 2.X iter 3): scheduled_date → booking_date
-- Prod har alltid haft booking_date. scheduled_date var en antagen
-- kolumn som aldrig realiserades. Fix matchar prod-index rad 3708.
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_email ON bookings(customer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_cleaner_id ON bookings(cleaner_id);
-- Borttaget 2026-04-22 (Fas 2.X iter 4): reviews är VIEW i prod, inga index.
-- cleaner_id finns dessutom inte än vid denna körpunkt (ADD:as i 20260327100001).
-- Samma index skapas senare (20260327200001) när cleaner_id finns.
-- CREATE INDEX IF NOT EXISTS idx_reviews_cleaner ON reviews(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_cleaners_approved ON cleaners(is_approved);

-- RLS policies
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can insert reviews" ON reviews;
CREATE POLICY "Public can insert reviews" ON reviews FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Public can read reviews" ON reviews;
CREATE POLICY "Public can read reviews" ON reviews FOR SELECT USING (true);

ALTER TABLE cleaner_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can insert applications" ON cleaner_applications;
CREATE POLICY "Public can insert applications" ON cleaner_applications FOR INSERT WITH CHECK (true);
