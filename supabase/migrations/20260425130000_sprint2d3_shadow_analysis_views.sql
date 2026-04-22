-- ============================================================
-- Sprint 2 Dag 3a (2026-04-25): §3.9 pilot-analys VIEWs (kategori A)
-- ============================================================
-- Syfte: Publicera tre VIEWs för shadow-mode-analys som inte kräver
--        booking-koppling. Kategori B (conversion-metrics som kräver
--        chosen_cleaner_id-länk) kommer i §3.9b efter Dag 3b.
--
-- Primärkälla:
--   - docs/architecture/matching-algorithm.md §10.2 (shadow_log-struktur)
--   - docs/architecture/matching-algorithm.md §14 (pilot-analys metrik-plan)
--   - docs/architecture/shadow-mode-analysis.md (denna commit, queries-library)
--
-- VIEWs (alla read-only, admin-gated via RLS):
--   1. v_shadow_mode_stats   — daglig agg: sökningar, mean overlap/rho
--   2. v_shadow_mode_histogram — histogram-buckets för overlap och rho
--   3. v_shadow_mode_recent  — senaste 48h för debug + smoke-test
--
-- Regler:
--   #26 — grep-före-edit: matching_shadow_log-schema läst från Dag 1-migration
--   #27 — scope: endast VIEWs för kategori A. Ingen booking-koppling.
--   #28 — platform_settings-beroende: inget (VIEWs är rena aggregat över loggtabell)
--   #31 — primärkälla: matching-algorithm.md §14 (officiell metrik-plan)
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. v_shadow_mode_stats — daglig agg för tidsserie-analys
-- ────────────────────────────────────────────────────────────
-- Använd för: "Stabiliseras diff-scores över tid när shadow-data ackumuleras?"
-- Förväntan: mean_top5_overlap trender mot stabilt värde, mean_spearman_rho
-- stabiliseras. Drastiska svängningar = signal om algoritm-instabilitet.
DROP VIEW IF EXISTS public.v_shadow_mode_stats;

CREATE VIEW public.v_shadow_mode_stats AS
SELECT
  date_trunc('day', created_at)::date        AS day,
  COUNT(*)                                    AS searches,
  ROUND(AVG(top5_overlap)::numeric, 2)        AS mean_top5_overlap,
  ROUND(STDDEV(top5_overlap)::numeric, 2)     AS stddev_top5_overlap,
  ROUND(AVG(spearman_rho)::numeric, 3)        AS mean_spearman_rho,
  ROUND(STDDEV(spearman_rho)::numeric, 3)     AS stddev_spearman_rho,
  MIN(spearman_rho)                           AS min_spearman_rho,
  MAX(spearman_rho)                           AS max_spearman_rho,
  ROUND(AVG(
    jsonb_array_length(v1_ranking)
  )::numeric, 1)                              AS mean_v1_count,
  ROUND(AVG(
    jsonb_array_length(v2_ranking)
  )::numeric, 1)                              AS mean_v2_count
FROM public.matching_shadow_log
GROUP BY date_trunc('day', created_at)::date
ORDER BY day DESC;

COMMENT ON VIEW public.v_shadow_mode_stats IS
  'Sprint 2 Dag 3a (§3.9 kategori A): daglig shadow-mode-agg. '
  'searches=antal sökningar; mean_top5_overlap=genomsnittlig top-5-överlapp v1 vs v2 [0..5]; '
  'mean_spearman_rho=genomsnittlig rank-korrelation [-1..1]. '
  'Stor stddev = algoritm-instabilitet. Ingen booking-koppling.';

-- ────────────────────────────────────────────────────────────
-- 2. v_shadow_mode_histogram — distribution av diff-metrik
-- ────────────────────────────────────────────────────────────
-- Använd för: "Är v1 och v2 i praktiken lika eller olika?"
-- Förväntan för similar ranking: top5_overlap ≈ 4-5, spearman_rho ≈ 0.8-1.0.
-- Bred distribution = algoritmerna gör olika val → shadow-data är värdefull
-- för go/no-go-beslut. Smal distribution vid 4-5 overlap + rho~1 = v2 är
-- praktiskt taget v1 + har inte tillfört nytt.
DROP VIEW IF EXISTS public.v_shadow_mode_histogram;

