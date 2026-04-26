# B2B-faktura mot företag vs Stripe-direct-transfer — slutanalys

**Datum:** 2026-04-26
**Trigger:** Farhad-fråga: "Är det inte bra om vi ordnar B2B-faktura mot företag? Vi kommer ändå inte betala ut till cleaner owner om pengarna inte kommit in. Kan vi säkra upp detta utan att Spick tar någon risk?"
**Bonus-fråga:** "Finns det system som specificerar utbetalningar per jobb till cleaner-owner?"

---

## DEL 1 — Kassaflödes-arkitektur: B2B-faktura vs Stripe-direct

### 1. Nuvarande state (verifierat 2026-04-26)

**Cash-flow:**
```
Kund ──Stripe Checkout──> Spick (Stripe Balance, escrow-låst)
                              │
                              │ [Escrow-period 3d / 7d vid dispute]
                              │ [Attest från kund + auto-release]
                              ▼
                        Spick (Stripe Balance, frigjord)
                              │
                              ├──Cleaner solo──> Cleaner Stripe Express
                              │
                              └──Cleaner i team──> Företag Stripe Express (Alt A, idag)
                                                    │
                                                    │ [Cleaner-owner = juridiskt
                                                    │  ansvarig för fördelning
                                                    │  internt till team-medlemmar]
                                                    ▼
                                               Bankkonto
```

**Risk-bedömning för Spick (idag):**
- ✅ **Ingen kreditrisk:** kund betalar FÖRST (Stripe Checkout). Spick håller pengarna. Transferrar bara om de finns.
- ✅ **Ingen valuta-risk:** SEK genomgående.
- ⚠️ **Stripe-fee-risk:** ~1,4% + 1,80 kr per Checkout. ~0,25 USD per transfer. Spick bär detta.
- ⚠️ **Chargeback-risk:** kund kan reverse:a 60-180 dagar via banken. Då har Spick redan transfererat till företag → Spick får negativ Stripe-balance → Spick måste claw-back från företaget (svårt). § 8.24-25 i Fas 8-roadmap.

**Slutsats:** Spick TAR ingen kreditrisk i normal-flöde. Risk uppstår vid chargeback EFTER transfer.

---

### 2. Föreslagen B2B-faktura-modell (Farhads fråga)

**Cash-flow:**
```
Kund ──Stripe Checkout──> Spick (Stripe Balance, escrow-låst)
                              │
                              │ [Escrow-period + attest]
                              ▼
                        Spick (Stripe Balance, frigjord)

                        [INGEN automatisk Stripe-transfer]

Spick ──genererar────> B2B-faktura till Företag (Underleverantör)
        månadsvis      Belopp: 88% av booking-summa per jobb i perioden
                       Betalningsvillkor: "Betalas inom X dagar
                                            EFTER Spick mottagit
                                            kund-betalning för respektive jobb"
                              │
                              │ [Företag vet: faktureringsperiod = pengar
                              │  som Spick faktiskt fått in. Inga jobb där
                              │  kund inte betalat eller chargeback är aktiv.]
                              ▼
Spick ──manuell utbetalning──> Företags bankkonto
        (via Stripe Connect    (eller via vanlig bankgiro/Swish-företag)
         eller bankgiro)
```

**Vad ändras juridiskt:**
- **Idag:** Spick = teknisk plattform/agent. Transferen är "vidarebefordran av kund-betalning" via Stripe.
- **B2B-faktura:** Spick = uppdragsgivare. Köper en städtjänst av Underleverantören. Faktura mellan Spick och Underleverantören.

