-- Företags-bakgrundsbild — Hero på foretag.html
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: Zivar (VD Solid Service AB) önskar kunna välja bakgrundsbild
--          för sin företagssida. Default är dynamic-color-gradient från
--          företagsnamn (nameToColor()) — detta ger anpassningsmöjlighet.
--
-- Komponenter:
--   1. companies.hero_bg_url + hero_bg_storage_path nya kolumner
--   2. Storage-bucket 'company-hero-bg' med samma RLS-pattern som
--      'company-logos' (VD kan bara uppladda för sin egen company_id)
--   3. Större filsize (4 MB) eftersom hero-bilder är större upplösning
--
-- Verifiering rule #31 (2026-04-26):
--   - companies.hero_bg_url → 42703 (saknas) ✓ migration behövs
--   - companies-tabell verifierad LIVE i tidigare sessioner
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Lägg till nya kolumner i companies ──
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS hero_bg_url text,
  ADD COLUMN IF NOT EXISTS hero_bg_storage_path text;

COMMENT ON COLUMN public.companies.hero_bg_url IS
  'Public URL till hero-bakgrundsbild på foretag.html. Sätts av VD via stadare-dashboard upload-flow. Fallback: dynamic-color-gradient från company_name.';

COMMENT ON COLUMN public.companies.hero_bg_storage_path IS
  'Storage-bucket-path för re-upload. Format: company-hero-bg/{company_id}/hero.{ext}';

-- ── 2. Storage-bucket 'company-hero-bg' ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-hero-bg',
  'company-hero-bg',
  true,
  4194304, -- 4 MB max (hero-bilder är större)
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 4194304,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- ── 3. RLS-policies för bucket (samma pattern som company-logos) ──
DROP POLICY IF EXISTS "company_hero_bg_public_read" ON storage.objects;
CREATE POLICY "company_hero_bg_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'company-hero-bg');

DROP POLICY IF EXISTS "company_hero_bg_vd_insert" ON storage.objects;
CREATE POLICY "company_hero_bg_vd_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'company-hero-bg'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT c.company_id FROM public.cleaners c
       WHERE c.auth_user_id = auth.uid()
         AND c.is_company_owner = true
         AND c.company_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "company_hero_bg_vd_update" ON storage.objects;
CREATE POLICY "company_hero_bg_vd_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'company-hero-bg'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT c.company_id FROM public.cleaners c
       WHERE c.auth_user_id = auth.uid()
         AND c.is_company_owner = true
         AND c.company_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "company_hero_bg_vd_delete" ON storage.objects;
CREATE POLICY "company_hero_bg_vd_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'company-hero-bg'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT c.company_id FROM public.cleaners c
       WHERE c.auth_user_id = auth.uid()
         AND c.is_company_owner = true
         AND c.company_id IS NOT NULL
    )
  );
