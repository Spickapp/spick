# 3 — Spick Todolist (v2)

> **Senast uppdaterad:** 2026-04-17 efter Dag 1-audit.  
> **Konvention:** P0 = blocker, P1 = viktigt, P2 = bra-att-ha, P3 = backlog.

---

## P0 — Blockerare (akuta)

### P0-1 — Pricing-sync-fix (booking-create läser use_company_pricing)

**KRITISK — blocker för Rafa-live + alla framtida `use_company_pricing=true`-flippar.**

- **Vad:** `booking-create/index.ts:183-210` läser ENDAST `cleaner_service_prices` och `cleaner.hourly_rate`. Ignorerar `companies.use_company_pricing` helt.
- **Konsekvens:** Om flaggan sätts till `true` → `bookings.total_price` sparas baserat på fel källa → mismatch mot vad kunden ser i `boka.html`-preview.
- **Status idag:** LATENT. Rafas flagga är `false`. Får INTE sättas till `true` förrän fixad.
- **Vald väg:** **B — gemensam `_shared/pricing-resolver.ts` helper** (rekommenderad enligt fix-strategi).
- **Tid:** ~8h (4 commits: helper + refactor + commission-fix + stadare-uppdrag-fix + regression 6 scenarier).
- **Beroende:** SQL-audit (3 queries) körs före start (se P0-3).
- **Länk:** [`/docs/dag2-planering/pricing-fix-strategi-2026-04-17.md`](dag2-planering/pricing-fix-strategi-2026-04-17.md)

### P0-2 — Commission BUG 1 + BUG 3 (samma PR som P0-1)

- **BUG 1:** `booking-create:497` + `stripe-checkout:88` hårdkodar commissionRate. Ignorerar `pricing.commissionPct` (Top-tier=14) och `cleaners.commission_rate`.
- **BUG 3:** `stadare-uppdrag.html:637` läser `booking.commission_rate` (fältet finns inte). Alltid fallback 0.17.
- **Löses i:** Samma Dag 2-PR som P0-1. Samma filer berörs.
- **Länk:** [`/docs/dag2-planering/commission-audit-2026-04-17.md`](dag2-planering/commission-audit-2026-04-17.md)

### P0-3 — SQL-audit inför Dag 2

**Kör INNAN Dag 2 kodfix.**

```sql
SELECT COUNT(*) FROM cleaners WHERE commission_rate < 1;  -- förväntat: 0
SELECT COUNT(*) FROM cleaners WHERE tier = 'top';          -- förväntat: 0
SELECT DISTINCT commission_pct FROM bookings;              -- förväntat: [17]
```

- Om någon ger oväntat svar → BUG 1 är redan aktiv → prioritet höjs.
- Tid: 5 min.

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

### P1-1 — Innovation Sprint-migrationer (referral, coupons, spark)

- **Status:** Ej körda i prod (per CLAUDE.md).
- **Konsekvens:** Coupons, referrals, spark-system kan inte användas live.
- **Tid:** ~2h körning + verifiering.

### P1-2 — Rensa död kod: `stripe-checkout` EF

- **Status:** EFn anropas INTE från någon frontend-fil (verifierat 2026-04-17 — `boka.html:2847` anropar bara `booking-create`).
- **Förutsättning:** Kontrollera Supabase Function invocations senaste 7 dagar är 0. Om 0 → radera.
- **Fördel:** Minskar underhållsskuld + förvirring.

### P1-3 — Data-cleanup: avbokad+betald booking

- **SQL-fix:** 1 bokning (april 2026) med `status='avbokad'` AND `payment_status='paid'`. Kräver manuell refund eller status-ändring.

### P1-4 — `customer_profiles` backfill

- **Status:** 1 rad trots 4 unika kunder. Upsert-fix deployad 2026-04-14 (fungerar framåt).
- **Behov:** Engångsscript som skapar profiles för historiska bokningar.

### P1-5 — Commission BUG 2 + BUG 4 (kosmetiska)

- **BUG 2:** `auto-remind.ts` + `notify.ts` hårdkodar `*0.83` i email. Fel för Top-tier och companies.
- **BUG 4:** `stadare-dashboard.html:9080` hårdkodar 0.12 fallback.
- **Påverkan:** Ingen pengaflytt — bara visningsfel. Kan tas senare.

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

## Beslutsmatris (från Dag 1)

| Fråga | Rekommendation | Motivering |
|-------|---------------|------------|
| Väg A/B/C för pricing-fix? | **B** | 4 paths duplicerade → A förvärrar. BUG 1 bor i samma filer. C är overengineering. |
| Commission-BUG 1+3 i Dag 2? | **Ja** | Samma filer som pricing-fix. |
| Commission-BUG 2+4 i Dag 2? | **Nej** | Kosmetiska. Separat PR senare. |
| Ta bort stripe-checkout EF? | **Efter Dag 2-verifiering** | Kontrollera 0 invocations senaste 7 dagar först. |
| Underleverantörsavtal-UI prio? | **Efter Dag 2 deploy** | Blockar Rafa-live, inte kodarbetet. |
| SQL-audit före Dag 2? | **Ja** | 5 min, kan höja prio om BUG 1 redan aktiv. |
