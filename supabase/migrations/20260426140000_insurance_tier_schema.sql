-- 3-tier insurance-modell + Spick plattformsförsäkring
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   Branschpraxis kräver 10 MSEK för städ-försäkring (Almega-standard).
--   Men för nya cleaners är detta friktion under uppvärmnings-period.
--
-- Lösning: 3-tier progressiv onboarding
--   - Provanställd (0-90 dagar / <10 jobb): 5 MSEK + bevis-upload
--     Spick själv täcker mellanskillnaden via plattformsförsäkring (5 MSEK extra)
--   - Verifierad (efter 10 jobb + 4.5+ rating): 10 MSEK + ren förmögenhet 2 MSEK
--   - Spick Pro (Almega-medlem eller motsvarande): 10 MSEK + ren + sak
--
-- Design-källa: chat 2026-04-26 + branschresearch
--
-- Verifiering (rule #31, 2026-04-26):
--   curl cleaners.insurance_tier → 42703 (kolumn ej existerande)
--   curl cleaners.jobs_completed → 42703 (kolumn ej existerande)
--   curl cleaners.onboarded_at → 42703 (kolumn ej existerande)
--   cleaners.avg_rating finns (RLS-skyddad)
--
-- Idempotens: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. cleaners — 6 nya insurance + tier-kolumner ──
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS insurance_tier text NOT NULL DEFAULT 'provanstalld';
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS insurance_amount_kr integer;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS insurance_property_damage_kr integer;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS insurance_pdf_storage_path text;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS insurance_verified_at timestamptz;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS insurance_expires_at date;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS jobs_completed integer NOT NULL DEFAULT 0;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- CHECK: insurance_tier enum
ALTER TABLE public.cleaners DROP CONSTRAINT IF EXISTS cleaners_insurance_tier_check;
ALTER TABLE public.cleaners ADD CONSTRAINT cleaners_insurance_tier_check
  CHECK (insurance_tier IN ('provanstalld', 'verifierad', 'spick_pro'));

COMMENT ON COLUMN public.cleaners.insurance_tier IS
  '3-tier progression: provanstalld (0-90d/<10 jobb, 5 MSEK + Spick-täckning), verifierad (10+ jobb, 4.5+ rating, 10 MSEK + ren förmögenhet 2 MSEK), spick_pro (Almega-medlem, full täckning).';

-- ── 2. platform_settings för insurance-policy ──
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('insurance_tier_min_kr_provanstalld', '5000000', NOW())  -- 5 MSEK
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('insurance_tier_min_kr_verifierad', '10000000', NOW())  -- 10 MSEK
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('insurance_tier_min_kr_spick_pro', '10000000', NOW())  -- 10 MSEK + extras
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('insurance_property_damage_min_kr_verifierad', '2000000', NOW())  -- 2 MSEK ren förmögenhet
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('insurance_tier_upgrade_min_jobs', '10', NOW())  -- jobs för att kunna uppgradera till verifierad
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('insurance_tier_upgrade_min_rating', '4.5', NOW())  -- rating för upgradering
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('insurance_provanstalld_period_days', '90', NOW())  -- max-period som provanstalld
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('insurance_premium_job_threshold_kr', '2000', NOW())  -- jobb >2000 kr kräver verifierad+
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('insurance_spick_platform_coverage_kr', '5000000', NOW())  -- Spick-egen 5 MSEK extra för provanställda
ON CONFLICT (key) DO NOTHING;

-- ── 3. Index för tier-filter (matching) ──
CREATE INDEX IF NOT EXISTS idx_cleaners_insurance_tier_active
  ON public.cleaners(insurance_tier, status) WHERE status = 'aktiv';

-- ── 4. Trigger: auto-uppgradera till verifierad vid uppfyllt krav ──
CREATE OR REPLACE FUNCTION public.maybe_upgrade_insurance_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_jobs integer;
  v_min_rating numeric;
BEGIN
  -- Kolla bara om cleaner är provanstalld + har giltig 10 MSEK-försäkring
  IF NEW.insurance_tier = 'provanstalld'
     AND NEW.insurance_amount_kr >= 10000000
     AND NEW.insurance_verified_at IS NOT NULL THEN

    SELECT (value)::integer INTO v_min_jobs
    FROM public.platform_settings WHERE key = 'insurance_tier_upgrade_min_jobs';

    SELECT (value)::numeric INTO v_min_rating
    FROM public.platform_settings WHERE key = 'insurance_tier_upgrade_min_rating';

    IF NEW.jobs_completed >= COALESCE(v_min_jobs, 10)
       AND COALESCE(NEW.avg_rating, 0) >= COALESCE(v_min_rating, 4.5) THEN
      NEW.insurance_tier := 'verifierad';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_maybe_upgrade_insurance_tier ON public.cleaners;
CREATE TRIGGER trg_maybe_upgrade_insurance_tier
  BEFORE UPDATE ON public.cleaners
  FOR EACH ROW
  EXECUTE FUNCTION public.maybe_upgrade_insurance_tier();
