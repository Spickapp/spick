


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "postgres";


CREATE TYPE "public"."booking_type" AS ENUM (
    'recurring',
    'one_time'
);


ALTER TYPE "public"."booking_type" OWNER TO "postgres";


CREATE TYPE "public"."job_status" AS ENUM (
    'available',
    'pending',
    'accepted',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."job_status" OWNER TO "postgres";


CREATE TYPE "public"."job_type" AS ENUM (
    'hemstadning',
    'flyttstadning',
    'storstadning',
    'kontorsstadning'
);


ALTER TYPE "public"."job_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_convert_referral"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE cleaner_referrals
    SET status       = 'converted',
        converted_at = now(),
        booking_id   = NEW.id
    WHERE referred_email = NEW.customer_email
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_convert_referral"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."award_loyalty_points"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_hours  INT;
  v_email  TEXT;
  v_points INT;
BEGIN
  IF NEW.status = 'klar'
     AND OLD.status IS DISTINCT FROM 'klar'
     AND NEW.payment_status = 'paid'
  THEN
    v_email  := NEW.customer_email;
    v_hours  := GREATEST(COALESCE(NEW.booking_hours::int, 0), 0);
    v_points := v_hours;

    IF v_email IS NOT NULL AND v_points > 0 THEN
      INSERT INTO loyalty_points (customer_email, points, total_earned, last_updated)
      VALUES (v_email, v_points, v_points, now())
      ON CONFLICT (customer_email) DO UPDATE SET
        points       = loyalty_points.points + v_points,
        total_earned = loyalty_points.total_earned + v_points,
        last_updated = now();

      -- Uppdatera tier baserat på total_earned efter upsert
      UPDATE loyalty_points SET tier =
        CASE
          WHEN total_earned >= 1000 THEN 'vip'
          WHEN total_earned >= 500  THEN 'guld'
          WHEN total_earned >= 200  THEN 'stjarna'
          ELSE 'ny'
        END
      WHERE customer_email = v_email;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."award_loyalty_points"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer DEFAULT 10, "p_window_minutes" integer DEFAULT 60) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer, "p_window_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_rate_limits"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_start < now() - INTERVAL '2 hours';
END;
$$;


