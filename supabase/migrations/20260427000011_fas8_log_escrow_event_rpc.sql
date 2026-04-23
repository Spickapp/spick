-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 8 §8.6 fix: log_escrow_event RPC (bypass RLS)
-- ═══════════════════════════════════════════════════════════════
--
-- ROTORSAK (2026-04-24):
-- escrow-state-transition EF kunde inte INSERTA i escrow_events
-- trots service_role-client. RLS blockerade INSERT (service_role-
-- bypass fungerade inte pga config-drift). Resultat: state-change
-- lyckades men audit-trail saknades → EU PWD-compliance-bristande.
--
-- LÖSNING:
-- SECURITY DEFINER RPC (samma mönster som log_booking_event från
-- Fas 6.2). Funktionen kör som function-owner (postgres) →
-- bypassar RLS konsistent oavsett caller-role.
--
-- REGLER: #26 grep log_booking_event för mönster, #27 scope
-- (bara RPC + grants, ingen logic-ändring), #28 SSOT =
-- escrow-state-transition EF som konsumerar denna RPC, #30 N/A,
-- #31 escrow_events schema live-verifierat.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_escrow_event(
  p_booking_id uuid,
  p_from_state text,
  p_to_state text,
  p_triggered_by text,
  p_triggered_by_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO escrow_events (
    booking_id, from_state, to_state, triggered_by, triggered_by_id, metadata
  )
  VALUES (
    p_booking_id, p_from_state, p_to_state, p_triggered_by, p_triggered_by_id, p_metadata
  )
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'log_escrow_event: INSERT returned NULL id (unexpected)';
  END IF;

  RETURN v_id;
END;
$fn$;

ALTER FUNCTION public.log_escrow_event(uuid, text, text, text, uuid, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.log_escrow_event(uuid, text, text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_escrow_event(uuid, text, text, text, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.log_escrow_event IS
  'Fas 8 §8.6 fix: Bypass RLS för escrow_events INSERT. SECURITY DEFINER kör som function-owner.';