**Avtalsklausul som behövs (i underleverantörsavtalet, § 4.X):**
```
§4.X Fakturering och betalning

Underleverantören accepterar att Spick fakturerar Underleverantörens
arvode månadsvis i efterskott, baserat på utförda och kund-attesterade
jobb under perioden.

Spick:s betalningsskyldighet inträder ENBART när:
 (a) Kunden har slutbetalat den aktuella bokningen, OCH
 (b) Eventuell escrow-period (3-7 dagar) har löpt ut utan dispute, OCH
 (c) Eventuell chargeback-period (180 dagar via Visa/Mastercard) har
     passerat ELLER bankkort-betalning har klassats som "settled" av
     Spick:s betalleverantör (Stripe).

Spick betalar utestående Underleverantörs-faktura inom [14] dagar efter
samtliga ovanstående villkor är uppfyllda.

Underleverantören accepterar att vid chargeback efter utbetalning kan
Spick återkräva motsvarande belopp i kommande faktura-avstämning.
```

---

### 3. Fördelar med B2B-faktura

| Fördel | Förklaring | Värde för Spick |
|---|---|---|
| **Tydligare juridisk relation** | Avtalslagens 36 § appliceras på B2B (avtal mellan jämbördiga näringsidkare) — högre tröskel för jämkning än konsumentavtal. | Stark |
| **EU PWD-skydd** | Spick:s position som "uppdragsgivare som köper tjänst" är tydligare gränsdragning från "arbetsgivare" enligt EU Platform Work Directive (träder i kraft dec 2026). | KRITISK |
| **Chargeback-skydd** | Spick kan POSTPONE betalning till Underleverantören tills chargeback-fönster (180 dagar) löpt ut → ingen claw-back-problem. | Stark |
| **Bokföringssäkerhet** | Faktura med kund-bokningsnr per rad = klart spår vid SKV-revision. BokfL 7-års retention enkelt. | Medel |
| **Dispute-leverage** | Spick kan WITHHOLD faktura-betalning vid pågående dispute → starkare incitament för Underleverantören att samarbeta. | Stark |
| **Anti-fraud-leverage** | Underleverantören kan inte "ta pengarna och försvinna" — pengar betalas via faktura efter verifiering. | Medel |
| **Skattetransparens** | Underleverantörens intäkt = faktura-summan. Lätt att redovisa moms (Spick köper exklusive moms B2B, fakturera till slutkund inklusive moms av Spick själv). | Medel |
| **Liknar branschstandard** | Hemfrid/Hemmaplus opererar med liknande franchise/B2B-faktura-modeller (verifierat via offentliga årsredovisningar). | Medel |

---

### 4. Nackdelar och risker med B2B-faktura

#### 4.1 Operativa nackdelar

| Nackdel | Beskrivning | Mitigering |
|---|---|---|
| **Manuellt arbete** | Faktura-skapande, faktura-mejl, betalnings-tracking. Idag är det 100% automatiserat via Stripe Connect. | Bygg auto-faktura-EF (~15-20h). Kvarstår ~5 min/månad/Underleverantör. |
| **Cash-flow-fördröjning för Underleverantören** | Idag: pengar når Cleaner-bankkonto inom 1-2 dagar efter attest. Med B2B: kanske 30-45 dagar. | Tydlig kommunikation. Erbjud "early payment"-rabatt för snabbare cash-flow. |
| **Bokföringsbörda för Underleverantören** | Underleverantören får 1 stor faktura/månad istället för många små Stripe-transferskvitton. | Faktura-detaljer per jobb (beskrivning, datum, kund, belopp). Underleverantör bokför som intäkt. |
| **Förlorat "instant gratification"** | Idag ser Cleaner pengar på konto direkt. Med B2B-faktura: ingenting förrän slutet av månaden. | Pre-faktura-vy i VD-dashboard som visar "Pågående arvoden denna månad" realtid. |
| **Kräver bankgiro/manuell utbetalning** | Stripe Connect Express är inte byggt för faktura-flöde. Spick måste antingen: (a) hålla pengarna i Stripe + sen transferra, eller (b) flytta pengarna till bankkonto + bankgirera. | Alt (a) är enkelt — Stripe Balance kan triggra Connect-transfer även "delayed". |

#### 4.2 Juridiska risker

