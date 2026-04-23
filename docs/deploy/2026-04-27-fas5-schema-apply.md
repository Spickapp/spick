# Deploy: Fas 5.2 Schema-utvidgning (subscriptions + customer_preferences)

**Migration:** `supabase/migrations/20260427000002_fas5_recurring_retention_schema.sql`
**Design:** `docs/architecture/recurring-retention-system.md` §11.1
**Estimat:** 2-3 min köra + verifiera
**Risk:** Låg — idempotent, bevarar alla existing kolumner, ingen backfill

---

## Bakgrund (varför korrigerad 2026-04-23)

Första versionen av denna migration antog schema från `003_subs.sql` (46 kolumner). Prod-verifiering via `information_schema`-query visade att prod-schema har drift — flera planerade kolumner finns redan (`company_id`, `cleaner_id`, `payment_mode`, `auto_delegation_enabled`, `updated_at`). Plus: `preferred_day` är INTEGER i prod (inte TEXT som 003_subs.sql säger).

**Korrigerat scope:** bara 7 nya kolumner (inte 12) + customer_preferences-tabell + INGEN backfill (gamla kolumner är annan semantik).

---

## Vad migrationen gör

1. **Utökar `subscriptions` med 7 NYA kolumner:**
   - `preferred_days text[]` — flera veckodagar (framtida: ersätter `preferred_day INTEGER`)
   - `frequency_config jsonb` — avancerade frekvens-patterns
   - `duration_mode text DEFAULT 'open_ended'` — open_ended / fixed_count / end_date
   - `max_occurrences integer` — för fixed_count
   - `end_date date` — för end_date-mode
   - `cleaner_flex text DEFAULT 'any'` — specific_cleaner / specific_company / any
   - `holiday_mode text DEFAULT 'auto_skip'` — auto_skip / auto_shift / manual

2. **Skapar ny tabell `customer_preferences`** (14 kolumner) med RLS.

3. **3 CHECK constraints** för enum-säkerhet (duration_mode, cleaner_flex, holiday_mode). OBS: `payment_mode` CHECK utelämnas eftersom kolumnen finns redan i prod och kan ha existing värden som skulle bryta en strikt enum.

4. **INGEN backfill** — gamla kolumner (preferred_day INTEGER, cleaner_id, payment_mode) bevaras. Nya kolumner aktiveras när §5.3 generate-recurring-bookings retrofittas att läsa dem.

5. **2 performance-index** + **1 trigger** för customer_preferences.updated_at.

---

## Steg 1 — Pre-check i Studio SQL

```sql
-- Verifiera att nya kolumner inte finns än
SELECT column_name FROM information_schema.columns
WHERE table_name='subscriptions' AND column_name IN (
  'preferred_days','frequency_config','duration_mode','max_occurrences',
  'end_date','cleaner_flex','holiday_mode'
);
-- Förväntat: 0 rader

-- customer_preferences ska ej finnas
SELECT to_regclass('public.customer_preferences') AS exists;
-- Förväntat: NULL

-- Baseline-räkning subscriptions (bara för context)
SELECT COUNT(*) AS total FROM subscriptions;
```

---

## Steg 2 — Kör migrationen

I Supabase Studio SQL Editor:

1. Öppna filen i din editor:
   ```
   C:\Users\farha\spick\supabase\migrations\20260427000002_fas5_recurring_retention_schema.sql
   ```
2. Ctrl+A → Ctrl+C → klistra in i Studio → klicka RUN (eller Ctrl+Enter)

Förväntat sista resultat:
```
MIGRATION 20260427000002 COMPLETE — 7 nya subscriptions-kolumner + customer_preferences skapad (ingen backfill, nya kolumner fylls av §5.3 EFs)
```

Om ERROR → stoppa och rapportera. BEGIN/COMMIT-transaktionen rullar tillbaka automatiskt.

---

## Steg 3 — Post-verifiering

