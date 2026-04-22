-- =========================================================
-- Fas 2 §2.1.1 — service_checklists retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql (pg_dump 2026-04-22 07:42) rad 2645-2652
-- Beroenden: companies (via service_checklists_company_id_fkey)
--            is_admin() (via Admin-policy)
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."service_checklists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_type" "text" NOT NULL,
    "company_id" "uuid",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."service_checklists" OWNER TO "postgres";

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_checklists_pkey') THEN
        ALTER TABLE ONLY "public"."service_checklists"
            ADD CONSTRAINT "service_checklists_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_checklists_service_type_company_id_key') THEN
        ALTER TABLE ONLY "public"."service_checklists"
            ADD CONSTRAINT "service_checklists_service_type_company_id_key" UNIQUE ("service_type", "company_id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_checklists_company_id_fkey') THEN
        ALTER TABLE ONLY "public"."service_checklists"
            ADD CONSTRAINT "service_checklists_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
    END IF;
END $$;

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."service_checklists" ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin manages all service_checklists" ON "public"."service_checklists";
CREATE POLICY "Admin manages all service_checklists" ON "public"."service_checklists"
    TO "authenticated"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Public read service_checklists" ON "public"."service_checklists";
CREATE POLICY "Public read service_checklists" ON "public"."service_checklists"
    FOR SELECT TO "authenticated", "anon"
    USING (true);

DROP POLICY IF EXISTS "Service role manages service_checklists" ON "public"."service_checklists";
CREATE POLICY "Service role manages service_checklists" ON "public"."service_checklists"
    TO "service_role"
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "VD manages own company service_checklists" ON "public"."service_checklists";
CREATE POLICY "VD manages own company service_checklists" ON "public"."service_checklists"
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
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."service_checklists" TO "authenticated";
GRANT ALL ON TABLE "public"."service_checklists" TO "service_role";
GRANT SELECT ON TABLE "public"."service_checklists" TO "anon";
