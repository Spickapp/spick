-- Migration 20260422 (§2.2): find_nearby_cleaners RPC
--
-- Källa: PROD-VERIFIERAD 2026-04-22 via Studio SQL-query
-- (pg_get_functiondef mot pg_proc.proname='find_nearby_cleaners')
--
-- OBS: v3.md §2.2 (rad 177) pekade ursprungligen på sql/radius-model.sql
-- som källa, men den filen är obsolet (använder home_coords-kolumn som
-- inte längre existerar i prod). sql/fix-find-nearby-for-teams.sql och
-- sql/fix-nearby-part2.sql visade sig också driva från prod-sanningen
-- (text[]/jsonb-konflikt, 19 vs 24 returfält, annat company-filter).
--
-- Denna migration återspeglar PROD EXAKT per 2026-04-22. Alla sql/-filer
-- hanteras av §2.5 (arkivering/radering).

BEGIN;

-- Droppa ev. tidigare versioner med samma signatur
DROP FUNCTION IF EXISTS public.find_nearby_cleaners(double precision, double precision);

CREATE OR REPLACE FUNCTION public.find_nearby_cleaners(
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

COMMIT;
