-- ============================================================
-- Fas 0.3 prod-incidentfix — 18 april 2026 (sen kväll)
-- ============================================================
-- Tre kedjade buggar upptäckta + åtgärdade i samma session:
--   1) bookings.cleaner_email + cleaner_phone saknades helt i prod-schema
--      men refererades av ~24 kodställen (tyst trasigt sedan dag 1)
--   2) sync_booking_to_calendar() saknade guard — varje UPDATE av bookings
--      triggade calendar_events UPSERT, vilket kraschade pga
--      no_booking_overlap-constraint på historisk dubbelbokning (4 april)
--   3) Historisk dubbelbokning Farhad 4 april (båda completed) lämnas
--      som historik — ej data-rensad, bara triggern som respekterar den nu
--
-- Denna migration är idempotent (IF NOT EXISTS + WHERE IS NULL i backfill)
-- och kan köras säkert på staging eller nya miljöer.
--
-- Incidentrapport:
-- docs/incidents/2026-04-18-cleaner-email-phone-missing-columns.md
-- ============================================================

-- 1) Lägg till saknade kolumner ─────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_email text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_phone text;

-- 2) Trigger-fix: guard mot onödig calendar_events-sync ─────
-- Guard skippar UPDATE helt om inget schema-relevant fält ändrats.
-- Tidigare triggade varje UPDATE (även backfill av cleaner_email) en
-- UPSERT mot calendar_events, som kraschade pga no_booking_overlap-
-- constraint när historiska rader överlappade.
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

  -- GUARD: skippa UPDATE när inget schema-relevant fält ändrats.
  -- Fälten nedan är de enda som påverkar calendar_events-raden.
  IF TG_OP = 'UPDATE' AND
     NEW.cleaner_id       IS NOT DISTINCT FROM OLD.cleaner_id AND
     NEW.booking_date     IS NOT DISTINCT FROM OLD.booking_date AND
     NEW.booking_time     IS NOT DISTINCT FROM OLD.booking_time AND
     NEW.booking_hours    IS NOT DISTINCT FROM OLD.booking_hours AND
     NEW.service_type     IS NOT DISTINCT FROM OLD.service_type AND
     NEW.customer_address IS NOT DISTINCT FROM OLD.customer_address AND
     NEW.status           IS NOT DISTINCT FROM OLD.status AND
     NEW.payment_status   IS NOT DISTINCT FROM OLD.payment_status AND
     NEW.checkin_lat      IS NOT DISTINCT FROM OLD.checkin_lat AND
     NEW.checkin_lng      IS NOT DISTINCT FROM OLD.checkin_lng THEN
    RETURN NEW;
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
  v_addr  := COALESCE(NEW.customer_address, '');

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

-- Triggern finns sedan 20260414000001_calendar_events.sql och behöver
-- inte återskapas — funktionen är bara uppdaterad via CREATE OR REPLACE.

-- 3) Backfill cleaner_email + cleaner_phone ─────────────────
-- Idempotent: uppdaterar bara rader där email/phone saknas.
-- I prod backfillades 25/26 rader 2026-04-18. Kvarvarande 1 rad saknar
-- cleaner_id (cancelled testbokning farrehagge@gmail.com 11 april) och
-- lämnas med NULL (OK).
UPDATE bookings b
   SET cleaner_email = c.email,
       cleaner_phone = c.phone
  FROM cleaners c
 WHERE b.cleaner_id = c.id
   AND b.cleaner_email IS NULL;
