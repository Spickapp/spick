-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 9 §9.6: get_company_kpis RPC
-- ═══════════════════════════════════════════════════════════════
--
-- VD-dashboard KPI-data i en RPC-call för foretag-dashboard.html.
-- Följer mönster från get_company_onboarding_status (SECURITY DEFINER
-- + SET search_path + jsonb-retur) men LÄGGER TILL explicit
-- authorization-check för att skydda revenue-proxy-data.
--
-- RETURNERAR:
--   bookings_this_week       — senaste 7 dagar (status ej pending/avbokad)
--   bookings_last_4_weeks    — senaste 28 dagar (för trend-baseline)
--   completed_last_30_days   — status='klar' senaste 30 dagar
--   avg_rating               — ROUND(AVG,2) all-time, NULL om inga ratings
--   rating_count             — antal ratings
--   completion_rate          — % klara av (klara + avbokade + timed_out), senaste 90 dagar
--   active_cleaners_this_week — distinkta cleaner_id i bokningar denna vecka
--   total_team_size          — cleaners med status aktiv|pausad|onboarding
--   generated_at             — timestamptz för cache-busting i UI
--
-- AUTHORIZATION:
--   Kräver att caller är VD av p_company_id via is_company_owner_of().
--   Skyddar mot data-leakage från externa clients.
--
-- REGLER: #26 grep-canonical-status-values (klar/avbokad/timed_out),
-- #27 scope (bara KPI-RPC, inget annat), #28 SSOT = denna RPC,
-- #30 N/A, #31 prod-schema verifierad via pg_dump.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_company_kpis(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  v_now timestamptz := now();
  v_week_ago date := (v_now - interval '7 days')::date;
  v_four_weeks_ago date := (v_now - interval '28 days')::date;
  v_month_ago date := (v_now - interval '30 days')::date;
  v_quarter_ago date := (v_now - interval '90 days')::date;
  v_today date := v_now::date;
BEGIN
  -- Authorization: endast VD av företaget får läsa
  IF NOT is_company_owner_of(p_company_id) THEN
    RAISE EXCEPTION 'not_authorized_for_company: %', p_company_id
      USING HINT = 'Caller must be VD (is_company_owner) of the target company';
  END IF;

  SELECT jsonb_build_object(
    -- Aktivitet
    'bookings_this_week', (
      SELECT COUNT(*)
        FROM bookings b
        JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_week_ago
         AND b.status NOT IN ('pending', 'avbokad', 'timed_out')
    ),
    'bookings_last_4_weeks', (
      SELECT COUNT(*)
        FROM bookings b
        JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_four_weeks_ago
         AND b.status NOT IN ('pending', 'avbokad', 'timed_out')
    ),
    'completed_last_30_days', (
      SELECT COUNT(*)
        FROM bookings b
        JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_month_ago
         AND b.status = 'klar'
    ),

    -- Kvalitet
    'avg_rating', (
      SELECT ROUND(AVG(r.rating)::numeric, 2)
        FROM ratings r
        JOIN cleaners cl ON cl.id = r.cleaner_id
       WHERE cl.company_id = p_company_id
    ),
    'rating_count', (
      SELECT COUNT(*)
        FROM ratings r
        JOIN cleaners cl ON cl.id = r.cleaner_id
       WHERE cl.company_id = p_company_id
    ),

    -- Completion-rate (senaste 90 dagar, bara bokningar med förfallet datum)
    -- Mäter: klara / (klara + avbokade + timed_out). Pre-pending-states räknas ej
    -- (de kan fortfarande slutföras).
    'completion_rate', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE ROUND(
          COUNT(*) FILTER (WHERE b.status = 'klar')::numeric
            / COUNT(*)::numeric * 100,
          1
        )
      END
      FROM bookings b
       JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_quarter_ago
         AND b.booking_date < v_today
         AND b.status IN ('klar', 'avbokad', 'timed_out')
    ),

    -- Team
    'active_cleaners_this_week', (
      SELECT COUNT(DISTINCT b.cleaner_id)
        FROM bookings b
        JOIN cleaners cl ON cl.id = b.cleaner_id
       WHERE cl.company_id = p_company_id
         AND b.booking_date >= v_week_ago
         AND b.status NOT IN ('pending', 'avbokad', 'timed_out')
         AND b.cleaner_id IS NOT NULL
    ),
    'total_team_size', (
      SELECT COUNT(*)
        FROM cleaners
       WHERE company_id = p_company_id
         AND status IN ('aktiv', 'pausad', 'onboarding')
    ),

    -- Meta
    'generated_at', v_now
  ) INTO result;

  RETURN result;
END;
$$;

ALTER FUNCTION public.get_company_kpis(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_company_kpis(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_kpis(uuid) TO service_role;

COMMENT ON FUNCTION public.get_company_kpis(uuid) IS
  'Fas 9 §9.6: VD-dashboard KPI-data. Kräver VD-autorisering via is_company_owner_of.';
