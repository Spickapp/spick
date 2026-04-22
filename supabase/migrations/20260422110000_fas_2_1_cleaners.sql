-- =========================================================
-- Fas 2 §2.1.1 — cleaners retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 1889-1977
-- Beroenden:
--   - companies (cleaners_company_id_fkey) — cirkulärt, hanteras via IF EXISTS
--   - spark_levels (cleaners_spark_level_id_fkey) — ej i §2.1.1, IF EXISTS
--   - PostGIS extension (för idx_cleaners_home_geo GIST-index)
--
-- SELF-REFERENTIAL FK: cleaners.added_by_owner_id → cleaners.id
--   (no-op idempotent — tabellen skapas före FK-tillägg)
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
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
    CONSTRAINT "chk_hourly_rate" CHECK ((("hourly_rate" >= 100) AND ("hourly_rate" <= 1000)))
);

ALTER TABLE "public"."cleaners" OWNER TO "postgres";

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaners_pkey') THEN
        ALTER TABLE ONLY "public"."cleaners"
            ADD CONSTRAINT "cleaners_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaners_auth_user_id_key') THEN
        ALTER TABLE ONLY "public"."cleaners"
            ADD CONSTRAINT "cleaners_auth_user_id_key" UNIQUE ("auth_user_id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaners_slug_key') THEN
        ALTER TABLE ONLY "public"."cleaners"
            ADD CONSTRAINT "cleaners_slug_key" UNIQUE ("slug");
    END IF;

    -- Self-referential FK — tabellen finns alltid här, inget EXISTS-check nödvändigt
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaners_added_by_owner_id_fkey') THEN
        ALTER TABLE ONLY "public"."cleaners"
            ADD CONSTRAINT "cleaners_added_by_owner_id_fkey"
            FOREIGN KEY ("added_by_owner_id") REFERENCES "public"."cleaners"("id");
    END IF;

    -- FK till companies — cirkulärt, kontrollera existens
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaners_company_id_fkey') THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'companies') THEN
            ALTER TABLE ONLY "public"."cleaners"
                ADD CONSTRAINT "cleaners_company_id_fkey"
                FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
        END IF;
    END IF;

    -- FK till spark_levels — ej i §2.1.1-scope, kontrollera existens
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaners_spark_level_id_fkey') THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'spark_levels') THEN
            ALTER TABLE ONLY "public"."cleaners"
                ADD CONSTRAINT "cleaners_spark_level_id_fkey"
                FOREIGN KEY ("spark_level_id") REFERENCES "public"."spark_levels"("id");
        END IF;
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_cleaners_approval_active"
    ON "public"."cleaners" USING "btree" ("is_approved", "is_active", "status")
    WHERE (("is_approved" = true) AND ("is_active" = true) AND ("status" = 'aktiv'::"text"));

CREATE INDEX IF NOT EXISTS "idx_cleaners_availability_schedule"
    ON "public"."cleaners" USING "gin" ("availability_schedule");

CREATE INDEX IF NOT EXISTS "idx_cleaners_company_id"
    ON "public"."cleaners" USING "btree" ("company_id");

-- PostGIS GIST-index för geografisk matching (home_lat/home_lng → geography)
-- Kräver postgis extension (installerad i prod)
CREATE INDEX IF NOT EXISTS "idx_cleaners_home_geo"
    ON "public"."cleaners" USING "gist"
    ((("public"."st_makepoint"(("home_lng")::double precision, ("home_lat")::double precision))::"public"."geography"))
    WHERE (("home_lat" IS NOT NULL) AND ("home_lng" IS NOT NULL));

CREATE INDEX IF NOT EXISTS "idx_cleaners_languages"
    ON "public"."cleaners" USING "gin" ("languages")
    WHERE ("languages" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "idx_cleaners_spark"
    ON "public"."cleaners" USING "btree" ("spark_points" DESC);

CREATE INDEX IF NOT EXISTS "idx_cleaners_specialties"
    ON "public"."cleaners" USING "gin" ("specialties")
    WHERE ("specialties" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "idx_cleaners_status_approved"
    ON "public"."cleaners" USING "btree" ("status", "is_approved");

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."cleaners" ENABLE ROW LEVEL SECURITY;

-- ── Grants ───────────────────────────────────────────────
GRANT ALL ON TABLE "public"."cleaners" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaners" TO "service_role";
