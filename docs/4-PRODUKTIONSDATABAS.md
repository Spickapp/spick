# 4 — Produktionsdatabas (schema-sanning)

> **Senast verifierad:** 2026-04-22 från migrations + kodgreps + SQL-verifiering av `platform_settings` (§1.8-prompt).  
> **Obs:** Fullt `pg_dump --schema-only` ej körd ännu — schedulerad i §2.1 (Fas 2-plan). Fält markerade ⚠️ kräver SQL-verifiering. Fält markerade 🔍 flaggas för post-Fas 1 omräkning.  
> **Fas 1-status:** 9/10 sub-faser klara. Se [docs/v3-phase1-progress.md](v3-phase1-progress.md).

---

## Tabeller

### `cleaners` (huvudtabell för städare)

**Identitet & profil:**
- `id` uuid PRIMARY KEY
- `full_name` text
- `first_name` text, `last_name` text (används av `find_nearby_cleaners`-RPC)
- `email` text UNIQUE
- `phone` text
- `bio` text
- `avatar_url` text, `profile_image_url` text
- `city` text
- `services` text[] (array av tjänstenamn)
- `slug` text (URL-vänligt)
- `languages` text[] (språk städaren talar)

**Geo (⚠️ exakta fältnamn — INTE `lat`/`lng`):**
- `home_lat` double precision
- `home_lng` double precision
- `home_address` text
- `service_radius_km` integer (default 10)

**Prissättning:**
- `hourly_rate` integer (default 350, min 250, max 600)
- `commission_rate` numeric ⚠️ **SKA IGNORERAS AV NY KOD.** Historisk data-inkonsistens: blandade värden (`17`, `12`, `0.17`, `0`). Schema-default är `0.17` men rader lagras oftast som procent. Använd `platform_settings.commission_standard` istället (är `12` per 2026-04-17).
- `commission_tier` text (`new`, `established`, `professional`, `elite`) — deprecated sedan 12%-beslutet.
- `tier` text (`standard` eller `top`) — deprecated sedan 12%-beslutet. Parkerad i schema.

**Status-fält (4 st, delvis överlappande):**
| Fält | Default | Syfte | Var det används |
|------|---------|-------|------------------|
| `status` | `'aktiv'` | Admin-UI status. Värden: `aktiv`, `inaktiv`, `pausad`, etc. | `v_cleaners_for_booking` filtrerar `status='aktiv'`, admin-UI |
| `is_active` | `true` | Generell aktiveringsflagga | Vissa EFs, `find_nearby_cleaners` accepterar `is_active=true OR company_id IS NOT NULL` |
| `is_approved` | `false` | Admin har godkänt ansökan | Alla bokningsflöden kräver `is_approved=true` |
| `is_blocked` | `false` | Admin manuell blockering | Reserverad — används inte aktivt än |

**Vid cleaner-deaktivering:** Osäker på vilka fält — testa mot `v_cleaners_for_booking` (den filtrerar `is_approved AND status='aktiv'`).

**Företags-koppling:**
- `company_id` uuid REFERENCES `companies(id)` (NULL = solo)
- `is_company_owner` boolean (VD-roll — kan fakturera team)
- `owner_only` boolean (VD städar inte själv, bara hanterar team)

**Juridik/compliance:**
- `has_fskatt` boolean
- `fskatt_needs_help` boolean
- `identity_verified` boolean (default false)
- `has_insurance` boolean

**Stripe Connect:**
- `stripe_account_id` text
- `stripe_onboarding_status` text (`complete`, `pending`, etc.)

**Preferenser:**
- `pet_pref` text (tidigare trodde bool — SQL visar TEXT i `find_nearby_cleaners`)
- `elevator_pref` text

**Stats:**
- `avg_rating` numeric
- `review_count` integer
- `total_reviews` integer (separat fält — används av `find_nearby_cleaners`)
- `completed_jobs` integer
- `clawback_balance_sek` integer (0 om ingen skuld)

**Admin-fält:**
- `admin_notes` text

**Auth:**
- `otp_code` text, `otp_expires_at` timestamptz

---

