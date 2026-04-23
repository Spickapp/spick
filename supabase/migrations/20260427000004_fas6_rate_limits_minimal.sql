-- ============================================================
-- Fas 6 + Security P1 — rate_limits infrastruktur (minimal)
-- ============================================================
--
-- BAKGRUND (verifierat 2026-04-23):
-- Migration 20260327300001_rate_limiting_email_queue.sql finns i repo
-- men applicerades ALDRIG i prod. Bevis:
--   - RPC check_rate_limit: PGRST202 (function not found)
--   - pg_policies WHERE policyname LIKE 'Rate limited%': 0 rader
-- Dessutom: migration 20260327300001 refererar 'reviews'-tabell som
-- INTE finns i prod (betyg lagras i 'ratings'). Att apply:a
-- original-migrationen skulle rulla tillbaka pga reviews-fel.
--
-- DENNA MIGRATION skapar MINIMAL rate-limit-infrastruktur:
--   - rate_limits-tabell (idempotent)
--   - check_rate_limit-funktion (idempotent via OR REPLACE)
--   - cleanup_rate_limits-funktion (idempotent)
--   - GRANT EXECUTE till anon/authenticated/service_role
--   - RLS enabled pa rate_limits (bara service_role kan SELECT)
--
-- GOR INTE:
--   - ANDRAR INGA RLS-policies pa existing tabeller (bookings,
--     cleaner_applications, messages) — de har befintliga policies
--     som kraver separat audit innan rate-limit-RLS adderas
--   - Refererar INTE 'reviews' (tabell finns ej)
--   - Orord av save-booking-event-EF (commit 60330ed anvander denna
--     RPC — aktiveras automatiskt efter apply)
--
-- FRAMTIDA EXPANSION (separat migration, kraver audit-first):
-- Lagga till Rate limited RLS-policy pa bookings/cleaner_applications/
-- messages KRAVER forst analys av existing policies sa vi inte brutet
-- anon-insert-paths. Dokumenterat i
-- docs/planning/todo-rate-limit-migration-missing-2026-04-23.md.
--
-- REGLER: #26 grep (existing policies verifierade via Farhads SQL),
-- #27 scope (MINIMAL infrastruktur, 0 existing-policy-andringar),
-- #28 single source (check_rate_limit = canonical RPC framover),
-- #31 primarkalle-check (PGRST202 + 'reviews not a table'-errors
-- fran prod bekraftade saknad state).
-- ============================================================

BEGIN;

-- 1. rate_limits-tabell (identisk med migration 20260327300001 rad 6-12)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expire
  ON rate_limits(window_start);

-- 2. check_rate_limit-funktion (identisk med 20260327300001 rad 15-33)
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT,
  p_max INT DEFAULT 10,
  p_window_minutes INT DEFAULT 60
) RETURNS BOOLEAN AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COALESCE(SUM(count), 0) INTO v_count
  FROM rate_limits
  WHERE key = p_key
    AND window_start > now() - (p_window_minutes || ' minutes')::INTERVAL;

  IF v_count >= p_max THEN RETURN FALSE; END IF;

  INSERT INTO rate_limits (key, window_start, count)
  VALUES (p_key, date_trunc('minute', now()), 1)
  ON CONFLICT (key, window_start) DO UPDATE
    SET count = rate_limits.count + 1;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. cleanup_rate_limits (identisk med 20260327300001 rad 36-40)
CREATE OR REPLACE FUNCTION cleanup_rate_limits() RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_start < now() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. GRANT EXECUTE (viktigt for anon-calls fran save-booking-event)
GRANT EXECUTE ON FUNCTION check_rate_limit(text, int, int)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION cleanup_rate_limits()
  TO service_role;

-- 5. RLS pa rate_limits (bara service_role kan lasa/skriva direkt —
-- anon anvander bara via check_rate_limit-RPC som ar SECURITY DEFINER)
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages rate_limits" ON rate_limits;
CREATE POLICY "Service role manages rate_limits"
  ON rate_limits FOR ALL
  USING (auth.role() = 'service_role');

COMMIT;

SELECT 'MIGRATION 20260427000004 COMPLETE — rate_limits infrastructure (minimal, no policy changes on existing tables)' AS result;
