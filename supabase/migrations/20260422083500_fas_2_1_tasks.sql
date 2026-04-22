-- =========================================================
-- Fas 2 §2.1.1 — tasks retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 2813-2827
-- Beroenden: cleaners (3 FKs: assigned_to, created_by + 1 via company),
--            companies (company_id), bookings (related_booking_id)
-- is_admin() (Admin-policy)
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "assigned_to" "uuid",
    "created_by" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "deadline" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "related_booking_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'done'::"text", 'cancelled'::"text"])))
);

ALTER TABLE "public"."tasks" OWNER TO "postgres";

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_pkey') THEN
        ALTER TABLE ONLY "public"."tasks"
            ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assigned_to_fkey') THEN
        ALTER TABLE ONLY "public"."tasks"
            ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_company_id_fkey') THEN
        ALTER TABLE ONLY "public"."tasks"
            ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_created_by_fkey') THEN
        ALTER TABLE ONLY "public"."tasks"
            ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."cleaners"("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_related_booking_id_fkey') THEN
        ALTER TABLE ONLY "public"."tasks"
            ADD CONSTRAINT "tasks_related_booking_id_fkey" FOREIGN KEY ("related_booking_id") REFERENCES "public"."bookings"("id");
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_tasks_assigned"
    ON "public"."tasks" USING "btree" ("assigned_to", "status");

CREATE INDEX IF NOT EXISTS "idx_tasks_company"
    ON "public"."tasks" USING "btree" ("company_id", "status");

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin manages all tasks" ON "public"."tasks";
CREATE POLICY "Admin manages all tasks" ON "public"."tasks"
    TO "authenticated"
    USING ("public"."is_admin"())
    WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Cleaner manages own tasks" ON "public"."tasks";
CREATE POLICY "Cleaner manages own tasks" ON "public"."tasks"
    TO "authenticated"
    USING ((
        ("assigned_to" IN (
            SELECT "cleaners"."id"
            FROM "public"."cleaners"
            WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
        ))
        OR
        ("created_by" IN (
            SELECT "cleaners"."id"
            FROM "public"."cleaners"
            WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
        ))
    ))
    WITH CHECK ((
        ("assigned_to" IN (
            SELECT "cleaners"."id"
            FROM "public"."cleaners"
            WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
        ))
        OR
        ("created_by" IN (
            SELECT "cleaners"."id"
            FROM "public"."cleaners"
            WHERE ("cleaners"."auth_user_id" = "auth"."uid"())
        ))
    ));

DROP POLICY IF EXISTS "Service role manages tasks" ON "public"."tasks";
CREATE POLICY "Service role manages tasks" ON "public"."tasks"
    TO "service_role"
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "VD manages team tasks" ON "public"."tasks";
CREATE POLICY "VD manages team tasks" ON "public"."tasks"
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
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";
