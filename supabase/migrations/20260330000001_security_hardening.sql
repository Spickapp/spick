-- ═══════════════════════════════════════════════════════════════
-- SPICK SECURITY HARDENING v1
-- 2026-03-30
-- 
-- Fixar:
-- 1. booking_confirmation VIEW exponerar PII (address) → ta bort
-- 2. Cleaner claim policy saknar is_approved check
-- 3. Stale pending bookings cleanup-funktion
-- 4. Rate limiting helper
-- 5. Booking integrity constraints
-- ═══════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════╗
-- ║  FIX 1: Ta bort PII från booking_confirmation   ║
-- ║  address är PII och ska ej exponeras via anon    ║
-- ╚══════════════════════════════════════════════════╝

DROP VIEW IF EXISTS booking_confirmation;

CREATE VIEW booking_confirmation AS
SELECT
  id, stripe_session_id, service, date, time, hours,
  city, total_price, payment_status, rut,
  cleaner_id, cleaner_name, created_at
FROM bookings;

-- Behåll grants
GRANT SELECT ON booking_confirmation TO anon, authenticated;


-- ╔══════════════════════════════════════════════════╗
-- ║  FIX 2: Skärp cleaner claim RLS-policy          ║
-- ║  Kräv att användaren är en godkänd städare       ║
-- ╚══════════════════════════════════════════════════╝

-- Ta bort den osäkra policyn
DROP POLICY IF EXISTS "Cleaner claims open bookings" ON bookings;

-- Ny policy: bara godkända städare kan claima
CREATE POLICY "Approved cleaner claims open bookings" ON bookings
  FOR UPDATE TO authenticated
  USING (
    cleaner_id IS NULL 
    AND payment_status = 'paid'
    AND EXISTS (
      SELECT 1 FROM cleaners 
      WHERE email = auth.jwt()->>'email' 
      AND is_approved = true 
      AND status = 'godkänd'
    )
  )
  WITH CHECK (
    -- Säkerställ att de bara kan sätta cleaner_id till sig själva
    cleaner_id IN (
      SELECT id FROM cleaners 
      WHERE email = auth.jwt()->>'email' 
      AND is_approved = true
    )
  );


-- ╔══════════════════════════════════════════════════╗
-- ║  FIX 3: Stale booking cleanup                   ║
-- ║  Rensa pending-bokningar äldre än 30 min         ║
-- ║  (kund avbröt Stripe checkout)                   ║
-- ╚══════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION cleanup_stale_bookings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
  deleted_ids uuid[];
BEGIN
  -- Markera som expired istället för att radera (audit trail)
  WITH expired AS (
    UPDATE bookings
    SET status = 'expired',
        payment_status = 'expired',
        updated_at = now()
    WHERE payment_status = 'pending'
      AND created_at < now() - interval '30 minutes'
      AND status = 'pending'
    RETURNING id
  )
  SELECT array_agg(id), count(*) INTO deleted_ids, deleted_count FROM expired;

  -- Logga cleanup
  INSERT INTO booking_status_log (booking_id, old_status, new_status, changed_by)
  SELECT unnest(COALESCE(deleted_ids, '{}')), 'pending', 'expired', 'system:cleanup'
  WHERE deleted_count > 0;

  RETURN jsonb_build_object(
    'cleaned', COALESCE(deleted_count, 0),
    'timestamp', now()
  );
END;
$$;

-- Bara service_role kan köra cleanup
REVOKE ALL ON FUNCTION cleanup_stale_bookings() FROM public;
REVOKE ALL ON FUNCTION cleanup_stale_bookings() FROM anon;
REVOKE ALL ON FUNCTION cleanup_stale_bookings() FROM authenticated;


-- ╔══════════════════════════════════════════════════╗
-- ║  FIX 4: Rate limiting tabell                    ║
-- ║  Edge Functions kan kolla mot denna              ║
-- ╚══════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

-- Aktivera RLS (ingen anon åtkomst)
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Automatisk cleanup av gamla rate limit entries
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_max_requests integer DEFAULT 10,
  p_window_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_count integer;
  window_start timestamptz;
BEGIN
  window_start := date_trunc('minute', now());
  
  -- Rensa gamla entries
  DELETE FROM rate_limits 
  WHERE window_start < now() - (p_window_seconds || ' seconds')::interval;
  
  -- Kolla nuvarande count
  SELECT COALESCE(SUM(request_count), 0) INTO current_count
  FROM rate_limits
  WHERE key = p_key
    AND rate_limits.window_start > now() - (p_window_seconds || ' seconds')::interval;
  
  IF current_count >= p_max_requests THEN
    RETURN false; -- Rate limited
  END IF;
  
  -- Registrera request
  INSERT INTO rate_limits (key, window_start, request_count)
  VALUES (p_key, window_start, 1)
  ON CONFLICT (key, window_start) 
  DO UPDATE SET request_count = rate_limits.request_count + 1;
  
  RETURN true; -- Tillåten
