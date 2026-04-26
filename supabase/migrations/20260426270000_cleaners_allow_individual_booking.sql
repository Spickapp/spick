-- cleaners.allow_individual_booking — toggle per cleaner för bokningsflödet
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: Zivar (VD Solid Service AB) har timanställda. Han vill kunna
--   visa team-medlemmar (profil/betyg/jobb) men kund ska bara kunna
--   boka HELA företaget för dem — inte specifik person.
--
-- Affärslogik:
--   - PER-cleaner toggle (inte company-level)
--   - Default true = nuvarande beteende (F-skattar-modell)
--   - VD togglar av per cleaner som är timanställd
--   - Existerande subscriptions GRANDFATHERS (inget filter på charge-EF)
--   - VD själv = vanlig cleaner (samma toggle)
--
-- Verifiering rule #31 (2026-04-26):
--   - cleaners.allow_individual_booking → 42703 (saknas) ✓
--   - v_cleaners_for_booking finns LIVE — vi rör den INTE för att
--     undvika att tappa kolumner. Skapar minimal hjälp-vy istället.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Lägg till kolumn på cleaners ──
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS allow_individual_booking boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.cleaners.allow_individual_booking IS
  'Per-cleaner toggle (Zivar 2026-04-26). True = kund kan boka individuellt (F-skattare-modell). False = bara via företag (timanställd-modell). Default true. VD togglar via stadare-dashboard Team-tab.';

-- ── 2. Index för matching-wrapper-filter ──
CREATE INDEX IF NOT EXISTS idx_cleaners_allow_individual_booking_false
  ON public.cleaners(allow_individual_booking)
  WHERE allow_individual_booking = false;

-- ── 3. Minimal publik vy för boka.html / matching ──
-- Bara id + allow_individual_booking + company_id. Frontend joinerar lokalt
-- mot v_cleaners_for_booking (befintlig vy lämnas orörd). Säkrast — inga
-- existing kolumner kan tappas av oss.
CREATE OR REPLACE VIEW public.v_cleaner_booking_mode AS
SELECT
  c.id,
  c.allow_individual_booking,
  c.company_id,
  c.is_company_owner
FROM public.cleaners c
WHERE c.is_approved = true
  AND c.status = 'aktiv';

GRANT SELECT ON public.v_cleaner_booking_mode TO anon;
GRANT SELECT ON public.v_cleaner_booking_mode TO authenticated;

COMMENT ON VIEW public.v_cleaner_booking_mode IS
  'Minimal vy för per-cleaner booking-mode lookup (Zivar 2026-04-26). Frontend gör IN-batch-fetch + lokal join för att avgöra om individual-bok-knapp ska visas.';
