-- Lägg till kvadratmeter-kolumn i bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sqm INTEGER;

-- Index för snabbare queries
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_email ON bookings(customer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

SELECT 'Migration 20260326000002 klar ✅' AS status;
