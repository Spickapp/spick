-- ============================================================
-- Migration: calendar_events — central kalender-tabell (Fas 1)
-- Skapad: 2026-04-14
--
-- Alla kalendervyer (kund, städare, VD) läser från denna tabell.
-- Bokningar synkas hit via trigger, externa kalendrar via Edge Function.
-- ============================================================
--
-- FÖRBEREDELSE: Verifiera kolumnnamn i prod INNAN du kör denna fil:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'bookings'
--     AND column_name IN ('booking_date','booking_time','booking_hours',
--                        'service_type','customer_address','address','status',
--                        'payment_status','cleaner_id','checkin_lat','checkin_lng')
--   ORDER BY column_name;
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'cleaner_availability'
--   ORDER BY ordinal_position;
--
-- Om prod avviker — anpassa sync_booking_to_calendar() nedan.
-- ============================================================

-- 1) Extension för EXCLUDE-constraint med tstzrange
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- 2) HUVUDTABELL: calendar_events
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_id      uuid NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  event_type      text NOT NULL CHECK (event_type IN ('booking','blocked','travel','external','break')),
  source          text NOT NULL DEFAULT 'spick' CHECK (source IN ('spick','google','outlook','ical','manual')),
  booking_id      uuid REFERENCES bookings(id) ON DELETE CASCADE,
  external_id     text,
  title           text,
  description     text,
  location_lat    numeric,
  location_lng    numeric,
  address         text,
  color           text,
  is_all_day      boolean DEFAULT false,
  recurrence_rule text,
  recurrence_end  date,
  synced_at       timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  CONSTRAINT valid_time_range CHECK (end_at > start_at),
  CONSTRAINT booking_ref CHECK (
    (event_type = 'booking' AND booking_id IS NOT NULL) OR
    (event_type <> 'booking')
  )
);

-- Overlap-exclusion: förhindrar dubbelbokningar på DB-nivå.
-- Gäller endast booking + blocked. travel/external/break får överlappa.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_booking_overlap'
  ) THEN
    ALTER TABLE calendar_events ADD CONSTRAINT no_booking_overlap
      EXCLUDE USING gist (
        cleaner_id WITH =,
        tstzrange(start_at, end_at) WITH &&
      ) WHERE (event_type IN ('booking','blocked'));
  END IF;
END $$;

-- Index för snabba range-queries (vecko/månadsvyer)
CREATE INDEX IF NOT EXISTS idx_cal_cleaner_range ON calendar_events (cleaner_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_cal_booking_id    ON calendar_events (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cal_event_type    ON calendar_events (event_type);
CREATE INDEX IF NOT EXISTS idx_cal_external_id   ON calendar_events (external_id) WHERE external_id IS NOT NULL;

-- Partial unique index för ON CONFLICT (booking_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cal_booking_unique
  ON calendar_events (booking_id) WHERE booking_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_calendar_events_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendar_events_updated_at ON calendar_events;
CREATE TRIGGER trg_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_events_updated_at();

-- ============================================================
-- 3) cleaner_availability_v2 — flera tidsspann per dag
-- Ersätter gamla modellen (1 rad med booleans per städare).
-- ============================================================
CREATE TABLE IF NOT EXISTS cleaner_availability_v2 (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_id  uuid NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=mån, 7=sön
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  is_active   boolean DEFAULT true,
  valid_from  date,
  valid_until date,
  created_at  timestamptz DEFAULT now(),

  CONSTRAINT valid_time CHECK (start_time < end_time)
);

-- OBS: Postgres saknar inbyggd "timerange"-typ. Overlap-skydd sker via
-- validerings-trigger istället för EXCLUDE-constraint.
CREATE OR REPLACE FUNCTION validate_avail_v2_no_overlap()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_active = false THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM cleaner_availability_v2 a
    WHERE a.cleaner_id = NEW.cleaner_id
      AND a.day_of_week = NEW.day_of_week
      AND a.is_active = true
      AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.start_time < NEW.end_time
      AND a.end_time   > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Overlapping availability slot for cleaner % on day %', NEW.cleaner_id, NEW.day_of_week;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_avail_v2_no_overlap ON cleaner_availability_v2;
CREATE TRIGGER trg_avail_v2_no_overlap
  BEFORE INSERT OR UPDATE ON cleaner_availability_v2
  FOR EACH ROW
  EXECUTE FUNCTION validate_avail_v2_no_overlap();

CREATE INDEX IF NOT EXISTS idx_avail_v2_cleaner ON cleaner_availability_v2 (cleaner_id, day_of_week);

-- ============================================================
-- 4) RLS-POLICIES
-- ============================================================
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can read calendar_events" ON calendar_events;
CREATE POLICY "Anon can read calendar_events"
  ON calendar_events FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages calendar_events" ON calendar_events;
CREATE POLICY "Service role manages calendar_events"
  ON calendar_events FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users manage own calendar_events" ON calendar_events;
CREATE POLICY "Authenticated users manage own calendar_events"
  ON calendar_events FOR ALL USING (
    cleaner_id IN (
      SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
    )
  );

ALTER TABLE cleaner_availability_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can read availability_v2" ON cleaner_availability_v2;
CREATE POLICY "Anon can read availability_v2"
  ON cleaner_availability_v2 FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages availability_v2" ON cleaner_availability_v2;
CREATE POLICY "Service role manages availability_v2"
  ON cleaner_availability_v2 FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users manage own availability_v2" ON cleaner_availability_v2;
CREATE POLICY "Authenticated users manage own availability_v2"
  ON cleaner_availability_v2 FOR ALL USING (
    cleaner_id IN (
      SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
    )
  );

-- GRANTS
GRANT SELECT ON calendar_events TO anon, authenticated;
GRANT ALL    ON calendar_events TO service_role;
GRANT SELECT ON cleaner_availability_v2 TO anon, authenticated;
GRANT ALL    ON cleaner_availability_v2 TO service_role;

-- ============================================================
-- 5) REALTIME
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'calendar_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE calendar_events;
  END IF;
