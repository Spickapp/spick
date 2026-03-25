-- SPICK -- Nyckelhantering & Meddelanden
CREATE TABLE IF NOT EXISTS key_methods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  cleaner_email TEXT,
  method TEXT NOT NULL,
  lockbox_code TEXT,
  lockbox_location TEXT,
  digital_lock_code TEXT,
  neighbor_name TEXT,
  special_instructions TEXT,
  key_confirmed BOOLEAN DEFAULT false,
  key_returned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  from_role TEXT NOT NULL,
  from_alias TEXT,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  is_read BOOLEAN DEFAULT false,
  is_automated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id);
