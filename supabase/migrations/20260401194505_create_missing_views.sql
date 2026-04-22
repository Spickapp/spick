-- ============================================================
-- Migration: 20260401194505_create_missing_views.sql
-- Skapar saknade vyer, policies, kolumner och triggers
-- Alla block är idempotenta
-- ============================================================

-- ── Block 1: Anon READ-policy på cleaners ──────────────────
-- Migration 20260327400001 raderade denna policy. Återskapa den.
DROP POLICY IF EXISTS "Anon read active cleaners" ON cleaners;
CREATE POLICY "Anon read active cleaners" ON cleaners
  FOR SELECT USING (is_approved = true AND status = 'aktiv');

-- ── Block 2: Lägg till saknade kolumner på cleaners ────────
-- Verifierat saknas i produktion: services, review_count, tier, service_radius_km
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS services          TEXT    DEFAULT 'Hemstädning',
  ADD COLUMN IF NOT EXISTS review_count      INT     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tier              TEXT    DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS service_radius_km INT     DEFAULT 10;

-- ── Block 3: Fixa booking_confirmation-vyn ─────────────────
-- Gamla vyn selekterade service/date/time/hours/cleaner_email (kolumner som inte finns).
-- Ny vy använder korrekta kolumnnamn + exponerar customer_address för tack.html.
DROP VIEW IF EXISTS booking_confirmation;
CREATE VIEW booking_confirmation AS
SELECT
  id,
  stripe_session_id,
  service_type,
  booking_date,
  booking_time,
  booking_hours,
  city,
  total_price,
  payment_status,
  rut_amount,
  cleaner_id,
  cleaner_name,
  customer_name,
  customer_email,
  customer_address,
  created_at
FROM bookings;
GRANT SELECT ON booking_confirmation TO anon, authenticated;

-- ── Block 4: FLYTTAD (Fas 2.X iter 26, 2026-04-22) ─────────
-- Ursprungligen: CREATE OR REPLACE VIEW booking_slots som alias till
-- bookings(booking_date, booking_time, booking_hours).
--
-- PROBLEM: Prod har booking_slots som riktig TABELL (rad 1521 i
-- prod-schema.sql), inte VIEW. Prod har sync_booking_to_slot-trigger
-- som upprätthåller tabellens data från bookings-INSERTs.
--
-- Dessutom försökte VIEW:n använda time_end-kolumn som inte finns.
-- Time_end-infrastrukturen arkiverades i Fas 2.X iter 15
-- (20260326800001_booking_time_slots.sql — 100% dead mot prod).
--
-- Hela Block 4 är arkitektoniskt inkompatibelt med prod och kommenterat ut.
-- Ursprungligt innehåll bevarat nedan som kommentar för audit-trail.
--
-- CREATE OR REPLACE VIEW booking_slots AS
-- SELECT
--   cleaner_id,
--   booking_date                                                              AS date,
--   booking_time                                                              AS time,
--   booking_hours                                                             AS hours,
--   COALESCE(
--     time_end,
--     (booking_time::time + (booking_hours * interval '1 hour'))::text
--   )                                                                         AS time_end
-- FROM bookings
-- WHERE payment_status = 'paid'
--   AND status        != 'avbokad';
-- GRANT SELECT ON booking_slots TO anon, authenticated;

-- ── Block 5: Skapa v_cleaners_for_booking ──────────────────
-- Vyn saknades helt. boka.html hämtar städare härifrån (steg 2+3).
-- Kolumner som ännu saknas i cleaners (services, review_count, service_radius_km)
-- hanteras med fallback-värden tills Block 2 är körd.
CREATE OR REPLACE VIEW v_cleaners_for_booking AS
SELECT
  c.id,
  c.full_name,
  COALESCE(c.avg_rating, 5.0)                                              AS avg_rating,
  COALESCE(c.review_count,
    (SELECT count(*)::int FROM reviews r WHERE r.cleaner_id = c.id)
  )                                                                         AS review_count,
  COALESCE(c.services, 'Hemstädning')                                      AS services,
  c.city,
  COALESCE(c.hourly_rate, 399)                                             AS hourly_rate,
  c.bio,
  c.avatar_url,
  COALESCE(c.identity_verified, false)                                     AS identity_verified,
  c.home_lat,
  c.home_lng,
  COALESCE(c.service_radius_km, 10)                                        AS service_radius_km,
  COALESCE(c.pet_pref,      false)                                         AS pet_pref,
  COALESCE(c.elevator_pref, false)                                         AS elevator_pref
