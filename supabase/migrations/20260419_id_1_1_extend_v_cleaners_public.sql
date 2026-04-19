-- ============================================================
-- ID-1.1: Extend v_cleaners_public with has_fskatt
-- ============================================================
-- Written: 2026-04-19
--
-- CONTEXT
-- ID-1 (20260419_fas_1_1_cleaners_pii_lockdown.sql) REVOKEed anon
-- SELECT on cleaners. 25-column v_cleaners_public did not include
-- has_fskatt. profil.html renders F-tax badge from c.has_fskatt.
--
-- DECISION
-- has_fskatt is a public trust marker (boolean), NOT PII. Added to
-- v_cleaners_public to restore F-tax badge on public profile pages.
--
-- bonus_level was investigated but does NOT exist in prod cleaners
-- table (migrations 004_alias.sql and 20260326000001_e2e_fix.sql
-- never ran in prod). "tier" column exists but usage is unclear.
-- Both flagged for F13 cleanup. Frontend uses c.bonus_level || "Brons"
-- which degrades gracefully (always returns "Brons").
--
-- See docs/incidents/2026-04-19-id-1-1-funktionsmigration.md
-- ============================================================

CREATE OR REPLACE VIEW public.v_cleaners_public AS
SELECT
  id, slug, full_name, first_name, city, bio, avatar_url,
  hourly_rate, avg_rating, review_count, total_ratings, completed_jobs,
  services, languages, identity_verified, member_since,
  service_radius_km, pet_pref, elevator_pref, is_approved, status,
  owner_only, is_company_owner, company_id, stripe_onboarding_status,
  has_fskatt
FROM public.cleaners
WHERE is_approved = true;

GRANT SELECT ON public.v_cleaners_public TO anon;
GRANT SELECT ON public.v_cleaners_public TO authenticated;

-- Post-check (run in Supabase Studio):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='v_cleaners_public' ORDER BY ordinal_position;
--   -- Expected: 26 rows, has_fskatt last
--
--   SELECT id, full_name, has_fskatt FROM v_cleaners_public LIMIT 3;
--   -- Expected: 3 rows with boolean values
--
--   SET LOCAL ROLE anon;
--   SELECT COUNT(*) FROM v_cleaners_public;
--   RESET ROLE;
--   -- Expected: integer >= 0
-- ============================================================
