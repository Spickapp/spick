-- SPICK Push Subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  user_email TEXT,
  cleaner_email TEXT,
  user_type TEXT DEFAULT 'customer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_user_type ON push_subscriptions(user_type);
CREATE INDEX IF NOT EXISTS idx_push_cleaner ON push_subscriptions(cleaner_email);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can subscribe" ON push_subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role only" ON push_subscriptions FOR SELECT USING (false);
CREATE POLICY "Delete own subscription" ON push_subscriptions FOR DELETE USING (true);
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS f_skatt BOOLEAN DEFAULT false;
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS org_number TEXT;
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS services TEXT;
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_email TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_name TEXT;