-- ═══════════════════════════════════════════════════════════════
-- CRITICAL SECURITY: Fix open INSERT policies on reviews + messages
-- Reviews: Require booking_id matches a completed booking
-- Messages: Validate from_email format
-- STATUS: EXECUTED IN PRODUCTION 2026-03-27
-- ═══════════════════════════════════════════════════════════════

-- 1. REVIEWS: Only allow review if booking is completed
DROP POLICY IF EXISTS "Anon insert reviews" ON reviews;
DROP POLICY IF EXISTS "Public insert reviews" ON reviews;

CREATE POLICY "Insert review for completed booking" ON reviews
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    booking_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM bookings 
      WHERE bookings.id = booking_id 
      AND bookings.status = 'klar'
    )
  );

-- 2. MESSAGES: Validate email format to prevent spam
DROP POLICY IF EXISTS "Anon insert messages" ON messages;
DROP POLICY IF EXISTS "Anon insert messages with basic check" ON messages;

CREATE POLICY "Anon insert messages validated" ON messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    from_email IS NOT NULL 
    AND length(from_email) > 5
    AND length(from_email) < 255
    AND from_email LIKE '%@%.%'
  );

NOTIFY pgrst, 'reload schema';
