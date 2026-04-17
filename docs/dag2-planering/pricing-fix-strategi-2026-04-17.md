# Pricing-fix: Strategival för Dag 2

**Datum:** 17 april 2026  
**Grund:** [pricing-arkitektur-2026-04-17.md](pricing-arkitektur-2026-04-17.md) + [commission-audit-2026-04-17.md](commission-audit-2026-04-17.md)

---

## Kontext

`booking-create/index.ts:183-210` läser endast `cleaner_service_prices` och `cleaner.hourly_rate`. Den ignorerar `companies.use_company_pricing` flaggan helt. När Rafa aktiverar sin flagga sparas fel `total_price` i DB, medan Stripe tar rätt pris — mismatch.

Därtill finns commission-BUG 1: `booking-create` (rad 497) och `stripe-checkout` (rad 88) hårdkodar commission-rate för Stripe application_fee istället för att läsa `cleaners.commission_rate` eller `pricing.commissionPct`.

Den kompletta logiken finns redan i `stripe-checkout/index.ts:112-164` men den EF anropas INTE av `boka.html` längre (verifierat 17 april).

---

## Tre strategiska vägar

### Väg A — Patch booking-create direkt

**Vad:** Kopiera 3-lagers-logiken från `stripe-checkout/index.ts:112-164` in i `booking-create/index.ts:183-210`. Två filer, samma logik.

**Konkreta rader:**
- Läs `companies.use_company_pricing` om `cleaner.company_id`.
- Läs `company_service_prices` när flagga=true (Lager 1).
- Behåll nuvarande `cleaner_service_prices` som Lager 2a.
- Lägg till `company_service_prices` fallback för Lager 2b.

**Tid:** 3-4h inkl. tester (grunt-fix: ~15 rader kod + 6 test-scenarier).

**Risk:** Låg-medel.
- Låg teknisk risk (kopiera etablerad logik).
- Medel business-risk (manuell testning krävs för att inte bryta befintliga bokningar).

**Teknisk skuld:** **Hög.** Samma logik nu duplicerad i 4 filer:
1. `boka.html` (preview)
2. `stripe-checkout` (legacy/död?)
3. `booking-create` (patch)
4. `foretag.html` (variant)

**Pro:**
- Snabbast väg till Rafa-live.
- Minimal refactor.
- Bootstrap-pragmatism — lös akuta buggen, lös arkitekturen senare.

**Con:**
- Nästa pricing-förändring missar sannolikt en plats igen.
- Divergens mellan paths ökar risken för silent-bugs.

---

### Väg B — Gemensam pricing-helper i `_shared/`

**Vad:** Skapa `supabase/functions/_shared/pricing-resolver.ts` med funktion:

```ts
export async function resolveBasePrice(
  supabase: SupabaseClient,
  opts: { cleaner_id: string; service_type: string; sqm?: number; hours: number }
): Promise<{ basePricePerHour: number; priceType: "hourly"|"per_sqm"; source: "company"|"individual"|"company_fallback"|"hourly_rate"|"default" }>
```

**Implementation:** Exakt 3-lagers-logiken (Lager 1 → 2a → 2b → 2c → default 399).

**Integration:**
- `booking-create` importerar och ersätter rad 183-210.
- `stripe-checkout` importerar och ersätter rad 112-164 (eller tar bort EF om död).
- Optionellt: skapa RPC-wrapper så `boka.html` kan anropa samma via PostgREST.

**Tid:** 6-8h inkl. tester.
- 2h: Skriv helper + enhetstester.
- 2h: Migrera `booking-create` + kontrollera.
- 2h: Migrera `stripe-checkout` eller ta bort.
- 2h: Testa alla 6 scenarier + regression på subscription/override.

**Risk:** Medel.
- Teknisk risk medel (refactor av aktiv path).
- Business-risk låg om man kör noggrann regression.

**Teknisk skuld:** **Låg.** En källa för sanning. Framtida ändringar sker på ett ställe.

**Pro:**
- Permanent lösning.
- Fixar både BUG (företagspris) och underbyggnad för framtida delning med frontend.
- Möjlighet att exponera som RPC senare (Väg C light).

**Con:**
- Större initial refactor.
- Kräver att man är säker på `stripe-checkout` status (död vs levande).
- Helper måste hantera edge cases som pricing-engine också tar hänsyn till (discount, subscription, override).

**Bonus:** Om helper returnerar JSON-struktur kan `boka.html` via en RPC `get_base_price(cleaner_id, service, sqm)` anropa samma kod — frontend och backend synkas automatiskt. Tredje källan (frontend) kan synkas i en senare PR.

---

### Väg C — PostgreSQL RPC för pricing

**Vad:** Flytta hela prisberäkningen till SQL-funktion:

```sql
CREATE OR REPLACE FUNCTION public.resolve_base_price(
  p_cleaner_id uuid,
  p_service_type text,
  p_sqm integer DEFAULT NULL
) RETURNS jsonb AS $$
  -- 3-lagers-logik i SQL
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
```

Alla klienter (Edge Functions + frontend) anropar via `supabase.rpc("resolve_base_price", ...)`.

