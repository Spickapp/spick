-- =============================================================
-- Fas 2.X iter 31 (2026-04-22): Admin-tabeller bootstrap
-- =============================================================
-- Skapar admin-infrastruktur som prod har men som inte fanns i
-- någon kvarvarande migration (ursprungligen i arkiverad
-- 20260331000001_admin_portal.sql).
--
-- Primärkälla: prod-schema.sql (dumpad 2026-04-22 07:42)
-- Tabeller:    rad 1029-1048 (admin_audit_log, admin_permissions,
--              admin_roles)
--              rad 2581 (role_permissions)
--              rad 1949-1965 (support_tickets)
-- Constraints: rad 3109-3139, 3549, 3609
-- Index:       rad 3644, 3648
-- FKs:         rad 4077, 4347, 4352
-- =============================================================

-- ── admin_roles ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."admin_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "level" integer DEFAULT 0 NOT NULL,
    "description" "text"
);

ALTER TABLE "public"."admin_roles" OWNER TO "postgres";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_roles_pkey') THEN
        ALTER TABLE ONLY "public"."admin_roles"
            ADD CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_roles_name_key') THEN
        ALTER TABLE ONLY "public"."admin_roles"
            ADD CONSTRAINT "admin_roles_name_key" UNIQUE ("name");
    END IF;
END $$;

-- ── admin_permissions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."admin_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource" "text" NOT NULL,
    "action" "text" NOT NULL
);

ALTER TABLE "public"."admin_permissions" OWNER TO "postgres";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_permissions_pkey') THEN
        ALTER TABLE ONLY "public"."admin_permissions"
            ADD CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_permissions_resource_action_key') THEN
        ALTER TABLE ONLY "public"."admin_permissions"
            ADD CONSTRAINT "admin_permissions_resource_action_key" UNIQUE ("resource", "action");
    END IF;
END $$;

-- ── role_permissions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL
);

ALTER TABLE "public"."role_permissions" OWNER TO "postgres";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_pkey') THEN
        ALTER TABLE ONLY "public"."role_permissions"
            ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_role_id_fkey') THEN
        ALTER TABLE ONLY "public"."role_permissions"
            ADD CONSTRAINT "role_permissions_role_id_fkey"
            FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_permission_id_fkey') THEN
        ALTER TABLE ONLY "public"."role_permissions"
            ADD CONSTRAINT "role_permissions_permission_id_fkey"
            FOREIGN KEY ("permission_id") REFERENCES "public"."admin_permissions"("id");
    END IF;
END $$;

-- ── admin_audit_log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "admin_email" "text",
    "old_value" "jsonb",
    "new_value" "jsonb",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "admin_role" "text"
);

ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_audit_log_pkey') THEN
        ALTER TABLE ONLY "public"."admin_audit_log"
            ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_audit_created"
    ON "public"."admin_audit_log" USING "btree" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_audit_resource"
    ON "public"."admin_audit_log" USING "btree" ("resource_type", "resource_id");

-- ── support_tickets ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" DEFAULT 'question'::"text",
    "subject" "text",
    "message" "text",
    "customer_email" "text",
    "customer_name" "text",
    "booking_id" "uuid",
    "cleaner_id" "uuid",
    "status" "text" DEFAULT 'open'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "resolved_by" "text",
    "notes" "text"
);

ALTER TABLE "public"."support_tickets" OWNER TO "postgres";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_pkey') THEN
        ALTER TABLE ONLY "public"."support_tickets"
            ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");
    END IF;
END $$;

-- ── admin_users FK till admin_roles ────────────────────────
-- Kan inte göras i 00000 eftersom admin_roles finns först här
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_role_id_fkey') THEN
        ALTER TABLE ONLY "public"."admin_users"
            ADD CONSTRAINT "admin_users_role_id_fkey"
            FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id");
    END IF;
END $$;