| Risk | Beskrivning | Sannolikhet | Mitigering |
|---|---|---|---|
| **Räntelagen 6 §** | Vid sen betalning från Spick = dröjsmålsränta (8% + ref-ränta = ~13% idag). Underleverantören kan kräva ränta. | Låg om Spick är disciplinerad. | Tydlig betalningstid i avtal (14 dagar efter villkor uppfyllda). |
| **Avtalslagen 36 § jämkning** | Klausul om "betalas vid inkommet" kan jämkas om den ses som oskälig. | Medel — beror på domstols-bedömning. | Klausulen är vanlig i B2B (factoring, freight-forwarding). Bör hålla. |
| **Konkurslagen 5 kap 1 §** | Om Spick går i konkurs har Underleverantören oprioriterad fordran. Förlorar pengarna. | Mycket låg (Spick är solid). | Underleverantören bär samma risk idag (om Spick failar mellan Checkout och Stripe-transfer). Inte ny risk. |
| **Skatteverkets tolkning** | SKV kan se "B2B-relation där Spick styr för mycket" som dolt anställningsförhållande. Då blir Spick arbetsgivare → 31,42% AGE per ersättning. | LÅG-MEDEL | Tydliga gränser i avtalet: Underleverantören styr själv arbetstider, prissätter själv (delvis), är ansvarig för försäkring/utrustning. Hänvisa till SKV:s "okvalificerad uppdragstagare"-checklist. |
| **EU PWD-presumtion** | EU Platform Work Directive (dec 2026) skapar presumtion för anställning vid "kontroll-faktorer". B2B-faktura motverkar 1 av 5 faktorer (ekonomisk kontroll). | HÖG-MEDEL | B2B-faktura HJÄLPER. Spick måste fortfarande adressera 4 andra faktorer (algorithmisk styrning, krav på app, prissättning, kund-tilldelning). |
| **Konkurrenslagen 2 kap 7 §** | Om Spick "samordnar" prissättning över Underleverantörer kan det vara prissamarbete. | LÅG | Underleverantörer sätter eget pris (250-600 kr/h) — redan utanför sam-prissättning. |

#### 4.3 Moms-fråga (kritisk — kräver jurist)

**Datafakta (inte juridik):**
- Idag är Spick (vid Stripe-transfer) inte momspliktig vid själva överföringen — kunden betalade moms vid Checkout, Underleverantören redovisar momsen.
- Med B2B-faktura: Spick köper en städtjänst av Underleverantören. Detta är momspliktig handel (25% standard).
- **Frågan:** kan Spick "vidarefakturera" kundens RUT-betalning till Underleverantören utan dubbel-moms?

**Två scenarier:**

**Scenario A — Spick = ren förmedlare:**
- Spick = agent. Tar 12% provision för förmedlingstjänst.
- Underleverantören är direkt avtalspart med Kunden.
- Kunden betalar Underleverantören (genom Spick som technical agent).
- Spick fakturerar Underleverantören 12% (ren provisionsavgift, momspliktig 25%).
- **B2B-faktura BEHÖVS INTE i denna modell** — Spick samlar in pengar via Stripe + transferrar.

**Scenario B — Spick = utförare:**
- Spick = utförare. Säljer städtjänst till Kunden.
- Underleverantören är Spick:s leverantör.
- Kunden betalar Spick (faktura/Stripe).
- Spick fakturerar Kunden 100% (inkl. moms 25% → reduceras med RUT 50%).
- Underleverantören fakturerar Spick 88% (B2B inkl. moms 25%).
- Spick drar Underleverantörens moms som ingående moms → SLUTRESULTAT: ingen dubbel-moms.

**Min läsning av Spicks nuvarande RUT-flöde:**
- Spick rapporterar RUT-ansökan till SKV (memory `project_rut_ombud_betydelse.md` — Spick = utförare som ansöker direkt från SKV).
- Detta = Scenario B (utförare).
- → B2B-faktura mellan Spick och Underleverantören är KOMPATIBEL och korrekt momsmässigt.

