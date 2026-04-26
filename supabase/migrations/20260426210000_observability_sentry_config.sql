-- Fas 10 Observability — Sentry-konfiguration via platform_settings
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: Spick når 100% Fas 10 Observability. Sentry-integration kodad
--          i _shared/sentry.ts + js/config.js. DSN måste sättas av Farhad
--          efter att Sentry-projekt skapats.
--
-- Dessa rader är PLACEHOLDERS. När Farhad skapat sentry.io-konto + projekt:
--   1. Frontend: byt SPICK.SENTRY_DSN i js/config.js (DSN är public per
--      Sentry's design — säker att hardcoda)
--   2. Backend: sätt SENTRY_DSN secret i Supabase EF-environment
--      (supabase secrets set SENTRY_DSN=https://...)
--
-- Detta INSERT behövs INTE för funktion — det är bara documentation/visibility
-- i admin-dashboard så Farhad kan se status. Faktiskt aktivering sker via
-- env-variabler (frontend hardcoded constant + backend Supabase secret).
--
-- Verifiering rule #31:
--   - platform_settings-tabell finns (verifierad många gånger denna session)
--   - Idempotent ON CONFLICT
-- ════════════════════════════════════════════════════════════════════

INSERT INTO public.platform_settings (key, value, description)
VALUES
  ('sentry_enabled', 'false', 'Fas 10: Sentry observability aktiverad? Sätt true när DSN konfigurerat.'),
  ('sentry_environment', 'production', 'Fas 10: Sentry environment-tag (production/staging/test).'),
  ('sentry_dsn_status', 'NOT_CONFIGURED', 'Fas 10: STATUS-flag (NOT_CONFIGURED|ACTIVE|FAILED). Bara info — riktig DSN bor i js/config.js (frontend) + Supabase-secret SENTRY_DSN (backend).')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.platform_settings IS
  'Central konfiguration. Fas 10 (2026-04-26): sentry_* nycklar tillagda för observability-status.';
