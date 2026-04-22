-- ============================================================
-- Sprint 2 Dag 1 (2026-04-24): §3.7-full shadow-mode infrastruktur
-- ============================================================
-- Syfte: A/B-ramverk för matching-algoritm. Möjliggör säker rollout
--        av v2 (multivariat ranking) parallellt med v1 (distance-sort).
--
-- Shadow-mode: RPC returnerar v1-ordning till klient men loggar v2-score
--              för bakom-kulisserna-jämförelse. Kör 48h innan v2-aktivering.
--
-- Primärkälla:
--   - docs/architecture/matching-algorithm.md §10 (A/B-test-ramverk)
--   - docs/planning/spick-arkitekturplan-v3.md rad 220-221 (§3.7)
--
-- Scope: Tabell + seed. Wrapper-logik implementeras i nästa commit
--        (antingen v1-variant av find_nearby_cleaners eller EF-wrapper).
--
-- Regler:
--   #27 — scope: endast infrastruktur, ingen rollout-logik än
--   #28 — matching_shadow_log_enabled centraliserat i platform_settings
--   #31 — primärkälla är designdok §10, inte hypotes
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. matching_shadow_log — audit-tabell för v1/v2-diff-analys
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.matching_shadow_log (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id    uuid REFERENCES public.bookings(id) ON DELETE CASCADE,

  -- Snapshot av rankning från båda versioner
  v1_ranking    jsonb NOT NULL,  -- Array: [{cleaner_id, rank, distance_km}, ...]
  v2_ranking    jsonb NOT NULL,  -- Array: [{cleaner_id, rank, match_score}, ...]

  -- Diff-metrik (beräknas server-side innan insert)
  top5_overlap  integer,         -- Antal cleaners som finns i top-5 av både
  spearman_rho  numeric(4,3),    -- Spearman rank correlation [-1, 1]
  chosen_cleaner_id uuid,        -- Vilken cleaner kunden valde
  chosen_v1_rank    integer,     -- Hens v1-rank
  chosen_v2_rank    integer,     -- Hens v2-rank

  -- Metadata för analys
  customer_lat  double precision,
  customer_lng  double precision,
  booking_date  date,
  booking_time  time,

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexering för §3.9 pilot-analys-queries
CREATE INDEX IF NOT EXISTS matching_shadow_log_booking_idx
  ON public.matching_shadow_log (booking_id);

CREATE INDEX IF NOT EXISTS matching_shadow_log_created_idx
  ON public.matching_shadow_log (created_at DESC);

-- RLS — bara admin och service_role läser; ingen skrivning från klient
ALTER TABLE public.matching_shadow_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matching_shadow_log_admin_read ON public.matching_shadow_log;
CREATE POLICY matching_shadow_log_admin_read ON public.matching_shadow_log
  FOR SELECT TO authenticated USING (is_admin());

-- service_role har full access automatiskt via Supabase (bypass RLS),
-- så ingen explicit policy krävs för service-skrivning.

GRANT SELECT ON public.matching_shadow_log TO authenticated;
GRANT ALL ON public.matching_shadow_log TO service_role;

COMMENT ON TABLE public.matching_shadow_log IS
  'Sprint 2 Dag 1 (2026-04-24) — audit-trail för v1/v2-matching-diff. '
  'Populeras av booking-create EF när platform_settings.matching_algorithm_version=''shadow''. '
  'Använd för §3.9 pilot-analys: top-5-overlap, rank-correlation, chosen-cleaner-placering.';

-- ────────────────────────────────────────────────────────────
-- 2. Seed platform_settings.matching_shadow_log_enabled
-- ────────────────────────────────────────────────────────────
-- Separat feature-flag från matching_algorithm_version — låter oss
-- aktivera shadow-log-skrivning oberoende av vilken version som serveras.
-- Default FALSE för att inte skriva loggar innan wrapper-implementation klar.
INSERT INTO platform_settings (key, value)
VALUES ('matching_shadow_log_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. Verifiering
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  table_exists boolean;
  flag_value text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'matching_shadow_log'
  ) INTO table_exists;

  IF NOT table_exists THEN
    RAISE EXCEPTION 'Sprint 2 Dag 1: matching_shadow_log-tabellen skapades inte';
  END IF;

  SELECT value INTO flag_value FROM platform_settings WHERE key = 'matching_shadow_log_enabled';
  IF flag_value IS NULL THEN
    RAISE EXCEPTION 'Sprint 2 Dag 1: matching_shadow_log_enabled-flaggan saknas';
  END IF;

  RAISE NOTICE 'OK: matching_shadow_log (tabell) + matching_shadow_log_enabled=% (flag) seed:ade', flag_value;
END $$;

COMMIT;

-- ============================================================
-- Aktiveringsplan (nästa session eller senare):
-- 1. Implementera wrapper-logik i booking-create EF:
--    - Om matching_algorithm_version='shadow':
--      a) Kör find_nearby_cleaners (v2)
--      b) Kör find_nearby_cleaners_v1 (distance-sort) via separat RPC
--      c) Beräkna diff-metrik, INSERT i matching_shadow_log
--      d) Returnera v1-ordning till kund
-- 2. UPDATE platform_settings SET value='shadow' WHERE key='matching_algorithm_version'
-- 3. UPDATE platform_settings SET value='true' WHERE key='matching_shadow_log_enabled'
-- 4. Monitor 48h, kör §3.9-analys-queries mot matching_shadow_log
-- 5. Go/no-go beslut → UPDATE value='v2' eller 'v1'
-- ============================================================
