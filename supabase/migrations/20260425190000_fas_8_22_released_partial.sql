-- Fas 8 §8.22 — utöka bookings_escrow_state_check med 'released_partial'
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   §8.22-25 partial-refund-flow var DEFERRED pga avsaknad av
--   transfer_partial_refund-action + released_partial-state. Denna
--   migration låser upp flowen genom att utöka CHECK-constraint:en
--   så att rows kan UPDATE:as till 'released_partial' efter att
--   refund-booking + transfer-rest till cleaner är klart.
--
-- Verifiering (rule #31):
--   - escrow-state.ts redan uppdaterad med 'released_partial' + action
--   - state-transition.test.ts uppdaterad med ny VALID_STATES + tester
--   - 8/8 tester passerar lokalt (deno test)
--
-- Idempotens: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_escrow_state_check;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_escrow_state_check
  CHECK (escrow_state IN (
    'pending_payment',
    'paid_held',
    'awaiting_attest',
    'released',
    'released_partial',          -- §8.22 (2026-04-25)
    'disputed',
    'resolved_full_refund',
    'resolved_partial_refund',
    'resolved_dismissed',
    'refunded',
    'cancelled',
    'released_legacy'
  ));
