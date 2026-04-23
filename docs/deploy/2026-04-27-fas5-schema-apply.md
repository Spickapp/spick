# Deploy: Fas 5.2 Schema-utvidgning (subscriptions + customer_preferences)

**Migration:** `supabase/migrations/20260427000002_fas5_recurring_retention_schema.sql`
**Design:** `docs/architecture/recurring-retention-system.md` §11.1
**Estimat:** 2-3 min köra + verifiera
**Risk:** Låg — idempotent, bevarar gamla kolumner, inga datamanipulationer på kritisk kolumn

---

## Vad migrationen gör

1. **Utökar `subscriptions` med 12 kolumner:**
   - `preferred_days text[]` — flera veckodagar (istället för 1 string)
   - `frequency_config jsonb` — avancerade frekvens-patterns
   - `duration_mode text DEFAULT 'open_ended'` — open_ended / fixed_count / end_date
   - `max_occurrences int` — för fixed_count
   - `end_date date` — för end_date-mode
   - `preferred_cleaner_id uuid FK cleaners` — ersätter favorite_cleaner_email
   - `preferred_company_id uuid FK companies` — för "vem som helst från X"
   - `cleaner_flex text DEFAULT 'any'` — specific_cleaner / specific_company / any
   - `payment_mode text DEFAULT 'per_occurrence'` — per_occurrence / monthly_prepaid / full_prepaid
   - `prepaid_until date` — för prepaid-modeller
   - `holiday_mode text DEFAULT 'auto_skip'` — auto_skip / auto_shift / manual
   - `updated_at timestamptz DEFAULT now()` — via auto-trigger

2. **Skapar ny tabell `customer_preferences`** (14 kolumner) med RLS så kund läser/uppdaterar egen rad.

3. **4 CHECK constraints** för enum-säkerhet.

4. **Backfill:**
   - `preferred_day` (Onsdag/onsdag/wed/…) → `preferred_days` array (`['wed']`)
   - `favorite_cleaner_email` → match mot `cleaners.email` → `preferred_cleaner_id` + `cleaner_flex='specific_cleaner'`

5. **3 performance-index** (preferred_cleaner_id, preferred_company_id, status+next_booking_date).

6. **2 auto-update-triggers** för `updated_at` på båda tabellerna.

---

## Steg 1 — Pre-check i Studio SQL

```sql
-- Innan (expected: subscriptions finns men saknar nya kolumner)
SELECT column_name FROM information_schema.columns
WHERE table_name='subscriptions' AND column_name IN (
  'preferred_days','frequency_config','duration_mode','cleaner_flex','payment_mode'
);
-- Förväntat: 0 rader (kolumnerna finns ej än)

SELECT to_regclass('public.customer_preferences') AS exists;
-- Förväntat: NULL (tabellen finns ej än)

-- Existerande subscription-rader (för backfill-verifiering)
SELECT COUNT(*) AS total, 
       COUNT(*) FILTER (WHERE preferred_day IS NOT NULL) AS with_preferred_day,
       COUNT(*) FILTER (WHERE favorite_cleaner_email IS NOT NULL) AS with_favorite_email
FROM subscriptions;
```

Notera siffrorna — dessa används för att bekräfta backfill efter migrationen.

---

## Steg 2 — Kör migrationen

I Supabase Studio SQL Editor, klistra in hela innehållet från:
```
supabase/migrations/20260427000002_fas5_recurring_retention_schema.sql
```

Eller via Supabase CLI:
```bash
supabase db push --project-ref urjeijcncsyuletprydy
```

