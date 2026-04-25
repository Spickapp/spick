-- ═══════════════════════════════════════════════════════════════
-- SPICK – TIC-integration för Fas 7.5 RUT + B2B firmatecknare
-- ═══════════════════════════════════════════════════════════════
--
-- Farhad-direktiv 2026-04-25: använd TIC.io BankID för
-- 1. SPAR-enrichment vid RUT-bokning (löser PNR_FIELD_DISABLED-låsning)
-- 2. CompanyRoles + signing-authority för B2B-onboarding (firmatecknare)
--
-- TIC-docs: https://id.tic.io/docs
-- Architecture: docs/architecture/tic-integration.md
--
-- KÖRS i Supabase Studio. Block-by-block.
--
-- REGLER: #26 prod-schema verifierat (cleaner_addon_prices-pattern följer),
-- #27 scope (bara två tabell-utökningar för #1 + #2, ingen factura/kredit),
-- #28 SSOT (rut_consents = audit-trail för PNR-via-BankID-consent),
-- #29 TIC-docs läst (SPAR + CompanyRoles + signing-authority via agent),
-- #30 PNR-via-BankID-consent kräver Farhad/jurist-OK före produktions-
-- användning. Lagring som hash + krypterad referens minimerar GDPR-risk
-- jämfört med klartext-PNR-fältet (PNR_FIELD_DISABLED-fix från 24 apr).
-- #31 alla kolumn-references verifierade mot prod-schema.
-- ═══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- BLOCK 1: rut_consents-tabell (audit-trail för BankID-consent)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rut_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_email text NOT NULL,
  tic_session_id text NOT NULL UNIQUE,
  tic_enrichment_token text,
  consented_at timestamptz NOT NULL DEFAULT now(),
  consent_text text NOT NULL,
  pnr_hash text NOT NULL,
  spar_full_name text,
  spar_address_street text,
  spar_address_postal text,
  spar_address_city text,
  spar_municipality_code text,
  spar_protected_identity boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rut_consents_booking ON public.rut_consents(booking_id);
CREATE INDEX IF NOT EXISTS idx_rut_consents_email ON public.rut_consents(customer_email);
CREATE INDEX IF NOT EXISTS idx_rut_consents_session ON public.rut_consents(tic_session_id);

COMMENT ON TABLE public.rut_consents IS
  'Audit-trail för PNR-via-BankID-consent (TIC.io SPAR-enrichment). Spick lagrar PNR-hash + krypterad referens, ALDRIG klartext. Erbjuder lagligt grund för Fas 7.5 RUT-rapportering till SKV.';


-- ──────────────────────────────────────────────────────────────
-- BLOCK 2: companies-utökning för firmatecknare-verifiering
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS firmatecknare_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS firmatecknare_personnr_hash text,
  ADD COLUMN IF NOT EXISTS firmatecknare_full_name text,
  ADD COLUMN IF NOT EXISTS firmatecknare_tic_session_id text;

COMMENT ON COLUMN public.companies.firmatecknare_verified_at IS
  'Timestamp när TIC CompanyRoles + signing-authority-analysis bekräftat att signerande person är firmatecknare. NULL = ej verifierat.';
COMMENT ON COLUMN public.companies.firmatecknare_personnr_hash IS
  'SHA-256-hash av firmatecknarens PNR (klartext lagras ALDRIG). Audit-trail för GDPR.';


-- ──────────────────────────────────────────────────────────────
-- BLOCK 3: RLS — service_role-only (TIC-flow går via EFs)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.rut_consents ENABLE ROW LEVEL SECURITY;
-- Inga policies → service_role-only access (default Supabase-deny)

GRANT ALL ON public.rut_consents TO service_role;


-- ──────────────────────────────────────────────────────────────
-- BLOCK 4: Verifiera
-- ──────────────────────────────────────────────────────────────
SELECT
  c.relname AS table_name,
  array_agg(i.indexname) AS indexes
FROM pg_class c
LEFT JOIN pg_indexes i ON i.tablename = c.relname AND i.schemaname = 'public'
WHERE c.relname = 'rut_consents'
  AND c.relkind = 'r'
GROUP BY c.relname;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'companies'
  AND column_name LIKE 'firmatecknare%'
ORDER BY column_name;
