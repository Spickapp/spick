-- =========================================================
-- Fas 2 §2.1.1 — self_invoices retroaktiv migration
-- =========================================================
-- Primärkälla: prod-schema.sql rad 2590-2622
-- Beroenden: cleaners (self_invoices_cleaner_id_fkey)
-- Städarnas självfakturor — 30 kolumner, 3 indexes
-- =========================================================

-- ── Tabell ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."self_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_number" "text" NOT NULL,
    "cleaner_id" "uuid",
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "total_gross" numeric NOT NULL,
    "total_commission" numeric NOT NULL,
    "total_net" numeric NOT NULL,
    "vat_amount" numeric DEFAULT 0,
    "total_with_vat" numeric NOT NULL,
    "status" "text" DEFAULT 'draft'::"text",
    "pdf_url" "text",
    "booking_ids" "uuid"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "accepted_at" timestamp with time zone,
    "disputed_at" timestamp with time zone,
    "dispute_reason" "text",
    "seller_name" "text",
    "seller_org_number" "text",
    "seller_address" "text",
    "seller_f_skatt" boolean DEFAULT true,
    "seller_vat_registered" boolean DEFAULT false,
    "buyer_name" "text" DEFAULT 'Haghighi Consulting AB'::"text",
    "buyer_org_number" "text" DEFAULT '559402-4522'::"text",
    "line_items" "jsonb" DEFAULT '[]'::"jsonb",
    "company_id" "uuid",
    "currency" "text" DEFAULT 'SEK'::"text",
    "created_by" "uuid",
    "sent_at" timestamp with time zone,
    "notes" "text",
    "buyer_address" "text" DEFAULT 'Solna, Sverige'::"text",
    "html_url" "text"
);

ALTER TABLE "public"."self_invoices" OWNER TO "postgres";

-- ── Constraints ─────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'self_invoices_pkey') THEN
        ALTER TABLE ONLY "public"."self_invoices"
            ADD CONSTRAINT "self_invoices_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'self_invoices_invoice_number_key') THEN
        ALTER TABLE ONLY "public"."self_invoices"
            ADD CONSTRAINT "self_invoices_invoice_number_key" UNIQUE ("invoice_number");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'self_invoices_cleaner_id_fkey') THEN
        ALTER TABLE ONLY "public"."self_invoices"
            ADD CONSTRAINT "self_invoices_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id");
    END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_self_invoices_cleaner"
    ON "public"."self_invoices" USING "btree" ("cleaner_id");

CREATE INDEX IF NOT EXISTS "idx_self_invoices_period"
    ON "public"."self_invoices" USING "btree" ("period_start", "period_end");

CREATE INDEX IF NOT EXISTS "idx_self_invoices_status"
    ON "public"."self_invoices" USING "btree" ("status");

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE "public"."self_invoices" ENABLE ROW LEVEL SECURITY;

-- ── Grants ───────────────────────────────────────────────
GRANT SELECT ON TABLE "public"."self_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."self_invoices" TO "service_role";
GRANT SELECT ON TABLE "public"."self_invoices" TO "anon";
