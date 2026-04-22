-- ============================================================
-- Sprint 2 Dag 2 (2026-04-25): §3.7-full Step 2a — v1-RPC återskapning
-- ============================================================
-- Syfte: Återskapa historiska v1-algoritmen (distance-sort) som
--        separat RPC för shadow-mode-diff. §3.2a (2026-04-23) droppade
--        2-arg-signaturen när v2 landade — v1-logiken är raderad från
--        prod. Shadow-mode kräver att v1 kan köras parallellt.
--
-- Primärkälla:
--   - supabase/migrations/20260422113608_f2_2_find_nearby_cleaners.sql
--     (v1-body verifierad mot prod 2026-04-22 via pg_get_functiondef)
--   - docs/architecture/matching-algorithm.md §10 (A/B-ramverk)
--   - docs/architecture/matching-algorithm.md §10.1 ('v1' = distance-sort)
--
-- Design:
--   - NYTT NAMN find_nearby_cleaners_v1 — undviker kollision med v2
--     (v2 har 9 args, v1 har 2 args; olika signaturer men renare med
--     explicit namn för audit + framtida sunsetting per §10.3 steg 5)
--   - Body IDENTISK med f2_2 (22 apr) — distance + radius-filter, ORDER BY
--     distance ASC, rating DESC. Ingen score-kolumn, ingen hard-filter-
--     utökning, ingen history-multiplier.
--   - Returstruktur: 24 fält (samma som f2_2). Wrappern (§3.7 Step 2b)
--     mappar till v2:s 33-fält-schema vid shadow-log-INSERT.
--
-- Regler:
--   #26 — grep-before-edit: v1-body kopierad exakt från f2_2 utan ändring
--   #27 — scope: endast v1-RPC-skapande, ingen EF eller klient-ändring
--   #28 — ingen commission/pricing-förändring (v1 hämtar hourly_rate som är)
--   #31 — primärkälla f2_2 + prod-schema.sql rad 340 (v2-signatur verifierad)
--
-- Scope: SQL-migration endast. EF `matching-wrapper` kommer i §3.7 Step 2b.
-- Bakåtkompatibilitet: Ingen — v1 fanns inte i prod efter §3.2a-deploy.
--                       Denna migration är idempotent via DROP IF EXISTS.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Droppa ev. tidigare v1-försök (idempotens)
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.find_nearby_cleaners_v1(double precision, double precision);

-- ────────────────────────────────────────────────────────────
-- 2. find_nearby_cleaners_v1 — distance-sort (historisk algoritm)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_nearby_cleaners_v1(
  customer_lat double precision,
  customer_lng double precision
)
RETURNS TABLE(
  id uuid,
  full_name text,
  first_name text,
  last_name text,
  bio text,
  hourly_rate integer,
  profile_image_url text,
  avatar_url text,
  avg_rating numeric,
  total_reviews integer,
  review_count integer,
  services jsonb,
  city text,
  identity_verified boolean,
  home_lat double precision,
  home_lng double precision,
  pet_pref text,
  elevator_pref text,
  distance_km double precision,
  company_id uuid,
  is_company_owner boolean,
  company_name text,
  completed_jobs integer,
  has_fskatt boolean
)
LANGUAGE sql
SECURITY DEFINER
AS $function$
  SELECT
    c.id,
    COALESCE(c.first_name || ' ' || c.last_name, c.first_name, 'Städare') AS full_name,
    c.first_name,
    c.last_name,
    c.bio,
    c.hourly_rate,
    c.profile_image_url,
    c.avatar_url,
    c.avg_rating,
    c.total_reviews,
    c.review_count,
    c.services,
    c.city,
    c.identity_verified,
    c.home_lat,
    c.home_lng,
    c.pet_pref,
    c.elevator_pref,
    ROUND((ST_Distance(
      ST_MakePoint(c.home_lng, c.home_lat)::geography,
      ST_MakePoint(customer_lng, customer_lat)::geography
    ) / 1000)::numeric, 1) AS distance_km,
    c.company_id,
    c.is_company_owner,
    co.name AS company_name,
    c.completed_jobs,
    c.has_fskatt
  FROM cleaners c
  LEFT JOIN companies co ON c.company_id = co.id
  WHERE c.is_approved = true
    AND c.is_active = true
    AND c.home_lat IS NOT NULL
    AND c.home_lng IS NOT NULL
    AND (c.company_id IS NULL OR c.is_company_owner = true)
    AND ST_DWithin(
      ST_MakePoint(c.home_lng, c.home_lat)::geography,
      ST_MakePoint(customer_lng, customer_lat)::geography,
      COALESCE(c.service_radius_km, 10) * 1000
    )
  ORDER BY distance_km ASC, c.avg_rating DESC NULLS LAST;
$function$;

-- ────────────────────────────────────────────────────────────
-- 3. Grants (matchar v2-funktionens grants i prod-schema.sql rad 5632-5633)
-- ────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.find_nearby_cleaners_v1(double precision, double precision)
  TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 4. Funktions-kommentar (audit-trail)
-- ────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public.find_nearby_cleaners_v1(double precision, double precision) IS
  'Sprint 2 Dag 2 (2026-04-25) — v1-algoritm (distance-sort) återskapad för shadow-mode. '
  'Body identisk med f2_2 (2026-04-22). Anropas av EF matching-wrapper när '
  'platform_settings.matching_algorithm_version IN (''v1'', ''shadow''). '
  'Planeras sunsettas efter v2-rollout per matching-algorithm.md §10.3 steg 5.';

-- ────────────────────────────────────────────────────────────
-- 5. Verifiering
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  function_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'find_nearby_cleaners_v1'
      AND pg_get_function_arguments(p.oid) = 'customer_lat double precision, customer_lng double precision'
  ) INTO function_exists;

  IF NOT function_exists THEN
    RAISE EXCEPTION 'Sprint 2 Dag 2: find_nearby_cleaners_v1(lat,lng) skapades inte korrekt';
  END IF;

  RAISE NOTICE 'OK: find_nearby_cleaners_v1 skapad (2-arg signatur). v2-funktionen (9-arg) orörd.';
END $$;

COMMIT;

-- ============================================================
-- Aktiveringsplan (§3.7 Step 2b-d):
-- 2b. Skapa EF matching-wrapper som kallar v1 + v2, beräknar diff
--     (top5_overlap, spearman_rho, chosen_cleaner_v1/v2_rank), INSERTar
--     i matching_shadow_log, returnerar v1-rankingen till klient.
-- 2c. Uppdatera boka.html:1928 att anropa EF istället för RPC direkt.
-- 2d. UPDATE platform_settings SET value='shadow' WHERE key='matching_algorithm_version'
--     UPDATE platform_settings SET value='true'   WHERE key='matching_shadow_log_enabled'
-- 2e. Monitor 48h. Kör §3.9-pilot-queries mot matching_shadow_log.
-- 2f. Go/no-go → UPDATE value='v2' eller 'v1'.
-- 2g. (Framtid, §10.3 steg 5) DROP FUNCTION find_nearby_cleaners_v1.
-- ============================================================
