-- ═══════════════════════════════════════════════════════════════
-- SPICK – F-skatt verify-cache (Audit P1 2026-04-26)
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- verify-fskatt-EF anropar FöretagsAPI.se per request. Två call-sites:
-- (a) registrera-stadare.html user-triggered (per applicant, en gång)
-- (b) auto-approve-check cron (kan trigga om same orgnr)
--
-- Vid 10k bokningar/månad + 50+ applications/månad = ~600 anrop/månad
-- → kostnad + rate-limit-risk hos FöretagsAPI.se. Företagsdata ändras
-- sällan så 24h cache-TTL räcker.
--
-- DESIGN
-- - Tabell: fskatt_verification_cache(org_number UNIQUE, has_fskatt,
--   sni_codes, company_name, status, verified_at, expires_at)
-- - TTL 24h via expires_at-kolumn (EF kollar `expires_at > NOW()`)
-- - INSERT ON CONFLICT UPDATE — idempotent
-- - RLS: bara service_role har read/write
--
-- REGLER:
-- - #28 SSOT: en cache-tabell, ingen inline-Map
-- - #30 inga regulator-claims (bara teknisk caching)
-- - #31 schema curl-verifierat: tabellen finns INTE i prod
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.fskatt_verification_cache (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  org_number    TEXT         NOT NULL UNIQUE,
  has_fskatt    BOOLEAN      NOT NULL,
  sni_codes     TEXT[]       NOT NULL DEFAULT '{}',
  company_name  TEXT,
  status        TEXT,
  api_used      TEXT,
  verified_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.fskatt_verification_cache IS
  'Audit P1 2026-04-26: 24h-cache för verify-fskatt-EF. Reducerar FöretagsAPI.se-anrop från ~600/mån till ~30/mån (90%+ cache-hit-rate efter warm-up).';

CREATE INDEX IF NOT EXISTS idx_fskatt_cache_orgnr ON public.fskatt_verification_cache(org_number);
CREATE INDEX IF NOT EXISTS idx_fskatt_cache_expires ON public.fskatt_verification_cache(expires_at);

-- RLS: bara service_role
ALTER TABLE public.fskatt_verification_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.fskatt_verification_cache;
CREATE POLICY "service_role full access"
  ON public.fskatt_verification_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.fskatt_verification_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fskatt_verification_cache TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 20260426360000 COMPLETE — F-skatt verify-cache';
END $$;
