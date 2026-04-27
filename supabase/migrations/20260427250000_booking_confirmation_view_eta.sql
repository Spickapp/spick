-- ═══════════════════════════════════════════════════════════════
-- SPICK – booking_confirmation-vy: exponera Smart-ETA-kolumner
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- min-bokning.html (kund-vy) hämtar via get_booking_by_id RPC som
-- returnerar SETOF booking_confirmation. Magic-link-anvandare (anon
-- via signed token) ser INTE bookings.cleaner_eta_at etc. utan dessa
-- kolumner i vyn. Resultat: ingen 'Städare på väg'-banner för
-- magic-link-besök.
--
-- LÖSNING
-- DROP + CREATE booking_confirmation med 6 nya ETA-kolumner.
-- Endast SELECT (ingen GRANT-ändring; redan grantat till anon).
--
-- REGLER #26-#33:
-- #28 SSOT — vy speglar bookings-tabellens nya ETA-kolumner direkt
-- #31 Curl-verifierat: cleaner_on_way_at/cleaner_eta_at saknas i
--     booking_confirmation pre-migrate (kund-vy bryts utan denna fix)
-- ═══════════════════════════════════════════════════════════════

-- DROP CASCADE: tar med get_booking_by_id() + get_booking_by_session()
-- som beror på vy-typen. Vi ÅTERSKAPAR dem identiskt nedan.
-- (Verifierat mot 20260426220000_fix_pii_leak_booking_views.sql)
DROP VIEW IF EXISTS booking_confirmation CASCADE;

CREATE VIEW booking_confirmation AS
SELECT
  id,
  stripe_session_id,
  service_type,
  booking_date,
  booking_time,
  booking_hours,
  total_price,
  payment_status,
  rut_amount,
  cleaner_id,
  cleaner_name,
  customer_name,
  customer_email,
  customer_address,
  created_at,
  -- ── Smart-ETA-kolumner (Fas 2026-04-27) ──
  cleaner_on_way_at,
  cleaner_eta_at,
  cleaner_eta_minutes,
  manual_delay_minutes,
  delay_status,
  predicted_arrival_at
FROM bookings;

-- PII-fix #2026-04-26: anon får INTE direkt SELECT (anti-enumeration).
-- Endast authenticated + RPC-functions nedan.
GRANT SELECT ON booking_confirmation TO authenticated;

-- ── ÅTERSKAPA RPC-functions som drogs av CASCADE ──
-- Identiska med 20260426220000_fix_pii_leak_booking_views.sql

CREATE OR REPLACE FUNCTION public.get_booking_by_id(_id uuid)
RETURNS SETOF public.booking_confirmation
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT * FROM public.booking_confirmation WHERE id = _id LIMIT 1;
$func$;

COMMENT ON FUNCTION public.get_booking_by_id(uuid) IS
  'Anti-enumeration: anon kan hämta EN booking om de känner UUID:n. Återskapad 2026-04-27 efter ETA-vy-uppdatering (CASCADE).';

CREATE OR REPLACE FUNCTION public.get_booking_by_session(_session_id text)
RETURNS SETOF public.booking_confirmation
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT * FROM public.booking_confirmation
   WHERE payment_intent_id = _session_id
   LIMIT 1;
$func$;

COMMENT ON FUNCTION public.get_booking_by_session(text) IS
  'Anti-enumeration: tack.html-flow med Stripe session-id. Återskapad 2026-04-27 efter ETA-vy-uppdatering (CASCADE).';

GRANT EXECUTE ON FUNCTION public.get_booking_by_id(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_by_session(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_cols INT;
BEGIN
  SELECT count(*) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='booking_confirmation'
    AND column_name IN ('cleaner_on_way_at','cleaner_eta_at','cleaner_eta_minutes',
                        'manual_delay_minutes','delay_status','predicted_arrival_at');

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 20260427250000 — booking_confirmation Smart-ETA';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  ETA-kolumner i vyn: % / 6 (förväntat: 6)', v_cols;
  RAISE NOTICE '  Magic-link-kunder kan nu se på-väg-banner';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