### `companies` (städföretag/team)

- `id` uuid PRIMARY KEY
- `name` text (intern ref)
- `display_name` text (visningsnamn, används i kundkommunikation)
- `slug` text
- `org_number` text
- `owner_cleaner_id` uuid REFERENCES `cleaners(id)` (VD)
- `description` text

**Prissättning:**
- `commission_rate` numeric ⚠️ **SKA IGNORERAS AV NY KOD.** Samma historiska inkonsistens som `cleaners.commission_rate`. Använd `platform_settings.commission_standard` (INTE `commission_override` — det fältet existerar inte).
- `use_company_pricing` boolean (default false) — ⚠️ kritisk flagga, se `7-ARKITEKTUR-SANNING.md`

**Kundbokningsbeteenden:**
- `allow_customer_choice` boolean (default true — låter kund välja specifik cleaner)
- `show_individual_ratings` boolean (default true)

**Anställningsmodell:**
- `employment_model` text (`employed` eller `contractor`) — tillagd 2026-04-14
  - `employed`: anställda → utbetalning går till företaget
  - `contractor`: underleverantörer → utbetalning per person via Stripe Connect

**Företagsinfo (EJ relaterat till cleaner-fält — dessa EXISTERAR INTE på companies):**
- ❌ Ingen `city`
- ❌ Ingen `lat` / `lng`
- ❌ Ingen `is_active` (istället används `active` flagga om alls)

**Juridik/compliance (⚠️ fält som kan existera — kräver SQL-verifiering):**
- `underleverantor_agreement_accepted_at` timestamptz (⚠️ EJ verifierad att existerar)
- `dpa_accepted_at` timestamptz (⚠️ EJ verifierad)
- `insurance_verified` boolean (⚠️ EJ verifierad)
- `payment_trust_level` text (⚠️ EJ verifierad)
- `total_overdue_count` integer (⚠️ EJ verifierad)

