-- ============================================================
-- Fas 1.1 Cleaners PII Lockdown
-- ============================================================
-- Kördes mot prod 2026-04-19 tidig morgon (post-hoc dokumentation).
--
-- PROBLEM: Cleaners-tabellen hade anon SELECT med qual=true-policies
-- ("Anon can read cleaners", "Anyone can read cleaner slug", "Public
-- read active cleaners"). Detta exponerade email, phone, home_lat,
-- home_lng, home_address, stripe_account_id för alla godkända cleaners
-- publikt.
--
-- LÖSNING (tre steg):
--   Steg 1 (commit e0a1298): Kod-fix — ta bort PII-kolumner från publika
--     SELECT-queries i data-dashboard, stadare-profil, faktura
--   Steg 2 (commit 96036f6): Migrera 8 publika SELECT-anrop i 6 filer
--     från /rest/v1/cleaners till /rest/v1/v_cleaners_public
--     (ny view med 25 safe-kolumner, inga PII)
--   Steg 3 (denna migration): REVOKE anon SELECT på cleaners + DROP
--     publika policies. Nu DB-enforcerat.
--
-- RESULTAT:
--   - Anon kan INTE längre läsa cleaners-tabellen direkt (42501)
--   - Anon kan fortfarande läsa via v_cleaners_public (safe kolumner)
--   - Auth-flöden (admin, stadare-dashboard, mitt-konto) orörd
--
-- Se docs/incidents/2026-04-19-fas-1-1-cleaners-pii-lockdown.md
-- för empirisk verifiering + detaljer.
-- ============================================================

-- 1) Rebuild view med fullständigt safe kolumn-set (25 kolumner) ──
DROP VIEW IF EXISTS public.v_cleaners_public CASCADE;
CREATE VIEW public.v_cleaners_public AS
SELECT
  id, slug, full_name, first_name, city, bio, avatar_url,
  hourly_rate, avg_rating, review_count, total_ratings, completed_jobs,
  services, languages, identity_verified, member_since,
  service_radius_km, pet_pref, elevator_pref, is_approved, status,
  owner_only, is_company_owner, company_id, stripe_onboarding_status
FROM public.cleaners
WHERE is_approved = true;

GRANT SELECT ON public.v_cleaners_public TO anon;
GRANT SELECT ON public.v_cleaners_public TO authenticated;

-- 2) REVOKE anon SELECT på cleaners-tabellen ────────────────
REVOKE SELECT ON cleaners FROM anon;

-- 3) DROP publika SELECT-policies (meningslösa utan grant) ──
DROP POLICY IF EXISTS "Anon can read cleaners" ON cleaners;
DROP POLICY IF EXISTS "Anyone can read cleaner slug" ON cleaners;
DROP POLICY IF EXISTS "Public read active cleaners" ON cleaners;

-- ============================================================
-- Auth-scoped policies som BEVARAS på cleaners:
--   "Cleaner sees own data" (SELECT, authenticated)
--   "Admin can manage cleaners" (ALL via is_admin())
--   "Company owner can insert/update team members" (INSERT/UPDATE)
--   "Cleaner/Users updates own profile" (UPDATE)
--
-- Post-check SQL för Farhad att köra i Supabase Studio:
--   SET LOCAL ROLE anon;
--   SELECT COUNT(*) FROM cleaners;              -- förväntat: 42501
--   SELECT COUNT(*) FROM v_cleaners_public;     -- förväntat: 12 rader
--   RESET ROLE;
--
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE tablename = 'cleaners'
--    ORDER BY policyname;                       -- förväntat: 9 rader, alla auth-scoped
-- ============================================================