ALTER FUNCTION "public"."cleanup_rate_limits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_nearby_cleaners"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date" DEFAULT NULL::"date", "booking_time" time without time zone DEFAULT NULL::time without time zone, "booking_hours" integer DEFAULT NULL::integer, "has_pets" boolean DEFAULT NULL::boolean, "has_elevator" boolean DEFAULT NULL::boolean, "booking_materials" "text" DEFAULT NULL::"text", "customer_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "full_name" "text", "first_name" "text", "last_name" "text", "bio" "text", "hourly_rate" integer, "profile_image_url" "text", "avatar_url" "text", "avg_rating" numeric, "total_reviews" integer, "review_count" integer, "services" "jsonb", "city" "text", "identity_verified" boolean, "home_lat" double precision, "home_lng" double precision, "pet_pref" "text", "elevator_pref" "text", "distance_km" double precision, "company_id" "uuid", "is_company_owner" boolean, "company_name" "text", "completed_jobs" integer, "has_fskatt" boolean, "match_score" numeric, "distance_score" numeric, "rating_score" numeric, "completed_jobs_score" numeric, "preference_match_score" numeric, "verified_score" numeric, "exploration_bonus" numeric, "history_multiplier" numeric, "company_display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."find_nearby_cleaners"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date", "booking_time" time without time zone, "booking_hours" integer, "has_pets" boolean, "has_elevator" boolean, "booking_materials" "text", "customer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_nearby_cleaners_v1"("customer_lat" double precision, "customer_lng" double precision) RETURNS TABLE("id" "uuid", "full_name" "text", "first_name" "text", "last_name" "text", "bio" "text", "hourly_rate" integer, "profile_image_url" "text", "avatar_url" "text", "avg_rating" numeric, "total_reviews" integer, "review_count" integer, "services" "jsonb", "city" "text", "identity_verified" boolean, "home_lat" double precision, "home_lng" double precision, "pet_pref" "text", "elevator_pref" "text", "distance_km" double precision, "company_id" "uuid", "is_company_owner" boolean, "company_name" "text", "completed_jobs" integer, "has_fskatt" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."find_nearby_cleaners_v1"("customer_lat" double precision, "customer_lng" double precision) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."find_nearby_cleaners_v1"("customer_lat" double precision, "customer_lng" double precision) IS 'Sprint 2 Dag 2 (2026-04-25) — v1-algoritm (distance-sort) återskapad för shadow-mode. Body identisk med f2_2 (2026-04-22). Anropas av EF matching-wrapper när platform_settings.matching_algorithm_version IN (''v1'', ''shadow''). Planeras sunsettas efter v2-rollout per matching-algorithm.md §10.3 steg 5.';



CREATE OR REPLACE FUNCTION "public"."find_nearby_providers"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date" DEFAULT NULL::"date", "booking_time" time without time zone DEFAULT NULL::time without time zone, "booking_hours" integer DEFAULT NULL::integer, "has_pets" boolean DEFAULT NULL::boolean, "has_elevator" boolean DEFAULT NULL::boolean, "booking_materials" "text" DEFAULT NULL::"text", "customer_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("provider_type" "text", "provider_id" "uuid", "representative_cleaner_id" "uuid", "slug" "text", "display_name" "text", "avatar_url" "text", "city" "text", "bio" "text", "min_hourly_rate" integer, "services" "jsonb", "distance_km" double precision, "team_size" integer, "aggregate_rating" numeric, "aggregate_review_count" integer, "aggregate_completed_jobs" integer, "has_fskatt" boolean, "identity_verified" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."find_nearby_providers"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date", "booking_time" time without time zone, "booking_hours" integer, "has_pets" boolean, "has_elevator" boolean, "booking_materials" "text", "customer_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."find_nearby_providers"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date", "booking_time" time without time zone, "booking_hours" integer, "has_pets" boolean, "has_elevator" boolean, "booking_materials" "text", "customer_id" "uuid") IS 'Sprint Model-2a (2026-04-26): bas-RPC som returnerar matchbara entiteter som (a) solo-städare eller (b) företag (aggregerade). Hard filter NOT owner_only exkluderar VD:er som inte städar. Inget match_score i Model-2a — distance-sort motsvarar v1. Model-2b inheriterar v2-scoring. Anropas av matching-wrapper EF i Sprint Model-3. Se audit 2026-04-26-foretag-vs-stadare-modell.md §5.3.';



CREATE OR REPLACE FUNCTION "public"."fn_sync_booking_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.payment_status IN ('refunded', 'cancelled') 
     AND NEW.status IN ('pending', 'pending_confirmation', 'ny', 'bekräftad', 'confirmed')
  THEN
    NEW.status := 'avbokad';
  ELSIF NEW.payment_status = 'failed' 
     AND NEW.status IN ('pending', 'pending_confirmation', 'ny')
  THEN
    NEW.status := 'misslyckad';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_sync_booking_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_b2b_invoice_number"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  tz text;
  year_part text;
  seq_part text;
BEGIN
  -- Läs timezone från platform_settings (Regel #28).
  -- Fallback säkerställer RPC fungerar även om seed inte körts.
  SELECT value INTO tz FROM platform_settings WHERE key = 'company_timezone';
  IF tz IS NULL THEN
    tz := 'Europe/Stockholm';
  END IF;

  year_part := TO_CHAR(NOW() AT TIME ZONE tz, 'YYYY');
  seq_part := LPAD(NEXTVAL('public.b2b_invoice_number_seq')::text, 5, '0');
  RETURN 'F-' || year_part || '-' || seq_part;
END;
$$;


ALTER FUNCTION "public"."generate_b2b_invoice_number"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."generate_b2b_invoice_number"() IS 'B2B-fakturanummer. Format F-YYYY-NNNNN (5-siffrig serienummerdel). Läser timezone från platform_settings.company_timezone. Unique genom tiden (skiljer sig från SF-serien som återanvänder per år).';



CREATE OR REPLACE FUNCTION "public"."generate_booking_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_next INTEGER;
  v_year TEXT;
BEGIN
  IF NEW.booking_id IS NULL THEN
    v_year := to_char(CURRENT_DATE, 'YYYY');
    SELECT COALESCE(MAX(CAST(SPLIT_PART(booking_id, '-', 3) AS INTEGER)), 0) + 1
      INTO v_next
      FROM bookings
      WHERE booking_id LIKE 'SP-' || v_year || '-%';
    NEW.booking_id := 'SP-' || v_year || '-' || LPAD(v_next::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_booking_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_booking_slots"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  r RECORD;
  d DATE;
  slot_time TIME;
BEGIN
  -- För varje godkänd städare
  FOR r IN SELECT c.id, ca.start_time, ca.end_time, ca.break_between_min,
                   ca.day_mon, ca.day_tue, ca.day_wed, ca.day_thu, ca.day_fri, ca.day_sat, ca.day_sun
            FROM cleaners c
            JOIN cleaner_availability ca ON ca.cleaner_id = c.id
            WHERE c.is_approved = true
  LOOP
    -- Generera slots för nästa 14 dagar
    FOR d IN SELECT dd::date FROM generate_series(CURRENT_DATE + 1, CURRENT_DATE + 14, '1 day'::interval) dd
    LOOP
      -- Kolla om denna dag är aktiv
      IF (EXTRACT(DOW FROM d) = 1 AND r.day_mon) OR
         (EXTRACT(DOW FROM d) = 2 AND r.day_tue) OR
         (EXTRACT(DOW FROM d) = 3 AND r.day_wed) OR
         (EXTRACT(DOW FROM d) = 4 AND r.day_thu) OR
         (EXTRACT(DOW FROM d) = 5 AND r.day_fri) OR
         (EXTRACT(DOW FROM d) = 6 AND r.day_sat) OR
         (EXTRACT(DOW FROM d) = 0 AND r.day_sun) THEN
        
        -- Kolla att dagen inte är blockerad
        IF NOT EXISTS (SELECT 1 FROM blocked_times WHERE cleaner_id = r.id AND blocked_date = d AND all_day = true) THEN
          -- Skapa slots med 2.5h mellanrum
          slot_time := r.start_time;
          WHILE slot_time + INTERVAL '2.5 hours' <= r.end_time LOOP
            INSERT INTO booking_slots (cleaner_id, date, time, hours)
            VALUES (r.id, d, slot_time, 2.5)
            ON CONFLICT (cleaner_id, date, time) DO NOTHING;
            
            slot_time := slot_time + (INTERVAL '2.5 hours' + (r.break_between_min || ' minutes')::interval);
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."generate_booking_slots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_invoice_number"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE yr text; seq int;
BEGIN
  yr := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS int)), 0) + 1
  INTO seq FROM self_invoices WHERE invoice_number LIKE 'SF-' || yr || '-%';
  RETURN 'SF-' || yr || '-' || LPAD(seq::text, 4, '0');
END;
$$;


ALTER FUNCTION "public"."generate_invoice_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_receipt_number"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE seq_val int;
BEGIN
  seq_val := nextval('receipt_number_seq');
  RETURN 'KV-' || EXTRACT(YEAR FROM now())::text || '-' || LPAD(seq_val::text, 5, '0');
END; $$;


ALTER FUNCTION "public"."generate_receipt_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_recurring_slots"("weeks_ahead" integer DEFAULT 8) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  sub RECORD;
  slot_date date;
  interval_days integer;
  slots_created integer := 0;
BEGIN
  FOR sub IN 
    SELECT id, cleaner_id, next_booking_date, preferred_time, booking_hours, frequency
    FROM subscriptions 
    WHERE status = 'aktiv' 
      AND cleaner_id IS NOT NULL
      AND next_booking_date IS NOT NULL
      AND preferred_time IS NOT NULL
  LOOP
    -- Beräkna intervall
    interval_days := CASE sub.frequency
      WHEN 'weekly' THEN 7
      WHEN 'biweekly' THEN 14
      WHEN 'monthly' THEN 30
      ELSE 14
    END;
    
    -- Generera slots framåt
    slot_date := sub.next_booking_date;
    WHILE slot_date <= CURRENT_DATE + (weeks_ahead * 7) LOOP
      -- Skippa förflutna datum
      IF slot_date >= CURRENT_DATE THEN
        INSERT INTO booking_slots (cleaner_id, date, time, hours, is_booked, subscription_id)
        VALUES (
          sub.cleaner_id,
          slot_date,
          sub.preferred_time,
          COALESCE(sub.booking_hours, 3),
          true,
          sub.id
        )
        ON CONFLICT (cleaner_id, date, time) DO UPDATE SET
          hours = EXCLUDED.hours,
          is_booked = true,
          subscription_id = EXCLUDED.subscription_id;
        
        slots_created := slots_created + 1;
      END IF;
      
      slot_date := slot_date + interval_days;
    END LOOP;
  END LOOP;
  
  RETURN slots_created;
END;
$$;


ALTER FUNCTION "public"."generate_recurring_slots"("weeks_ahead" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cleaner_calendar"("p_cleaner_id" "uuid", "p_start" "date", "p_end" "date") RETURNS TABLE("id" "uuid", "start_at" timestamp with time zone, "end_at" timestamp with time zone, "event_type" "text", "source" "text", "booking_id" "uuid", "title" "text", "address" "text", "is_all_day" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.id, ce.start_at, ce.end_at, ce.event_type, ce.source,
    ce.booking_id, ce.title, ce.address, ce.is_all_day
  FROM calendar_events ce
  WHERE ce.cleaner_id = p_cleaner_id
    AND ce.start_at  >= p_start::timestamptz
    AND ce.end_at    <= (p_end + 1)::timestamptz
  ORDER BY ce.start_at;
END;
$$;


ALTER FUNCTION "public"."get_cleaner_calendar"("p_cleaner_id" "uuid", "p_start" "date", "p_end" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_kpis"("p_company_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  result jsonb;
  v_now timestamptz := now();
  v_week_ago date := (v_now - interval '7 days')::date;
  v_four_weeks_ago date := (v_now - interval '28 days')::date;
  v_month_ago date := (v_now - interval '30 days')::date;
  v_quarter_ago date := (v_now - interval '90 days')::date;
  v_today date := v_now::date;
BEGIN
  IF NOT is_company_owner_of(p_company_id) THEN
    RAISE EXCEPTION 'not_authorized_for_company: %', p_company_id
      USING HINT = 'Caller must be VD (is_company_owner) of the target company';
  END IF;

  SELECT jsonb_build_object(
    'bookings_this_week', (
      SELECT COUNT(*) FROM bookings b
        JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_week_ago
         AND b.status NOT IN ('pending', 'avbokad', 'timed_out')
    ),
    'bookings_last_4_weeks', (
      SELECT COUNT(*) FROM bookings b
        JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_four_weeks_ago
         AND b.status NOT IN ('pending', 'avbokad', 'timed_out')
    ),
    'completed_last_30_days', (
      SELECT COUNT(*) FROM bookings b
        JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_month_ago
         AND b.status = 'klar'
    ),
    'avg_rating', (
      SELECT ROUND(AVG(r.rating)::numeric, 2)
        FROM ratings r
        JOIN cleaners cl ON cl.id = r.cleaner_id
       WHERE cl.company_id = p_company_id
    ),
    'rating_count', (
      SELECT COUNT(*) FROM ratings r
        JOIN cleaners cl ON cl.id = r.cleaner_id
       WHERE cl.company_id = p_company_id
    ),
    'completion_rate', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE ROUND(
          COUNT(*) FILTER (WHERE b.status = 'klar')::numeric
            / COUNT(*)::numeric * 100,
          1
        )
      END
      FROM bookings b
       JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_quarter_ago
         AND b.booking_date < v_today
         AND b.status IN ('klar', 'avbokad', 'timed_out')
    ),
    'active_cleaners_this_week', (
      SELECT COUNT(DISTINCT b.cleaner_id)
        FROM bookings b
        JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_week_ago
         AND b.status NOT IN ('pending', 'avbokad', 'timed_out')
         AND b.cleaner_id IS NOT NULL
    ),
    'total_team_size', (
      SELECT COUNT(*) FROM cleaners
       WHERE company_id = p_company_id
         AND status IN ('aktiv', 'pausad', 'onboarding')
    ),
    'generated_at', v_now
  ) INTO result;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_company_kpis"("p_company_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_company_kpis"("p_company_id" "uuid") IS 'Fas 9 §9.6: VD-dashboard KPI-data. Kräver VD-autorisering via is_company_owner_of.';



CREATE OR REPLACE FUNCTION "public"."get_company_onboarding_status"("p_company_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  result jsonb;
  v_vd_id uuid;
  v_vd_stripe_status text;
BEGIN
  -- Hämta VD-info
  SELECT id, stripe_onboarding_status INTO v_vd_id, v_vd_stripe_status
    FROM cleaners
   WHERE company_id = p_company_id AND is_company_owner = true
   LIMIT 1;

  SELECT jsonb_build_object(
    'company_id', c.id,
    'company_name', c.name,
    'onboarding_status', COALESCE(c.onboarding_status, 'pending_stripe'),
    'company_verified', (c.org_number IS NOT NULL AND c.name IS NOT NULL),
    'vd_stripe_complete', (v_vd_stripe_status = 'complete'),
    'vd_stripe_status', v_vd_stripe_status,
    'team_members_count', (
      SELECT COUNT(*) 
        FROM cleaners 
       WHERE company_id = c.id 
         AND NOT COALESCE(is_company_owner, false)
    ),
    'team_members_stripe_complete', (
      SELECT COUNT(*) 
        FROM cleaners 
       WHERE company_id = c.id 
         AND NOT COALESCE(is_company_owner, false)
         AND stripe_onboarding_status = 'complete'
    ),
    'first_booking_received', EXISTS (
      SELECT 1 FROM bookings b
        JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = c.id
         AND b.payment_status = 'paid'
       LIMIT 1
    ),
    'company_logo_uploaded', (c.logo_url IS NOT NULL),
    'service_prices_configured', EXISTS (
      SELECT 1 FROM cleaner_service_prices
       WHERE cleaner_id = v_vd_id
       LIMIT 1
    ),
    'commission_rate', c.commission_rate,
    'self_signup', COALESCE(c.self_signup, false),
    'onboarding_completed_at', c.onboarding_completed_at
  ) INTO result
    FROM companies c
   WHERE c.id = p_company_id;

  IF result IS NULL THEN
    RAISE EXCEPTION 'company_not_found: %', p_company_id;
  END IF;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_company_onboarding_status"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_new_cleaner_boost"("p_cleaner_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE v_days INTEGER; v_jobs INTEGER;
BEGIN
  SELECT EXTRACT(DAY FROM (NOW() - signup_date))::INTEGER, total_jobs INTO v_days, v_jobs FROM cleaners WHERE id = p_cleaner_id;
  IF v_jobs >= 5 OR v_days > 15 THEN RETURN 0; END IF;
  IF v_days <= 7 THEN RETURN 15; ELSIF v_days <= 11 THEN RETURN 10; ELSIF v_days <= 14 THEN RETURN 5; ELSE RETURN 0; END IF;
END; $$;


ALTER FUNCTION "public"."get_new_cleaner_boost"("p_cleaner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_coupon_usage"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE coupons
  SET used_count  = used_count + 1,
      updated_at  = now()
  WHERE id = NEW.coupon_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."increment_coupon_usage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'admin_users' AND table_schema = 'public') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = auth.uid()
  );
END
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_company_owner_of"("target_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM companies
    JOIN cleaners ON cleaners.id = companies.owner_cleaner_id
    WHERE companies.id = target_company_id
    AND cleaners.auth_user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_company_owner_of"("target_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_booking_event"("p_booking_id" "uuid", "p_event_type" "text", "p_actor_type" "text" DEFAULT 'system'::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO booking_events (booking_id, event_type, actor_type, metadata)
  VALUES (p_booking_id, p_event_type, p_actor_type, p_metadata)
  RETURNING id INTO v_id;

  -- Om INSERT internt failade och v_id ar NULL → kasta exception
  -- (istallet for tyst null-return). Hjalper callers detektera bug.
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'log_booking_event: INSERT returned NULL id (unexpected)';
  END IF;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."log_booking_event"("p_booking_id" "uuid", "p_event_type" "text", "p_actor_type" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_escrow_event"("p_booking_id" "uuid", "p_from_state" "text", "p_to_state" "text", "p_triggered_by" "text", "p_triggered_by_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO escrow_events (
    booking_id, from_state, to_state, triggered_by, triggered_by_id, metadata
  )
  VALUES (
    p_booking_id, p_from_state, p_to_state, p_triggered_by, p_triggered_by_id, p_metadata
  )
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'log_escrow_event: INSERT returned NULL id (unexpected)';
  END IF;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."log_escrow_event"("p_booking_id" "uuid", "p_from_state" "text", "p_to_state" "text", "p_triggered_by" "text", "p_triggered_by_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_escrow_event"("p_booking_id" "uuid", "p_from_state" "text", "p_to_state" "text", "p_triggered_by" "text", "p_triggered_by_id" "uuid", "p_metadata" "jsonb") IS 'Fas 8 §8.6 fix: Bypass RLS för escrow_events INSERT. SECURITY DEFINER kör som function-owner.';



CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_booking_to_calendar"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_start  timestamptz;
  v_end    timestamptz;
  v_title  text;
  v_addr   text;
  v_hours  numeric;
BEGIN
  -- DELETE: ta bort motsvarande calendar_event
  IF TG_OP = 'DELETE' THEN
    DELETE FROM calendar_events WHERE booking_id = OLD.id;
    RETURN OLD;
  END IF;

  -- NY GUARD: Skippa om inga schema-relevanta fält ändrats (UPDATE only)
  -- Detta skyddar mot onödiga calendar_events-rewrites vid metadatauppdateringar
  -- (t.ex. cleaner_email-backfill, status-uppdatering utan tidsändring, etc.)
  IF TG_OP = 'UPDATE' 
     AND OLD.cleaner_id       IS NOT DISTINCT FROM NEW.cleaner_id
     AND OLD.booking_date     IS NOT DISTINCT FROM NEW.booking_date
     AND OLD.booking_time     IS NOT DISTINCT FROM NEW.booking_time
     AND OLD.booking_hours    IS NOT DISTINCT FROM NEW.booking_hours
     AND OLD.service_type     IS NOT DISTINCT FROM NEW.service_type
     AND OLD.customer_address IS NOT DISTINCT FROM NEW.customer_address
     AND OLD.status           IS NOT DISTINCT FROM NEW.status
     AND OLD.payment_status   IS NOT DISTINCT FROM NEW.payment_status
     AND OLD.checkin_lat      IS NOT DISTINCT FROM NEW.checkin_lat
     AND OLD.checkin_lng      IS NOT DISTINCT FROM NEW.checkin_lng
  THEN
    RETURN NEW;
  END IF;

  -- Skippa rader utan tilldelad städare
  IF NEW.cleaner_id IS NULL THEN
    DELETE FROM calendar_events WHERE booking_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Beräkna tid
  v_hours := COALESCE(NEW.booking_hours, 3);
  v_start := (NEW.booking_date::text || ' ' || COALESCE(NEW.booking_time::text, '09:00'))::timestamptz;
  v_end   := v_start + (v_hours || ' hours')::interval;
  v_title := COALESCE(NEW.service_type, 'Städning');
  v_addr  := COALESCE(NEW.customer_address, '');

  -- Avbokade/refunderade → ta bort ev. event
  IF NEW.status IN ('cancelled','avbokad') OR NEW.payment_status = 'refunded' THEN
    DELETE FROM calendar_events WHERE booking_id = NEW.id;
    RETURN NEW;
  END IF;

  -- UPSERT
  INSERT INTO calendar_events (
    cleaner_id, start_at, end_at, event_type, source, booking_id,
    title, address, location_lat, location_lng
  ) VALUES (
    NEW.cleaner_id, v_start, v_end, 'booking', 'spick', NEW.id,
    v_title, v_addr, NEW.checkin_lat, NEW.checkin_lng
  )
  ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL
  DO UPDATE SET
    cleaner_id   = EXCLUDED.cleaner_id,
    start_at     = EXCLUDED.start_at,
    end_at       = EXCLUDED.end_at,
    title        = EXCLUDED.title,
    address      = EXCLUDED.address,
    location_lat = EXCLUDED.location_lat,
    location_lng = EXCLUDED.location_lng,
    updated_at   = now();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_booking_to_calendar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_booking_to_slot"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.payment_status = 'paid' AND NEW.cleaner_id IS NOT NULL 
     AND NEW.booking_date IS NOT NULL AND NEW.booking_time IS NOT NULL THEN
    INSERT INTO booking_slots (cleaner_id, date, time, hours, is_booked, booking_id)
    VALUES (
      NEW.cleaner_id,
      NEW.booking_date,
      NEW.booking_time,
      COALESCE(NEW.booking_hours, 3),
      true,
      NEW.id
    )
    ON CONFLICT (booking_id) DO UPDATE SET
      cleaner_id = EXCLUDED.cleaner_id,
      date = EXCLUDED.date,
      time = EXCLUDED.time,
      hours = EXCLUDED.hours,
      is_booked = true;
  END IF;
  
  -- Om bokning avbokad, ta bort slot
  IF NEW.status IN ('cancelled', 'avbokad') AND OLD.status NOT IN ('cancelled', 'avbokad') THEN
    DELETE FROM booking_slots WHERE booking_id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_booking_to_slot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_cleaner_contact_to_bookings"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.email IS DISTINCT FROM NEW.email OR OLD.phone IS DISTINCT FROM NEW.phone THEN
    UPDATE bookings 
    SET cleaner_email = NEW.email, cleaner_phone = NEW.phone
    WHERE cleaner_id = NEW.id
      AND status NOT IN ('completed', 'cancelled', 'avbokad')
      AND payment_status IS DISTINCT FROM 'refunded';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_cleaner_contact_to_bookings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_cleaner_hourly_rate"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Synka full_name
  NEW.full_name := COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '');
  
  IF NEW.hourly_rate IS NULL AND NEW.min_pay_per_hour IS NOT NULL THEN
    NEW.hourly_rate := NEW.min_pay_per_hour;
  ELSIF NEW.min_pay_per_hour IS NULL AND NEW.hourly_rate IS NOT NULL THEN
    NEW.min_pay_per_hour := NEW.hourly_rate;
  END IF;
  -- Synka profile_image och avatar_url
  IF NEW.profile_image IS NULL AND NEW.avatar_url IS NOT NULL THEN
    NEW.profile_image := NEW.avatar_url;
  ELSIF NEW.avatar_url IS NULL AND NEW.profile_image IS NOT NULL THEN
    NEW.avatar_url := NEW.profile_image;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_cleaner_hourly_rate"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_cleaner_review_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE cleaners SET 
    avg_rating = COALESCE(sub.avg, 0), 
    total_ratings = COALESCE(sub.cnt, 0)
  FROM (
    SELECT cleaner_id, ROUND(AVG(rating)::numeric, 1) AS avg, COUNT(*)::integer AS cnt
    FROM ratings
    WHERE cleaner_id = COALESCE(NEW.cleaner_id, OLD.cleaner_id)
    GROUP BY cleaner_id
  ) sub 
  WHERE cleaners.id = sub.cleaner_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_cleaner_review_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_hourly_rate_from_service_prices"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE cleaners SET hourly_rate = COALESCE(
    (SELECT MIN(price) FROM cleaner_service_prices 
     WHERE cleaner_id = COALESCE(NEW.cleaner_id, OLD.cleaner_id) 
     AND price_type = 'hourly'),
    (SELECT hourly_rate FROM cleaners WHERE id = COALESCE(NEW.cleaner_id, OLD.cleaner_id))
  )
  WHERE id = COALESCE(NEW.cleaner_id, OLD.cleaner_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."sync_hourly_rate_from_service_prices"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_customer_prefs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_customer_prefs_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_cal_conn_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_cal_conn_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_calendar_events_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_calendar_events_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_cleaner_rating"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE cleaners SET
    avg_rating = (SELECT ROUND(AVG(rating)::DECIMAL, 1) FROM ratings WHERE cleaner_id = NEW.cleaner_id),
    total_ratings = (SELECT COUNT(*) FROM ratings WHERE cleaner_id = NEW.cleaner_id),
    updated_at = NOW()
  WHERE id = NEW.cleaner_id;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."update_cleaner_rating"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_slot_holds_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_slot_holds_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_avail_v2_no_overlap"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.is_active = false THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM cleaner_availability_v2 a
    WHERE a.cleaner_id = NEW.cleaner_id
      AND a.day_of_week = NEW.day_of_week
      AND a.is_active = true
      AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.start_time < NEW.end_time
      AND a.end_time   > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Overlapping availability slot for cleaner % on day %', NEW.cleaner_id, NEW.day_of_week;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_avail_v2_no_overlap"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_type" "text" DEFAULT 'cleaner'::"text" NOT NULL,
    "actor_id" "uuid",
    "actor_name" "text",
    "action" "text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "admin_email" "text",
    "old_value" "jsonb",
    "new_value" "jsonb",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "admin_role" "text"
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource" "text" NOT NULL,
    "action" "text" NOT NULL
);


ALTER TABLE "public"."admin_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "level" integer DEFAULT 0 NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."admin_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "role_id" "uuid",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analytics_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "page" "text",
    "referrer" "text",
    "user_agent" "text",
    "ip_hash" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."analytics_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attested_jobs" (
    "booking_id" "uuid" NOT NULL,
    "attested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attest_method" "text" NOT NULL,
    "customer_note" "text",
    CONSTRAINT "attested_jobs_method_check" CHECK (("attest_method" = ANY (ARRAY['customer_manual'::"text", 'auto_24h_timer'::"text"])))
);


ALTER TABLE "public"."attested_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."attested_jobs" IS 'Fas 8 §8.4.4: Attestering som triggar escrow-release. customer_manual eller auto_24h_timer.';



CREATE TABLE IF NOT EXISTS "public"."auth_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "user_email" "text",
    "user_id" "uuid",
    "resource_type" "text",
    "resource_id" "uuid",
    "ip_address" "text",
    "user_agent" "text",
    "success" boolean DEFAULT true NOT NULL,
    "error_message" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auth_audit_log_event_type_check" CHECK (("event_type" = ANY (ARRAY['magic_link_generated'::"text", 'magic_link_used'::"text", 'magic_link_expired'::"text", 'magic_link_reuse_attempt'::"text", 'auth_user_created'::"text", 'auth_session_created'::"text", 'auth_session_expired'::"text", 'gdpr_export_requested'::"text", 'gdpr_deletion_requested'::"text"])))
);


ALTER TABLE "public"."auth_audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."auth_audit_log" IS 'Audit log of all authentication events. Required for EU Platform Directive (2 dec 2026) compliance.';



CREATE SEQUENCE IF NOT EXISTS "public"."b2b_invoice_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."b2b_invoice_number_seq" OWNER TO "postgres";


COMMENT ON SEQUENCE "public"."b2b_invoice_number_seq" IS 'Sequence för B2B-fakturanummer (§2.7.1). Monotoniskt ökande genom alla år. Juridiskt krav "obruten sekvens" uppfylls av sequence-monotonicitet.';



CREATE TABLE IF NOT EXISTS "public"."blocked_times" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "blocked_date" "date" NOT NULL,
    "start_time" time without time zone DEFAULT '08:00:00'::time without time zone,
    "end_time" time without time zone DEFAULT '18:00:00'::time without time zone,
    "all_day" boolean DEFAULT false,
    "reason" "text" DEFAULT 'day_off'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."blocked_times" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "requested_by" "text" NOT NULL,
    "reason" "text",
    "original_amount" integer NOT NULL,
    "new_amount" integer NOT NULL,
    "difference" integer NOT NULL,
    "rut_eligible" boolean DEFAULT false,
    "rut_amount" integer DEFAULT 0,
    "stripe_payment_intent_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "booking_adjustments_requested_by_check" CHECK (("requested_by" = ANY (ARRAY['cleaner'::"text", 'customer'::"text", 'admin'::"text"]))),
    CONSTRAINT "booking_adjustments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."booking_adjustments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_checklists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "checklist_id" "uuid",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."booking_checklists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "text",
    "customer_name" "text" NOT NULL,
    "customer_email" "text",
    "customer_phone" "text",
    "customer_address" "text",
    "customer_pnr_hash" "text",
    "cleaner_id" "uuid",
    "cleaner_name" "text",
    "service_type" "text" DEFAULT 'hemstadning'::"text",
    "frequency" "text" DEFAULT 'one_time'::"text",
    "booking_date" "date" NOT NULL,
    "booking_time" time without time zone NOT NULL,
    "booking_hours" numeric(3,1) DEFAULT 2.5,
    "square_meters" integer,
    "has_pets" boolean DEFAULT false,
    "has_materials" boolean DEFAULT false,
    "extra_services" "text"[],
    "notes" "text",
    "total_price" integer NOT NULL,
    "rut_amount" integer DEFAULT 0,
    "payment_status" "text" DEFAULT 'pending'::"text",
    "payment_method" "text",
    "referral_code" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "portal_job_id" "uuid",
    "portal_customer_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "refund_amount" integer,
    "refund_percent" integer,
    "payment_intent_id" "text",
    "base_price_per_hour" numeric,
    "customer_price_per_hour" numeric,
    "cleaner_price_per_hour" numeric,
    "commission_pct" numeric,
    "discount_pct" numeric DEFAULT 0,
    "discount_code" "text",
    "spick_gross_sek" numeric,
    "spick_net_sek" numeric,
    "net_margin_pct" numeric,
    "stripe_fee_sek" numeric,
    "credit_applied_sek" numeric DEFAULT 0,
    "customer_pnr" "text",
    "stripe_session_id" "text",
    "confirmed_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "rejection_reason" "text",
    "key_type" "text",
    "key_info" "text",
    "payout_status" "text",
    "payout_date" timestamp with time zone,
    "checkin_lat" double precision,
    "checkin_lng" double precision,
    "checkin_accuracy_m" integer,
    "checkin_distance_m" integer,
    "checkin_gps_status" "text" DEFAULT 'unknown'::"text",
    "checkout_lat" double precision,
    "checkout_lng" double precision,
    "checkout_accuracy_m" integer,
    "checkout_distance_m" integer,
    "checkout_gps_status" "text" DEFAULT 'unknown'::"text",
    "customer_type" "text" DEFAULT 'privat'::"text",
    "business_name" "text",
    "business_org_number" "text",
    "business_reference" "text",
    "checkin_time" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "admin_notes" "text",
    "checkout_time" timestamp with time zone,
    "actual_hours" numeric,
    "attest_status" "text" DEFAULT 'pending'::"text",
    "attested_by" "uuid",
    "attested_at" timestamp with time zone,
    "receipt_number" "text",
    "receipt_url" "text",
    "customer_company_name" "text",
    "customer_org_number" "text",
    "reassignment_proposed_cleaner_id" "uuid",
    "reassignment_proposed_at" timestamp with time zone,
    "reassignment_proposed_by" "uuid",
    "reassignment_attempts" integer DEFAULT 0,
    "auto_delegation_enabled" boolean,
    "reminders_sent" "text"[] DEFAULT '{}'::"text"[],
    "payment_mode" "text" DEFAULT 'stripe_checkout'::"text",
    "payment_marked_at" timestamp with time zone,
    "payment_marked_by" "uuid",
    "payment_due_date" "date",
    "subscription_id" "uuid",
    "manual_override_price" integer,
    "stripe_payment_intent_id" "text",
    "subscription_charge_attempts" integer DEFAULT 0,
    "subscription_charge_failed_at" timestamp with time zone,
    "dispute_status" "text" DEFAULT 'none'::"text",
    "dispute_opened_at" timestamp with time zone,
    "dispute_amount_sek" integer,
    "dispute_reason" "text",
    "dispute_evidence_urls" "jsonb",
    "refund_history" "jsonb" DEFAULT '[]'::"jsonb",
    "customer_accepted_terms_at" timestamp with time zone,
    "terms_version_accepted" "text",
    "rut_application_status" "text" DEFAULT 'not_applicable'::"text",
    "cleaner_email" "text",
    "cleaner_phone" "text",
    "receipt_email_sent_at" timestamp with time zone,
    "business_vat_number" "text",
    "business_contact_person" "text",
    "business_invoice_email" "text",
    "invoice_address_street" "text",
    "invoice_address_city" "text",
    "invoice_address_postal_code" "text",
    "invoice_number" "text",
    "chosen_cleaner_match_score" numeric(4,3),
    "matching_algorithm_version" "text",
    "rut_claim_id" "text",
    "rut_claim_status" "text",
    "rut_claim_error" "text",
    "rut_submitted_at" timestamp with time zone,
    "escrow_state" "text" DEFAULT 'released_legacy'::"text" NOT NULL,
    CONSTRAINT "bookings_attest_status_check" CHECK (("attest_status" = ANY (ARRAY['pending'::"text", 'attested'::"text", 'disputed'::"text"]))),
    CONSTRAINT "bookings_dispute_status_check" CHECK (("dispute_status" = ANY (ARRAY['none'::"text", 'pending'::"text", 'won'::"text", 'lost'::"text", 'refunded'::"text"]))),
    CONSTRAINT "bookings_escrow_state_check" CHECK (("escrow_state" = ANY (ARRAY['pending_payment'::"text", 'paid_held'::"text", 'awaiting_attest'::"text", 'released'::"text", 'disputed'::"text", 'resolved_full_refund'::"text", 'resolved_partial_refund'::"text", 'resolved_dismissed'::"text", 'refunded'::"text", 'cancelled'::"text", 'released_legacy'::"text"]))),
    CONSTRAINT "bookings_payment_mode_check" CHECK (("payment_mode" = ANY (ARRAY['stripe_checkout'::"text", 'stripe_subscription'::"text", 'invoice'::"text"]))),
    CONSTRAINT "bookings_rut_application_status_check" CHECK (("rut_application_status" = ANY (ARRAY['not_applicable'::"text", 'pending'::"text", 'submitted'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'completed'::"text", 'cancelled'::"text", 'klar'::"text", 'pågår'::"text", 'bekräftad'::"text", 'avbokad'::"text", 'pending_confirmation'::"text", 'timed_out'::"text", 'rejected_by_cleaner'::"text", 'awaiting_reassignment'::"text", 'awaiting_company_proposal'::"text", 'awaiting_customer_approval'::"text", 'auto_reassigning'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


COMMENT ON TABLE "public"."bookings" IS 'RLS-notering: SELECT USING (true) tillåter anon-läsning. 
   Admin och scripts använder service_role. 
   Klienter filtrerar på customer_email i query.
   TODO: Implementera Supabase Auth för kunder för skärpt säkerhet.';



COMMENT ON COLUMN "public"."bookings"."customer_pnr" IS 'Krypterat personnummer, används av rut-claim EF för Skatteverket-ansökan.
   Raderas automatiskt efter lyckad/misslyckad ansökan. Aldrig i klartext.';



COMMENT ON COLUMN "public"."bookings"."actual_hours" IS 'Beräknas automatiskt vid "end" som (actual_end_at - actual_start_at) i timmar';



COMMENT ON COLUMN "public"."bookings"."reassignment_proposed_cleaner_id" IS 'VD:ns föreslagna ersättare. NULL om ingen proposal aktiv eller om kunden valt själv.';



COMMENT ON COLUMN "public"."bookings"."reassignment_proposed_at" IS 'När VD föreslog ersättare. Används för SLA-timer (1h för kund att godkänna).';



COMMENT ON COLUMN "public"."bookings"."reassignment_proposed_by" IS 'Vilken VD föreslog ersättaren. Revisionsspår.';



COMMENT ON COLUMN "public"."bookings"."reassignment_attempts" IS 'Antal reassignment-försök för denna bokning. Eskalera till awaiting_reassignment om > 3.';



COMMENT ON COLUMN "public"."bookings"."auto_delegation_enabled" IS 'Per-booking override. NULL = använd customer_profile.auto_delegation_enabled. TRUE = företaget får auto-tilldela ersättare. FALSE = kund måste godkänna.';



COMMENT ON COLUMN "public"."bookings"."payment_mode" IS 'stripe_prepay | post_service_manual | stripe_retry';



COMMENT ON COLUMN "public"."bookings"."payment_marked_at" IS 'VD markerade som betald (post_service_manual)';



COMMENT ON COLUMN "public"."bookings"."payment_marked_by" IS 'cleaner_id (VD) som markerade';



COMMENT ON COLUMN "public"."bookings"."payment_due_date" IS 'Förfallodag för post_service_manual (default: booking_date + 7d)';



COMMENT ON COLUMN "public"."bookings"."subscription_id" IS 'FK till subscriptions om auto-genererad';



COMMENT ON COLUMN "public"."bookings"."manual_override_price" IS 'VD-justerat totalpris som kund betalar (istället för pricing-engine)';



COMMENT ON COLUMN "public"."bookings"."stripe_payment_intent_id" IS 'PaymentIntent ID vid subscription off-session charge';



COMMENT ON COLUMN "public"."bookings"."subscription_charge_attempts" IS 'Antal charge-försök (max 3, sedan pausa sub)';



COMMENT ON COLUMN "public"."bookings"."dispute_status" IS 'none | pending | won | lost | refunded';



COMMENT ON COLUMN "public"."bookings"."refund_history" IS '[{amount, reason, initiated_by, created_at}]';



COMMENT ON COLUMN "public"."bookings"."rut_application_status" IS 'not_applicable | pending | submitted | approved | rejected';



COMMENT ON COLUMN "public"."bookings"."receipt_email_sent_at" IS 'Fas 2.5-R2: Satt när kund-kvitto-mejl bekräftat skickat. Idempotens-flagga för generate-receipt-EF. NULL = mejl aldrig skickat (eller att skicka om).';



COMMENT ON COLUMN "public"."bookings"."business_vat_number" IS 'Momsregistreringsnr för B2B-kund (SE559402452201-format). Obligatoriskt om momsbelopp >= 2000 kr enligt MervL 11 kap 8§. NULL för B2C.';



COMMENT ON COLUMN "public"."bookings"."business_contact_person" IS 'Fakturareferent — t.ex. "Anna Andersson, ekonomi". Visas som "Att: ..."-rad på fakturan.';



COMMENT ON COLUMN "public"."bookings"."business_invoice_email" IS 'Separat fakturamottagnings-mejl. Om NULL, skickas fakturan till customer_email.';



COMMENT ON COLUMN "public"."bookings"."invoice_address_street" IS 'Fakturaadress street — kan skilja sig från tjänsteadress (huvudkontor vs. städadress).';



COMMENT ON COLUMN "public"."bookings"."invoice_address_city" IS 'Ort för fakturaadress. Används på F-fakturan.';



COMMENT ON COLUMN "public"."bookings"."invoice_address_postal_code" IS 'Postnummer för fakturaadress. Används på F-fakturan.';



COMMENT ON COLUMN "public"."bookings"."invoice_number" IS 'F-YYYY-NNNNN för B2B. NULL för B2C (som har receipt_number istället). Partial unique index skyddar F-serien.';



COMMENT ON COLUMN "public"."bookings"."chosen_cleaner_match_score" IS 'Match_score för den städare kunden valde. NULL för v1-bokningar. §3.2a audit-kolumn.';



COMMENT ON COLUMN "public"."bookings"."matching_algorithm_version" IS 'Snapshot av platform_settings.matching_algorithm_version vid bokning. Frigör analys från framtida settings-ändringar.';



COMMENT ON COLUMN "public"."bookings"."escrow_state" IS 'Fas 8 state-machine. Terminal-states: released, refunded, cancelled, released_legacy.';



CREATE OR REPLACE VIEW "public"."booking_confirmation" AS
 SELECT "id",
    "booking_id",
    "customer_name",
    "customer_email",
    "customer_phone",
    "customer_address",
    "customer_pnr_hash",
    "cleaner_id",
    "cleaner_name",
    "service_type",
    "frequency",
    "booking_date",
    "booking_time",
    "booking_hours",
    "square_meters",
    "has_pets",
    "has_materials",
    "extra_services",
    "notes",
    "total_price",
    "rut_amount",
    "payment_status",
    "payment_method",
    "referral_code",
    "status",
    "portal_job_id",
    "portal_customer_id",
    "created_at",
    "updated_at",
    "cancelled_at",
    "cancellation_reason",
    "refund_amount",
    "refund_percent",
    "payment_intent_id"
   FROM "public"."bookings";


ALTER VIEW "public"."booking_confirmation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_type" "text" DEFAULT 'system'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."booking_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "sender_type" "text" NOT NULL,
    "sender_name" "text",
    "message" "text" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "booking_messages_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['customer'::"text", 'cleaner'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."booking_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_modifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "requested_by" "text" NOT NULL,
    "old_date" "date",
    "new_date" "date",
    "old_time" time without time zone,
    "new_time" time without time zone,
    "old_hours" numeric(4,1),
    "new_hours" numeric(4,1),
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "booking_modifications_requested_by_check" CHECK (("requested_by" = ANY (ARRAY['customer'::"text", 'cleaner'::"text", 'admin'::"text"]))),
    CONSTRAINT "booking_modifications_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'applied'::"text"])))
);


ALTER TABLE "public"."booking_modifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "cleaner_id" "uuid",
    "photo_url" "text" NOT NULL,
    "photo_type" "text" DEFAULT 'before'::"text" NOT NULL,
    "caption" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "booking_photos_photo_type_check" CHECK (("photo_type" = ANY (ARRAY['before'::"text", 'after'::"text", 'issue'::"text"])))
);


ALTER TABLE "public"."booking_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "time" time without time zone NOT NULL,
    "hours" numeric(3,1) DEFAULT 2.0 NOT NULL,
    "is_booked" boolean DEFAULT false,
    "booked_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "booking_id" "uuid",
    "subscription_id" "uuid"
);


ALTER TABLE "public"."booking_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_staff" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'assistant'::"text" NOT NULL,
    "hours_worked" numeric(5,2),
    "status" "text" DEFAULT 'assigned'::"text" NOT NULL,
    "assigned_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "booking_staff_role_check" CHECK (("role" = ANY (ARRAY['primary'::"text", 'assistant'::"text"]))),
    CONSTRAINT "booking_staff_status_check" CHECK (("status" = ANY (ARRAY['assigned'::"text", 'confirmed'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."booking_staff" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_status_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "booking_id" "uuid",
    "old_status" "text",
    "new_status" "text",
    "changed_by" "uuid",
    "reason" "text",
    "cleaner_email" "text"
);


ALTER TABLE "public"."booking_status_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_team" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "customer_approved" boolean,
    "invite_sent_at" timestamp with time zone DEFAULT "now"(),
    "colleague_responded_at" timestamp with time zone,
    "customer_responded_at" timestamp with time zone,
    "checkin_lat" double precision,
    "checkin_lng" double precision,
    "checkin_time" timestamp with time zone,
    "checkout_time" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."booking_team" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "token_expires_at" timestamp with time zone,
    "calendar_id" "text",
    "caldav_url" "text",
    "sync_token" "text",
    "last_synced_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "sync_direction" "text" DEFAULT 'both'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "calendar_connections_provider_check" CHECK (("provider" = ANY (ARRAY['google'::"text", 'outlook'::"text", 'caldav'::"text"]))),
    CONSTRAINT "calendar_connections_sync_direction_check" CHECK (("sync_direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text", 'both'::"text"])))
);


ALTER TABLE "public"."calendar_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "event_type" "text" NOT NULL,
    "source" "text" DEFAULT 'spick'::"text" NOT NULL,
    "booking_id" "uuid",
    "external_id" "text",
    "title" "text",
    "description" "text",
    "location_lat" numeric,
    "location_lng" numeric,
    "address" "text",
    "color" "text",
    "is_all_day" boolean DEFAULT false,
    "recurrence_rule" "text",
    "recurrence_end" "date",
    "synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "booking_ref" CHECK (((("event_type" = 'booking'::"text") AND ("booking_id" IS NOT NULL)) OR ("event_type" <> 'booking'::"text"))),
    CONSTRAINT "calendar_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['booking'::"text", 'blocked'::"text", 'travel'::"text", 'external'::"text", 'break'::"text"]))),
    CONSTRAINT "calendar_events_source_check" CHECK (("source" = ANY (ARRAY['spick'::"text", 'google'::"text", 'outlook'::"text", 'ical'::"text", 'manual'::"text"]))),
    CONSTRAINT "valid_time_range" CHECK (("end_at" > "start_at"))
);


ALTER TABLE "public"."calendar_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text",
    "first_name" "text",
    "last_name" "text",
    "email" "text",
    "phone" "text",
    "city" "text",
    "bio" "text",
    "hourly_rate" integer DEFAULT 350,
    "services" "jsonb" DEFAULT '[]'::"jsonb",
    "service_radius_km" integer DEFAULT 10,
    "status" "text" DEFAULT 'pending'::"text",
    "marketing_consent" boolean DEFAULT false,
    "gdpr_consent" boolean DEFAULT false,
    "gdpr_consent_at" timestamp with time zone,
    "fskatt_confirmed" boolean DEFAULT false,
    "onboarding_phase" "text" DEFAULT 'applied'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "home_lat" double precision,
    "home_lng" double precision,
    "home_address" "text",
    "approved_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "reviewed_by" "text",
    "is_company" boolean DEFAULT false,
    "company_name" "text",
    "org_number" "text",
    "team_size" integer,
    "test_score" integer,
    "test_completed_at" timestamp with time zone,
    "test_answers" "jsonb",
    "fskatt_needs_help" boolean DEFAULT false,
    "invited_by_company_id" "uuid",
    "languages" "text"[],
    "experience" "text",
    "owner_only" boolean DEFAULT false,
    "pet_pref" "text" DEFAULT 'ok'::"text",
    "invited_via_magic_code" "text",
    "invited_phone" "text",
    "bankid_verified_at" timestamp with time zone,
    "bankid_personnummer_hash" "text"
);


ALTER TABLE "public"."cleaner_applications" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cleaner_applications"."invited_via_magic_code" IS 'Magic-link kod från public-auth-link (för team-invitations)';



COMMENT ON COLUMN "public"."cleaner_applications"."invited_phone" IS 'Telefonnummer SMS-inbjudan skickades till';



COMMENT ON COLUMN "public"."cleaner_applications"."bankid_verified_at" IS 'Tidsstämpel när cleaner slutförde BankID-verifiering';



COMMENT ON COLUMN "public"."cleaner_applications"."bankid_personnummer_hash" IS 'SHA256-hash av personnummer (GDPR-säker)';



CREATE TABLE IF NOT EXISTS "public"."cleaner_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "day_mon" boolean DEFAULT true,
    "day_tue" boolean DEFAULT true,
    "day_wed" boolean DEFAULT true,
    "day_thu" boolean DEFAULT true,
    "day_fri" boolean DEFAULT true,
    "day_sat" boolean DEFAULT false,
    "day_sun" boolean DEFAULT false,
    "start_time" time without time zone DEFAULT '08:00:00'::time without time zone,
    "end_time" time without time zone DEFAULT '18:00:00'::time without time zone,
    "evenings_ok" boolean DEFAULT false,
    "weekends_ok" boolean DEFAULT false,
    "max_jobs_per_day" integer DEFAULT 4,
    "max_hours_per_day" numeric(3,1) DEFAULT 8.0,
    "break_between_min" integer DEFAULT 30,
    "min_lead_time_hours" integer DEFAULT 24,
    "min_job_length_hours" numeric(3,1) DEFAULT 2.0,
    "preferred_start_time" time without time zone DEFAULT '08:00:00'::time without time zone,
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."cleaner_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_availability_v2" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "day_of_week" smallint NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "is_active" boolean DEFAULT true,
    "valid_from" "date",
    "valid_until" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "cleaner_availability_v2_day_of_week_check" CHECK ((("day_of_week" >= 1) AND ("day_of_week" <= 7))),
    CONSTRAINT "valid_time" CHECK (("start_time" < "end_time"))
);


ALTER TABLE "public"."cleaner_availability_v2" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_avoid_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "avoid_type" "text" NOT NULL
);


