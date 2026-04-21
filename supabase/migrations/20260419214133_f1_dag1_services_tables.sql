-- ============================================================
-- F1 Dag 1: Services-tabell + Service Addons
-- ============================================================
-- Written: 2026-04-19
-- Fas: F1 i arkitekturplan v3
-- Design: docs/architecture/fas-1-services-design.md (commit 859594c)
--
-- CONTEXT
-- Centralizes service references to DB. 314 hardcoded occurrences
-- in 50+ files migrated in F1 Dag 2-6 via feature flag.
--
-- NOTES
-- - Uses is_admin() (verified in prod) instead of is_platform_admin()
--   which design document mentioned. Regel #28: no fragmentation of
--   admin-check functions.
-- - Creates set_updated_at() (missing in prod). CREATE OR REPLACE for
--   idempotence if function added in meantime.
-- ============================================================

-- Trigger helper (missing in prod)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- services: main table
CREATE TABLE IF NOT EXISTS public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  label_sv TEXT NOT NULL,
  label_en TEXT,
  description_sv TEXT,
  rut_eligible BOOLEAN NOT NULL DEFAULT false,
  is_b2b BOOLEAN NOT NULL DEFAULT false,
  is_b2c BOOLEAN NOT NULL DEFAULT true,
  hour_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  default_hourly_price INTEGER,
  display_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  icon_key TEXT,
  ui_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS services_active_order_idx
  ON public.services (active, display_order) WHERE active = true;
CREATE INDEX IF NOT EXISTS services_key_idx
  ON public.services (key);

-- service_addons: many-to-one
CREATE TABLE IF NOT EXISTS public.service_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label_sv TEXT NOT NULL,
  label_en TEXT,
  price_sek INTEGER NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, key)
);

CREATE INDEX IF NOT EXISTS service_addons_service_idx
  ON public.service_addons (service_id, active, display_order);

-- Updated_at trigger on services
DROP TRIGGER IF EXISTS services_updated_at ON public.services;
CREATE TRIGGER services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_addons ENABLE ROW LEVEL SECURITY;

-- Public read (anon + authenticated): only active
DROP POLICY IF EXISTS services_public_read ON public.services;
CREATE POLICY services_public_read ON public.services
  FOR SELECT USING (active = true);

DROP POLICY IF EXISTS service_addons_public_read ON public.service_addons;
CREATE POLICY service_addons_public_read ON public.service_addons
  FOR SELECT USING (active = true);

-- Admin write (via existing is_admin())
DROP POLICY IF EXISTS services_admin_write ON public.services;
CREATE POLICY services_admin_write ON public.services
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS service_addons_admin_write ON public.service_addons;
CREATE POLICY service_addons_admin_write ON public.service_addons
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

GRANT SELECT ON public.services TO anon, authenticated;
GRANT SELECT ON public.service_addons TO anon, authenticated;
GRANT ALL ON public.services TO service_role;
GRANT ALL ON public.service_addons TO service_role;

-- Seed: 11 services
INSERT INTO public.services (key, label_sv, rut_eligible, is_b2b, is_b2c, hour_multiplier, display_order, icon_key, default_hourly_price) VALUES
  ('hemstadning',       'Hemstädning',         true,  false, true,  1.00, 10,  'home',    349),
  ('premiumstadning',   'Premiumstädning',     true,  false, true,  1.30, 15,  'premium', 449),
  ('storstadning',      'Storstädning',        true,  false, true,  1.70, 20,  'sparkle', 349),
  ('flyttstadning',     'Flyttstädning',       true,  false, true,  2.20, 30,  'box',     349),
  ('fonsterputs',       'Fönsterputs',         true,  false, true,  1.00, 40,  'window',  349),
  ('mattrengoring',     'Mattrengöring',       true,  false, true,  1.00, 50,  'rug',     NULL),
  ('kontorsstadning',   'Kontorsstädning',     false, true,  false, 1.00, 100, 'office',  449),
  ('trappstadning',     'Trappstädning',       false, true,  false, 1.00, 110, 'stairs',  449),
  ('skolstadning',      'Skolstädning',        false, true,  false, 1.00, 120, 'school',  449),
  ('vardstadning',      'Vårdstädning',        false, true,  false, 1.00, 130, 'care',    499),
  ('hotell_restaurang', 'Hotell & restaurang', false, true,  false, 1.00, 140, 'hotel',   499)
ON CONFLICT (key) DO NOTHING;

-- Addon seed (hemstadning -> ugnsrengoring)
INSERT INTO public.service_addons (service_id, key, label_sv, price_sek, display_order)
SELECT id, 'ugnsrengoring', 'Ugnsrengöring', 295, 10
FROM public.services WHERE key = 'hemstadning'
ON CONFLICT (service_id, key) DO NOTHING;

-- Post-check queries (run in Supabase Studio after deploy):
--   SELECT COUNT(*) FROM services;                    -- Expected: 11
--   SELECT COUNT(*) FROM service_addons;              -- Expected: 1
--   SELECT key, label_sv, rut_eligible, is_b2c, hour_multiplier
--     FROM services ORDER BY display_order;
--   SET LOCAL ROLE anon;
--   SELECT COUNT(*) FROM services;                    -- Expected: 11 (RLS OK)
--   RESET ROLE;
-- ============================================================