FROM  cleaners c
WHERE c.is_approved = true
  AND c.status      = 'aktiv';
GRANT SELECT ON v_cleaners_for_booking TO anon, authenticated;

-- ── Block 6: Skapa v_cleaner_availability_int ──────────────
-- Vyn saknades helt. Faktisk tabell har EN rad per städare med boolean-kolumner
-- per dag (day_mon … day_sun). Koden förväntar sig EN rad per dag per städare
-- med day_of_week INTEGER: 0=sön, 1=mån, 2=tis, 3=ons, 4=tor, 5=fre, 6=lör.
CREATE OR REPLACE VIEW v_cleaner_availability_int AS
  SELECT cleaner_id, 0 AS day_of_week, start_time, end_time, is_active FROM cleaner_availability WHERE day_sun  = true
  UNION ALL
  SELECT cleaner_id, 1, start_time, end_time, is_active FROM cleaner_availability WHERE day_mon  = true
  UNION ALL
  SELECT cleaner_id, 2, start_time, end_time, is_active FROM cleaner_availability WHERE day_tue  = true
  UNION ALL
  SELECT cleaner_id, 3, start_time, end_time, is_active FROM cleaner_availability WHERE day_wed  = true
  UNION ALL
  SELECT cleaner_id, 4, start_time, end_time, is_active FROM cleaner_availability WHERE day_thu  = true
  UNION ALL
  SELECT cleaner_id, 5, start_time, end_time, is_active FROM cleaner_availability WHERE day_fri  = true
  UNION ALL
  SELECT cleaner_id, 6, start_time, end_time, is_active FROM cleaner_availability WHERE day_sat  = true;
GRANT SELECT ON v_cleaner_availability_int TO anon, authenticated;

-- ── Block 7: Fixa public_stats-vyn ─────────────────────────
-- Gamla vyn räknade städare med status='godkänd' → alltid 0.
-- Alla städare migrerades till status='aktiv' i migration 20260330600001.
CREATE OR REPLACE VIEW public_stats AS SELECT
  (SELECT count(*) FROM bookings WHERE payment_status = 'paid')                                       AS total_bookings,
  (SELECT count(*) FROM bookings WHERE payment_status = 'paid'
     AND created_at > now() - interval '24 hours')                                                    AS bookings_today,
  (SELECT count(*) FROM cleaners WHERE is_approved = true AND status = 'aktiv')                       AS active_cleaners,
  (SELECT COALESCE(round(avg(cleaner_rating)::numeric, 1), 4.9) FROM reviews)                        AS avg_rating,
  (SELECT count(*) FROM reviews)                                                                       AS total_reviews;
GRANT SELECT ON public_stats TO anon, authenticated;

-- ── Block 8: avg_rating trigger ────────────────────────────
-- Trigger som uppdaterar cleaners.avg_rating och cleaners.review_count
-- automatiskt varje gång en recension skrivs.
-- OBS: Refererar cleaner_id (inte cleaner_email som gamla versionen).
CREATE OR REPLACE FUNCTION update_cleaner_rating() RETURNS TRIGGER AS $$
BEGIN
  UPDATE cleaners SET
    avg_rating   = (SELECT round(avg(cleaner_rating)::numeric, 1)
                    FROM reviews WHERE cleaner_id = NEW.cleaner_id),
    review_count = (SELECT count(*)::int
                    FROM reviews WHERE cleaner_id = NEW.cleaner_id)
  WHERE id = NEW.cleaner_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_review_insert ON reviews;
CREATE TRIGGER after_review_insert
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_cleaner_rating();