ALTER TABLE "public"."cleaner_avoid_types" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."cleaner_blocked_dates" AS
 SELECT "id",
    "cleaner_id",
    "blocked_date",
    "all_day",
    "reason",
    "notes"
   FROM "public"."blocked_times";


ALTER VIEW "public"."cleaner_blocked_dates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_booking_prefs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "accepts_recurring" boolean DEFAULT true,
    "accepts_one_time" boolean DEFAULT true
);


ALTER TABLE "public"."cleaner_booking_prefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_customer_relations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "total_jobs" integer DEFAULT 0,
    "total_earned" integer DEFAULT 0,
    "avg_rating" numeric(2,1) DEFAULT 0.0,
    "first_job_at" timestamp with time zone,
    "last_job_at" timestamp with time zone,
    "is_recurring" boolean DEFAULT false
);


ALTER TABLE "public"."cleaner_customer_relations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_languages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "language" "text" NOT NULL
);


ALTER TABLE "public"."cleaner_languages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_pet_prefs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "pet_type" "text" NOT NULL,
    "allowed" boolean DEFAULT false
);


ALTER TABLE "public"."cleaner_pet_prefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_preferred_zones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "zone_name" "text" NOT NULL,
    "priority" integer DEFAULT 0
);


ALTER TABLE "public"."cleaner_preferred_zones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "referred_email" "text" NOT NULL,
    "booking_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reward_amount" integer DEFAULT 200,
    "reward_paid" boolean DEFAULT false,
    "reward_paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "converted_at" timestamp with time zone,
    CONSTRAINT "valid_referral_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'converted'::"text", 'rewarded'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."cleaner_referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_service_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid",
    "service_type" "text" NOT NULL,
    "price_type" "text" DEFAULT 'hourly'::"text",
    "price" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cleaner_service_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "skill" "text" NOT NULL
);


ALTER TABLE "public"."cleaner_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_zones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "max_radius_km" numeric(4,1) DEFAULT 5.0
);


ALTER TABLE "public"."cleaner_zones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid",
    "first_name" "text" NOT NULL,
    "last_name" "text",
    "phone" "text",
    "avatar_url" "text",
    "bio" "text",
    "experience" "text" DEFAULT 'new'::"text",
    "home_address" "text",
    "home_lat" numeric(10,7),
    "home_lng" numeric(10,7),
    "min_pay_per_job" integer DEFAULT 800,
    "min_pay_per_hour" integer DEFAULT 350,
    "elevator_pref" "text" DEFAULT 'prefer'::"text",
    "pet_pref" "text" DEFAULT 'some'::"text",
    "material_pref" "text" DEFAULT 'both'::"text",
    "works_alone" boolean DEFAULT true,
    "works_team" boolean DEFAULT false,
    "prefer_same_clients" boolean DEFAULT true,
    "total_jobs" integer DEFAULT 0,
    "avg_rating" numeric(2,1) DEFAULT 0.0,
    "total_ratings" integer DEFAULT 0,
    "total_earned" integer DEFAULT 0,
    "member_since" timestamp with time zone DEFAULT "now"(),
    "onboarding_completed" boolean DEFAULT false,
    "onboarding_step" integer DEFAULT 0,
    "identity_verified" boolean DEFAULT false,
    "identity_verified_at" timestamp with time zone,
    "phone_verified" boolean DEFAULT false,
    "profile_completeness" integer DEFAULT 0,
    "avg_response_time_min" integer,
    "cancellation_count" integer DEFAULT 0,
    "cancellation_rate" numeric(3,2) DEFAULT 0.00,
    "last_active_at" timestamp with time zone,
    "signup_date" "date" DEFAULT CURRENT_DATE,
    "fcm_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_approved" boolean DEFAULT false,
    "full_name" "text",
    "city" "text" DEFAULT 'Stockholm'::"text",
    "hourly_rate" integer,
    "profile_image" "text",
    "status" "text" DEFAULT 'aktiv'::"text",
    "admin_notes" "text",
    "admin_flag" "text",
    "stripe_account_id" "text",
    "stripe_onboarding_status" "text" DEFAULT 'none'::"text",
    "slug" "text",
    "languages" "text"[] DEFAULT '{}'::"text"[],
    "specialties" "text"[],
    "spark_points" integer DEFAULT 0,
    "spark_level_id" integer,
    "availability_schedule" "jsonb",
    "email" "text",
    "services" "jsonb" DEFAULT '["Hemstädning"]'::"jsonb",
    "service_radius_km" integer DEFAULT 30,
    "commission_rate" numeric DEFAULT 0.17,
    "tier" "text" DEFAULT 'new'::"text",
    "review_count" integer DEFAULT 0,
    "rating" numeric DEFAULT 0,
    "verified" boolean DEFAULT false,
    "completed_jobs" integer DEFAULT 0,
    "company_id" "uuid",
    "is_company_owner" boolean DEFAULT false,
    "profile_image_url" "text",
    "total_reviews" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "fskatt_needs_help" boolean DEFAULT false,
    "has_fskatt" boolean DEFAULT false,
    "added_by_owner_id" "uuid",
    "is_blocked" boolean DEFAULT false,
    "team_onboarding" "jsonb",
    "owner_only" boolean DEFAULT false,
    "business_name" "text",
    "org_number" "text",
    "business_address" "text",
    "vat_registered" boolean DEFAULT false,
    "f_skatt_verified" boolean DEFAULT false,
    "dashboard_permissions" "jsonb",
    "clawback_balance_sek" integer DEFAULT 0,
    "underleverantor_agreement_accepted_at" timestamp with time zone,
    "underleverantor_agreement_version" "text",
    "disputes_count_total" integer DEFAULT 0,
    "disputes_count_lost" integer DEFAULT 0,
    "is_test_account" boolean DEFAULT false NOT NULL,
    "profile_shared_at" timestamp with time zone,
    CONSTRAINT "chk_hourly_rate" CHECK ((("hourly_rate" >= 100) AND ("hourly_rate" <= 1000)))
);


ALTER TABLE "public"."cleaners" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cleaners"."clawback_balance_sek" IS 'Skuld till Spick (dras från nästa utbetalning vid refund)';



COMMENT ON COLUMN "public"."cleaners"."disputes_count_total" IS 'Totala tvister genom tiderna';



COMMENT ON COLUMN "public"."cleaners"."disputes_count_lost" IS 'Förlorade tvister — påverkar trust';



COMMENT ON COLUMN "public"."cleaners"."is_test_account" IS 'Fas 1.6.1: om true, Stripe-anrop för denna cleaner går mot test mode.';



COMMENT ON COLUMN "public"."cleaners"."profile_shared_at" IS 'Sprint 2 Dag 3 (2026-04-25): server-side flag för onboarding-steg "Dela profillänk" i stadare-dashboard.html. Sätts när städaren klickar "Kopiera länk" i dashboard. NULL = ej klickat. Ersätter localStorage-only som förlorades mellan browsers/enheter. UI kollar BÅDE DB + localStorage.';



CREATE TABLE IF NOT EXISTS "public"."commission_levels" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "min_bookings" integer DEFAULT 0 NOT NULL,
    "commission_pct" numeric(5,2) DEFAULT 15.00 NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."commission_levels" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."commission_levels_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."commission_levels_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."commission_levels_id_seq" OWNED BY "public"."commission_levels"."id";



CREATE TABLE IF NOT EXISTS "public"."commission_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "gross_amount" numeric(10,2) NOT NULL,
    "commission_pct" numeric(5,2) NOT NULL,
    "commission_amt" numeric(10,2) NOT NULL,
    "net_amount" numeric(10,2) NOT NULL,
    "level_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."commission_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "org_number" "text",
    "owner_cleaner_id" "uuid",
    "stripe_account_id" "text",
    "stripe_onboarding_status" "text" DEFAULT 'pending'::"text",
    "commission_rate" numeric DEFAULT 0.17,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "instagram_url" "text",
    "facebook_url" "text",
    "website_url" "text",
    "description" "text",
    "slug" "text",
    "allow_customer_choice" boolean DEFAULT true,
    "display_name" "text",
    "show_individual_ratings" boolean DEFAULT true,
    "use_company_pricing" boolean DEFAULT false,
    "dashboard_config" "jsonb",
    "employment_model" "text" DEFAULT 'employed'::"text",
    "payment_trust_level" "text" DEFAULT 'new'::"text",
    "total_post_service_bookings" integer DEFAULT 0,
    "total_overdue_count" integer DEFAULT 0,
    "last_overdue_at" timestamp with time zone,
    "underleverantor_agreement_accepted_at" timestamp with time zone,
    "underleverantor_agreement_version" "text",
    "dpa_accepted_at" timestamp with time zone,
    "insurance_verified" boolean DEFAULT false,
    "insurance_expires_at" "date",
    "self_signup" boolean DEFAULT false,
    "onboarding_status" "text" DEFAULT 'pending_stripe'::"text",
    "logo_url" "text",
    "onboarding_completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "companies_employment_model_check" CHECK (("employment_model" = ANY (ARRAY['employed'::"text", 'contractor'::"text"])))
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


COMMENT ON COLUMN "public"."companies"."employment_model" IS 'employed = anställda (utbetalning till företag), contractor = underleverantörer (utbetalning per person)';



COMMENT ON COLUMN "public"."companies"."payment_trust_level" IS 'new (första 10 bokningar) | established (bra historik) | risk (2+ overdue)';



COMMENT ON COLUMN "public"."companies"."total_post_service_bookings" IS 'Totalt antal bokningar med payment_mode=post_service_manual';



COMMENT ON COLUMN "public"."companies"."total_overdue_count" IS 'Totalt antal overdue-bokningar genom tiderna';



COMMENT ON COLUMN "public"."companies"."underleverantor_agreement_accepted_at" IS 'När VD godkände underleverantörsavtalet';



COMMENT ON COLUMN "public"."companies"."dpa_accepted_at" IS 'GDPR biträdesavtal godkänt';



COMMENT ON COLUMN "public"."companies"."insurance_verified" IS 'Ansvarsförsäkring verifierad av Spick';



COMMENT ON COLUMN "public"."companies"."insurance_expires_at" IS 'Försäkringens utgångsdatum — övervaka';



COMMENT ON COLUMN "public"."companies"."self_signup" IS 'TRUE om företag registrerat sig själv via bli-foretag.html (vs admin-skapad)';



COMMENT ON COLUMN "public"."companies"."onboarding_status" IS 'Tillstånd: pending_stripe | pending_team | active | suspended | legacy';



COMMENT ON COLUMN "public"."companies"."logo_url" IS 'URL till företagslogga (uppladdad till Supabase Storage)';



COMMENT ON COLUMN "public"."companies"."onboarding_completed_at" IS 'Tidsstämpel när företag nått status=active första gången';



CREATE TABLE IF NOT EXISTS "public"."company_service_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "service_type" "text" NOT NULL,
    "price" numeric NOT NULL,
    "price_type" "text" DEFAULT 'hourly'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "company_service_prices_price_type_check" CHECK (("price_type" = ANY (ARRAY['hourly'::"text", 'per_sqm'::"text"])))
);


