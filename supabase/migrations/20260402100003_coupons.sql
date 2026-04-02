-- ============================================================
-- Migration 20260402100003: coupons table + missing columns + seed codes
-- Existing table has: id, code, discount_type, discount_value,
--   max_uses, used_count, expires_at, active, created_at
-- ============================================================

-- 1. Create coupons table (skipped if already exists)
CREATE TABLE IF NOT EXISTS coupons (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT        NOT NULL UNIQUE,
  discount_type   TEXT,
  discount_value  NUMERIC,
  max_uses        INTEGER,
  used_count      INTEGER     DEFAULT 0,
  expires_at      TIMESTAMPTZ,
  active          BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2. Add columns missing from existing table
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS description     TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS currency        TEXT DEFAULT 'SEK';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS min_order_value DECIMAL(10,2) DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_uses_per_user INTEGER DEFAULT 1;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS applies_to      TEXT DEFAULT 'all';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT now();

-- Constraints (idempotent — drop first)
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS valid_discount_type;
ALTER TABLE coupons ADD CONSTRAINT valid_discount_type CHECK (discount_type IN ('percent','fixed'));
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS valid_applies_to;
ALTER TABLE coupons ADD CONSTRAINT valid_applies_to CHECK (applies_to IN ('all','first_booking','recurring','specific_service'));

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_coupons_code      ON coupons (code);
CREATE INDEX IF NOT EXISTS idx_coupons_active     ON coupons (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_coupons_expires    ON coupons (expires_at);

-- 4. Coupon usage tracking
CREATE TABLE IF NOT EXISTS coupon_usages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id   UUID        NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  customer_email TEXT     NOT NULL,
  booking_id  UUID        REFERENCES bookings(id) ON DELETE SET NULL,
  discount_applied DECIMAL(10,2) NOT NULL,
  used_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cu_coupon_id ON coupon_usages (coupon_id);
CREATE INDEX IF NOT EXISTS idx_cu_customer  ON coupon_usages (customer_email);

-- 5. RLS
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active coupons" ON coupons;
CREATE POLICY "Anyone can read active coupons"
  ON coupons FOR SELECT
  USING (active = true AND (expires_at IS NULL OR expires_at > now()));

DROP POLICY IF EXISTS "Admin can manage coupons" ON coupons;
CREATE POLICY "Admin can manage coupons"
  ON coupons FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "Insert coupon usage" ON coupon_usages;
CREATE POLICY "Insert coupon usage"
  ON coupon_usages FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Read own coupon usage" ON coupon_usages;
CREATE POLICY "Read own coupon usage"
  ON coupon_usages FOR SELECT
  USING (true);

-- 6. Auto-increment used_count trigger
CREATE OR REPLACE FUNCTION increment_coupon_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE coupons
  SET used_count  = used_count + 1,
      updated_at  = now()
  WHERE id = NEW.coupon_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_increment_coupon_usage ON coupon_usages;
CREATE TRIGGER trg_increment_coupon_usage
  AFTER INSERT ON coupon_usages
  FOR EACH ROW
  EXECUTE FUNCTION increment_coupon_usage();

-- 7. Seed launch coupons
INSERT INTO coupons (code, description, discount_type, discount_value, max_uses, expires_at, applies_to)
VALUES
  ('RENT50',       'Lansering — 50% rabatt första bokningen',     'percent', 50, 500,  '2026-06-30T23:59:59Z', 'first_booking'),
  ('SPICKVAN50',   'Tipsa en vän — 50% rabatt',                    'percent', 50, NULL, '2026-12-31T23:59:59Z', 'first_booking'),
  ('KOMTILLBAKA',  'Winback — 50% rabatt för återvändande kunder', 'percent', 50, 1000, '2026-09-30T23:59:59Z', 'all')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
SELECT 'MIGRATION 20260402100003 COMPLETE — coupons + coupon_usages + 3 seed codes' AS result;
