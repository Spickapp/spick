-- ============================================================
-- Sprint Model-2a (2026-04-26): find_nearby_providers — bas-RPC
-- ============================================================
-- Syfte: Ny RPC som representerar matchbara entiteter som ANTINGEN
--        (a) solo-städare (individer) ELLER
--        (b) företag (aggregat av aktiva team-medlemmar).
--
-- VD som inte städar själv (owner_only=true) exkluderas från matching
-- (ersätter befintligt klient-side filter i boka.html:2010 med server-
-- side hard filter).
--
-- Företag representeras av närmaste team-medlem men visas med aggregerad
-- data: team-storlek, MIN-pris, summa completed_jobs, viktat snittbetyg.
--
-- Scoring (match_score + s_distance osv) är INTE inkluderat i Model-2a —
-- det kommer i Model-2b som ärver v2-scoring. Model-2a sorterar på
-- ren distance_km, analogt med v1-RPC.
--
-- Primärkälla:
--   docs/audits/2026-04-26-foretag-vs-stadare-modell.md §5.3 + §12 Lärdom
--   supabase/migrations/20260423202501_f3_2a_matching_v2_core.sql (v2-hard filter)
--   supabase/migrations/20260425120000_sprint2d2_find_nearby_cleaners_v1.sql (v1-pattern)
--
-- Regler:
--   #26 — grep-före-edit: v2-body + v1-body lästa i sin helhet
--   #27 — scope: endast ny RPC, rör inte v1/v2. Inget scoring (Model-2b).
--   #28 — owner_only (single source of truth) används som hard filter
--   #31 — primärkälla: DB-schema + befintliga migrations, inte memory
-- ============================================================

BEGIN;

