-- =========================================================
-- Fas 2 §2.1.1 — Bootstrap dependencies för db reset
-- =========================================================
-- Primärkälla: prod-schema.sql
--
-- SCOPE: Alla beroenden som krävs för att db reset --local ska
-- kunna applicera alla 100 migrations från scratch.
--
-- Upptäckt via iterativ db reset: varje failande migration
-- pekar på saknade dependencies som audit 2026-04-22 missade.
--
-- FILNAMN-PREFIX: 00000_* (lägsta serie).
-- Sortering: 00000 < 00001 < 001 < 20260422...
--
-- Innehåll:
-- 1. PostGIS extension (för st_makepoint GIST-index i cleaners)
-- 2. admin_users (krävs av is_admin-function)
-- 3. spark_levels (FK från cleaners.spark_level_id)
-- 4. subscriptions (FK från bookings.subscription_id)
-- 5. is_admin() function (används av ~25 policies i §2.1.1)
-- 6. is_company_owner_of(uuid) function (används av företags-policies)
-- =========================================================

-- ═══════════════════════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "postgis" SCHEMA "public";

-- ═══════════════════════════════════════════════════════════
-- BOOTSTRAP TABLES
-- ═══════════════════════════════════════════════════════════

-- ── admin_users ─────────────────────────────────────────
-- Krävs av is_admin() function.
-- Primärkälla: prod-schema.sql rad 1050-1055
CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "role_id" "uuid",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."admin_users" OWNER TO "postgres";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_pkey') THEN
        ALTER TABLE ONLY "public"."admin_users"
            ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_email_key') THEN
        ALTER TABLE ONLY "public"."admin_users"
            ADD CONSTRAINT "admin_users_email_key" UNIQUE ("email");
    END IF;
END $$;

-- ── spark_levels ────────────────────────────────────────
-- FK från cleaners.spark_level_id.
-- Primärkälla: prod-schema.sql rad 2681-2689
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

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spark_levels_pkey') THEN
        ALTER TABLE ONLY "public"."spark_levels"
            ADD CONSTRAINT "spark_levels_pkey" PRIMARY KEY ("id");
    END IF;
END $$;

-- ── subscriptions ───────────────────────────────────────
-- FK från bookings.subscription_id.
-- Primärkälla: prod-schema.sql rad 2712-2761
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
    CONSTRAINT "subscriptions_frequency_check" CHECK (("frequency" = ANY (ARRAY['weekly'::"text", 'biweekly'::"text", 'monthly'::"text"]))),
    CONSTRAINT "subscriptions_preferred_day_check" CHECK ((("preferred_day" >= 0) AND ("preferred_day" <= 6))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'cancelled'::"text"])))
);

ALTER TABLE "public"."subscriptions" OWNER TO "postgres";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_pkey') THEN
        ALTER TABLE ONLY "public"."subscriptions"
            ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- BOOTSTRAP FUNCTIONS
-- ═══════════════════════════════════════════════════════════

-- ── is_admin() ──────────────────────────────────────────
-- Använd av ~25 policies i §2.1.1-migrations.
-- Primärkälla: prod-schema.sql rad 671-677
CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.jwt()->>'email'
  );
$$;

ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";

-- ── is_company_owner_of(uuid) ───────────────────────────
-- Använd av cleaners- och service_checklists-policies.
-- Primärkälla: prod-schema.sql rad 683-691
--
-- ÄNDRAT FRÅN PROD: LANGUAGE plpgsql istället för sql.
-- Skäl: sql-funktioner parsar body inline vid CREATE, vilket failar
-- när companies/cleaners inte finns än. plpgsql har sen binding.
-- Funktionellt identisk. Senare sprint kan uppgradera prod.
CREATE OR REPLACE FUNCTION "public"."is_company_owner_of"("target_company_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM companies
        JOIN cleaners ON cleaners.id = companies.owner_cleaner_id
        WHERE companies.id = target_company_id
        AND cleaners.auth_user_id = auth.uid()
    );
END;
$$;

ALTER FUNCTION "public"."is_company_owner_of"("target_company_id" "uuid") OWNER TO "postgres";

-- =========================================================
-- Slut bootstrap dependencies
-- =========================================================
