-- Sprint C-4 (2026-04-28): Addon-matching schema
-- Primarkalla: docs/audits/2026-04-26-modell-c-flexibel-matching.md §4
-- Verifierat mot prod 2026-04-28:
--   - service_addons finns (1 rad: Ugnsrengoring 295 kr)
--   - cleaner_addon_capabilities saknas (PGRST205)
--   - bookings.selected_addons saknas (42703)
--
-- Studio-kompatibel: inget BEGIN/COMMIT-wrap (Studio hanterar egen
-- transaktion), ingen DO-block (LINE 0 parser-quirk), ingen unicode.

-- 1. cleaner_addon_capabilities
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
  'Sprint C-4: Mappning cleaner -> service_addon. Saknad rad = default-allow via platform_settings.addon_capabilities_default_allow.';

-- 2. RLS
ALTER TABLE public.cleaner_addon_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read cleaner_addon_capabilities (all)" ON public.cleaner_addon_capabilities;
CREATE POLICY "Read cleaner_addon_capabilities (all)"
  ON public.cleaner_addon_capabilities
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role manage cleaner_addon_capabilities" ON public.cleaner_addon_capabilities;
CREATE POLICY "Service role manage cleaner_addon_capabilities"
  ON public.cleaner_addon_capabilities
  FOR ALL
  USING (auth.role() = 'service_role');

-- 3. Trigger: updated_at
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

-- 4. bookings.selected_addons
-- Format: [{ "addon_id": "...", "key": "ugnsrengoring", "label": "Ugnsrengoring", "price_sek_snapshot": 295 }]
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS selected_addons jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bookings.selected_addons IS
  'Sprint C-4: JSONB-array av valda addons med price_sek_snapshot vid bokningstillfalle.';

-- 5. platform_settings seed
INSERT INTO public.platform_settings (key, value, description, updated_at)
VALUES
  ('addon_capabilities_default_allow', 'true',
   'Sprint C-4: Om cleaner saknar rader i cleaner_addon_capabilities, anta att hen kan alla addons. Satt till false nar alla cleaners seed:at explicit.',
   now()),
  ('addon_matching_enabled', 'true',
   'Sprint C-4: Kill-switch for addon-matching i find_nearby_providers. false = ignorera required_addons-param helt.',
   now())
ON CONFLICT (key) DO NOTHING;