ALTER TABLE "public"."company_service_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coupon_usages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coupon_id" "uuid" NOT NULL,
    "customer_email" "text" NOT NULL,
    "booking_id" "uuid",
    "discount_applied" numeric(10,2) NOT NULL,
    "used_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."coupon_usages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coupons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "discount_type" "text" NOT NULL,
    "discount_value" numeric NOT NULL,
    "max_uses" integer,
    "used_count" integer DEFAULT 0,
    "expires_at" timestamp with time zone,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "description" "text",
    "currency" "text" DEFAULT 'SEK'::"text",
    "min_order_value" numeric(10,2) DEFAULT 0,
    "max_uses_per_user" integer DEFAULT 1,
    "applies_to" "text" DEFAULT 'all'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "coupons_discount_type_check" CHECK (("discount_type" = ANY (ARRAY['percent'::"text", 'fixed'::"text"]))),
    CONSTRAINT "valid_applies_to" CHECK (("applies_to" = ANY (ARRAY['all'::"text", 'first_booking'::"text", 'recurring'::"text", 'specific_service'::"text"]))),
    CONSTRAINT "valid_discount_type" CHECK (("discount_type" = ANY (ARRAY['percent'::"text", 'fixed'::"text"])))
);


ALTER TABLE "public"."coupons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_credits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_email" "text" NOT NULL,
    "original_sek" numeric DEFAULT 0 NOT NULL,
    "remaining_sek" numeric DEFAULT 0 NOT NULL,
    "reason" "text",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '1 year'::interval),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_email" "text" NOT NULL,
    "favorite_cleaner_id" "uuid",
    "blocked_cleaner_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "default_has_pets" boolean,
    "pet_type" "text",
    "has_children_at_home" boolean,
    "has_stairs" boolean,
    "prefers_eco_products" boolean DEFAULT false,
    "default_notes_to_cleaner" "text",
    "budget_range_min_sek" integer,
    "budget_range_max_sek" integer,
    "language_preference" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "address" "text",
    "city" "text" DEFAULT 'Stockholm'::"text",
    "pnr_hash" "text",
    "total_bookings" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "portal_customer_id" "uuid",
    "auto_delegation_enabled" boolean DEFAULT false,
    "stripe_customer_id" "text",
    "default_payment_method_id" "text",
    "payment_method_last4" "text",
    "payment_method_brand" "text",
    "payment_method_exp_month" integer,
    "payment_method_exp_year" integer,
    "recurring_nudge_sent_at" timestamp with time zone
);


ALTER TABLE "public"."customer_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."customer_profiles"."auto_delegation_enabled" IS 'Kundens default för nya bokningar. Om TRUE kryssas rutan i förväg på boka.html.';



COMMENT ON COLUMN "public"."customer_profiles"."stripe_customer_id" IS 'Stripe Customer ID — skapas vid subscription setup';



COMMENT ON COLUMN "public"."customer_profiles"."default_payment_method_id" IS 'Stripe PaymentMethod ID för off-session charges';



COMMENT ON COLUMN "public"."customer_profiles"."payment_method_last4" IS 'Sista 4 siffror på kortet (för UI: •••• 4242)';



CREATE TABLE IF NOT EXISTS "public"."discount_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "discount_id" "uuid" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "customer_email" "text" NOT NULL,
    "percent_applied" numeric DEFAULT 0,
    "amount_saved_sek" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."discount_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "percent_off" numeric DEFAULT 0,
    "fixed_off_sek" numeric DEFAULT 0,
    "min_hours" numeric DEFAULT 0,
    "max_uses" integer DEFAULT 100,
    "current_uses" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "valid_from" timestamp with time zone DEFAULT "now"(),
    "valid_until" timestamp with time zone DEFAULT ("now"() + '1 year'::interval),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."discounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dispute_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dispute_id" "uuid" NOT NULL,
    "uploaded_by" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_size_bytes" integer,
    "mime_type" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dispute_evidence_mime_check" CHECK ((("mime_type" IS NULL) OR ("mime_type" = ANY (ARRAY['image/jpeg'::"text", 'image/png'::"text", 'image/heic'::"text", 'application/pdf'::"text"])))),
    CONSTRAINT "dispute_evidence_size_check" CHECK ((("file_size_bytes" IS NULL) OR ("file_size_bytes" <= 5242880))),
    CONSTRAINT "dispute_evidence_uploaded_by_check" CHECK (("uploaded_by" = ANY (ARRAY['customer'::"text", 'cleaner'::"text"])))
);


ALTER TABLE "public"."dispute_evidence" OWNER TO "postgres";


COMMENT ON TABLE "public"."dispute_evidence" IS 'Fas 8 §8.4.3: Foto-bevis per dispute (kund + städare). Max 5 MB, 5 foton/part/dispute.';



CREATE TABLE IF NOT EXISTS "public"."disputes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "opened_by" "uuid",
    "reason" "text" NOT NULL,
    "customer_description" "text",
    "cleaner_response" "text",
    "admin_notes" "text",
    "admin_decision" "text",
    "refund_amount_sek" integer,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cleaner_responded_at" timestamp with time zone,
    "admin_decided_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "disputes_admin_decision_check" CHECK ((("admin_decision" IS NULL) OR ("admin_decision" = ANY (ARRAY['full_refund'::"text", 'partial_refund'::"text", 'dismissed'::"text"])))),
    CONSTRAINT "disputes_refund_amount_check" CHECK ((("refund_amount_sek" IS NULL) OR ("refund_amount_sek" >= 0)))
);


ALTER TABLE "public"."disputes" OWNER TO "postgres";


COMMENT ON TABLE "public"."disputes" IS 'Fas 8 §8.4.2: Formell dispute-record per bokning. EU PWD audit-trail.';



CREATE TABLE IF NOT EXISTS "public"."earnings_summary" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "period_type" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "total_earned" integer DEFAULT 0,
    "total_jobs" integer DEFAULT 0,
    "total_hours" numeric(5,1) DEFAULT 0.0,
    "avg_per_hour" integer DEFAULT 0,
    "avg_rating" numeric(2,1) DEFAULT 0.0,
    "hem_jobs" integer DEFAULT 0,
    "hem_earned" integer DEFAULT 0,
    "flytt_jobs" integer DEFAULT 0,
    "flytt_earned" integer DEFAULT 0,
    "stor_jobs" integer DEFAULT 0,
    "stor_earned" integer DEFAULT 0,
    "kontor_jobs" integer DEFAULT 0,
    "kontor_earned" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."earnings_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "from_email" "text",
    "from_name" "text",
    "to_email" "text",
    "subject" "text",
    "body_text" "text",
    "body_html" "text",
    "category" "text" DEFAULT 'incoming'::"text",
    "status" "text" DEFAULT 'new'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "auto_reply_sent" boolean DEFAULT false,
    "received_at" timestamp with time zone DEFAULT "now"(),
    "handled_at" timestamp with time zone,
    "handled_by" "text",
    "notes" "text"
);


ALTER TABLE "public"."emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."escrow_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "from_state" "text",
    "to_state" "text" NOT NULL,
    "triggered_by" "text" NOT NULL,
    "triggered_by_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "escrow_events_triggered_by_check" CHECK (("triggered_by" = ANY (ARRAY['customer'::"text", 'cleaner'::"text", 'admin'::"text", 'system_timer'::"text", 'system_webhook'::"text"])))
);


ALTER TABLE "public"."escrow_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."escrow_events" IS 'Fas 8 §8.4: Audit-trail för bookings.escrow_state-transitioner. EU PWD-krav.';



CREATE TABLE IF NOT EXISTS "public"."guarantee_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "booking_id" "uuid",
    "rating_id" "uuid",
    "customer_name" "text",
    "customer_email" "text",
    "cleaner_name" "text",
    "issue_description" "text",
    "status" "text" DEFAULT 'ny'::"text",
    "resolved_at" timestamp with time zone,
    "resolution" "text",
    "admin_notes" "text"
);


ALTER TABLE "public"."guarantee_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_points" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_email" "text" NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "tier" "text" DEFAULT 'new'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "total_earned" integer DEFAULT 0,
    CONSTRAINT "loyalty_points_tier_check" CHECK (("tier" = ANY (ARRAY['new'::"text", 'star'::"text", 'gold'::"text", 'vip'::"text"])))
);


ALTER TABLE "public"."loyalty_points" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."magic_link_shortcodes" (
    "code" "text" NOT NULL,
    "full_redirect_url" "text" NOT NULL,
    "email" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "resource_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "ip_address" "text",
    "user_agent" "text",
    "single_use" boolean DEFAULT true NOT NULL,
    CONSTRAINT "magic_link_shortcodes_scope_check" CHECK (("scope" = ANY (ARRAY['booking'::"text", 'subscription'::"text", 'dashboard'::"text", 'team_job'::"text", 'team_onboarding'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."magic_link_shortcodes" OWNER TO "postgres";


COMMENT ON TABLE "public"."magic_link_shortcodes" IS 'Short-URL codes for SMS magic-links. Built for Fas 1.2 Unified Identity Architecture.';



CREATE TABLE IF NOT EXISTS "public"."matching_shadow_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid",
    "v1_ranking" "jsonb" NOT NULL,
    "v2_ranking" "jsonb" NOT NULL,
    "top5_overlap" integer,
    "spearman_rho" numeric(4,3),
    "chosen_cleaner_id" "uuid",
    "chosen_v1_rank" integer,
    "chosen_v2_rank" integer,
    "customer_lat" double precision,
    "customer_lng" double precision,
    "booking_date" "date",
    "booking_time" time without time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "providers_ranking" "jsonb"
);


ALTER TABLE "public"."matching_shadow_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."matching_shadow_log" IS 'Sprint 2 Dag 1 (2026-04-24) — audit-trail för v1/v2-matching-diff. Populeras av booking-create EF när platform_settings.matching_algorithm_version=''shadow''. Använd för §3.9 pilot-analys: top-5-overlap, rank-correlation, chosen-cleaner-placering.';



COMMENT ON COLUMN "public"."matching_shadow_log"."providers_ranking" IS 'Sprint Model-3 (2026-04-26): ranking-output från find_nearby_providers (Model-2a). Array av {provider_type, provider_id, rank, representative_cleaner_id, team_size}. NULL när shadow-mode inte är providers-shadow.';



CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "from_email" "text",
    "to_email" "text",
    "from_role" "text" DEFAULT 'cleaner'::"text",
    "from_alias" "text",
    "message" "text" NOT NULL,
    "message_type" "text" DEFAULT 'text'::"text",
    "is_automated" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'system'::"text",
    "title" "text" NOT NULL,
    "body" "text",
    "job_id" "uuid",
    "read" boolean DEFAULT false,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "stripe_transfer_id" "text",
    "status" "text" NOT NULL,
    "stripe_idempotency_key" "text" NOT NULL,
    "error_message" "text",
    "amount_sek" integer NOT NULL,
    "destination_account_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "payout_attempts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'failed'::"text", 'reversed'::"text"])))
);


ALTER TABLE "public"."payout_attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."payout_attempts" IS 'Fas 1.6: en rad per triggerStripeTransfer-försök. stripe_idempotency_key UNIQUE.';



COMMENT ON COLUMN "public"."payout_attempts"."attempt_count" IS 'Ökar vid retry-försök för samma booking.';



COMMENT ON COLUMN "public"."payout_attempts"."stripe_idempotency_key" IS 'Format: payout-${booking_id}-${attempt_count}. Stripe dedupar via Idempotency-Key-header.';



CREATE TABLE IF NOT EXISTS "public"."payout_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid",
    "action" "text" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "amount_sek" integer,
    "stripe_transfer_id" "text",
    "diff_kr" integer,
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payout_audit_log_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'alert'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."payout_audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."payout_audit_log" IS 'Fas 1.6: audit-trail for alla payout-relaterade events.';



COMMENT ON COLUMN "public"."payout_audit_log"."action" IS 'transfer_created | transfer_reversed | transfer_failed | reconcile_mismatch | payout_marked_paid';



COMMENT ON COLUMN "public"."payout_audit_log"."diff_kr" IS 'Anvands av F1.8 reconciliation for Stripe-DB-belopp-diff.';



CREATE OR REPLACE VIEW "public"."payout_metrics_hourly" AS
 SELECT "date_trunc"('hour'::"text", "created_at") AS "hour",
    "count"(*) FILTER (WHERE ("action" = 'transfer_completed'::"text")) AS "transfers_completed",
    "count"(*) FILTER (WHERE ("action" = 'transfer_failed'::"text")) AS "transfers_failed",
    "count"(*) FILTER (WHERE ("action" = 'transfer_reversed'::"text")) AS "transfers_reversed",
    "count"(*) FILTER (WHERE ("action" = 'payout_confirmed'::"text")) AS "payouts_confirmed",
    "count"(*) FILTER (WHERE ("action" = 'reconciliation_completed'::"text")) AS "reconciliation_runs",
    "count"(*) FILTER (WHERE (("action" = 'reconciliation_mismatch'::"text") AND ("severity" = 'alert'::"text"))) AS "mismatches_alert",
    "count"(*) FILTER (WHERE (("action" = 'reconciliation_mismatch'::"text") AND ("severity" = 'critical'::"text"))) AS "mismatches_critical",
    "count"(*) FILTER (WHERE ("action" = 'reconciliation_error'::"text")) AS "reconciliation_errors",
    "count"(*) FILTER (WHERE ("action" = 'auto_rollback_triggered'::"text")) AS "auto_rollbacks",
    "count"(*) FILTER (WHERE ("action" = 'auto_activation_triggered'::"text")) AS "auto_activations",
    "count"(*) FILTER (WHERE ("action" = 'manual_rollback'::"text")) AS "manual_rollbacks",
    COALESCE("sum"("amount_sek") FILTER (WHERE ("action" = 'transfer_completed'::"text")), (0)::bigint) AS "total_sek_transferred",
    COALESCE("sum"("amount_sek") FILTER (WHERE ("action" = 'payout_confirmed'::"text")), (0)::bigint) AS "total_sek_confirmed"
   FROM "public"."payout_audit_log"
  WHERE ("created_at" > ("now"() - '30 days'::interval))
  GROUP BY ("date_trunc"('hour'::"text", "created_at"))
  ORDER BY ("date_trunc"('hour'::"text", "created_at")) DESC;


ALTER VIEW "public"."payout_metrics_hourly" OWNER TO "postgres";


COMMENT ON VIEW "public"."payout_metrics_hourly" IS 'Fas 1.9: Timvis payout-metrics for admin-dashboard + monitoring';



CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."platform_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."processed_webhook_events" (
    "event_id" "text" NOT NULL,
    "event_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."processed_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limits" (
    "key" "text" NOT NULL,
    "window_start" timestamp with time zone DEFAULT "now"() NOT NULL,
    "count" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "customer_id" "uuid" DEFAULT "auth"."uid"(),
    "rating" integer NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "quality_rating" integer,
    "punctuality_rating" integer,
    "friendliness_rating" integer,
    "service_type" "text",
    CONSTRAINT "ratings_friendliness_rating_check" CHECK ((("friendliness_rating" >= 1) AND ("friendliness_rating" <= 5))),
    CONSTRAINT "ratings_punctuality_rating_check" CHECK ((("punctuality_rating" >= 1) AND ("punctuality_rating" <= 5))),
    CONSTRAINT "ratings_quality_rating_check" CHECK ((("quality_rating" >= 1) AND ("quality_rating" <= 5))),
    CONSTRAINT "ratings_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5))),
    CONSTRAINT "ratings_rating_range" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."ratings" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."receipt_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."receipt_number_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_email" "text" NOT NULL,
    "referred_email" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "referrals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'rewarded'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."reviews" AS
 SELECT "id",
    "cleaner_id",
    "customer_id",
    "job_id",
    "rating" AS "cleaner_rating",
    "comment",
    "created_at",
    "service_type"
   FROM "public"."ratings" "r";


ALTER VIEW "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."self_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_number" "text" NOT NULL,
    "cleaner_id" "uuid",
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "total_gross" numeric NOT NULL,
    "total_commission" numeric NOT NULL,
    "total_net" numeric NOT NULL,
    "vat_amount" numeric DEFAULT 0,
    "total_with_vat" numeric NOT NULL,
    "status" "text" DEFAULT 'draft'::"text",
    "pdf_url" "text",
    "booking_ids" "uuid"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "accepted_at" timestamp with time zone,
    "disputed_at" timestamp with time zone,
    "dispute_reason" "text",
    "seller_name" "text",
    "seller_org_number" "text",
    "seller_address" "text",
    "seller_f_skatt" boolean DEFAULT true,
    "seller_vat_registered" boolean DEFAULT false,
    "buyer_name" "text" DEFAULT 'Haghighi Consulting AB'::"text",
    "buyer_org_number" "text" DEFAULT '559402-4522'::"text",
    "line_items" "jsonb" DEFAULT '[]'::"jsonb",
    "company_id" "uuid",
    "currency" "text" DEFAULT 'SEK'::"text",
    "created_by" "uuid",
    "sent_at" timestamp with time zone,
    "notes" "text",
    "buyer_address" "text" DEFAULT 'Solna, Sverige'::"text",
    "html_url" "text"
);


ALTER TABLE "public"."self_invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_addons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "label_sv" "text" NOT NULL,
    "label_en" "text",
    "price_sek" integer NOT NULL,
    "display_order" integer DEFAULT 100 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_addons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_checklists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_type" "text" NOT NULL,
    "company_id" "uuid",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."service_checklists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "label_sv" "text" NOT NULL,
    "label_en" "text",
    "description_sv" "text",
    "rut_eligible" boolean DEFAULT false NOT NULL,
    "is_b2b" boolean DEFAULT false NOT NULL,
    "is_b2c" boolean DEFAULT true NOT NULL,
    "hour_multiplier" numeric(3,2) DEFAULT 1.00 NOT NULL,
    "default_hourly_price" integer,
    "display_order" integer DEFAULT 100 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "icon_key" "text",
    "ui_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."spark_levels" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "min_points" integer DEFAULT 0 NOT NULL,
    "max_points" integer,
    "badge_emoji" "text" DEFAULT '⚡'::"text",
    "perks" "jsonb" DEFAULT '[]'::"jsonb",
    "commission_pct" numeric(5,2) DEFAULT 15.00 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."spark_levels" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."spark_levels_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."spark_levels_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."spark_levels_id_seq" OWNED BY "public"."spark_levels"."id";



CREATE TABLE IF NOT EXISTS "public"."subscription_slot_holds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscription_id" "uuid" NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "weekday" smallint NOT NULL,
    "start_time" time without time zone NOT NULL,
    "duration_hours" numeric NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "paused_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscription_slot_holds_duration_hours_check" CHECK ((("duration_hours" > (0)::numeric) AND ("duration_hours" <= (24)::numeric))),
    CONSTRAINT "subscription_slot_holds_weekday_check" CHECK ((("weekday" >= 1) AND ("weekday" <= 7)))
);


ALTER TABLE "public"."subscription_slot_holds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_name" "text",
    "customer_email" "text" NOT NULL,
    "customer_phone" "text",
    "customer_address" "text",
    "service_type" "text" DEFAULT 'Hemstädning'::"text",
    "frequency" "text" NOT NULL,
    "preferred_day" integer,
    "preferred_time" time without time zone,
    "booking_hours" numeric DEFAULT 3,
    "square_meters" integer,
    "cleaner_id" "uuid",
    "cleaner_name" "text",
    "hourly_rate" integer,
    "discount_percent" integer DEFAULT 0,
    "status" "text" DEFAULT 'active'::"text",
    "next_booking_date" "date",
    "total_bookings_created" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "pause_reason" "text",
    "paused_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancel_reason" "text",
    "total_bookings" integer DEFAULT 0,
    "last_booking_id" "uuid",
    "address" "text",
    "city" "text",
    "rut" boolean DEFAULT true,
    "key_info" "text",
    "key_type" "text",
    "customer_notes" "text",
    "customer_type" "text" DEFAULT 'privat'::"text",
    "customer_pnr_hash" "text",
    "business_name" "text",
    "business_org_number" "text",
    "business_reference" "text",
    "auto_delegation_enabled" boolean,
    "payment_mode" "text" DEFAULT 'stripe_checkout'::"text",
    "company_id" "uuid",
    "manual_override_price" integer,
    "stripe_setup_intent_id" "text",
    "setup_completed_at" timestamp with time zone,
    "last_charge_attempt_at" timestamp with time zone,
    "last_charge_success_at" timestamp with time zone,
    "consecutive_failures" integer DEFAULT 0,
    "preferred_days" "text"[],
    "frequency_config" "jsonb" DEFAULT '{}'::"jsonb",
    "duration_mode" "text" DEFAULT 'open_ended'::"text",
    "max_occurrences" integer,
    "end_date" "date",
    "cleaner_flex" "text" DEFAULT 'any'::"text",
    "holiday_mode" "text" DEFAULT 'auto_skip'::"text",
    CONSTRAINT "subs_cleaner_flex_check" CHECK (("cleaner_flex" = ANY (ARRAY['specific_cleaner'::"text", 'specific_company'::"text", 'any'::"text"]))),
    CONSTRAINT "subs_duration_mode_check" CHECK (("duration_mode" = ANY (ARRAY['open_ended'::"text", 'fixed_count'::"text", 'end_date'::"text"]))),
    CONSTRAINT "subs_holiday_mode_check" CHECK (("holiday_mode" = ANY (ARRAY['auto_skip'::"text", 'auto_shift'::"text", 'manual'::"text"]))),
    CONSTRAINT "subscriptions_frequency_check" CHECK (("frequency" = ANY (ARRAY['weekly'::"text", 'biweekly'::"text", 'monthly'::"text"]))),
    CONSTRAINT "subscriptions_preferred_day_check" CHECK ((("preferred_day" >= 0) AND ("preferred_day" <= 6))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."subscriptions"."payment_mode" IS 'Default payment_mode för alla genererade bokningar i denna sub';



COMMENT ON COLUMN "public"."subscriptions"."company_id" IS 'Vilket företag äger denna subscription (för CRUD + UI-filtrering)';



COMMENT ON COLUMN "public"."subscriptions"."manual_override_price" IS 'Om satt: Alla genererade bokningar får detta total-pris';



COMMENT ON COLUMN "public"."subscriptions"."stripe_setup_intent_id" IS 'SetupIntent ID — kund sparar kort';



COMMENT ON COLUMN "public"."subscriptions"."setup_completed_at" IS 'Tidpunkt då kund slutfört kortsparande';



COMMENT ON COLUMN "public"."subscriptions"."consecutive_failures" IS 'Räknare — vid 3+ pausas subscription automatiskt';



CREATE TABLE IF NOT EXISTS "public"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" DEFAULT 'question'::"text",
    "subject" "text",
    "message" "text",
    "customer_email" "text",
    "customer_name" "text",
    "booking_id" "uuid",
    "cleaner_id" "uuid",
    "status" "text" DEFAULT 'open'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "resolved_by" "text",
    "notes" "text"
);