**SQL att köra för att verifiera:**
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'companies' AND table_schema = 'public'
ORDER BY ordinal_position;
```

---

### `bookings`

- `id` uuid PRIMARY KEY
- `customer_name`, `customer_email`, `customer_phone`, `customer_address`
- `customer_pnr` text (krypterat), `customer_pnr_hash` text
- `cleaner_id` uuid REFERENCES cleaners
- `cleaner_name` text (snapshot — används även efter cleaner raderats)
- `service_type` text
- `booking_date` date, `booking_time` time
- `booking_hours` numeric, `actual_hours` numeric
- `square_meters` integer (för per_sqm-pricing)
- `total_price` integer (netto efter RUT, sparas av `booking-create` vid insert)
- `rut_amount` integer (RUT-avdraget, sparas separat)
- `frequency` text (`once`, `weekly`, `biweekly`, `monthly`)
- `status` text (pending, confirmed, bekräftad, in_progress, completed, avbokad, ...)
- `payment_status` text (`pending`, `paid`, `awaiting_charge`, `failed`)
- `payment_mode` text (`stripe_checkout`, `stripe_subscription`, `manual`)
- `stripe_session_id` text, `payment_intent_id` text

**Prismotor-fält (lagrade vid booking-insert):**
- `base_price_per_hour` numeric
- `customer_price_per_hour` numeric
- `cleaner_price_per_hour` numeric
- `commission_pct` integer (**PROCENT-format**). Historiska 26 rader har `17`; nya bokningar ska ha `12` via kod som läser `platform_settings.commission_standard`.
- `discount_pct` integer
- `discount_code` text
- `spick_gross_sek` integer
- `spick_net_sek` integer
- `net_margin_pct` numeric
- `stripe_fee_sek` numeric
- `credit_applied_sek` integer
- `customer_type` text (`privat`, `foretag`)
- `business_name`, `business_org_number`, `business_reference` text
- `auto_delegation_enabled` boolean (kund A aktiv vs B passiv, se MEMORY)

**RUT:**
- `rut_application_status` text (`pending`, `approved`, `rejected`, `not_applicable`)

**Override:**
- `manual_override_price` integer (VD/admin-överskriven)

**Subscription:**
- `subscription_id` uuid REFERENCES `subscriptions(id)` NULL
- `subscription_charge_attempts` integer
- `subscription_charge_failed_at` timestamptz

**Audit:**
- `confirmed_at`, `checked_in_at`, `checkout_time`, `completed_at` timestamptz
- `attest_status` text, `attested_at` timestamptz
- `cancelled_at` timestamptz, `cancellation_reason` text
- `key_type` text (`open`, `hidden`, `handover`), `key_info` text

**Viktig notering om `total_price` (uppdaterad 2026-04-22):**
Sparas av `booking-create` vid skapande. ~~`stripe-checkout` EF~~ — **RADERAD 2026-04-21 (§1.2 SUPERSEDED)**, se `git log --diff-filter=D -- 'supabase/functions/stripe-checkout/'`. booking-create:604 bär hela logiken idag + anropar `_shared/money.ts::getCommission()` för commission-läsning från `platform_settings`. 🔍 `use_company_pricing`-pricing-path kan vara oförändrad — verifiera post-Fas 1 om Rafa-pilot kräver denna flagga.

### Triggers på `bookings` (viktigt vid UPDATE-operationer)

| Trigger | Timing | Funktion |
|---------|--------|----------|
| `trg_auto_convert_referral` | UPDATE AFTER | `auto_convert_referral()` |
| `trg_booking_to_calendar` | INSERT/UPDATE/DELETE AFTER | `sync_booking_to_calendar()` ⚠️ kan kasta fel vid överlapp |
| `trg_booking_id` | INSERT BEFORE | `generate_booking_id()` |
| `trg_sync_booking` | INSERT BEFORE | `sync_booking_to_portal()` |
| `trg_sync_booking_slot` | INSERT/UPDATE AFTER | `sync_booking_to_slot()` |
| `trg_sync_booking_status` | UPDATE BEFORE | `fn_sync_booking_status()` |

**⚠️ Varning (P1-bug):** `trg_booking_to_calendar` triggas vid VARJE UPDATE på `bookings` (även om bara ett fält ändras). Funktionen `sync_booking_to_calendar()` försöker upsert till `calendar_events` som har `no_booking_overlap`-constraint. Om två befintliga bokningar överlappar → constraint-violation → UPDATE rullas tillbaka.

**Konsekvens idag:** 8 par överlappande testbokningar i prod blockerar legitima UPDATE-operationer (t.ex. batch-update av `commission_pct`). Se `3-TODOLIST-v2.md` P1-1 för fix-alternativ.

**Källa:** `supabase/migrations/20260414000001_calendar_events.sql:64-66, 215, 273`.

---

### `platform_settings` (single source of truth för pricing)

Nyckel-värde-tabell som sanning för commission, priser och systemflaggor. All kod ska läsa härifrån istället för att hårdkoda värden.

**Schema:**
- `key` text PRIMARY KEY
- `value` text (parseFloat eller JSON-parse i kod)
- `updated_at` timestamptz

**Kända nycklar per 2026-04-22 (SQL-verifierad):**

| key | value (live) | Sub-fas som la till | Beskrivning |
|-----|--------------|---------------------|-------------|
| `base_price_per_hour` | `399` | Pre-Fas 1 | Standardpris per timme (pricing-resolver fallback, steg 5) |
| `commission_standard` | `12` | Pre-Fas 1 (seed `17`) | Provision för ALLA bokningar (%) — läses av `_shared/money.ts::getCommission()` |
| `commission_top` | `12` | Pre-Fas 1 (seed `14`) | Reserverad för framtida top-tier. Lika med standard just nu. Hygien-task: verifiera om DROP-bar |
| `default_hourly_rate` | `350` | §1.8 (2026-04-22) | UI-default i admin/bli-stadare/join-team när `cleaner.hourly_rate` saknas. Skild från `base_price_per_hour` (pricing-resolver) |
| `escrow_enabled` | `false` | §1.5 seed | Aktiveras i Fas 8 (escrow). Idag: destination charges |
| `F1_USE_DB_SERVICES` | `false` | Pre-Fas 1 | Feature flag för Fas 4 (services genomgående) |
| `money_layer_enabled` | `true` | §1.1 seed, aktiverad 2026-04-20 19:07 UTC | Huvud-flagga för `_shared/money.ts` |
| `payout_trigger_mode` | `immediate` | §1.6 | Krävs av `triggerStripeTransfer()` för auto-trigger utan `force=true` |
| `rut_pct` | `50` | §1.5 seed | 50% RUT-avdrag (Skatteverket 2026). Heltal-procent, konsistent med commission_standard |
| `rut_yearly_cap_kr` | `75000` | §1.5 seed | Skatteverket-cap 2026 (per person/år) |
| `smart_trappstege_enabled` | `false` | §1.7 seed | Aktiverar Smart Trappstege-payout i `_resolveSmartTrappstege()` |
| `stripe_mode` | `live` | §1.6 | Mode-isolation för Fas 1.6.1. `getStripeClient()` väljer nyckel per cleaner |
| `subscription_price` | `349` | Pre-Fas 1 | Prenumerationspris |

**Totalt: 13 nycklar** (ingen `commission_change_log` eller `auto_remind_last_run` i SQL-verifiering 22 apr — om de existerar är de utanför scope). Hygien-task: `base_price_per_hour=399` vs `default_hourly_rate=350` — semantiskt liknande, se hygien-task i progress-fil.

**RLS:**
- `SELECT` tillåten för alla (`Public read platform_settings`).
- `ALL` endast för `service_role`.

**Användningsmönster:**
```ts
const { data } = await sb.from('platform_settings')
  .select('value').eq('key', 'commission_standard').single();
