# Recurring + Retention System — Design (Fas 5)

**Status:** SKELETT · 2026-04-23 · Fylls in sessioner per §5.2-§5.12
**Primärkälla:** [docs/planning/spick-arkitekturplan-v3.md §5](../planning/spick-arkitekturplan-v3.md) (rad 269-309)
**Estimat:** 10-15h total (per plan)
**Beroenden:** Fas 1 Money Layer (✅ klar) · Fas 3 Matching (◕ konvergerar — acceptabelt för start)

---

## 0. Varför Retention prioriteras (v3.1 flyttade upp)

Från plan §5 motivation:
> 60% av städning är recurring. Utan retention-system förloras långsiktigt LTV.

Konkreta fakta:
- Rafaels och Zivars befintliga kunder är redan till stor del återkommande men hanteras icke-strukturerat
- Varje recurring-kund = 2-3× LTV jämfört med engångskunder (industry benchmark)
- Auto-regenerering av bokningar minskar friktion → högre retention
- Prisbindning skyddar kund mot skalade höjningar mid-serie

**Interaktion med Fas 8 (Dispute + Escrow):** Varje recurring-bokning isolerad escrow_state. Dispute på en bokning påverkar INTE övriga. Dokumenterat i [dispute-escrow-system.md §7](dispute-escrow-system.md).

---

## 1. Primärkälle-verifiering av befintlig state (§5.1)

### 1.1 `subscriptions`-tabell (verifierat 2026-04-23 via `003_subs.sql`)

Existerande kolumner:
```sql
id                     uuid PK
customer_name          text NOT NULL
customer_email         text NOT NULL
customer_phone         text
address                text NOT NULL
city                   text NOT NULL
service                text DEFAULT 'Hemstädning'
frequency              text DEFAULT 'varannan-vecka'  -- enkel sträng
preferred_day          text                            -- enkel sträng
preferred_time         text                            -- enkel sträng
hours                  integer DEFAULT 3
price                  decimal(10,2)
rut                    boolean DEFAULT true
favorite_cleaner_email text                            -- email, inte cleaner_id
status                 text DEFAULT 'aktiv'            -- aktiv | pausad | avslutad
next_booking_date      date
discount_percent       integer DEFAULT 5
referral_code          text UNIQUE
referred_by            text
created_at             timestamptz
```

### 1.2 Existerande relaterad infrastruktur

- `bookings.subscription_id uuid` — FK till subscriptions, redan i prod
- `charge-subscription-booking` EF — debiterar sparade kort dagen innan städning (finns)
- `auto-rebook` EF — skapar bokningar för aktiva prenumerationer (finns)
- `setup-subscription` EF — subscription setup via Stripe (finns)

### 1.3 Gap-analys vs plan §5.2

| Krav i plan | Nuvarande state | Gap |
|---|---|---|
| Dagar (mån-sön multi-select) | `preferred_day text` (1 sträng) | Utöka till `preferred_days text[]` |
| Frekvens (vecka, varannan, var 3:e, var 4:e, månadsvis på dag N, månadsvis på vecka-X-dag) | `frequency text` | Utöka till ny enum + `frequency_config jsonb` |
| Längd (slutdatum / X gånger / tillsvidare) | Saknas | Nya kolumner: `end_date date`, `max_occurrences int`, `duration_mode text` |
| Samma-städare-preferens (cleaner_id + "vem som helst från företag X") | `favorite_cleaner_email text` | Ersätt: `preferred_cleaner_id uuid`, `preferred_company_id uuid`, `cleaner_flex text` |
| Betalningsmodell (per tillfälle / månadsvis i förskott / helt förskott) | Saknas | Nya kolumner: `payment_mode text`, `prepaid_until date` |

### 1.4 Hygien-flag (upptäckt 2026-04-27 via primärkälla-check)

`003_subs.sql:16` har `favorite_cleaner_email` (string, inte uuid). Nya bokningar i booking-create (rad 302-316) sparar `preferred_cleaner_id uuid` till subscriptions. Data kan vara i inkonsekvent tillstånd — research krävs före §5.2.

---

## 2. Utökad Recurring Matrix (§5.2)

### 2.1 Frekvens-modell

