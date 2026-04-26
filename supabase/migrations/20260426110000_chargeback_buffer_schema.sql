-- Chargeback-buffer 5% per transfer — schema + flag-gating
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   Stripe/Visa/MC tillåter chargeback upp till 180 dagar EFTER kort-
--   betalning. Idag: Spick transfererar ~3 dagar efter attest → 177
--   dagars exponering där företag/cleaner kan ha "tagit pengarna och
--   försvunnit" om chargeback kommer.
--
--   Lösning: reservera 5% av cleaner-share i intern buffer per transfer.
--   Frigör efter 180 dagar (chargeback-fönster passerat). Vid chargeback
--   inom fönstret: dra från buffer först.
--
-- Design-källa: docs/design/2026-04-26-chargeback-buffer-design.md
-- Etapp 1: schema + helpers, FLAG-OFF (ingen money-flow-impact).
-- Etapp 2-4: kräver Farhad-OK + jurist-bedömning.
--
-- Verifiering (rule #31, 2026-04-26):
--   curl chargeback_buffer → 404 (ej existerande)
--   curl chargebacks → 404 (ej existerande)
--   curl payout_audit_log → 401 (existerar, RLS-skyddad)
--   curl bookings.checkin_distance_m → ja (existerar)
--
-- Idempotens: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. chargeback_buffer — running balance per company ELLER per cleaner ──
CREATE TABLE IF NOT EXISTS public.chargeback_buffer (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  cleaner_id      uuid REFERENCES public.cleaners(id) ON DELETE CASCADE,
  balance_ore     bigint NOT NULL DEFAULT 0,
  total_reserved_lifetime_ore bigint NOT NULL DEFAULT 0,
  total_released_lifetime_ore bigint NOT NULL DEFAULT 0,
  total_consumed_lifetime_ore bigint NOT NULL DEFAULT 0,
  last_reserved_at timestamptz,
  last_released_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chargeback_buffer_owner_xor
    CHECK ((company_id IS NOT NULL) <> (cleaner_id IS NOT NULL)),
  CONSTRAINT chargeback_buffer_balance_nonneg
    CHECK (balance_ore >= 0)
);

-- Unik per ägare (XOR-constraint säkrar att bara en av två är satt)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chargeback_buffer_company
  ON public.chargeback_buffer(company_id) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chargeback_buffer_cleaner
  ON public.chargeback_buffer(cleaner_id) WHERE cleaner_id IS NOT NULL;

COMMENT ON TABLE public.chargeback_buffer IS
  'Etapp 1 (2026-04-26): per-ägare-buffer för chargeback-skydd. balance_ore = aktuellt reserverat belopp, lifetime-fält för audit.';

-- ── 2. chargeback_buffer_log — per-transaktion audit-trail ──
CREATE TABLE IF NOT EXISTS public.chargeback_buffer_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buffer_id       uuid NOT NULL REFERENCES public.chargeback_buffer(id) ON DELETE CASCADE,
  booking_id      uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  chargeback_id   uuid,  -- FK skapas i Etapp 4 (chargebacks-tabell finns ej än)
  action          text NOT NULL,
  amount_ore      bigint NOT NULL,
  balance_before_ore bigint NOT NULL,
  balance_after_ore  bigint NOT NULL,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chargeback_buffer_log_action_check
    CHECK (action IN ('reserve', 'release', 'consume_chargeback', 'manual_adjust'))
);

CREATE INDEX IF NOT EXISTS idx_chargeback_buffer_log_buffer
  ON public.chargeback_buffer_log(buffer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chargeback_buffer_log_booking
  ON public.chargeback_buffer_log(booking_id) WHERE booking_id IS NOT NULL;

COMMENT ON TABLE public.chargeback_buffer_log IS
  'Etapp 1: per-transaktion-logg av buffer-rörelser för BokfL 7-års audit. retain=permanent.';

-- ── 3. RLS — VD ser sitt företags buffer, cleaner ser sitt eget ──
ALTER TABLE public.chargeback_buffer ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chargeback_buffer_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chargeback_buffer_vd_read ON public.chargeback_buffer;
CREATE POLICY chargeback_buffer_vd_read ON public.chargeback_buffer
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cleaners c
    WHERE c.auth_user_id = auth.uid()
      AND c.is_company_owner = true
      AND c.company_id = chargeback_buffer.company_id
  ));

DROP POLICY IF EXISTS chargeback_buffer_cleaner_read ON public.chargeback_buffer;
CREATE POLICY chargeback_buffer_cleaner_read ON public.chargeback_buffer
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cleaners c
    WHERE c.auth_user_id = auth.uid()
      AND c.id = chargeback_buffer.cleaner_id
  ));

DROP POLICY IF EXISTS chargeback_buffer_log_vd_read ON public.chargeback_buffer_log;
CREATE POLICY chargeback_buffer_log_vd_read ON public.chargeback_buffer_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chargeback_buffer cb
    JOIN public.cleaners c ON
      (c.is_company_owner = true AND c.company_id = cb.company_id)
      OR (c.id = cb.cleaner_id)
    WHERE cb.id = chargeback_buffer_log.buffer_id
      AND c.auth_user_id = auth.uid()
  ));

-- ── 4. platform_settings — soft-rollout-flaggor ──
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('chargeback_buffer_pct', '5', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('chargeback_buffer_release_days', '180', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('chargeback_buffer_enabled', 'false', NOW())
ON CONFLICT (key) DO NOTHING;

-- ── 5. RPC: increment_chargeback_buffer_balance (atomic, för Etapp 2) ──
CREATE OR REPLACE FUNCTION public.increment_chargeback_buffer_balance(
  p_buffer_id uuid,
  p_delta_ore bigint
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance bigint;
BEGIN
  UPDATE public.chargeback_buffer
     SET balance_ore = balance_ore + p_delta_ore,
         updated_at  = NOW()
   WHERE id = p_buffer_id
   RETURNING balance_ore INTO v_new_balance;
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'chargeback_buffer balance would go negative (id=%, delta=%)', p_buffer_id, p_delta_ore;
  END IF;
  RETURN v_new_balance;
END $$;

REVOKE ALL ON FUNCTION public.increment_chargeback_buffer_balance(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_chargeback_buffer_balance(uuid, bigint) TO service_role;
