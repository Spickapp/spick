-- ═══════════════════════════════════════════════════════════════
-- SPICK – Performance indexes
-- Kör mot Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Bokningar: filtrera på datum, städare och status
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_cleaner_date ON bookings(cleaner_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_email ON bookings(customer_email);

-- Städare: filtrera på stad och status
CREATE INDEX IF NOT EXISTS idx_cleaners_city ON cleaners(city);
CREATE INDEX IF NOT EXISTS idx_cleaners_status ON cleaners(status);
CREATE INDEX IF NOT EXISTS idx_cleaners_city_status ON cleaners(city, status);

-- Ansökningar: filtrera på status
CREATE INDEX IF NOT EXISTS idx_applications_status ON cleaner_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_email ON cleaner_applications(email);

-- Tillgänglighet: boka-flödets huvudquery
CREATE INDEX IF NOT EXISTS idx_availability_cleaner ON cleaner_availability(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_availability_active ON cleaner_availability(is_active);
CREATE INDEX IF NOT EXISTS idx_blocked_dates_cleaner ON cleaner_blocked_dates(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_blocked_dates_date ON cleaner_blocked_dates(blocked_date);

-- Reviews: visa betyg per städare
CREATE INDEX IF NOT EXISTS idx_reviews_cleaner ON reviews(cleaner_id);

-- Inbox: admin-filter
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails_inbox(status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emails_category ON emails_inbox(category) WHERE category IS NOT NULL;

-- Unique constraint: förhindra dubbelbokningar
-- (Samma städare kan inte ha två bokningar samma tid)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_booking_cleaner_slot'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT uq_booking_cleaner_slot
      UNIQUE (cleaner_id, date, time);
  END IF;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'bookings table not found, skipping constraint';
END $$;