const commissionPct = parseFloat(data.value);
```

---

### `commission_log`

- `id` uuid PRIMARY KEY
- `booking_id` uuid REFERENCES bookings
- `cleaner_id` uuid
- `gross_amount` numeric (fullpris före commission)
- `commission_pct` integer (**PROCENT-format**)
- `commission_amt` numeric (beloppet Spick tar)
- `net_amount` numeric (städarens del)
- `level_name` text (`Standard 17%`, `Företag 12%`, etc.) — legacy; 🔍 verifiera om nya loggas som `Standard 12%` post-§1.4

**⚠️ Inkonsistensrisk:** Historiska rader pre-§1.4 kan ha `commission_log.commission_pct` som skiljer sig från `bookings.commission_pct`. Post-§1.4: `_shared/money.ts::calculatePayout()` är referensimplementation, men commission_log-skrivning sker fortfarande i `booking-create` — 🔍 verifiera konsistens.

---

### `company_service_prices`

- `id` uuid PRIMARY KEY
- `company_id` uuid REFERENCES companies
- `service_type` text
- `price` integer
- `price_type` text (`hourly` eller `per_sqm`)

**Används:** När `companies.use_company_pricing=true` (Lager 1) eller som fallback när cleaner saknar individpris (Lager 2b).

---

### `cleaner_service_prices`

- `id` uuid PRIMARY KEY
- `cleaner_id` uuid REFERENCES cleaners
- `service_type` text
- `price` integer
- `price_type` text (`hourly` eller `per_sqm`)

**Används:** Lager 2a (individpris — vinner över företagspris när `use_company_pricing=false`).

---

### `subscriptions`

- `id` uuid PRIMARY KEY
- `customer_name`, `customer_email`, `customer_phone`, `customer_address`
- `service_type`, `frequency` (`weekly`, `biweekly`, `monthly`)
- `preferred_day` integer (1-7, mån-sön)
- `preferred_time` time
- `booking_hours` numeric
- `hourly_rate` integer (⚠️ bakas fast vid setup — ignorerar per-tjänst-priser, se arkitektur-sanning)
- `cleaner_id` uuid, `cleaner_name` text
- `company_id` uuid
- `status` text (`pending_setup`, `aktiv`, `pausad`, `avslutad`)
- `next_booking_date` date
- `payment_mode` text
- `customer_type` text
- `rut` boolean
- `manual_override_price` integer
- `consecutive_failures` integer
- `last_charge_success_at` timestamptz
- `created_at`, `updated_at` timestamptz

---

### `customer_profiles`

- `email` text PRIMARY KEY (UNIQUE)
- `name`, `phone`, `address`, `city` text
- `stripe_customer_id` text
- `default_payment_method_id` text
- `payment_method_last4` text
- `auto_delegation_enabled` boolean NULL

**⚠️ Känt datakvalitetsproblem:** Endast 1 rad trots 4 unika kunder i `bookings`. `booking-create` upsert-logik (rad 356-376) är ny — äldre bokningar skapade inga rader.

---

### Övriga tabeller (abbreviated)

- `reviews` → VY på `ratings` (alla inserts MÅSTE gå mot `ratings`-tabellen).
- `ratings` → primär rating-tabell.
- `admin_users` → separat auth från cleaners (admin-lösenord via Supabase Auth).
- `platform_settings` → nyckel-värde-par (13 nycklar per 2026-04-22, se ovan).
- `discounts`, `discount_usage` → rabattkoder.
- `customer_credits` → kund-kredit (från referrals, refunds).
- `booking_status_log` → audit av statusändringar.
- `processed_webhook_events` → idempotency för Stripe.
- `cleaner_applications` → ansökningar (före `admin-approve-cleaner`).
- `cleaner_availability` → EN rad per städare med `day_mon`...`day_sun` boolean.
- `messages` → chat städare ↔ kund.
- `notifications` → push-notiser.

#### Money-layer-tabeller (nya sedan §1.6, 2026-04-20)

- `payout_attempts` → en rad per Stripe Transfer-anrop (booking_id + attempt_count + status + stripe_idempotency_key + stripe_transfer_id). Primärkälla för retry-logik i `_shared/money.ts::triggerStripeTransfer()`. Migration: [20260420_f1_6_payout_attempts.sql](../supabase/migrations/20260420_f1_6_payout_attempts.sql).
- `payout_audit_log` → audit-trail för alla payout-events (`transfer_created`, `payout_confirmed`, `transfer_failed`, `transfer_reversed`, `reconciliation_mismatch`, `reconciliation_completed`, `auto_rollback_triggered`, `auto_activation_triggered`). Migration: [20260420_f1_6_payout_audit_log.sql](../supabase/migrations/20260420_f1_6_payout_audit_log.sql).

#### Services-tabeller (nya sedan §F1 Dag 1, 2026-04-19)

- `services` → centralt service-register (11 seedade: Hemstädning, Premiumstädning, Storstädning, Flyttstädning, Fönsterputs, Mattrengöring, Kontorsstädning, Trappstädning, Skolstädning, Vårdstädning, Hotell & restaurang). Kolumner: `key`, `label_sv`, `label_en`, `rut_eligible`, `is_b2b`, `is_b2c`, `hour_multiplier`, `default_hourly_price`, `ui_config JSONB`. Feature flag `F1_USE_DB_SERVICES=false` — frontend läser fortfarande hardcoded listor. Migration: [20260419_f1_dag1_services_tables.sql](../supabase/migrations/20260419_f1_dag1_services_tables.sql).
- `service_addons` → FK till services. Seed: ugnsrengöring (295 kr) till Hemstädning.

---

## Vyer (VIEWs)

### `v_cleaners_for_booking` (full definition från migration 20260401000001)

```sql
CREATE OR REPLACE VIEW v_cleaners_for_booking AS
SELECT
  c.id,
  c.full_name,
  COALESCE(c.avg_rating, 5.0)                                              AS avg_rating,
  COALESCE(c.review_count,
    (SELECT count(*)::int FROM reviews r WHERE r.cleaner_id = c.id)
  )                                                                         AS review_count,
  COALESCE(c.services, 'Hemstädning')                                      AS services,
  c.city,
  COALESCE(c.hourly_rate, 399)                                             AS hourly_rate,
  c.bio,
  c.avatar_url,
  COALESCE(c.identity_verified, false)                                     AS identity_verified,
  c.home_lat,
  c.home_lng,
  COALESCE(c.service_radius_km, 10)                                        AS service_radius_km,
  COALESCE(c.pet_pref,      false)                                         AS pet_pref,
  COALESCE(c.elevator_pref, false)                                         AS elevator_pref
