-- =========================================================
-- Fas 2 §2.1.1 — customer_profiles retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql (pg_dump 2026-04-22 07:42)
-- Tabell existerar redan i prod. Denna migration är retroaktiv
-- dokumentation så att schema_migrations matchar repo-state.
--
-- Idempotent:
-- - CREATE TABLE IF NOT EXISTS (no-op om finns)
-- - ALTER TABLE ADD CONSTRAINT IF NOT EXISTS
-- - CREATE INDEX IF NOT EXISTS
-- - DROP POLICY IF EXISTS + CREATE POLICY (PG 17 har ej IF NOT EXISTS på policies)
-- - GRANT (idempotent i Postgres)
--
-- Beroenden:
-- - auth.users (Supabase-managerad, alltid finns)
-- - admin_users (använd av policies, CREATE TABLE för denna följer i separat migration)
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
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
    "payment_method_exp_year" integer
);

ALTER TABLE "public"."customer_profiles" OWNER TO "postgres";

-- ── Kommentarer ──────────────────────────────────────────
COMMENT ON COLUMN "public"."customer_profiles"."auto_delegation_enabled"
    IS 'Kundens default för nya bokningar. Om TRUE kryssas rutan i förväg på boka.html.';
COMMENT ON COLUMN "public"."customer_profiles"."stripe_customer_id"
    IS 'Stripe Customer ID — skapas vid subscription setup';
COMMENT ON COLUMN "public"."customer_profiles"."default_payment_method_id"
    IS 'Stripe PaymentMethod ID för off-session charges';
COMMENT ON COLUMN "public"."customer_profiles"."payment_method_last4"
    IS 'Sista 4 siffror på kortet (för UI: •••• 4242)';

-- ── Constraints ──────────────────────────────────────────
DO $$
BEGIN
    -- PRIMARY KEY
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customer_profiles_pkey'
    ) THEN
        ALTER TABLE ONLY "public"."customer_profiles"
            ADD CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id");
    END IF;

    -- UNIQUE auth_user_id
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customer_profiles_auth_user_id_key'
    ) THEN
        ALTER TABLE ONLY "public"."customer_profiles"
            ADD CONSTRAINT "customer_profiles_auth_user_id_key" UNIQUE ("auth_user_id");
    END IF;

    -- UNIQUE email
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customer_profiles_email_key'
    ) THEN
        ALTER TABLE ONLY "public"."customer_profiles"
            ADD CONSTRAINT "customer_profiles_email_key" UNIQUE ("email");
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_customer_profiles_stripe_customer"
    ON "public"."customer_profiles" USING "btree" ("stripe_customer_id")
    WHERE ("stripe_customer_id" IS NOT NULL);

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."customer_profiles" ENABLE ROW LEVEL SECURITY;

-- ── Grants ────────────────────────────────────────────────
GRANT SELECT ON TABLE "public"."customer_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_profiles" TO "service_role";

-- =========================================================
-- Slut customer_profiles
-- =========================================================
