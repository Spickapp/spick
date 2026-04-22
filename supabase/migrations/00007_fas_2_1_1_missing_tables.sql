-- =============================================================
-- Fas 2.X iter 36 (2026-04-22): Missing tables bootstrap
-- =============================================================
-- Skapar 2 tabeller + 1 function + 1 trigger som prod har men som
-- inte fanns i någon kvarvarande migration:
-- 1. booking_slots (+ UNIQUE, FK, 2 index, sync-trigger)
-- 2. booking_checklists (PKEY, FK bookings)
-- 3. sync_booking_to_slot() function
-- 4. trg_sync_booking_slot ON bookings trigger
--
-- Primärkälla: prod-schema.sql (dumpad 2026-04-22 07:42)
--   booking_slots:      rad 1521 (table), 3189-3194 (constraints),
--                       3619 (uq_booking_slots_booking_id),
--                       3680+3684 (index), 4122 (FK cleaner_id)
--   booking_checklists: rad ~1510 (table), 3164 (pkey),
--                       4092 (FK booking_id)
--                       [Skippas: 4097 FK checklist_id → service_checklists
--                        eftersom service_checklists skapas senare i
--                        20260422081500. Dokumenterat framtida arbete.]
--   sync_booking_to_slot: rad 804-832 (function)
--   trg_sync_booking_slot: rad 4048 (trigger)
-- =============================================================

-- ── booking_slots ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."booking_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "time" time without time zone NOT NULL,
    "hours" numeric(3,1) DEFAULT 2.0 NOT NULL,
    "is_booked" boolean DEFAULT false,
    "booked_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "booking_id" "uuid",
    "subscription_id" "uuid"
);

ALTER TABLE "public"."booking_slots" OWNER TO "postgres";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_slots_pkey') THEN
        ALTER TABLE ONLY "public"."booking_slots"
            ADD CONSTRAINT "booking_slots_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_slots_cleaner_id_date_time_key') THEN
        ALTER TABLE ONLY "public"."booking_slots"
            ADD CONSTRAINT "booking_slots_cleaner_id_date_time_key" UNIQUE ("cleaner_id", "date", "time");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_booking_slots_booking_id') THEN
        ALTER TABLE ONLY "public"."booking_slots"
            ADD CONSTRAINT "uq_booking_slots_booking_id" UNIQUE ("booking_id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_slots_cleaner_id_fkey') THEN
        ALTER TABLE ONLY "public"."booking_slots"
            ADD CONSTRAINT "booking_slots_cleaner_id_fkey"
            FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaners"("id") ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_booking_slots_cleaner"
    ON "public"."booking_slots" USING "btree" ("cleaner_id");

CREATE INDEX IF NOT EXISTS "idx_booking_slots_date"
    ON "public"."booking_slots" USING "btree" ("date", "is_booked");

-- ── booking_checklists ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."booking_checklists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "checklist_id" "uuid",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."booking_checklists" OWNER TO "postgres";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_checklists_pkey') THEN
        ALTER TABLE ONLY "public"."booking_checklists"
            ADD CONSTRAINT "booking_checklists_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_checklists_booking_id_fkey') THEN
        ALTER TABLE ONLY "public"."booking_checklists"
            ADD CONSTRAINT "booking_checklists_booking_id_fkey"
            FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");
    END IF;

    -- FK till service_checklists SKIPPAS här (service_checklists skapas
    -- i 20260422081500 som sorteras efter 00007). Dokumenterat som
    -- framtida arbete i audit: lägg till FK i sen-migration.
END $$;

-- ── sync_booking_to_slot() function ─────────────────────────
CREATE OR REPLACE FUNCTION "public"."sync_booking_to_slot"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $function$
BEGIN
  IF NEW.payment_status = 'paid' AND NEW.cleaner_id IS NOT NULL
     AND NEW.booking_date IS NOT NULL AND NEW.booking_time IS NOT NULL THEN
    INSERT INTO booking_slots (cleaner_id, date, time, hours, is_booked, booking_id)
    VALUES (
      NEW.cleaner_id,
      NEW.booking_date,
      NEW.booking_time,
      COALESCE(NEW.booking_hours, 3),
      true,
      NEW.id
    )
    ON CONFLICT (booking_id) DO UPDATE SET
      cleaner_id = EXCLUDED.cleaner_id,
      date = EXCLUDED.date,
      time = EXCLUDED.time,
      hours = EXCLUDED.hours,
      is_booked = true;
  END IF;
  -- Om bokning avbokad, ta bort slot
  IF NEW.status IN ('cancelled', 'avbokad') AND OLD.status NOT IN ('cancelled', 'avbokad') THEN
    DELETE FROM booking_slots WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION "public"."sync_booking_to_slot"() OWNER TO "postgres";

-- ── trg_sync_booking_slot ON bookings ────────────────────────
DROP TRIGGER IF EXISTS "trg_sync_booking_slot" ON "public"."bookings";

CREATE TRIGGER "trg_sync_booking_slot"
    AFTER INSERT OR UPDATE ON "public"."bookings"
    FOR EACH ROW EXECUTE FUNCTION "public"."sync_booking_to_slot"();
