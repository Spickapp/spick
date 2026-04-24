-- ═══════════════════════════════════════════════════════════════
-- Fas 7.5 — RUT-readiness + 75k-tracker
-- ═══════════════════════════════════════════════════════════════
--
-- Farhad-mandat 2026-04-24: förbered Fas 7.5 RUT-infrastruktur.
--
-- Scope:
--   1. Lägg till kolumner på customer_profiles för 75k-tak-tracker
--   2. VIEW: v_rut_pending_queue — visar pending RUT-ansökningar
--      med readiness-status (har PNR, har arbetsbevis, inom tak, etc.)
--   3. VIEW: v_customer_rut_summary — kund-orientierad RUT-historik
--
-- Rule #30 (regulator-gissning förbjuden):
--   - Skripten räknar BARA Spicks egna RUT-ansökningar (inte externa SKV-data)
--   - 75k-tak är hardcoded enligt nu-gällande lag 2026 (verifieras av jurist innan aktivering)
--   - Ingen autonomi — bara visning. Farhad/admin fattar beslut.
--
-- Rule #27: scope = readiness-views, INTE automatisk SKV-submission.
-- Rule #28: customer_profiles förlängs, inte ny fragmenterad tabell.
-- Rule #31: prod-verifierat att rut_amount/total_price är korrekt idag.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. customer_profiles: 75k-tracker-kolumner
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS rut_ytd_year integer,
  ADD COLUMN IF NOT EXISTS rut_ytd_used_sek integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rut_ytd_reset_at timestamptz;

COMMENT ON COLUMN public.customer_profiles.rut_ytd_year IS
  'Vilket kalenderår rut_ytd_used_sek gäller för. Nollställs 1 januari av cron.';
COMMENT ON COLUMN public.customer_profiles.rut_ytd_used_sek IS
  'Summa av approved rut_amount för innevarande år (från Spicks egna ansökningar). NOT primary source — SKV har den sanna 75k-tracker. Används för förhandsvarning till kund innan bokning.';
COMMENT ON COLUMN public.customer_profiles.rut_ytd_reset_at IS
  'Timestamp för senaste nollställning (1 januari varje år via cron).';

-- Index för snabb 75k-lookup vid bokning
CREATE INDEX IF NOT EXISTS idx_customer_profiles_rut_ytd
  ON public.customer_profiles(email, rut_ytd_year)
  WHERE rut_ytd_used_sek > 0;

-- ─────────────────────────────────────────────────────────────
-- 2. VIEW: v_rut_pending_queue — admin-dashboard för RUT-kö
-- ─────────────────────────────────────────────────────────────
-- Visar pending RUT-ansökningar med readiness-indikatorer:
--   - has_pnr: finns customer_pnr (kommer från BankID i Fas 7.5)
--   - has_gps_evidence: checkin_time + checkin_lat/lng finns
--   - has_attest: kund har bekräftat
--   - has_completion: completed_at + actual_hours finns
--   - within_75k_estimate: kumulativ rut_amount för kunden innevarande år

CREATE OR REPLACE VIEW public.v_rut_pending_queue AS
SELECT
  b.id,
  b.booking_id,
  b.customer_name,
  b.customer_email,
  b.customer_phone,
  b.customer_address,
  b.service_type,
  b.booking_date,
  b.completed_at,
  b.total_price,
  b.rut_amount,
  (b.total_price + b.rut_amount) AS gross_arbetskostnad,
  b.rut_application_status,
  b.receipt_number,

  -- Readiness-indikatorer
  (b.customer_pnr IS NOT NULL AND length(b.customer_pnr) >= 10) AS has_pnr,
  (b.checkin_time IS NOT NULL AND b.checkin_lat IS NOT NULL) AS has_gps_evidence,
  (b.attest_status = 'attested') AS has_attest,
  (b.completed_at IS NOT NULL AND b.actual_hours > 0) AS has_completion,
  (b.status = 'klar' OR b.status = 'completed') AS is_completed,
  (b.payment_status = 'paid') AS is_paid,

  -- Tidsfönster: RUT får inte ansökas förrän arbete utfört + buffer
  (b.completed_at IS NOT NULL
    AND b.completed_at <= now() - interval '24 hours'
    AND b.dispute_status = 'none') AS safe_to_apply,

  -- 7-dagars paus: ytterligare buffer efter dispute-frist
  (b.completed_at IS NOT NULL
    AND b.completed_at <= now() - interval '7 days'
    AND b.dispute_status = 'none') AS past_dispute_window,

  -- Kumulativ RUT för kund innevarande år (Spicks data, ej SKV)
  cp.rut_ytd_used_sek AS customer_rut_ytd_used,
  cp.rut_ytd_year AS customer_rut_ytd_year,

  -- Varning: närmar sig 75k-tak?
  (cp.rut_ytd_year = extract(year from now())::integer
    AND cp.rut_ytd_used_sek + b.rut_amount > 60000) AS approaches_75k_limit,

  -- Varning: överskrider 75k-tak?
  (cp.rut_ytd_year = extract(year from now())::integer
    AND cp.rut_ytd_used_sek + b.rut_amount > 75000) AS exceeds_75k_limit

