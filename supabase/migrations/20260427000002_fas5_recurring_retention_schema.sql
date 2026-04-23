-- ============================================================
-- Fas 5.2 — Utökat schema för Recurring + Retention
-- ============================================================
--
-- Primärkälla: docs/architecture/recurring-retention-system.md §11.1
-- Prod-schema verifierat 2026-04-23 via information_schema-query (subscriptions
-- har 46 kolumner). Min initiala migration antog 003_subs.sql-schema, men prod
-- har drift — flera kolumner finns redan (company_id, cleaner_id, payment_mode,
-- auto_delegation_enabled, updated_at, preferred_day som INTEGER).
--
-- LÄRDOM (regel #31): migration-filer i repo är stale vs prod. All schema-
-- verification måste göras mot prod-queries. Denna commit korrigerar tidigare
-- antaganden.
--
-- LEVERANS (korrigerat scope)
-- ===========================
-- 1. Lägger till 7 NYA kolumner på subscriptions:
--    preferred_days, frequency_config, duration_mode, max_occurrences,
--    end_date, cleaner_flex, holiday_mode
--    (INTE: preferred_cleaner_id/preferred_company_id — cleaner_id/company_id
--     finns redan. INTE: payment_mode/updated_at — finns redan.)
-- 2. 3 CHECK constraints (duration_mode, cleaner_flex, holiday_mode)
--    (INTE payment_mode CHECK — prod kan ha existing values som skulle bryta)
-- 3. Ny tabell customer_preferences (separerad från subscriptions)
-- 4. 3 performance-index
-- 5. INGEN backfill (gamla kolumn-semantik är olika — säkrast att nya kolumner
--    fylls i när §5.3 generate-recurring-bookings retrofittas)
--
-- BAKÅTKOMPATIBILITET
-- ===================
-- Alla nya kolumner är nullable eller har safe defaults. Existerande
-- subscription-rader får NULL på nya kolumner → auto-rebook-EF fortsätter
-- läsa gamla kolumner (preferred_day INTEGER, cleaner_id, payment_mode).
-- Nya kolumner aktiveras först när §5.3 retrofittar EFs att läsa dem.
--
-- Regler: #26 (grep + REST-probe för varje kolumn), #27 (enbart schema,
-- ingen EF), #28 (single source — återanvänder existing cleaner_id/
-- company_id istället för dubletter), #31 (prod-schema primärkälla,
-- ersätter antaganden från 003_subs.sql).
-- ============================================================

BEGIN;

-- ══════════════════════════════════════════════════════════
-- 1. SUBSCRIPTIONS: 7 NYA kolumner (verifierat saknas i prod)
-- ══════════════════════════════════════════════════════════

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS preferred_days text[],
  ADD COLUMN IF NOT EXISTS frequency_config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS duration_mode text DEFAULT 'open_ended',
  ADD COLUMN IF NOT EXISTS max_occurrences integer,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS cleaner_flex text DEFAULT 'any',
  ADD COLUMN IF NOT EXISTS holiday_mode text DEFAULT 'auto_skip';

-- CHECK constraints (3 st) — idempotent via drop+recreate
-- Vi lägger INTE till payment_mode CHECK eftersom kolumnen finns redan
-- i prod med potentiellt andra värden än våra enum-rekommendationer.
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subs_duration_mode_check,
  DROP CONSTRAINT IF EXISTS subs_cleaner_flex_check,
  DROP CONSTRAINT IF EXISTS subs_holiday_mode_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subs_duration_mode_check
    CHECK (duration_mode IN ('open_ended', 'fixed_count', 'end_date')),
  ADD CONSTRAINT subs_cleaner_flex_check
    CHECK (cleaner_flex IN ('specific_cleaner', 'specific_company', 'any')),
  ADD CONSTRAINT subs_holiday_mode_check
    CHECK (holiday_mode IN ('auto_skip', 'auto_shift', 'manual'));

-- ══════════════════════════════════════════════════════════
-- 2. CUSTOMER_PREFERENCES (ny tabell)
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_preferences (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email           text NOT NULL UNIQUE,
  favorite_cleaner_id      uuid REFERENCES cleaners(id) ON DELETE SET NULL,
  blocked_cleaner_ids      uuid[] DEFAULT '{}'::uuid[],
  default_has_pets         boolean,
  pet_type                 text,
  has_children_at_home     boolean,
  has_stairs               boolean,
  prefers_eco_products     boolean DEFAULT false,
  default_notes_to_cleaner text,
  budget_range_min_sek     integer,
  budget_range_max_sek     integer,
  language_preference      text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_prefs_email
  ON customer_preferences(customer_email);

CREATE INDEX IF NOT EXISTS idx_customer_prefs_favorite_cleaner
  ON customer_preferences(favorite_cleaner_id)
  WHERE favorite_cleaner_id IS NOT NULL;

-- RLS
ALTER TABLE customer_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customer reads own preferences" ON customer_preferences;
CREATE POLICY "Customer reads own preferences"
  ON customer_preferences FOR SELECT
  USING (customer_email = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Customer updates own preferences" ON customer_preferences;
CREATE POLICY "Customer updates own preferences"
  ON customer_preferences FOR UPDATE
  USING (customer_email = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Customer inserts own preferences" ON customer_preferences;
CREATE POLICY "Customer inserts own preferences"
  ON customer_preferences FOR INSERT
  WITH CHECK (customer_email = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Service role manages preferences" ON customer_preferences;
CREATE POLICY "Service role manages preferences"
  ON customer_preferences FOR ALL
  USING (auth.role() = 'service_role');

-- ══════════════════════════════════════════════════════════
-- 3. Index för prestanda (på befintliga kolumner)
-- ══════════════════════════════════════════════════════════

-- Observera: cleaner_id-index finns troligen redan (FK-index automatiskt).
-- Vi lägger ändå till explicit index för recurring-queries.
CREATE INDEX IF NOT EXISTS idx_subs_cleaner_aktiv
  ON subscriptions(cleaner_id)
  WHERE cleaner_id IS NOT NULL AND status = 'aktiv';

CREATE INDEX IF NOT EXISTS idx_subs_status_next_date
  ON subscriptions(status, next_booking_date)
  WHERE status = 'aktiv';

-- ══════════════════════════════════════════════════════════
-- 4. Trigger: updated_at auto-update på customer_preferences
-- ══════════════════════════════════════════════════════════
--
-- OBS: subscriptions.updated_at finns redan → trigger kan redan finnas.
-- Vi skapar bara för customer_preferences.

CREATE OR REPLACE FUNCTION touch_customer_prefs_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_prefs_auto_updated_at ON customer_preferences;
CREATE TRIGGER customer_prefs_auto_updated_at
  BEFORE UPDATE ON customer_preferences
  FOR EACH ROW
  EXECUTE FUNCTION touch_customer_prefs_updated_at();

COMMIT;

SELECT 'MIGRATION 20260427000002 COMPLETE — 7 nya subscriptions-kolumner + customer_preferences skapad (ingen backfill, nya kolumner fylls av §5.3 EFs)' AS result;