END $$;

-- ============================================================
-- 6) TRIGGER: bookings → calendar_events synk
--
-- Förutsätter att prod-bookings har dessa kolumner:
--   booking_date, booking_time, booking_hours, service_type,
--   customer_address (fallback: address), status, payment_status,
--   cleaner_id, checkin_lat, checkin_lng
-- Om kolumnnamn skiljer sig — anpassa funktionen här.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_booking_to_calendar()
RETURNS trigger AS $$
DECLARE
  v_start  timestamptz;
  v_end    timestamptz;
  v_title  text;
  v_addr   text;
  v_hours  numeric;
BEGIN
  -- DELETE: ta bort motsvarande calendar_event
  IF TG_OP = 'DELETE' THEN
    DELETE FROM calendar_events WHERE booking_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Skippa rader utan tilldelad städare
  IF NEW.cleaner_id IS NULL THEN
    DELETE FROM calendar_events WHERE booking_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Beräkna tid
  v_hours := COALESCE(NEW.booking_hours, 3);
  v_start := (NEW.booking_date::text || ' ' || COALESCE(NEW.booking_time::text, '09:00'))::timestamptz;
  v_end   := v_start + (v_hours || ' hours')::interval;
  v_title := COALESCE(NEW.service_type, 'Städning');
  v_addr  := COALESCE(NEW.customer_address, NEW.address, '');

  -- Avbokade/refunderade → ta bort ev. event
  IF NEW.status IN ('cancelled','avbokad') OR NEW.payment_status = 'refunded' THEN
    DELETE FROM calendar_events WHERE booking_id = NEW.id;
    RETURN NEW;
  END IF;

  -- UPSERT
  INSERT INTO calendar_events (
    cleaner_id, start_at, end_at, event_type, source, booking_id,
    title, address, location_lat, location_lng
  ) VALUES (
    NEW.cleaner_id, v_start, v_end, 'booking', 'spick', NEW.id,
    v_title, v_addr, NEW.checkin_lat, NEW.checkin_lng
  )
  ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL
  DO UPDATE SET
    cleaner_id   = EXCLUDED.cleaner_id,
    start_at     = EXCLUDED.start_at,
    end_at       = EXCLUDED.end_at,
    title        = EXCLUDED.title,
    address      = EXCLUDED.address,
    location_lat = EXCLUDED.location_lat,
    location_lng = EXCLUDED.location_lng,
    updated_at   = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_booking_to_calendar ON bookings;
CREATE TRIGGER trg_booking_to_calendar
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION sync_booking_to_calendar();

-- ============================================================
-- 7) MIGRERA BEFINTLIG DATA
-- ============================================================

-- 7a) Bokningar → calendar_events
INSERT INTO calendar_events (cleaner_id, start_at, end_at, event_type, source, booking_id, title, address)
SELECT
  b.cleaner_id,
  (b.booking_date::text || ' ' || COALESCE(b.booking_time::text, '09:00'))::timestamptz,
  (b.booking_date::text || ' ' || COALESCE(b.booking_time::text, '09:00'))::timestamptz
    + (COALESCE(b.booking_hours, 3) || ' hours')::interval,
  'booking',
  'spick',
  b.id,
  COALESCE(b.service_type, 'Städning'),
  COALESCE(b.customer_address, b.address, '')
FROM bookings b
WHERE b.status NOT IN ('cancelled','avbokad')
  AND COALESCE(b.payment_status, '') <> 'refunded'
  AND b.cleaner_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 7b) cleaner_blocked_dates → calendar_events