**Tid:** 10-12h.
- 3h: SQL-funktion + migration.
- 2h: Enhetstester (pgTAP eller motsvarande).
- 2h: Migrera booking-create till RPC-anrop.
- 2h: Migrera stripe-checkout eller ta bort.
- 2h: Migrera boka.html preview till RPC.
- 1h: Regression alla flöden.

**Risk:** Medel-hög.
- SQL-debugging är svårare.
- Deploy-koppling: kodändring kräver migration.
- Om RPC kraschar kan hela boknings-flödet falla.

**Teknisk skuld:** **Lägst** på papper, men kräver SQL-kompetens för framtida ändringar.

**Pro:**
- Allra cleanaste arkitektur.
- Frontend och backend garanterat synkade.
- RLS-säker (SECURITY DEFINER).

**Con:**
- Over-engineering för Rafas akuta behov.
- Spick är en solo-dev-bootstrap utan tvåan som kan granska SQL-funktionen.
- Svårare att testa lokalt (kräver Supabase CLI + lokal migration).
- Bryter CLAUDE.md-konvention om att hålla logik i EF/frontend, inte DB.

---

## Rekommendation

**Rekommendation: Väg B (gemensam pricing-helper i `_shared/`).**

### Motivering

1. **Fyra pricing-paths bekräftade** i auditen (`boka.html`, `booking-create`, `stripe-checkout`, `foretag.html`). Väg A skulle lägga till en femte divergenspunkt. Kostnaden för duplicering är nu redan hög — varje fix framöver måste vi röra minst två filer.

2. **Commission-audit hittade samma mönster:** BUG 1 beror på att commission-logik duplicerats mellan `booking-create:497` och `stripe-checkout:88`. En `_shared/commission-resolver.ts` i samma PR löser båda problemen. Dag 2 behöver inte begränsas till pricing — man kan lösa commission-delen samtidigt med ~20 extra rader i samma helper.

3. **`stripe-checkout` verkar vara död kod.** Verifiering i boka.html (rad 2847) visar att frontend bara anropar `booking-create`. Detta innebär att Väg B kan kombineras med att ta bort `stripe-checkout` → netto mindre kod trots refactor.

4. **`pricing-engine.ts` finns redan i `_shared/`.** Det är etablerat mönster — pricing-resolver skulle följa samma konvention. Man introducerar ingen ny pattern.

5. **Väg C är overengineering för Spicks skala.** 26 bokningar hittills. SQL-RPC är motiverat först när man har 3+ klienter i olika språk. Spick har TypeScript överallt.

6. **Väg A är frestande men kostar senare.** Varje duplicerad fix tar ~30 min att tänka igenom på båda ställen — över 1 år blir det dyrare än de 4h refaktorn hade tagit.

### När Väg A vore rätt val istället

Om Rafa-live hade varit imorgon. Eftersom Dag 2 har 8+ timmar avsatt, ryms Väg B.

### När Väg C vore rätt val istället

Om vi planerade att exponera pricing till externa integrationer (mobilapp, 3rd-party). Inga sådana planer på 2026-roadmapen.

---

## Konkret Dag 2-plan (Väg B vald)

### Fas 1 — Gemensam helper (2h)

**Commit 1:** `feat(pricing): shared pricing-resolver helper i _shared/`

- Skapa `supabase/functions/_shared/pricing-resolver.ts`.
- Implementera `resolveBasePrice(supabase, { cleaner_id, service_type, sqm, hours })`.
- 3-lagers-logik med eksplicit `source`-fält i retur.
- Hantera `price_type = "per_sqm"` korrekt (ingen `hourly_rate` fallback på per_sqm).
- Enhetstest: 6 scenarier (Deno test eller jest-motsvarighet).

### Fas 2 — Migrera booking-create (2h)

**Commit 2:** `refactor(booking-create): använd pricing-resolver helper`

- Ersätt [booking-create/index.ts:183-210](supabase/functions/booking-create/index.ts:183) med anrop till helper.
- Behåll `pricing-engine` kopplingen (helper returnerar bara basePricePerHour; engine gör resten).
- Manuell test: boka som kund mot cleaner i Rafas företag (med `use_company_pricing=false`).

### Fas 3 — Fix commission-bugg i samma PR (1h)

**Commit 3:** `fix(booking-create): läs cleaner.commission_rate för Stripe application_fee`

- Ersätt [booking-create/index.ts:497,508](supabase/functions/booking-create/index.ts:497) hårdkodade värden:
  ```ts
  // Från:
  let commissionRate = customer_type === "foretag" ? 0.12 : 0.17;
  if (cleanerConnect?.company_id) commissionRate = 0.12;
  
  // Till:
  let commissionRate = (pricing.commissionPct || 17) / 100;
  // Optional: override från cleaners.commission_rate om satt manuellt
  if (cleaner.commission_rate && cleaner.commission_rate >= 5 && cleaner.commission_rate <= 30) {
    commissionRate = cleaner.commission_rate / 100;
  }
  ```
- Testa: Rafa-bokning → stripe application_fee = 12% av amountOre.

### Fas 4 — Fix stadare-uppdrag.html (30min)