CREATE VIEW public.v_shadow_mode_histogram AS
WITH overlap_buckets AS (
  SELECT
    top5_overlap::text                        AS bucket,
    'top5_overlap'                            AS metric,
    COUNT(*)                                  AS frequency
  FROM public.matching_shadow_log
  GROUP BY top5_overlap
),
rho_buckets AS (
  SELECT
    CASE
      WHEN spearman_rho <= -0.75 THEN 'rho_-1.00_to_-0.75'
      WHEN spearman_rho <= -0.50 THEN 'rho_-0.75_to_-0.50'
      WHEN spearman_rho <= -0.25 THEN 'rho_-0.50_to_-0.25'
      WHEN spearman_rho <   0.00 THEN 'rho_-0.25_to_0.00'
      WHEN spearman_rho <=  0.25 THEN 'rho_0.00_to_0.25'
      WHEN spearman_rho <=  0.50 THEN 'rho_0.25_to_0.50'
      WHEN spearman_rho <=  0.75 THEN 'rho_0.50_to_0.75'
      ELSE                             'rho_0.75_to_1.00'
    END                                       AS bucket,
    'spearman_rho'                            AS metric,
    COUNT(*)                                  AS frequency
  FROM public.matching_shadow_log
  WHERE spearman_rho IS NOT NULL
  GROUP BY bucket
)
SELECT metric, bucket, frequency FROM overlap_buckets
UNION ALL
SELECT metric, bucket, frequency FROM rho_buckets
ORDER BY metric, bucket;

COMMENT ON VIEW public.v_shadow_mode_histogram IS
  'Sprint 2 Dag 3a (§3.9 kategori A): histogram av top5_overlap [0..5] och '
  'spearman_rho i 8 buckets från -1 till 1. Används för att se om v1/v2-diff '
  'har bred fördelning (algoritmerna skiljer sig meningsfullt) eller smal '
  '(v2 är praktiskt lika v1).';

-- ────────────────────────────────────────────────────────────
-- 3. v_shadow_mode_recent — senaste 48h för debug + smoke
-- ────────────────────────────────────────────────────────────
-- Använd för: "Funkar shadow-mode just nu?" Sanity-check. Begränsad till
-- 48h eftersom shadow-mode är ett 48h-aktiverings-intervall per rollout.
DROP VIEW IF EXISTS public.v_shadow_mode_recent;

CREATE VIEW public.v_shadow_mode_recent AS
SELECT
  id,
  created_at,
  top5_overlap,
  spearman_rho,
  jsonb_array_length(v1_ranking)              AS v1_count,
  jsonb_array_length(v2_ranking)              AS v2_count,
  customer_lat,
  customer_lng,
  booking_date,
  booking_time,
  booking_id,
  chosen_cleaner_id
FROM public.matching_shadow_log
WHERE created_at >= NOW() - INTERVAL '48 hours'
ORDER BY created_at DESC;

COMMENT ON VIEW public.v_shadow_mode_recent IS
  'Sprint 2 Dag 3a (§3.9 kategori A): senaste 48h shadow-sökningar. '
  'Används för debug + smoke-test. booking_id och chosen_cleaner_id blir '
  'ifyllda när §3.9b (booking-shadow-korrelation) är deployad.';

-- ────────────────────────────────────────────────────────────
-- 4. RLS + Grants (admin-gated läs, ingen skrivning)
-- ────────────────────────────────────────────────────────────
-- VIEWs ärver RLS från underliggande tabell (matching_shadow_log har
-- admin-read policy). Vi ger GRANT SELECT TO authenticated men RLS
-- filtrerar — bara is_admin() returnerar rader.
GRANT SELECT ON public.v_shadow_mode_stats     TO authenticated, service_role;
GRANT SELECT ON public.v_shadow_mode_histogram TO authenticated, service_role;
GRANT SELECT ON public.v_shadow_mode_recent    TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 5. Verifiering
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  views_count integer;
BEGIN
  SELECT COUNT(*) INTO views_count
  FROM information_schema.views
  WHERE table_schema = 'public'
    AND table_name IN ('v_shadow_mode_stats', 'v_shadow_mode_histogram', 'v_shadow_mode_recent');

  IF views_count <> 3 THEN
    RAISE EXCEPTION 'Sprint 2 Dag 3a: förväntade 3 VIEWs, fann %', views_count;
  END IF;

  RAISE NOTICE 'OK: 3 shadow-analys-VIEWs skapade (stats, histogram, recent)';
END $$;

COMMIT;

-- ============================================================
-- Användning (kör i Studio SQL Editor eller supabase db query):
--
-- Daglig progress:
--   SELECT * FROM v_shadow_mode_stats;
--
-- Distribution:
--   SELECT * FROM v_shadow_mode_histogram;
--
-- Debug-sökning just nu:
--   SELECT * FROM v_shadow_mode_recent LIMIT 20;
--
-- Standalone-queries för djupare analys: se
-- docs/architecture/shadow-mode-analysis.md
-- ============================================================
