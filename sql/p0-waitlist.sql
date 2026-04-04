-- P0: Create waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  city text NOT NULL,
  email text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(city, email)
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_waitlist" ON waitlist
  FOR INSERT WITH CHECK (true);

CREATE POLICY "admin_read_waitlist" ON waitlist
  FOR SELECT USING (
    (auth.jwt() ->> 'email') IN (
      SELECT email FROM admin_users WHERE is_active = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_waitlist_city ON waitlist(city);

-- P0: Clean test bookings
DELETE FROM bookings WHERE customer_email = 'claraml@hotmail.se';
