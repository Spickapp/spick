-- Item 1 Etapp 1 — Terms-acceptance schema (BankID-bunden signering)
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   Audit 2026-04-25 visade att Spick saknar HELT spårning av att
--   underleverantörer har accepterat avtalen. Konsekvens: alla viten/
--   sanktioner i underleverantörsavtals-draft v0.2 är icke-uthärdliga.
--
-- Denna migration lägger till SCHEMA-stöd för Item 1 (BankID-bunden
-- signering vid registrering) men aktiverar INGENTING ännu — flag-gated
-- via platform_settings.terms_signing_required (default 'false').
--
-- Aktiveringsbeslut är Farhads (jurist-bedömning av drafts måste vara
-- klar innan binding är meningsfull per Avtalslagen 36 § retroaktivitet).
--
-- Schema-tillägg:
--   1. cleaners: 3 nya kolumner för accept-spårning
--   2. companies: 3 motsvarande för B2B-avtals-acceptans
--   3. avtal_versioner: NY tabell för versions-katalogen
--   4. platform_settings: terms_signing_required-flagga
--
-- Verifiering (rule #31, 2026-04-25):
--   - cleaners.terms_accepted_at: 42703 (saknas) — bekräftat
--   - cleaners.terms_version: 42703 (saknas)
--   - cleaners.terms_signature_id: 42703 (saknas)
--   - rut_consents-tabell: 42501 (finns, RLS-skyddad) — FK-target OK
--
-- Idempotens: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. cleaners — accept-spårning per individ ──────────────────────
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS terms_signature_id UUID
  REFERENCES public.rut_consents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cleaners.terms_accepted_at IS
  'Item 1 (2026-04-25): tidpunkt för senaste accept av underleverantörsavtal. NULL = aldrig accepterat (legacy).';
COMMENT ON COLUMN public.cleaners.terms_version IS
  'Version som accepterades (matchar avtal_versioner.version, t.ex. "v1.0", "v1.1"). NULL = aldrig.';
COMMENT ON COLUMN public.cleaners.terms_signature_id IS
  'FK till rut_consents-rad som innehåller BankID-bevis (purpose=cleaner_registration). NULL om ej BankID-bunden accept.';

-- ── 2. companies — accept-spårning för B2B-tillägg ─────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS terms_signature_id UUID
  REFERENCES public.rut_consents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.companies.terms_accepted_at IS
  'Item 1 (2026-04-25): firmatecknarens BankID-bundna accept av B2B-tillägg.';

-- ── 3. avtal_versioner — versions-katalog ──────────────────────────
CREATE TABLE IF NOT EXISTS public.avtal_versioner (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avtal_typ TEXT NOT NULL CHECK (avtal_typ IN (
    'underleverantorsavtal',
    'b2b_tillagg',
    'kundvillkor',
    'integritetspolicy',
    'code_of_conduct'
  )),
  version TEXT NOT NULL,
  publicerat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  publicerat_av TEXT,
  pdf_url TEXT,
  draft_url TEXT,                         -- Länk till DRAFT-md i docs/legal/
  is_binding BOOLEAN NOT NULL DEFAULT false,  -- false = endast referens, true = juridiskt bunden vid accept
  jurist_godkand_at TIMESTAMPTZ,         -- Sätts när Farhad markerar version som jurist-bunden
  jurist_godkand_av TEXT,
  andringssammanfattning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (avtal_typ, version)
);

CREATE INDEX IF NOT EXISTS idx_avtal_versioner_typ_version
  ON public.avtal_versioner(avtal_typ, version);

CREATE INDEX IF NOT EXISTS idx_avtal_versioner_binding_active
  ON public.avtal_versioner(avtal_typ, publicerat_at DESC)
  WHERE is_binding = true;

-- RLS: anon kan läsa katalogen (för UI-visning av aktuell version + PDF-länk)
ALTER TABLE public.avtal_versioner ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_reads_avtal_versioner" ON public.avtal_versioner;
CREATE POLICY "anon_reads_avtal_versioner" ON public.avtal_versioner FOR SELECT USING (true);

GRANT SELECT ON public.avtal_versioner TO anon, authenticated;
GRANT ALL ON public.avtal_versioner TO service_role;

-- ── 4. Seed avtal_versioner med v0.2-DRAFT (ej bindande) ───────────
-- v0.2-DRAFT speglar drafts från denna sessions leverans. is_binding=false
-- så att UI kan visa men accept binder inte juridiskt förrän Farhad
-- markerar v1.0 som is_binding=true.
INSERT INTO public.avtal_versioner (avtal_typ, version, draft_url, is_binding, andringssammanfattning, publicerat_av)
VALUES
  ('underleverantorsavtal', 'v0.2-DRAFT', '/docs/legal/2026-04-25-underleverantorsavtal-draft.md', false, 'Initial draft från Item 1 sprint. EJ jurist-bunden. Anti-fraud + vite-skala + trappad avstängning + plattformsdeltagar-roll.', 'Claude (AI-sprint 2026-04-25)'),
  ('kundvillkor', 'v0.2-DRAFT', '/docs/legal/2026-04-25-kundvillkor-draft.md', false, 'Initial draft. Hybrid utförare/förmedlare + 50%-drag-RUT-mekanism.', 'Claude (AI-sprint 2026-04-25)'),
  ('b2b_tillagg', 'v0.1-DRAFT', '/docs/legal/2026-04-25-underleverantorsavtal-draft.md#16', false, 'Plattformsdeltagar-roll §16 från underleverantörsavtal-draft.', 'Claude (AI-sprint 2026-04-25)'),
  ('integritetspolicy', 'v1.0', '/integritetspolicy.html', true, 'Befintlig policy från prod, antaget bunden tills justeras.', 'Spick'),
  ('code_of_conduct', 'v0.1-DRAFT', NULL, false, 'Refererat i underleverantörsavtal §2.2 men ingen separat doc än. Skapas vid behov.', 'Claude (AI-sprint 2026-04-25)')
ON CONFLICT (avtal_typ, version) DO NOTHING;

-- ── 5. platform_settings.terms_signing_required ────────────────────
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('terms_signing_required', 'false', NOW())
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN public.platform_settings.value IS
  'terms_signing_required: "false" (default) = nya cleaners kan registrera utan BankID-bunden accept. "true" = obligatorisk BankID-binding aktiverad. Flippa när jurist har bedömt drafts.';