(Obs: om lokal migrations-kedja är ur sync — använd Studio-metoden istället, per §2.1 hygien-flag #25.)

Förväntat sista resultat:
```
MIGRATION 20260427000002 COMPLETE — subscriptions utökad + customer_preferences skapad + backfill klar
```

---

## Steg 3 — Post-verifiering

```sql
-- A. Nya kolumner existerar
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name='subscriptions'
  AND column_name IN (
    'preferred_days','frequency_config','duration_mode','max_occurrences',
    'end_date','preferred_cleaner_id','preferred_company_id','cleaner_flex',
    'payment_mode','prepaid_until','holiday_mode','updated_at'
  )
ORDER BY column_name;
-- Förväntat: 12 rader

-- B. customer_preferences existerar + har RLS
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE tablename='customer_preferences';
-- Förväntat: 1 rad med rowsecurity=true

-- C. CHECK constraints
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name LIKE 'subs_%_check';
-- Förväntat: 4 rader (duration_mode, cleaner_flex, payment_mode, holiday_mode)

-- D. Backfill-verifiering (jämför med pre-check-siffror)
SELECT 
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE preferred_days IS NOT NULL) AS with_preferred_days,
  COUNT(*) FILTER (WHERE preferred_cleaner_id IS NOT NULL) AS with_preferred_cleaner_id,
  COUNT(*) FILTER (WHERE cleaner_flex = 'specific_cleaner') AS cleaner_flex_specific
FROM subscriptions;
-- Förväntat: with_preferred_days ≥ with_preferred_day från pre-check
-- Förväntat: with_preferred_cleaner_id ≤ with_favorite_email (bara de där email matchade cleaners.email)

-- E. Index
SELECT indexname FROM pg_indexes
WHERE tablename IN ('subscriptions', 'customer_preferences')
  AND indexname LIKE 'idx_%';
-- Förväntat: minst 5 index (subs_preferred_cleaner, subs_preferred_company, 
--           subs_status_next_date, customer_prefs_email, customer_prefs_favorite_cleaner)

-- F. Triggers
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_name IN ('subs_auto_updated_at', 'customer_prefs_auto_updated_at');
-- Förväntat: 2 rader (båda BEFORE UPDATE)
```

---

## Steg 4 — Smoke-test (optional)

```sql
-- Skapa en test-preference
INSERT INTO customer_preferences (
  customer_email, default_has_pets, prefers_eco_products
) VALUES (
  'test-fas5@example.invalid', true, true
) RETURNING id, created_at, updated_at;

-- Test updated_at auto-trigger
UPDATE customer_preferences
SET prefers_eco_products = false
WHERE customer_email = 'test-fas5@example.invalid';

SELECT created_at, updated_at, created_at != updated_at AS trigger_worked
FROM customer_preferences
WHERE customer_email = 'test-fas5@example.invalid';
-- Förväntat: trigger_worked = true

-- Cleanup
DELETE FROM customer_preferences WHERE customer_email = 'test-fas5@example.invalid';
```

---

## Rollback (om något går fel)

```sql
BEGIN;

-- Återvänd subscriptions till pre-migration-tillstånd
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subs_duration_mode_check,
  DROP CONSTRAINT IF EXISTS subs_cleaner_flex_check,
  DROP CONSTRAINT IF EXISTS subs_payment_mode_check,
  DROP CONSTRAINT IF EXISTS subs_holiday_mode_check,
  DROP CONSTRAINT IF EXISTS subs_preferred_cleaner_fk,
  DROP CONSTRAINT IF EXISTS subs_preferred_company_fk,
  DROP COLUMN IF EXISTS preferred_days,
  DROP COLUMN IF EXISTS frequency_config,
  DROP COLUMN IF EXISTS duration_mode,
  DROP COLUMN IF EXISTS max_occurrences,
  DROP COLUMN IF EXISTS end_date,
  DROP COLUMN IF EXISTS preferred_cleaner_id,
  DROP COLUMN IF EXISTS preferred_company_id,
  DROP COLUMN IF EXISTS cleaner_flex,
  DROP COLUMN IF EXISTS payment_mode,
  DROP COLUMN IF EXISTS prepaid_until,
  DROP COLUMN IF EXISTS holiday_mode,
  DROP COLUMN IF EXISTS updated_at;

DROP TRIGGER IF EXISTS subs_auto_updated_at ON subscriptions;
DROP FUNCTION IF EXISTS touch_subscriptions_updated_at();

-- Radera customer_preferences helt
DROP TABLE IF EXISTS customer_preferences CASCADE;
DROP FUNCTION IF EXISTS touch_customer_prefs_updated_at();

-- Radera index (DROP COLUMN ovan raderar dem automatiskt)

COMMIT;
```

Backfill-data är EJ reverterbar (gamla `preferred_day` + `favorite_cleaner_email`-värden bevarade i tabellen — rollback raderar bara de nya kolumnerna).

---

## Nästa fas

Efter denna migration är deploy:ad:

- **§5.3 generate-recurring-bookings cron** (3-4h) — läsa nya kolumner + generera bookings 4v i förväg
- **§5.4 Kund-UI** (2-3h) — pause/skip/cancel för subscriptions i min-bokning.html
- **§5.5-5.9** — customer_preferences helpers, "boka samma igen"-knappar, preference-learning, email-nudges

Inget blockar Farhads vanliga drift. Gamla kolumner fortsätter fungera, nya är opt-in per subscription.

---

## Regler

- **#26** grep-verifierat innan ALTER (003_subs.sql + information_schema-query)
- **#27** scope: SCHEMA only, 0 EF-ändringar, 0 frontend, 0 DB-logic-ändringar
- **#28** single source (subscriptions för schedule, customer_preferences för personliga inställningar, FK-länkar till cleaners/companies)
- **#31** pre-check körd (customer_preferences=404, subscriptions tom array) innan filskrivning
