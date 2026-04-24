-- ============================================================
-- Sprint C-4 (2026-04-28): Addon-matching schema
-- ============================================================
-- Syfte: Låt kund välja addons (extra-tjänster) för en bokning och
-- låt matching exkludera cleaners som inte kan utföra alla valda
-- addons. Prissätter addons som engångs-summa ovanpå basen.
--
-- Primärkälla: docs/audits/2026-04-26-modell-c-flexibel-matching.md §4
-- Schema-beslut verifierat mot prod 2026-04-28:
--   - service_addons finns (1 test-rad: Ugnsrengöring/295 kr/Hemstädning)
--   - cleaner_addon_capabilities finns INTE (PGRST205)
--   - bookings.selected_addons finns INTE (42703)
--
-- Regler:
--   #26 — grep-före-edit: service_addons-schema lästt, providers-RPC lästt
--   #27 — scope: schema + settings-seed. RPC-patch sker i separat migration.
--   #28 — SSOT: cleaner_addon_capabilities + bookings.selected_addons är
--         nya kanoniska källor. Inga duplikat-tabeller.
--   #30 — fallback-beslut (default_allow=true) konfigurerat via
--         platform_settings så Farhad kan ändra utan kod-deploy
--   #31 — prod-state verifierat via REST-probe INNAN SQL skrivs
-- ============================================================

BEGIN;

-- ============================================================
-- 1. cleaner_addon_capabilities
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cleaner_addon_capabilities (
  cleaner_id   uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  addon_id     uuid NOT NULL REFERENCES public.service_addons(id) ON DELETE CASCADE,
  can_perform  boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cleaner_id, addon_id)
);

CREATE INDEX IF NOT EXISTS idx_cleaner_addon_capabilities_addon
  ON public.cleaner_addon_capabilities(addon_id);

COMMENT ON TABLE public.cleaner_addon_capabilities IS
  'Sprint C-4 (2026-04-28): Mappning cleaner → service_addon med can_perform-flagga. '
  'Saknad rad = default-allow (konfigurerbart via platform_settings.addon_capabilities_default_allow). '
  'Används av find_nearby_providers för matching-filter.';

-- RLS
ALTER TABLE public.cleaner_addon_capabilities ENABLE ROW LEVEL SECURITY;

-- Läs: authenticated-users (behöver för boka.html matching + cleaner-dashboard)
DROP POLICY IF EXISTS "Read cleaner_addon_capabilities (all)" ON public.cleaner_addon_capabilities;
CREATE POLICY "Read cleaner_addon_capabilities (all)"
  ON public.cleaner_addon_capabilities
  FOR SELECT
  USING (true);

-- Skriv: bara service_role (admin-UI använder service_role via EF-wrapper,
-- cleaner-self-manage via separat EF med ownership-check)
DROP POLICY IF EXISTS "Service role manage cleaner_addon_capabilities" ON public.cleaner_addon_capabilities;
CREATE POLICY "Service role manage cleaner_addon_capabilities"
  ON public.cleaner_addon_capabilities
  FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger: updated_at
CREATE OR REPLACE FUNCTION public.tg_cleaner_addon_capabilities_updated_at()
RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleaner_addon_capabilities_updated_at ON public.cleaner_addon_capabilities;
CREATE TRIGGER trg_cleaner_addon_capabilities_updated_at
  BEFORE UPDATE ON public.cleaner_addon_capabilities
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_cleaner_addon_capabilities_updated_at();

-- ============================================================
-- 2. bookings.selected_addons
-- ============================================================
-- Format (jsonb-array):
--   [{ "addon_id": "...", "key": "ugnsrengoring", "label": "Ugnsrengöring", "price_sek_snapshot": 295 }]
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS selected_addons jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bookings.selected_addons IS
  'Sprint C-4 (2026-04-28): JSONB-array av valda addons med price_sek_snapshot '
  'vid bokningstillfälle. Oförändrad efter insert (historical snapshot).';

-- ============================================================
-- 3. platform_settings seed
-- ============================================================
-- Default-allow = true innebär: om cleaner saknar rader i
-- cleaner_addon_capabilities → anta att hen kan alla valda addons.
-- Backwards-kompatibel fallback, inga aktiva cleaners utesluts idag.
-- Ändra till 'false' när alla cleaners har seed:at sina capabilities
-- (då kräver matching explicit can_perform=true per addon).
INSERT INTO public.platform_settings (key, value, description, updated_at)
VALUES
  ('addon_capabilities_default_allow', 'true',
   'Sprint C-4: Om cleaner saknar cleaner_addon_capabilities-rader, anta att hen kan alla addons. Sätt till false när alla cleaners seed:at explicit.',
   now()),
  ('addon_matching_enabled', 'true',
   'Sprint C-4: Kill-switch för addon-matching i find_nearby_providers. false = ignorera required_addons-param helt.',
   now())
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. Verifiering
-- ============================================================
-- Not: $do$ istället för $$ pga Supabase Studio SQL Editor-quirk
-- (tidigare fix i Fas 8 + Fas 9 §9.6).
DO $do$
DECLARE
  v_table_exists boolean;
  v_column_exists boolean;
  v_setting_count integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cleaner_addon_capabilities'
  ) INTO v_table_exists;
  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'C-4: cleaner_addon_capabilities-tabell skapades inte';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'selected_addons'
  ) INTO v_column_exists;
  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'C-4: bookings.selected_addons-kolumn lades inte till';
  END IF;

  SELECT COUNT(*) INTO v_setting_count
  FROM public.platform_settings
  WHERE key IN ('addon_capabilities_default_allow', 'addon_matching_enabled');
  IF v_setting_count < 2 THEN
    RAISE EXCEPTION 'C-4: platform_settings-seed ofullständig (% av 2)', v_setting_count;
  END IF;

  RAISE NOTICE 'C-4 schema OK: cleaner_addon_capabilities, bookings.selected_addons, platform_settings';
END
$do$;

COMMIT;
