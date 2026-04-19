-- Fas 1.2 Dag 4 Migration: RLS-skärpning för booking_status_log, messages, subscriptions
-- Förberedd 19 april 2026. KÖRS INTE FÖRRÄN SMS-callsites är migrerade (dag 3)
--
-- Ersätter 3 "intentional" anon-policies med auth-scoped versioner.
-- Kräver att customer_profiles-backfill är klar och publike sidor
-- har migrerats till magic-link-auth.

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- PRE-CHECK
-- ══════════════════════════════════════════════════════════════
SELECT 
  (SELECT COUNT(*) FROM pg_policies 
     WHERE tablename='booking_status_log' AND policyname='Public read booking_status_log — intentional') AS bsl_intentional,
  (SELECT COUNT(*) FROM pg_policies 
     WHERE tablename='messages' AND policyname='Public read messages — intentional') AS msg_intentional,
  (SELECT COUNT(*) FROM pg_policies 
     WHERE tablename='subscriptions' AND policyname='Public read subscriptions — intentional') AS sub_intentional;
-- Förväntat: alla 1 (existerar)

-- ══════════════════════════════════════════════════════════════
-- BOOKING_STATUS_LOG
-- ══════════════════════════════════════════════════════════════

-- DROP intentional + legacy
DROP POLICY IF EXISTS "Public read booking_status_log — intentional" ON booking_status_log;
DROP POLICY IF EXISTS "Anyone can insert status log" ON booking_status_log;

-- CREATE auth-scoped SELECT
CREATE POLICY "Customer reads own booking_status_log"
  ON booking_status_log FOR SELECT TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings
       WHERE customer_email = auth.jwt()->>'email'
    )
  );

CREATE POLICY "Cleaner reads own booking_status_log"
  ON booking_status_log FOR SELECT TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings
       WHERE cleaner_id IN (
         SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
       )
    )
  );

CREATE POLICY "VD reads team booking_status_log"
  ON booking_status_log FOR SELECT TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings WHERE cleaner_id IN (
        SELECT c.id FROM cleaners c WHERE c.company_id IN (
          SELECT company_id FROM cleaners
           WHERE auth_user_id = auth.uid() AND is_company_owner = true
        )
      )
    )
  );

CREATE POLICY "Admin reads all booking_status_log"
  ON booking_status_log FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Service role manages booking_status_log"
  ON booking_status_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- INSERT: begränsa till service_role + authenticated (ej anon)
CREATE POLICY "Authenticated inserts booking_status_log"
  ON booking_status_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- REVOKE anon
REVOKE SELECT, INSERT ON booking_status_log FROM anon;

-- ══════════════════════════════════════════════════════════════
-- MESSAGES
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Public read messages — intentional" ON messages;
DROP POLICY IF EXISTS "Anyone can insert messages" ON messages;

CREATE POLICY "Customer reads own messages"
  ON messages FOR SELECT TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings
       WHERE customer_email = auth.jwt()->>'email'
    )
  );

CREATE POLICY "Cleaner reads assigned messages"
  ON messages FOR SELECT TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings
       WHERE cleaner_id IN (
         SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
       )
    )
  );

CREATE POLICY "VD reads team messages"
  ON messages FOR SELECT TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings WHERE cleaner_id IN (
        SELECT c.id FROM cleaners c WHERE c.company_id IN (
          SELECT company_id FROM cleaners
           WHERE auth_user_id = auth.uid() AND is_company_owner = true
        )
      )
    )
  );

CREATE POLICY "Admin reads all messages"
  ON messages FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Customer writes own messages"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (
    booking_id IN (
      SELECT id FROM bookings
       WHERE customer_email = auth.jwt()->>'email'
    )
  );

CREATE POLICY "Cleaner writes own messages"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (
    booking_id IN (
      SELECT id FROM bookings
       WHERE cleaner_id IN (
         SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
       )
    )
  );

CREATE POLICY "Service role manages messages"
  ON messages FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE SELECT, INSERT ON messages FROM anon;

-- ══════════════════════════════════════════════════════════════
-- SUBSCRIPTIONS
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Public read subscriptions — intentional" ON subscriptions;
DROP POLICY IF EXISTS "Service role manages subscriptions" ON subscriptions;  -- på {public}
DROP POLICY IF EXISTS "anon_insert_subs" ON subscriptions;

CREATE POLICY "Customer reads own subscriptions"
  ON subscriptions FOR SELECT TO authenticated
  USING (customer_email = auth.jwt()->>'email');

CREATE POLICY "Admin reads all subscriptions"
  ON subscriptions FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Customer creates own subscription"
  ON subscriptions FOR INSERT TO authenticated
  WITH CHECK (customer_email = auth.jwt()->>'email');

CREATE POLICY "Service role manages subscriptions"
  ON subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON subscriptions FROM anon;

-- ══════════════════════════════════════════════════════════════
-- POST-CHECK
-- ══════════════════════════════════════════════════════════════

-- Check 1: Inga "intentional"-policies kvar
SELECT tablename, policyname FROM pg_policies
 WHERE policyname LIKE '%— intentional%'
   AND tablename IN ('booking_status_log', 'messages', 'subscriptions');
-- Förväntat: 0 rader

-- Check 2: Anon har inga grants kvar
SELECT table_name, privilege_type FROM information_schema.role_table_grants
 WHERE table_name IN ('booking_status_log', 'messages', 'subscriptions')
   AND grantee = 'anon';
-- Förväntat: 0 rader

-- Check 3: Alla tre tabellerna har auth-scoped policies
SELECT tablename, 
       COUNT(*) FILTER (WHERE 'authenticated' = ANY(roles::name[])) AS auth_policies,
       COUNT(*) FILTER (WHERE 'service_role' = ANY(roles::name[])) AS service_policies
  FROM pg_policies
 WHERE tablename IN ('booking_status_log', 'messages', 'subscriptions')
 GROUP BY tablename;
-- Förväntat: varje tabell har flera auth_policies och minst 1 service_policy

-- Check 4: Empirisk test - anon får permission denied
-- (körs manuellt efter commit)
-- SET LOCAL ROLE anon;
-- SELECT * FROM messages LIMIT 1;  -- Ska kasta 42501
-- RESET ROLE;

COMMIT;
