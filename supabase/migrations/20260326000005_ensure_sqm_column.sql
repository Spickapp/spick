-- Säkerställ sqm och övriga kolumner finns
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sqm INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_lat NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_lng NUMERIC;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_accuracy INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_hold BOOLEAN DEFAULT true;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photo_before_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photo_after_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS swish_payment_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bankid_verified BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bankid_personal_number_hash TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_name TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_cleaner ON bookings(cleaner_id);

SELECT 'Migration 20260326000005 klar ✅' AS status;