**Commit 4:** `fix(stadare-uppdrag): läs commission_pct istället för commission_rate`

- Ersätt [stadare-uppdrag.html:637](stadare-uppdrag.html:637):
  ```js
  var commissionRate = booking.commission_rate || 0.17;
  ```
  med:
  ```js
  var commissionRate = (booking.commission_pct || 17) / 100;
  ```

### Fas 5 — Rafas SQL (efter fix deployed)

**Commit 5 (separat):** SQL (manuell körning, inte via migration):
```sql
UPDATE companies SET use_company_pricing = true WHERE id = '<rafa_uuid>';
```

### Fas 6 — (Optionellt) Städa stripe-checkout

**Commit 6:** `chore: ta bort stripe-checkout EF (ersatt av booking-create)`

- Endast om Supabase-logs bekräftar 0 invocations senaste 7 dagar.
- Om tveksamhet → lämna för senare PR.

### Fas 7 — Regression

- Kör manuellt alla 6 test-scenarier (se nedan).
- Deploy till prod.
- Verify-deploy.sh kör (18 checks).

---

## Testplan (gäller alla vägar)

Före release MÅSTE dessa 6 scenarier testas manuellt i Supabase-preview eller mot staging:

### 1. Solo-cleaner med `cleaner_service_prices`
- Cleaner A: `hourly_rate=400`, `cleaner_service_prices[Hemstädning]=350`.
- Boka Hemstädning 3h.
- **Förväntad:** `bookings.total_price = 350*3 = 1050`. Stripe tar 17% = 178.5 öre × 100 = 17850.

### 2. Solo-cleaner utan `cleaner_service_prices`
- Cleaner B: `hourly_rate=400`, inga rader i `cleaner_service_prices`.
- Boka Hemstädning 3h.
- **Förväntad:** `bookings.total_price = 400*3 = 1200`. Fallback till `hourly_rate`.

### 3. Cleaner i företag, `use_company_pricing=false`, har `cleaner_service_prices`
- Cleaner C i Company X (flag=false). Har individpris `Hemstädning=380`.
- **Förväntad:** Använd individpris → `total_price = 380*3 = 1140`.

### 4. Cleaner i företag, `use_company_pricing=false`, saknar `cleaner_service_prices`
- Cleaner D i Company Y (flag=false). Ingen individpris. Company har `company_service_prices[Hemstädning]=400`.
- **Förväntad efter fix:** Fallback till företagspris → `total_price = 400*3 = 1200`.
- **Nuvarande buggig:** Faller till `hourly_rate=350` → `total_price = 1050`.

### 5. Cleaner i företag, `use_company_pricing=true`  ← **RAFAS CASE**
- Cleaner E i Company Z (flag=true). Individpris 300, företagspris 350.
- **Förväntad efter fix:** ALLTID företagspris → `total_price = 350*3 = 1050`.
- **Nuvarande buggig:** Använder individpris 300 → `total_price = 900`.

### 6. Per_sqm-pricing (Fönsterputs)
- Cleaner F: `cleaner_service_prices[Fönsterputs]={price:45, price_type:'per_sqm'}`.
- Boka Fönsterputs 3h med `sqm=80`.
- **Förväntad:** `total_price = 45*80 = 3600` (ignorera hours vid per_sqm).

**Verifikation:** För varje scenario, kolla:
- `bookings.total_price` i DB matchar förväntad.
- Stripe dashboard: session belopp matchar `total_price * 100` öre.
- Stripe dashboard: application_fee = `total_price * (commission_pct/100) * 100` öre.
- `commission_log.commission_pct` = samma som `bookings.commission_pct`.

---

## Beroenden och pre-flight

Innan Dag 2 kodfix:

1. **SQL-verifiering (oklart om krävs):**
   ```sql
   -- Finns mixed commission_rate format?
   SELECT COUNT(*) AS decimal_count FROM cleaners WHERE commission_rate < 1;
   SELECT COUNT(*) AS percent_count FROM cleaners WHERE commission_rate >= 1;
   -- Har någon cleaner tier='top'?
   SELECT COUNT(*) FROM cleaners WHERE tier = 'top';
   -- Är all commission_pct i bookings = 17?
   SELECT DISTINCT commission_pct FROM bookings;
   ```

2. **Konfirmera att stripe-checkout är död kod:**
   - Kolla Supabase Function invocations senaste 7 dagar.
   - Grep hela kodbasen: `grep -rn 'stripe-checkout' --include="*.html" --include="*.js"`.

3. **Backup DB-snapshot:** Även om fix är kod-bara, rollback-plan bör finnas.

4. **Feature-flag inte nödvändig:** Fixen bryter INTE befintliga bokningar (bara lägger till fallback-logik). Man kan deploya utan staged rollout.

---

## Stopp-kriterium Dag 2

- Alla 6 scenarier passerar manuell test.
- Supabase-logs visar ingen ökning i 500-errors från `booking-create` första timmen.
- Rafa har aktiverat `use_company_pricing=true` och gjort en testbokning som sparats korrekt.

Om något bryter → revert commit-chain och planera om.
