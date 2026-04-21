# Timezone Convention

**Status:** Gällande konvention sedan 2026-04-24 (§49 Fas 4)
**Primärkälla:** `supabase/functions/_shared/timezone.ts`
**Relaterad audit:** `docs/planning/todo-timezone-audit-2026-04-23.md`

## Problem

Supabase Edge Functions (Deno) kör på UTC-servrar. Databasen lagrar:

- `booking_time` som `time without time zone` (naiv lokaltid)
- `booking_date` som `date` (datum utan tidszon)

Konventionen är att dessa representerar **svensk lokaltid (Europe/Stockholm)**, inklusive DST-hantering. Men JavaScript/Deno:s default `new Date()` tolkar naiva strängar som UTC.

Resultatet blir 1-2 timmars offset (1h vintertid, 2h sommartid) i alla tid-jämförelser där DB-värden parsas naivt.

## Konvention

**Använd aldrig rå `new Date(booking_date + 'T' + booking_time)`-mönster i Edge Functions.**

Använd istället helpers från `_shared/timezone.ts`:

### `parseStockholmTime(dateStr, timeStr): Date`

Tolkar ett lokalt datum + tid och returnerar UTC-Date. DST-säker.

```typescript
import { parseStockholmTime } from "../_shared/timezone.ts";

// Bokning 2026-04-22 08:00 svensk tid
const bookingMoment = parseStockholmTime("2026-04-22", "08:00");
const hoursLeft = (bookingMoment.getTime() - Date.now()) / 3_600_000;
```

**Använd för:** tidsjämförelser mot `now`, schemaläggning-beräkningar, SLA-timers.

### `formatStockholmDate(dateStr): string`

Formaterar `YYYY-MM-DD` som `"22 april 2026"`. Null-safe.

```typescript
import { formatStockholmDate } from "../_shared/timezone.ts";

const text = `Din städning ${formatStockholmDate(booking.booking_date)}`;
```

**Använd för:** kund- och cleaner-notifikationer (short format).

### `formatStockholmDateLong(dateStr): string`

Formaterar `YYYY-MM-DD` som `"tisdagen den 22 april 2026"`. Null-safe.

```typescript
import { formatStockholmDateLong } from "../_shared/timezone.ts";

const text = `Uppdraget gäller ${formatStockholmDateLong(booking.booking_date)}`;
```

**Använd för:** formella notifikationer där veckodag är relevant kontext (ex. cleaner-booking-response).

### `getStockholmDateString(date?: Date): string`

Returnerar svensk lokal kalenderdag som `YYYY-MM-DD`. Optional parameter för framtida datum (horizon-beräkning).

```typescript
import { getStockholmDateString } from "../_shared/timezone.ts";

const todayStr = getStockholmDateString();
const horizon = new Date();
horizon.setDate(horizon.getDate() + 7);
const horizonStr = getStockholmDateString(horizon);
```

**Använd för:** "dagens datum", "horizon-datum", jämförelser mot `booking_date`-kolumnen.

## Anti-patterns

### ❌ `new Date(booking_date + 'T' + booking_time)`

UTC-tolkning. 1-2h off.

### ❌ `new Date().toISOString().slice(0, 10)` för "idag"

UTC-datum. Fel kalenderdag vid körningar 22:00-24:00 UTC.

### ❌ `new Date(booking_date)` för datum-only parsing

Tolkas som UTC midnatt. Kan ge fel datum vid midnatts-gräns.

### ❌ Lokal kopia av `formatDate()`-funktion

Regel #28-brott. Importera från `_shared/timezone.ts`.

## Oförändrat medvetet UTC

Vissa användningar av UTC är korrekta och ska INTE ändras:

- **`new Date().toISOString()` för `updated_at`/`created_at`-timestamps** — PostgreSQL `timestamp with time zone` lagrar UTC internt, ingen konvertering behövs.
- **`Date.UTC(year, month, day)` i deterministisk aritmetik** — t.ex. `nextDate()` i auto-rebook. Används för att räkna "nästa månad" utan DST-drift.
- **Cron-scheman i GitHub Actions** — ange UTC i cron-uttryck (GitHub Actions kör på UTC).
- **Calendar-EFs (`calendar-ical-feed`, `calendar-sync`)** — iCal-spec och Google Calendar API kräver explicit `TZID=Europe/Stockholm` i kalenderformat. Detta är spec-krav, inte bugg.

## Om konventionen ändras

`'Europe/Stockholm'` är hårdkodat i `_shared/timezone.ts` för performance (ingen DB-lookup per anrop). Konventionen speglar `platform_settings.company_timezone` seedat i `20260423_f2_7_1_b2b_schema.sql`.

Om plattformen någonsin ska stödja flera tidszoner (per företag eller per bokning):

1. Uppgradera helpers att ta `tz`-parameter
2. Fasa ut hardcoded `SWEDEN_TZ` mot kontext-baserad lookup
3. Uppdatera denna konvention med nytt mönster

## Historik

- **2026-04-23:** Timezone-audit upptäcker 2 prod-buggar + 4 duplicerad formatDate (hygien #49).
- **2026-04-24 (§49 Fas 1):** `parseStockholmTime` skapad, auto-remind fixad (rad 90 + 299). Commit `13640c3`.
- **2026-04-24 (§49 Fas 2):** `formatStockholmDate` + `formatStockholmDateLong` utökade med null-safety. 4 EFs konsoliderade. Commit `d252586`.
- **2026-04-24 (§49 Fas 3):** `getStockholmDateString` skapad. auto-rebook fixad (4 call-sites). Commit `0da7ca9`.
- **2026-04-24 (§49 Fas 4):** Denna fil skapad. §49 stängd.
