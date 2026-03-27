-- ═══════════════════════════════════════════════════════════════
-- SPICK – Final bookings RLS fix
-- Root cause: PostgREST cached stale schema after policy changes.
-- Fix: Toggle RLS + NOTIFY pgrst to force reload.
-- Applied: 2026-03-27 via SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Clean slate for bookings
DROP POLICY IF EXISTS "insert_bookings" ON bookings;
DROP POLICY IF EXISTS "select_bookings" ON bookings;
DROP POLICY IF EXISTS "update_bookings" ON bookings;
DROP POLICY IF EXISTS "delete_bookings" ON bookings;

-- Toggle RLS to reset state
ALTER TABLE bookings DISABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- 4 clean policies
CREATE POLICY "insert_bookings" ON bookings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "select_bookings" ON bookings FOR SELECT TO service_role USING (true);
CREATE POLICY "update_bookings" ON bookings FOR UPDATE TO service_role USING (true);
CREATE POLICY "delete_bookings" ON bookings FOR DELETE TO service_role USING (true);

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';
