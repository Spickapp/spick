-- ═══════════════════════════════════════════════════════════════
-- SPICK Phase 2 — Foto-bevis + AI Quality Assessment
-- ═══════════════════════════════════════════════════════════════
--
-- Tier A.2: booking_proof_photos — före/efter-foton per booking
-- Tier A.4: booking_quality_assessments — AI-genererad kvalitets-score
--
-- KOMPLETTERAR Phase 1 (clock + checklist + incidents).
--
-- REGLER #26-#33 verifierat:
-- #28 SSOT — phase enum + assessment_score CHECK
-- #30 GDPR — foton roteras efter 90d (separat retention-job)
-- #33 AI-bedömning är RÅDGIVANDE, ej "garanti" (approved-claims-compliant)
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- A.2 booking_proof_photos
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.booking_proof_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  cleaner_id      UUID NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  phase           TEXT NOT NULL CHECK (phase IN ('before', 'after')),
  storage_path    TEXT NOT NULL,
  caption         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.booking_proof_photos IS
  'Före/efter-foton som bevis för utfört städ-arbete. GDPR: roteras efter 90d.';

CREATE INDEX IF NOT EXISTS idx_proof_booking
  ON public.booking_proof_photos(booking_id, phase, created_at DESC);

ALTER TABLE public.booking_proof_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_proof" ON public.booking_proof_photos;
CREATE POLICY "service_role_all_proof"
  ON public.booking_proof_photos FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "cleaner_read_own_proof" ON public.booking_proof_photos;
CREATE POLICY "cleaner_read_own_proof"
  ON public.booking_proof_photos FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    cleaner_id IN (
      SELECT id FROM public.cleaners
      WHERE auth_user_id = auth.uid() OR email = auth.jwt() ->> 'email'
    )
  );

REVOKE ALL ON public.booking_proof_photos FROM PUBLIC, anon;
GRANT SELECT ON public.booking_proof_photos TO authenticated;
GRANT ALL ON public.booking_proof_photos TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- A.4 booking_quality_assessments
-- AI-bedömning baserat på checklist + foton + booking-data
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.booking_quality_assessments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  cleaner_id      UUID NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  score           SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  ai_summary      TEXT NOT NULL,
  ai_strengths    JSONB DEFAULT '[]',
  ai_improvements JSONB DEFAULT '[]',
  triggered_by    TEXT NOT NULL CHECK (triggered_by IN ('clock_out', 'manual', 'cron')),
  raw_response    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.booking_quality_assessments IS
  'AI-genererade kvalitets-bedömningar (rådgivande, ej garanterad). Driver Spicks differentiator vs Tengella.';

CREATE INDEX IF NOT EXISTS idx_quality_booking
  ON public.booking_quality_assessments(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_cleaner_recent
  ON public.booking_quality_assessments(cleaner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_low_score
  ON public.booking_quality_assessments(score, created_at DESC)
  WHERE score < 70;

ALTER TABLE public.booking_quality_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_qa" ON public.booking_quality_assessments;
CREATE POLICY "service_role_all_qa"
  ON public.booking_quality_assessments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "cleaner_read_own_qa" ON public.booking_quality_assessments;
CREATE POLICY "cleaner_read_own_qa"
  ON public.booking_quality_assessments FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    cleaner_id IN (
      SELECT id FROM public.cleaners
      WHERE auth_user_id = auth.uid() OR email = auth.jwt() ->> 'email'
    )
  );

REVOKE ALL ON public.booking_quality_assessments FROM PUBLIC, anon;
GRANT SELECT ON public.booking_quality_assessments TO authenticated;
GRANT ALL ON public.booking_quality_assessments TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- Verifiering
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 20260427190000 — Phase 2 (Foto-bevis + AI-Quality)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  booking_proof_photos:           ✓ CREATED';
  RAISE NOTICE '  booking_quality_assessments:    ✓ CREATED';
  RAISE NOTICE '  Storage-bucket: skapas via Supabase Dashboard → Storage → New bucket "booking-proofs" (public=false, file-limit=10MB)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
