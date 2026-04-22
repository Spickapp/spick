-- ═══════════════════════════════════════════════════════════════
-- BOOKING INTEGRITY: DB-level double-booking prevention + cleanup
-- STATUS: RUN IN SUPABASE SQL EDITOR
-- ═══════════════════════════════════════════════════════════════

-- 1. UNIQUE PARTIAL INDEX: Prevent same cleaner booked at same date+time
-- Only applies to non-cancelled, paid bookings (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_booking_slot
  ON bookings (cleaner_id, date, time)
  WHERE payment_status = 'paid' AND status != 'avbokad';

-- 2. ORPHAN CLEANUP FUNCTION: Delete pending bookings older than 1 hour
-- Called by cron every 30 minutes
CREATE OR REPLACE FUNCTION cleanup_orphan_bookings()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM bookings
  WHERE payment_status = 'pending'
    AND status = 'pending'
    AND created_at < now() - interval '1 hour'
  RETURNING id INTO deleted_count;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- 3. Add google_review_requested column to reviews if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'reviews' AND column_name = 'google_review_requested'
  ) THEN
    ALTER TABLE reviews ADD COLUMN google_review_requested BOOLEAN DEFAULT false;
  END IF;
END $$;

-- 4. INDEX: Speed up availability lookups
CREATE INDEX IF NOT EXISTS idx_bookings_cleaner_date 
  ON bookings (cleaner_id, date) 
  WHERE payment_status = 'paid' AND status != 'avbokad';

CREATE INDEX IF NOT EXISTS idx_bookings_pending_cleanup
  ON bookings (created_at)
  WHERE payment_status = 'pending' AND status = 'pending';

SELECT 'Booking integrity constraints created' as result;
