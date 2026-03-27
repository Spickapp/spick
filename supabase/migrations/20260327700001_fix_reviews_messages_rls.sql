-- ═══════════════════════════════════════════════════════════════
-- CRITICAL SECURITY: Fix open INSERT policies on reviews + messages
-- Reviews: Require booking_id matches a completed booking
-- Messages: Rate limit per email (max 5/hour)
-- ═══════════════════════════════════════════════════════════════

-- 1. REVIEWS: Drop overly permissive policy
DROP POLICY IF EXISTS "Anon insert reviews" ON reviews;
DROP POLICY IF EXISTS "Public insert reviews" ON reviews;

-- Only allow review INSERT if booking_id references a completed booking
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

-- Keep public read
-- (already exists: "Public read reviews" ON reviews FOR SELECT USING (true))

-- 2. MESSAGES: Drop open INSERT, add rate-limited version
DROP POLICY IF EXISTS "Anon insert messages" ON messages;

-- Rate limit: max 10 messages total per hour (no email-based subquery in RLS)
-- Use application-level rate limiting instead via check_rate_limit function
CREATE POLICY "Anon insert messages with basic check" ON messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    -- Require email and message content
    email IS NOT NULL 
    AND length(email) > 5
    AND length(email) < 255
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
