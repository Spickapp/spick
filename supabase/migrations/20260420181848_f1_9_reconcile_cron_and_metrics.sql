-- ============================================================
-- Fas 1.9: pg_cron schedule + payout_metrics_hourly-vy
-- ============================================================
-- Syfte:
--   1. Auto-kor reconciliation hourly via pg_cron + pg_net
--   2. payout_metrics_hourly-vy for admin-dashboard + monitoring
--   3. Skalbarhets-forberedelse for 1000+ cleaners
--
-- Primarkallor:
--   - docs/architecture/fas-1-8-reconciliation-design.md
--   - docs/runbooks/fas-1-9-activation.md (skapas i prompt 3)
--
-- Self-governing:
--   - Cron triggar reconcile-payouts EF varje hel timme + 5 min
--   - EF hanterar mode-detection (dry_run vs live)
--   - EF auto-rollback/activation — ingen manuell flip behovs
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- Steg 1: Extensions
-- ────────────────────────────────────────────────────────────
-- pg_cron och pg_net aktiveras via Supabase Dashboard istallet for
-- CREATE EXTENSION (som triggade privilege-conflict 2026-04-20).
--
-- Verifiera att de ar installerade med:
--   SELECT extname FROM pg_extension
--    WHERE extname IN ('pg_cron', 'pg_net');
-- Forvantat: 2 rader
--
-- Om saknas: Supabase Dashboard → Database → Extensions →
--            Enable pg_cron + pg_net.

-- ────────────────────────────────────────────────────────────
-- Steg 2: Schemalagg reconcile-payouts EF hourly
-- ────────────────────────────────────────────────────────────
-- Schema: 5 min efter varje hel timme ('5 * * * *')
-- - Minut 5: EF triggas
-- - Payload: tom body (EF behover ingen input)
-- - Auth: Bearer-token via SUPABASE_SERVICE_ROLE_KEY fran vault
--
-- =============================================================
-- Fas 2.X iter 42 (2026-04-22): cron.schedule kommenterad ut
-- =============================================================
-- pg_cron-extensionen finns bara i Supabase cloud, inte lokal CLI.
-- Cron-jobbet finns i prod, skapas via Supabase Dashboard SQL Editor.
-- =============================================================

-- SELECT cron.schedule(
--   'reconcile-payouts-hourly',
--   '5 * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://urjeijcncsyuletprydy.supabase.co/functions/v1/reconcile-payouts',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (
--         SELECT decrypted_secret
--         FROM vault.decrypted_secrets
--         WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
--       ),
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- ────────────────────────────────────────────────────────────
-- Steg 3: payout_metrics_hourly-vy
-- ────────────────────────────────────────────────────────────
-- Pre-aggregerad data for admin-dashboard + monitoring.
-- Raknar events per timme fran payout_audit_log.
-- Skalbart: O(hours) istallet for O(audit_entries).
-- 30-dagars-window: begranser data for snabba queries.

CREATE OR REPLACE VIEW payout_metrics_hourly AS
SELECT
  date_trunc('hour', created_at) AS hour,
  -- Payout-actions
  COUNT(*) FILTER (WHERE action = 'transfer_completed') AS transfers_completed,
  COUNT(*) FILTER (WHERE action = 'transfer_failed') AS transfers_failed,
  COUNT(*) FILTER (WHERE action = 'transfer_reversed') AS transfers_reversed,
  COUNT(*) FILTER (WHERE action = 'payout_confirmed') AS payouts_confirmed,
  -- Reconciliation
  COUNT(*) FILTER (WHERE action = 'reconciliation_completed') AS reconciliation_runs,
  COUNT(*) FILTER (WHERE action = 'reconciliation_mismatch' AND severity = 'alert') AS mismatches_alert,
  COUNT(*) FILTER (WHERE action = 'reconciliation_mismatch' AND severity = 'critical') AS mismatches_critical,
  COUNT(*) FILTER (WHERE action = 'reconciliation_error') AS reconciliation_errors,
  -- Self-governing
  COUNT(*) FILTER (WHERE action = 'auto_rollback_triggered') AS auto_rollbacks,
  COUNT(*) FILTER (WHERE action = 'auto_activation_triggered') AS auto_activations,
  COUNT(*) FILTER (WHERE action = 'manual_rollback') AS manual_rollbacks,
  -- Aggregat-summor (SEK)
  COALESCE(
    SUM(amount_sek) FILTER (WHERE action = 'transfer_completed'),
    0
  ) AS total_sek_transferred,
  COALESCE(
    SUM(amount_sek) FILTER (WHERE action = 'payout_confirmed'),
    0
  ) AS total_sek_confirmed
FROM payout_audit_log
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY date_trunc('hour', created_at)
ORDER BY hour DESC;

COMMENT ON VIEW payout_metrics_hourly IS
  'Fas 1.9: Timvis payout-metrics for admin-dashboard + monitoring.
   Aggregerar payout_audit_log. 30-dagars-window.
   Anvands i admin.html (Fas 1.10+) och externa monitoring-verktyg.';

-- ────────────────────────────────────────────────────────────
-- Steg 4: Grant access
-- ────────────────────────────────────────────────────────────
-- service_role: full access (EFs)
-- authenticated: SELECT (admin-anvandare i admin.html)
GRANT SELECT ON payout_metrics_hourly TO authenticated;
GRANT SELECT ON payout_metrics_hourly TO service_role;

-- ────────────────────────────────────────────────────────────
-- Steg 5: Verifiera success
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  view_exists int;
BEGIN
  -- Fas 2.X iter 42: cron-check borttagen (pg_cron saknas lokalt).
  -- Behåll view-check eftersom den är relevant i lokal replay.

  -- Vy
  SELECT COUNT(*) INTO view_exists
  FROM information_schema.views
  WHERE table_name = 'payout_metrics_hourly';

  -- Assertions
  IF view_exists = 0 THEN
    RAISE EXCEPTION 'Migration failed: view payout_metrics_hourly not created';
  END IF;

  RAISE NOTICE 'OK: Fas 1.9 migration klar (view only; cron skapas via Dashboard)';
END $$;

COMMIT;

-- ============================================================
-- Manuell verifiering efter koning (kor dessa queries separat):
-- ============================================================
--
-- 1. Cron-status:
--    SELECT jobname, schedule, active, jobid
--      FROM cron.job
--     WHERE jobname = 'reconcile-payouts-hourly';
--    -- Forvantat: 1 rad, active=true
--
-- 2. Vy-tillganglighet:
--    SELECT COUNT(*) FROM payout_metrics_hourly;
--    -- Forvantat: 0 rader initialt, fylls pa efter forsta cron-run
--
-- 3. Extensions:
--    SELECT extname FROM pg_extension
--     WHERE extname IN ('pg_cron', 'pg_net');
--    -- Forvantat: 2 rader
--
-- 4. Efter forsta cron-run (vanta till nasta timme + 5 min):
--    SELECT start_time, status, return_message
--      FROM cron.job_run_details
--     WHERE jobname = 'reconcile-payouts-hourly'
--     ORDER BY start_time DESC LIMIT 5;
--
-- 5. Reconciliation-audit efter forsta run:
--    SELECT action, severity, details->>'run_id' AS run_id,
--           details->>'mismatches_count' AS mismatches,
--           created_at
--      FROM payout_audit_log
--     WHERE action LIKE 'reconciliation%'
--     ORDER BY created_at DESC LIMIT 5;