**Enum `subscription_frequency`:**
- `weekly` — varje vecka på preferred_days
- `biweekly` — varannan vecka (nuvarande default)
- `triweekly` — var 3:e vecka
- `monthly_by_date` — t.ex. den 15:e varje månad
- `monthly_by_weekday` — t.ex. tredje torsdag varje månad
- `custom` — beroende på `frequency_config jsonb`

**`frequency_config jsonb` exempel:**
```json
// weekly/biweekly/triweekly
{ "preferred_days": ["mon", "wed", "fri"] }

// monthly_by_date
{ "day_of_month": 15 }

// monthly_by_weekday
{ "week_of_month": 3, "weekday": "thursday" }

// custom
{ "cron": "0 8 * * 1" }  // reserved för framtida advanced cases
```

### 2.2 Längd-modell

Tre lägen, en aktiv åt gången:

| `duration_mode` | Betydelse | Obligatoriska fält |
|---|---|---|
| `open_ended` | Tills vidare (default) | (ingen extra) |
| `fixed_count` | Exakt X tillfällen | `max_occurrences int` |
| `end_date` | Fram till datum Y | `end_date date` |

### 2.3 Cleaner-preferens

| `cleaner_flex` | Betydelse | Använder |
|---|---|---|
| `specific_cleaner` | Exakt denna städare, annars pausa | `preferred_cleaner_id uuid` |
| `specific_company` | Vem som helst från detta företag | `preferred_company_id uuid` |
| `any` | Matchning rätter | inget lås |

### 2.4 Betalningsmodell

| `payment_mode` | Betydelse | Stripe-flöde |
|---|---|---|
| `per_occurrence` (default) | Debitera dag-innan | `charge-subscription-booking` EF idag |
| `monthly_prepaid` | Debitera månadsvis i förskott | Ny EF `charge-subscription-monthly` |
| `full_prepaid` | Hela serien i förskott (fixed_count) | Engångsbetalning vid start |

**Fas 8 escrow-interaktion:** `full_prepaid` kräver särskild escrow-logik — hela beloppet hålls tills varje tillfälle attesteras. Detta är KOMPLEXT och kan skjutas till senare iteration.

---

## 3. `customer_preferences`-tabell (§5.5)

Ny tabell, separerad från subscriptions så preferenser överlever annullering.

```sql
CREATE TABLE customer_preferences (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email        text NOT NULL UNIQUE,
  favorite_cleaner_id   uuid,                -- senaste positiva erfarenheten
  blocked_cleaner_ids   uuid[],              -- "aldrig igen" (efter dispute)
  default_has_pets      boolean,
  pet_type              text,                -- 'hund' | 'katt' | 'övrigt'
  has_children_at_home  boolean,
  has_stairs            boolean,
  prefers_eco_products  boolean DEFAULT false,
  default_notes_to_cleaner text,             -- t.ex. "nyckel under mattan"
  budget_range_min_sek  integer,
  budget_range_max_sek  integer,
  language_preference   text,                -- för framtida matching-filter (Fas 7 §7.7)
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX idx_customer_prefs_email ON customer_preferences(customer_email);
```

**Auto-population:** Efter 3 slutförda bokningar med samma städare + rating ≥4 → auto-set `favorite_cleaner_id` (§5.8).

---

## 4. Booking-generation Cron (§5.3)

`generate-recurring-bookings` — ny cron-EF eller utvidgning av `auto-rebook`.

### 4.1 Grundflöde

```
Scheduled trigger: dagligen 08:00 Europe/Stockholm

FÖR VARJE subscription WHERE status='aktiv':
  1. Beräkna next 4-veckors-horisont: LAG = today, HORIZON = today+28
  2. Generera tidpunkter enligt frequency_config inom LAG..HORIZON
  3. FÖR VARJE planerad tidpunkt:
       a. Kontrollera om bokning redan finns (idempotent)
       b. Om ej: INSERT bookings med subscription_id
       c. Pris = låst pris från subscription (se §5.10)
       d. Matchning: resolve cleaner per cleaner_flex
       e. logBookingEvent 'recurring_generated' (Fas 6 event-type finns)
```

### 4.2 Edge cases

- **Helgdag-kollision:** Se §7
- **Slutdatum/max_occurrences nått:** Stoppa + sätt `status='avslutad'`
- **Preferred_cleaner pausar tjänst:** `cleaner_flex='specific_cleaner'` → pausa serien OCH skicka nudge till kund
- **Prisändring på tjänst:** `subscription.price` låst (se §5.10) — ignoreras