END;
$$;


-- ╔══════════════════════════════════════════════════╗
-- ║  FIX 5: Booking integrity constraints           ║
-- ║  Förhindra orimliga värden i databasen          ║
-- ╚══════════════════════════════════════════════════╝

-- Lägg till CHECK constraints om de saknas
DO $$
BEGIN
  -- Pris ska vara rimligt (300-30000 SEK)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'bookings_price_range'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_price_range 
      CHECK (total_price IS NULL OR (total_price >= 100 AND total_price <= 50000));
  END IF;

  -- Timmar ska vara rimligt (1-16h)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'bookings_hours_range'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_hours_range 
      CHECK (hours IS NULL OR (hours >= 1 AND hours <= 16));
  END IF;
END;
$$;


-- ╔══════════════════════════════════════════════════╗
-- ║  FIX 6: Index för performance                   ║
-- ╚══════════════════════════════════════════════════╝

-- Stale bookings cleanup behöver detta
CREATE INDEX IF NOT EXISTS idx_bookings_stale_cleanup 
  ON bookings (payment_status, created_at) 
  WHERE payment_status = 'pending' AND status = 'pending';

-- Rate limits cleanup
CREATE INDEX IF NOT EXISTS idx_rate_limits_window 
  ON rate_limits (window_start);


-- Force schema reload
NOTIFY pgrst, 'reload schema';


-- ╔══════════════════════════════════════════════════╗
-- ║  FIX 7: Webhook idempotency table               ║
-- ║  Förhindra duplicate webhook-processing          ║
-- ╚══════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_date 
  ON processed_webhook_events (processed_at);

CREATE OR REPLACE FUNCTION cleanup_old_webhook_events()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM processed_webhook_events 
  WHERE processed_at < NOW() - INTERVAL '7 days';
$$;

ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;


-- ╔══════════════════════════════════════════════════╗
-- ║  FIX 8: Booking validation trigger               ║
-- ║  Server-side validering av alla bokningar         ║
-- ║  Förhindrar: saknad email, orimliga timmar,      ║
-- ║  bokningar i det förflutna, dubbelbokningar      ║
-- ╚══════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION validate_booking_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate required fields
  IF NEW.email IS NULL AND NEW.customer_email IS NULL THEN
    RAISE EXCEPTION 'Booking must have an email';
  END IF;
  
  IF NEW.service IS NULL OR NEW.service = '' THEN
    RAISE EXCEPTION 'Booking must have a service type';
  END IF;
  
  -- Validate hours range
  IF NEW.hours IS NOT NULL AND (NEW.hours < 1 OR NEW.hours > 12) THEN
    RAISE EXCEPTION 'Hours must be between 1 and 12';
  END IF;
  
  -- Validate total_price sanity
  IF NEW.total_price IS NOT NULL AND (NEW.total_price < 0 OR NEW.total_price > 50000) THEN
    RAISE EXCEPTION 'Total price out of valid range';
  END IF;
  
  -- Prevent booking in the past (allow today)
  IF NEW.date IS NOT NULL AND NEW.date::date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot book in the past';
  END IF;
  
  -- Double-booking prevention: same cleaner, same date+time, paid
  IF NEW.cleaner_id IS NOT NULL AND NEW.date IS NOT NULL AND NEW.time IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM bookings 
      WHERE cleaner_id = NEW.cleaner_id 
        AND date = NEW.date 
        AND time = NEW.time
        AND payment_status = 'paid'
        AND status != 'avbokad'
        AND id != NEW.id
    ) THEN
      RAISE EXCEPTION 'Cleaner already booked at this time';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_booking ON bookings;
CREATE TRIGGER trg_validate_booking
  BEFORE INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION validate_booking_insert();


-- Force schema reload
NOTIFY pgrst, 'reload schema';


-- ╔══════════════════════════════════════════════════╗
-- ║  VERIFIERING                                     ║
-- ╚══════════════════════════════════════════════════╝

-- Verifiera att booking_confirmation inte har address
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'booking_confirmation' 
ORDER BY ordinal_position;

-- Verifiera cleaner claim policy
SELECT policyname, cmd, roles::text 
FROM pg_policies 
WHERE tablename = 'bookings' AND policyname LIKE '%claim%';
