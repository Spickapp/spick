-- =========================================================
-- Fas 2 §2.1.1 — company_service_prices retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 2133-2141
-- Beroenden: companies (company_service_prices_company_id_fkey ON DELETE CASCADE)
-- Pricing-lager 1: företagspris per service_type (use_company_pricing)
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
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

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_service_prices_pkey') THEN
        ALTER TABLE ONLY "public"."company_service_prices"
            ADD CONSTRAINT "company_service_prices_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_service_prices_company_id_service_type_key') THEN
        ALTER TABLE ONLY "public"."company_service_prices"
            ADD CONSTRAINT "company_service_prices_company_id_service_type_key" UNIQUE ("company_id", "service_type");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_service_prices_company_id_fkey') THEN
        ALTER TABLE ONLY "public"."company_service_prices"
            ADD CONSTRAINT "company_service_prices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_company_svc_prices"
    ON "public"."company_service_prices" USING "btree" ("company_id", "service_type");

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."company_service_prices" ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin manages all company prices" ON "public"."company_service_prices";
CREATE POLICY "Admin manages all company prices" ON "public"."company_service_prices"
    TO "authenticated"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Public read company_service_prices — intentional" ON "public"."company_service_prices";
CREATE POLICY "Public read company_service_prices — intentional" ON "public"."company_service_prices"
    FOR SELECT TO "authenticated", "anon"
    USING (true);

DROP POLICY IF EXISTS "Service role manages company_service_prices" ON "public"."company_service_prices";
CREATE POLICY "Service role manages company_service_prices" ON "public"."company_service_prices"
    TO "service_role"
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "VD manages own company prices" ON "public"."company_service_prices";
CREATE POLICY "VD manages own company prices" ON "public"."company_service_prices"
    TO "authenticated"
    USING (("company_id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )))
    WITH CHECK (("company_id" IN (
        SELECT "cleaners"."company_id"
        FROM "public"."cleaners"
        WHERE (("cleaners"."auth_user_id" = "auth"."uid"()) AND ("cleaners"."is_company_owner" = true))
    )));

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT, MAINTAIN ON TABLE "public"."company_service_prices" TO "anon";
GRANT ALL ON TABLE "public"."company_service_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."company_service_prices" TO "service_role";
