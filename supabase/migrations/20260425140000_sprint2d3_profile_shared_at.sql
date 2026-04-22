-- ============================================================
-- Sprint 2 Dag 3 uppföljning (2026-04-25): cleaners.profile_shared_at
-- ============================================================
-- Syfte: Server-side persistens för onboarding-steget "Dela profillänk".
--
-- Rot-problem: stadare-dashboard.html rad 3610 markerade steget klart
-- enbart via localStorage — förlorades mellan browsers/enheter. Reala
-- användare (Zivar Majid, Solid Service) sitter med steg ej markerat
-- klart trots att de klickat knappen på annan enhet.
--
-- Fix: PATCH cleaners.profile_shared_at = NOW() vid klick. UI kollar
-- BÅDE DB-värde och localStorage för bakåtkompat med befintliga klickar.
--
-- Primärkälla:
--   - Session-diagnos av Zivar Majids konto (Sprint 2 Dag 3 uppföljning)
--   - stadare-dashboard.html rad 3610 (shareDone-condition)
--   - stadare-dashboard.html rad 3658 (onClick-handler)
--
-- Regler:
--   #26 — grep-före-edit: cleaner-objekt-flöde + _authHeadersLegacy()
--         lästa innan edit
--   #27 — scope: endast en kolumn + default null. Ingen backfill (befintliga
--         klickar lever i localStorage tills nästa klick över-skriver till DB).
--   #31 — primärkälla: prod-state av Zivars konto visade att kolumnen
--         saknades trots att han klickat en gång tidigare.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Lägg till kolumn (idempotent)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS profile_shared_at timestamptz;

COMMENT ON COLUMN public.cleaners.profile_shared_at IS
  'Sprint 2 Dag 3 (2026-04-25): server-side flag för onboarding-steg '
  '"Dela profillänk" i stadare-dashboard.html. Sätts när städaren klickar '
  '"Kopiera länk" i dashboard. NULL = ej klickat. Ersätter localStorage-only '
  'som förlorades mellan browsers/enheter. UI kollar BÅDE DB + localStorage.';

-- ────────────────────────────────────────────────────────────
-- 2. Verifiering
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cleaners'
      AND column_name = 'profile_shared_at'
  ) THEN
    RAISE EXCEPTION 'Sprint 2 Dag 3: profile_shared_at kolumn saknas efter ALTER';
  END IF;

  RAISE NOTICE 'OK: cleaners.profile_shared_at tillgänglig (timestamptz, NULL default)';
END $$;

COMMIT;
