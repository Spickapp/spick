-- =========================================================
-- Fas 2 §2.1.1 — magic_link_shortcodes retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 2354-2366
-- Beroenden: inga (ingen FK)
-- Syfte: Short-URL codes för SMS magic-links (Fas 1.2 Unified Identity)
-- OBS: PK är på kolumnen "code" (inte "id") — följer prod
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."magic_link_shortcodes" (
    "code" "text" NOT NULL,
    "full_redirect_url" "text" NOT NULL,
    "email" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "resource_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "ip_address" "text",
    "user_agent" "text",
    "single_use" boolean DEFAULT true NOT NULL,
    CONSTRAINT "magic_link_shortcodes_scope_check" CHECK (("scope" = ANY (ARRAY['booking'::"text", 'subscription'::"text", 'dashboard'::"text", 'team_job'::"text", 'team_onboarding'::"text", 'other'::"text"])))
);

ALTER TABLE "public"."magic_link_shortcodes" OWNER TO "postgres";

COMMENT ON TABLE "public"."magic_link_shortcodes" IS 'Short-URL codes for SMS magic-links. Built for Fas 1.2 Unified Identity Architecture.';

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'magic_link_shortcodes_pkey') THEN
        ALTER TABLE ONLY "public"."magic_link_shortcodes"
            ADD CONSTRAINT "magic_link_shortcodes_pkey" PRIMARY KEY ("code");
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_shortcodes_email"
    ON "public"."magic_link_shortcodes" USING "btree" ("email");

CREATE INDEX IF NOT EXISTS "idx_shortcodes_expires"
    ON "public"."magic_link_shortcodes" USING "btree" ("expires_at")
    WHERE ("used_at" IS NULL);

CREATE INDEX IF NOT EXISTS "idx_shortcodes_resource"
    ON "public"."magic_link_shortcodes" USING "btree" ("resource_id")
    WHERE ("resource_id" IS NOT NULL);

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."magic_link_shortcodes" ENABLE ROW LEVEL SECURITY;

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."magic_link_shortcodes" TO "service_role";
