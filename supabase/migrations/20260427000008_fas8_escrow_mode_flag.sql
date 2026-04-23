-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 8 §8.2: escrow_mode feature-flag
-- ═══════════════════════════════════════════════════════════════
--
-- Gör Stripe-architecture-shift (destination → separate charges)
-- styrbar via platform_settings-flag. Default 'legacy' bevarar
-- existerande beteende 100%.
--
-- VALUES:
--   'legacy'     — destination charges + application_fee (nuvarande)
--   'escrow_v2'  — separate charges, pengar på plattformskonto,
--                  transfer via escrow-release-EF efter attest
--
-- MIGRATION PATH för Farhad:
--   1. Denna migration körs → escrow_mode='legacy' (ingen ändring)
--   2. booking-create + stripe-webhook-retrofit deploy:as
--   3. När backend verifierad: UPDATE platform_settings
--        SET value='escrow_v2' WHERE key='escrow_mode'
--      → NYA bookings går genom escrow-state-machine
--      → Gamla bookings (escrow_state='released_legacy') oförändrade
--
-- REGLER: #26 grep platform_settings-schema (finns, key/value text),
-- #27 scope (bara 1 rad INSERT), #28 SSOT = denna key,
-- #30 Stripe-regler verifierade mot docs.stripe.com/connect
-- (separate-charges-and-transfers är giltig multi-party-pattern),
-- #31 platform_settings-tabellen är primärkälla för feature-flags.
-- ═══════════════════════════════════════════════════════════════

-- platform_settings har bara (id, key, value, updated_at) — ingen
-- description-kolumn (verifierat mot prod-schema 2026-04-23).
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES (
  'escrow_mode',
  'legacy',
  now()
)
ON CONFLICT (key) DO NOTHING;

-- Verifiering:
-- SELECT key, value FROM platform_settings WHERE key = 'escrow_mode';
-- Förväntat: 1 rad, value='legacy'
