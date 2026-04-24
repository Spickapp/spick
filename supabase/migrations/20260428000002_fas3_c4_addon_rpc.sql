-- Sprint C-4 (2026-04-28): Addon-matching RPC-patch
-- Primarkalla: docs/audits/2026-04-26-modell-c-flexibel-matching.md §4
-- Baseline: 20260426130000_model2a_find_nearby_providers.sql (9 args)
-- Andring: lagg till required_addons uuid[] som 10:e param + helper
--
-- Studio-kompatibel: inget BEGIN/COMMIT-wrap, ingen DO-block, ingen unicode.

-- 1. Helper: cleaner_can_perform_addons
-- Logik:
--   - required_addons NULL eller tom array -> alla passerar
--   - platform_settings.addon_matching_enabled='false' -> kill-switch
--   - Per addon: lookup capability. Fallback till default_allow om rad saknas.
CREATE OR REPLACE FUNCTION public.cleaner_can_perform_addons(
  p_cleaner_id       uuid,
  p_required_addons  uuid[]
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    CASE
      WHEN p_required_addons IS NULL THEN true
      WHEN cardinality(p_required_addons) = 0 THEN true
      WHEN NOT COALESCE(
        NULLIF(
          (SELECT value FROM public.platform_settings WHERE key = 'addon_matching_enabled'),
          ''
        )::boolean,
        true
      ) THEN true
      ELSE (
        SELECT bool_and(
          COALESCE(
            (
              SELECT cac.can_perform
              FROM public.cleaner_addon_capabilities cac
              WHERE cac.cleaner_id = p_cleaner_id
                AND cac.addon_id = req.addon_id
            ),
            COALESCE(
              NULLIF(
                (SELECT value FROM public.platform_settings
                 WHERE key = 'addon_capabilities_default_allow'),
                ''
              )::boolean,
              true
            )
          )
        )
        FROM unnest(p_required_addons) AS req(addon_id)
      )
    END;
$fn$;

COMMENT ON FUNCTION public.cleaner_can_perform_addons(uuid, uuid[]) IS
  'Sprint C-4: Returnerar true om cleaner kan utfora alla angivna addon_ids. Las cleaner_addon_capabilities + platform_settings fallback. Kill-switch via addon_matching_enabled=false.';

GRANT EXECUTE ON FUNCTION public.cleaner_can_perform_addons(uuid, uuid[])
  TO anon, authenticated, service_role;

-- 2. find_nearby_providers: 9 args -> 10 args (+ required_addons uuid[])
-- Drop bada signaturer for idempotens
DROP FUNCTION IF EXISTS public.find_nearby_providers(
  double precision, double precision,
  date, time, integer, boolean, boolean, text, uuid
);

DROP FUNCTION IF EXISTS public.find_nearby_providers(
  double precision, double precision,
  date, time, integer, boolean, boolean, text, uuid, uuid[]
);

CREATE OR REPLACE FUNCTION public.find_nearby_providers(
  customer_lat       double precision,
  customer_lng       double precision,
  booking_date       date    DEFAULT NULL,
  booking_time       time    DEFAULT NULL,
  booking_hours      integer DEFAULT NULL,
  has_pets           boolean DEFAULT NULL,
  has_elevator       boolean DEFAULT NULL,
  booking_materials  text    DEFAULT NULL,
  customer_id        uuid    DEFAULT NULL,
  required_addons    uuid[]  DEFAULT NULL
)
RETURNS TABLE(
  provider_type              text,
  provider_id                uuid,
  representative_cleaner_id  uuid,
  slug                       text,
  display_name               text,
  avatar_url                 text,
  city                       text,
  bio                        text,
  min_hourly_rate            integer,
  services                   jsonb,
  distance_km                double precision,
  team_size                  integer,
  aggregate_rating           numeric,
  aggregate_review_count     integer,
  aggregate_completed_jobs   integer,
  has_fskatt                 boolean,
  identity_verified          boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  WITH base AS (
    SELECT
      c.id,
      c.slug,
      COALESCE(c.first_name || ' ' || c.last_name, c.first_name, 'Stadare') AS full_name,
      c.avatar_url,
      c.city,
      c.bio,
      c.hourly_rate,
      c.services,
      c.company_id,
      c.is_company_owner,
      c.avg_rating,
      c.review_count,
      c.completed_jobs,
      c.has_fskatt,
      c.identity_verified,
      co.name AS company_name,
      co.slug AS company_slug,
      co.display_name AS company_display_name,
      co.logo_url AS company_logo_url,
      ROUND((ST_Distance(
        ST_MakePoint(c.home_lng, c.home_lat)::geography,
        ST_MakePoint(find_nearby_providers.customer_lng, find_nearby_providers.customer_lat)::geography
      ) / 1000.0)::numeric, 1)::double precision AS distance_km_raw
    FROM cleaners c
    LEFT JOIN companies co ON c.company_id = co.id
    WHERE c.is_approved = true
      AND c.is_active = true
      AND c.status = 'aktiv'
      AND COALESCE(c.is_blocked, false) = false
      AND c.home_lat IS NOT NULL
      AND c.home_lng IS NOT NULL
      AND COALESCE(c.owner_only, false) = false
      AND ST_DWithin(
        ST_MakePoint(c.home_lng, c.home_lat)::geography,
        ST_MakePoint(find_nearby_providers.customer_lng, find_nearby_providers.customer_lat)::geography,
        COALESCE(c.service_radius_km, 10) * 1000
      )
      AND (
        find_nearby_providers.has_pets IS NULL
        OR find_nearby_providers.has_pets = false
        OR c.pet_pref <> 'no'
      )
      AND (
        find_nearby_providers.booking_date  IS NULL
        OR find_nearby_providers.booking_time  IS NULL
        OR find_nearby_providers.booking_hours IS NULL
        OR EXISTS (
          SELECT 1
            FROM cleaner_availability_v2 av
           WHERE av.cleaner_id = c.id
             AND av.day_of_week = EXTRACT(ISODOW FROM find_nearby_providers.booking_date)::smallint
             AND av.is_active = true
             AND av.start_time <= find_nearby_providers.booking_time
             AND av.end_time   >= (find_nearby_providers.booking_time + make_interval(hours => find_nearby_providers.booking_hours))
        )
      )
      AND public.cleaner_can_perform_addons(c.id, find_nearby_providers.required_addons)
  ),
  solos AS (
    SELECT
      'solo'::text                                         AS provider_type,
      b.id                                                 AS provider_id,
      b.id                                                 AS representative_cleaner_id,
      b.slug,
      b.full_name                                          AS display_name,
      b.avatar_url,
      b.city,
      b.bio,
      COALESCE(b.hourly_rate, 350)::integer                AS min_hourly_rate,
      b.services,
      b.distance_km_raw                                    AS distance_km,
      1::integer                                           AS team_size,
      b.avg_rating                                         AS aggregate_rating,
      COALESCE(b.review_count, 0)::integer                 AS aggregate_review_count,
      COALESCE(b.completed_jobs, 0)::integer               AS aggregate_completed_jobs,
      COALESCE(b.has_fskatt, false)                        AS has_fskatt,
      COALESCE(b.identity_verified, false)                 AS identity_verified
    FROM base b
    WHERE b.company_id IS NULL
  ),
  companies_agg AS (
    SELECT
      b.company_id,
      COUNT(*)::integer                                    AS team_size,
      MIN(COALESCE(b.hourly_rate, 350))::integer           AS min_hourly_rate,
      SUM(COALESCE(b.review_count, 0))::integer            AS aggregate_review_count,
      SUM(COALESCE(b.completed_jobs, 0))::integer          AS aggregate_completed_jobs,
      CASE
        WHEN SUM(COALESCE(b.review_count, 0)) > 0 THEN
          SUM(COALESCE(b.avg_rating, 0) * COALESCE(b.review_count, 0))::numeric
          / NULLIF(SUM(COALESCE(b.review_count, 0)), 0)::numeric
        ELSE NULL
      END                                                  AS aggregate_rating,
      (
        SELECT jsonb_agg(DISTINCT svc)
        FROM base b2,
             jsonb_array_elements_text(b2.services) AS svc
        WHERE b2.company_id = b.company_id
          AND b2.services IS NOT NULL
      )                                                    AS services,
      BOOL_OR(COALESCE(b.has_fskatt, false))               AS has_fskatt,
      BOOL_OR(COALESCE(b.identity_verified, false))        AS identity_verified
    FROM base b
    WHERE b.company_id IS NOT NULL
    GROUP BY b.company_id
  ),
  companies_representative AS (
    SELECT DISTINCT ON (b.company_id)
      b.company_id,
      b.id                AS representative_cleaner_id,
      b.distance_km_raw   AS distance_km,
      b.company_name,
      b.company_slug,
      b.company_display_name,
      b.company_logo_url,
      b.avatar_url        AS fallback_avatar
    FROM base b
    WHERE b.company_id IS NOT NULL
    ORDER BY b.company_id, b.distance_km_raw ASC
  ),
  company_providers AS (
    SELECT
      'company'::text                                      AS provider_type,
      r.company_id                                         AS provider_id,
      r.representative_cleaner_id,
      r.company_slug                                       AS slug,
      COALESCE(r.company_display_name, r.company_name)     AS display_name,
      COALESCE(r.company_logo_url, r.fallback_avatar)      AS avatar_url,
      (SELECT b.city FROM base b WHERE b.id = r.representative_cleaner_id) AS city,
      (SELECT b.bio FROM base b WHERE b.company_id = r.company_id AND b.bio IS NOT NULL LIMIT 1) AS bio,
      a.min_hourly_rate,
      a.services,
      r.distance_km,
      a.team_size,
      a.aggregate_rating,
      a.aggregate_review_count,
      a.aggregate_completed_jobs,
      a.has_fskatt,
      a.identity_verified
    FROM companies_representative r
    JOIN companies_agg a ON a.company_id = r.company_id
  )
  SELECT * FROM solos
  UNION ALL
  SELECT * FROM company_providers
  ORDER BY distance_km ASC, aggregate_rating DESC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.find_nearby_providers(
  double precision, double precision, date, time, integer, boolean, boolean, text, uuid, uuid[]
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.find_nearby_providers(
  double precision, double precision, date, time, integer, boolean, boolean, text, uuid, uuid[]
) IS
  'Sprint C-4 (2026-04-28): utokat Model-2a med required_addons uuid[] som filter via cleaner_can_perform_addons helper. NULL/tom array = ingen filter. Kill-switch via platform_settings.addon_matching_enabled.';
