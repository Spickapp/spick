-- KRITISK PII-FIX: stoppa anon-enumeration av 52 kunders fulla persondata
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: Intern security-audit-baseline (Fas 13) avslöjade att vyerna
--   booking_confirmation + v_customer_bookings returnerar HTTP 200 + 52
--   verkliga kunders namn/email/telefon/adress/PNR-hash till anon-key.
--   Vyer ärver inte RLS från underliggande bookings (default: SECURITY
--   DEFINER med vy-skaparens permissions = bypass av RLS).
--
-- LÖSNING:
--   1. REVOKE SELECT FROM anon på båda vyer (omedelbar stop av enumeration)
--   2. Skapa SECURITY DEFINER RPC-functions som tar UUID/session-id som
--      param. Anon kan bara hämta EN booking åt gången om de KÄNNER UUID:n
--      (UUID-space ~ 2^122 = ej brute-force-bart).
--   3. authenticated kvar för admin/VD-flow (RLS-skyddat via SDK-auth).
--   4. calendar_events: REVOKE anon SELECT (cleaner-adresser läckte).
--
-- BAKÅTKOMPATIBILITET:
--   - tack.html, min-bokning.html, betyg.html, betygsatt.html, boka.html
--     (rebook-flow) måste UPPDATERAS från direct-view-query till RPC-call.
--   - Frontend-fix kommer i samma commit som denna migration.
--
-- Verifiering rule #31 (curl mot prod 2026-04-26):
--   - GET /rest/v1/booking_confirmation?limit=1000 → 200 + 52 rader (BUG)
--   - GET /rest/v1/v_customer_bookings → 200 + 52 rader (BUG)
--   - GET /rest/v1/calendar_events → 200 + 4 rader med adresser (BUG)
--
-- Disclaimer (regel #30): Farhad bedömer själv ev. GDPR-incident-anmälningsplikt.
-- Min teknisk rekommendation: 1) Verifiera om logg-data visar att den läckande
-- endpointen faktiskt hämtats av extern part 2) Konsultera IMY-vägledning
-- för incident-anmälan om ja.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. STOPPA enumeration omedelbart ──
REVOKE SELECT ON public.booking_confirmation FROM anon;
REVOKE SELECT ON public.v_customer_bookings FROM anon;

-- authenticated har fortfarande tillgång (admin/VD via SDK)
GRANT SELECT ON public.booking_confirmation TO authenticated;
GRANT SELECT ON public.v_customer_bookings TO authenticated;

-- ── 2. RPC-functions för anon (anti-enumeration via UUID-param) ──
CREATE OR REPLACE FUNCTION public.get_booking_by_id(_id uuid)
RETURNS SETOF public.booking_confirmation
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.booking_confirmation WHERE id = _id LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_booking_by_id(uuid) IS
  'Anti-enumeration: anon kan hämta EN booking om de känner UUID:n (effektiv magic-link). Ersätter direct view-query från tack.html, min-bokning.html, betyg.html. Tillagd 2026-04-26 efter security-audit-baseline.';

CREATE OR REPLACE FUNCTION public.get_booking_by_session(_session_id text)
RETURNS SETOF public.booking_confirmation
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.booking_confirmation
   WHERE payment_intent_id = _session_id
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_booking_by_session(text) IS
  'Anti-enumeration: tack.html-flow där frontend bara har Stripe session-id (payment_intent_id-mapping i bookings).';

-- GRANT EXECUTE — anon kan anropa RPC:erna
GRANT EXECUTE ON FUNCTION public.get_booking_by_id(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_booking_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_by_session(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_booking_by_session(text) TO authenticated;

-- ── 3. calendar_events: stoppa adress-läcka till anon ──
-- RLS finns redan (20260426190000_calendar_events_vd_admin_delete.sql)
-- men anon hade SELECT-grant. RLS-policy är FOR ALL → SELECT-grant
-- gjorde att anon trots RLS kunde se rader (om policy returnerade rader).
-- Lösning: REVOKE table-level grant från anon helt.
REVOKE SELECT ON public.calendar_events FROM anon;
-- authenticated kvar (cleaner/VD/admin per RLS-policy)
GRANT SELECT ON public.calendar_events TO authenticated;

COMMENT ON TABLE public.calendar_events IS
  'Cleaner kalender + adresser. Audit 2026-04-26: anon-grant återkallat — endast authenticated (filtrerad via RLS) kan SELECT.';
