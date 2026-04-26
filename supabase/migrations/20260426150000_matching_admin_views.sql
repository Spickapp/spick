-- §3.8 admin-matching-frontend — 3 nya vyer för admin-dashboard
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   admin-matching.html visar shadow-mode-stats (sektion 4 från mockup).
--   Saknar: top-cleaners (sektion 1), skipped-cleaners (sektion 2),
--   score-distribution (sektion 3).
--
--   Aggregerar från matching_shadow_log.v2_ranking jsonb-array.
--   Varje rad i v2_ranking = {cleaner_id, rank, match_score}.
--
-- Verifiering (rule #31, 2026-04-26):
--   matching_shadow_log finns (RLS-skyddad)
--   v_matching_top_cleaners → 404 (ej existerande)
--
-- Idempotens: CREATE OR REPLACE VIEW.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. v_matching_top_cleaners — Top 20 mest visade i sökresultat ──
-- Senaste 30 dagarna. Aggregerar från jsonb-array via cross join lateral.
CREATE OR REPLACE VIEW public.v_matching_top_cleaners AS
SELECT
  (item->>'cleaner_id')::uuid AS cleaner_id,
  COALESCE(c.full_name, '–') AS cleaner_name,
  COALESCE(c.city, '–') AS cleaner_city,
  COUNT(*) AS view_count_30d,
  ROUND(AVG((item->>'match_score')::numeric), 3) AS avg_score,
  ROUND(AVG((item->>'rank')::numeric), 2) AS avg_rank,
  COUNT(*) FILTER (WHERE msl.chosen_cleaner_id::text = item->>'cleaner_id') AS bookings_30d
FROM public.matching_shadow_log msl
CROSS JOIN LATERAL jsonb_array_elements(msl.v2_ranking) AS item
LEFT JOIN public.cleaners c ON c.id = (item->>'cleaner_id')::uuid
WHERE msl.created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2, 3
ORDER BY view_count_30d DESC
LIMIT 20;

COMMENT ON VIEW public.v_matching_top_cleaners IS
  '§3.8: Top 20 cleaners efter visningsfrekvens i v2-ranking senaste 30 dagar.';

-- ── 2. v_matching_skipped_cleaners — aktiva cleaners utan vy senaste 30d ──
CREATE OR REPLACE VIEW public.v_matching_skipped_cleaners AS
WITH viewed AS (
  SELECT DISTINCT (item->>'cleaner_id')::uuid AS cleaner_id
  FROM public.matching_shadow_log msl
  CROSS JOIN LATERAL jsonb_array_elements(msl.v2_ranking) AS item
  WHERE msl.created_at >= NOW() - INTERVAL '30 days'
)
SELECT
  c.id AS cleaner_id,
  c.full_name,
  c.city,
  c.avg_rating,
  c.created_at AS onboarded_at,
  c.is_company_owner,
  c.company_id,
  EXTRACT(DAY FROM NOW() - c.created_at)::int AS days_since_onboarded
FROM public.cleaners c
LEFT JOIN viewed v ON v.cleaner_id = c.id
WHERE c.status = 'aktiv'
  AND c.is_approved = true
  AND v.cleaner_id IS NULL
  AND c.created_at < NOW() - INTERVAL '7 days'  -- skippa nybörjare
ORDER BY c.created_at DESC
LIMIT 50;

COMMENT ON VIEW public.v_matching_skipped_cleaners IS
  '§3.8: Aktiva cleaners (>7d gamla) som inte fått en enda vy i v2-ranking senaste 30d. Möjlig matching-bug eller geo-isolering.';

-- ── 3. v_matching_score_distribution — histogram över match_score ──
CREATE OR REPLACE VIEW public.v_matching_score_distribution AS
SELECT
  CASE
    WHEN (item->>'match_score')::numeric >= 0.9 THEN '0.90-1.00'
    WHEN (item->>'match_score')::numeric >= 0.8 THEN '0.80-0.89'
    WHEN (item->>'match_score')::numeric >= 0.7 THEN '0.70-0.79'
    WHEN (item->>'match_score')::numeric >= 0.6 THEN '0.60-0.69'
    WHEN (item->>'match_score')::numeric >= 0.5 THEN '0.50-0.59'
    WHEN (item->>'match_score')::numeric >= 0.4 THEN '0.40-0.49'
    WHEN (item->>'match_score')::numeric >= 0.3 THEN '0.30-0.39'
    ELSE '0.00-0.29'
  END AS score_bucket,
  COUNT(*) AS count,
  COUNT(*) FILTER (WHERE msl.chosen_cleaner_id::text = item->>'cleaner_id') AS chosen_count
FROM public.matching_shadow_log msl
CROSS JOIN LATERAL jsonb_array_elements(msl.v2_ranking) AS item
WHERE msl.created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

COMMENT ON VIEW public.v_matching_score_distribution IS
  '§3.8: Histogram över match_score-värden senaste 30d. Plus chosen_count = hur ofta cleaners i denna bucket faktiskt valdes.';

-- ── 4. GRANT — admin (via is_admin() RPC) ──
GRANT SELECT ON public.v_matching_top_cleaners TO authenticated;
GRANT SELECT ON public.v_matching_skipped_cleaners TO authenticated;
GRANT SELECT ON public.v_matching_score_distribution TO authenticated;
