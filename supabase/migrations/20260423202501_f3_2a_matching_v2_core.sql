-- ============================================================
-- §3.2a — find_nearby_cleaners v2 multivariat ranking
-- ============================================================
-- Primärkälla:
--   - docs/architecture/matching-algorithm.md §5 (commit f967e5d)
--   - docs/planning/spick-arkitekturplan-v3.md rad 206-208 (§3.2)
--   - prod-schema.sql 2026-04-22 (cleaners rad 1769-1849,
--     bookings rad 1086-1198, cleaner_availability_v2 rad 1607,
--     platform_settings rad 2456, ratings rad 2477)
--
-- Beslut inbakade (designdok §15):
--   (1b) utöka befintlig signatur med NULL-defaults
--   (2)  returnera både company_name och company_display_name
--   (3)  matching_shadow_log DEFERRED till §3.9
--
-- Scope: SQL-migration endast. boka.html uppdateras i §3.2b.
-- Bakåtkompatibilitet: boka.html:1928 fortsätter fungera med
-- 2-arg-anrop. Alla nya parametrar är NULLABLE med DEFAULT NULL.
-- När nya parametrar är NULL → preference_match_score och
-- history_multiplier neutraliseras till 1.0.
--
-- Avvikelser från designdok §5-§7:
--   - verified_score inkluderar is_approved per user-spec
--     (designdok §5.5 exkluderar; user-spec är auktoritativ här)
--   - history_multiplier joinar ratings.customer_id = param
--     (designdok §7 säger bookings.customer_email; user-spec
--     anger customer_id uuid — enklare och undviker DORMANT-
--     jobs-FK-problemet på ratings.job_id)
--   - ratings.rating används (inte ratings.score — designdok-fel)
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Droppa gammal signatur (CREATE OR REPLACE räcker inte när
--    parameterlistan utökas — PostgreSQL behandlar det som ny
--    overload och den gamla 2-arg-funktionen skulle coexistera
--    och vinna vid 2-arg-anrop via exakt signature-match).
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.find_nearby_cleaners(double precision, double precision);

