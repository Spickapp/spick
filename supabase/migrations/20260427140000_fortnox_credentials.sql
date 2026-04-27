-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fortnox-integration: cleaner credentials
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Cleaners kan koppla sitt Fortnox-konto till Spick → Spick pushar
-- automatiskt fakturor + bokföringsunderlag till deras Fortnox.
-- Konkurrent-fyll: AddHub har Fortnox-koppling, Spick saknade.
--
-- DESIGN
-- - 1 row per cleaner (UNIQUE constraint)
-- - access_token: 1h TTL (JWT från Fortnox), refreshas via cron
-- - refresh_token: 45-dagars TTL (lagras krypterat — Phase 2)
-- - expires_at: när access_token går ut → cron-EF refreshar 5 min innan
-- - fortnox_company_id: för audit + multi-company-stöd framåt
--
-- SÄKERHET (Phase 1 MVP):
-- - RLS: bara service_role + cleaner-själv kan läsa
-- - Plaintext tokens i Phase 1 — Phase 2 lägger AES-256 (samma pattern
--   som RUT_PNR_ENCRYPTION_KEY)
-- - REVOKE från anon/authenticated som default
--
-- REGLER:
-- - #28 SSOT: Fortnox-credentials i 1 tabell, ingen duplikering
-- - #30 N/A (teknisk integration, ingen regulator-tolkning)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cleaner_fortnox_credentials (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_id          UUID         NOT NULL UNIQUE REFERENCES public.cleaners(id) ON DELETE CASCADE,
  fortnox_company_id  TEXT         NOT NULL,
  access_token        TEXT         NOT NULL,
  refresh_token       TEXT         NOT NULL,
  scope               TEXT         NOT NULL,
  expires_at          TIMESTAMPTZ  NOT NULL,
  connected_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_refreshed_at   TIMESTAMPTZ,
  last_invoice_pushed_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.cleaner_fortnox_credentials IS
  'Fortnox OAuth2-credentials per cleaner. Phase 1 MVP — plaintext tokens med RLS-skydd.';

-- Index för cron-refresh (hitta tokens som expirerar inom 10 min)
CREATE INDEX IF NOT EXISTS idx_fortnox_creds_expiring
  ON public.cleaner_fortnox_credentials (expires_at)
  WHERE expires_at IS NOT NULL;

-- updated_at-trigger (SSOT-mönster från andra tabeller)
CREATE OR REPLACE FUNCTION public.fortnox_creds_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fortnox_creds_updated_at ON public.cleaner_fortnox_credentials;
CREATE TRIGGER trg_fortnox_creds_updated_at
  BEFORE UPDATE ON public.cleaner_fortnox_credentials
  FOR EACH ROW EXECUTE FUNCTION public.fortnox_creds_set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.cleaner_fortnox_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.cleaner_fortnox_credentials;
CREATE POLICY "service_role full access"
  ON public.cleaner_fortnox_credentials
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Cleaner kan se OM de är kopplade (utan tokens-data via separate view)
DROP POLICY IF EXISTS "cleaner can read own status" ON public.cleaner_fortnox_credentials;
CREATE POLICY "cleaner can read own status"
  ON public.cleaner_fortnox_credentials
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    cleaner_id IN (
      SELECT id FROM public.cleaners WHERE email = auth.jwt() ->> 'email'
    )
  );

REVOKE ALL ON public.cleaner_fortnox_credentials FROM PUBLIC, anon;
GRANT SELECT ON public.cleaner_fortnox_credentials TO authenticated;
GRANT ALL ON public.cleaner_fortnox_credentials TO service_role;

-- ── Public view: dölj tokens, exponera bara connection-status ──
CREATE OR REPLACE VIEW public.v_cleaner_fortnox_status AS
  SELECT
    cleaner_id,
    fortnox_company_id,
    connected_at,
    last_refreshed_at,
    last_invoice_pushed_at,
    (expires_at > NOW()) AS token_valid
  FROM public.cleaner_fortnox_credentials;

GRANT SELECT ON public.v_cleaner_fortnox_status TO authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 20260427140000 COMPLETE — Fortnox credentials schema';
END $$;
