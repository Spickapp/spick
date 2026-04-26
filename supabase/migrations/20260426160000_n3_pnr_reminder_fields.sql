-- N3 Sprint 3 — auto-påminnelser för pending_bankid-bokningar
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   N3 Sprint 2 lade in 'pending_bankid'-status som flagga i bookings när
--   kund signerar BankID asynkront (efter VD skickat länk). Risk: kund
--   glömmer signera → RUT förloras vid SKV-rapportering.
--
--   Sprint 3: cron-jobb skickar SMS-påminnelse vid 24h och 72h utan
--   signering. Vid 7 dagar: bokningens method auto-faller till 'unverified'
--   (kvarstår booking, men markeras som non-RUT).
--
-- Verifiering (rule #31, 2026-04-26):
--   bookings.pnr_verification_method finns
--   bookings.customer_pnr_reminder_sent_at finns INTE (42703)
--   bookings.customer_pnr_reminder_count finns INTE (42703)
--
-- Idempotens: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_pnr_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_pnr_reminder_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bookings_pending_bankid_reminders
  ON public.bookings(created_at DESC)
  WHERE pnr_verification_method = 'pending_bankid';

COMMENT ON COLUMN public.bookings.customer_pnr_reminder_sent_at IS
  'N3 Sprint 3 (2026-04-26): senaste tidpunkt SMS-påminnelse skickades till kund för PNR-signering.';
COMMENT ON COLUMN public.bookings.customer_pnr_reminder_count IS
  'N3 Sprint 3: antal påminnelser skickade. Max 3 (24h, 72h, 168h timeout).';

-- Platform-settings för konfiguration
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('n3_reminder_first_after_hours', '24', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('n3_reminder_second_after_hours', '72', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('n3_reminder_timeout_hours', '168', NOW())  -- 7 dagar
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('n3_reminder_enabled', 'true', NOW())
ON CONFLICT (key) DO NOTHING;
