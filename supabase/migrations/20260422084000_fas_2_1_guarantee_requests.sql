-- =========================================================
-- Fas 2 §2.1.1 — guarantee_requests retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 2321-2333
-- Beroenden: bookings (guarantee_requests_booking_id_fkey)
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."guarantee_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "booking_id" "uuid",
    "rating_id" "uuid",
    "customer_name" "text",
    "customer_email" "text",
    "cleaner_name" "text",
    "issue_description" "text",
    "status" "text" DEFAULT 'ny'::"text",
    "resolved_at" timestamp with time zone,
    "resolution" "text",
    "admin_notes" "text"
);

ALTER TABLE "public"."guarantee_requests" OWNER TO "postgres";

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guarantee_requests_pkey') THEN
        ALTER TABLE ONLY "public"."guarantee_requests"
            ADD CONSTRAINT "guarantee_requests_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guarantee_requests_booking_id_fkey') THEN
        ALTER TABLE ONLY "public"."guarantee_requests"
            ADD CONSTRAINT "guarantee_requests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");
    END IF;
END $$;

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."guarantee_requests" ENABLE ROW LEVEL SECURITY;

-- ── Grants ───────────────────────────────────────────────
GRANT ALL ON TABLE "public"."guarantee_requests" TO "service_role";