ALTER TABLE "public"."support_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."swedish_holidays" (
    "holiday_date" "date" NOT NULL,
    "name" "text" NOT NULL,
    "is_red_day" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."swedish_holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "assigned_to" "uuid",
    "created_by" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "deadline" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "related_booking_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'done'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_booking_slots" WITH ("security_invoker"='on') AS
 SELECT "booking_date",
    "booking_time",
    "booking_hours",
    "status"
   FROM "public"."bookings"
  WHERE ("status" = ANY (ARRAY['confirmed'::"text", 'pending'::"text", 'paid'::"text"]));


ALTER VIEW "public"."v_booking_slots" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_calendar_slots" AS
 SELECT "cleaner_id",
    "start_at",
    "end_at",
    "event_type",
    "booking_id",
    "title",
    "is_all_day",
    "source"
   FROM "public"."calendar_events" "ce"
  WHERE (("start_at" >= ("now"() - '1 day'::interval)) AND ("start_at" <= ("now"() + '60 days'::interval)));


ALTER VIEW "public"."v_calendar_slots" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_cleaner_availability_expanded" AS
 SELECT "cleaner_availability"."cleaner_id",
    'monday'::"text" AS "day_of_week",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time",
    "cleaner_availability"."is_active"
   FROM "public"."cleaner_availability"
  WHERE ("cleaner_availability"."day_mon" = true)
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    'tuesday'::"text" AS "day_of_week",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time",
    "cleaner_availability"."is_active"
   FROM "public"."cleaner_availability"
  WHERE ("cleaner_availability"."day_tue" = true)
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    'wednesday'::"text" AS "day_of_week",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time",
    "cleaner_availability"."is_active"
   FROM "public"."cleaner_availability"
  WHERE ("cleaner_availability"."day_wed" = true)
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    'thursday'::"text" AS "day_of_week",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time",
    "cleaner_availability"."is_active"
   FROM "public"."cleaner_availability"
  WHERE ("cleaner_availability"."day_thu" = true)
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    'friday'::"text" AS "day_of_week",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time",
    "cleaner_availability"."is_active"
   FROM "public"."cleaner_availability"
  WHERE ("cleaner_availability"."day_fri" = true)
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    'saturday'::"text" AS "day_of_week",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time",
    "cleaner_availability"."is_active"
   FROM "public"."cleaner_availability"
  WHERE ("cleaner_availability"."day_sat" = true)
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    'sunday'::"text" AS "day_of_week",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time",
    "cleaner_availability"."is_active"
   FROM "public"."cleaner_availability"
  WHERE ("cleaner_availability"."day_sun" = true);


ALTER VIEW "public"."v_cleaner_availability_expanded" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_cleaner_availability_int" AS
 SELECT "cleaner_availability"."cleaner_id",
    1 AS "day_of_week",
    "cleaner_availability"."day_mon" AS "is_active",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time"
   FROM "public"."cleaner_availability"
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    2 AS "day_of_week",
    "cleaner_availability"."day_tue" AS "is_active",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time"
   FROM "public"."cleaner_availability"
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    3 AS "day_of_week",
    "cleaner_availability"."day_wed" AS "is_active",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time"
   FROM "public"."cleaner_availability"
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    4 AS "day_of_week",
    "cleaner_availability"."day_thu" AS "is_active",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time"
   FROM "public"."cleaner_availability"
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    5 AS "day_of_week",
    "cleaner_availability"."day_fri" AS "is_active",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time"
   FROM "public"."cleaner_availability"
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    6 AS "day_of_week",
    "cleaner_availability"."day_sat" AS "is_active",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time"
   FROM "public"."cleaner_availability"
UNION ALL
 SELECT "cleaner_availability"."cleaner_id",
    7 AS "day_of_week",
    "cleaner_availability"."day_sun" AS "is_active",
    "cleaner_availability"."start_time",
    "cleaner_availability"."end_time"
   FROM "public"."cleaner_availability";


ALTER VIEW "public"."v_cleaner_availability_int" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_cleaners_for_booking" AS
 SELECT "c"."id",
    "c"."full_name",
    "c"."avg_rating",
    "c"."review_count",
    "c"."services",
    "c"."city",
    "c"."hourly_rate",
    "c"."bio",
    "c"."avatar_url",
    "c"."identity_verified",
    "c"."home_lat",
    "c"."home_lng",
    "c"."pet_pref",
    "c"."elevator_pref",
    "c"."company_id",
    "c"."is_company_owner",
    "c"."completed_jobs",
    "c"."has_fskatt",
    "c"."owner_only",
    "co"."name" AS "company_name",
    "co"."display_name" AS "company_display_name"
   FROM ("public"."cleaners" "c"
     LEFT JOIN "public"."companies" "co" ON (("c"."company_id" = "co"."id")))
  WHERE (("c"."is_approved" = true) AND ("c"."is_active" = true));


ALTER VIEW "public"."v_cleaners_for_booking" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_cleaners_public" AS
 SELECT "id",
    "slug",
    "full_name",
    "first_name",
    "city",
    "bio",
    "avatar_url",
    "hourly_rate",
    "avg_rating",
    "review_count",
    "total_ratings",
    "completed_jobs",
    "services",
    "languages",
    "identity_verified",
    "member_since",
    "service_radius_km",
    "pet_pref",
    "elevator_pref",
    "is_approved",
    "status",
    "owner_only",
    "is_company_owner",
    "company_id",
    "stripe_onboarding_status",
    "has_fskatt"
   FROM "public"."cleaners"
  WHERE ("is_approved" = true);


ALTER VIEW "public"."v_cleaners_public" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_customer_bookings" AS
 SELECT "id",
    "booking_id",
    "customer_name",
    "customer_email",
    "customer_phone",
    "service_type",
    "booking_date",
    "booking_time",
    "booking_hours",
    "total_price",
    "status",
    "payment_status",
    "customer_address",
    "square_meters",
    "cleaner_id",
    "cleaner_name",
    "key_type",
    "key_info",
    "frequency",
    "rut_amount",
    "notes",
    "created_at",
    "updated_at",
    "customer_type",
    "business_name",
    "business_org_number",
    "business_reference",
    "admin_notes",
    "reassignment_proposed_cleaner_id",
    "reassignment_proposed_at",
    "reassignment_proposed_by",
    "reassignment_attempts",
    "auto_delegation_enabled",
    "rejected_at",
    "rejection_reason",
    "reminders_sent",
    "escrow_state"
   FROM "public"."bookings";


ALTER VIEW "public"."v_customer_bookings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_shadow_mode_histogram" AS
 WITH "overlap_buckets" AS (
         SELECT ("matching_shadow_log"."top5_overlap")::"text" AS "bucket",
            'top5_overlap'::"text" AS "metric",
            "count"(*) AS "frequency"
           FROM "public"."matching_shadow_log"
          GROUP BY "matching_shadow_log"."top5_overlap"
        ), "rho_buckets" AS (
         SELECT
                CASE
                    WHEN ("matching_shadow_log"."spearman_rho" <= '-0.75'::numeric) THEN 'rho_-1.00_to_-0.75'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= '-0.50'::numeric) THEN 'rho_-0.75_to_-0.50'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= '-0.25'::numeric) THEN 'rho_-0.50_to_-0.25'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" < 0.00) THEN 'rho_-0.25_to_0.00'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= 0.25) THEN 'rho_0.00_to_0.25'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= 0.50) THEN 'rho_0.25_to_0.50'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= 0.75) THEN 'rho_0.50_to_0.75'::"text"
                    ELSE 'rho_0.75_to_1.00'::"text"
                END AS "bucket",
            'spearman_rho'::"text" AS "metric",
            "count"(*) AS "frequency"
           FROM "public"."matching_shadow_log"
          WHERE ("matching_shadow_log"."spearman_rho" IS NOT NULL)
          GROUP BY
                CASE
                    WHEN ("matching_shadow_log"."spearman_rho" <= '-0.75'::numeric) THEN 'rho_-1.00_to_-0.75'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= '-0.50'::numeric) THEN 'rho_-0.75_to_-0.50'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= '-0.25'::numeric) THEN 'rho_-0.50_to_-0.25'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" < 0.00) THEN 'rho_-0.25_to_0.00'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= 0.25) THEN 'rho_0.00_to_0.25'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= 0.50) THEN 'rho_0.25_to_0.50'::"text"
                    WHEN ("matching_shadow_log"."spearman_rho" <= 0.75) THEN 'rho_0.50_to_0.75'::"text"
                    ELSE 'rho_0.75_to_1.00'::"text"
                END
        )
 SELECT "overlap_buckets"."metric",
    "overlap_buckets"."bucket",
    "overlap_buckets"."frequency"
   FROM "overlap_buckets"
UNION ALL
 SELECT "rho_buckets"."metric",
    "rho_buckets"."bucket",
    "rho_buckets"."frequency"
   FROM "rho_buckets"
  ORDER BY 1, 2;


ALTER VIEW "public"."v_shadow_mode_histogram" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_shadow_mode_histogram" IS 'Sprint 2 Dag 3a (§3.9 kategori A): histogram av top5_overlap [0..5] och spearman_rho i 8 buckets från -1 till 1. Används för att se om v1/v2-diff har bred fördelning (algoritmerna skiljer sig meningsfullt) eller smal (v2 är praktiskt lika v1).';



CREATE OR REPLACE VIEW "public"."v_shadow_mode_recent" AS
 SELECT "id",
    "created_at",
    "top5_overlap",
    "spearman_rho",
    "jsonb_array_length"("v1_ranking") AS "v1_count",
    "jsonb_array_length"("v2_ranking") AS "v2_count",
    "customer_lat",
    "customer_lng",
    "booking_date",
    "booking_time",
    "booking_id",
    "chosen_cleaner_id"
   FROM "public"."matching_shadow_log"
  WHERE ("created_at" >= ("now"() - '48:00:00'::interval))
  ORDER BY "created_at" DESC;


ALTER VIEW "public"."v_shadow_mode_recent" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_shadow_mode_recent" IS 'Sprint 2 Dag 3a (§3.9 kategori A): senaste 48h shadow-sökningar. Används för debug + smoke-test. booking_id och chosen_cleaner_id blir ifyllda när §3.9b (booking-shadow-korrelation) är deployad.';



CREATE OR REPLACE VIEW "public"."v_shadow_mode_stats" AS
 SELECT ("date_trunc"('day'::"text", "created_at"))::"date" AS "day",
    "count"(*) AS "searches",
    "round"("avg"("top5_overlap"), 2) AS "mean_top5_overlap",
    "round"("stddev"("top5_overlap"), 2) AS "stddev_top5_overlap",
    "round"("avg"("spearman_rho"), 3) AS "mean_spearman_rho",
    "round"("stddev"("spearman_rho"), 3) AS "stddev_spearman_rho",
    "min"("spearman_rho") AS "min_spearman_rho",
    "max"("spearman_rho") AS "max_spearman_rho",
    "round"("avg"("jsonb_array_length"("v1_ranking")), 1) AS "mean_v1_count",
    "round"("avg"("jsonb_array_length"("v2_ranking")), 1) AS "mean_v2_count"
   FROM "public"."matching_shadow_log"
  GROUP BY (("date_trunc"('day'::"text", "created_at"))::"date")
  ORDER BY (("date_trunc"('day'::"text", "created_at"))::"date") DESC;


ALTER VIEW "public"."v_shadow_mode_stats" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_shadow_mode_stats" IS 'Sprint 2 Dag 3a (§3.9 kategori A): daglig shadow-mode-agg. searches=antal sökningar; mean_top5_overlap=genomsnittlig top-5-överlapp v1 vs v2 [0..5]; mean_spearman_rho=genomsnittlig rank-korrelation [-1..1]. Stor stddev = algoritm-instabilitet. Ingen booking-koppling.';



CREATE TABLE IF NOT EXISTS "public"."waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city" "text" NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."waitlist" OWNER TO "postgres";


ALTER TABLE ONLY "public"."commission_levels" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."commission_levels_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."spark_levels" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."spark_levels_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_permissions"
    ADD CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_permissions"
    ADD CONSTRAINT "admin_permissions_resource_action_key" UNIQUE ("resource", "action");



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attested_jobs"
    ADD CONSTRAINT "attested_jobs_pkey" PRIMARY KEY ("booking_id");



ALTER TABLE ONLY "public"."auth_audit_log"
    ADD CONSTRAINT "auth_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blocked_times"
    ADD CONSTRAINT "blocked_times_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_adjustments"
    ADD CONSTRAINT "booking_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_checklists"
    ADD CONSTRAINT "booking_checklists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_events"
    ADD CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_messages"
    ADD CONSTRAINT "booking_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_modifications"
    ADD CONSTRAINT "booking_modifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_photos"
    ADD CONSTRAINT "booking_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_slots"
    ADD CONSTRAINT "booking_slots_cleaner_id_date_time_key" UNIQUE ("cleaner_id", "date", "time");



ALTER TABLE ONLY "public"."booking_slots"
    ADD CONSTRAINT "booking_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_staff"
    ADD CONSTRAINT "booking_staff_booking_id_cleaner_id_key" UNIQUE ("booking_id", "cleaner_id");



ALTER TABLE ONLY "public"."booking_staff"
    ADD CONSTRAINT "booking_staff_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_status_log"
    ADD CONSTRAINT "booking_status_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_team"
    ADD CONSTRAINT "booking_team_booking_id_cleaner_id_key" UNIQUE ("booking_id", "cleaner_id");



ALTER TABLE ONLY "public"."booking_team"
    ADD CONSTRAINT "booking_team_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_connections"
    ADD CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_applications"
    ADD CONSTRAINT "cleaner_applications_email_unique" UNIQUE ("email");



ALTER TABLE ONLY "public"."cleaner_applications"
    ADD CONSTRAINT "cleaner_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_availability"
    ADD CONSTRAINT "cleaner_availability_cleaner_id_key" UNIQUE ("cleaner_id");



ALTER TABLE ONLY "public"."cleaner_availability"
    ADD CONSTRAINT "cleaner_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_availability_v2"
    ADD CONSTRAINT "cleaner_availability_v2_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_avoid_types"
    ADD CONSTRAINT "cleaner_avoid_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_booking_prefs"
    ADD CONSTRAINT "cleaner_booking_prefs_cleaner_id_key" UNIQUE ("cleaner_id");



ALTER TABLE ONLY "public"."cleaner_booking_prefs"
    ADD CONSTRAINT "cleaner_booking_prefs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_customer_relations"
    ADD CONSTRAINT "cleaner_customer_relations_cleaner_id_customer_id_key" UNIQUE ("cleaner_id", "customer_id");



ALTER TABLE ONLY "public"."cleaner_customer_relations"
    ADD CONSTRAINT "cleaner_customer_relations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_languages"
    ADD CONSTRAINT "cleaner_languages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_pet_prefs"
    ADD CONSTRAINT "cleaner_pet_prefs_cleaner_id_pet_type_key" UNIQUE ("cleaner_id", "pet_type");



ALTER TABLE ONLY "public"."cleaner_pet_prefs"
    ADD CONSTRAINT "cleaner_pet_prefs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_preferred_zones"
    ADD CONSTRAINT "cleaner_preferred_zones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_referrals"
    ADD CONSTRAINT "cleaner_referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_service_prices"
    ADD CONSTRAINT "cleaner_service_prices_cleaner_id_service_type_key" UNIQUE ("cleaner_id", "service_type");



ALTER TABLE ONLY "public"."cleaner_service_prices"
    ADD CONSTRAINT "cleaner_service_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_skills"
    ADD CONSTRAINT "cleaner_skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_zones"
    ADD CONSTRAINT "cleaner_zones_cleaner_id_key" UNIQUE ("cleaner_id");



ALTER TABLE ONLY "public"."cleaner_zones"
    ADD CONSTRAINT "cleaner_zones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaners"
    ADD CONSTRAINT "cleaners_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."cleaners"
    ADD CONSTRAINT "cleaners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaners"
    ADD CONSTRAINT "cleaners_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."commission_levels"
    ADD CONSTRAINT "commission_levels_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."commission_levels"
    ADD CONSTRAINT "commission_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_log"
    ADD CONSTRAINT "commission_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_org_number_key" UNIQUE ("org_number");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."company_service_prices"
    ADD CONSTRAINT "company_service_prices_company_id_service_type_key" UNIQUE ("company_id", "service_type");



ALTER TABLE ONLY "public"."company_service_prices"
    ADD CONSTRAINT "company_service_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coupon_usages"
    ADD CONSTRAINT "coupon_usages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_credits"
    ADD CONSTRAINT "customer_credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_customer_email_key" UNIQUE ("customer_email");



ALTER TABLE ONLY "public"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discount_usage"
    ADD CONSTRAINT "discount_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discounts"
    ADD CONSTRAINT "discounts_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."discounts"
    ADD CONSTRAINT "discounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dispute_evidence"
    ADD CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."earnings_summary"
    ADD CONSTRAINT "earnings_summary_cleaner_id_period_type_period_start_key" UNIQUE ("cleaner_id", "period_type", "period_start");



ALTER TABLE ONLY "public"."earnings_summary"
    ADD CONSTRAINT "earnings_summary_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."escrow_events"
    ADD CONSTRAINT "escrow_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guarantee_requests"
    ADD CONSTRAINT "guarantee_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_points"
    ADD CONSTRAINT "loyalty_points_customer_email_key" UNIQUE ("customer_email");



ALTER TABLE ONLY "public"."loyalty_points"
    ADD CONSTRAINT "loyalty_points_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."magic_link_shortcodes"
    ADD CONSTRAINT "magic_link_shortcodes_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."matching_shadow_log"
    ADD CONSTRAINT "matching_shadow_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "no_booking_overlap" EXCLUDE USING "gist" ("cleaner_id" WITH =, "tstzrange"("start_at", "end_at") WITH &&) WHERE (("event_type" = ANY (ARRAY['booking'::"text", 'blocked'::"text"])));



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_connections"
    ADD CONSTRAINT "one_provider_per_cleaner" UNIQUE ("cleaner_id", "provider");



ALTER TABLE ONLY "public"."payout_attempts"
    ADD CONSTRAINT "payout_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payout_attempts"
    ADD CONSTRAINT "payout_attempts_stripe_idempotency_key_key" UNIQUE ("stripe_idempotency_key");



