# 3 — Spick Todolist (v2)

> **Senast uppdaterad:** 2026-04-17 efter Dag 1-audit.  
> **Konvention:** P0 = blocker, P1 = viktigt, P2 = bra-att-ha, P3 = backlog.

---

## P0 — Blockerare (akuta)

### P0-1 — Pricing-refaktor Väg B (pricing-resolver + platform_settings)

**KRITISK — blocker för Rafa-pilot när `use_company_pricing` aktiveras.**

- **Vad:** Skapa `supabase/functions/_shared/pricing-resolver.ts` som:
  - Läser `commission_standard` (12) från `platform_settings`.
  - Läser 3-lagers-pricing: `use_company_pricing` → `company_service_prices` → `cleaner_service_prices` → `hourly_rate`.
  - Returnerar `{ basePricePerHour, priceType, commissionPct, source }`.
- **Konsekvens om ej fixat:** `booking-create` ignorerar `use_company_pricing` + hårdkodar `0.17` istället för att läsa `platform_settings` → fel commission + fel pris när Rafa aktiveras.
- **Strategisk vinst:** Single source of truth för commission (`platform_settings`). Alla framtida pricing-ändringar blir en UPDATE på en tabellrad.
- **Tid:** **3-4h** (nedskalat från 8h — platform_settings finns redan, bara att läsa från den).
- **Beroende:** Inget externt.
- **Commits (4 planerade):**
  1. `feat(pricing): shared pricing-resolver helper i _shared/` (läser platform_settings + 3-lagers)
  2. `refactor(booking-create): använd pricing-resolver + platform_settings` (ersätter rad 183-210 + 497)
  3. ~~`chore: radera stripe-checkout EF (död kod)`~~ – **GJORT 2026-04-21** (§1.2 SUPERSEDED)
  4. `test: kör 6-scenario regression mot staging`
- **Länk:** [`/docs/dag2-planering/pricing-fix-strategi-2026-04-17.md`](dag2-planering/pricing-fix-strategi-2026-04-17.md)

### P0-2 — BUG 3 snabbfix (stadare-uppdrag.html)

**Oberoende av P0-1 — kan fixas nu direkt.**

- **Vad:** `stadare-uppdrag.html:637` läser obefintligt fält `booking.commission_rate` → alltid fallback `0.17` → fel ersättningsbelopp visas för teammedlemmar.
- **Åtgärd:** Byt till `(booking.commission_pct || 12) / 100`.
- **Tid:** 15-20 min inkl. manuell test.
- **Prio:** Aktiv frontend-bug. Kan committas fristående före P0-1.

### P0-3 — SQL-audit inför Dag 2

**Kör INNAN Dag 2 kodfix.**

```sql
-- Verifiera platform_settings live-värden
SELECT key, value FROM platform_settings
WHERE key IN ('commission_standard', 'commission_top');
-- Förväntat: 12/12

-- Mix i cleaners (bekräftar att fältet ska ignoreras)
SELECT commission_rate, COUNT(*) FROM cleaners
GROUP BY commission_rate ORDER BY commission_rate;
-- Förväntat: mix av 17/12/0.17/0

-- Historiska bookings (testdata)
SELECT DISTINCT commission_pct FROM bookings;
-- Förväntat: [17]
```

- Tid: 5 min.
- Om `platform_settings.commission_standard <> 12` → uppdatera innan Dag 2 börjar.

### P0-4 — Underleverantörsavtal-signering UI

- **Vad:** Rafael ska signera underleverantörsavtal för att Rafa-pilot ska gå live.
- **Status:** Blockar Rafa-live men blockar INTE Dag 2-kodarbetet.
- **Tid:** Uppskattat 4-6h. Kan tas efter Dag 2.

---

## P0 — Externa blockerare (väntar på andra)

### P0-E1 — Rafael: Stripe Connect complete

- Status: Verifiera via Supabase SQL (`stripe_onboarding_status='complete'` på Rafael).
- Blockerar: Utbetalning till Rafa-teamet.

### P0-E2 — Rafael: Hemadresser för Daniella + Lizbeth

- Status: Väntar på svar.
- Blockerar: `find_nearby_cleaners` returnerar inte dem (NULL `home_lat`/`home_lng`).

### P0-E3 — Försäkringsmäklare-offert 1 Mkr

- Status: Begäran skickad (verifiera).
- Blockerar: Juridik säger OK för Rafa-live.

---

## P1 — Viktigt (efter P0)

### P1-1 — Överlapp-synk mellan bookings och calendar_events

**Blockerar legitima UPDATE-operationer mot `bookings`-tabellen.**