---

## 5. Kund-UI (§5.4 + §5.6 + §5.7)

### 5.1 `min-bokning.html` subscriptions-sektion (ny)

Per subscription:
```
Hemstädning · Varannan vecka · Onsdag 10:00 · 790 kr/tillfälle
Nästa: 2026-04-30 (onsdag)
Städare: Nasiba (från Solid Service)

[Pausa serie] [Hoppa över 2026-04-30] [Ändra tid för enskilt tillfälle]
[Ändra städare] [Säg upp serien]
```

### 5.2 "Boka samma som sist"-knapp

På `min-bokning.html` (huvudvy): efter en ogenomförd booking-serie-start, visa:
```
[Boka samma städning igen →] ← pre-fyller boka.html med senaste bokningens params
```

Implementation: `boka.html?rebook=<booking_id>` läser existing booking och förfyller state.

### 5.3 "Boka samma städare igen"

På bekräftelsesida (efter slutförd bokning):
```
Uppskattade du Nasibas städning?
[Boka Nasiba igen →] ← länkar till boka.html?cleaner_id=<nasiba_id>
```

C-2 deep-link-infrastrukturen (shippad 2026-04-23) gör detta trivialt.

---

## 6. Pris-binding (§5.10)

**Princip:** När subscription skapas, lås priset på subscription-raden. Auto-rebook använder detta pris oavsett om `cleaner.hourly_rate` eller `service.default_hourly_price` ändras senare.

**Prod-schema (verifierat 2026-04-23 via information_schema):** subscriptions har INTE en `price decimal(10,2)`-kolumn. Prod använder:
- `subscriptions.hourly_rate integer` — kr per timme, låst vid subscription-skapande
- `subscriptions.manual_override_price integer` — admin-override på totalpris (om satt och ≥ 100)

**AUDIT-STATUS 2026-04-23: fungerar korrekt, ingen fix behövs.**

Verifierat-flöde i prod (auto-rebook:234, 236-237, 199 + charge-subscription-booking:171):

1. `auto-rebook` läser `sub.hourly_rate` (läser ALDRIG cleaner.hourly_rate)
2. Om `sub.manual_override_price >= 100` används det som totalPrice (admin-override)
3. Annars: `totalPrice = rate × hours`
4. `manual_override_price` kopieras även till booking-raden
5. `charge-subscription-booking` debiterar `booking.total_price` (booking-låst)

Pris är alltså låst trippel:
- Subscription.hourly_rate (låst vid serie-start)
- Booking.total_price (låst vid booking-skapande via auto-rebook)
- Stripe PaymentIntent amount (låst vid charge)

**Ingen silent drift möjlig** om cleaner senare höjer sin rate i profil eller admin ändrar service default.

**Undantag:** `payment_mode='monthly_prepaid'` eller `'full_prepaid'` (framtida Fas 5 sub-iteration) — pris bundet vid debitering, inte per tillfälle.

**Admin-override:** manual_override_price fältet finns redan. Admin-UI behöver inget bygge — kan UPDATE:as direkt via Studio SQL om kund accepterar. Framtida: admin.html-knapp för enklare hantering.

---

## 7. Helgdag-hantering (§5.11)

Flagga i subscription: `holiday_mode text`

| Värde | Beteende |
|---|---|
| `auto_skip` (default) | Tillfälle som faller på röd dag hoppas över, ingen ny genereras |
| `auto_shift` | Flyttas till närmaste vardag (före eller efter — kund väljer vid setup) |
| `manual` | Kund får email 7d innan → välj själv |

**Datakälla svenska helgdagar:** Nytt table `swedish_holidays` med årlig backfill, eller npm-paket (t.ex. `swedish-holidays` via EF). Research krävs (§5.11 sub-task).

---

## 8. RUT-kvotsplitting över årsskifte (§5.12)

**Problem:** RUT-taket 75 000 kr/person/år. Subscription som sträcker sig över 31 december måste dela tillfällen mellan två år.

**Lösning:**
- Varje bokning taggas med `rut_claim_year = EXTRACT(YEAR FROM booking_date)`
- Generate-cron kontrollerar subscription-summa mot platform_settings.rut_max_per_year
- Kund får email vid 80% nådd: "Din RUT-kvot är nära maxet — nästa tillfälle räknas mot 2027"

