-- ============================================================
-- Fas 5.2 — Utökat schema för Recurring + Retention
-- ============================================================
--
-- Primärkälla: docs/architecture/recurring-retention-system.md §11.1
-- Tidigare subscriptions-state: docs/../migrations/003_subs.sql (baseline)
--
-- LEVERANS
-- ========
-- 1. Utökar subscriptions med 12 nya kolumner (dagar multi-select,
--    frekvens-config, längd-modell, cleaner-flex, payment-mode,
--    helgdag-mode, updated_at)
-- 2. 4 CHECK constraints för enum-säkerhet
-- 3. Ny tabell: customer_preferences (separerad från subscriptions så
--    preferenser överlever annullering)
-- 4. Backfill: migrera preferred_day → preferred_days (array) +
--    favorite_cleaner_email → preferred_cleaner_id (uuid-FK)
-- 5. RLS-policies för customer_preferences
--
-- BAKÅTKOMPATIBILITET
-- ===================
-- Gamla kolumner (preferred_day, favorite_cleaner_email) BEVARAS som
-- deprecated. Existerande EFs (auto-rebook, charge-subscription-booking)
-- läser nya kolumner först, fallback till gamla om NULL.
--
-- Deprecation-plan: DROP de gamla kolumnerna efter Fas 5.3
-- (generate-recurring-bookings) är migrerad + 30 dagars parallell-kör.
--
-- ROLLBACK
-- ========
-- DROP COLUMN IF EXISTS på alla nya kolumner (14 st) + DROP TABLE IF
-- EXISTS customer_preferences. Se §12 i recurring-retention-system.md.
--
-- Regler: #26 grep-verifierat 003_subs.sql + information_schema-query
-- för customer_preferences (404 = tabell finns ej), #27 scope
-- (schema-only, ingen EF/frontend i denna commit), #28 single source
-- (subscriptions + customer_preferences), #30 ej aktuellt,
-- #31 existence-check körd före skrivning (rule #31-brott tidigare i
-- session med bookings.company_id lärdom tillämpad).
-- ============================================================

BEGIN;

