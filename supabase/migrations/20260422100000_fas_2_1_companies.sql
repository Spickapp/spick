-- =========================================================
-- Fas 2 §2.1.1 — companies retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 2044-2078
-- Beroenden: cleaners (companies_owner_cleaner_id_fkey)
--
-- OBS: Cirkulärt FK-beroende med cleaners-tabellen:
--   - companies.owner_cleaner_id → cleaners.id
--   - cleaners.company_id → companies.id (definierad i cleaners-migration)
-- I prod existerar båda tabeller och alla FKs finns. För replay-från-
-- scratch måste cleaners-migrationen köras före companies FK-delen,
-- eller så hoppas FK-tillägget vid första körning och körs senare.
-- Denna migration använder DO $$ / IF NOT EXISTS så FK-tillägget är
-- idempotent och kan köras i vilken ordning som helst om tabellerna finns.
--
-- commission_rate DEFAULT 0.17: äldre värde, används INTE i kod.
-- platform_settings.commission_standard=12 (0.12) är single source of truth.
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
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

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_pkey') THEN
        ALTER TABLE ONLY "public"."companies"
            ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_org_number_key') THEN
        ALTER TABLE ONLY "public"."companies"
            ADD CONSTRAINT "companies_org_number_key" UNIQUE ("org_number");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_slug_key') THEN
        ALTER TABLE ONLY "public"."companies"
            ADD CONSTRAINT "companies_slug_key" UNIQUE ("slug");
    END IF;

    -- FK till cleaners (cirkulärt beroende — se kommentar i filhuvud)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_owner_cleaner_id_fkey') THEN
        -- Kontrollera att cleaners-tabellen finns innan vi försöker skapa FK
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'cleaners') THEN
            ALTER TABLE ONLY "public"."companies"
                ADD CONSTRAINT "companies_owner_cleaner_id_fkey"
                FOREIGN KEY ("owner_cleaner_id") REFERENCES "public"."cleaners"("id");
        END IF;
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_companies_owner"
    ON "public"."companies" USING "btree" ("owner_cleaner_id");

CREATE INDEX IF NOT EXISTS "idx_companies_trust_level"
    ON "public"."companies" USING "btree" ("payment_trust_level");

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin SELECT companies" ON "public"."companies";
CREATE POLICY "Admin SELECT companies" ON "public"."companies"
    FOR SELECT TO "authenticated"
    USING ((("auth"."jwt"() ->> 'email'::"text") IN (
        SELECT "admin_users"."email"
        FROM "public"."admin_users"
    )));

DROP POLICY IF EXISTS "Admin updates all companies" ON "public"."companies";
CREATE POLICY "Admin updates all companies" ON "public"."companies"
    FOR UPDATE TO "authenticated"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Allow insert companies" ON "public"."companies";
CREATE POLICY "Allow insert companies" ON "public"."companies"
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Company owner can read own company" ON "public"."companies";
CREATE POLICY "Company owner can read own company" ON "public"."companies"
    FOR SELECT
    USING (("owner_cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Company owner can update own company" ON "public"."companies";
CREATE POLICY "Company owner can update own company" ON "public"."companies"
    FOR UPDATE
    USING (("owner_cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Service role full access" ON "public"."companies";
CREATE POLICY "Service role full access" ON "public"."companies"
    USING (("auth"."role"() = 'service_role'::"text"));

DROP POLICY IF EXISTS "VD updates own company" ON "public"."companies";
CREATE POLICY "VD updates own company" ON "public"."companies"
    FOR UPDATE TO "authenticated"
    USING (("id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )))
    WITH CHECK (("id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )));

DROP POLICY IF EXISTS "allow_anon_read_company_name" ON "public"."companies";
CREATE POLICY "allow_anon_read_company_name" ON "public"."companies"
    FOR SELECT
    USING (true);

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";