**Fas 7.5 beroende:** RUT-infrastruktur är LÅST tills Fas 7.5 klart. Denna §5.12 kan inte fullt aktiveras förrän RUT-klienten är tillbaka. Designa klient-UI utan att trigga SKV-API-calls.

---

## 9. Email-nudges (§5.9)

`generate-recurring-bookings`-flow och/eller separata crons skickar:

| Timing | Mall | Syfte |
|---|---|---|
| 7d efter första lyckade bokningen | "Ska vi ordna detta varje vecka?" | Upsell till recurring |
| 3d innan nästa recurring-tillfälle | Bekräftelse-påminnelse | Reduce no-shows |
| 1d innan prepaid-månadens slut | "Förnya prenumeration?" | Avvärja churn |
| Efter 3:e lyckade bokningen med samma cleaner | "Lägg till Nasiba som favorit-städare" | §5.8 preference-learning |

Alla mallar renderas via befintlig `notify` EF + `wrap` helper.

---

## 10. Event-logging (§5-integration med Fas 6)

Fas 6 BookingEventType-union inkluderar redan recurring-events:
- `recurring_generated` — cron genererade bokning
- `recurring_skipped` — helgdag/kund-val
- `recurring_paused` — pausad
- `recurring_resumed` — återupptagen
- `recurring_cancelled` — avslutad helt

Retrofit-arbete: `generate-recurring-bookings`-EF anropar `logBookingEvent` per bokning. `charge-subscription-booking`-EF bör också logga `payment_received`.

---

## 11. Migration Strategy

### 11.1 Schema-utvidgningar (single migration)

```sql
-- Nya kolumner på subscriptions
ALTER TABLE subscriptions 
  ADD COLUMN preferred_days text[],
  ADD COLUMN frequency_config jsonb DEFAULT '{}',
  ADD COLUMN duration_mode text DEFAULT 'open_ended',
  ADD COLUMN max_occurrences integer,
  ADD COLUMN end_date date,
  ADD COLUMN preferred_cleaner_id uuid REFERENCES cleaners(id),
  ADD COLUMN preferred_company_id uuid REFERENCES companies(id),
  ADD COLUMN cleaner_flex text DEFAULT 'any',
  ADD COLUMN payment_mode text DEFAULT 'per_occurrence',
  ADD COLUMN prepaid_until date,
  ADD COLUMN holiday_mode text DEFAULT 'auto_skip',
  ADD COLUMN updated_at timestamptz DEFAULT now();

-- CHECK constraints
ALTER TABLE subscriptions 
  ADD CONSTRAINT subs_duration_mode_check 
    CHECK (duration_mode IN ('open_ended', 'fixed_count', 'end_date')),
  ADD CONSTRAINT subs_cleaner_flex_check 
    CHECK (cleaner_flex IN ('specific_cleaner', 'specific_company', 'any')),
  ADD CONSTRAINT subs_payment_mode_check 
    CHECK (payment_mode IN ('per_occurrence', 'monthly_prepaid', 'full_prepaid'));

-- Ny tabell
CREATE TABLE customer_preferences (...);  -- per §3

-- Backfill: befintliga rows
UPDATE subscriptions SET 
  preferred_days = ARRAY[LOWER(SUBSTRING(preferred_day, 1, 3))]  -- t.ex. 'Onsdag' → ['ons']
WHERE preferred_day IS NOT NULL AND preferred_days IS NULL;

-- Migrera favorite_cleaner_email → preferred_cleaner_id (om cleaner finns)
UPDATE subscriptions s SET 
  preferred_cleaner_id = c.id,
  cleaner_flex = 'specific_cleaner'
FROM cleaners c
WHERE s.favorite_cleaner_email = c.email AND s.preferred_cleaner_id IS NULL;
```

### 11.2 Backward-kompatibilitet

Existerande `favorite_cleaner_email` behålls MEN är deprecated. `charge-subscription-booking` + `auto-rebook` läser ny `preferred_cleaner_id` först, fallback till email-lookup.

### 11.3 Rollback

Alla nya kolumner `DROP COLUMN IF EXISTS`. customer_preferences `DROP TABLE IF EXISTS`. Backfill går inte att reverteras men det är OK (ny data, inget äldre gick förlorat).

---

## 12. Öppna beslut (FASTSTÄLLDA 2026-04-23 av Farhad)