```sql
-- A. Nya kolumner finns (förväntat: 7 rader)
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name='subscriptions'
  AND column_name IN (
    'preferred_days','frequency_config','duration_mode','max_occurrences',
    'end_date','cleaner_flex','holiday_mode'
  )
ORDER BY column_name;

-- B. customer_preferences finns + har RLS
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename='customer_preferences';
-- Förväntat: 1 rad, rowsecurity=true

-- C. CHECK constraints (3 st)
SELECT constraint_name FROM information_schema.check_constraints
WHERE constraint_name LIKE 'subs_%_check'
  AND constraint_name IN ('subs_duration_mode_check','subs_cleaner_flex_check','subs_holiday_mode_check');
-- Förväntat: 3 rader

-- D. Index (2 nya + customer_preferences-index)
SELECT indexname FROM pg_indexes
WHERE tablename IN ('subscriptions','customer_preferences')
  AND indexname IN (
    'idx_subs_cleaner_aktiv',
    'idx_subs_status_next_date',
    'idx_customer_prefs_email',
    'idx_customer_prefs_favorite_cleaner'
  );
-- Förväntat: 4 rader

-- E. Trigger på customer_preferences
SELECT trigger_name FROM information_schema.triggers
WHERE trigger_name = 'customer_prefs_auto_updated_at';
-- Förväntat: 1 rad

-- F. Existing rows får safe defaults (inga NULL-krascher)
SELECT 
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE duration_mode = 'open_ended') AS has_duration_default,
  COUNT(*) FILTER (WHERE cleaner_flex = 'any') AS has_cleaner_flex_default,
  COUNT(*) FILTER (WHERE holiday_mode = 'auto_skip') AS has_holiday_mode_default
FROM subscriptions;
-- Förväntat: alla tre defaults = total antal rader
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

-- Test trigger
UPDATE customer_preferences
SET prefers_eco_products = false
WHERE customer_email = 'test-fas5@example.invalid';

SELECT created_at, updated_at, created_at != updated_at AS trigger_worked
FROM customer_preferences
WHERE customer_email = 'test-fas5@example.invalid';

-- Cleanup
DELETE FROM customer_preferences WHERE customer_email = 'test-fas5@example.invalid';
```

---

## Rollback (om något går fel)

```sql
BEGIN;

-- Radera nya kolumner + constraints
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subs_duration_mode_check,
  DROP CONSTRAINT IF EXISTS subs_cleaner_flex_check,
  DROP CONSTRAINT IF EXISTS subs_holiday_mode_check,
  DROP COLUMN IF EXISTS preferred_days,
  DROP COLUMN IF EXISTS frequency_config,
  DROP COLUMN IF EXISTS duration_mode,
  DROP COLUMN IF EXISTS max_occurrences,
  DROP COLUMN IF EXISTS end_date,
  DROP COLUMN IF EXISTS cleaner_flex,
  DROP COLUMN IF EXISTS holiday_mode;

-- Radera customer_preferences helt
DROP TABLE IF EXISTS customer_preferences CASCADE;
DROP FUNCTION IF EXISTS touch_customer_prefs_updated_at();

-- Index raderas automatiskt med DROP COLUMN / DROP TABLE

COMMIT;
```

---

## Nästa fas

Efter denna migration är deploy:ad:

- **§5.3 generate-recurring-bookings cron** (3-4h) — retrofitta auto-rebook EF att läsa nya kolumner, använda cleaner_flex-logik, respektera duration_mode
- **§5.4 Kund-UI** (2-3h) — pause/skip/cancel för subscriptions i min-bokning.html
- **§5.5** — customer_preferences helpers + UI för opt-in-favoriter

Inget blockar Farhads drift. Nya kolumner är opt-in per subscription. Gamla kolumner bevaras.

---

## Regler

- **#26** grep-verifierat 003_subs.sql + information_schema-query för varje förväntad kolumn
- **#27** scope: SCHEMA only, 0 EF-ändringar, 0 frontend, ingen backfill
- **#28** single source: återanvänder existing cleaner_id/company_id/payment_mode/updated_at istället för dubletter
- **#31** prod-schema via information_schema = primärkälla. Tidigare antagande från 003_subs.sql korrigerat efter pre-check misslyckades (favorite_cleaner_email finns ej i prod).