**Måste verifieras med jurist innan implementation.** Per regel #30: detta är min läsning av momsregler, inte regulator-bekräftelse.

---

### 5. Cash-flow-jämförelse (konkreta siffror)

**Antagande:** Underleverantör (Solid Service-VD-team-style) med 100 jobb/månad à snitt 800 kr.

**Idag (Stripe-direct):**
```
Dag 1:  100 kunder bokar (Stripe Checkout, 100×800kr = 80 000 kr)
Dag 1:  Stripe-fee 1,4% + 1,80 kr/booking = 1 120 + 180 = 1 300 kr
Dag 1:  Spick netto i escrow = 78 700 kr
Dag 4:  Escrow-release efter attest. Stripe transfer till företag
Dag 4:  Stripe-transfer-fee 0,25 USD ≈ 2,80 kr × 100 = 280 kr
Dag 4:  Företag får 78 420 kr (inom 1-2 dagar)
Dag 4:  Spick får 12% provision = 9 600 kr (kvar i Spick Stripe Balance)

Total tid: ~5 dagar. Spick risk: 0 (chargeback efter dag 4 är claw-back-problem).
```

**B2B-faktura-modell:**
```
Månad N:    100 kunder bokar och betalar (totalt 80 000 kr i Stripe Balance)
Slutet av   Spick verifierar varje jobb: attest OK, ingen dispute öppen.
månaden N:  Spick filtrerar ut jobb där chargeback-fönster ej passerat.
Månad N+1   Spick utfärdar B2B-faktura till Företag:
första dag:    Faktureringsperiod: 1-X månad N (jobb där villkor uppfyllda)
               Belopp: 88% av summa = 70 400 kr (för 100 jobb à 880 kr exkl. provision)
               Förfallodatum: 14 dagar
Månad N+1    Spick betalar fakturan via bankgiro/Stripe-transfer.
+14 dagar:   Företag får 70 400 kr på bankkonto.

Total tid: ~30-45 dagar (från jobb till pengar).
Spick risk: 0 (chargeback-fönster har passerat innan utbetalning).
```

**Stora skillnader:**
- Cash-flow-fördröjning för Underleverantör: +25-40 dagar
- Spick-risk-reduktion: chargeback-skydd 100% (idag: 60-180 dagars exponering)
- Operationell börda: +15-20h månadsvis arbete (auto-faktura-EF kan reducera till 5-10 min)

---

### 6. Implementations-arkitektur (om OK)

**Sprint A — Faktura-EF + schema (8-10h)**
- `_shared/invoice-builder.ts` — generera invoice-PDF + faktura-rader per booking
- `companies.invoicing_enabled BOOLEAN` (flag — soft-rollout)
- `subleverantor_invoices`-tabell:
  - id UUID
  - company_id UUID FK companies
  - period_start DATE
  - period_end DATE
  - total_amount_sek INT
  - vat_amount_sek INT (25% moms)
  - gross_amount_sek INT
  - bookings_jsonb JSONB (per-jobb-rader)
  - status TEXT ('draft', 'issued', 'paid', 'cancelled')
  - issued_at TIMESTAMPTZ
  - due_at TIMESTAMPTZ
  - paid_at TIMESTAMPTZ
  - pdf_url TEXT (Supabase storage)

**Sprint B — Auto-billing-cron (4-6h)**
- `subleverantor-invoice-cron` EF (månadsvis 1:a)
  - För varje company med `invoicing_enabled=true`:
    - Hämta jobb i föregående månad där villkor uppfyllda
    - Generera invoice
    - Mejla VD via Resend
- Modifiera `money.ts::triggerStripeTransfer`:
  - Om `companies.invoicing_enabled=true` → hoppa över direct-transfer
  - Markera booking som "pending_invoice"
- Daglig cron `pay-due-invoices`:
  - Hitta invoices med status='issued' och due_at <= now
  - Trigga Stripe-transfer för betalning till företaget
  - Markera invoice som 'paid'

