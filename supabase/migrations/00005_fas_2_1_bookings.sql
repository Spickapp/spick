-- =========================================================
-- Fas 2 §2.1.1 — bookings retroaktiv migration (största tabellen)
-- =========================================================
-- Primärkälla: prod-schema.sql rad 1167-1289
-- Beroenden:
--   - cleaners (4 FKs: cleaner_id, payment_marked_by,
--     reassignment_proposed_by, reassignment_proposed_cleaner_id)
--   - subscriptions (subscription_id)
--   - admin_users (via policies)
--   - is_admin() (via policies)
--
-- Sista av 15 KRITISKA tabeller i §2.1.1 (från drift-audit 2026-04-22).
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "text",
    "customer_name" "text" NOT NULL,
    "customer_email" "text",
    "customer_phone" "text",
    "customer_address" "text",
    "customer_pnr_hash" "text",
    "cleaner_id" "uuid",
    "cleaner_name" "text",
    "service_type" "text" DEFAULT 'hemstadning'::"text",
    "frequency" "text" DEFAULT 'one_time'::"text",
    "booking_date" "date" NOT NULL,
    "booking_time" time without time zone NOT NULL,
    "booking_hours" numeric(3,1) DEFAULT 2.5,
    "square_meters" integer,
    "has_pets" boolean DEFAULT false,
    "has_materials" boolean DEFAULT false,
    "extra_services" "text"[],
    "notes" "text",
    "total_price" integer NOT NULL,
    "rut_amount" integer DEFAULT 0,
    "payment_status" "text" DEFAULT 'pending'::"text",
    "payment_method" "text",
    "referral_code" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "portal_job_id" "uuid",
    "portal_customer_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "refund_amount" integer,
    "refund_percent" integer,
    "payment_intent_id" "text",
    "base_price_per_hour" numeric,
    "customer_price_per_hour" numeric,
    "cleaner_price_per_hour" numeric,
    "commission_pct" numeric,
    "discount_pct" numeric DEFAULT 0,
    "discount_code" "text",
    "spick_gross_sek" numeric,
    "spick_net_sek" numeric,
    "net_margin_pct" numeric,
    "stripe_fee_sek" numeric,
    "credit_applied_sek" numeric DEFAULT 0,
    "customer_pnr" "text",
    "stripe_session_id" "text",
    "confirmed_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "rejection_reason" "text",
    "key_type" "text",
    "key_info" "text",
    "payout_status" "text",
    "payout_date" timestamp with time zone,
    "checkin_lat" double precision,
    "checkin_lng" double precision,
    "checkin_accuracy_m" integer,
    "checkin_distance_m" integer,
    "checkin_gps_status" "text" DEFAULT 'unknown'::"text",
    "checkout_lat" double precision,
    "checkout_lng" double precision,
    "checkout_accuracy_m" integer,
    "checkout_distance_m" integer,
    "checkout_gps_status" "text" DEFAULT 'unknown'::"text",
    "customer_type" "text" DEFAULT 'privat'::"text",
    "business_name" "text",
    "business_org_number" "text",
    "business_reference" "text",
    "checkin_time" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "admin_notes" "text",
    "checkout_time" timestamp with time zone,
    "actual_hours" numeric,
    "attest_status" "text" DEFAULT 'pending'::"text",
    "attested_by" "uuid",
    "attested_at" timestamp with time zone,
    "receipt_number" "text",
    "receipt_url" "text",
    "customer_company_name" "text",
    "customer_org_number" "text",
    "reassignment_proposed_cleaner_id" "uuid",
    "reassignment_proposed_at" timestamp with time zone,
    "reassignment_proposed_by" "uuid",
    "reassignment_attempts" integer DEFAULT 0,
    "auto_delegation_enabled" boolean,
    "reminders_sent" "text"[] DEFAULT '{}'::"text"[],
    "payment_mode" "text" DEFAULT 'stripe_checkout'::"text",
    "payment_marked_at" timestamp with time zone,
    "payment_marked_by" "uuid",
    "payment_due_date" "date",
    "subscription_id" "uuid",
    "manual_override_price" integer,
    "stripe_payment_intent_id" "text",
    "subscription_charge_attempts" integer DEFAULT 0,
    "subscription_charge_failed_at" timestamp with time zone,
    "dispute_status" "text" DEFAULT 'none'::"text",
    "dispute_opened_at" timestamp with time zone,
    "dispute_amount_sek" integer,
    "dispute_reason" "text",
    "dispute_evidence_urls" "jsonb",
    "refund_history" "jsonb" DEFAULT '[]'::"jsonb",
    "customer_accepted_terms_at" timestamp with time zone,
    "terms_version_accepted" "text",
    "rut_application_status" "text" DEFAULT 'not_applicable'::"text",
    "cleaner_email" "text",
    "cleaner_phone" "text",
    "receipt_email_sent_at" timestamp with time zone,
    "business_vat_number" "text",
    "business_contact_person" "text",
    "business_invoice_email" "text",
    "invoice_address_street" "text",
    "invoice_address_city" "text",
    "invoice_address_postal_code" "text",
    "invoice_number" "text",
    "chosen_cleaner_match_score" numeric(4,3),
    "matching_algorithm_version" "text",
    CONSTRAINT "bookings_attest_status_check" CHECK (("attest_status" = ANY (ARRAY['pending'::"text", 'attested'::"text", 'disputed'::"text"]))),
    CONSTRAINT "bookings_dispute_status_check" CHECK (("dispute_status" = ANY (ARRAY['none'::"text", 'pending'::"text", 'won'::"text", 'lost'::"text", 'refunded'::"text"]))),
    CONSTRAINT "bookings_payment_mode_check" CHECK (("payment_mode" = ANY (ARRAY['stripe_checkout'::"text", 'stripe_subscription'::"text", 'invoice'::"text"]))),
    CONSTRAINT "bookings_rut_application_status_check" CHECK (("rut_application_status" = ANY (ARRAY['not_applicable'::"text", 'pending'::"text", 'submitted'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'completed'::"text", 'cancelled'::"text", 'klar'::"text", 'pågår'::"text", 'bekräftad'::"text", 'avbokad'::"text", 'pending_confirmation'::"text", 'timed_out'::"text", 'rejected_by_cleaner'::"text", 'awaiting_reassignment'::"text", 'awaiting_company_proposal'::"text", 'awaiting_customer_approval'::"text", 'auto_reassigning'::"text", 'refunded'::"text"])))
);