FROM public.bookings b
LEFT JOIN public.customer_profiles cp ON cp.email = b.customer_email
WHERE b.rut_amount > 0
  AND b.rut_application_status IN ('pending', 'not_applicable')
  AND b.payment_status = 'paid'
  AND b.customer_type = 'privat'
  AND b.status NOT IN ('avbokad', 'cancelled', 'refunded', 'timed_out')
ORDER BY b.completed_at DESC NULLS LAST, b.booking_date DESC;

COMMENT ON VIEW public.v_rut_pending_queue IS
  'Fas 7.5 admin-queue: pending RUT-ansökningar med readiness-indikatorer. Rule #30: bara Spicks egna data, ingen SKV-tolkning.';

GRANT SELECT ON public.v_rut_pending_queue TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 3. VIEW: v_customer_rut_summary — kund-orientierad historik
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_customer_rut_summary AS
SELECT
  cp.email,
  cp.rut_ytd_year,
  cp.rut_ytd_used_sek,
  cp.rut_ytd_reset_at,
  COUNT(b.id) FILTER (WHERE b.rut_amount > 0) AS total_rut_bookings,
  COUNT(b.id) FILTER (WHERE b.rut_application_status = 'approved') AS approved_count,
  COUNT(b.id) FILTER (WHERE b.rut_application_status = 'rejected') AS rejected_count,
  COUNT(b.id) FILTER (WHERE b.rut_application_status IN ('pending', 'submitted')) AS pending_count,
  COALESCE(SUM(b.rut_amount) FILTER (WHERE b.rut_application_status = 'approved'), 0) AS total_approved_sek,
  75000 - COALESCE(cp.rut_ytd_used_sek, 0) AS remaining_ytd_estimate,
  MAX(b.completed_at) AS last_completed_at
FROM public.customer_profiles cp
LEFT JOIN public.bookings b ON b.customer_email = cp.email
  AND b.rut_amount > 0
  AND extract(year from b.booking_date) = extract(year from now())
GROUP BY cp.email, cp.rut_ytd_year, cp.rut_ytd_used_sek, cp.rut_ytd_reset_at;

COMMENT ON VIEW public.v_customer_rut_summary IS
  'Fas 7.5 kund-summary: RUT-historik per kund. remaining_ytd_estimate är Spicks estimering — SKV har den sanna siffran.';

GRANT SELECT ON public.v_customer_rut_summary TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: uppdatera rut_ytd_used efter approved ansökan
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_customer_rut_ytd(
  p_email text,
  p_amount integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  current_year integer := extract(year from now())::integer;
BEGIN
  INSERT INTO customer_profiles (email, rut_ytd_year, rut_ytd_used_sek, rut_ytd_reset_at)
  VALUES (p_email, current_year, p_amount, now())
  ON CONFLICT (email) DO UPDATE SET
    rut_ytd_year = CASE
      WHEN customer_profiles.rut_ytd_year != current_year THEN current_year
      ELSE customer_profiles.rut_ytd_year
    END,
    rut_ytd_used_sek = CASE
      WHEN customer_profiles.rut_ytd_year != current_year THEN p_amount
      ELSE customer_profiles.rut_ytd_used_sek + p_amount
    END,
    rut_ytd_reset_at = CASE
      WHEN customer_profiles.rut_ytd_year != current_year THEN now()
      ELSE customer_profiles.rut_ytd_reset_at
    END;
END;
$fn$;

COMMENT ON FUNCTION public.increment_customer_rut_ytd IS
  'Fas 7.5: uppdatera customer_profiles.rut_ytd_used_sek efter approved RUT-ansökan. Återställer år automatiskt om nytt kalenderår.';

-- ─────────────────────────────────────────────────────────────
-- 5. Verifiering
-- ─────────────────────────────────────────────────────────────

DO $do$
DECLARE
  col_count integer;
  view_count integer;
  fn_exists boolean;
BEGIN
  -- Kolumn-check
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'customer_profiles'
    AND column_name IN ('rut_ytd_year', 'rut_ytd_used_sek', 'rut_ytd_reset_at');

  IF col_count != 3 THEN
    RAISE EXCEPTION 'Fas 7.5 migration failed: customer_profiles saknar kolumner (hittade %)', col_count;
  END IF;
  RAISE NOTICE 'OK: customer_profiles har alla 3 RUT-ytd-kolumner';

  -- View-check
  SELECT COUNT(*) INTO view_count
  FROM information_schema.views
  WHERE table_schema = 'public'
    AND table_name IN ('v_rut_pending_queue', 'v_customer_rut_summary');

  IF view_count != 2 THEN
    RAISE EXCEPTION 'Fas 7.5 migration failed: saknar views (hittade %)', view_count;
  END IF;
  RAISE NOTICE 'OK: båda RUT-views skapade';

  -- Function-check
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'increment_customer_rut_ytd'
  ) INTO fn_exists;

  IF NOT fn_exists THEN
    RAISE EXCEPTION 'Fas 7.5 migration failed: RPC increment_customer_rut_ytd saknas';
  END IF;
  RAISE NOTICE 'OK: increment_customer_rut_ytd RPC skapad';

  RAISE NOTICE '═══════════════════════════════════════';
  RAISE NOTICE ' Fas 7.5 RUT-readiness-migration KLAR';
  RAISE NOTICE '═══════════════════════════════════════';
END $do$;

COMMIT;
