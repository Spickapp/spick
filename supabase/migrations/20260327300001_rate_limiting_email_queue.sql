-- ═══════════════════════════════════════════════════════
-- SPICK – Rate limiting, email queue, RLS-härdning
-- ═══════════════════════════════════════════════════════

-- 1. Rate limit tabell
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expire ON rate_limits(window_start);

-- 2. Rate limit funktion
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT, p_max INT DEFAULT 10, p_window_minutes INT DEFAULT 60
) RETURNS BOOLEAN AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COALESCE(SUM(count), 0) INTO v_count
  FROM rate_limits
  WHERE key = p_key AND window_start > now() - (p_window_minutes || ' minutes')::INTERVAL;
  
  IF v_count >= p_max THEN RETURN FALSE; END IF;
  
  INSERT INTO rate_limits (key, window_start, count)
  VALUES (p_key, date_trunc('minute', now()), 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Cleanup-funktion
CREATE OR REPLACE FUNCTION cleanup_rate_limits() RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_start < now() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Rate-limited RLS policies
DROP POLICY IF EXISTS "Public insert bookings" ON bookings;
CREATE POLICY "Rate limited insert bookings" ON bookings FOR INSERT
  WITH CHECK (check_rate_limit('booking:' || COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', 'unknown'), 5, 60));

DROP POLICY IF EXISTS "Public insert applications" ON cleaner_applications;
CREATE POLICY "Rate limited insert applications" ON cleaner_applications FOR INSERT
  WITH CHECK (check_rate_limit('apply:' || COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', 'unknown'), 3, 60));

DROP POLICY IF EXISTS "Public insert reviews" ON reviews;
CREATE POLICY "Rate limited insert reviews" ON reviews FOR INSERT
  WITH CHECK (check_rate_limit('review:' || COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', 'unknown'), 10, 60));

DROP POLICY IF EXISTS "Public insert messages" ON messages;
CREATE POLICY "Rate limited insert messages" ON messages FOR INSERT
  WITH CHECK (check_rate_limit('msg:' || COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', 'unknown'), 5, 60));

-- 5. RLS på rate_limits
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON rate_limits FOR ALL USING (auth.role() = 'service_role');

-- 6. Email retry-kö
CREATE TABLE IF NOT EXISTS email_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  next_retry_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_queue_pending ON email_queue(status, next_retry_at) WHERE status = 'pending';
ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only email_queue" ON email_queue FOR ALL USING (auth.role() = 'service_role');
