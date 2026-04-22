-- =========================================================
-- Fas 2 §2.1.1 — waitlist retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 3084-3088
-- Beroenden: admin_users (via admin_read_waitlist-policy)
-- Använd av: 33 landningssidor för staden-launch-waitlist
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city" "text" NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."waitlist" OWNER TO "postgres";

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_pkey') THEN
        ALTER TABLE ONLY "public"."waitlist"
            ADD CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id");
    END IF;
END $$;

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;