| # | Beslut | Fastställt värde | Status |
|---|---|---|---|
| 1 | `payment_mode` initial support | `per_occurrence` + `monthly_prepaid` | ✅ klar. `full_prepaid` **SKJUTS** — **kräver jurist** (Lag 2018:672 presentkort + moms-förskott) |
| 2 | Svensk helgdag-källa | Hardcoded JSON + årlig CI-påminnelse | ✅ klar |
| 3 | Pris-binding max duration | 12 månader + 30 dagars notice innan re-eval | ✅ klar (Konsumenttjänstlagen 36§) |
| 4 | Min-tid mellan recurring-tillfällen | 3 dagar konsument, admin-override för B2B | ✅ klar |
| 5 | Auto-set favorit efter 3 bokningar | **Opt-in popup** (GDPR Art. 6 — uttryckligt samtycke) | ✅ klar |

**Besluts-motivering:** Se [session-handoff 2026-04-27 §10.4](../sessions/SESSION-HANDOFF_2026-04-27-c2-m4b.md) för jurist-risk-analys.

**Full_prepaid blockeras pga:**
- Kan tolkas som presentkort under Lag (2018:672) → konsumentskydd-regler
- Moms-komplikation: när bokförs intäkt? Vid betalning eller leverans?
- Vid uppsägning mid-period: återbetalningsplikt → cash-flow-risk

Låses upp efter jurist-möte (oktober 2026 samordnat med EU PWD-research).

---

## 13. Session-plan (10-15h fördelning)

| Sub-fas | Timmar | Dependencies |
|---|---|---|
| §5.1 primärkälla-verifiering | ✅ klar (denna doc) | - |
| §5.2 schema-utvidgning + migration | 2-3h | §5.1 |
| §5.3 generate-recurring-bookings cron | 3-4h | §5.2 |
| §5.4 kund-UI (pausa/skippa/avsluta) | 2-3h | §5.3 |
| §5.5 customer_preferences tabell + helpers | 1-2h | §5.2 |
| §5.6 "Boka samma som sist" | 30-60 min | - |
| §5.7 "Boka samma städare igen" | 30 min | C-2 infra ✅ |
| §5.8 preference-learning | 1-2h | §5.5 |
| §5.9 email-nudges | 1-2h | §5.3 |
| §5.10 pris-binding verifiering | 30 min | - |
| §5.11 helgdag-hantering | 1-2h | §5.3 + beslut #2 |
| §5.12 RUT-årsskifte | 1h (klient-del) | Fas 7.5 (LÅST) |

**Total:** 13-20h. Matchar plan §5 estimat 10-15h + buffer för edge cases.

---

## 14. Regelefterlevnad vid framtida Fas 5-arbete

- **#26** Grep INNAN migration — verifiera att `subscriptions`-kolumner inte redan finns (flera migrations har rört tabellen)
- **#27** Varje sub-fas är egen commit. INGEN refactor över sub-task-gräns.
- **#28** Subscription-konfig i `subscriptions` + preferences i `customer_preferences`. INGEN duplicering.
- **#29** Plan §5 + detta dokument + `003_subs.sql` + `charge-subscription-booking` EF ska läsas i sin helhet innan varje sub-fas.
- **#30** RUT-tak (75 000 kr) och helgdagar är regulator-fakta — primärkälla-verifieras, aldrig gissas
- **#31** Existerande subscriptions-kolumnnamn MÅSTE verifieras mot migration innan ALTER TABLE skrivs (lärdom från 2026-04-27 bookings.company_id-bug)

---

## 15. Referenser

- [arkitekturplan-v3.md §5](../planning/spick-arkitekturplan-v3.md)
- [003_subs.sql](../../supabase/migrations/003_subs.sql) — baseline subscriptions-schema
- [money-layer.md](money-layer.md) — pris-binding + charge-hantering
- [event-schema.md §3.6](event-schema.md) — recurring_* event-types
- [dispute-escrow-system.md §7](dispute-escrow-system.md) — per-tillfälle escrow-isolation
- [sanning/rut.md](../sanning/rut.md) — Fas 7.5 RUT-status (blocker för §5.12 server-del)

---

**Nästa steg:** Farhad besvarar §12 (5 öppna beslut) + fastställer start-datum. §5.2 schema-utvidgning är första sub-fas (2-3h isolerad commit).