-- ────────────────────────────────────────────────────────────
-- 2. Utökad find_nearby_cleaners med multivariat match_score
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_nearby_cleaners(
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
  id                     uuid,
  full_name              text,
  first_name             text,
  last_name              text,
  bio                    text,
  hourly_rate            integer,
  profile_image_url      text,
  avatar_url             text,
  avg_rating             numeric,
  total_reviews          integer,
  review_count           integer,
  services               jsonb,
  city                   text,
  identity_verified      boolean,
  home_lat               double precision,
  home_lng               double precision,
  pet_pref               text,
  elevator_pref          text,
  distance_km            double precision,
  company_id             uuid,
  is_company_owner       boolean,
  company_name           text,
  completed_jobs         integer,
  has_fskatt             boolean,
  match_score            numeric(4,3),
  distance_score         numeric(4,3),
  rating_score           numeric(4,3),
  completed_jobs_score   numeric(4,3),
  preference_match_score numeric(4,3),
  verified_score         numeric(4,3),
  exploration_bonus      numeric(4,3),
  history_multiplier     numeric(4,3),
  company_display_name   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  WITH base AS (
    -- Hard filter (designdok §6):
    --   #1-4 approval/active/status/blocked
    --   #5   koordinater finns
    --   #6   solo eller företags-VD
    --   #7   inom service_radius_km
    --   #8   availability (skippas om booking_date/time/hours NULL)
    --   #9   pet-disqualifier (skippas om has_pets NULL)
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
      -- Distance i km (rå, för scoring + ROUND vid retur)
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
      -- Husdjurs-disqualifier (hard filter #9) — bara om has_pets är angivet
      AND (
        find_nearby_cleaners.has_pets IS NULL
        OR find_nearby_cleaners.has_pets = false
        OR c.pet_pref <> 'no'
      )
      -- Availability (hard filter #8) — bara om booking_date/time/hours är angivna
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
  ),
  scored AS (
    SELECT
      b.*,
      -- 5.1 distance_score: linjär avfall 1.0 (på plats) → 0.0 (på radien)
      GREATEST(
        0.0::numeric,
        1.0 - LEAST(b.distance_km_raw, b.effective_radius) / NULLIF(b.effective_radius, 0)
      ) AS s_distance,
      -- 5.2 rating_score: Bayesian smoothing, C=10, PRIOR=4.5
      (
        (10.0 * 4.5 + COALESCE(b.review_count, 0) * COALESCE(b.avg_rating, 0.0))
        / (10.0 + COALESCE(b.review_count, 0))
      ) / 5.0 AS s_rating,
      -- 5.3 completed_jobs_score: linjär kappning vid 50
      (LEAST(COALESCE(b.completed_jobs, 0), 50))::numeric / 50.0 AS s_completed,
      -- 5.5 verified_score: (is_approved + identity_verified + has_fskatt) / 3
      --     is_approved är alltid true efter hard filter → baseline 0.333
      (
        1::numeric
        + (CASE WHEN COALESCE(b.identity_verified, false) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(b.has_fskatt, false)         THEN 1 ELSE 0 END)
      ) / 3.0 AS s_verified,
      -- 5.6 exploration_bonus: linjär 30-dagars fönster, cap vid review_count≥3 AND avg<3.5
      CASE
        WHEN COALESCE(b.review_count, 0) >= 3 AND COALESCE(b.avg_rating, 0) < 3.5 THEN 0.0::numeric
        ELSE GREATEST(
          0.0::numeric,
          1.0 - (CURRENT_DATE - COALESCE(b.signup_date, CURRENT_DATE - 31))::numeric / 30.0
        )
      END AS s_exploration,
      -- 5.4 preference_match_score: neutraliseras till 1.0 när inga nya params
      CASE
        WHEN find_nearby_cleaners.has_pets          IS NULL
         AND find_nearby_cleaners.has_elevator      IS NULL
         AND find_nearby_cleaners.booking_materials IS NULL
         AND find_nearby_cleaners.booking_hours     IS NULL
        THEN 1.0::numeric
        ELSE (
          -- pet_match: pet_pref='no' redan filtrerat i hard filter
          (CASE
            WHEN b.pet_pref IN ('yes','some') THEN 1.0
            WHEN COALESCE(find_nearby_cleaners.has_pets, false) = false THEN 1.0
            ELSE 0.0
          END)
          -- elevator_match
          + (CASE
              WHEN COALESCE(find_nearby_cleaners.has_elevator, false) = true THEN 1.0
              WHEN b.elevator_pref IN ('prefer','any') THEN 1.0
              WHEN b.elevator_pref = 'need' AND COALESCE(find_nearby_cleaners.has_elevator, false) = false THEN 0.0
              ELSE 1.0
            END)
          -- material_match
          + (CASE
              WHEN find_nearby_cleaners.booking_materials IS NULL THEN 1.0
              WHEN b.material_pref = 'both' THEN 1.0
              WHEN b.material_pref = find_nearby_cleaners.booking_materials THEN 1.0
              ELSE 0.5
            END)
          -- hours_match
          + (CASE
              WHEN find_nearby_cleaners.booking_hours IS NULL THEN 1.0
              WHEN b.hourly_rate IS NOT NULL
               AND find_nearby_cleaners.booking_hours * b.hourly_rate >= COALESCE(b.min_pay_per_job, 0)
              THEN 1.0
              ELSE 0.5
            END)
        ) / 4.0
      END AS s_preference,
      -- §7 history_multiplier: ×1.10 om kunden tidigare gett ≥4 till denna städare
      -- Joinar via ratings.customer_id (DEFAULT auth.uid()) → undviker DORMANT jobs-FK
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
    -- Final match_score: viktad summa × history_multiplier, cappad vid 1.0
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
  -- Deterministisk tie-break (designdok §4): score → distance → rating → reviews → id
  ORDER BY
    match_score DESC,
    distance_km ASC,
    avg_rating DESC NULLS LAST,
    review_count DESC,
    id ASC;
$function$;


-- ────────────────────────────────────────────────────────────
-- 3. Audit-kolumner på bookings (designdok §10.2)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS chosen_cleaner_match_score numeric(4,3);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS matching_algorithm_version text;

COMMENT ON COLUMN public.bookings.chosen_cleaner_match_score IS
  'Match_score för den städare kunden valde. NULL för v1-bokningar. §3.2a audit-kolumn.';

COMMENT ON COLUMN public.bookings.matching_algorithm_version IS
  'Snapshot av platform_settings.matching_algorithm_version vid bokning. Frigör analys från framtida settings-ändringar.';


-- ────────────────────────────────────────────────────────────
-- 4. Seed platform_settings (designdok §10.1)
--    Default 'v1' = nuvarande beteende. Rollout till 'v2' i §3.7.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.platform_settings (key, value)
VALUES ('matching_algorithm_version', 'v1')
ON CONFLICT (key) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 5. Index för hard filter + spatial query (designdok §11)
--    PostGIS är aktiv (prod-schema.sql rad 63) → använd gist
--    på geography-expression. earthdistance-extension finns EJ.
-- ────────────────────────────────────────────────────────────

-- Partial index på hard filter #1-3: matchar vår filter-kedja
CREATE INDEX IF NOT EXISTS idx_cleaners_approval_active
  ON public.cleaners (is_approved, is_active, status)
  WHERE is_approved = true AND is_active = true AND status = 'aktiv';

-- Spatial index: PostGIS GiST på geography (koordinater som numeric castas till double)
CREATE INDEX IF NOT EXISTS idx_cleaners_home_geo
  ON public.cleaners USING gist (
    (ST_MakePoint(home_lng::double precision, home_lat::double precision)::geography)
  )
  WHERE home_lat IS NOT NULL AND home_lng IS NOT NULL;

-- Availability-join (hard filter #8)
CREATE INDEX IF NOT EXISTS idx_availability_v2_lookup
  ON public.cleaner_availability_v2 (cleaner_id, day_of_week, is_active)
  WHERE is_active = true;


-- ────────────────────────────────────────────────────────────
-- 6. GRANT EXECUTE (matchar befintlig anon-åtkomst från boka.html)
-- ────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.find_nearby_cleaners(
  double precision, double precision, date, time, integer,
  boolean, boolean, text, uuid
) TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- 7. Verifiering: kolla att seed finns och audit-kolumner skapats
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_seed_exists boolean;
  v_cols_exist  integer;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.platform_settings WHERE key = 'matching_algorithm_version')
    INTO v_seed_exists;

  SELECT COUNT(*)
    INTO v_cols_exist
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'bookings'
     AND column_name IN ('chosen_cleaner_match_score', 'matching_algorithm_version');

  IF NOT v_seed_exists THEN
    RAISE EXCEPTION 'Migration failed: matching_algorithm_version saknas i platform_settings';
  END IF;

  IF v_cols_exist <> 2 THEN
    RAISE EXCEPTION 'Migration failed: audit-kolumner på bookings saknas (hittade %)', v_cols_exist;
  END IF;

  RAISE NOTICE 'OK: §3.2a find_nearby_cleaners v2 + audit + seed klar';
END $$;

COMMIT;

-- ============================================================
-- Efter commit: verifiera manuellt i Studio SQL
-- ============================================================
-- -- 1. Funktions-signatur
-- SELECT pg_get_functiondef(p.oid)
--   FROM pg_proc p
--   JOIN pg_namespace n ON p.pronamespace = n.oid
--  WHERE n.nspname = 'public' AND p.proname = 'find_nearby_cleaners';
--
-- -- 2. Bakåtkompatibilitet: 2-arg-anrop från boka.html:1928
-- SELECT id, full_name, distance_km, match_score
--   FROM find_nearby_cleaners(59.3293, 18.0686)
--  LIMIT 5;
--
-- -- 3. Full signature med alla params
-- SELECT id, full_name, match_score, distance_score, rating_score,
--        preference_match_score, history_multiplier
--   FROM find_nearby_cleaners(
--     59.3293, 18.0686,
--     CURRENT_DATE + 1, '10:00', 3,
--     false, true, 'cleaner', NULL
--   ) LIMIT 5;
--
-- -- 4. Audit-kolumner finns
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'bookings'
--    AND column_name IN ('chosen_cleaner_match_score', 'matching_algorithm_version');
--
-- -- 5. Platform settings seed
-- SELECT key, value FROM platform_settings WHERE key = 'matching_algorithm_version';
