-- =========================================================
-- Fas 2 §2.1.1 — auth_audit_log retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 1077-1090
-- Beroenden: is_admin() (via Admin reads-policy)
-- Syfte: EU Platform Directive compliance (2 dec 2026)
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."auth_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "user_email" "text",
    "user_id" "uuid",
    "resource_type" "text",
    "resource_id" "uuid",
    "ip_address" "text",
    "user_agent" "text",
    "success" boolean DEFAULT true NOT NULL,
    "error_message" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auth_audit_log_event_type_check" CHECK (("event_type" = ANY (ARRAY['magic_link_generated'::"text", 'magic_link_used'::"text", 'magic_link_expired'::"text", 'magic_link_reuse_attempt'::"text", 'auth_user_created'::"text", 'auth_session_created'::"text", 'auth_session_expired'::"text", 'gdpr_export_requested'::"text", 'gdpr_deletion_requested'::"text"])))
);

ALTER TABLE "public"."auth_audit_log" OWNER TO "postgres";

COMMENT ON TABLE "public"."auth_audit_log" IS 'Audit log of all authentication events. Required for EU Platform Directive (2 dec 2026) compliance.';

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_audit_log_pkey') THEN
        ALTER TABLE ONLY "public"."auth_audit_log"
            ADD CONSTRAINT "auth_audit_log_pkey" PRIMARY KEY ("id");
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_auth_audit_email"
    ON "public"."auth_audit_log" USING "btree" ("user_email", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_auth_audit_type"
    ON "public"."auth_audit_log" USING "btree" ("event_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_auth_audit_user"
    ON "public"."auth_audit_log" USING "btree" ("user_id", "created_at" DESC)
    WHERE ("user_id" IS NOT NULL);

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."auth_audit_log" ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin reads auth_audit_log" ON "public"."auth_audit_log";
CREATE POLICY "Admin reads auth_audit_log" ON "public"."auth_audit_log"
    FOR SELECT TO "authenticated"
    USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Service role writes auth_audit_log" ON "public"."auth_audit_log";
CREATE POLICY "Service role writes auth_audit_log" ON "public"."auth_audit_log"
    TO "service_role"
    USING (true) WITH CHECK (true);

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."auth_audit_log" TO "service_role";
GRANT SELECT ON TABLE "public"."auth_audit_log" TO "authenticated";
