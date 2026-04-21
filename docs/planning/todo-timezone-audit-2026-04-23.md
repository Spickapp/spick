# TODO: Timezone-audit mejl/SMS-utskick

**Upptäckt:** 2026-04-23 sent kväll
**Trigger:** Farhad frågade om tidszon-synk i utskick
**Status:** Utredning klar, fix pending egen sprint

## Bekräftade buggar

### BUG 1 (KRITISK) — auto-remind skickar påminnelser 1-2h för tidigt

**Fil:** `supabase/functions/auto-remind/index.ts:90`

```typescript
const dateTime = new Date(`${dateStr}T${(b.booking_time || "09:00")}:00`);
const hoursLeft = (dateTime.getTime() - now.getTime()) / 3_600_000;
```

**Problem:** `new Date("2026-04-22T08:00:00")` tolkas av Deno som **UTC**, inte svensk tid. Supabase Edge Functions körs på UTC-servrar.

**Effekt:** booking_time 08:00 (menat svensk tid) tolkas som UTC 08:00 = svensk tid 10:00. `hoursLeft` räknas 1-2h för stor → påminnelse triggas 1-2h för tidigt.

Exempel: Kund har städning tisdag 10:00 svensk tid. Påminnelse meant att skickas måndag 10:00 skickas istället måndag 08:00 eller 09:00.

**Fix-riktning:** Använd explicit timezone-parsing. Ett alternativ:

```typescript
// Parse som svensk lokal tid via Intl.DateTimeFormat eller Temporal
// Tills vidare: konvertera manuellt med offset-justering
```

**Prio:** Fix asap, påverkar kundupplevelse varje dag.

**Status (2026-04-24):** ✓ FIXAD via `_shared/timezone.ts::parseStockholmTime`. Auto-remind:93 + auto-remind:299 (samma bugg-mönster, upptäckt via grep under fix-arbetet). Deploy automatisk via deploy-edge-functions.yml.

### BUG 2 (MEDEL) — auto-rebook midnatts-datum-drift

**Fil:** `supabase/functions/auto-rebook/index.ts:116`

```typescript
const todayStr = new Date().toISOString().slice(0, 10);
```

**Problem:** UTC-datum används som "idag". För körningar 22:00-24:00 UTC (= 00:00-02:00 svensk tid) ger det **gårdagens** datum i svensk kontext.

**Effekt:** Rebook som ska ske "idag+7" (svensk tid) kan hamna en dag off vid midnatts-körningar.

**Fix-riktning:** Använd `Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' })` för todayStr.

**Prio:** Medel. Triggar bara under vissa körnings-tider.

**Status (2026-04-24):** ✓ FIXAD via `getStockholmDateString(date?)` i `_shared/timezone.ts`. 4 call-sites bytta (2 i huvudfunktion, 2 i processSubscription). `nextDate()`-aritmetik på rad 110 bevarad som UTC medvetet (deterministisk månad/dag-aritmetik, lokaltids-konvertering sker downstream).

### BUG 3 (MEDEL) — formatDate-duplicering utan tidszon × 4 EFs

**Filer:**
- `supabase/functions/auto-delegate/index.ts:219-222`
- `supabase/functions/cleaner-booking-response/index.ts:362-367`
- `supabase/functions/company-propose-substitute/index.ts:463-466`
- `supabase/functions/customer-approve-proposal/index.ts:218-221`

**Kod:**

```typescript
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" });
}
```

**Problem:**
- `new Date("2026-04-22")` utan time → tolkas som UTC midnatt → 00:00 UTC = 01:00 eller 02:00 svensk tid
- Oftast rätt datum men instabilt på datumgränser
- Regel #28-brott: 4 kopior av samma funktion

**Fix-riktning:**
1. Skapa `supabase/functions/_shared/date-format.ts` med timezone-säker formatDate + formatTime
2. Uppdatera fyra EFs att importera istället för lokal definition
3. Implementation:

```typescript
export function formatDate(dateStr: string): string {
  // Parse som svensk lokal tid, oberoende av server-tidszon
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Europe/Stockholm'
  }).format(new Date(dateStr + 'T12:00:00Z')); // noon UTC = säker för alla DST-gränser
}
```

**Prio:** Medel. Oftast rätt men instabilt.

**Status (2026-04-24):** ✓ FIXAD. Lokala duplikater raderade i alla 4 EFs. Samtliga importerar `formatStockholmDate` (3 st) eller `formatStockholmDateLong` (cleaner-booking-response) från `_shared/timezone.ts`. Null-safe med "–"-fallback. DST-säker via Intl.DateTimeFormat + noon-UTC-input.

## Icke-buggar (klargjort)

### calendar-EFs — korrekt av design

**Filer:** `calendar-ical-feed/index.ts`, `calendar-sync/index.ts`

De 4 hardcoded `'Europe/Stockholm'`-strängarna är **spec-krav** för iCal-format (TZID) och Google Calendar API. Lämna som de är eller centralisera till `_shared/constants.ts` om prefererat, men **inte en bugg**.

Kommentaren i `20260423_f2_7_1_b2b_schema.sql:74-75` om "4 hardcodes som hygien-task" överdrev — ingen bugg, bara arkitektonisk konvention.

### generate-receipt — raw-dump men OK

`bookingDate: String(booking.booking_date || "")` skickar rå ISO-datum till kvitto-template. Datum-only format är stabilt (inget tidszon-beroende för ren datum-sträng). OK som det är.

## Sprint-plan (föreslagen)

**Fas 1 — Fix KRITISK (1h):** ✓ KLAR 2026-04-24
- `_shared/timezone.ts` skapad med `parseStockholmTime` + `formatStockholmDate`
- auto-remind:93 + auto-remind:299 (båda buggiga, samma pattern) använder helpern

**Fas 2 — Shared helper + refactor (2h):** ✓ KLAR 2026-04-24
- 4 EFs använder `formatStockholmDate` / `formatStockholmDateLong` från `_shared/timezone.ts`
- Lokala duplikater raderade (~20 rader kod bort)
- Regel #28-kompatibel

**Fas 3 — auto-rebook edge-case (30-45 min):** ✓ KLAR 2026-04-24
- `getStockholmDateString()` i `_shared/timezone.ts`
- 4 call-sites bytta (2 i huvudfunktion, 2 i processSubscription)

**Fas 4 — Dokumentation (30 min):** ej påbörjad
- Uppdatera money-layer.md eller arkitekturplan med tidszon-konvention

**Totalt kvar: 3-4h**

Lämplig att köra parallellt med infrastructure-audit (hygien #48) — båda rör tidszon/data-integritet.

## Verifierings-strategi för fix

Problem: tidszon-buggar upptäcks inte i test om test körs i samma tidszon som buggarna. Behöver:

1. Enhetstest som mockar Date med specifik tid
2. Integrationstest som körs med explicit TZ env-var
3. Manuell prod-verifiering: schemalägg testbokning till specifik tid, verifiera att påminnelse går rätt tid

## Referenser

- Platform_settings nyckel: `company_timezone='Europe/Stockholm'` (seedad `20260423_f2_7_1_b2b_schema.sql:79`)
- Regel #28: ingen business-data-fragmentering — formatDate-duplikering bryter
- Session där upptäckten gjordes: 2026-04-23 kvällssession (efter §3.7 partial)
