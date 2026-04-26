-- N3 Sprint 4 — admin-dashboard PNR-verifiering
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   N3 Sprint 1-3 har:
--   - Sprint 1: schema (3 PNR-kolumner i bookings)
--   - Sprint 2: VD-modal med 3-vägs UX (BankID-direkt/async/manuell)
--   - Sprint 3: cron-påminnelser för pending_bankid
--
--   Sprint 4: admin-dashboard så Spick (jag) kan se:
--   1. Vilka bookings är manual_klartext → flagga för granskning innan SKV
--   2. Vilka bookings är pending_bankid + reminder-historik
--   3. Vilka bookings är unverified (timeout) → ingen RUT
--   4. Aggregat per cleaner/company för att se mönster
--
-- Verifiering (rule #31, 2026-04-26):
--   bookings.pnr_verification_method finns
--   customer_pnr_reminder_count finns (Sprint 3)
--   v_admin_pnr_verification → 404 (ej existerande)
--
-- Idempotens: CREATE OR REPLACE VIEW.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. v_admin_pnr_verification — alla bookings med PNR-status ──
CREATE OR REPLACE VIEW public.v_admin_pnr_verification AS
SELECT
  b.id AS booking_id,
  b.customer_email,
  b.customer_name,
  b.customer_phone,
  b.booking_date,
  b.total_price,
  b.service_type,
  b.pnr_verification_method,
  b.pnr_verified_at,
  b.customer_pnr_verification_session_id,
  b.customer_pnr_reminder_count,
  b.customer_pnr_reminder_sent_at,
  b.created_at AS booking_created_at,
  b.cleaner_id,
  c.full_name AS cleaner_name,
  c.company_id,
  co.name AS company_name,
  -- Status-ikon för admin-UI
  CASE
    WHEN b.pnr_verification_method = 'bankid' THEN 'verified'
    WHEN b.pnr_verification_method = 'pending_bankid' THEN 'pending'
    WHEN b.pnr_verification_method = 'manual_klartext' THEN 'needs_review'
    WHEN b.pnr_verification_method = 'unverified' THEN 'rut_lost'
    ELSE 'unknown'
  END AS admin_status,
  -- Hur länge har bokningen funnits
  EXTRACT(EPOCH FROM (NOW() - b.created_at)) / 3600 AS age_hours
FROM public.bookings b
LEFT JOIN public.cleaners c ON c.id = b.cleaner_id
LEFT JOIN public.companies co ON co.id = c.company_id
WHERE b.pnr_verification_method IS NOT NULL
ORDER BY b.created_at DESC;

COMMENT ON VIEW public.v_admin_pnr_verification IS
  'N3 Sprint 4 (2026-04-26): admin-vy för PNR-verifierings-status per booking. status=needs_review = manual_klartext som kräver Spick-granskning innan SKV-rapportering.';

-- ── 2. v_admin_pnr_aggregate — aggregat per cleaner+method (senaste 30d) ──
CREATE OR REPLACE VIEW public.v_admin_pnr_aggregate AS
SELECT
  COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::uuid) AS cleaner_id,
  COALESCE(c.full_name, '–') AS cleaner_name,
  COALESCE(co.name, '–') AS company_name,
  b.pnr_verification_method,
  COUNT(*) AS booking_count,
  ROUND(AVG(b.total_price)::numeric, 0) AS avg_price,
  MIN(b.created_at) AS first_seen_at,
  MAX(b.created_at) AS last_seen_at
FROM public.bookings b
LEFT JOIN public.cleaners c ON c.id = b.cleaner_id
LEFT JOIN public.companies co ON co.id = c.company_id
WHERE b.pnr_verification_method IS NOT NULL
  AND b.created_at >= NOW() - INTERVAL '30 days'
GROUP BY c.id, c.full_name, co.name, b.pnr_verification_method
ORDER BY booking_count DESC;

COMMENT ON VIEW public.v_admin_pnr_aggregate IS
  'N3 Sprint 4: aggregat per cleaner + method (senaste 30d). Hittar mönster: cleaners som ofta tar manual_klartext-bokningar = utbildning behövs.';

-- ── 3. GRANT till admin (via is_admin RPC) ──
GRANT SELECT ON public.v_admin_pnr_verification TO authenticated;
GRANT SELECT ON public.v_admin_pnr_aggregate TO authenticated;