**Sprint C — VD-dashboard-vy (3-4h)**
- "Fakturor"-sektion i Inkomst-tab:
  - Pågående arvode (real-time, ej fakturerat ännu)
  - Senaste faktura (PDF-länk + status)
  - Faktura-historik (lista med klick → PDF)

**Sprint D — Underleverantörsavtals-utvidgning (2-3h)**
- Ny § 4.X i `underleverantorsavtal-draft.md` v0.3
- Jurist-bedömning OBLIGATORISK innan aktivering

**Total: ~17-23h.**

---

### 7. Min rekommendation

**Bygg INTE B2B-faktura nu.** Skäl:

1. **Spick:s nuvarande exponering = chargeback-fönstret** (60-180 dagar EFTER transfer). Det är en **REELL risk** men inte en stor sådan i praktiken (chargebacks är sällsynta, 0.5-1% av betalningar branschvis).
2. **Cash-flow-fördröjning är dålig UX** för Underleverantörerna. De är vana vid snabba transfers från Hemfrid/Vardagsfrid (~3-5 dagar). 30-45 dagar = sämre än konkurrenter.
3. **EU PWD-skyddet är stort, men det finns andra bättre åtgärder** (algorithmisk transparens, valbar prissättning, kund-tilldelning). B2B-faktura är 1 av 5 faktorer.
4. **Operativ börda är inte trivial** — månadsvis avstämning + faktura-skapande kräver disciplin. Spick är ännu litet, det här är overhead.

**Rekommendera istället:**
- **Behåll Stripe-direct-transfer** (current).
- **Bygg chargeback-skydd separat** (§ 8.24-25 är redan i Fas 8-roadmap):
  - Reservera 5% av varje transfer i 60-dagars chargeback-buffer per Företag
  - Vid chargeback efter transfer: dra från buffer, eskalera till företag om buffer otillräcklig
  - Detta löser exakt det Farhad är orolig för, utan att förvärra cash-flow för Underleverantörer
- **Spara B2B-faktura-modellen för Fas 14+** (när Spick är 10x större och har Hemfrid-volym där cash-flow-fördröjning är acceptabelt).

**Alternativ rekommendation om Farhad ändå vill bygga:**
- Bygg som FRIVILLIG opt-in. `companies.invoicing_enabled` = false default. Företag som VILL ha B2B-faktura kan välja det. Hemfrid/franchise-modell.

---

## DEL 2 — Per-jobb-spec av utbetalningar till Cleaner-owner

### 8. Nuvarande state (verifierat 2026-04-26)

**Backend (vd-payment-summary EF):**
- ✅ Returnerar full per-jobb-data i `slutreglerat.bookings[]`, `i_escrow.bookings[]`, `kommande.bookings[]`
- Felter per jobb: `id`, `booking_id`, `booking_date`, `total_price`, `cleaner_id`, `cleaner_name`, `service_type`, `escrow_state`

**Frontend (loadVdPaymentSummary i stadare-dashboard.html):**
- ❌ Renderar BARA aggregat: total-summa per kategori, count, per-cleaner-summa
- ❌ INGEN per-jobb-tabell i UI

**Slutsats:** Datat finns, frontend visar bara aggregat. **Lätt fix: utöka render-funktion.**

---

### 9. Föreslagen UI-utvidgning (~1-2h frontend)

**Lägg till i Inkomst-tab efter VD-payment-summary-section:**