INSERT INTO calendar_events (cleaner_id, start_at, end_at, event_type, source, title, is_all_day)
SELECT
  bd.cleaner_id,
  (bd.blocked_date::text || ' 00:00')::timestamptz,
  (bd.blocked_date::text || ' 23:59')::timestamptz,
  'blocked',
  'spick',
  COALESCE(bd.reason, 'Blockerad'),
  true
FROM cleaner_blocked_dates bd
ON CONFLICT DO NOTHING;

-- 7c) cleaner_availability → cleaner_availability_v2
-- Prod har EN rad per städare med day_mon..day_sun booleans + start_time/end_time.
-- Gamla modellen (day_of_week per rad 0-6) hanteras också via fallback nedan.
DO $$
DECLARE
  has_day_mon boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cleaner_availability' AND column_name = 'day_mon'
  ) INTO has_day_mon;

  IF has_day_mon THEN
    -- Prod-modell: day_mon..day_sun booleans
    INSERT INTO cleaner_availability_v2 (cleaner_id, day_of_week, start_time, end_time, is_active)
    SELECT cleaner_id, 1, start_time, end_time, COALESCE(is_active, true) FROM cleaner_availability WHERE day_mon = true
    UNION ALL
    SELECT cleaner_id, 2, start_time, end_time, COALESCE(is_active, true) FROM cleaner_availability WHERE day_tue = true
    UNION ALL
    SELECT cleaner_id, 3, start_time, end_time, COALESCE(is_active, true) FROM cleaner_availability WHERE day_wed = true
    UNION ALL
    SELECT cleaner_id, 4, start_time, end_time, COALESCE(is_active, true) FROM cleaner_availability WHERE day_thu = true
    UNION ALL
    SELECT cleaner_id, 5, start_time, end_time, COALESCE(is_active, true) FROM cleaner_availability WHERE day_fri = true
    UNION ALL
    SELECT cleaner_id, 6, start_time, end_time, COALESCE(is_active, true) FROM cleaner_availability WHERE day_sat = true
    UNION ALL
    SELECT cleaner_id, 7, start_time, end_time, COALESCE(is_active, true) FROM cleaner_availability WHERE day_sun = true
    ON CONFLICT DO NOTHING;
  ELSE
    -- Gammal modell: day_of_week 0=sön..6=lör → 1=mån..7=sön
    INSERT INTO cleaner_availability_v2 (cleaner_id, day_of_week, start_time, end_time, is_active)
    SELECT
      cleaner_id,
      CASE WHEN day_of_week = 0 THEN 7 ELSE day_of_week END,
      start_time,
      end_time,
      COALESCE(is_active, true)
    FROM cleaner_availability
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ============================================================
-- 8) VY: v_calendar_slots (för boka.html framtida dual-read)
-- ============================================================
CREATE OR REPLACE VIEW v_calendar_slots AS
SELECT
  ce.cleaner_id,
  ce.start_at,
  ce.end_at,
  ce.event_type,
  ce.booking_id,
  ce.title,
  ce.is_all_day,
  ce.source
FROM calendar_events ce
WHERE ce.start_at >= now() - interval '1 day'
  AND ce.start_at <= now() + interval '60 days';

GRANT SELECT ON v_calendar_slots TO anon, authenticated;

-- ============================================================
-- 9) RPC: get_cleaner_calendar
-- ============================================================
CREATE OR REPLACE FUNCTION get_cleaner_calendar(
  p_cleaner_id uuid,
  p_start      date,
  p_end        date
)
RETURNS TABLE (
  id          uuid,
  start_at    timestamptz,
  end_at      timestamptz,
  event_type  text,
  source      text,
  booking_id  uuid,
  title       text,
  address     text,
  is_all_day  boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.id, ce.start_at, ce.end_at, ce.event_type, ce.source,
    ce.booking_id, ce.title, ce.address, ce.is_all_day
  FROM calendar_events ce
  WHERE ce.cleaner_id = p_cleaner_id
    AND ce.start_at  >= p_start::timestamptz
    AND ce.end_at    <= (p_end + 1)::timestamptz
  ORDER BY ce.start_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_cleaner_calendar(uuid, date, date) TO anon, authenticated;

-- ============================================================
-- VERIFIERINGAR (kör manuellt efter deploy)
-- ============================================================
-- SELECT count(*) FROM calendar_events;                -- ska matcha aktiva bokningar
-- SELECT count(*) FROM cleaner_availability_v2;        -- ska ha rader
-- SELECT event_type, count(*) FROM calendar_events GROUP BY event_type;
-- SELECT * FROM get_cleaner_calendar('<uuid>','2026-04-01','2026-05-01');