- **Vad:** `bookings` tillåter överlapp vid insert, men `calendar_events` har `no_booking_overlap`-constraint (migration `20260414000001_calendar_events.sql:64-66`). När trigger `trg_booking_to_calendar` (rad 273) försöker synka via `sync_booking_to_calendar()` → constraint-violation → hela UPDATE rullas tillbaka.
- **Nuvarande symptom:** 8 par överlappande testbokningar i prod blockerar t.ex. bulk-UPDATE av `commission_pct` från 17 till 12 på historiska rader.
- **Fix-alternativ:**
  1. Lägg till motsvarande constraint på `bookings`-tabellen + radera överlappande rader.
  2. Gör triggern tolerant mot överlapp (skippa `calendar_events`-sync vid konflikt, eller `WHERE NOT EXISTS`).
  3. Rensa testdata en gång + säkerställ att `booking-create` inte skapar nya överlapp.
- **Rekommendation:** Alt 2 (tolerant trigger) är minsta risk — inga dataraderingar. Alt 3 skulle även åtgärda rotorsaken.
- **Tid:** 2-4h.
- **Status:** Latent problem, ej aktivt blockerande för Rafa-pilot. Men påverkar framtida commission-normalisering.

### P1-2 — Innovation Sprint-migrationer (referral, coupons, spark)

- **Status:** Ej körda i prod (per CLAUDE.md).
- **Konsekvens:** Coupons, referrals, spark-system kan inte användas live.
- **Tid:** ~2h körning + verifiering.

### P1-3 — Data-cleanup: avbokad+betald booking

- **SQL-fix:** 1 bokning (april 2026) med `status='avbokad'` AND `payment_status='paid'`. Kräver manuell refund eller status-ändring.
- **Beroende:** Vänta tills P1-1 är fixat (annars blockar trigger eventuell UPDATE).

### P1-4 — `customer_profiles` backfill

- **Status:** 1 rad trots 4 unika kunder. Upsert-fix deployad 2026-04-14 (fungerar framåt).
- **Behov:** Engångsscript som skapar profiles för historiska bokningar.

### P1-5 — Commission BUG 2 + BUG 4 (kosmetiska, hårdkodade värden i email/dashboard)

- **BUG 2:** `auto-remind.ts:119,155,361,673` + `notify.ts:212,332-333` hårdkodar `*0.83` i email. Efter 12%-beslutet är rätt värde `*0.88`.
- **BUG 4:** `stadare-dashboard.html:9080` hårdkodar `0.12` fallback när `commission_log` saknas.
- **Åtgärd:** Läs från `platform_settings.commission_standard` istället.
- **Påverkan:** Ingen pengaflytt — bara visningsfel. Kan tas efter P0-1 (då helper finns).

### P1-6 — Commission-normalisering cleaners/companies

- **Vad:** `cleaners.commission_rate` och `companies.commission_rate` har blandade värden (17, 12, 0.17, 0). Sätt alla till NULL eller radera kolumnerna — data-källan är `platform_settings` nu.
- **Beroende:** P1-1 måste vara fixat (UPDATE blockeras annars).
- **Tid:** 30 min SQL + 1h testa att inget kodställe fortfarande läser fälten.

---

## P2 — Bra att ha

### P2-1 — UGC-translation (user-generated content)

- **Upptäckt 2026-04-17:** Google Translate täcker bara UI, INTE email/SMS/DB-fält.
- **Problem:** Om kund skickar chatmeddelande på svenska → städare på arabiska får det oöversatt.
- **Tre alternativ (A/B/C):**
  - A: DeepL API per meddelande ($0.005/st).
  - B: OpenAI per meddelande (~$0.001/st, men kräver prompt-engineering).
  - C: Hybrid — cache per språkpar i DB, lazy-translate vid behov.
- **Triggers för prio:** Första dispute p.g.a. språkförvirring ELLER 3:e företag onboardas.

### P2-2 — Uzbekiska (uz) i Google Translate-widget

- **Vad:** 3 små HTML-ändringar i `stadare-dashboard.html` för att lägga till `uz` i GT-widgeten.
- **För:** Solid Service-teamet (Nasiba, Dildora, Nilufar, Firdavsiy).
- **Tid:** 2 min manuell editing (Farhad gör själv).

### P2-3 — SMS-integration (46elks)

- **Status:** Ej implementerat (per CLAUDE.md).
- **Behov:** Bokningsbekräftelser via SMS.

### P2-4 — Google Business Profile

- **Status:** Ej skapat.
- **Fördel:** Lokal SEO.

### P2-5 — PostHog analytics

- **Status:** Ej installerat.
- **Alternativ:** Microsoft Clarity redan installerad (`w1ep5s1zm6`).

### P2-6 — Sentry error monitoring

- **Status:** Ej installerat.

### P2-7 — Astro-migrering

- **Vad:** 64 HTML → komponentbaserat (Astro).
- **Status:** Framtid. Inte akut.

