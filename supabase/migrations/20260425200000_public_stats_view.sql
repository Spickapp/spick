-- public_stats-vy — saknades i prod (PGRST205 vid curl 2026-04-25)
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   index.html rad 537 anropar `SB.from('public_stats').select('*').single()`
--   för homepage-statistik. Vyn dokumenterad i CLAUDE.md rad 75 men existerar
--   inte i prod-schema → frontend ignorerar fel tyst (try/catch + return).
--   Resultat: ps-rating, ps-bookings, ps-cleaners renderas tomma på homepage.
--
-- Verifiering (rule #31):
--   - curl PGRST205 "Could not find the table 'public.public_stats'"
--   - index.html rad 537 grep-bekräftad användning
--   - CLAUDE.md rad 75 dokumenterad expected-vy
--
-- Kolumner som frontend förväntar sig (rad 540-543 + 552-554 i index.html):
--   - total_bookings (display: "X+")
--   - active_cleaners (display: "X")
--   - avg_rating (display: "X.X ★")
--   - total_reviews
--
-- Säkerhet: SECURITY INVOKER + GRANT SELECT TO anon. Inga PII.
-- Idempotens: CREATE OR REPLACE VIEW.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.public_stats
WITH (security_invoker = true)
AS
SELECT
  COALESCE((SELECT COUNT(*) FROM bookings WHERE escrow_state IN ('released', 'released_partial', 'awaiting_attest', 'paid_held')), 0)::bigint AS total_bookings,
  COALESCE((SELECT COUNT(*) FROM bookings WHERE booking_date = CURRENT_DATE), 0)::bigint AS bookings_today,
  COALESCE((SELECT COUNT(*) FROM cleaners WHERE is_approved = true AND is_active = true AND status = 'aktiv'), 0)::bigint AS active_cleaners,
  COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM ratings WHERE rating IS NOT NULL), 0)::numeric AS avg_rating,
  COALESCE((SELECT COUNT(*) FROM ratings WHERE rating IS NOT NULL), 0)::bigint AS total_reviews;

GRANT SELECT ON public.public_stats TO anon, authenticated;