ALTER TABLE ONLY "public"."payout_audit_log"
    ADD CONSTRAINT "payout_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processed_webhook_events"
    ADD CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key", "window_start");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_job_id_unique" UNIQUE ("job_id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "public"."self_invoices"
    ADD CONSTRAINT "self_invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."self_invoices"
    ADD CONSTRAINT "self_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_addons"
    ADD CONSTRAINT "service_addons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_addons"
    ADD CONSTRAINT "service_addons_service_id_key_key" UNIQUE ("service_id", "key");



ALTER TABLE ONLY "public"."service_checklists"
    ADD CONSTRAINT "service_checklists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_checklists"
    ADD CONSTRAINT "service_checklists_service_type_company_id_key" UNIQUE ("service_type", "company_id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."spark_levels"
    ADD CONSTRAINT "spark_levels_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."spark_levels"
    ADD CONSTRAINT "spark_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_slot_holds"
    ADD CONSTRAINT "subscription_slot_holds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."swedish_holidays"
    ADD CONSTRAINT "swedish_holidays_pkey" PRIMARY KEY ("holiday_date");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_slot_holds"
    ADD CONSTRAINT "unique_subscription_hold" UNIQUE ("subscription_id");



ALTER TABLE ONLY "public"."booking_slots"
    ADD CONSTRAINT "uq_booking_slots_booking_id" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "cleaners_email_company_unique_idx" ON "public"."cleaners" USING "btree" ("lower"("email"), COALESCE("company_id", '00000000-0000-0000-0000-000000000000'::"uuid")) WHERE ("email" IS NOT NULL);



COMMENT ON INDEX "public"."cleaners_email_company_unique_idx" IS 'Sprint 1 Dag 3 (2026-04-24) — förhindrar dubletter efter hygien #29. Email case-insensitive + NULL-säker via COALESCE. Samma email får finnas på flera företag (ägare med flera bolag) men ej samma email i samma företag.';



CREATE INDEX "idx_activity_log_actor" ON "public"."activity_log" USING "btree" ("actor_id");



CREATE INDEX "idx_activity_log_created" ON "public"."activity_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_analytics_created" ON "public"."analytics_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_analytics_type" ON "public"."analytics_events" USING "btree" ("event_type");



CREATE INDEX "idx_attested_jobs_attested_at" ON "public"."attested_jobs" USING "btree" ("attested_at" DESC);



CREATE INDEX "idx_audit_created" ON "public"."admin_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_resource" ON "public"."admin_audit_log" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_auth_audit_email" ON "public"."auth_audit_log" USING "btree" ("user_email", "created_at" DESC);



CREATE INDEX "idx_auth_audit_type" ON "public"."auth_audit_log" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "idx_auth_audit_user" ON "public"."auth_audit_log" USING "btree" ("user_id", "created_at" DESC) WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_avail_v2_cleaner" ON "public"."cleaner_availability_v2" USING "btree" ("cleaner_id", "day_of_week");



CREATE INDEX "idx_availability_v2_lookup" ON "public"."cleaner_availability_v2" USING "btree" ("cleaner_id", "day_of_week", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_blocked_cleaner" ON "public"."blocked_times" USING "btree" ("cleaner_id", "blocked_date");



CREATE INDEX "idx_booking_events_booking" ON "public"."booking_events" USING "btree" ("booking_id");



CREATE INDEX "idx_booking_slots_cleaner" ON "public"."booking_slots" USING "btree" ("cleaner_id");



CREATE INDEX "idx_booking_slots_date" ON "public"."booking_slots" USING "btree" ("date", "is_booked");



CREATE INDEX "idx_booking_team_booking" ON "public"."booking_team" USING "btree" ("booking_id");



CREATE INDEX "idx_booking_team_cleaner" ON "public"."booking_team" USING "btree" ("cleaner_id");



CREATE INDEX "idx_booking_team_status" ON "public"."booking_team" USING "btree" ("status");



CREATE INDEX "idx_bookings_attest" ON "public"."bookings" USING "btree" ("cleaner_id", "attest_status");



CREATE INDEX "idx_bookings_cleaner" ON "public"."bookings" USING "btree" ("cleaner_id");



CREATE INDEX "idx_bookings_date" ON "public"."bookings" USING "btree" ("booking_date");



CREATE INDEX "idx_bookings_dispute_status" ON "public"."bookings" USING "btree" ("dispute_status") WHERE ("dispute_status" <> 'none'::"text");



CREATE INDEX "idx_bookings_escrow_state" ON "public"."bookings" USING "btree" ("escrow_state") WHERE ("escrow_state" <> ALL (ARRAY['released_legacy'::"text", 'released'::"text", 'refunded'::"text", 'cancelled'::"text"]));



CREATE UNIQUE INDEX "idx_bookings_invoice_number_unique" ON "public"."bookings" USING "btree" ("invoice_number") WHERE ("invoice_number" IS NOT NULL);



CREATE INDEX "idx_bookings_payment_due_date" ON "public"."bookings" USING "btree" ("payment_due_date") WHERE ("payment_due_date" IS NOT NULL);



CREATE INDEX "idx_bookings_payment_marked_by" ON "public"."bookings" USING "btree" ("payment_marked_by") WHERE ("payment_marked_by" IS NOT NULL);



CREATE INDEX "idx_bookings_payment_mode_status" ON "public"."bookings" USING "btree" ("payment_mode", "payment_status") WHERE ("payment_mode" IS NOT NULL);



CREATE INDEX "idx_bookings_proposed_cleaner" ON "public"."bookings" USING "btree" ("reassignment_proposed_cleaner_id") WHERE ("reassignment_proposed_cleaner_id" IS NOT NULL);



CREATE INDEX "idx_bookings_reassignment_state" ON "public"."bookings" USING "btree" ("status", "reassignment_proposed_at") WHERE ("status" = ANY (ARRAY['awaiting_company_proposal'::"text", 'awaiting_customer_approval'::"text", 'awaiting_reassignment'::"text"]));



CREATE INDEX "idx_bookings_rut_application" ON "public"."bookings" USING "btree" ("rut_application_status") WHERE ("rut_application_status" <> ALL (ARRAY['not_applicable'::"text", 'approved'::"text"]));



CREATE INDEX "idx_bookings_status" ON "public"."bookings" USING "btree" ("status");



CREATE INDEX "idx_bookings_stripe_payment_intent" ON "public"."bookings" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE INDEX "idx_bookings_subscription_id" ON "public"."bookings" USING "btree" ("subscription_id") WHERE ("subscription_id" IS NOT NULL);



CREATE INDEX "idx_bsl_cleaner_email" ON "public"."booking_status_log" USING "btree" ("cleaner_email") WHERE ("cleaner_email" IS NOT NULL);



CREATE INDEX "idx_cal_booking_id" ON "public"."calendar_events" USING "btree" ("booking_id") WHERE ("booking_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_cal_booking_unique" ON "public"."calendar_events" USING "btree" ("booking_id") WHERE ("booking_id" IS NOT NULL);



CREATE INDEX "idx_cal_cleaner_range" ON "public"."calendar_events" USING "btree" ("cleaner_id", "start_at", "end_at");



CREATE INDEX "idx_cal_conn_active" ON "public"."calendar_connections" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_cal_conn_cleaner" ON "public"."calendar_connections" USING "btree" ("cleaner_id");



CREATE INDEX "idx_cal_event_type" ON "public"."calendar_events" USING "btree" ("event_type");



CREATE INDEX "idx_cal_external_id" ON "public"."calendar_events" USING "btree" ("external_id") WHERE ("external_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_cal_external_unique" ON "public"."calendar_events" USING "btree" ("cleaner_id", "external_id") WHERE ("external_id" IS NOT NULL);



CREATE INDEX "idx_cl_booking" ON "public"."commission_log" USING "btree" ("booking_id");



CREATE INDEX "idx_cl_cleaner" ON "public"."commission_log" USING "btree" ("cleaner_id");



CREATE INDEX "idx_cl_created" ON "public"."commission_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cleaner_applications_invited_created" ON "public"."cleaner_applications" USING "btree" ("created_at") WHERE ("status" = 'invited'::"text");



CREATE INDEX "idx_cleaner_applications_magic_code" ON "public"."cleaner_applications" USING "btree" ("invited_via_magic_code") WHERE ("invited_via_magic_code" IS NOT NULL);



CREATE INDEX "idx_cleaners_approval_active" ON "public"."cleaners" USING "btree" ("is_approved", "is_active", "status") WHERE (("is_approved" = true) AND ("is_active" = true) AND ("status" = 'aktiv'::"text"));



CREATE INDEX "idx_cleaners_availability_schedule" ON "public"."cleaners" USING "gin" ("availability_schedule");



CREATE INDEX "idx_cleaners_company_id" ON "public"."cleaners" USING "btree" ("company_id");



CREATE INDEX "idx_cleaners_home_geo" ON "public"."cleaners" USING "gist" ((("public"."st_makepoint"(("home_lng")::double precision, ("home_lat")::double precision))::"public"."geography")) WHERE (("home_lat" IS NOT NULL) AND ("home_lng" IS NOT NULL));



CREATE INDEX "idx_cleaners_languages" ON "public"."cleaners" USING "gin" ("languages") WHERE ("languages" IS NOT NULL);



CREATE UNIQUE INDEX "idx_cleaners_slug" ON "public"."cleaners" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);



CREATE INDEX "idx_cleaners_spark" ON "public"."cleaners" USING "btree" ("spark_points" DESC);



CREATE INDEX "idx_cleaners_specialties" ON "public"."cleaners" USING "gin" ("specialties") WHERE ("specialties" IS NOT NULL);



CREATE INDEX "idx_cleaners_status_approved" ON "public"."cleaners" USING "btree" ("status", "is_approved");



CREATE INDEX "idx_companies_owner" ON "public"."companies" USING "btree" ("owner_cleaner_id");



CREATE INDEX "idx_companies_trust_level" ON "public"."companies" USING "btree" ("payment_trust_level");



CREATE INDEX "idx_company_svc_prices" ON "public"."company_service_prices" USING "btree" ("company_id", "service_type");



CREATE INDEX "idx_coupons_active" ON "public"."coupons" USING "btree" ("active") WHERE ("active" = true);



CREATE INDEX "idx_coupons_code" ON "public"."coupons" USING "btree" ("code");



CREATE INDEX "idx_coupons_expires" ON "public"."coupons" USING "btree" ("expires_at");



CREATE INDEX "idx_cr_booking_id" ON "public"."cleaner_referrals" USING "btree" ("booking_id") WHERE ("booking_id" IS NOT NULL);



CREATE INDEX "idx_cr_cleaner_id" ON "public"."cleaner_referrals" USING "btree" ("cleaner_id");



CREATE INDEX "idx_cr_referred_email" ON "public"."cleaner_referrals" USING "btree" ("referred_email");



CREATE INDEX "idx_cr_status" ON "public"."cleaner_referrals" USING "btree" ("status");



CREATE INDEX "idx_cu_coupon_id" ON "public"."coupon_usages" USING "btree" ("coupon_id");



CREATE INDEX "idx_cu_customer" ON "public"."coupon_usages" USING "btree" ("customer_email");



CREATE INDEX "idx_customer_prefs_email" ON "public"."customer_preferences" USING "btree" ("customer_email");



CREATE INDEX "idx_customer_prefs_favorite_cleaner" ON "public"."customer_preferences" USING "btree" ("favorite_cleaner_id") WHERE ("favorite_cleaner_id" IS NOT NULL);



CREATE INDEX "idx_customer_profiles_nudge_pending" ON "public"."customer_profiles" USING "btree" ("created_at") WHERE ("recurring_nudge_sent_at" IS NULL);



CREATE INDEX "idx_customer_profiles_stripe_customer" ON "public"."customer_profiles" USING "btree" ("stripe_customer_id") WHERE ("stripe_customer_id" IS NOT NULL);



CREATE INDEX "idx_dispute_evidence_dispute" ON "public"."dispute_evidence" USING "btree" ("dispute_id");



CREATE INDEX "idx_disputes_booking" ON "public"."disputes" USING "btree" ("booking_id");



CREATE INDEX "idx_disputes_open" ON "public"."disputes" USING "btree" ("opened_at" DESC) WHERE ("resolved_at" IS NULL);



CREATE INDEX "idx_disputes_opened_at" ON "public"."disputes" USING "btree" ("opened_at" DESC);



CREATE INDEX "idx_escrow_events_booking" ON "public"."escrow_events" USING "btree" ("booking_id", "created_at" DESC);



CREATE INDEX "idx_escrow_events_created_at" ON "public"."escrow_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_loyalty_email" ON "public"."loyalty_points" USING "btree" ("customer_email");



CREATE INDEX "idx_messages_booking" ON "public"."messages" USING "btree" ("booking_id");



CREATE INDEX "idx_notif_cleaner" ON "public"."notifications" USING "btree" ("cleaner_id", "read");



CREATE INDEX "idx_payout_attempts_booking" ON "public"."payout_attempts" USING "btree" ("booking_id");



CREATE INDEX "idx_payout_attempts_status" ON "public"."payout_attempts" USING "btree" ("status");



CREATE INDEX "idx_payout_audit_booking" ON "public"."payout_audit_log" USING "btree" ("booking_id");



CREATE INDEX "idx_payout_audit_created" ON "public"."payout_audit_log" USING "btree" ("created_at");



CREATE INDEX "idx_payout_audit_severity" ON "public"."payout_audit_log" USING "btree" ("severity") WHERE ("severity" <> 'info'::"text");



CREATE INDEX "idx_rate_limits_expire" ON "public"."rate_limits" USING "btree" ("window_start");



CREATE INDEX "idx_ratings_cleaner" ON "public"."ratings" USING "btree" ("cleaner_id");



CREATE INDEX "idx_self_invoices_cleaner" ON "public"."self_invoices" USING "btree" ("cleaner_id");



CREATE INDEX "idx_self_invoices_period" ON "public"."self_invoices" USING "btree" ("period_start", "period_end");



CREATE INDEX "idx_self_invoices_status" ON "public"."self_invoices" USING "btree" ("status");



CREATE INDEX "idx_shortcodes_email" ON "public"."magic_link_shortcodes" USING "btree" ("email");



CREATE INDEX "idx_shortcodes_expires" ON "public"."magic_link_shortcodes" USING "btree" ("expires_at") WHERE ("used_at" IS NULL);



CREATE INDEX "idx_shortcodes_resource" ON "public"."magic_link_shortcodes" USING "btree" ("resource_id") WHERE ("resource_id" IS NOT NULL);



CREATE INDEX "idx_slot_holds_cleaner_day_active" ON "public"."subscription_slot_holds" USING "btree" ("cleaner_id", "weekday") WHERE ("active" = true);



CREATE INDEX "idx_slot_holds_subscription" ON "public"."subscription_slot_holds" USING "btree" ("subscription_id");



CREATE INDEX "idx_spark_levels_points" ON "public"."spark_levels" USING "btree" ("min_points");



CREATE INDEX "idx_status_log_booking" ON "public"."booking_status_log" USING "btree" ("booking_id");



CREATE INDEX "idx_sub_email" ON "public"."subscriptions" USING "btree" ("customer_email");



CREATE INDEX "idx_sub_next" ON "public"."subscriptions" USING "btree" ("next_booking_date") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_sub_status" ON "public"."subscriptions" USING "btree" ("status");



CREATE INDEX "idx_subs_cleaner_aktiv" ON "public"."subscriptions" USING "btree" ("cleaner_id") WHERE (("cleaner_id" IS NOT NULL) AND ("status" = 'aktiv'::"text"));



CREATE INDEX "idx_subs_status_next_date" ON "public"."subscriptions" USING "btree" ("status", "next_booking_date") WHERE ("status" = 'aktiv'::"text");



CREATE INDEX "idx_subscriptions_company_id" ON "public"."subscriptions" USING "btree" ("company_id") WHERE ("company_id" IS NOT NULL);



CREATE INDEX "idx_subscriptions_consecutive_failures" ON "public"."subscriptions" USING "btree" ("consecutive_failures") WHERE ("consecutive_failures" > 0);



CREATE INDEX "idx_subscriptions_next_booking_date" ON "public"."subscriptions" USING "btree" ("next_booking_date") WHERE (("status" = 'active'::"text") AND ("next_booking_date" IS NOT NULL));



CREATE INDEX "idx_subscriptions_status" ON "public"."subscriptions" USING "btree" ("status");



CREATE INDEX "idx_swedish_holidays_year" ON "public"."swedish_holidays" USING "btree" (EXTRACT(year FROM "holiday_date"));



CREATE INDEX "idx_tasks_assigned" ON "public"."tasks" USING "btree" ("assigned_to", "status");



CREATE INDEX "idx_tasks_company" ON "public"."tasks" USING "btree" ("company_id", "status");



CREATE INDEX "matching_shadow_log_booking_idx" ON "public"."matching_shadow_log" USING "btree" ("booking_id");



CREATE INDEX "matching_shadow_log_created_idx" ON "public"."matching_shadow_log" USING "btree" ("created_at" DESC);



CREATE INDEX "matching_shadow_log_providers_idx" ON "public"."matching_shadow_log" USING "btree" ((("providers_ranking" IS NOT NULL))) WHERE ("providers_ranking" IS NOT NULL);



CREATE INDEX "service_addons_service_idx" ON "public"."service_addons" USING "btree" ("service_id", "active", "display_order");



CREATE INDEX "services_active_order_idx" ON "public"."services" USING "btree" ("active", "display_order") WHERE ("active" = true);



CREATE INDEX "services_key_idx" ON "public"."services" USING "btree" ("key");



CREATE OR REPLACE TRIGGER "customer_prefs_auto_updated_at" BEFORE UPDATE ON "public"."customer_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."touch_customer_prefs_updated_at"();



CREATE OR REPLACE TRIGGER "services_updated_at" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_auto_convert_referral" AFTER UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."auto_convert_referral"();



CREATE OR REPLACE TRIGGER "trg_avail_v2_no_overlap" BEFORE INSERT OR UPDATE ON "public"."cleaner_availability_v2" FOR EACH ROW EXECUTE FUNCTION "public"."validate_avail_v2_no_overlap"();



CREATE OR REPLACE TRIGGER "trg_booking_id" BEFORE INSERT ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."generate_booking_id"();



CREATE OR REPLACE TRIGGER "trg_booking_to_calendar" AFTER INSERT OR DELETE OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_booking_to_calendar"();



CREATE OR REPLACE TRIGGER "trg_cal_conn_updated" BEFORE UPDATE ON "public"."calendar_connections" FOR EACH ROW EXECUTE FUNCTION "public"."update_cal_conn_updated_at"();



CREATE OR REPLACE TRIGGER "trg_calendar_events_updated_at" BEFORE UPDATE ON "public"."calendar_events" FOR EACH ROW EXECUTE FUNCTION "public"."update_calendar_events_updated_at"();



CREATE OR REPLACE TRIGGER "trg_increment_coupon_usage" AFTER INSERT ON "public"."coupon_usages" FOR EACH ROW EXECUTE FUNCTION "public"."increment_coupon_usage"();



CREATE OR REPLACE TRIGGER "trg_slot_holds_updated_at" BEFORE UPDATE ON "public"."subscription_slot_holds" FOR EACH ROW EXECUTE FUNCTION "public"."update_slot_holds_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_booking_slot" AFTER INSERT OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_booking_to_slot"();



CREATE OR REPLACE TRIGGER "trg_sync_booking_status" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW WHEN (("old"."payment_status" IS DISTINCT FROM "new"."payment_status")) EXECUTE FUNCTION "public"."fn_sync_booking_status"();



CREATE OR REPLACE TRIGGER "trg_sync_cleaner_contact" AFTER UPDATE ON "public"."cleaners" FOR EACH ROW EXECUTE FUNCTION "public"."sync_cleaner_contact_to_bookings"();



CREATE OR REPLACE TRIGGER "trg_sync_cleaner_fields" BEFORE INSERT OR UPDATE ON "public"."cleaners" FOR EACH ROW EXECUTE FUNCTION "public"."sync_cleaner_hourly_rate"();



CREATE OR REPLACE TRIGGER "trg_sync_hourly_rate" AFTER INSERT OR DELETE OR UPDATE ON "public"."cleaner_service_prices" FOR EACH ROW EXECUTE FUNCTION "public"."sync_hourly_rate_from_service_prices"();



CREATE OR REPLACE TRIGGER "trg_sync_review_stats" AFTER INSERT OR DELETE OR UPDATE ON "public"."ratings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_cleaner_review_stats"();



CREATE OR REPLACE TRIGGER "trg_update_cleaner_rating" AFTER INSERT ON "public"."ratings" FOR EACH ROW EXECUTE FUNCTION "public"."update_cleaner_rating"();



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id");



ALTER TABLE ONLY "public"."blocked_times"
    ADD CONSTRAINT "blocked_times_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_adjustments"
    ADD CONSTRAINT "booking_adjustments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_checklists"
    ADD CONSTRAINT "booking_checklists_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");



ALTER TABLE ONLY "public"."booking_checklists"
    ADD CONSTRAINT "booking_checklists_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "public"."service_checklists"("id");



ALTER TABLE ONLY "public"."booking_messages"
    ADD CONSTRAINT "booking_messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_modifications"
    ADD CONSTRAINT "booking_modifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_photos"
    ADD CONSTRAINT "booking_photos_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_photos"
    ADD CONSTRAINT "booking_photos_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."booking_slots"
    ADD CONSTRAINT "booking_slots_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_staff"
    ADD CONSTRAINT "booking_staff_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."booking_staff"
    ADD CONSTRAINT "booking_staff_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_staff"
    ADD CONSTRAINT "booking_staff_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_status_log"
    ADD CONSTRAINT "booking_status_log_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");



ALTER TABLE ONLY "public"."booking_team"
    ADD CONSTRAINT "booking_team_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_team"
    ADD CONSTRAINT "booking_team_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."booking_team"
    ADD CONSTRAINT "booking_team_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_payment_marked_by_fkey" FOREIGN KEY ("payment_marked_by") REFERENCES "public"."cleaners"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_reassignment_proposed_by_fkey" FOREIGN KEY ("reassignment_proposed_by") REFERENCES "public"."cleaners"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_reassignment_proposed_cleaner_id_fkey" FOREIGN KEY ("reassignment_proposed_cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calendar_connections"
    ADD CONSTRAINT "calendar_connections_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_availability"
    ADD CONSTRAINT "cleaner_availability_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_availability_v2"
    ADD CONSTRAINT "cleaner_availability_v2_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_avoid_types"
    ADD CONSTRAINT "cleaner_avoid_types_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_booking_prefs"
    ADD CONSTRAINT "cleaner_booking_prefs_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_customer_relations"
    ADD CONSTRAINT "cleaner_customer_relations_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_languages"
    ADD CONSTRAINT "cleaner_languages_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_pet_prefs"
    ADD CONSTRAINT "cleaner_pet_prefs_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_preferred_zones"
    ADD CONSTRAINT "cleaner_preferred_zones_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_referrals"
    ADD CONSTRAINT "cleaner_referrals_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cleaner_referrals"
    ADD CONSTRAINT "cleaner_referrals_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_service_prices"
    ADD CONSTRAINT "cleaner_service_prices_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."cleaner_skills"
    ADD CONSTRAINT "cleaner_skills_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_zones"
    ADD CONSTRAINT "cleaner_zones_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaners"
    ADD CONSTRAINT "cleaners_added_by_owner_id_fkey" FOREIGN KEY ("added_by_owner_id") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."cleaners"
    ADD CONSTRAINT "cleaners_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."cleaners"
    ADD CONSTRAINT "cleaners_spark_level_id_fkey" FOREIGN KEY ("spark_level_id") REFERENCES "public"."spark_levels"("id");



ALTER TABLE ONLY "public"."commission_log"
    ADD CONSTRAINT "commission_log_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commission_log"
    ADD CONSTRAINT "commission_log_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_owner_cleaner_id_fkey" FOREIGN KEY ("owner_cleaner_id") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."company_service_prices"
    ADD CONSTRAINT "company_service_prices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coupon_usages"
    ADD CONSTRAINT "coupon_usages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coupon_usages"
    ADD CONSTRAINT "coupon_usages_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_favorite_cleaner_id_fkey" FOREIGN KEY ("favorite_cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."discount_usage"
    ADD CONSTRAINT "discount_usage_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."earnings_summary"
    ADD CONSTRAINT "earnings_summary_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guarantee_requests"
    ADD CONSTRAINT "guarantee_requests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");



ALTER TABLE ONLY "public"."matching_shadow_log"
    ADD CONSTRAINT "matching_shadow_log_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payout_attempts"
    ADD CONSTRAINT "payout_attempts_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payout_audit_log"
    ADD CONSTRAINT "payout_audit_log_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."admin_permissions"("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id");



ALTER TABLE ONLY "public"."self_invoices"
    ADD CONSTRAINT "self_invoices_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."service_addons"
    ADD CONSTRAINT "service_addons_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_checklists"
    ADD CONSTRAINT "service_checklists_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."subscription_slot_holds"
    ADD CONSTRAINT "subscription_slot_holds_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_slot_holds"
    ADD CONSTRAINT "subscription_slot_holds_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."cleaners"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_related_booking_id_fkey" FOREIGN KEY ("related_booking_id") REFERENCES "public"."bookings"("id");



CREATE POLICY "Admin SELECT cleaner service prices" ON "public"."cleaner_service_prices" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users")));



CREATE POLICY "Admin SELECT companies" ON "public"."companies" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users")));



CREATE POLICY "Admin SELECT customer profiles" ON "public"."customer_profiles" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users")));



CREATE POLICY "Admin can insert audit log" ON "public"."admin_audit_log" FOR INSERT WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text"));



CREATE POLICY "Admin can manage bookings" ON "public"."bookings" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin can manage calendar_events" ON "public"."calendar_events" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin can manage cleaners" ON "public"."cleaners" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin can manage coupons" ON "public"."coupons" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "Admin can manage service prices" ON "public"."cleaner_service_prices" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin can manage tickets" ON "public"."support_tickets" USING ((("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text"));



CREATE POLICY "Admin can read audit log" ON "public"."admin_audit_log" FOR SELECT USING ((("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text"));



CREATE POLICY "Admin can read emails" ON "public"."emails" FOR SELECT USING ((("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text"));



CREATE POLICY "Admin can update any cleaner" ON "public"."cleaners" FOR UPDATE USING ((("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text"));



CREATE POLICY "Admin can update emails" ON "public"."emails" FOR UPDATE USING ((("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text"));



CREATE POLICY "Admin manages all availability" ON "public"."cleaner_availability" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin manages all availability_v2" ON "public"."cleaner_availability_v2" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin manages all booking_checklists" ON "public"."booking_checklists" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin manages all company prices" ON "public"."company_service_prices" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin manages all service_checklists" ON "public"."service_checklists" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin manages all tasks" ON "public"."tasks" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin manages booking_slots" ON "public"."booking_slots" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin manages coupons" ON "public"."coupons" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin manages platform_settings" ON "public"."platform_settings" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin read admin_permissions" ON "public"."admin_permissions" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("admin_users"."is_active" = true)))) OR (("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text")));



CREATE POLICY "Admin read admin_roles" ON "public"."admin_roles" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("admin_users"."is_active" = true)))) OR (("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text")));



CREATE POLICY "Admin read role_permissions" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE (("admin_users"."email" = ("auth"."jwt"() ->> 'email'::"text")) AND ("admin_users"."is_active" = true)))) OR (("auth"."jwt"() ->> 'email'::"text") = 'hello@spick.se'::"text")));