### P2-8 — Språk-picker Modell E (cleaners.languages + companies.languages)

- **Vad:** Sökbar multi-select för språk, sparat som jsonb ISO 639-1-koder på både `cleaners` och `companies`. Central `/js/languages.js` (37 språk), återanvändbar `/components/language-picker.html`. Filtrering i `find_nearby_cleaners` RPC.
- **Syfte:** Kund kan välja språk i bokningsflödet. Företagsprofil visar team-unionen (om `allow_customer_choice=true`) eller VD-satt pitch (om false).
- **Tid:** 4-6h (7 faser: audit → data → JS → UI-integration → visning → matchning → test).
- **Status:** Planerad vecka 17, efter Solid Service-piloten.
- **Full spec:** [`/docs/backlog/sprak-modell-E-plan.md`](backlog/sprak-modell-E-plan.md) — innehåller datamodell, SQL-migration, UI-komponent, 8 låsta beslut, 4 öppna frågor, testplan, risker.
- **Blockerar:** Inget aktivt. Zivar-demo 2026-04-19 använder nuvarande språk-UI (Google Translate client-side).

---

## P3 — Backlog

- BankID-integration djupare (nuvarande är MVP).
- Swish-live.
- React Native-app.
- Stripe Connect Express → Standard (för större volymer).

---

## Statusnoter

### V1.0-verifiering

- **Commission-audit:** ✅ UTFÖRT 2026-04-17. 4 buggar identifierade (se commission-audit-dokument).
- **Pricing-arkitektur-audit:** ✅ UTFÖRT 2026-04-17. 14 paths kartlagda, 1 kritisk bugg (`booking-create` ignorerar `use_company_pricing`).
- **SQL-verifiering:** ⏳ Ej körd än (P0-3).
- **Regression-test:** ⏳ Ej körd än (väntar på Dag 2-fix).

### Rafa-pilot (Solid Service)

**Blockerare identifierade (2026-04-17):**
1. 🔴 Pricing-sync i booking-create (P0-1).
2. 🔴 Commission BUG 1 + 3 (P0-2).
3. 🔴 Underleverantörsavtal-UI (P0-4).
4. 🟡 Stripe Connect Rafael (P0-E1, extern).
5. 🟡 Koordinater Daniella + Lizbeth (P0-E2, extern).
6. 🟡 Försäkring (P0-E3, extern).

**Dag 2-fix deploy → SQL-fix flippar flaggan → första testbokning:** Uppskattat 2026-04-19/20.

### Avklarat senaste 7 dagarna (2026-04-10 → 2026-04-17)

- Admin + VD kan avboka bokningar (booking-cancel-v2 bypass) — commit `2fff973`.
- Dashboard konsoliderad kalender för VD — commit `73b3b71`.
- Race condition i bdCancel/bdReject fixad — commit `712019c`.
- Bokningar-fliken 4 problem fixade — commit `4516ef6`.
- SEO: 3 noindex-sidor borttagna från sitemap — commit `dc46cbe`.

---

## Beslutsmatris (från Dag 1 + kontext-update 2026-04-17)

| Fråga | Beslut | Motivering |
|-------|---------|------------|
| Väg A/B/C för pricing-fix? | **B** (pricing-resolver helper som läser platform_settings) | Single source of truth. Framtida pricing-ändringar = 1 UPDATE-rad. Nedskalat från 8h till 3-4h. |
| Commission-BUG 1 i Dag 2? | **Ja** | Samma fil (`booking-create`). Löses via platform_settings-läsning. |
| BUG 3 i Dag 2? | **Oberoende snabbfix** (P0-2) | 15-20 min, egen commit. Kan deployas före P0-1. |
| Commission-BUG 2+4 i Dag 2? | **Nej — P1-5 senare** | Kosmetiska. Fixas när pricing-resolver helper finns (läs `platform_settings` därifrån). |
| ~~Radera stripe-checkout EF?~~ | **GJORT 2026-04-21** (§1.2 SUPERSEDED) | 0 invocations verifierat 20 dgr + 0 callers. booking-create bär betalningen. |
| Underleverantörsavtal-UI prio? | **Efter Dag 2 deploy** | Blockar Rafa-live, inte kodarbetet. |
| SQL-audit före Dag 2? | **Ja** | 5 min. Verifiera att `platform_settings.commission_standard=12` live. |
| Calendar_events-overlap (P1-1)? | **Efter Rafa-pilot** | Latent problem. Blockerar bulk-UPDATE men inte nya bokningar. |
| Normalisera cleaners/companies.commission_rate? | **P1-6, efter P1-1** | Kräver UPDATE som blockeras av overlap-bug. Ignoreras av ny kod under tiden. |
