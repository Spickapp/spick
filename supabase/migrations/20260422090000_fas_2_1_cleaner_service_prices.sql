-- =========================================================
-- Fas 2 §2.1.1 — cleaner_service_prices retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 1856-1862
-- Beroenden: cleaners (cleaner_service_prices_cleaner_id_fkey)
-- Pricing-lager 2a: individuell cleaner-pris per service_type
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."cleaner_service_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid",
    "service_type" "text" NOT NULL,
    "price_type" "text" DEFAULT 'hourly'::"text",
    "price" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."cleaner_service_prices" OWNER TO "postgres";

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaner_service_prices_pkey') THEN
        ALTER TABLE ONLY "public"."cleaner_service_prices"
            ADD CONSTRAINT "cleaner_service_prices_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaner_service_prices_cleaner_id_service_type_key') THEN
        ALTER TABLE ONLY "public"."cleaner_service_prices"
            ADD CONSTRAINT "cleaner_service_prices_cleaner_id_service_type_key" UNIQUE ("cleaner_id", "service_type");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaner_service_prices_cleaner_id_fkey') THEN
        ALTER TABLE ONLY "public"."cleaner_service_prices"
            ADD CONSTRAINT "cleaner_service_prices_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");
    END IF;
END $$;

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."cleaner_service_prices" ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin SELECT cleaner service prices" ON "public"."cleaner_service_prices";
CREATE POLICY "Admin SELECT cleaner service prices" ON "public"."cleaner_service_prices"
    FOR SELECT TO "authenticated"
    USING ((("auth"."jwt"() ->> 'email'::"text") IN (
        SELECT "admin_users"."email"
        FROM "public"."admin_users"
    )));

DROP POLICY IF EXISTS "Admin can manage service prices" ON "public"."cleaner_service_prices";
CREATE POLICY "Admin can manage service prices" ON "public"."cleaner_service_prices"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Anon can read prices" ON "public"."cleaner_service_prices";
CREATE POLICY "Anon can read prices" ON "public"."cleaner_service_prices"
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Authenticated can manage own prices" ON "public"."cleaner_service_prices";
CREATE POLICY "Authenticated can manage own prices" ON "public"."cleaner_service_prices"
    TO "authenticated"
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )))
    WITH CHECK (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "company_owner_manage_team_prices" ON "public"."cleaner_service_prices";
CREATE POLICY "company_owner_manage_team_prices" ON "public"."cleaner_service_prices"
    USING (("cleaner_id" IN (
        SELECT "c"."id"
        FROM "public"."cleaners" "c"
        WHERE ("c"."company_id" IN (
            SELECT "c2"."company_id"
            FROM "public"."cleaners" "c2"
            WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true))
        ))
    )))
    WITH CHECK (("cleaner_id" IN (
        SELECT "c"."id"
        FROM "public"."cleaners" "c"
        WHERE ("c"."company_id" IN (
            SELECT "c2"."company_id"
            FROM "public"."cleaners" "c2"
            WHERE (("c2"."auth_user_id" = "auth"."uid"()) AND ("c2"."is_company_owner" = true))
        ))
    )));

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."cleaner_service_prices" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_service_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_service_prices" TO "service_role";