CREATE POLICY "Admin reads all applications" ON "public"."cleaner_applications" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin reads auth_audit_log" ON "public"."auth_audit_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin update own login" ON "public"."admin_users" FOR UPDATE USING ((("auth"."jwt"() ->> 'email'::"text") = "email")) WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = "email"));



CREATE POLICY "Admin updates all companies" ON "public"."companies" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin updates applications" ON "public"."cleaner_applications" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Allow insert companies" ON "public"."companies" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow insert ratings" ON "public"."ratings" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Anon can insert emails" ON "public"."emails" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anon can insert tickets" ON "public"."support_tickets" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anon can read active coupons" ON "public"."coupons" FOR SELECT USING (("active" = true));



CREATE POLICY "Anon can read approved active cleaners" ON "public"."cleaners" FOR SELECT TO "authenticated", "anon" USING ((("is_approved" = true) AND ("is_active" = true)));



CREATE POLICY "Anon can read calendar_events" ON "public"."calendar_events" FOR SELECT USING (true);



CREATE POLICY "Anon can read prices" ON "public"."cleaner_service_prices" FOR SELECT USING (true);



CREATE POLICY "Anon can read ratings" ON "public"."ratings" FOR SELECT USING (true);



CREATE POLICY "Anon can read slot_holds" ON "public"."subscription_slot_holds" FOR SELECT USING (true);



CREATE POLICY "Anon creates bookings" ON "public"."bookings" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anon insert guarantee requests" ON "public"."guarantee_requests" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Anyone can insert applications" ON "public"."cleaner_applications" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert messages" ON "public"."messages" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert status log" ON "public"."booking_status_log" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can read active coupons" ON "public"."coupons" FOR SELECT USING ((("active" = true) AND (("expires_at" IS NULL) OR ("expires_at" > "now"()))));



CREATE POLICY "Anyone can read commission levels" ON "public"."commission_levels" FOR SELECT USING (true);



CREATE POLICY "Anyone can read holidays" ON "public"."swedish_holidays" FOR SELECT USING (true);



CREATE POLICY "Anyone can read spark levels" ON "public"."spark_levels" FOR SELECT USING (true);



CREATE POLICY "Auth read own bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING ((("customer_email" = (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'email'::"text")) OR ("cleaner_id" = "auth"."uid"())));



CREATE POLICY "Auth reads cleaner_avoid_types" ON "public"."cleaner_avoid_types" FOR SELECT USING (true);



CREATE POLICY "Auth reads cleaner_booking_prefs" ON "public"."cleaner_booking_prefs" FOR SELECT USING (true);



CREATE POLICY "Auth reads cleaner_languages" ON "public"."cleaner_languages" FOR SELECT USING (true);



CREATE POLICY "Auth reads cleaner_pet_prefs" ON "public"."cleaner_pet_prefs" FOR SELECT USING (true);



CREATE POLICY "Auth reads cleaner_preferred_zones" ON "public"."cleaner_preferred_zones" FOR SELECT USING (true);



CREATE POLICY "Auth reads cleaner_skills" ON "public"."cleaner_skills" FOR SELECT USING (true);



CREATE POLICY "Auth reads cleaner_zones" ON "public"."cleaner_zones" FOR SELECT USING (true);



CREATE POLICY "Auth reads relations" ON "public"."cleaner_customer_relations" FOR SELECT USING (true);



CREATE POLICY "Auth updates notifications" ON "public"."notifications" FOR UPDATE USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Authenticated can manage own prices" ON "public"."cleaner_service_prices" TO "authenticated" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"())))) WITH CHECK (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Authenticated can submit applications" ON "public"."cleaner_applications" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated read admin_permissions" ON "public"."admin_permissions" FOR SELECT USING (true);



CREATE POLICY "Authenticated read admin_roles" ON "public"."admin_roles" FOR SELECT USING (true);



CREATE POLICY "Authenticated read own admin_users" ON "public"."admin_users" FOR SELECT USING ((("auth"."jwt"() ->> 'email'::"text") = "email"));



CREATE POLICY "Authenticated read role_permissions" ON "public"."role_permissions" FOR SELECT USING (true);



CREATE POLICY "Authenticated users manage own calendar_events" ON "public"."calendar_events" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner manages own availability_v2" ON "public"."cleaner_availability_v2" TO "authenticated" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"())))) WITH CHECK (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner manages own booking_checklists" ON "public"."booking_checklists" TO "authenticated" USING (("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE ("bookings"."cleaner_id" IN ( SELECT "cleaners"."id"
           FROM "public"."cleaners"
          WHERE ("cleaners"."auth_user_id" = "auth"."uid"())))))) WITH CHECK (("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE ("bookings"."cleaner_id" IN ( SELECT "cleaners"."id"
           FROM "public"."cleaners"
          WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))))));



CREATE POLICY "Cleaner manages own tasks" ON "public"."tasks" TO "authenticated" USING ((("assigned_to" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))) OR ("created_by" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))))) WITH CHECK ((("assigned_to" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))) OR ("created_by" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "Cleaner or VD manages blocked_times" ON "public"."blocked_times" USING (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE (("c"."auth_user_id" = "auth"."uid"()) OR ("c"."company_id" = ( SELECT "vd"."company_id"
           FROM "public"."cleaners" "vd"
          WHERE (("vd"."auth_user_id" = "auth"."uid"()) AND ("vd"."is_company_owner" = true) AND ("vd"."company_id" IS NOT NULL))
         LIMIT 1)))))) WITH CHECK (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE (("c"."auth_user_id" = "auth"."uid"()) OR ("c"."company_id" = ( SELECT "vd"."company_id"
           FROM "public"."cleaners" "vd"
          WHERE (("vd"."auth_user_id" = "auth"."uid"()) AND ("vd"."is_company_owner" = true) AND ("vd"."company_id" IS NOT NULL))
         LIMIT 1))))));



CREATE POLICY "Cleaner reads own application" ON "public"."cleaner_applications" FOR SELECT TO "authenticated" USING (("email" = ("auth"."jwt"() ->> 'email'::"text")));



CREATE POLICY "Cleaner reads own bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("cleaner_id" = "auth"."uid"()));



CREATE POLICY "Cleaner sees own availability" ON "public"."cleaner_availability" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own booking prefs" ON "public"."cleaner_booking_prefs" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own bookings via cleaners table" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own data" ON "public"."cleaners" FOR SELECT TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "Cleaner sees own earnings" ON "public"."earnings_summary" FOR SELECT USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own holds" ON "public"."subscription_slot_holds" FOR SELECT USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own languages" ON "public"."cleaner_languages" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own notifications" ON "public"."notifications" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own pet prefs" ON "public"."cleaner_pet_prefs" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own pref zones" ON "public"."cleaner_preferred_zones" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own ratings" ON "public"."ratings" FOR SELECT USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own relations" ON "public"."cleaner_customer_relations" FOR SELECT USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own skills" ON "public"."cleaner_skills" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner sees own zones" ON "public"."cleaner_zones" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Cleaner updates own bookings" ON "public"."bookings" FOR UPDATE TO "authenticated" USING (("cleaner_id" = "auth"."uid"()));



CREATE POLICY "Cleaner updates own profile" ON "public"."cleaners" FOR UPDATE USING (("auth_user_id" = "auth"."uid"())) WITH CHECK (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "Cleaners can update own profile columns" ON "public"."cleaners" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Cleaners read own commission log" ON "public"."commission_log" FOR SELECT USING (("auth"."uid"() = "cleaner_id"));



CREATE POLICY "Cleaners read own referrals" ON "public"."cleaner_referrals" FOR SELECT USING (("auth"."uid"() = "cleaner_id"));



CREATE POLICY "Cleaners see own invoices" ON "public"."self_invoices" FOR SELECT USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Company owner can insert team members" ON "public"."cleaners" FOR INSERT WITH CHECK ("public"."is_company_owner_of"("company_id"));



CREATE POLICY "Company owner can read own company" ON "public"."companies" FOR SELECT USING (("owner_cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Company owner can update own company" ON "public"."companies" FOR UPDATE USING (("owner_cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Company owner can update team members" ON "public"."cleaners" FOR UPDATE USING ("public"."is_company_owner_of"("company_id"));



CREATE POLICY "Company owner deletes team calendar_events" ON "public"."calendar_events" FOR DELETE USING ((("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" = ( SELECT "c2"."company_id"
           FROM "public"."cleaners" "c2"
          WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true)))))) OR ("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "Company owner manages team calendar_events" ON "public"."calendar_events" FOR INSERT WITH CHECK ((("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" = ( SELECT "c2"."company_id"
           FROM "public"."cleaners" "c2"
          WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true)))))) OR ("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "Company owner reads team bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "owner"."company_id"
           FROM "public"."cleaners" "owner"
          WHERE (("owner"."auth_user_id" = "auth"."uid"()) AND ("owner"."is_company_owner" = true)))))));



CREATE POLICY "Company owner reads team calendar_events" ON "public"."calendar_events" FOR SELECT USING ((("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" = ( SELECT "c2"."company_id"
           FROM "public"."cleaners" "c2"
          WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true)))))) OR ("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))) OR ("auth"."role"() = 'anon'::"text")));



CREATE POLICY "Company owner updates team bookings" ON "public"."bookings" FOR UPDATE TO "authenticated" USING (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "c2"."company_id"
           FROM "public"."cleaners" "c2"
          WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true))))))) WITH CHECK ((("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "c2"."company_id"
           FROM "public"."cleaners" "c2"
          WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true)))))) OR ("cleaner_id" IS NULL)));



CREATE POLICY "Company owner updates team calendar_events" ON "public"."calendar_events" FOR UPDATE USING ((("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" = ( SELECT "c2"."company_id"
           FROM "public"."cleaners" "c2"
          WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true)))))) OR ("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "Customer inserts own preferences" ON "public"."customer_preferences" FOR INSERT WITH CHECK (("customer_email" = ("auth"."jwt"() ->> 'email'::"text")));



CREATE POLICY "Customer read own points" ON "public"."loyalty_points" FOR SELECT USING (("customer_email" = (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'email'::"text")));



CREATE POLICY "Customer reads own bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("customer_email" = ("auth"."jwt"() ->> 'email'::"text")));



CREATE POLICY "Customer reads own points" ON "public"."loyalty_points" FOR SELECT USING (("customer_email" = "auth"."email"()));



CREATE POLICY "Customer reads own preferences" ON "public"."customer_preferences" FOR SELECT USING (("customer_email" = ("auth"."jwt"() ->> 'email'::"text")));



CREATE POLICY "Customer reads own profile" ON "public"."customer_profiles" FOR SELECT TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "Customer updates own preferences" ON "public"."customer_preferences" FOR UPDATE USING (("customer_email" = ("auth"."jwt"() ->> 'email'::"text")));



CREATE POLICY "Customer updates own profile" ON "public"."customer_profiles" FOR UPDATE TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "Customers read own credits" ON "public"."customer_credits" FOR SELECT USING (("customer_email" = ("auth"."jwt"() ->> 'email'::"text")));



CREATE POLICY "Insert coupon usage" ON "public"."coupon_usages" FOR INSERT WITH CHECK (true);



CREATE POLICY "Owner reads own profile" ON "public"."customer_profiles" FOR SELECT TO "authenticated" USING ((("auth_user_id" = "auth"."uid"()) OR ("email" = (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'email'::"text"))));



CREATE POLICY "Public read active discounts" ON "public"."discounts" FOR SELECT USING (("active" = true));



CREATE POLICY "Public read availability_v2" ON "public"."cleaner_availability_v2" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read blocked_times — intentional" ON "public"."blocked_times" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read booking_slots — intentional" ON "public"."booking_slots" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read cleaner_availability" ON "public"."cleaner_availability" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read company_service_prices — intentional" ON "public"."company_service_prices" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read platform_settings — intentional" ON "public"."platform_settings" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read service_checklists" ON "public"."service_checklists" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Read own coupon usage" ON "public"."coupon_usages" FOR SELECT USING (true);



CREATE POLICY "Read own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("cleaner_id" = "auth"."uid"()));



CREATE POLICY "Service manage guarantee requests" ON "public"."guarantee_requests" TO "service_role" USING (true);



CREATE POLICY "Service read guarantee requests" ON "public"."guarantee_requests" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "Service role can insert referrals" ON "public"."cleaner_referrals" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role full access" ON "public"."companies" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access" ON "public"."loyalty_points" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access" ON "public"."self_invoices" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access admin_audit_log" ON "public"."admin_audit_log" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access admin_permissions" ON "public"."admin_permissions" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access admin_roles" ON "public"."admin_roles" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access admin_users" ON "public"."admin_users" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access role_permissions" ON "public"."role_permissions" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full bookings" ON "public"."bookings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full profiles" ON "public"."customer_profiles" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role inserts commission log" ON "public"."commission_log" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role manage booking_events" ON "public"."booking_events" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage customer_credits" ON "public"."customer_credits" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage discount_usage" ON "public"."discount_usage" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manage discounts" ON "public"."discounts" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages all connections" ON "public"."calendar_connections" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages availability_v2" ON "public"."cleaner_availability_v2" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages booking_checklists" ON "public"."booking_checklists" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages booking_slots" ON "public"."booking_slots" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages calendar_events" ON "public"."calendar_events" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages company_service_prices" ON "public"."company_service_prices" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages coupons" ON "public"."coupons" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages holidays" ON "public"."swedish_holidays" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages magic_link_shortcodes" ON "public"."magic_link_shortcodes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages platform_settings" ON "public"."platform_settings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages preferences" ON "public"."customer_preferences" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages rate_limits" ON "public"."rate_limits" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages referrals" ON "public"."referrals" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages service_checklists" ON "public"."service_checklists" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages slot_holds" ON "public"."subscription_slot_holds" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages subscriptions" ON "public"."subscriptions" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages tasks" ON "public"."tasks" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role reads applications" ON "public"."cleaner_applications" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "Service role updates applications" ON "public"."cleaner_applications" FOR UPDATE TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role updates cleaner_referrals" ON "public"."cleaner_referrals" FOR UPDATE TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role writes auth_audit_log" ON "public"."auth_audit_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Users can create own cleaner" ON "public"."cleaners" FOR INSERT WITH CHECK (("auth"."uid"() = "auth_user_id"));



CREATE POLICY "Users can update own cleaner" ON "public"."cleaners" FOR UPDATE USING (("auth"."uid"() = "auth_user_id"));



CREATE POLICY "Users manage own connections" ON "public"."calendar_connections" USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Users read own connections" ON "public"."calendar_connections" FOR SELECT USING (("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "VD manages own company prices" ON "public"."company_service_prices" TO "authenticated" USING (("company_id" IN ( SELECT "cleaners"."company_id"
   FROM "public"."cleaners"
  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))))) WITH CHECK (("company_id" IN ( SELECT "cleaners"."company_id"
   FROM "public"."cleaners"
  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true)))));



CREATE POLICY "VD manages own company service_checklists" ON "public"."service_checklists" TO "authenticated" USING (("company_id" IN ( SELECT "cleaners"."company_id"
   FROM "public"."cleaners"
  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))))) WITH CHECK (("company_id" IN ( SELECT "cleaners"."company_id"
   FROM "public"."cleaners"
  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true)))));



CREATE POLICY "VD manages team availability" ON "public"."cleaner_availability" TO "authenticated" USING (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "cleaners"."company_id"
           FROM "public"."cleaners"
          WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))))))) WITH CHECK (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "cleaners"."company_id"
           FROM "public"."cleaners"
          WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true)))))));



CREATE POLICY "VD manages team availability_v2" ON "public"."cleaner_availability_v2" TO "authenticated" USING (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "cleaners"."company_id"
           FROM "public"."cleaners"
          WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))))))) WITH CHECK (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "cleaners"."company_id"
           FROM "public"."cleaners"
          WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true)))))));



