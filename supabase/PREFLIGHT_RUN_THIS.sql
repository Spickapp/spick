-- ═══════════════════════════════════════════════════════════════
-- SPICK PRE-FLIGHT CHECKLIST — KÖR ALLT I ETT
-- Datum: 2026-03-30
-- 
-- Kombinerar:
-- 1. Emergency cleanup (hackad data + öppna policies)
-- 2. Security hardening (VIEWs, RLS, triggers, rate limits)
--
-- Kör block för block i Supabase SQL Editor.
-- Varje block är idempotent (säkert att köra flera gånger).
-- ═══════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 1: STÄNG ÖPPNA UPDATE-POLICIES            ║
-- ║  ⚡ KÖR DETTA FÖRST — SÄKERHETSINCIDENT          ║
-- ╚══════════════════════════════════════════════════╝

-- "Cleaner update booking status" hade USING(true) = vem som helst
-- kunde uppdatera vilken bokning som helst via anon API
DROP POLICY IF EXISTS "Cleaner update booking status" ON bookings;
DROP POLICY IF EXISTS "anon_update_cleaners" ON cleaners;
DROP POLICY IF EXISTS "Anon update cleaners" ON cleaners;
DROP POLICY IF EXISTS "Public update cleaners" ON cleaners;

-- Verifiera: inga öppna UPDATE-policies
SELECT tablename, policyname, roles::text, cmd,
  CASE WHEN qual::text = 'true' THEN '⚠️ ÖPPEN' ELSE '✅' END as status
FROM pg_policies 
WHERE schemaname = 'public' AND cmd = 'UPDATE'
ORDER BY tablename;


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 2: RENSA HACKAD DATA + DEMO-STÄDARE       ║
-- ╚══════════════════════════════════════════════════╝

UPDATE cleaners
SET bio = '[Demo-profil — ej riktig städare]'
WHERE bio ILIKE '%PENTEST%' OR bio ILIKE '%HACKED%' 
   OR bio ILIKE '%<script%' OR bio ILIKE '%javascript:%';

UPDATE cleaners
SET status = 'inaktiv', is_approved = false, identity_verified = false,
    bio = '[Demo-profil — ej riktig städare]'
WHERE email IN (
  'olena.k@gmail.com', 'ahmed.h@gmail.com', 'maria.a@gmail.com',
  'fatima.r@gmail.com', 'sara.l@gmail.com', 'kofi.m@gmail.com',
  'natasha.p@gmail.com', 'mohammed.f@gmail.com', 'annalena.b@gmail.com'
);

DELETE FROM bookings
WHERE (email LIKE '%test%' OR email LIKE '%spick-test%' OR name LIKE 'Test %')
  AND payment_status != 'paid';

-- Visa kvarvarande aktiva
SELECT id, full_name, email, city, status, is_approved FROM cleaners 
WHERE is_approved = true ORDER BY full_name;


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 3: SÄKRA VIEWs                            ║
-- ║  Ersätter direkt-access till bookings för anon    ║
-- ╚══════════════════════════════════════════════════╝

-- booking_slots: kalender-data (inga PII)
CREATE OR REPLACE VIEW booking_slots AS
SELECT cleaner_id, date, time, time_end, hours
FROM bookings
WHERE payment_status = 'paid' AND status != 'avbokad';

GRANT SELECT ON booking_slots TO anon, authenticated;

-- booking_confirmation: tack.html + betyg.html (minimal PII)
DROP VIEW IF EXISTS booking_confirmation;
CREATE VIEW booking_confirmation AS
SELECT
  id, stripe_session_id, service, date, time, hours,
  city, total_price, payment_status, rut,
  cleaner_id, cleaner_name, cleaner_email,
  COALESCE(customer_name, name) as customer_name,
  COALESCE(customer_email, email) as customer_email,
  created_at
FROM bookings;

GRANT SELECT ON booking_confirmation TO anon, authenticated;

-- public_stats: aggregate counts (inga PII)
CREATE OR REPLACE VIEW public_stats AS
SELECT
  (SELECT count(*) FROM bookings WHERE payment_status = 'paid') AS total_bookings,
  (SELECT count(*) FROM bookings WHERE payment_status = 'paid' 
    AND created_at > now() - interval '24 hours') AS bookings_today,
  (SELECT count(*) FROM cleaners WHERE is_approved = true AND status = 'godkänd') AS active_cleaners,
  (SELECT COALESCE(round(avg(cleaner_rating)::numeric, 1), 4.9) FROM reviews) AS avg_rating,
  (SELECT count(*) FROM reviews) AS total_reviews;

GRANT SELECT ON public_stats TO anon, authenticated;


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 3b: SAKNADE TABELLER                      ║
-- ║  Tabeller som refereras av andra block            ║
-- ╚══════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS booking_status_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  changed_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_log_booking 
  ON booking_status_log(booking_id);

ALTER TABLE booking_status_log ENABLE ROW LEVEL SECURITY;

-- Bara service_role kan läsa/skriva
CREATE POLICY IF NOT EXISTS "Service role only status log"
  ON booking_status_log FOR ALL
  USING (auth.role() = 'service_role');


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 4: SKÄRPT CLEANER CLAIM RLS               ║
-- ╚══════════════════════════════════════════════════╝

DROP POLICY IF EXISTS "Cleaner claims open bookings" ON bookings;

