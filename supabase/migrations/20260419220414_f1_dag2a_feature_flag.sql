-- ============================================================
-- F1 Dag 2A: Feature flag for F1 DB-services rollout
-- ============================================================
-- Written: 2026-04-19
-- Fas: F1 Dag 2 i arkitekturplan v3
-- Design: docs/architecture/fas-1-services-design.md Section 7
--
-- CONTEXT
-- Enables gradual rollout of DB-services migration. Default false
-- means all files fall back to hardcoded lists. Toggle to true in
-- platform_settings to activate per-deployment.
--
-- NOTES
-- - Uses existing platform_settings (key/value/updated_at pattern)
--   per Regel #28: no new config fragmentation.
-- - UNIQUE constraint on key verified (platform_settings_key_key).
-- - Reads by anon allowed via existing policy
--   "Public read platform_settings - intentional" (verified).
-- - Writes admin-only via is_admin() (existing pattern).
-- - No Edge Function needed: frontend reads via Supabase REST.
-- ============================================================

-- Insert flag with default false (idempotent)
INSERT INTO public.platform_settings (key, value)
VALUES ('F1_USE_DB_SERVICES', 'false')
ON CONFLICT (key) DO NOTHING;

-- Post-check queries (run in Supabase Studio):
--   SELECT key, value, updated_at FROM platform_settings
--    WHERE key = 'F1_USE_DB_SERVICES';
--   -- Expected: 1 row, value='false'
--
--   SET LOCAL ROLE anon;
--   SELECT value FROM platform_settings WHERE key = 'F1_USE_DB_SERVICES';
--   RESET ROLE;
--   -- Expected: 1 row, value='false'
-- ============================================================
