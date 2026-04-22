-- =========================================================
-- Fas 2 §2.1.1 — notifications retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 2394-2403
-- Beroenden: cleaners (notifications_cleaner_id_fkey ON DELETE CASCADE)
-- OBS: notifications.job_id kolumn finns men har INGEN FK
-- (jobs-tabell raderad 2026-04-22 i §3.2c). Kolumnen nullställd för
-- historisk data (39 rader via §48 Fas 48.3 deploy).
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
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

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_pkey') THEN
        ALTER TABLE ONLY "public"."notifications"
            ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_cleaner_id_fkey') THEN
        ALTER TABLE ONLY "public"."notifications"
            ADD CONSTRAINT "notifications_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_notif_cleaner"
    ON "public"."notifications" USING "btree" ("cleaner_id", "read");

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Auth updates notifications" ON "public"."notifications";
CREATE POLICY "Auth updates notifications" ON "public"."notifications"
    FOR UPDATE
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Cleaner sees own notifications" ON "public"."notifications";
CREATE POLICY "Cleaner sees own notifications" ON "public"."notifications"
    USING (("cleaner_id" IN (
        SELECT "cleaners"."id"
        FROM "public"."cleaners"
        WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
    )));

DROP POLICY IF EXISTS "Read own notifications" ON "public"."notifications";
CREATE POLICY "Read own notifications" ON "public"."notifications"
    FOR SELECT TO "authenticated"
    USING (("cleaner_id" = "auth"."uid"()));

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT ON TABLE "public"."notifications" TO "anon";
GRANT SELECT, UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";
