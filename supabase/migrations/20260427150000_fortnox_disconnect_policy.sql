-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fortnox: tillåt cleaner att DELETE sin egen koppling
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Phase 1 RLS gav cleaner bara SELECT (för status-vy). UI-disconnect
-- behöver DELETE direkt via REST (ingen separat EF behövs då).
--
-- SÄKERHET
-- Cleaner får ENDAST radera sin egen rad (cleaner_id matchar JWT-email).
-- Andra cleaners + anon kan fortsatt inte röra raden.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "cleaner can delete own connection" ON public.cleaner_fortnox_credentials;
CREATE POLICY "cleaner can delete own connection"
  ON public.cleaner_fortnox_credentials
  FOR DELETE
  USING (
    auth.role() = 'authenticated' AND
    cleaner_id IN (
      SELECT id FROM public.cleaners WHERE email = auth.jwt() ->> 'email'
    )
  );

GRANT DELETE ON public.cleaner_fortnox_credentials TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 20260427150000 COMPLETE — Fortnox cleaner-disconnect policy';
END $$;
