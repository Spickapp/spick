-- N3 Sprint 1 — PNR-verifiering schema
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   Manuell-booking-modal i stadare-dashboard tar PNR utan BankID-bevis.
--   Risk: VD anger fel PNR (medvetet/omedvetet) → SKV nekar RUT-ansökan
--   eller — värre — RUT-fusk.
--
-- N3 (full robust): bokningar kan utföras pre-PNR-verifiering, RUT
-- triggas BARA när PNR är BankID-verifierad. Spårning via 3 nya
-- bookings-kolumner.
--
-- Verifiering (rule #31, 2026-04-26):
--   - Alla 3 kolumner 42703 (saknas) — bekräftat
--   - customer_profiles.rut_ytd_used_sek finns (RLS-skyddad)
--   - rut_consents.purpose finns (TIC #1-handoff verifierad tidigare)
--
-- Schema-tillägg:
--   1. bookings.pnr_verification_method (enum)
--   2. bookings.pnr_verified_at (timestamp)
--   3. bookings.customer_pnr_verification_session_id (FK rut_consents)
--   4. platform_settings.pnr_verification_required ('soft' default)
--
-- Idempotens: ADD COLUMN IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. bookings — PNR-verifierings-spårning ────────────────────────
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pnr_verification_method TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pnr_verified_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS customer_pnr_verification_session_id UUID
  REFERENCES public.rut_consents(id) ON DELETE SET NULL;

-- CHECK-constraint för pnr_verification_method
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_pnr_verification_method_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_pnr_verification_method_check
  CHECK (pnr_verification_method IS NULL OR pnr_verification_method IN (
    'bankid',           -- BankID-bunden via TIC SPAR (starkast)
    'manual_klartext',  -- VD angav klartext (svagast — risk för fel)
    'unverified',       -- Bokning utförd utan PNR (RUT förloras)
    'pending_bankid'    -- Väntar på kund att signera (SMS-flow)
  ));

COMMENT ON COLUMN public.bookings.pnr_verification_method IS
  'N3 (2026-04-26): vilken metod användes för att verifiera kundens PNR. NULL = ej PNR-relevant (icke-RUT-tjänst).';
COMMENT ON COLUMN public.bookings.pnr_verified_at IS
  'Timestamp när PNR-verifieringen slutfördes (BankID-signering eller manuell input).';
COMMENT ON COLUMN public.bookings.customer_pnr_verification_session_id IS
  'FK till rut_consents-rad med BankID-bevis. NULL för manual_klartext.';

-- Index för "väntar PNR-verifiering"-vy
CREATE INDEX IF NOT EXISTS idx_bookings_pending_pnr_verification
  ON public.bookings(created_at DESC)
  WHERE pnr_verification_method = 'pending_bankid';

-- ── 2. platform_settings.pnr_verification_required ─────────────────
-- 'off'  = ingen check (development)
-- 'soft' = varning vid manual_klartext men tillåt (default)
-- 'hard' = blockera manuell-booking utan BankID, kräv kund-signering
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('pnr_verification_required', 'soft', NOW())
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN public.platform_settings.value IS
  'pnr_verification_required: off|soft|hard — soft default tillåter klartext-input med varning. hard = BankID-bunden krävd för RUT-bokningar.';