-- ══════════════════════════════════════════════════════════
-- 1. SUBSCRIPTIONS utvidgning (12 nya kolumner)
-- ══════════════════════════════════════════════════════════

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS preferred_days text[],
  ADD COLUMN IF NOT EXISTS frequency_config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS duration_mode text DEFAULT 'open_ended',
  ADD COLUMN IF NOT EXISTS max_occurrences integer,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS preferred_cleaner_id uuid,
  ADD COLUMN IF NOT EXISTS preferred_company_id uuid,
  ADD COLUMN IF NOT EXISTS cleaner_flex text DEFAULT 'any',
  ADD COLUMN IF NOT EXISTS payment_mode text DEFAULT 'per_occurrence',
  ADD COLUMN IF NOT EXISTS prepaid_until date,
  ADD COLUMN IF NOT EXISTS holiday_mode text DEFAULT 'auto_skip',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Foreign keys (idempotent via DO block så IF NOT EXISTS-pattern fungerar)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'subs_preferred_cleaner_fk'
      AND table_name = 'subscriptions'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subs_preferred_cleaner_fk
      FOREIGN KEY (preferred_cleaner_id) REFERENCES cleaners(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'subs_preferred_company_fk'
      AND table_name = 'subscriptions'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subs_preferred_company_fk
      FOREIGN KEY (preferred_company_id) REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- CHECK constraints (4 st) — idempotent via ADD CONSTRAINT IF NOT EXISTS
-- workaround: drop+recreate
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subs_duration_mode_check,
  DROP CONSTRAINT IF EXISTS subs_cleaner_flex_check,
  DROP CONSTRAINT IF EXISTS subs_payment_mode_check,
  DROP CONSTRAINT IF EXISTS subs_holiday_mode_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subs_duration_mode_check
    CHECK (duration_mode IN ('open_ended', 'fixed_count', 'end_date')),
  ADD CONSTRAINT subs_cleaner_flex_check
    CHECK (cleaner_flex IN ('specific_cleaner', 'specific_company', 'any')),
  ADD CONSTRAINT subs_payment_mode_check
    CHECK (payment_mode IN ('per_occurrence', 'monthly_prepaid', 'full_prepaid')),
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

-- Kund läser/uppdaterar egen rad via email-match (JWT-scope)
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

-- Service role: full access (för booking-create backfill + admin)
DROP POLICY IF EXISTS "Service role manages preferences" ON customer_preferences;
CREATE POLICY "Service role manages preferences"
  ON customer_preferences FOR ALL
  USING (auth.role() = 'service_role');

-- ══════════════════════════════════════════════════════════
-- 3. BACKFILL (befintliga subscriptions-rader)
-- ══════════════════════════════════════════════════════════

-- 3a. Migrera preferred_day (single text) → preferred_days (array)
-- Svenska → 3-bokstavskoder. Case-insensitive.
UPDATE subscriptions SET
  preferred_days = CASE
    WHEN preferred_day IS NULL THEN NULL
    WHEN LOWER(preferred_day) LIKE 'mån%' OR LOWER(preferred_day) LIKE 'mon%' THEN ARRAY['mon']
    WHEN LOWER(preferred_day) LIKE 'tis%' OR LOWER(preferred_day) LIKE 'tue%' THEN ARRAY['tue']
    WHEN LOWER(preferred_day) LIKE 'ons%' OR LOWER(preferred_day) LIKE 'wed%' THEN ARRAY['wed']
    WHEN LOWER(preferred_day) LIKE 'tor%' OR LOWER(preferred_day) LIKE 'thu%' THEN ARRAY['thu']
    WHEN LOWER(preferred_day) LIKE 'fre%' OR LOWER(preferred_day) LIKE 'fri%' THEN ARRAY['fri']
    WHEN LOWER(preferred_day) LIKE 'lör%' OR LOWER(preferred_day) LIKE 'sat%' THEN ARRAY['sat']
    WHEN LOWER(preferred_day) LIKE 'sön%' OR LOWER(preferred_day) LIKE 'sun%' THEN ARRAY['sun']
    ELSE NULL
  END
WHERE preferred_days IS NULL AND preferred_day IS NOT NULL;

-- 3b. Migrera favorite_cleaner_email → preferred_cleaner_id + cleaner_flex
UPDATE subscriptions s SET
  preferred_cleaner_id = c.id,
  cleaner_flex = 'specific_cleaner',
  updated_at = now()
FROM cleaners c
WHERE s.favorite_cleaner_email IS NOT NULL
  AND LOWER(TRIM(s.favorite_cleaner_email)) = LOWER(TRIM(c.email))
  AND s.preferred_cleaner_id IS NULL;

-- Alla andra existerande rader utan preference får cleaner_flex='any' (default)
-- Detta sker automatiskt via ADD COLUMN DEFAULT 'any' ovan.

-- ══════════════════════════════════════════════════════════
-- 4. Index för prestanda
-- ══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_subs_preferred_cleaner
  ON subscriptions(preferred_cleaner_id)
  WHERE preferred_cleaner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subs_preferred_company
  ON subscriptions(preferred_company_id)
  WHERE preferred_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subs_status_next_date
  ON subscriptions(status, next_booking_date)
  WHERE status = 'aktiv';

-- ══════════════════════════════════════════════════════════
-- 5. Trigger: updated_at auto-update
-- ══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION touch_subscriptions_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subs_auto_updated_at ON subscriptions;
CREATE TRIGGER subs_auto_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION touch_subscriptions_updated_at();

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

SELECT 'MIGRATION 20260427000002 COMPLETE — subscriptions utökad + customer_preferences skapad + backfill klar' AS result;