CREATE POLICY "Approved cleaner claims open bookings" ON bookings
  FOR UPDATE TO authenticated
  USING (
    cleaner_id IS NULL AND payment_status = 'paid'
    AND EXISTS (
      SELECT 1 FROM cleaners 
      WHERE email = auth.jwt()->>'email' 
      AND is_approved = true AND status = 'godkänd'
    )
  )
  WITH CHECK (
    cleaner_id IN (
      SELECT id FROM cleaners 
      WHERE email = auth.jwt()->>'email' AND is_approved = true
    )
  );


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 5: STALE BOOKING CLEANUP-FUNKTION          ║
-- ╚══════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION cleanup_stale_bookings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE deleted_count integer; deleted_ids uuid[];
BEGIN
  WITH expired AS (
    UPDATE bookings
    SET status = 'expired', payment_status = 'expired', updated_at = now()
    WHERE payment_status = 'pending' AND created_at < now() - interval '30 minutes' AND status = 'pending'
    RETURNING id
  )
  SELECT array_agg(id), count(*) INTO deleted_ids, deleted_count FROM expired;
  RETURN jsonb_build_object('cleaned', COALESCE(deleted_count, 0), 'timestamp', now());
END; $$;

REVOKE ALL ON FUNCTION cleanup_stale_bookings() FROM public, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_bookings_stale_cleanup 
  ON bookings (payment_status, created_at) 
  WHERE payment_status = 'pending' AND status = 'pending';


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 6: RATE LIMITING                           ║
-- ╚══════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS rate_limits (
  key text NOT NULL, window_start timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1, PRIMARY KEY (key, window_start)
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text, p_max_requests integer DEFAULT 10, p_window_seconds integer DEFAULT 60
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE current_count integer; window_start timestamptz;
BEGIN
  window_start := date_trunc('minute', now());
  DELETE FROM rate_limits WHERE rate_limits.window_start < now() - (p_window_seconds || ' seconds')::interval;
  SELECT COALESCE(SUM(request_count), 0) INTO current_count FROM rate_limits
  WHERE key = p_key AND rate_limits.window_start > now() - (p_window_seconds || ' seconds')::interval;
  IF current_count >= p_max_requests THEN RETURN false; END IF;
  INSERT INTO rate_limits (key, window_start, request_count) VALUES (p_key, window_start, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET request_count = rate_limits.request_count + 1;
  RETURN true;
END; $$;


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 7: WEBHOOK IDEMPOTENCY                    ║
-- ╚══════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_date ON processed_webhook_events (processed_at);
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION cleanup_old_webhook_events()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM processed_webhook_events WHERE processed_at < NOW() - INTERVAL '7 days';
$$;


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 8: BOOKING VALIDATION TRIGGER              ║
-- ╚══════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION validate_booking_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS NULL AND NEW.customer_email IS NULL THEN
    RAISE EXCEPTION 'Booking must have an email';
  END IF;
  IF NEW.service IS NULL OR NEW.service = '' THEN
    RAISE EXCEPTION 'Booking must have a service type';
  END IF;
  IF NEW.hours IS NOT NULL AND (NEW.hours < 1 OR NEW.hours > 12) THEN
    RAISE EXCEPTION 'Hours must be between 1 and 12';
  END IF;
  IF NEW.total_price IS NOT NULL AND (NEW.total_price < 0 OR NEW.total_price > 50000) THEN
    RAISE EXCEPTION 'Total price out of valid range';
  END IF;
  IF NEW.date IS NOT NULL AND NEW.date::date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot book in the past';
  END IF;
  IF NEW.cleaner_id IS NOT NULL AND NEW.date IS NOT NULL AND NEW.time IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM bookings WHERE cleaner_id = NEW.cleaner_id AND date = NEW.date 
      AND time = NEW.time AND payment_status = 'paid' AND status != 'avbokad' AND id != NEW.id
    ) THEN
      RAISE EXCEPTION 'Cleaner already booked at this time';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_booking ON bookings;
CREATE TRIGGER trg_validate_booking BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION validate_booking_insert();


-- ╔══════════════════════════════════════════════════╗
-- ║  BLOCK 9: CHECK CONSTRAINTS                       ║
-- ╚══════════════════════════════════════════════════╝

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'bookings_price_range') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_price_range 
      CHECK (total_price IS NULL OR (total_price >= 100 AND total_price <= 50000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'bookings_hours_range') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_hours_range 
      CHECK (hours IS NULL OR (hours >= 1 AND hours <= 16));
  END IF;
END; $$;


-- ╔══════════════════════════════════════════════════╗
-- ║  RELOAD + VERIFIERING                             ║
-- ╚══════════════════════════════════════════════════╝

NOTIFY pgrst, 'reload schema';

-- Alla UPDATE-policies (ska inte ha USING(true) för anon)
SELECT tablename, policyname, roles::text, cmd,
  CASE WHEN qual::text = 'true' THEN '⚠️ ÖPPEN' ELSE '✅' END as status
FROM pg_policies WHERE schemaname = 'public' AND cmd = 'UPDATE'
ORDER BY tablename;

-- Aktiva städare
SELECT count(*) as active_cleaners FROM cleaners WHERE is_approved = true;

-- Views
SELECT table_name FROM information_schema.views WHERE table_schema = 'public'
ORDER BY table_name;
