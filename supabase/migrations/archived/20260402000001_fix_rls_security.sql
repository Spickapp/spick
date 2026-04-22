-- =====================================================
-- P0 SECURITY FIX: RLS policies + admin table lockdown
-- Removes all USING(true) SELECT policies that expose
-- customer PII to anonymous/unauthenticated users.
-- Date: 2026-04-02
-- =====================================================

BEGIN;

-- ═══════════════════════════════════════════════════════
-- 1. BOOKINGS – drop open policies, replace with scoped
-- ═══════════════════════════════════════════════════════

-- Drop all overly permissive policies
DROP POLICY IF EXISTS "Anon read bookings"              ON bookings;
DROP POLICY IF EXISTS "Read booking by uuid"            ON bookings;
DROP POLICY IF EXISTS "Cleaner update booking status"   ON bookings;
DROP POLICY IF EXISTS "Read own booking by email"       ON bookings;

-- Authenticated: read own bookings (customer by email, cleaner by id)
CREATE POLICY "Auth read own bookings"
  ON bookings FOR SELECT TO authenticated
  USING (
    email = (current_setting('request.jwt.claims', true)::json->>'email')
    OR cleaner_id = auth.uid()
  );

-- Anon: read single booking by UUID header (min-bokning.html flow)
CREATE POLICY "Anon read booking by uuid header"
  ON bookings FOR SELECT TO anon
  USING (
    id::text = current_setting('request.headers', true)::json->>'x-booking-id'
  );

-- Authenticated: update own bookings (customer cancel, cleaner status change)
CREATE POLICY "Auth update own bookings"
  ON bookings FOR UPDATE TO authenticated
  USING (
    email = (current_setting('request.jwt.claims', true)::json->>'email')
    OR cleaner_id = auth.uid()
  );

-- Service role: full access (already exists, but ensure it's there)
DROP POLICY IF EXISTS "Service role update bookings" ON bookings;
CREATE POLICY "Service role all bookings"
  ON bookings FOR ALL
  USING (auth.role() = 'service_role');

-- Keep: "Public insert bookings" (anon can create bookings)

-- ═══════════════════════════════════════════════════════
-- 2. CUSTOMER_PROFILES – drop open, scope to own email
-- ═══════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Anon read customer profiles"     ON customer_profiles;
DROP POLICY IF EXISTS "Read own customer profile"       ON customer_profiles;
DROP POLICY IF EXISTS "Update own customer profile"     ON customer_profiles;

CREATE POLICY "Auth read own customer profile"
  ON customer_profiles FOR SELECT TO authenticated
  USING (
    email = (current_setting('request.jwt.claims', true)::json->>'email')
  );

CREATE POLICY "Auth update own customer profile"
  ON customer_profiles FOR UPDATE TO authenticated
  USING (
    email = (current_setting('request.jwt.claims', true)::json->>'email')
  );

-- Service role: full access
CREATE POLICY "Service role all customer profiles"
  ON customer_profiles FOR ALL
  USING (auth.role() = 'service_role');

-- Keep: "Public upsert customer profiles" (trigger-driven inserts)

-- ═══════════════════════════════════════════════════════
-- 3. MESSAGES – drop open, scope to participants
-- ═══════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Anon read messages"              ON messages;
DROP POLICY IF EXISTS "Read own messages"               ON messages;
DROP POLICY IF EXISTS "Update own messages"             ON messages;

CREATE POLICY "Auth read own messages"
  ON messages FOR SELECT TO authenticated
  USING (
    from_email = (current_setting('request.jwt.claims', true)::json->>'email')
    OR to_email = (current_setting('request.jwt.claims', true)::json->>'email')
  );

CREATE POLICY "Auth update own messages"
  ON messages FOR UPDATE TO authenticated
  USING (
    to_email = (current_setting('request.jwt.claims', true)::json->>'email')
  );

-- Service role: full access
CREATE POLICY "Service role all messages"
  ON messages FOR ALL
  USING (auth.role() = 'service_role');

-- Keep: "Public insert messages" (anon can send messages)

-- ═══════════════════════════════════════════════════════
-- 4. CLEANER_APPLICATIONS – drop open, scope to own
-- ═══════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Anon read applications"          ON cleaner_applications;
DROP POLICY IF EXISTS "Service role read applications"  ON cleaner_applications;
DROP POLICY IF EXISTS "Service role update applications" ON cleaner_applications;

-- Applicant can read their own application
CREATE POLICY "Auth read own application"
  ON cleaner_applications FOR SELECT TO authenticated
  USING (
    email = (current_setting('request.jwt.claims', true)::json->>'email')
  );

-- Service role: full access (admin reviews applications)
CREATE POLICY "Service role all applications"
  ON cleaner_applications FOR ALL
  USING (auth.role() = 'service_role');

-- Keep: "Public insert applications" (anon can apply)

-- ═══════════════════════════════════════════════════════
-- 5. ADMIN TABLES – lock down to service_role ONLY
--    No authenticated/anon policies at all.
-- ═══════════════════════════════════════════════════════

-- admin_users
DROP POLICY IF EXISTS "admin_users_all"    ON admin_users;
CREATE POLICY "Service role only admin_users"
  ON admin_users FOR ALL
  USING (auth.role() = 'service_role');

-- support_tickets
DROP POLICY IF EXISTS "tickets_all"        ON support_tickets;
CREATE POLICY "Service role only support_tickets"
  ON support_tickets FOR ALL
  USING (auth.role() = 'service_role');

-- admin_settings
DROP POLICY IF EXISTS "settings_all"       ON admin_settings;
CREATE POLICY "Service role only admin_settings"
  ON admin_settings FOR ALL
  USING (auth.role() = 'service_role');

-- admin_audit_log
DROP POLICY IF EXISTS "audit_insert"       ON admin_audit_log;
DROP POLICY IF EXISTS "audit_select"       ON admin_audit_log;
CREATE POLICY "Service role only admin_audit_log"
  ON admin_audit_log FOR ALL
  USING (auth.role() = 'service_role');

-- ticket_notes (related admin table)
DROP POLICY IF EXISTS "notes_all"          ON ticket_notes;
CREATE POLICY "Service role only ticket_notes"
  ON ticket_notes FOR ALL
  USING (auth.role() = 'service_role');

-- temp_role_elevations (related admin table)
DROP POLICY IF EXISTS "elevations_all"     ON temp_role_elevations;
CREATE POLICY "Service role only temp_role_elevations"
  ON temp_role_elevations FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════
-- 6. ANALYTICS – remove anon read (admin-only data)
-- ═══════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Anon read analytics" ON analytics_events;

COMMIT;
