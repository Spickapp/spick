-- SPICK Subscriptions+Reviews
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  service TEXT NOT NULL DEFAULT 'Hemstädning',
  frequency TEXT NOT NULL DEFAULT 'varannan-vecka',
  preferred_day TEXT,
  preferred_time TEXT,
  hours INTEGER DEFAULT 3,
  price DECIMAL(10,2),
  rut BOOLEAN DEFAULT true,
  favorite_cleaner_email TEXT,
  status TEXT DEFAULT 'aktiv',
  next_booking_date DATE,
  discount_percent INTEGER DEFAULT 5,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id),
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  cleaner_email TEXT,
  cleaner_name TEXT,
  cleaner_rating INTEGER CHECK (cleaner_rating BETWEEN 1 AND 5),
  cleaner_comment TEXT,
  customer_rating INTEGER CHECK (customer_rating BETWEEN 1 AND 5),
  customer_comment TEXT,
  customer_reviewed_at TIMESTAMPTZ,
  cleaner_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_email TEXT NOT NULL,
  referred_email TEXT,
  code TEXT UNIQUE NOT NULL,
  discount_amount INTEGER DEFAULT 200,
  status TEXT DEFAULT 'pending',
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gift_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  amount INTEGER NOT NULL,
  purchased_by_email TEXT,
  purchased_for_name TEXT,
  message TEXT,
  status TEXT DEFAULT 'active',
  used_by_email TEXT,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 year'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3,2) DEFAULT 0;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS subscription_id UUID;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_sent_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public insert subscriptions" ON subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert reviews" ON reviews FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read reviews" ON reviews FOR SELECT USING (true);
CREATE POLICY "Public insert referrals" ON referrals FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert gift_cards" ON gift_cards FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read gift_cards" ON gift_cards FOR SELECT USING (true);