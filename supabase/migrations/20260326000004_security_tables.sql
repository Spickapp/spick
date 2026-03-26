-- Foto-kolumner i bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photo_before_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photo_after_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_lat NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_lng NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_accuracy INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;

-- Tabellkolumn för capture_method i escrow
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_hold BOOLEAN DEFAULT true;

-- Kundrapporter
CREATE TABLE IF NOT EXISTS customer_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  customer_email TEXT,
  cleaner_id UUID REFERENCES cleaners(id),
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'ny',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE customer_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Städare kan rapportera" ON customer_reports 
  FOR INSERT TO anon WITH CHECK (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_customer_reports_customer ON customer_reports(customer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_checkin ON bookings(checked_in_at);

SELECT 'Migration 20260326000004 klar ✅' AS status;
