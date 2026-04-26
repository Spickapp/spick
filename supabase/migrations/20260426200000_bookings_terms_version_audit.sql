-- bookings.terms_version — audit-trail för vilken kundvillkors-version kunden accepterade
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: kundvillkor.html v1.0 publicerad live (15 §§) — vi behöver
--          spåra exakt vilken version varje booking accepterades under.
--
-- Användning:
--   - booking-create EF läser version från frontend och sparar i denna kolumn
--   - Vid framtida villkors-ändring (§14.2 — 30 dagars varsel) bumpar vi
--     CURRENT_TERMS_VERSION-konstanten i frontend + EF, så nya bokningar
--     får ny version medan gamla bookings behåller sin historik
--   - ARN/jurist-tvist: vi kan visa exakt vilka villkor som gällde vid bokning
--
-- Verifiering rule #31 (2026-04-26):
--   curl mot bookings.terms_version → 42703 (column does not exist)
--   bookings-tabellen finns + är RLS-aktiv
--
-- Idempotens: ADD COLUMN IF NOT EXISTS
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS terms_version text;

COMMENT ON COLUMN public.bookings.terms_version IS
  'Version av kundvillkoren som kunden accepterade vid bokningstillfället. Format: "1.0", "1.1" etc. Spårbart för ARN/jurist-tvister + GDPR-audit. Tillagd 2026-04-26 vid v1.0-publicering.';

-- Backfill historiska bookings till "0.x-pre-v1" så vi vet att de gjordes
-- INNAN v1.0-publiceringen (de hade gamla 12-§-villkoren). Detta är för
-- att skilja "saknad data" från "äldre villkor".
UPDATE public.bookings
SET terms_version = '0.x-pre-v1'
WHERE terms_version IS NULL;
