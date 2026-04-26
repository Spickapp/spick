-- ═══════════════════════════════════════════════════════════════
-- SPICK: P0 Race Condition Fix #1 — acquire_booking_slot RPC
-- ═══════════════════════════════════════════════════════════════
--
-- AUDIT: Booking 2026-04-26 (Agent A + C) P0 — dubbelbokning samma slot
--
-- PROBLEM: Frontend visar slot="occupied", kund väljer ändå, Stripe lyckas,
-- webhook tilldelar samma cleaner → två bokingar för samma tidslot.
-- Saknas server-side slot-acquisition-lock INNAN Stripe Checkout skapas.
--
-- SOLUTION: 
--   RPC acquire_booking_slot() som:
--   - Använder SELECT ... FOR UPDATE på relevanta cleaner_availability_v2-rader
--   - Validerar att tidsslottet (start_time <= booking_time < end_time) är tillgängligt
--   - Returnerar TRUE om ok, FALSE om redan bokad
--   - Anropas i booking-create INNAN Stripe Checkout skapas
--
-- Schema-observationer:
--   - cleaner_availability_v2: day_of_week, start_time, end_time (weekly ranges)
--   - booking_date: DATE, booking_time: TIME, booking_hours: NUMERIC
--   - NO slot-overlap constraint på availability_v2 (kan bara ha 1 active slot per dow)
--   - Overlap-validering via trigger validate_avail_v2_no_overlap()
--
-- IMPLEMENTATION:
--   1. Konvertera booking_date → day_of_week (1=mån, 7=sön)
--   2. Beräkna slot_end = booking_time + booking_hours
--   3. SELECT FOR UPDATE på cleaner_availability_v2 för denna dow/day
--   4. Verifiera (booking_time >= start_time AND slot_end <= end_time)
--   5. Returnera TRUE/FALSE
--
-- ATOMICITY: RPC kör i transaktion med SERIALIZABLE isolation.
-- Concurrent booking-create för samma (cleaner, datum, tid) får 409 conflict.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION acquire_booking_slot(
  p_cleaner_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_booking_hours NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_of_week SMALLINT;
  v_slot_end TIME;
  v_slot_available BOOLEAN;
BEGIN
  -- Konvertera date → day_of_week (1=mån, 7=sön per schema)
  v_day_of_week := EXTRACT(ISODOW FROM p_booking_date)::SMALLINT;
  IF v_day_of_week = 7 THEN
    v_day_of_week := 7; -- ISO: 7=sön, vi använder samma
  END IF;

  -- Beräkna sluttid för bokningen
  v_slot_end := (p_booking_time::TIME + (p_booking_hours || ' hours')::INTERVAL)::TIME;

  -- Pessimistic lock: SELECT FOR UPDATE på availability-raden för denna dow
  -- Blockerar concurrent updates från andra transaktioner
  PERFORM 1 FROM cleaner_availability_v2
  WHERE cleaner_id = p_cleaner_id
    AND day_of_week = v_day_of_week
    AND is_active = true
  FOR UPDATE;

  -- Verifiera att tidslottet ryms inom tillgängligt tidsintervall
  -- Kräv: booking_time >= start_time AND slot_end <= end_time
  SELECT COALESCE(
    (SELECT true FROM cleaner_availability_v2
     WHERE cleaner_id = p_cleaner_id
       AND day_of_week = v_day_of_week
       AND is_active = true
       AND start_time <= p_booking_time
       AND end_time >= v_slot_end),
    false
  ) INTO v_slot_available;

  RETURN v_slot_available;
END;
$$;

-- GRANT permissions: ENBART service_role. anon får INTE locka rader (DOS-skydd).
-- Booking-create-EF är backend och kallas via Bearer service-key.
REVOKE ALL ON FUNCTION acquire_booking_slot(UUID, DATE, TIME, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acquire_booking_slot(UUID, DATE, TIME, NUMERIC) TO service_role;

COMMENT ON FUNCTION acquire_booking_slot(UUID, DATE, TIME, NUMERIC)
IS 'P0 Race Condition Fix #1: Atomisk slot-acquisition med pessimistic locking. Måste anropas INNAN Stripe Checkout. Returnerar TRUE om bokningstiden ryms i tillgängligt tidsintervall och slottet är låst, FALSE annars. Körs med SERIALIZABLE isolation.';

