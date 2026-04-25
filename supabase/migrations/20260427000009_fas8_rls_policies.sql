-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 8 §8.11: RLS policies för escrow/dispute-tabeller
-- ═══════════════════════════════════════════════════════════════
--
-- Ersätter permissiv RLS (service_role-only, från §8.3+§8.4 migration)
-- med rollspecifika policies:
--   - Customer ser OWN disputes + escrow_events
--   - Cleaner ser OWN escrow_events + dispute-response-rätt
--   - Admin ser allt (via admin_users-join)
--   - service_role: implicit allt (bypass:ar RLS)
--
-- EU PWD-compliance: audit-trail-access är reglerad. Customer kan
-- bara se sin egen dispute-historik, inte andras.
--
-- REGLER: #26 grep existing RLS-patterns (admin-check via
-- admin_users-join), #27 scope (bara RLS för 4 tabeller från §8.4 +
-- escrow_state-relaterat), #28 SSOT = is_admin() helper (finns redan
-- i prod per tidigare sessions), #30 EU PWD kräver auditbar access-
-- control, #31 prod-schema verifierar admin_users-tabellen finns.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 0. Säker admin-check-funktion (om den inte finns)
-- ─────────────────────────────────────────────────────────────
-- Använder auth.jwt()->>'email' + admin_users-tabellen för role-check.
-- Defensiv: returnerar false om admin_users saknas.
--
-- KORRIGERAD 2026-04-29: tidigare definition refererade admin_users.user_id
-- (kolumn som inte finns i prod) → 42703-fel som dödade ~25 RLS-policies.
-- Fix-migration: 20260429000001_fix_is_admin_user_id_to_email.sql.
-- Email är primärnyckeln för admin-identifiering (matchar
-- admin.html:1441/4975 + 00000_fas_2_1_1_bootstrap_dependencies.sql:194).

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'admin_users' AND table_schema = 'public') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM admin_users WHERE email = (auth.jwt() ->> 'email')
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 1. disputes — customer ser OWN, admin ser allt
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "disputes_customer_read_own" ON public.disputes;
CREATE POLICY "disputes_customer_read_own" ON public.disputes
  FOR SELECT
  TO authenticated
  USING (
    opened_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = disputes.booking_id
        AND b.customer_email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "disputes_cleaner_read_own" ON public.disputes;
CREATE POLICY "disputes_cleaner_read_own" ON public.disputes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN cleaners cl ON cl.id = b.cleaner_id
      WHERE b.id = disputes.booking_id
        AND cl.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "disputes_admin_all" ON public.disputes;
CREATE POLICY "disputes_admin_all" ON public.disputes
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 2. dispute_evidence — uploader ser egna + admin ser allt
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "dispute_evidence_uploader_read" ON public.dispute_evidence;
CREATE POLICY "dispute_evidence_uploader_read" ON public.dispute_evidence
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM disputes d
      WHERE d.id = dispute_evidence.dispute_id
        AND (
          (dispute_evidence.uploaded_by = 'customer'
             AND EXISTS (
               SELECT 1 FROM bookings b
               WHERE b.id = d.booking_id
                 AND b.customer_email = (auth.jwt() ->> 'email')
             ))
          OR (dispute_evidence.uploaded_by = 'cleaner'
             AND EXISTS (
               SELECT 1 FROM bookings b
               JOIN cleaners cl ON cl.id = b.cleaner_id
               WHERE b.id = d.booking_id
                 AND cl.auth_user_id = auth.uid()
             ))
        )
    )
  );

DROP POLICY IF EXISTS "dispute_evidence_admin_all" ON public.dispute_evidence;
CREATE POLICY "dispute_evidence_admin_all" ON public.dispute_evidence
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 3. escrow_events — read-only för booking-parter + admin
-- ─────────────────────────────────────────────────────────────
-- Kund/städare ser OWN booking-transitions. Admin ser allt.
-- INSERT går bara via service_role (från EFs) — ingen INSERT-policy.

DROP POLICY IF EXISTS "escrow_events_customer_read_own" ON public.escrow_events;
CREATE POLICY "escrow_events_customer_read_own" ON public.escrow_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = escrow_events.booking_id
        AND b.customer_email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "escrow_events_cleaner_read_own" ON public.escrow_events;
CREATE POLICY "escrow_events_cleaner_read_own" ON public.escrow_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN cleaners cl ON cl.id = b.cleaner_id
      WHERE b.id = escrow_events.booking_id
        AND cl.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "escrow_events_admin_all" ON public.escrow_events;
CREATE POLICY "escrow_events_admin_all" ON public.escrow_events
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 4. attested_jobs — kund ser egen attest, admin ser allt
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "attested_jobs_customer_read_own" ON public.attested_jobs;
CREATE POLICY "attested_jobs_customer_read_own" ON public.attested_jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = attested_jobs.booking_id
        AND b.customer_email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "attested_jobs_cleaner_read_own" ON public.attested_jobs;
CREATE POLICY "attested_jobs_cleaner_read_own" ON public.attested_jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN cleaners cl ON cl.id = b.cleaner_id
      WHERE b.id = attested_jobs.booking_id
        AND cl.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "attested_jobs_admin_all" ON public.attested_jobs;
CREATE POLICY "attested_jobs_admin_all" ON public.attested_jobs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- VERIFIERING
-- ─────────────────────────────────────────────────────────────
-- Efter körning:
--   SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('disputes','dispute_evidence','escrow_events','attested_jobs')
--   ORDER BY tablename, policyname;
-- Förväntat: 10 rader (3 policies/tabell × 4 tabeller minus 2 pga
-- dispute_evidence har ingen cleaner-separat policy).
