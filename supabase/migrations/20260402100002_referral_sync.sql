-- ============================================================
-- Migration 20260402100002: cleaner_referrals + review sync trigger
-- Fixes table name mismatch — code references cleaner_referrals
-- but only referrals exists. Creates proper table and sync triggers.
-- ============================================================

-- 1. Create cleaner_referrals table (referenced by referral-register/index.ts)
CREATE TABLE IF NOT EXISTS cleaner_referrals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id      UUID        NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  referred_email  TEXT        NOT NULL,
  booking_id      UUID        REFERENCES bookings(id) ON DELETE SET NULL,
  status          TEXT        NOT NULL DEFAULT 'pending',
  reward_amount   INTEGER     DEFAULT 200,
  reward_paid     BOOLEAN     DEFAULT false,
  reward_paid_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  converted_at    TIMESTAMPTZ,
  CONSTRAINT valid_referral_status CHECK (status IN ('pending','converted','rewarded','expired'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_cr_cleaner_id     ON cleaner_referrals (cleaner_id);
CREATE INDEX IF NOT EXISTS idx_cr_referred_email ON cleaner_referrals (referred_email);
CREATE INDEX IF NOT EXISTS idx_cr_status         ON cleaner_referrals (status);
CREATE INDEX IF NOT EXISTS idx_cr_booking_id     ON cleaner_referrals (booking_id) WHERE booking_id IS NOT NULL;

-- 2. RLS
ALTER TABLE cleaner_referrals ENABLE ROW LEVEL SECURITY;

-- Cleaners can see their own referrals
DROP POLICY IF EXISTS "Cleaners read own referrals" ON cleaner_referrals;
CREATE POLICY "Cleaners read own referrals"
  ON cleaner_referrals FOR SELECT
  USING (auth.uid() = cleaner_id);

-- Edge functions (service_role) can insert
DROP POLICY IF EXISTS "Service role can insert referrals" ON cleaner_referrals;
CREATE POLICY "Service role can insert referrals"
  ON cleaner_referrals FOR INSERT
  WITH CHECK (true);

-- Service role can update (mark as converted/rewarded)
DROP POLICY IF EXISTS "Service role can update referrals" ON cleaner_referrals;
CREATE POLICY "Service role can update referrals"
  ON cleaner_referrals FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 3. Review sync trigger — keep avg_rating and review_count on cleaners in sync
--    reviews may be a VIEW in production, so we detect the underlying table
--    and attach the trigger there instead.
CREATE OR REPLACE FUNCTION sync_cleaner_review_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cleaners SET
    avg_rating   = COALESCE(sub.avg, 0),
    review_count = COALESCE(sub.cnt, 0)
  FROM (
    SELECT
      cleaner_id,
      ROUND(AVG(rating)::numeric, 1)  AS avg,
      COUNT(*)::integer                AS cnt
    FROM reviews
    WHERE cleaner_id = COALESCE(NEW.cleaner_id, OLD.cleaner_id)
    GROUP BY cleaner_id
  ) sub
  WHERE cleaners.id = sub.cleaner_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to the real base table behind reviews (table or view)
DO $$
DECLARE
  _base_table TEXT;
  _is_view    BOOLEAN;
BEGIN
  -- Check if 'reviews' is a view
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'reviews'
  ) INTO _is_view;

  IF _is_view THEN
    -- Extract the first base table from the view definition
    SELECT DISTINCT cl.relname INTO _base_table
    FROM pg_rewrite rw
    JOIN pg_depend d  ON d.objid = rw.oid
    JOIN pg_class  cl ON cl.oid  = d.refobjid
    WHERE rw.ev_class = (SELECT oid FROM pg_class WHERE relname = 'reviews' AND relnamespace = 'public'::regnamespace)
      AND cl.relkind   = 'r'        -- ordinary table
      AND cl.relname  != 'reviews'   -- not self-reference
    LIMIT 1;

    IF _base_table IS NULL THEN
      -- Fallback: if view wraps the same-name table in another schema, skip trigger
      RAISE NOTICE 'reviews is a view but no base table found — skipping trigger';
      RETURN;
    END IF;
  ELSE
    _base_table := 'reviews';
  END IF;

  -- Drop old trigger on both possible targets
  EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_review_stats ON %I', _base_table);
  DROP TRIGGER IF EXISTS trg_sync_review_stats ON reviews;

  -- Create trigger on the real table
  EXECUTE format(
    'CREATE TRIGGER trg_sync_review_stats
       AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW
       EXECUTE FUNCTION sync_cleaner_review_stats()',
    _base_table
  );

  RAISE NOTICE 'trg_sync_review_stats attached to table: %', _base_table;
END $$;

-- 4. Auto-convert referral when a booking is completed
CREATE OR REPLACE FUNCTION auto_convert_referral()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE cleaner_referrals
    SET status       = 'converted',
        converted_at = now(),
        booking_id   = NEW.id
    WHERE referred_email = NEW.customer_email
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_convert_referral ON bookings;
CREATE TRIGGER trg_auto_convert_referral
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION auto_convert_referral();

-- ============================================================
SELECT 'MIGRATION 20260402100002 COMPLETE — cleaner_referrals + review sync triggers' AS result;
