-- ════════════════════════════════════════════════════════════════
-- Migration: synthetic_monitor_runs (Fas 10 §10.x extension)
-- 2026-04-26
-- ════════════════════════════════════════════════════════════════
-- Persistens för nightly synthetic-monitor-EF. En rad per körning
-- innehåller aggregerad status + full per-check-resultat-jsonb för
-- post-mortem-analys av regressions.
--
-- RLS: service_role only — synthetic-monitor-EF skriver via
-- SUPABASE_SERVICE_ROLE_KEY. Anon/authenticated har ingen access.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS synthetic_monitor_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ts              timestamptz NOT NULL DEFAULT NOW(),
  overall_status  text        NOT NULL,
  total_checks    int         NOT NULL,
  failed_count    int         NOT NULL,
  degraded_count  int         NOT NULL,
  results         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synthetic_monitor_ts
  ON synthetic_monitor_runs(ts DESC);

ALTER TABLE synthetic_monitor_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role only" ON synthetic_monitor_runs;
CREATE POLICY "service_role only" ON synthetic_monitor_runs
  FOR ALL
  USING (auth.role() = 'service_role');

REVOKE ALL ON synthetic_monitor_runs FROM PUBLIC, anon, authenticated;
GRANT  ALL ON synthetic_monitor_runs TO service_role;

COMMENT ON TABLE synthetic_monitor_runs IS
  'Nightly synthetic monitoring runs. Skrivs av synthetic-monitor-EF. service_role only.';