```
┌─ Detaljerad jobb-lista (april 2026) ──────────────────────┐
│  [Filter: Alla / Slutreglerat / I escrow / Kommande]       │
│  [Sök: cleaner-namn / kund-namn]                            │
│                                                              │
│  📋 Slutreglerat (35 jobb · 28 000 kr)                     │
│  ─────────────────────────────────────────                  │
│  Cleaner   Datum       Tjänst         Kund      Belopp     │
│  Dildora   2026-04-15  Hemstädning    Anna L.  +880 kr     │
│  Dildora   2026-04-12  Storstädning   Maria K. +1 200 kr   │
│  Nilufar   2026-04-10  Hemstädning    Erik N.  +880 kr     │
│  ...                                                        │
│  [Ladda fler]                                               │
│                                                              │
│  ⏳ I escrow (8 jobb · 6 400 kr)                           │
│  ─────────────────────────────────────────                  │
│  ... (samma format)                                         │
│                                                              │
│  📅 Kommande (12 jobb · 9 600 kr)                          │
│  ─────────────────────────────────────────                  │
│  ... (samma format)                                         │
│                                                              │
│  📊 [Ladda ner CSV-rapport]                                │
└──────────────────────────────────────────────────────────────┘
```

**CSV-export-format:**
```csv
booking_id,date,service,cleaner,customer,total_price_sek,escrow_state,status
SP-2026-0123,2026-04-15,Hemstädning,Dildora,Anna L.,880,released,slutreglerat
SP-2026-0124,2026-04-12,Storstädning,Dildora,Maria K.,1200,released,slutreglerat
...
```

**Implementeringssteg:**
1. Lägg till expandable section i `vd-payment-summary-section`
2. Modifiera `loadVdPaymentSummary()` för att även rendera 3 tabeller (slutreglerat / escrow / kommande)
3. Lägg till filter-dropdown
4. Lägg till CSV-export-funktion (client-side, generera blob)

**Arbete: ~1-2h. Kan göras direkt utan backend-ändringar.**

---

## 10. Slutfrågor till Farhad innan beslut

**B2B-faktura (Del 1):**
1. **Bygga eller skippa?** (Min rek: skippa nu, bygg chargeback-buffer istället)
2. **Om bygga:** opt-in per Företag eller obligatoriskt för alla?
3. **Cash-flow-fördröjning:** är 30-45 dagar acceptabelt för dina Underleverantörer? (Hemfrid är ~30 dagar, Vardagsfrid ~14 dagar)
4. **Moms-tolkning:** Scenario A (förmedlare, 12% provision) eller B (utförare, 88% inköp)? **Kräver jurist.**
5. **Chargeback-buffer 5%:** OK som alternativ till B2B-faktura? Reducerar Spick:s exponering utan cash-flow-impact för Underleverantörer.

**Per-jobb-spec (Del 2):**
6. **Bygga utvidgningen direkt?** (~1-2h, ingen risk)
7. **CSV-export:** OK med min föreslagna kolumn-uppsättning?
8. **Filter:** behov av datum-range-filter (förra månad, etc) eller bara nuvarande månad?

---

## 11. Rekommenderat svar-format

Skriv något i stil med:

> **Per-jobb-spec:** OK, bygg direkt (~1-2h). CSV-format OK. Datum-range-filter ja.
>
> **B2B-faktura:** Skippa nu, bygg chargeback-buffer istället per § 8.24-25. Behöver jurist-bedömning av moms-scenario A vs B innan vi rör B2B-faktura.

Eller justera fritt.

---

## 12. Verifiering rule #29 + #31

- ✅ vd-payment-summary EF läst (rad 1-193) — bekräftar att per-jobb-data finns på backend
- ✅ loadVdPaymentSummary frontend läst (rad 10839-10895) — bekräftar att bara aggregat renderas
- ✅ money.ts triggerStripeTransfer Alt A-fallback läst (rad 831-865) — bekräftar nuvarande direct-transfer-arkitektur
- ✅ Stripe Connect Express dokumentation: jag använder offentliga 2024-värden (1,4% + 1,80 kr Checkout, 0,25 USD/transfer) — verifiera mot din faktiska Stripe-faktura innan budget-beslut
- ⚠ Moms-tolkning av Scenario A vs B är min läsning, KRÄVER jurist-bedömning per rule #30
- ⚠ EU PWD 5-faktor-bedömning är min läsning, KRÄVER jurist-bedömning innan slutsats om B2B-faktura skyddar
