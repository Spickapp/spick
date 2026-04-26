-- SMS-saldo per cleaner-owner — schema + flag-gating
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   Idag står Spick för 100% av SMS-kostnaden via 46elks (~0,52 kr/SMS).
--   Vid 1000 SMS/månad = 500 kr/månad ren förlust.
--
--   Lösning: logga varje SMS med company_id + triggered_by_cleaner_id,
--   debitera VD/cleaner-owner per skickat segment, dra från saldo vid
--   utbetalning (Stripe-transfer-tid).
--
-- Design-källa: docs/design/2026-04-26-sms-saldo-cleaner-owner-design.md
-- Sprint A: schema + helper, FLAG-OFF (sms_billing_enabled=false).
-- Sprint B-D: kräver Farhad-OK + jurist-bedömning av moms-fråga.
--
-- Verifiering (rule #31, 2026-04-26):
--   curl sms_log → 404 (ej existerande)
--   curl company_sms_balance → 404 (ej existerande)
--
-- Idempotens: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. sms_log — per-meddelande-loggning ──
CREATE TABLE IF NOT EXISTS public.sms_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  triggered_by_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  recipient_phone_suffix text,             -- sista 4 siffror för audit (PII-min)
  message_excerpt text,                     -- första 50 tecken för debugging
  segment_count integer NOT NULL DEFAULT 1, -- 160-tecken-segment
  price_per_segment_ore integer NOT NULL,
  total_charge_ore integer NOT NULL,
  sms_provider text NOT NULL DEFAULT '46elks',
  provider_message_id text,                 -- 46elks tracking-id
  sent_at timestamptz NOT NULL DEFAULT now(),
  billing_period text,                      -- 'YYYY-MM' för aggregat-vy
  billing_status text NOT NULL DEFAULT 'pending',
  CONSTRAINT sms_log_segment_count_check CHECK (segment_count >= 1),
  CONSTRAINT sms_log_price_nonneg CHECK (price_per_segment_ore >= 0),
  CONSTRAINT sms_log_charge_nonneg CHECK (total_charge_ore >= 0),
  CONSTRAINT sms_log_billing_status_check CHECK (
    billing_status IN ('pending', 'invoiced', 'paid', 'waived', 'system')
  )
);

CREATE INDEX IF NOT EXISTS idx_sms_log_company_period
  ON public.sms_log(company_id, billing_period DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_log_cleaner
  ON public.sms_log(triggered_by_cleaner_id, sent_at DESC)
  WHERE triggered_by_cleaner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_log_pending
  ON public.sms_log(sent_at DESC) WHERE billing_status = 'pending';

COMMENT ON TABLE public.sms_log IS
  'Sprint A (2026-04-26): per-SMS-loggning för debitering. PII-min — bara phone_suffix + 50-char-excerpt. retain=BokfL 7 år (jurist-bedömning).';

-- ── 2. company_sms_balance — running balance per company ──
CREATE TABLE IF NOT EXISTS public.company_sms_balance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid UNIQUE NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  balance_ore     bigint NOT NULL DEFAULT 0,
  total_charged_lifetime_ore bigint NOT NULL DEFAULT 0,
  total_settled_lifetime_ore bigint NOT NULL DEFAULT 0,
  last_charged_at timestamptz,
  last_settled_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_sms_balance_balance_nonneg CHECK (balance_ore >= 0)
);

COMMENT ON TABLE public.company_sms_balance IS
  'Sprint A: running balance per company. balance_ore = aktuell skuld till Spick (positiv = företag är skyldigt). Dras vid Stripe-transfer.';

-- ── 3. RLS — VD ser sitt företags SMS-data ──
ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_sms_balance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_log_vd_read ON public.sms_log;
CREATE POLICY sms_log_vd_read ON public.sms_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cleaners c
    WHERE c.auth_user_id = auth.uid()
      AND c.is_company_owner = true
      AND c.company_id = sms_log.company_id
  ));

DROP POLICY IF EXISTS company_sms_balance_vd_read ON public.company_sms_balance;
CREATE POLICY company_sms_balance_vd_read ON public.company_sms_balance
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cleaners c
    WHERE c.auth_user_id = auth.uid()
      AND c.is_company_owner = true
      AND c.company_id = company_sms_balance.company_id
  ));

-- ── 4. platform_settings — soft-rollout-flaggor ──
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('sms_price_per_segment_ore', '52', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('sms_billing_enabled', 'false', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('sms_billing_throttle_ore', '100000', NOW())  -- pausa SMS vid -1000 kr skuld
ON CONFLICT (key) DO NOTHING;

-- ── 5. RPC: increment_sms_balance (atomic, för Sprint B) ──
CREATE OR REPLACE FUNCTION public.increment_sms_balance(
  p_company_id uuid,
  p_delta_ore bigint
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance bigint;
BEGIN
  -- Skapa rad om inte finns
  INSERT INTO public.company_sms_balance (company_id, balance_ore)
  VALUES (p_company_id, 0)
  ON CONFLICT (company_id) DO NOTHING;

  UPDATE public.company_sms_balance
     SET balance_ore = balance_ore + p_delta_ore,
         last_charged_at = CASE WHEN p_delta_ore > 0 THEN NOW() ELSE last_charged_at END,
         last_settled_at = CASE WHEN p_delta_ore < 0 THEN NOW() ELSE last_settled_at END,
         total_charged_lifetime_ore = total_charged_lifetime_ore + GREATEST(p_delta_ore, 0),
         total_settled_lifetime_ore = total_settled_lifetime_ore + GREATEST(-p_delta_ore, 0),
         updated_at = NOW()
   WHERE company_id = p_company_id
   RETURNING balance_ore INTO v_new_balance;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'company_sms_balance balance would go negative (company=%, delta=%)', p_company_id, p_delta_ore;
  END IF;
  RETURN v_new_balance;
END $$;

REVOKE ALL ON FUNCTION public.increment_sms_balance(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_sms_balance(uuid, bigint) TO service_role;
