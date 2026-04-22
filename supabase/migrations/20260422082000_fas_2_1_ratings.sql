-- =========================================================
-- Fas 2 §2.1.1 — ratings retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 2519-2535
-- Beroenden: cleaners (via ratings_cleaner_id_fkey)
-- OBS: ratings.job_id kolumn finns men har INGEN FK (jobs-tabell
-- raderad 2026-04-22 i §3.2c). UNIQUE-constraint på job_id kvar.
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
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

-- ── Constraints (PK + UNIQUE + FK; CHECK redan inline i CREATE TABLE) ──
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ratings_pkey') THEN
        ALTER TABLE ONLY "public"."ratings"
            ADD CONSTRAINT "ratings_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ratings_job_id_unique') THEN
        ALTER TABLE ONLY "public"."ratings"
            ADD CONSTRAINT "ratings_job_id_unique" UNIQUE ("job_id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ratings_cleaner_id_fkey') THEN
        ALTER TABLE ONLY "public"."ratings"
            ADD CONSTRAINT "ratings_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_ratings_cleaner" ON "public"."ratings" USING "btree" ("cleaner_id");

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."ratings" ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow insert ratings" ON "public"."ratings";
CREATE POLICY "Allow insert ratings" ON "public"."ratings"
    FOR INSERT TO "authenticated", "anon"
    WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can read ratings" ON "public"."ratings";
CREATE POLICY "Anon can read ratings" ON "public"."ratings"
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Cleaner sees own ratings" ON "public"."ratings";
CREATE POLICY "Cleaner sees own ratings" ON "public"."ratings"
    FOR SELECT
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT ON TABLE "public"."ratings" TO "anon";
GRANT SELECT ON TABLE "public"."ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."ratings" TO "service_role";

-- =========================================================
-- TODO §2.1.2: 2 triggers hanteras separat
-- - trg_sync_review_stats (AFTER INSERT/DELETE/UPDATE) → sync_cleaner_review_stats()
-- - trg_update_cleaner_rating (AFTER INSERT) → update_cleaner_rating()
-- =========================================================
