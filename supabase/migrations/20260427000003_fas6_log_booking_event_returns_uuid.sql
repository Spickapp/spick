-- ============================================================
-- Fas 6.3 robustness — log_booking_event RETURNS uuid
-- ============================================================
--
-- BUG-CONTEXT (commit d701d7b):
-- save-booking-event smoke-test visade 1 av 4 inserts failade tyst
-- (EF returnerade 200 OK, men DB-rad skrevs inte). Rot-orsak okand
-- (cold-start? transaction-rollback? supabase-js error-swallowing?).
--
-- FIX: Andra RPC fran RETURNS void till RETURNS uuid (id av insertad
-- rad). logBookingEvent-helpern kan da verifiera success via data-field
-- istallet for bara `error === null`.
--
-- Om INSERT internt failade (constraint, RLS, transaction-rollback)
-- returnerar RPC null eller kastar exception → helper detekterar och
-- returnerar false → callers kan handla.
--
-- REGLER: #26 grep-fore-edit (alla callers via _shared/events.ts enda
-- konsument), #27 scope (bara RPC + helper, inga retrofit-EF-andringar),
-- #28 single source (helper ar enda vag), #31 primarkalla (migration
-- 20260401181153 for current definition).
--
-- CALLERS VERIFIERADE (grep "log_booking_event"):
--   - supabase/functions/_shared/events.ts (helper)
--   Inga andra EFs anropar RPC direkt. Alla 7 retrofit-EFs
--   (booking-create, auto-delegate, cleaner-booking-response,
--   booking-cancel-v2, noshow-refund, stripe-webhook, save-booking-event)
--   anvander helper → ingen EF-andring behovs.
--
-- BACKWARD-KOMPAT: RETURNS void → RETURNS uuid kraver DROP + CREATE
-- (PostgreSQL tillater inte returtyps-andring via CREATE OR REPLACE).
-- Migration korrs i transaktion for atomicitet.
-- ============================================================

BEGIN;

-- 1. Drop gamla void-versionen
DROP FUNCTION IF EXISTS log_booking_event(uuid, text, text, jsonb);

-- 2. Skapa ny version som returnerar id av insertad rad
CREATE FUNCTION log_booking_event(
  p_booking_id UUID,
  p_event_type TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_metadata   JSONB DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO booking_events (booking_id, event_type, actor_type, metadata)
  VALUES (p_booking_id, p_event_type, p_actor_type, p_metadata)
  RETURNING id INTO v_id;

  -- Om INSERT internt failade och v_id ar NULL → kasta exception
  -- (istallet for tyst null-return). Hjalper callers detektera bug.
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'log_booking_event: INSERT returned NULL id (unexpected)';
  END IF;

  RETURN v_id;
END;
$$;

-- 3. Bevarar GRANT EXECUTE (matchar original-migration 20260401181153)
GRANT EXECUTE ON FUNCTION log_booking_event(uuid, text, text, jsonb)
  TO anon, authenticated, service_role;

COMMIT;

SELECT 'MIGRATION 20260427000003 COMPLETE — log_booking_event RETURNS uuid' AS result;
