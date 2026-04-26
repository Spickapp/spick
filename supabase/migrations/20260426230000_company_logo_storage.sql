-- Företagslogo-upload — Storage-bucket + RLS-policies
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: Zivar (VD Solid Service AB) frågade var företagets logo
--          laddas upp för visning mot kund. Funktion saknades helt
--          (companies.logo_url-kolumn fanns men ingen UI).
--
-- Komponenter:
--   1. Storage-bucket 'company-logos' — public read (loggor visas
--      offentligt på foretag.html, boka.html, tack.html)
--   2. RLS-policy: VD (is_company_owner=true) får INSERT/UPDATE/DELETE
--      bara för path som börjar med sin egen company_id
--   3. companies.logo_url + ny logo_storage_path-kolumn för spårning
--
-- File-konvention:
--   path = 'company_logos/{company_id}/logo.{png|jpg|webp}'
--   public_url = 'https://urjeijcncsyuletprydy.supabase.co/storage/v1/object/public/company-logos/...'
--
-- Verifiering rule #31:
--   - companies-tabell finns (verifierad live tidigare)
--   - companies.logo_url existerar (curl-verifierad: returnerar null)
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Skapa storage-bucket (idempotent) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-logos',
  'company-logos',
  true,
  2097152, -- 2 MB max
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

-- ── 2. RLS-policies för bucket ──
-- Public read (alla kan se loggor, även anon — designed publik)
DROP POLICY IF EXISTS "company_logos_public_read" ON storage.objects;
CREATE POLICY "company_logos_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'company-logos');

-- VD (is_company_owner=true) får INSERT bara för sin egen company_id
DROP POLICY IF EXISTS "company_logos_vd_insert" ON storage.objects;
CREATE POLICY "company_logos_vd_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT c.company_id FROM public.cleaners c
       WHERE c.auth_user_id = auth.uid()
         AND c.is_company_owner = true
         AND c.company_id IS NOT NULL
    )
  );

-- VD får UPDATE (re-upload) bara för sin egen company_id
DROP POLICY IF EXISTS "company_logos_vd_update" ON storage.objects;
CREATE POLICY "company_logos_vd_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT c.company_id FROM public.cleaners c
       WHERE c.auth_user_id = auth.uid()
         AND c.is_company_owner = true
         AND c.company_id IS NOT NULL
    )
  );

-- VD får DELETE bara för sin egen company_id
DROP POLICY IF EXISTS "company_logos_vd_delete" ON storage.objects;
CREATE POLICY "company_logos_vd_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT c.company_id FROM public.cleaners c
       WHERE c.auth_user_id = auth.uid()
         AND c.is_company_owner = true
         AND c.company_id IS NOT NULL
    )
  );

-- ── 3. companies — lägg till logo_storage_path för re-upload-tracking ──
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_storage_path text;

COMMENT ON COLUMN public.companies.logo_url IS
  'Public URL till företagslogo. Sätts av VD via stadare-dashboard upload-flow. Visas på foretag.html + boka.html + tack.html.';

COMMENT ON COLUMN public.companies.logo_storage_path IS
  'Storage-bucket-path (för re-upload/cache-invalidation). Format: company_logos/{company_id}/logo.{ext}';

-- ── 4. RLS för companies.logo_url update ──
-- Befintlig RLS antagligen redan har VD-update-policy. Verifiera med:
--   SELECT polname FROM pg_policy WHERE polrelid = 'public.companies'::regclass;
-- Om saknas — lägg till nedan (idempotent via DROP + CREATE).
DROP POLICY IF EXISTS "companies_vd_update_logo" ON public.companies;
CREATE POLICY "companies_vd_update_logo"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT c.company_id FROM public.cleaners c
       WHERE c.auth_user_id = auth.uid()
         AND c.is_company_owner = true
    )
  )
  WITH CHECK (
    id IN (
      SELECT c.company_id FROM public.cleaners c
       WHERE c.auth_user_id = auth.uid()
         AND c.is_company_owner = true
    )
  );
