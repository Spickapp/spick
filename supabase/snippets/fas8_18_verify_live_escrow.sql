-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 8 §8.18: Verifiera LIVE escrow_v2-state i prod
-- ═══════════════════════════════════════════════════════════════
--
-- escrow_mode='escrow_v2' aktiverades 2026-04-23 21:14 UTC i prod.
-- Stripe live-mode (test_mode=false). Detta är verifierings-script
-- för att säkerställa att inga bokningar har fastnat i intermediate
-- escrow-states + att SLA-cronner kör.
--
-- Kör i Supabase Studio SQL-editor (read-only, säker).
--
-- REGLER: #26 grep-verifierat escrow_state-kolumn finns + 5
-- transitions verifierade (pending_payment→paid_held→awaiting_attest
-- →released/disputed→resolved_*→refunded), #27 scope (bara
-- read-only-queries), #28 SSOT = bookings.escrow_state är primärkälla,
-- #29 audit-före: läste hela escrow-state.ts TRANSITIONS-map,
-- #30 ingen tolkning av lag, #31 prod-state primärkälla.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. Distribution av escrow_state över alla bookings
-- ─────────────────────────────────────────────────────────────

SELECT
  escrow_state,
  COUNT(*) AS total,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM bookings
GROUP BY escrow_state
ORDER BY total DESC;

-- ─────────────────────────────────────────────────────────────
-- 2. Stuck bokningar — pending_payment äldre än 1h
-- ─────────────────────────────────────────────────────────────
-- Förväntat: 0. Om >0 = stripe-webhook har inte transitionerat
-- charge.succeeded → paid_held. Cleanup-stale cron borde radera
-- pending_payment > 30min (om de aldrig betalades).

SELECT
  id,
  customer_email,
  service_type,
  booking_date,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS hours_old,
  total_price,
  payment_intent_id,
  stripe_session_id
FROM bookings
WHERE escrow_state = 'pending_payment'
  AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- ─────────────────────────────────────────────────────────────
-- 3. Stuck awaiting_attest — auto-release-cron-failures
-- ─────────────────────────────────────────────────────────────
-- escrow-auto-release-cron ska transitionera awaiting_attest →
-- released efter 24h. Om bokningar är >25h gamla i denna state =
-- cron har inte kört eller failat.

SELECT
  b.id,
  b.customer_email,
  b.service_type,
  b.booking_date,
  b.created_at,
  EXTRACT(EPOCH FROM (NOW() - b.created_at)) / 3600 AS hours_old,
  b.total_price,
  b.cleaner_id,
  e.created_at AS attest_window_start
FROM bookings b
LEFT JOIN LATERAL (
  SELECT created_at FROM escrow_events
  WHERE booking_id = b.id AND to_state = 'awaiting_attest'
  ORDER BY created_at DESC LIMIT 1
) e ON TRUE
WHERE b.escrow_state = 'awaiting_attest'
  AND e.created_at < NOW() - INTERVAL '25 hours'
ORDER BY e.created_at ASC;

-- ─────────────────────────────────────────────────────────────
-- 4. Disputes — distribution + SLA-status
-- ─────────────────────────────────────────────────────────────

SELECT
  COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open_disputes,
  COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved_disputes,
  COUNT(*) FILTER (WHERE resolved_at IS NULL
                   AND opened_at < NOW() - INTERVAL '48 hours'
                   AND cleaner_responded_at IS NULL) AS cleaner_sla_breach,
  COUNT(*) FILTER (WHERE resolved_at IS NULL
                   AND opened_at < NOW() - INTERVAL '7 days') AS admin_sla_breach
FROM disputes;

-- ─────────────────────────────────────────────────────────────
-- 5. Hängande terminal-states som bör vara aktiva
-- ─────────────────────────────────────────────────────────────
-- resolved_full_refund + resolved_partial_refund + resolved_dismissed
-- ska vara temporary states. resolved_dismissed → released via
-- escrow-release(admin_dismiss_transfer). resolved_full_refund →
-- refunded via refund-booking EF (saknas idag — §8.11-lucka).
--
-- Om bokningar är i resolved_* > 24h = manuell admin-action behövs.

SELECT
  b.escrow_state,
  COUNT(*) AS stuck,
  MIN(b.created_at) AS oldest,
  (ARRAY_AGG(b.id ORDER BY b.created_at))[1:5] AS sample_ids
FROM bookings b
WHERE b.escrow_state IN ('resolved_full_refund', 'resolved_partial_refund', 'resolved_dismissed')
GROUP BY b.escrow_state;

-- ─────────────────────────────────────────────────────────────
-- 6. escrow_events sista 20 (audit-trail-kvalitet)
-- ─────────────────────────────────────────────────────────────

SELECT
  e.created_at,
  e.from_state,
  e.to_state,
  e.triggered_by,
  b.customer_email,
  b.service_type,
  e.metadata->>'action' AS action,
  e.metadata->>'dispute_id' AS dispute_id
FROM escrow_events e
LEFT JOIN bookings b ON b.id = e.booking_id
ORDER BY e.created_at DESC
LIMIT 20;

-- ─────────────────────────────────────────────────────────────
-- 7. Senaste 10 bokningar med escrow-data (smoke-test)
-- ─────────────────────────────────────────────────────────────

SELECT
  id,
  customer_email,
  service_type,
  booking_date,
  status,
  payment_status,
  escrow_state,
  total_price,
  created_at
FROM bookings
WHERE escrow_state != 'released_legacy'
ORDER BY created_at DESC
LIMIT 10;

-- ─────────────────────────────────────────────────────────────
-- ANALYS-CHECKLIST (tolka resultaten ovan):
-- ─────────────────────────────────────────────────────────────
--
-- Query 1: Förväntat 'released_legacy' = bulk + några nya states
--   Om alla är 'released_legacy' = inga escrow_v2-bokningar gjorda
--   ännu (flag aktiv men ingen ny trafik)
--
-- Query 2: Förväntat 0 rader. Om >0 → stripe-webhook fail eller
--   cleanup-stale-cron-issue. Triggar manuell undersökning.
--
-- Query 3: Förväntat 0 rader. Om >0 → escrow-auto-release-cron har
--   inte körts eller failat. KRITISKT: pengar håll på plattform
--   längre än 24h, städare väntar på utbetalning.
--
-- Query 4: open_disputes ≥ 0, sla_breach > 0 = handlingsbehov.
--
-- Query 5: Om resolved_full_refund > 0 = §8.11-lucka manifesterad.
--   Manuell stripe-refund + escrow-state-transition behövs.
--   resolved_dismissed: kör escrow-release manuellt eller via cron.
--
-- Query 6: Validera att triggered_by + metadata är populerat
--   konsistent. Om många metadata={}=tomma = audit-kvalitet låg.
--
-- Query 7: Ge kontext på vilka kunder/städare som är i flow:t.
