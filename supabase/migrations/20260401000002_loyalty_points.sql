-- ═══════════════════════════════════════════════════════════════
-- loyalty_points — Spick Spark-lojalitetssystem
-- 1 Spark per bokad timme när bokning → status='klar'
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS loyalty_points (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email TEXT        NOT NULL,
  points         INT         NOT NULL DEFAULT 0,
  tier           TEXT        NOT NULL DEFAULT 'ny',
  total_earned   INT         NOT NULL DEFAULT 0,
  last_updated   TIMESTAMPTZ DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (customer_email)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_email ON loyalty_points (customer_email);

ALTER TABLE loyalty_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customer read own points" ON loyalty_points;
CREATE POLICY "Customer read own points" ON loyalty_points
  FOR SELECT USING (
    customer_email = (current_setting('request.jwt.claims', true)::json->>'email')
  );

DROP POLICY IF EXISTS "Service role full access" ON loyalty_points;
CREATE POLICY "Service role full access" ON loyalty_points
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger: tilldela poäng vid statusbyte till 'klar'
CREATE OR REPLACE FUNCTION award_loyalty_points() RETURNS TRIGGER AS $$
DECLARE
  v_hours  INT;
  v_email  TEXT;
  v_points INT;
BEGIN
  IF NEW.status = 'klar'
     AND OLD.status IS DISTINCT FROM 'klar'
     AND NEW.payment_status = 'paid'
  THEN
    v_email  := NEW.customer_email;
    v_hours  := GREATEST(COALESCE(NEW.booking_hours::int, 0), 0);
    v_points := v_hours;

    IF v_email IS NOT NULL AND v_points > 0 THEN
      INSERT INTO loyalty_points (customer_email, points, total_earned, last_updated)
      VALUES (v_email, v_points, v_points, now())
      ON CONFLICT (customer_email) DO UPDATE SET
        points       = loyalty_points.points + v_points,
        total_earned = loyalty_points.total_earned + v_points,
        last_updated = now();

      -- Uppdatera tier baserat på total_earned efter upsert
      UPDATE loyalty_points SET tier =
        CASE
          WHEN total_earned >= 1000 THEN 'vip'
          WHEN total_earned >= 500  THEN 'guld'
          WHEN total_earned >= 200  THEN 'stjarna'
          ELSE 'ny'
        END
      WHERE customer_email = v_email;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS after_booking_complete ON bookings;
CREATE TRIGGER after_booking_complete
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION award_loyalty_points();

GRANT SELECT ON loyalty_points TO authenticated;
GRANT ALL    ON loyalty_points TO service_role;
