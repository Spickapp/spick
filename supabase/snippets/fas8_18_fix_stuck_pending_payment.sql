-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 8 §8.18: Retro-fix stuck pending_payment-bokningar
-- ═══════════════════════════════════════════════════════════════
--
-- Problem: cancel-paths uppdaterade bookings.status='cancelled' +
-- payment_status='cancelled' men INTE escrow_state. Bokningar är
-- stuck i 'pending_payment' trots att de är avbokade.
--
-- Fynd 2026-04-25 (Farhads testbokning): bokning f3ea4b68 har
-- status='avbokad', payment_status='cancelled', escrow_state=
-- 'pending_payment'. Borde vara escrow_state='cancelled'.
--
-- Roll-orsak: booking-cancel-v2 + cleanup-stale-EFs anropade inte
-- escrow-state-transition. Fixat i commit som följer denna fil.
-- Denna SQL städar retroaktivt.
--
-- KÖRS i Supabase Studio SQL-editor.
--
-- REGLER: #26 grep prod-state via curl + verifierat exact stuck-
-- rad, #27 scope (bara reto-state-fix för stuck pending_payment),
-- #28 SSOT = log_escrow_event RPC används (samma som
-- escrow-state-transition EF), #29 escrow-state.ts TRANSITIONS
-- läst (cancel_before_charge: pending_payment→cancelled), #30
-- atomic UPDATE+INSERT inom transaction (inga partial-states),
-- #31 log_escrow_event RPC verifierad i prod (escrow-state-
-- transition.ts rad 149 använder den).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. Identifiera stuck pending_payment-bokningar
--    (status='cancelled' eller 'avbokad' + escrow_state='pending_payment')
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
  created_at,
  cancelled_at
FROM bookings
WHERE escrow_state = 'pending_payment'
  AND (status IN ('cancelled', 'avbokad') OR payment_status = 'cancelled')
ORDER BY created_at DESC;

-- ─────────────────────────────────────────────────────────────
-- 2. Atomic retro-transition (kör efter granskning av query 1)
-- ─────────────────────────────────────────────────────────────
-- Använder log_escrow_event RPC (samma som escrow-state-transition EF)
-- för att hålla audit-trail konsistent. RPC är SECURITY DEFINER så
-- bypass:ar RLS som annars blockar service_role.

DO $do$
DECLARE
  stuck_booking RECORD;
  rpc_result uuid;
BEGIN
  FOR stuck_booking IN
    SELECT id, status, payment_status, cancellation_reason
    FROM bookings
    WHERE escrow_state = 'pending_payment'
      AND (status IN ('cancelled', 'avbokad') OR payment_status = 'cancelled')
  LOOP
    -- Atomic: UPDATE + INSERT escrow_events via RPC
    UPDATE bookings
    SET escrow_state = 'cancelled'
    WHERE id = stuck_booking.id
      AND escrow_state = 'pending_payment';  -- optimistic concurrency

    SELECT log_escrow_event(
      stuck_booking.id,
      'pending_payment',
      'cancelled',
      'system_timer',
      NULL,
      jsonb_build_object(
        'action', 'cancel_before_charge',
        'source', 'fas8_18_retro_fix',
        'fix_date', NOW()::text,
        'original_status', stuck_booking.status,
        'original_payment_status', stuck_booking.payment_status,
        'cancellation_reason', stuck_booking.cancellation_reason
      )
    ) INTO rpc_result;

    RAISE NOTICE 'Fixed booking %: pending_payment → cancelled (event_id=%)',
      stuck_booking.id, rpc_result;
  END LOOP;
END $do$;

-- ─────────────────────────────────────────────────────────────
-- 3. Verifiera fix
-- ─────────────────────────────────────────────────────────────

SELECT
  id,
  customer_email,
  status,
  payment_status,
  escrow_state,
  cancelled_at
FROM bookings
WHERE escrow_state IN ('pending_payment', 'cancelled')
  AND (status IN ('cancelled', 'avbokad') OR payment_status = 'cancelled')
ORDER BY created_at DESC;

-- Förväntat: alla rader har escrow_state='cancelled'.
-- Om någon har escrow_state='pending_payment' kvar → granska manuellt.

-- ─────────────────────────────────────────────────────────────
-- 4. Audit-trail: senaste 5 retro-fix-events
-- ─────────────────────────────────────────────────────────────

SELECT
  e.created_at,
  b.customer_email,
  e.from_state,
  e.to_state,
  e.metadata->>'source' AS source,
  e.metadata->>'cancellation_reason' AS reason
FROM escrow_events e
JOIN bookings b ON b.id = e.booking_id
WHERE e.metadata->>'source' = 'fas8_18_retro_fix'
ORDER BY e.created_at DESC
LIMIT 5;