FROM  cleaners c
WHERE c.is_approved = true
  AND c.status      = 'aktiv';
GRANT SELECT ON v_cleaners_for_booking TO anon, authenticated;
```

**Säkerhetsnotering:** Filtrerar `is_approved=true AND status='aktiv'`. Ogodkända/inaktiva städare dyker INTE upp i kundsök. ✅

**Obs — vyn har EJ:**
- `company_id`, `is_company_owner`, `company_name`, `company_display_name` — men `boka.html:1863` SELECTar dessa ändå. Indikerar att vyn kan ha utökats i senare migration eller att frontend har felaktig SELECT (kör SQL för att verifiera).
- `completed_jobs`, `has_fskatt`, `owner_only` — samma.

**SQL-verifiering:**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'v_cleaners_for_booking' ORDER BY ordinal_position;
```

---

### `booking_slots`

```sql
-- Från migration 20260401000001
CREATE OR REPLACE VIEW booking_slots AS
SELECT cleaner_id, booking_date AS date, booking_time AS time, booking_hours AS hours
FROM bookings
WHERE payment_status = 'paid'
  AND status != 'avbokad';
GRANT SELECT ON booking_slots TO anon, authenticated;
```

Används av `boka.html` för kalenderkonflikter.

---

### `booking_confirmation`, `public_stats`

