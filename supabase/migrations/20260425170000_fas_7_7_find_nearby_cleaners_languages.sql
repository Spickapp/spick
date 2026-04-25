-- Fas 7 §7.7 — find_nearby_cleaners utökad med p_languages-filter
-- ════════════════════════════════════════════════════════════════════
-- Lägger till ny optional parameter `languages text[] DEFAULT NULL` som
-- soft-/hard-filter via PostgreSQL array-overlap-operator (&&).
--
-- Pattern: NULL eller tom-array = ignorera filter (backwards-compat).
-- Annars: städaren måste tala minst ett av de begärda språken.
--
-- Strategi (rule #31 + #28):
--   1. DROP FUNCTION exakt-matchad mot prod-signatur (9 args)
--   2. CREATE FUNCTION med 10:e param appended (DEFAULT NULL → bakåtkompat)
--   3. Body kopierad från pg_get_functiondef-snapshot 2026-04-25 (rule #31)
--   4. Filter-rad placerad efter availability-block (samma struktur som has_pets)
--
-- GIN-index på cleaners.languages finns (migration 20260402100001).
-- Array-overlap (&&) använder index-stödet automatiskt.
--
-- Idempotens: DROP IF EXISTS + explicit signatur. Re-run safe.
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.find_nearby_cleaners(
  double precision, double precision, date, time without time zone,
  integer, boolean, boolean, text, uuid
);

CREATE OR REPLACE FUNCTION public.find_nearby_cleaners(
  customer_lat double precision,
  customer_lng double precision,
  booking_date date DEFAULT NULL::date,
  booking_time time without time zone DEFAULT NULL::time without time zone,
  booking_hours integer DEFAULT NULL::integer,
  has_pets boolean DEFAULT NULL::boolean,
  has_elevator boolean DEFAULT NULL::boolean,
  booking_materials text DEFAULT NULL::text,
  customer_id uuid DEFAULT NULL::uuid,
  p_languages text[] DEFAULT NULL::text[]
)
 RETURNS TABLE(id uuid, full_name text, first_name text, last_name text, bio text, hourly_rate integer, profile_image_url text, avatar_url text, avg_rating numeric, total_reviews integer, review_count integer, services jsonb, city text, identity_verified boolean, home_lat double precision, home_lng double precision, pet_pref text, elevator_pref text, distance_km double precision, company_id uuid, is_company_owner boolean, company_name text, completed_jobs integer, has_fskatt boolean, match_score numeric, distance_score numeric, rating_score numeric, completed_jobs_score numeric, preference_match_score numeric, verified_score numeric, exploration_bonus numeric, history_multiplier numeric, company_display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  WITH base AS (
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
      c.home_lat::double precision AS home_lat,
      c.home_lng::double precision AS home_lng,
      c.pet_pref,
      c.elevator_pref,
      c.company_id,
      c.is_company_owner,
      co.name AS company_name,
      c.completed_jobs,
      c.has_fskatt,
      co.display_name AS company_display_name,
      (ST_Distance(
        ST_MakePoint(c.home_lng, c.home_lat)::geography,
        ST_MakePoint(find_nearby_cleaners.customer_lng, find_nearby_cleaners.customer_lat)::geography
      ) / 1000.0)::numeric AS distance_km_raw,
      COALESCE(c.service_radius_km, 10)::numeric AS effective_radius,
      c.signup_date,
      c.material_pref,
      c.min_pay_per_job
    FROM cleaners c
    LEFT JOIN companies co ON c.company_id = co.id
    WHERE c.is_approved = true
      AND c.is_active = true
      AND c.status = 'aktiv'
      AND COALESCE(c.is_blocked, false) = false
      AND c.home_lat IS NOT NULL
      AND c.home_lng IS NOT NULL
      AND (c.company_id IS NULL OR c.is_company_owner = true)
      AND ST_DWithin(
        ST_MakePoint(c.home_lng, c.home_lat)::geography,
        ST_MakePoint(find_nearby_cleaners.customer_lng, find_nearby_cleaners.customer_lat)::geography,
        COALESCE(c.service_radius_km, 10) * 1000
      )
      AND (
        find_nearby_cleaners.has_pets IS NULL
        OR find_nearby_cleaners.has_pets = false
        OR c.pet_pref <> 'no'
      )
      AND (
        find_nearby_cleaners.booking_date IS NULL
        OR find_nearby_cleaners.booking_time IS NULL
        OR find_nearby_cleaners.booking_hours IS NULL
        OR EXISTS (
          SELECT 1
            FROM cleaner_availability_v2 av
           WHERE av.cleaner_id = c.id
             AND av.day_of_week = EXTRACT(ISODOW FROM find_nearby_cleaners.booking_date)::smallint
             AND av.is_active = true
             AND av.start_time <= find_nearby_cleaners.booking_time
             AND av.end_time   >= (find_nearby_cleaners.booking_time + make_interval(hours => find_nearby_cleaners.booking_hours))
        )
      )
      -- Fas 7 §7.7: språk-filter (hard, men opt-in via NULL/empty = ignore)
      -- Använder array-overlap-operator && (GIN-index supported).
      AND (
        find_nearby_cleaners.p_languages IS NULL
        OR cardinality(find_nearby_cleaners.p_languages) = 0
        OR c.languages && find_nearby_cleaners.p_languages
      )
  ),
  scored AS (
    SELECT
      b.*,
      GREATEST(
        0.0::numeric,
        1.0 - LEAST(b.distance_km_raw, b.effective_radius) / NULLIF(b.effective_radius, 0)
      ) AS s_distance,
      (
        (10.0 * 4.5 + COALESCE(b.review_count, 0) * COALESCE(b.avg_rating, 0.0))
        / (10.0 + COALESCE(b.review_count, 0))
      ) / 5.0 AS s_rating,
      (LEAST(COALESCE(b.completed_jobs, 0), 50))::numeric / 50.0 AS s_completed,
      (
        1::numeric
        + (CASE WHEN COALESCE(b.identity_verified, false) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(b.has_fskatt, false)         THEN 1 ELSE 0 END)
      ) / 3.0 AS s_verified,
      CASE
        WHEN COALESCE(b.review_count, 0) >= 3 AND COALESCE(b.avg_rating, 0) < 3.5 THEN 0.0::numeric
        ELSE GREATEST(
          0.0::numeric,
          1.0 - (CURRENT_DATE - COALESCE(b.signup_date, CURRENT_DATE - 31))::numeric / 30.0
        )
      END AS s_exploration,
      CASE
        WHEN find_nearby_cleaners.has_pets          IS NULL
         AND find_nearby_cleaners.has_elevator      IS NULL
         AND find_nearby_cleaners.booking_materials IS NULL
         AND find_nearby_cleaners.booking_hours     IS NULL
        THEN 1.0::numeric
        ELSE (
          (CASE
            WHEN b.pet_pref IN ('yes','some') THEN 1.0
            WHEN COALESCE(find_nearby_cleaners.has_pets, false) = false THEN 1.0
            ELSE 0.0
          END)
          + (CASE
              WHEN COALESCE(find_nearby_cleaners.has_elevator, false) = true THEN 1.0
              WHEN b.elevator_pref IN ('prefer','any') THEN 1.0
              WHEN b.elevator_pref = 'need' AND COALESCE(find_nearby_cleaners.has_elevator, false) = false THEN 0.0
              ELSE 1.0
            END)
          + (CASE
              WHEN find_nearby_cleaners.booking_materials IS NULL THEN 1.0
              WHEN b.material_pref = 'both' THEN 1.0
              WHEN b.material_pref = find_nearby_cleaners.booking_materials THEN 1.0
              ELSE 0.5
            END)
          + (CASE
              WHEN find_nearby_cleaners.booking_hours IS NULL THEN 1.0
              WHEN b.hourly_rate IS NOT NULL
               AND find_nearby_cleaners.booking_hours * b.hourly_rate >= COALESCE(b.min_pay_per_job, 0)
              THEN 1.0
              ELSE 0.5
            END)
        ) / 4.0
      END AS s_preference,
      CASE
        WHEN find_nearby_cleaners.customer_id IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM ratings r
            WHERE r.cleaner_id  = b.id
              AND r.customer_id = find_nearby_cleaners.customer_id
              AND r.rating >= 4
         )
        THEN 1.10::numeric
        ELSE 1.00::numeric
      END AS s_history
    FROM base b
  )
  SELECT
    s.id,
    s.full_name,
    s.first_name,
    s.last_name,
    s.bio,
    s.hourly_rate,
    s.profile_image_url,
    s.avatar_url,
    s.avg_rating,
    s.total_reviews,
    s.review_count,
    s.services,
    s.city,
    s.identity_verified,
    s.home_lat,
    s.home_lng,
    s.pet_pref,
    s.elevator_pref,
    ROUND(s.distance_km_raw, 1)::double precision AS distance_km,
    s.company_id,
    s.is_company_owner,
    s.company_name,
    s.completed_jobs,
    s.has_fskatt,
    LEAST(
      1.0::numeric,
      (
        0.35 * s.s_distance
      + 0.20 * s.s_rating
      + 0.15 * s.s_completed
      + 0.15 * s.s_preference
      + 0.10 * s.s_verified
      + 0.05 * s.s_exploration
      ) * s.s_history
    )::numeric(4,3) AS match_score,
    s.s_distance::numeric(4,3)    AS distance_score,
    s.s_rating::numeric(4,3)      AS rating_score,
    s.s_completed::numeric(4,3)   AS completed_jobs_score,
    s.s_preference::numeric(4,3)  AS preference_match_score,
    s.s_verified::numeric(4,3)    AS verified_score,
    s.s_exploration::numeric(4,3) AS exploration_bonus,
    s.s_history::numeric(4,3)     AS history_multiplier,
    s.company_display_name
  FROM scored s
  ORDER BY
    match_score DESC,
    distance_km ASC,
    avg_rating DESC NULLS LAST,
    review_count DESC,
    id ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.find_nearby_cleaners(
  double precision, double precision, date, time without time zone,
  integer, boolean, boolean, text, uuid, text[]
) TO anon, authenticated;
