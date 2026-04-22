-- ============================================================
-- F1 Dag 2A FIX: Add missing GRANT on platform_settings
-- ============================================================
-- Written: 2026-04-19
-- Context: F1 Dag 2 rollout discovered that policy
-- "Public read platform_settings - intentional" was dead code --
-- table-level GRANT SELECT was never issued to anon/authenticated.
-- Postgres requires both GRANT (table-level) AND policy (row-level)
-- for reads to succeed.
--
-- This is the 4th migration-vs-prod drift discovered today. F13
-- GA-gate must include audit of all public tables: RLS policies
-- must be paired with matching table-level grants.
--
-- Already deployed to prod via ad-hoc Studio GRANT on 2026-04-19.
-- This migration file versionizes that fix in the repo (Regel #27).
-- ============================================================

GRANT SELECT ON public.platform_settings TO anon, authenticated;
GRANT ALL ON public.platform_settings TO service_role;

-- Post-check (already verified in Studio 2026-04-19):
--   SET LOCAL ROLE anon;
--   SELECT value FROM platform_settings WHERE key='F1_USE_DB_SERVICES';
--   RESET ROLE;
--   -- Result: value='false', no 42501
-- ============================================================