ALTER TABLE "public"."bookings" OWNER TO "postgres";

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_pkey') THEN
        ALTER TABLE ONLY "public"."bookings"
            ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_booking_id_key') THEN
        ALTER TABLE ONLY "public"."bookings"
            ADD CONSTRAINT "bookings_booking_id_key" UNIQUE ("booking_id");
    END IF;

    -- FKs till cleaners (4 st)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cleaner_id_fkey') THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'cleaners') THEN
            ALTER TABLE ONLY "public"."bookings"
                ADD CONSTRAINT "bookings_cleaner_id_fkey"
                FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_payment_marked_by_fkey') THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'cleaners') THEN
            ALTER TABLE ONLY "public"."bookings"
                ADD CONSTRAINT "bookings_payment_marked_by_fkey"
                FOREIGN KEY ("payment_marked_by") REFERENCES "public"."cleaners"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_reassignment_proposed_by_fkey') THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'cleaners') THEN
            ALTER TABLE ONLY "public"."bookings"
                ADD CONSTRAINT "bookings_reassignment_proposed_by_fkey"
                FOREIGN KEY ("reassignment_proposed_by") REFERENCES "public"."cleaners"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_reassignment_proposed_cleaner_id_fkey') THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'cleaners') THEN
            ALTER TABLE ONLY "public"."bookings"
                ADD CONSTRAINT "bookings_reassignment_proposed_cleaner_id_fkey"
                FOREIGN KEY ("reassignment_proposed_cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    -- FK till subscriptions (ej §2.1.1-scope)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_subscription_id_fkey') THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'subscriptions') THEN
            ALTER TABLE ONLY "public"."bookings"
                ADD CONSTRAINT "bookings_subscription_id_fkey"
                FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_bookings_attest"
    ON "public"."bookings" USING "btree" ("cleaner_id", "attest_status");

CREATE INDEX IF NOT EXISTS "idx_bookings_cleaner"
    ON "public"."bookings" USING "btree" ("cleaner_id");

CREATE INDEX IF NOT EXISTS "idx_bookings_date"
    ON "public"."bookings" USING "btree" ("booking_date");

CREATE INDEX IF NOT EXISTS "idx_bookings_dispute_status"
    ON "public"."bookings" USING "btree" ("dispute_status")
    WHERE ("dispute_status" <> 'none'::"text");

CREATE INDEX IF NOT EXISTS "idx_bookings_payment_due_date"
    ON "public"."bookings" USING "btree" ("payment_due_date")
    WHERE ("payment_due_date" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "idx_bookings_payment_marked_by"
    ON "public"."bookings" USING "btree" ("payment_marked_by")
    WHERE ("payment_marked_by" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "idx_bookings_payment_mode_status"
    ON "public"."bookings" USING "btree" ("payment_mode", "payment_status")
    WHERE ("payment_mode" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "idx_bookings_proposed_cleaner"
    ON "public"."bookings" USING "btree" ("reassignment_proposed_cleaner_id")
    WHERE ("reassignment_proposed_cleaner_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "idx_bookings_reassignment_state"
    ON "public"."bookings" USING "btree" ("status", "reassignment_proposed_at")
    WHERE ("status" = ANY (ARRAY['awaiting_company_proposal'::"text", 'awaiting_customer_approval'::"text", 'awaiting_reassignment'::"text"]));

CREATE INDEX IF NOT EXISTS "idx_bookings_rut_application"
    ON "public"."bookings" USING "btree" ("rut_application_status")
    WHERE ("rut_application_status" <> ALL (ARRAY['not_applicable'::"text", 'approved'::"text"]));

CREATE INDEX IF NOT EXISTS "idx_bookings_status"
    ON "public"."bookings" USING "btree" ("status");

CREATE INDEX IF NOT EXISTS "idx_bookings_stripe_payment_intent"
    ON "public"."bookings" USING "btree" ("stripe_payment_intent_id")
    WHERE ("stripe_payment_intent_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "idx_bookings_subscription_id"
    ON "public"."bookings" USING "btree" ("subscription_id")
    WHERE ("subscription_id" IS NOT NULL);

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT, INSERT, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";