-- Idempotens
DROP FUNCTION IF EXISTS public.find_nearby_providers(
  double precision, double precision,
  date, time, integer, boolean, boolean, text, uuid
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
  customer_id        uuid    DEFAULT NULL
)
RETURNS TABLE(
  -- Provider-identitet
  provider_type              text,        -- 'solo' | 'company'
  provider_id                uuid,        -- cleaners.id ELLER companies.id
  representative_cleaner_id  uuid,        -- ALLTID cleaners.id (för booking-create downstream)
  slug                       text,
  display_name               text,
  avatar_url                 text,
  -- Display
  city                       text,
  bio                        text,
  -- Pris
  min_hourly_rate            integer,
  services                   jsonb,
  -- Distans + match
  distance_km                double precision,
  -- Aggregat (team_size=1 för solo)
  team_size                  integer,
  aggregate_rating           numeric,
  aggregate_review_count     integer,
  aggregate_completed_jobs   integer,
  -- Trust-indikatorer
  has_fskatt                 boolean,
  identity_verified          boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  -- ═══ 1. BAS: alla aktiva cleaners inom radius ═══
  -- Hard filter identisk med v2 FÖRUTOM:
  --   - (company_id IS NULL OR is_company_owner=true) ERSATT med
  --     NOT COALESCE(owner_only, false) — inkluderar team-medlemmar,
  --     exkluderar VD:er som inte städar.
  WITH base AS (
    SELECT
      c.id,
      c.slug,
      COALESCE(c.first_name || ' ' || c.last_name, c.first_name, 'Städare') AS full_name,
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
      -- Hard filter (Model-2a): NOT owner_only (server-side)
      AND COALESCE(c.owner_only, false) = false
      AND ST_DWithin(
        ST_MakePoint(c.home_lng, c.home_lat)::geography,
        ST_MakePoint(find_nearby_providers.customer_lng, find_nearby_providers.customer_lat)::geography,
        COALESCE(c.service_radius_km, 10) * 1000
      )
      -- Pet-disqualifier (samma som v2)
      AND (
        find_nearby_providers.has_pets IS NULL
        OR find_nearby_providers.has_pets = false
        OR c.pet_pref <> 'no'
      )
      -- Availability (samma som v2)
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
  ),
  -- ═══ 2. SOLO-branch: company_id IS NULL → individ som provider ═══
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
  -- ═══ 3. COMPANY-aggregering: GROUP BY company_id ═══
  -- 3a. Aggregat-metrik per företag
  companies_agg AS (
    SELECT
      b.company_id,
      COUNT(*)::integer                                    AS team_size,
      MIN(COALESCE(b.hourly_rate, 350))::integer           AS min_hourly_rate,
      SUM(COALESCE(b.review_count, 0))::integer            AS aggregate_review_count,
      SUM(COALESCE(b.completed_jobs, 0))::integer          AS aggregate_completed_jobs,
      -- Viktat snittbetyg: SUM(avg_rating * review_count) / SUM(review_count)
      -- Faller tillbaka på enkel AVG om ingen review-data finns
      CASE
        WHEN SUM(COALESCE(b.review_count, 0)) > 0 THEN
          SUM(COALESCE(b.avg_rating, 0) * COALESCE(b.review_count, 0))::numeric
          / NULLIF(SUM(COALESCE(b.review_count, 0)), 0)::numeric
        ELSE NULL
      END                                                  AS aggregate_rating,
      -- UNION av services (jsonb_agg + distinct)
      (
        SELECT jsonb_agg(DISTINCT svc)
        FROM base b2,
             jsonb_array_elements_text(b2.services) AS svc
        WHERE b2.company_id = b.company_id
          AND b2.services IS NOT NULL
      )                                                    AS services,
      -- Trust: ANY team-medlem har f-skatt / id-verified
      BOOL_OR(COALESCE(b.has_fskatt, false))               AS has_fskatt,
      BOOL_OR(COALESCE(b.identity_verified, false))        AS identity_verified
    FROM base b
    WHERE b.company_id IS NOT NULL
    GROUP BY b.company_id
  ),
  -- 3b. Representant: närmaste team-medlem per företag
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
  -- 3c. Kombinera aggregat + representant → company provider
  company_providers AS (
    SELECT
      'company'::text                                      AS provider_type,
      r.company_id                                         AS provider_id,
      r.representative_cleaner_id,
      r.company_slug                                       AS slug,
      COALESCE(r.company_display_name, r.company_name)     AS display_name,
      COALESCE(r.company_logo_url, r.fallback_avatar)      AS avatar_url,
      -- Company-level city saknas i schema — använd representantens
      (SELECT b.city FROM base b WHERE b.id = r.representative_cleaner_id) AS city,
      -- Bio: första icke-tomma från team (eller NULL)
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
  -- ═══ 4. UNION ALL + distance-sort ═══
  SELECT * FROM solos
  UNION ALL
  SELECT * FROM company_providers
  ORDER BY distance_km ASC, aggregate_rating DESC NULLS LAST;
$function$;

-- ============================================================
-- Grants (matchar v2 per prod-schema.sql rad 5632-5633)
-- ============================================================
GRANT EXECUTE ON FUNCTION public.find_nearby_providers(
  double precision, double precision, date, time, integer, boolean, boolean, text, uuid
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.find_nearby_providers(
  double precision, double precision, date, time, integer, boolean, boolean, text, uuid
) IS
  'Sprint Model-2a (2026-04-26): bas-RPC som returnerar matchbara entiteter '
  'som (a) solo-städare eller (b) företag (aggregerade). Hard filter '
  'NOT owner_only exkluderar VD:er som inte städar. Inget match_score i '
  'Model-2a — distance-sort motsvarar v1. Model-2b inheriterar v2-scoring. '
  'Anropas av matching-wrapper EF i Sprint Model-3. Se audit 2026-04-26-'
  'foretag-vs-stadare-modell.md §5.3.';

-- ============================================================
-- Verifiering
-- ============================================================
DO $$
DECLARE
  v_function_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'find_nearby_providers'
  ) INTO v_function_exists;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'Sprint Model-2a: find_nearby_providers skapades inte';
  END IF;

  RAISE NOTICE 'OK: find_nearby_providers aktiv i public. Grants: anon, authenticated, service_role.';
END $$;

COMMIT;

-- ============================================================
-- Nästa steg:
--   Model-2b: ärv v2-scoring (match_score, s_distance, etc.)
--   Model-3:  matching-wrapper EF branch 'providers-shadow'
--   Model-4:  klient-rendering team_size + aggregat
-- ============================================================
