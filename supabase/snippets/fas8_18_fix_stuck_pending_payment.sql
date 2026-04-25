-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 8 §8.18: Retro-fix stuck pending_payment-bokningar
-- ═══════════════════════════════════════════════════════════════
-- Kör BLOCK FÖR BLOCK i Supabase Studio (markera ETT block, kör,
-- markera nästa, kör). Om hela filen körs samtidigt kan trailing
-- semikolon/whitespace ge "syntax error at end of input".
-- ═══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- BLOCK 1: Identifiera stuck rader (kör först)
-- ──────────────────────────────────────────────────────────────
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


-- ──────────────────────────────────────────────────────────────
-- BLOCK 2: Atomic retro-transition (kör efter granskning av BLOCK 1)
-- Använder log_escrow_event RPC (samma som escrow-state-transition EF)
-- för konsistent audit-trail.
-- ──────────────────────────────────────────────────────────────
DO $do$
DECLARE
  stuck_booking RECORD;
  rpc_result uuid;
  fixed_count integer := 0;
BEGIN
  FOR stuck_booking IN
    SELECT id, status, payment_status, cancellation_reason
    FROM bookings
    WHERE escrow_state = 'pending_payment'
      AND (status IN ('cancelled', 'avbokad') OR payment_status = 'cancelled')
  LOOP
    UPDATE bookings
    SET escrow_state = 'cancelled'
    WHERE id = stuck_booking.id
      AND escrow_state = 'pending_payment';

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

    fixed_count := fixed_count + 1;
  END LOOP;

  RAISE NOTICE 'fas8_18_retro_fix: % bokningar transitioned till cancelled', fixed_count;
END
$do$;


-- ──────────────────────────────────────────────────────────────
-- BLOCK 3: Verifiera fix (kör efter BLOCK 2)
-- ──────────────────────────────────────────────────────────────
SELECT
  id,
  customer_email,
  status,
  payment_status,
  escrow_state,
  cancelled_at
FROM bookings
WHERE (status IN ('cancelled', 'avbokad') OR payment_status = 'cancelled')
  AND escrow_state IN ('pending_payment', 'cancelled')
ORDER BY created_at DESC;


-- ──────────────────────────────────────────────────────────────
-- BLOCK 4: Audit-trail för retro-fix-events
-- ──────────────────────────────────────────────────────────────
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
LIMIT 10;