Definierade i tidigare migrations. Se `supabase/migrations/` för exakt definition.

---

## RPC-funktioner

### `find_nearby_cleaners(customer_lat, customer_lng)`

**Signatur:**
```sql
find_nearby_cleaners(
  customer_lat double precision,
  customer_lng double precision
) RETURNS TABLE (
  id uuid,
  full_name text,
  first_name text,
  last_name text,
  bio text,
  hourly_rate integer,
  profile_image_url text,
  avatar_url text,
  avg_rating numeric,
  total_reviews integer,
  review_count integer,
  services text[],
  city text,
  identity_verified boolean,
  home_lat double precision,
  home_lng double precision,
  pet_pref text,
  elevator_pref text,
  distance_km double precision
)
```

**Observationer:**
- Använder `home_lat`/`home_lng` (⚠️ INTE `lat`/`lng`).
- Filtrerar `is_approved=true AND (is_active=true OR company_id IS NOT NULL) AND status='aktiv' AND home_lat/lng NOT NULL`.
- Använder PostGIS `ST_DWithin` med `service_radius_km * 1000` meter.
- Sorterar på `distance_km ASC, avg_rating DESC NULLS LAST`.
- **Returnerar INTE** `company_id`, `is_company_owner`, `company_name`, `completed_jobs`, `has_fskatt` — Dessa nämns i session-prompt men verifierad signatur inkluderar dem EJ. Service-filtrering sker på klientsidan, inte i RPC.
- Security: `SECURITY DEFINER` — kör med funktionens ägares rättigheter.

**Källa:** ✓ [`supabase/migrations/20260422_f2_2_find_nearby_cleaners.sql`](../supabase/migrations/20260422_f2_2_find_nearby_cleaners.sql) (prod-verifierad §2.2 2026-04-22). Tidigare källor `sql/radius-model.sql` + `sql/fix-find-nearby-for-teams.sql` + `sql/fix-nearby-part*.sql` raderade i §2.5 — alla drev från prod-sanningen.

---

### `check_rate_limit(p_key, p_max_requests, p_window_seconds)`

Rate-limiting för EF-anrop. Används av `stripe-checkout`, `booking-create`.

---

### `log_booking_event(p_booking_id, p_event_type, p_actor_type, p_metadata)`

Audit-logg för booking-flöden.

---

## Kända datakvalitetsissues (uppdaterad 2026-04-22)

