-- ═══════════════════════════════════════════════════════════════
-- Fas 7.5 — rut_batch_submissions
-- ═══════════════════════════════════════════════════════════════
--
-- Tracker för RUT XML-export-batchar som Farhad genererar och manuellt
-- laddar upp till Skatteverket via https://www7.skatteverket.se/portal/rotrut/begar-utbetalning/fil
--
-- Flow:
--   draft     → bokningar samlas i batch (admin väljer via checkboxes)
--   exported  → XML-fil genererad, nedladdad av Farhad
--   submitted → Farhad har laddat upp till SKV (manuellt markerad)
--   approved  → SKV godkänt (manuellt markerad efter SKV-svar)
--   partial   → Vissa bokningar godkända, vissa nekade (manuellt markerad)
--   rejected  → SKV nekat hela batchen (manuellt markerad)
--   cancelled → Batchen makulerad innan inlämning
--
-- Primärkälla för XML-format: docs/skatteverket/xsd-v6/Begaran.xsd (V6)
-- Regler: docs/skatteverket/README.md
--
-- Rule #27: Bara batch-metadata + koppling till bookings via array.
--           Ingen auto-submit till SKV (ingen API existerar).
-- Rule #28: Återanvänder existing escrow_state + rut_application_status
--           på bookings-tabellen. Ingen fragmentering.
-- Rule #30: Alla fältnamn + validering per SKV:s publika XSD.
-- Rule #31: prod-verifierat att rut_amount + bookings.completed_at finns.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.rut_batch_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Batch-metadata (max 16 tecken per SKV XSD NamnPaBegaranTYPE)
  batch_name text NOT NULL CHECK (length(batch_name) BETWEEN 1 AND 16),

  -- Alla betalningsdatum i filen måste vara inom samma kalenderår
  submission_year integer NOT NULL CHECK (submission_year BETWEEN 2009 AND 2099),

  -- Array av booking_ids inkluderade i batchen (max 100 per SKV-regel)
  booking_ids uuid[] NOT NULL CHECK (array_length(booking_ids, 1) BETWEEN 1 AND 100),

  -- Aggregat (cachat för dashboard, kan alltid räknas fram från booking_ids)
  total_bookings integer NOT NULL,
  total_begart_belopp integer NOT NULL CHECK (total_begart_belopp >= 0),
  total_prisforarbete integer NOT NULL CHECK (total_prisforarbete >= 0),

  -- Status-maskin
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'exported', 'submitted', 'approved', 'partial', 'rejected', 'cancelled')),

  -- XML-fil
  xml_file_path text,           -- Storage-path efter export (t.ex. rut-batches/2026-04/abc.xml)
  xml_generated_at timestamptz,
  xml_file_size_bytes integer,
  xml_checksum text,            -- SHA256 för integritet

  -- SKV-respons (manuell input efter Farhad fått svar)
  submitted_to_skv_at timestamptz,     -- När Farhad laddade upp filen
  skv_response_at timestamptz,         -- När SKV svarade
  skv_response_reference text,         -- SKV:s ärendenummer om givet
  skv_response_notes text,             -- Fritextsfält för anteckningar
  approved_amount_sek integer,         -- Faktiskt godkänt belopp (kan avvika)
  rejected_reasons jsonb,              -- { booking_id: "anledning" } vid partial

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,                     -- admin cleaner_id som skapade batchen
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- Index för admin-dashboard
CREATE INDEX IF NOT EXISTS idx_rut_batch_submissions_status
  ON public.rut_batch_submissions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rut_batch_submissions_year
  ON public.rut_batch_submissions(submission_year DESC, status);

-- Index för booking-lookup (hitta vilken batch en bokning tillhör)
CREATE INDEX IF NOT EXISTS idx_rut_batch_submissions_bookings
  ON public.rut_batch_submissions USING gin(booking_ids);

-- Trigger: updated_at
CREATE OR REPLACE FUNCTION public.rut_batch_submissions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rut_batch_updated_at ON public.rut_batch_submissions;
CREATE TRIGGER trg_rut_batch_updated_at
  BEFORE UPDATE ON public.rut_batch_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.rut_batch_submissions_updated_at();

-- RLS: bara service_role + admin kan se
ALTER TABLE public.rut_batch_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages rut batches" ON public.rut_batch_submissions;
CREATE POLICY "Service role manages rut batches"
  ON public.rut_batch_submissions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated admins can read rut batches" ON public.rut_batch_submissions;
CREATE POLICY "Authenticated admins can read rut batches"
  ON public.rut_batch_submissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

GRANT SELECT ON public.rut_batch_submissions TO authenticated;
GRANT ALL ON public.rut_batch_submissions TO service_role;

COMMENT ON TABLE public.rut_batch_submissions IS
  'Fas 7.5: RUT-batch-submissions till Skatteverket. Manuell upload-flow (ingen API finns). Primärkälla: docs/skatteverket/xsd-v6/.';

COMMIT;
