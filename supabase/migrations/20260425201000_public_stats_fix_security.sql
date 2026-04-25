-- public_stats — fix för permission_denied (audit 2026-04-25)
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   Migration 20260425200000 skapade public_stats med
--   `WITH (security_invoker = true)`. Vid anon-curl returnerar PostgREST
--   "permission denied for table cleaners" eftersom anon inte har SELECT
--   på cleaners (RLS-skyddad).
--
-- Fix:
--   Ta bort security_invoker → vyn använder default SECURITY DEFINER
--   = körs som ägaren (postgres) som har full SELECT. Anon får läsa
--   ENDAST de aggregerade siffrorna (inga PII), GRANT SELECT till anon.
--
-- Säkerhet:
--   - Vyn returnerar bara bigint-counts + 1 numeric. Inga rader, inga PII.
--   - Inget GRANT på underliggande tabeller (cleaners/bookings/ratings).
--   - Anon kan bara köra SELECT * FROM public_stats — inga anpassade WHERE.
--
-- Idempotens: DROP + CREATE.
-- ════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.public_stats;

CREATE VIEW public.public_stats AS
SELECT
  COALESCE((SELECT COUNT(*) FROM bookings WHERE escrow_state IN ('released', 'released_partial', 'awaiting_attest', 'paid_held')), 0)::bigint AS total_bookings,
  COALESCE((SELECT COUNT(*) FROM bookings WHERE booking_date = CURRENT_DATE), 0)::bigint AS bookings_today,
  COALESCE((SELECT COUNT(*) FROM cleaners WHERE is_approved = true AND is_active = true AND status = 'aktiv'), 0)::bigint AS active_cleaners,
  COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM ratings WHERE rating IS NOT NULL), 0)::numeric AS avg_rating,
  COALESCE((SELECT COUNT(*) FROM ratings WHERE rating IS NOT NULL), 0)::bigint AS total_reviews;

GRANT SELECT ON public.public_stats TO anon, authenticated;