1. **`customer_profiles` skev:** 1 rad trots 4 unika kunder i `bookings`. `booking-create` upsert-fix deployad men påverkar bara nya bokningar.
2. **Avbokad + betald booking:** 1 bokning (april 2026) med `status='avbokad'` men `payment_status='paid'`. Data-cleanup behövs (manuell SQL).
3. **Commission-format inkonsistens (cleaners/companies):** `cleaners.commission_rate` och `companies.commission_rate` har blandade historiska värden (`17`, `12`, `0.17`, `0`). Schema-default `0.17` (decimal) + rader lagrade som `17` (procent) + tomma rader = tre format i samma kolumn. **IGNORERAS av `_shared/money.ts` sedan §1.1.** Kolumnerna planeras droppas i **§1.10 framtida migration** (se [docs/architecture/money-layer.md §2.1 rad 14](architecture/money-layer.md)).
4. **Pricing-path-divergens (2026-04-17):** `booking-create` ignorerade `use_company_pricing`-flaggan. 🔍 **Status post-Fas 1:** booking-create har genomgått §1.2 SUPERSEDED + §1.4-refactor; verifiera om pricing-path-buggen lever kvar. Rafas flagga kvarstår som "får INTE sättas till true" enligt memory-fil `project_booking_create_use_company_pricing.md`.
5. **Koordinater saknas:** Daniella + Lizbeth (Rafas team) har NULL `home_lat`/`home_lng`. Väntar på Rafael.
6. **8 par överlappande testbokningar (P1-bug för framtiden):** Blockerar UPDATE-operationer mot `bookings`-tabellen via trigger `trg_booking_to_calendar` → `no_booking_overlap`-constraint på `calendar_events`. Inte aktivt blockerande för Rafa-pilot men förhindrar t.ex. bulk-UPDATE av `commission_pct` från 17 till 12 på historiska bokningar. Se `3-TODOLIST-v2.md` P1-1.

---

## SQL-verifieringar att köra vid Dag 2-förberedelse

```sql
-- 1. platform_settings live-värden (kärnverifiering för Dag 2)
SELECT key, value, updated_at FROM platform_settings
WHERE key IN ('commission_standard', 'commission_top', 'base_price_per_hour', 'subscription_price');
-- Förväntat: commission_standard=12, commission_top=12

-- 2. Commission-format mix i cleaners (data-kvalitet)
SELECT commission_rate, COUNT(*) FROM cleaners
GROUP BY commission_rate ORDER BY commission_rate;
-- Förväntat: mix av 17, 12, 0.17, 0 — bekräftar att fältet ska ignoreras

-- 3. All commission_pct i historiska bookings
SELECT DISTINCT commission_pct FROM bookings;  -- förväntat: [17] (testdata)

-- 4. Mismatch mellan bookings och commission_log?
SELECT b.id, b.commission_pct AS b_pct, cl.commission_pct AS log_pct
FROM bookings b LEFT JOIN commission_log cl ON cl.booking_id=b.id
WHERE b.commission_pct <> cl.commission_pct;  -- förväntat: tomt resultat

-- 5. Companies-schema (verifiera advancerade compliance-fält)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'companies' ORDER BY ordinal_position;

-- 6. v_cleaners_for_booking aktuell kolumnlista
SELECT column_name FROM information_schema.columns
WHERE table_name = 'v_cleaners_for_booking' ORDER BY ordinal_position;

-- 7. Avbokade + betalda bokningar
SELECT id, booking_date, status, payment_status, total_price
FROM bookings WHERE status='avbokad' AND payment_status='paid';

-- 8. Överlappande bokningar (P1-bug som blockerar UPDATE)
SELECT COUNT(*) FROM (
  SELECT a.id FROM bookings a JOIN bookings b
    ON a.cleaner_id = b.cleaner_id
    AND a.id < b.id
    AND a.booking_date = b.booking_date
    AND a.booking_time < (b.booking_time + (b.booking_hours || ' hours')::interval)
    AND (a.booking_time + (a.booking_hours || ' hours')::interval) > b.booking_time
) overlaps;
-- Förväntat: 8 par per 2026-04-17

-- 9. Triggers på bookings
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers WHERE event_object_table = 'bookings';
-- Förväntat: 6 triggers (se triggerlistan ovan)
```