CREATE POLICY "VD manages team booking_checklists" ON "public"."booking_checklists" TO "authenticated" USING (("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE ("bookings"."cleaner_id" IN ( SELECT "c"."id"
           FROM "public"."cleaners" "c"
          WHERE ("c"."company_id" IN ( SELECT "cleaners"."company_id"
                   FROM "public"."cleaners"
                  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))))))))) WITH CHECK (("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE ("bookings"."cleaner_id" IN ( SELECT "c"."id"
           FROM "public"."cleaners" "c"
          WHERE ("c"."company_id" IN ( SELECT "cleaners"."company_id"
                   FROM "public"."cleaners"
                  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true)))))))));



CREATE POLICY "VD manages team tasks" ON "public"."tasks" TO "authenticated" USING (("company_id" IN ( SELECT "cleaners"."company_id"
   FROM "public"."cleaners"
  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))))) WITH CHECK (("company_id" IN ( SELECT "cleaners"."company_id"
   FROM "public"."cleaners"
  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true)))));



CREATE POLICY "VD reads team applications" ON "public"."cleaner_applications" FOR SELECT TO "authenticated" USING (("invited_by_company_id" IN ( SELECT "cleaners"."company_id"
   FROM "public"."cleaners"
  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true)))));



CREATE POLICY "VD updates own company" ON "public"."companies" FOR UPDATE TO "authenticated" USING (("id" IN ( SELECT "cleaners"."company_id"
   FROM "public"."cleaners"
  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))))) WITH CHECK (("id" IN ( SELECT "cleaners"."company_id"
   FROM "public"."cleaners"
  WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true)))));



ALTER TABLE "public"."activity_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_log_insert" ON "public"."activity_log" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "activity_log_select" ON "public"."activity_log" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_manage_adjustments" ON "public"."booking_adjustments" USING ("public"."is_admin"());



CREATE POLICY "admin_manage_messages" ON "public"."booking_messages" USING ("public"."is_admin"());



CREATE POLICY "admin_manage_modifications" ON "public"."booking_modifications" USING ("public"."is_admin"());



CREATE POLICY "admin_manage_photos" ON "public"."booking_photos" USING ("public"."is_admin"());



CREATE POLICY "admin_manage_staff" ON "public"."booking_staff" USING ("public"."is_admin"());



ALTER TABLE "public"."admin_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_read_waitlist" ON "public"."waitlist" FOR SELECT USING ((("auth"."jwt"() ->> 'email'::"text") IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users"
  WHERE ("admin_users"."is_active" = true))));



CREATE POLICY "admin_reads_all_booking_status" ON "public"."booking_status_log" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users"
  WHERE ("admin_users"."is_active" = true))));



CREATE POLICY "admin_reads_all_customer_profiles" ON "public"."customer_profiles" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users"
  WHERE ("admin_users"."is_active" = true))));



CREATE POLICY "admin_reads_all_messages" ON "public"."messages" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users"
  WHERE ("admin_users"."is_active" = true))));



CREATE POLICY "admin_reads_all_subscriptions" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users"
  WHERE ("admin_users"."is_active" = true))));



ALTER TABLE "public"."admin_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_update_bookings" ON "public"."bookings" FOR UPDATE USING ((("auth"."jwt"() ->> 'email'::"text") IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users"
  WHERE ("admin_users"."is_active" = true))));



ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_view_all_bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users"
  WHERE ("admin_users"."email" = "auth"."email"()))));



CREATE POLICY "allow_admin_read_analytics" ON "public"."analytics_events" FOR SELECT USING (("auth"."email"() IN ( SELECT "admin_users"."email"
   FROM "public"."admin_users"
  WHERE ("admin_users"."is_active" = true))));



CREATE POLICY "allow_anon_read_company_name" ON "public"."companies" FOR SELECT USING (true);



CREATE POLICY "allow_insert_analytics" ON "public"."analytics_events" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anon_insert_subs" ON "public"."subscriptions" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "anon_insert_waitlist" ON "public"."waitlist" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."attested_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attested_jobs_admin_all" ON "public"."attested_jobs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "attested_jobs_cleaner_read_own" ON "public"."attested_jobs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."bookings" "b"
     JOIN "public"."cleaners" "cl" ON (("cl"."id" = "b"."cleaner_id")))
  WHERE (("b"."id" = "attested_jobs"."booking_id") AND ("cl"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "attested_jobs_customer_read_own" ON "public"."attested_jobs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "attested_jobs"."booking_id") AND ("b"."customer_email" = ("auth"."jwt"() ->> 'email'::"text"))))));



ALTER TABLE "public"."auth_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated_insert_messages" ON "public"."booking_messages" FOR INSERT WITH CHECK (true);



CREATE POLICY "authenticated_insert_photos" ON "public"."booking_photos" FOR INSERT WITH CHECK (true);



CREATE POLICY "authenticated_manage_own" ON "public"."booking_staff" USING ((("cleaner_id" IN ( SELECT "cleaners"."id"
   FROM "public"."cleaners"
  WHERE ("cleaners"."auth_user_id" = "auth"."uid"()))) OR ("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE ("bookings"."cleaner_id" IN ( SELECT "cleaners"."id"
           FROM "public"."cleaners"
          WHERE ("cleaners"."auth_user_id" = "auth"."uid"())))))));



CREATE POLICY "authenticated_read_admin_users" ON "public"."admin_users" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."blocked_times" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_adjustments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_checklists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_modifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_staff" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_status_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_team" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booking_team_insert" ON "public"."booking_team" FOR INSERT WITH CHECK (("invited_by" = "auth"."uid"()));



CREATE POLICY "booking_team_select" ON "public"."booking_team" FOR SELECT USING ((("cleaner_id" = "auth"."uid"()) OR ("invited_by" = "auth"."uid"())));



ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_availability_v2" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_avoid_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_booking_prefs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_customer_relations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_languages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_pet_prefs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_preferred_zones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cleaner_reads_own_booking_status" ON "public"."booking_status_log" FOR SELECT TO "authenticated" USING (("booking_id" IN ( SELECT "b"."id"
   FROM ("public"."bookings" "b"
     JOIN "public"."cleaners" "c" ON (("c"."id" = "b"."cleaner_id")))
  WHERE ("c"."auth_user_id" = "auth"."uid"()))));



ALTER TABLE "public"."cleaner_referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_service_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_zones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaners" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_owner_manage_team_prices" ON "public"."cleaner_service_prices" USING (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "c2"."company_id"
           FROM "public"."cleaners" "c2"
          WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true))))))) WITH CHECK (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "c2"."company_id"
           FROM "public"."cleaners" "c2"
          WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true)))))));



CREATE POLICY "company_owner_manage_team_staff" ON "public"."booking_staff" USING (("cleaner_id" IN ( SELECT "c"."id"
   FROM "public"."cleaners" "c"
  WHERE ("c"."company_id" IN ( SELECT "c2"."company_id"
           FROM "public"."cleaners" "c2"
          WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true)))))));



ALTER TABLE "public"."company_service_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coupon_usages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coupons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_credits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_reads_own_booking_status" ON "public"."booking_status_log" FOR SELECT TO "authenticated" USING (("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE ("bookings"."customer_email" = ("auth"."jwt"() ->> 'email'::"text")))));



CREATE POLICY "customer_reads_own_subscriptions" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING (("customer_email" = ("auth"."jwt"() ->> 'email'::"text")));



CREATE POLICY "customer_updates_own_subscriptions" ON "public"."subscriptions" FOR UPDATE TO "authenticated" USING (("customer_email" = ("auth"."jwt"() ->> 'email'::"text")));



ALTER TABLE "public"."discount_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dispute_evidence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dispute_evidence_admin_all" ON "public"."dispute_evidence" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "dispute_evidence_uploader_read" ON "public"."dispute_evidence" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."disputes" "d"
  WHERE (("d"."id" = "dispute_evidence"."dispute_id") AND ((("dispute_evidence"."uploaded_by" = 'customer'::"text") AND (EXISTS ( SELECT 1
           FROM "public"."bookings" "b"
          WHERE (("b"."id" = "d"."booking_id") AND ("b"."customer_email" = ("auth"."jwt"() ->> 'email'::"text")))))) OR (("dispute_evidence"."uploaded_by" = 'cleaner'::"text") AND (EXISTS ( SELECT 1
           FROM ("public"."bookings" "b"
             JOIN "public"."cleaners" "cl" ON (("cl"."id" = "b"."cleaner_id")))
          WHERE (("b"."id" = "d"."booking_id") AND ("cl"."auth_user_id" = "auth"."uid"()))))))))));



ALTER TABLE "public"."disputes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "disputes_admin_all" ON "public"."disputes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "disputes_cleaner_read_own" ON "public"."disputes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."bookings" "b"
     JOIN "public"."cleaners" "cl" ON (("cl"."id" = "b"."cleaner_id")))
  WHERE (("b"."id" = "disputes"."booking_id") AND ("cl"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "disputes_customer_read_own" ON "public"."disputes" FOR SELECT TO "authenticated" USING ((("opened_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "disputes"."booking_id") AND ("b"."customer_email" = ("auth"."jwt"() ->> 'email'::"text")))))));



ALTER TABLE "public"."earnings_summary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."escrow_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "escrow_events_admin_all" ON "public"."escrow_events" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "escrow_events_cleaner_read_own" ON "public"."escrow_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."bookings" "b"
     JOIN "public"."cleaners" "cl" ON (("cl"."id" = "b"."cleaner_id")))
  WHERE (("b"."id" = "escrow_events"."booking_id") AND ("cl"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "escrow_events_customer_read_own" ON "public"."escrow_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "escrow_events"."booking_id") AND ("b"."customer_email" = ("auth"."jwt"() ->> 'email'::"text"))))));



ALTER TABLE "public"."guarantee_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_points" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."magic_link_shortcodes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."matching_shadow_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "matching_shadow_log_admin_read" ON "public"."matching_shadow_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payout_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payout_attempts_service_all" ON "public"."payout_attempts" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."payout_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payout_audit_log_service_all" ON "public"."payout_audit_log" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."platform_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."processed_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_bookings_service" ON "public"."bookings" FOR SELECT TO "service_role" USING (true);



ALTER TABLE "public"."self_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_addons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_addons_admin_write" ON "public"."service_addons" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "service_addons_public_read" ON "public"."service_addons" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."service_checklists" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_role_only" ON "public"."processed_webhook_events" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services_admin_write" ON "public"."services" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "services_public_read" ON "public"."services" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."spark_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_slot_holds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."swedish_holidays" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update_bookings_service" ON "public"."bookings" FOR UPDATE TO "service_role" USING (true);



ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;


REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT ALL ON SCHEMA "public" TO "anon";
GRANT ALL ON SCHEMA "public" TO "authenticated";
GRANT ALL ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer, "p_window_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer, "p_window_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer, "p_window_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_rate_limits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."find_nearby_cleaners"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date", "booking_time" time without time zone, "booking_hours" integer, "has_pets" boolean, "has_elevator" boolean, "booking_materials" "text", "customer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."find_nearby_cleaners"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date", "booking_time" time without time zone, "booking_hours" integer, "has_pets" boolean, "has_elevator" boolean, "booking_materials" "text", "customer_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."find_nearby_cleaners_v1"("customer_lat" double precision, "customer_lng" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."find_nearby_cleaners_v1"("customer_lat" double precision, "customer_lng" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_nearby_cleaners_v1"("customer_lat" double precision, "customer_lng" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."find_nearby_providers"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date", "booking_time" time without time zone, "booking_hours" integer, "has_pets" boolean, "has_elevator" boolean, "booking_materials" "text", "customer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."find_nearby_providers"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date", "booking_time" time without time zone, "booking_hours" integer, "has_pets" boolean, "has_elevator" boolean, "booking_materials" "text", "customer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_nearby_providers"("customer_lat" double precision, "customer_lng" double precision, "booking_date" "date", "booking_time" time without time zone, "booking_hours" integer, "has_pets" boolean, "has_elevator" boolean, "booking_materials" "text", "customer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_b2b_invoice_number"() TO "service_role";
GRANT ALL ON FUNCTION "public"."generate_b2b_invoice_number"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_cleaner_calendar"("p_cleaner_id" "uuid", "p_start" "date", "p_end" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_cleaner_calendar"("p_cleaner_id" "uuid", "p_start" "date", "p_end" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_company_kpis"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_kpis"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_onboarding_status"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_onboarding_status"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_booking_event"("p_booking_id" "uuid", "p_event_type" "text", "p_actor_type" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_booking_event"("p_booking_id" "uuid", "p_event_type" "text", "p_actor_type" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_booking_event"("p_booking_id" "uuid", "p_event_type" "text", "p_actor_type" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_escrow_event"("p_booking_id" "uuid", "p_from_state" "text", "p_to_state" "text", "p_triggered_by" "text", "p_triggered_by_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_escrow_event"("p_booking_id" "uuid", "p_from_state" "text", "p_to_state" "text", "p_triggered_by" "text", "p_triggered_by_id" "uuid", "p_metadata" "jsonb") TO "service_role";



GRANT SELECT,INSERT ON TABLE "public"."activity_log" TO "anon";
GRANT SELECT,INSERT ON TABLE "public"."activity_log" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_permissions" TO "service_role";
GRANT ALL ON TABLE "public"."admin_permissions" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_roles" TO "service_role";
GRANT ALL ON TABLE "public"."admin_roles" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_users" TO "service_role";
GRANT ALL ON TABLE "public"."admin_users" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."auth_audit_log" TO "service_role";
GRANT SELECT ON TABLE "public"."auth_audit_log" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "public"."b2b_invoice_number_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."b2b_invoice_number_seq" TO "authenticated";



GRANT SELECT ON TABLE "public"."blocked_times" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."blocked_times" TO "authenticated";
GRANT ALL ON TABLE "public"."blocked_times" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."booking_checklists" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_checklists" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT SELECT ON TABLE "public"."booking_confirmation" TO "anon";
GRANT SELECT ON TABLE "public"."booking_confirmation" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_confirmation" TO "service_role";



GRANT SELECT ON TABLE "public"."booking_slots" TO "anon";
GRANT SELECT ON TABLE "public"."booking_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_slots" TO "service_role";



GRANT SELECT,INSERT ON TABLE "public"."booking_status_log" TO "anon";
GRANT SELECT,INSERT ON TABLE "public"."booking_status_log" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."calendar_connections" TO "anon";
GRANT ALL ON TABLE "public"."calendar_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_connections" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."calendar_events" TO "anon";
GRANT ALL ON TABLE "public"."calendar_events" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_events" TO "service_role";



GRANT SELECT,INSERT ON TABLE "public"."cleaner_applications" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_applications" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."cleaner_availability" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_availability" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_availability_v2" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."cleaner_availability_v2" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_availability_v2" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_avoid_types" TO "anon";
GRANT SELECT ON TABLE "public"."cleaner_avoid_types" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_avoid_types" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_blocked_dates" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_blocked_dates" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_blocked_dates" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_booking_prefs" TO "anon";
GRANT SELECT ON TABLE "public"."cleaner_booking_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_booking_prefs" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_customer_relations" TO "anon";
GRANT SELECT ON TABLE "public"."cleaner_customer_relations" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_customer_relations" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_languages" TO "anon";
GRANT SELECT ON TABLE "public"."cleaner_languages" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_languages" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_pet_prefs" TO "anon";
GRANT SELECT ON TABLE "public"."cleaner_pet_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_pet_prefs" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_preferred_zones" TO "anon";
GRANT SELECT ON TABLE "public"."cleaner_preferred_zones" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_preferred_zones" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."cleaner_service_prices" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_service_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_service_prices" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_skills" TO "anon";
GRANT SELECT ON TABLE "public"."cleaner_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_skills" TO "service_role";



GRANT SELECT ON TABLE "public"."cleaner_zones" TO "anon";
GRANT SELECT ON TABLE "public"."cleaner_zones" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_zones" TO "service_role";



GRANT ALL ON TABLE "public"."cleaners" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaners" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."commission_log" TO "anon";
GRANT ALL ON TABLE "public"."commission_log" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_log" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."company_service_prices" TO "anon";
GRANT ALL ON TABLE "public"."company_service_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."company_service_prices" TO "service_role";



GRANT SELECT ON TABLE "public"."customer_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_profiles" TO "service_role";



GRANT SELECT ON TABLE "public"."earnings_summary" TO "anon";
GRANT SELECT ON TABLE "public"."earnings_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."earnings_summary" TO "service_role";



GRANT SELECT ON TABLE "public"."emails" TO "anon";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."emails" TO "authenticated";



GRANT ALL ON TABLE "public"."guarantee_requests" TO "service_role";



GRANT SELECT ON TABLE "public"."loyalty_points" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_points" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."magic_link_shortcodes" TO "service_role";



GRANT SELECT ON TABLE "public"."matching_shadow_log" TO "authenticated";
GRANT ALL ON TABLE "public"."matching_shadow_log" TO "service_role";



GRANT SELECT,INSERT ON TABLE "public"."messages" TO "anon";
GRANT SELECT,INSERT ON TABLE "public"."messages" TO "authenticated";



GRANT SELECT ON TABLE "public"."notifications" TO "anon";
GRANT SELECT,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."payout_attempts" TO "service_role";
GRANT SELECT ON TABLE "public"."payout_attempts" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."payout_audit_log" TO "service_role";
GRANT SELECT ON TABLE "public"."payout_audit_log" TO "authenticated";



GRANT SELECT ON TABLE "public"."payout_metrics_hourly" TO "authenticated";
GRANT SELECT ON TABLE "public"."payout_metrics_hourly" TO "service_role";



GRANT SELECT ON TABLE "public"."platform_settings" TO "anon";
GRANT SELECT ON TABLE "public"."platform_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_settings" TO "service_role";



GRANT SELECT ON TABLE "public"."ratings" TO "anon";
GRANT SELECT ON TABLE "public"."ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."ratings" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."receipt_number_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."receipt_number_seq" TO "authenticated";



GRANT SELECT ON TABLE "public"."reviews" TO "anon";
GRANT SELECT ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";



GRANT SELECT ON TABLE "public"."self_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."self_invoices" TO "service_role";
GRANT SELECT ON TABLE "public"."self_invoices" TO "anon";



GRANT SELECT ON TABLE "public"."service_addons" TO "anon";
GRANT SELECT ON TABLE "public"."service_addons" TO "authenticated";
GRANT ALL ON TABLE "public"."service_addons" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."service_checklists" TO "authenticated";
GRANT ALL ON TABLE "public"."service_checklists" TO "service_role";
GRANT SELECT ON TABLE "public"."service_checklists" TO "anon";



GRANT SELECT ON TABLE "public"."services" TO "anon";
GRANT SELECT ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT SELECT ON TABLE "public"."subscription_slot_holds" TO "anon";
GRANT SELECT ON TABLE "public"."subscription_slot_holds" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_slot_holds" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";



GRANT SELECT,INSERT ON TABLE "public"."support_tickets" TO "anon";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."support_tickets" TO "authenticated";



GRANT SELECT ON TABLE "public"."swedish_holidays" TO "anon";
GRANT SELECT ON TABLE "public"."swedish_holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."swedish_holidays" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT SELECT ON TABLE "public"."v_booking_slots" TO "anon";
GRANT SELECT ON TABLE "public"."v_booking_slots" TO "authenticated";



GRANT SELECT ON TABLE "public"."v_calendar_slots" TO "anon";
GRANT SELECT ON TABLE "public"."v_calendar_slots" TO "authenticated";



GRANT SELECT ON TABLE "public"."v_cleaner_availability_expanded" TO "anon";
GRANT SELECT ON TABLE "public"."v_cleaner_availability_expanded" TO "authenticated";
GRANT ALL ON TABLE "public"."v_cleaner_availability_expanded" TO "service_role";



GRANT SELECT ON TABLE "public"."v_cleaner_availability_int" TO "anon";
GRANT SELECT ON TABLE "public"."v_cleaner_availability_int" TO "authenticated";



GRANT SELECT ON TABLE "public"."v_cleaners_for_booking" TO "anon";
GRANT SELECT ON TABLE "public"."v_cleaners_for_booking" TO "authenticated";



GRANT SELECT ON TABLE "public"."v_cleaners_public" TO "anon";
GRANT SELECT ON TABLE "public"."v_cleaners_public" TO "authenticated";



GRANT SELECT ON TABLE "public"."v_customer_bookings" TO "anon";
GRANT SELECT ON TABLE "public"."v_customer_bookings" TO "authenticated";



GRANT SELECT ON TABLE "public"."v_shadow_mode_histogram" TO "authenticated";
GRANT SELECT ON TABLE "public"."v_shadow_mode_histogram" TO "service_role";



GRANT SELECT ON TABLE "public"."v_shadow_mode_recent" TO "authenticated";
GRANT SELECT ON TABLE "public"."v_shadow_mode_recent" TO "service_role";



GRANT SELECT ON TABLE "public"."v_shadow_mode_stats" TO "authenticated";
GRANT SELECT ON TABLE "public"."v_shadow_mode_stats" TO "service_role";




