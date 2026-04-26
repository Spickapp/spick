-- Företags-hero-färg — enkel färgväljare som alternativ till bild
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: Zivar-feedback efter hero-bg-bild-flow: "kanske kan välja
--          färg bara enkelt?". De flesta VDs har brand-color men inte
--          brand-image, så färgväljare är enklare första steg.
--
-- Prioritetsordning (foretag.html):
--   1. hero_bg_url (custom bild) — högst prio
--   2. hero_bg_color (custom hex) — mellanprio
--   3. nameToColor(co.name) — fallback (befintligt beteende)
--
-- Verifiering rule #31:
--   - companies.hero_bg_color → 42703 (saknas) ✓ migration behövs
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS hero_bg_color text;

COMMENT ON COLUMN public.companies.hero_bg_color IS
  'Hex-färg (t.ex. #0F6E56) för hero-bakgrund på foretag.html. Lägre prio än hero_bg_url. Fallback: dynamic-color-gradient från company_name. Tillagd 2026-04-26.';

-- Validering: bara giltiga hex-färger (#RRGGBB eller #RGB)
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_hero_bg_color_format_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_hero_bg_color_format_check
  CHECK (hero_bg_color IS NULL OR hero_bg_color ~ '^#[0-9a-fA-F]{3,8}$');
