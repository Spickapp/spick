-- =========================================================
-- Fas 2 §2.1.1 — cleaner_applications (bootstrap retroaktiv)
-- =========================================================
-- Primärkälla: prod-schema.sql rad 1646-1689
--
-- FILNAMN-PREFIX: 00001_* = bootstrap-serie.
-- Kommer före 001_push.sql i alfabetisk sortering så att
-- 'supabase db reset' kan applicera ALTER TABLE-satser i 001+.
--
-- Upptäckt: 2026-04-22 via db reset-försök (schema-drift-audit missade).
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."cleaner_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text",
    "first_name" "text",
    "last_name" "text",
    "email" "text",
    "phone" "text",
    "city" "text",
    "bio" "text",
    "hourly_rate" integer DEFAULT 350,
    "services" "jsonb" DEFAULT '[]'::"jsonb",
    "service_radius_km" integer DEFAULT 10,
    "status" "text" DEFAULT 'pending'::"text",
    "marketing_consent" boolean DEFAULT false,
    "gdpr_consent" boolean DEFAULT false,
    "gdpr_consent_at" timestamp with time zone,
    "fskatt_confirmed" boolean DEFAULT false,
    "onboarding_phase" "text" DEFAULT 'applied'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "home_lat" double precision,
    "home_lng" double precision,
    "home_address" "text",
    "approved_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "reviewed_by" "text",
    "is_company" boolean DEFAULT false,
    "company_name" "text",
    "org_number" "text",
    "team_size" integer,
    "test_score" integer,
    "test_completed_at" timestamp with time zone,
    "test_answers" "jsonb",
    "fskatt_needs_help" boolean DEFAULT false,
    "invited_by_company_id" "uuid",
    "languages" "text"[],
    "experience" "text",
    "owner_only" boolean DEFAULT false,
    "pet_pref" "text" DEFAULT 'ok'::"text",
    "invited_via_magic_code" "text",
    "invited_phone" "text",
    "bankid_verified_at" timestamp with time zone,
    "bankid_personnummer_hash" "text"
);

ALTER TABLE "public"."cleaner_applications" OWNER TO "postgres";

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaner_applications_pkey') THEN
        ALTER TABLE ONLY "public"."cleaner_applications"
            ADD CONSTRAINT "cleaner_applications_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cleaner_applications_email_unique') THEN
        ALTER TABLE ONLY "public"."cleaner_applications"
            ADD CONSTRAINT "cleaner_applications_email_unique" UNIQUE ("email");
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_cleaner_applications_invited_created"
    ON "public"."cleaner_applications" USING "btree" ("created_at")
    WHERE ("status" = 'invited'::"text");

CREATE INDEX IF NOT EXISTS "idx_cleaner_applications_magic_code"
    ON "public"."cleaner_applications" USING "btree" ("invited_via_magic_code")
    WHERE ("invited_via_magic_code" IS NOT NULL);

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."cleaner_applications" ENABLE ROW LEVEL SECURITY;

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT, INSERT ON TABLE "public"."cleaner_applications" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_applications" TO "service_role";
