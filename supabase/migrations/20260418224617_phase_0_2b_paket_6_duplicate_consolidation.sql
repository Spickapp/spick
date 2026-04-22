-- ============================================================
-- Fas 0.2b Paket 6: Duplicerade policies + scoped SELECT + OR-true-bakdörr
-- ============================================================
-- Kördes mot prod 2026-04-18 kväll (post-hoc dokumentation).
--
-- Scope: 6 tabeller med dubletter. Oväntat kritiskt fynd under POST-CHECK —
-- "Users can read own application by email"-policy på cleaner_applications
-- hade "OR true"-bakdörr som gjorde alla fyra nya scoped-policies
-- meningslösa. Droppad efter grep-verifiering (0 frontend-träffar för
-- x-user-email-header).
--
-- POST-CHECK 3 bekräftar 0 andra OR-true-mönster i prod.
--
-- Se docs/incidents/2026-04-18-paket-1-2-auth-hardening-and-v1-rls.md
-- för Paket 6-sektionen med OR-true-bakdörr-detaljer.
-- ============================================================

-- 1) blocked_times: 3 identiska qual=true → 1 intentional ─────
DROP POLICY IF EXISTS "Anon can read blocked" ON blocked_times;
DROP POLICY IF EXISTS "Anon reads blocked" ON blocked_times;
DROP POLICY IF EXISTS "Auth reads blocked_times" ON blocked_times;
CREATE POLICY "Public read blocked_times — intentional"
  ON blocked_times FOR SELECT TO anon, authenticated USING (true);

-- 2) booking_slots: 3 identiska qual=true → 1 intentional ─────
DROP POLICY IF EXISTS "Anon can read booking_slots" ON booking_slots;
DROP POLICY IF EXISTS "Anon reads slots" ON booking_slots;
DROP POLICY IF EXISTS "Anyone can read slots" ON booking_slots;
CREATE POLICY "Public read booking_slots — intentional"
  ON booking_slots FOR SELECT TO anon, authenticated USING (true);

-- 3) companies: exakta dubletter ───────────────────────────
DROP POLICY IF EXISTS "Service role full access on companies" ON companies;
DROP POLICY IF EXISTS "Owner can read own company" ON companies;

-- 4) customer_profiles: UPDATE-dublett ─────────────────────
DROP POLICY IF EXISTS "Owner updates own profile" ON customer_profiles;

-- 5) cleaner_applications: SKÄRP + OR-true-bakdörr borttagen ──
DROP POLICY IF EXISTS "Anyone can read applications" ON cleaner_applications;
DROP POLICY IF EXISTS "Service role can read all applications" ON cleaner_applications;
-- KRITISK: OR-true-bakdörr. Tidigare qual:
--   (email = auth.jwt()->>'email')
--   OR (email = current_setting('request.headers')::json->>'x-user-email')
--   OR true
-- Sista "OR true" gjorde policyn effektivt USING(true) och satte alla nya
-- scopade policies ur spel. Verifierat via frontend-grep: 0 träffar för
-- x-user-email-header innan DROP.
DROP POLICY IF EXISTS "Users can read own application by email" ON cleaner_applications;

CREATE POLICY "Cleaner reads own application"
  ON cleaner_applications FOR SELECT TO authenticated
  USING (email = (auth.jwt() ->> 'email'));

CREATE POLICY "VD reads team applications"
  ON cleaner_applications FOR SELECT TO authenticated
  USING (
    invited_by_company_id IN (
      SELECT company_id FROM cleaners
       WHERE auth_user_id = auth.uid() AND is_company_owner = true
    )
  );

CREATE POLICY "Admin reads all applications"
  ON cleaner_applications FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "Service role reads applications"
  ON cleaner_applications FOR SELECT TO service_role USING (true);

-- =============================================================
-- Fas 2.X iter 40 (2026-04-22): sekt 6 (jobs) kommenterad ut
-- =============================================================
-- Orsak: 'jobs'-tabellen raderades i Fas 3 §3.2c. Prod har inte
-- tabellen längre. 3 DROP + 3 CREATE policy är dead.
--
-- Från CLAUDE.md: jobs var dormant (27 kolumner, 39 rader) utan
-- CREATE-migration, raderades senare.
-- =============================================================

-- -- 6) jobs: 0 frontend-konsumenter → service_role + scoped ────
-- DROP POLICY IF EXISTS "Anon reads jobs" ON jobs;
-- DROP POLICY IF EXISTS "Auth reads jobs" ON jobs;
-- DROP POLICY IF EXISTS "Cleaner sees own jobs" ON jobs;
--
-- CREATE POLICY "Admin manages all jobs"
--   ON jobs FOR ALL TO authenticated
--   USING (is_admin()) WITH CHECK (is_admin());
--
-- CREATE POLICY "Cleaner sees own jobs"
--   ON jobs FOR SELECT TO authenticated
--   USING (cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()));
--
-- CREATE POLICY "Service role manages jobs"
--   ON jobs FOR ALL TO service_role
--   USING (true) WITH CHECK (true);
