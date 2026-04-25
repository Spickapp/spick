-- ═══════════════════════════════════════════════════════════════
-- SPICK – TIC #2 CompanyRoles + signing-authority för B2B-onboarding
-- ═══════════════════════════════════════════════════════════════
--
-- Farhad-direktiv 2026-04-25: CompanyRoles + signing-authority för
-- B2B-onboarding (registrera-firma-flow).
--
-- Strategi: utöka rut_consents med purpose-kolumn + JSON-data-fält
-- istället för ny tabell. Återanvänder samma session-tracking-flow.
-- Audit-trail per consent-rad oavsett RUT eller company-signup.
--
-- KÖRS i Supabase Studio. Block-by-block.
--
-- REGLER: #26 rut_consents-schema verifierat tidigare denna session,
-- #27 scope (bara purpose-kolumn + JSON-fält, ingen ny tabell),
-- #28 SSOT (rut_consents = generic TIC-consents nu, purpose styr),
-- #29 audit (rut-bankid-flow design läst innan utvidgning),
-- #30 ej regulator,
-- #31 ALTER TABLE IF NOT EXISTS säkerställer idempotens.
-- ═══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- BLOCK 1: utöka rut_consents
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.rut_consents
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'rut',
  ADD COLUMN IF NOT EXISTS company_roles_jsonb jsonb,
  ADD COLUMN IF NOT EXISTS signing_authority_jsonb jsonb,
  ADD COLUMN IF NOT EXISTS verified_org_number text;

ALTER TABLE public.rut_consents
  DROP CONSTRAINT IF EXISTS rut_consents_purpose_check;

ALTER TABLE public.rut_consents
  ADD CONSTRAINT rut_consents_purpose_check
  CHECK (purpose IN ('rut', 'company_signup'));

CREATE INDEX IF NOT EXISTS idx_rut_consents_purpose
  ON public.rut_consents(purpose);

COMMENT ON COLUMN public.rut_consents.purpose IS
  'TIC consent-flow type. "rut" = SPAR-enrichment för RUT-bokning. "company_signup" = CompanyRoles + signing-authority för B2B-firmatecknare-verifiering.';


-- ──────────────────────────────────────────────────────────────
-- BLOCK 2: rename-alias-vy för läsbarhet (frivillig, ej i scope)
-- ──────────────────────────────────────────────────────────────
-- Ingen vy skapas — rut_consents-namnet behålls för bakåtkompat.
-- Framtid kan ev. CREATE VIEW tic_consents AS SELECT * FROM rut_consents.


-- ──────────────────────────────────────────────────────────────
-- BLOCK 3: Verifiera
-- ──────────────────────────────────────────────────────────────
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'rut_consents'
  AND column_name IN ('purpose', 'company_roles_jsonb', 'signing_authority_jsonb', 'verified_org_number')
ORDER BY column_name;
