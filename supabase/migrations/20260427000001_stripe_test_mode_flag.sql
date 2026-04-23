-- ============================================================
-- Dual-key Stripe infrastructure — stripe_test_mode feature flag
-- ============================================================
--
-- Låter Farhad toggla booking-create + stripe-webhook mellan
-- LIVE-nycklar (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) och
-- TEST-nycklar (STRIPE_SECRET_KEY_TEST, STRIPE_WEBHOOK_SECRET_TEST)
-- utan kod-ändring eller re-deploy.
--
-- Användning:
--   UPDATE platform_settings SET value='true'  WHERE key='stripe_test_mode';
--   -- Testa med 4242-kort
--   UPDATE platform_settings SET value='false' WHERE key='stripe_test_mode';
--
-- FÖRUTSÄTTNINGAR (Farhad sätter upp före första true-flippen):
--   1. Supabase Dashboard → Edge Functions → Secrets:
--      STRIPE_SECRET_KEY_TEST   = sk_test_... (från Stripe → API keys → Testmode)
--      STRIPE_WEBHOOK_SECRET_TEST = whsec_... (från Stripe Dashboard → Webhooks → Testmode endpoint)
--   2. Stripe Dashboard Testmode:
--      Lägg till test-webhook endpoint som pekar på samma URL som live:
--      https://urjeijcncsyuletprydy.supabase.co/functions/v1/stripe-webhook
--      (Stripe signerar events med livemode=false för test-endpoints)
--
-- SÄKERHETSMODELL:
--   stripe-webhook läser event.livemode (native Stripe-flag) för att
--   avgöra secret att verifiera med — ENKEL & SÄKER.
--
--   booking-create läser platform_settings.stripe_test_mode — KRÄVER
--   explicit toggle (skyddar mot oavsiktligt test-mode på prod).
--
-- REVERSIBEL:
--   DELETE FROM platform_settings WHERE key='stripe_test_mode';
--   Kod faller tillbaka till live-mode default.
--
-- Regler: #27 scope (seed-only, ingen kodändring i denna migration),
-- #28 single source (platform_settings), #30 (Stripe-regler verifieras
-- via event.livemode-flag, inga antaganden), #31 (primärkälla =
-- Stripe API dokumentation).
-- ============================================================

INSERT INTO platform_settings (key, value, description)
VALUES (
  'stripe_test_mode',
  'false',
  'När ''true'': booking-create använder STRIPE_SECRET_KEY_TEST. stripe-webhook auto-detekterar test-events via event.livemode (inget manuellt skifte behövs). När ''false'' (default): live-mode. Toggla för test med 4242-kort utan att påverka live-kunder.'
)
ON CONFLICT (key) DO NOTHING;

SELECT 'MIGRATION 20260427000001 COMPLETE — stripe_test_mode flag seeded' AS result;
