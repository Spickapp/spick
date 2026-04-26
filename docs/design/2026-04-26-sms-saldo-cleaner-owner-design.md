# SMS-saldo per Cleaner Owner — designanalys

**Datum:** 2026-04-26
**Trigger:** Farhad-mandate: VD/cleaner-owner ska betala 0,52 kr/SMS, sammanställas som saldo, dras vid utbetalning. Robust system med transparens.

---

## 1. Nuvarande state (audit-verifierat)

| Komponent | Status |
|---|---|
| `_shared/notifications.ts::sendSms()` | Central SMS-sender via 46elks-API |
| `team-sms-notify` EF | Cron-baserad, skickar SMS till team + VD-sammanfattning |
| `sms` EF | Separat SMS-EF (troligen för annan trigger) |
| **SMS-loggning per skickat meddelande** | ❌ INTE existerande |
| **Saldo per cleaner-owner** | ❌ INTE existerande |
| **Avdrag mot utbetalning** | ❌ INTE existerande |

→ **Idag står Spick för 100 % av SMS-kostnaden.** Kostnad ≈ 0,5 kr/SMS via 46elks → vid 1000 SMS/månad = 500 kr/månad i ren förlust.

---

## 2. Föreslagen modell (5 lager)

### Lager 1 — Schema

**Ny tabell:** `sms_log`
```
- id UUID
- company_id UUID FK companies(id)
- triggered_by_cleaner_id UUID FK cleaners(id)  -- vem orsakade SMS
- recipient_phone TEXT (sista 4 siffror för audit, hela för debugging-period)
- message_excerpt TEXT (första 50 tecken, ej PII)
- segment_count INT (1, 2, 3 — beror på meddelande-längd, 160-tecken-segment)
- price_per_segment_ore INT (default från platform_settings)
- total_charge_ore INT (segment_count × price_per_segment_ore)
- sms_provider TEXT ('46elks')
- provider_message_id TEXT
- sent_at TIMESTAMPTZ
- billing_period TEXT (YYYY-MM)
- billing_status TEXT ('pending', 'invoiced', 'paid', 'waived')
```

**Ny tabell:** `company_sms_balance` (running balance per company)
```
- id UUID
- company_id UUID UNIQUE FK companies(id)
- balance_ore INT (negativ = skuld till Spick)
- last_updated_at TIMESTAMPTZ
- last_invoice_at TIMESTAMPTZ
```

**Ny platform_setting:**
```
sms_price_per_segment_ore = 52  -- 0,52 kr/SMS, ändras vid omförhandling med 46elks
sms_billing_enabled = false      -- soft-rollout-flagga (default OFF)
```

### Lager 2 — sendSms-wrapper

Utöka `_shared/notifications.ts::sendSms()` så **varje SMS loggas och debiteras**:

```typescript
async function sendSmsWithBilling(opts: {
  to: string,
  message: string,
  triggered_by_cleaner_id: string,  // VEM utlöste SMS:et
  company_id: string | null,         // null = Spick-system-SMS (ej debiteras)
}) {
  const segmentCount = calcSegments(opts.message);  // 1 segment = 160 tecken
  const pricePerSeg = await getPlatformSetting('sms_price_per_segment_ore');
  const totalCharge = segmentCount * pricePerSeg;

  // 1. Skicka SMS via 46elks
  const result = await sendViaProvider(opts.to, opts.message);
  if (!result.success) return result;

  // 2. Logga + debitera om billing_enabled
  if (await isBillingEnabled() && opts.company_id) {
    await sb.from('sms_log').insert({
      company_id: opts.company_id,
      triggered_by_cleaner_id: opts.triggered_by_cleaner_id,
      segment_count: segmentCount,
      price_per_segment_ore: pricePerSeg,
      total_charge_ore: totalCharge,
      // ...
    });

    // 3. Uppdatera running balance
    await sb.rpc('decrement_company_sms_balance', {
      p_company_id: opts.company_id,
      p_amount_ore: totalCharge,
    });
  }

  return result;
}
```

### Lager 3 — Avdrag vid utbetalning

I `_shared/money.ts::triggerStripeTransfer()` (Alt A B2B-fallback från idag):
- INNAN Stripe-transfer: läs `company_sms_balance.balance_ore`
- Om negativ saldo (skuld) → reducera transfer-amount med skulden
- Logga reduktionen i `payout_audit_log`
- Återställ `company_sms_balance.balance_ore = 0` (skulden är betald)

```typescript
// Pseudokod inuti triggerStripeTransfer:
const smsDebt = await getCompanySmsDebt(companyId);
const adjustedAmount = payout.cleaner_payout_sek - (smsDebt / 100);

const stripeParams = {
  amount: String(adjustedAmount * 100),
  // ...
  'metadata[sms_debt_deducted_ore]': String(smsDebt),
};

if (smsDebt > 0) {
  await resetCompanySmsBalance(companyId);
  await logSmsDebtSettlement(companyId, smsDebt, transferId);
}
```

### Lager 4 — VD-dashboard-vy

I stadare-dashboard.html (ny sektion i Inkomst-tab efter VD-payment-summary, denna session):

```
┌─ SMS-saldo (denna månad) ────────────────────────────┐
│  Antal SMS skickade:         142                      │
│  Pris per SMS:               0,52 kr                  │
│  Total kostnad:              73,84 kr                 │
│  Saldo (skuld till Spick):  -73,84 kr                 │
│                                                       │
│  Per cleaner:                                         │
│    Dildora:    34 SMS    17,68 kr                    │
│    Nilufar:    52 SMS    27,04 kr                    │
│    Nasiba:     31 SMS    16,12 kr                    │
│    Odilov:     25 SMS    13,00 kr                    │
│                                                       │
│  ⚠ Skuld dras automatiskt vid nästa utbetalning      │
│  📋 [Ladda ner SMS-historik CSV]                     │
└──────────────────────────────────────────────────────┘
```

### Lager 5 — Villkor-tillägg

I `underleverantörsavtal-draft.md` v0.3 ny §:

```
§4.8 SMS-kostnad
Underleverantören (VD/cleaner-owner) accepterar att Spick debiterar
0,52 kr per SMS-segment (160 tecken) som skickas via plattformen från
Underleverantörens team. Pris kan justeras med 30 dagars varsel.

Skuld debiteras automatiskt mot kommande Stripe-utbetalning.

Vid uppsägning: utestående SMS-skuld faktureras separat med 14 dagars
betalningsfrist.

Spick förbehåller sig rätten att pausa SMS-funktionen vid skuld
överstigande 1000 kr.
```

---

## 3. Implementations-sprintar (4 sprintar, ~25-30h)

### Sprint A — Schema + helper (3-4h)
- Migration: `sms_log` + `company_sms_balance` + 2 platform_settings
- Helper `_shared/sms-billing.ts` (calcSegments, getBalance, decrement, settle)
- Tester
- Flag-gated (`sms_billing_enabled=false` default)

### Sprint B — sendSms-wrapper-utvidgning (4-5h)
- `_shared/notifications.ts::sendSms()` utökas med billing-call
- ALLA EFs som anropar sendSms uppdateras med `company_id` + `triggered_by_cleaner_id`-params
- team-sms-notify uppdateras
- Migration: backfill `sms_log` med dummy-rader för historiska SMS (om historik behövs)

### Sprint C — Avdrag vid utbetalning (5-6h)
- `triggerStripeTransfer` utökas med SMS-skuld-avdrag
- `payout_audit_log.details` får ny field: `sms_debt_deducted_ore`
- Stripe-metadata utökad
- Tester (kritiskt — money-flow)

### Sprint D — VD-dashboard + villkor (6-8h)
- Frontend-sektion i stadare-dashboard.html (Inkomst-tab)
- CSV-export av sms_log
- Underleverantörsavtal v0.3 med ny §4.8
- Påminnelse-modal vid skuld > 500 kr

**Total:** ~22-27h.

---

## 4. Risk-flaggor (Per #30)

### A. Moms på SMS-fakturering
**Data (inte juridik):**
- 46elks fakturerar Spick exkl. moms (B2B)
- När Spick återfakturerar VD: är det momspliktig tjänst?
- 25% moms vanligen på elektroniska kommunikationstjänster

**Mitigering:**
- Sätt pris exkl. moms (52 öre exkl. → 65 öre inkl. moms) ELLER inkl. moms
- Tydligt i villkor + SMS-saldo-vyn
- Du som jurist väger om Spick måste fakturera med moms

### B. BokfL-spårbarhet
- Varje debiterad SMS ska kunna visas på faktura/utbetalningsspecifikation
- Spick måste spara `sms_log` 7 år (BokfL 7 kap 2 §)
- `payout_audit_log.details.sms_debt_deducted_ore` blir bokföringspligt

### C. Konkurrenslagen
- Om Spick har dominerande ställning (85%+ marknadsandel) kan SMS-fakturering vara missbruk
- Mitigering: tydlig prislista + ingen exklusivitet (VD kan SMS:a själv utanför plattform)

### D. Avtalslagen 36 § jämkning
- Om kostnaden växer plötsligt (t.ex. 5 kr/SMS) kan klausulen jämkas
- Mitigering: 30 dagars varsel innan prisändring

### E. Konsumenttjänstlagen — N/A
- Detta är B2B (Spick → cleaner-owner som näringsidkare)
- Inte konsumentlag

---

## 5. Edge cases att hantera

| Case | Hantering |
|---|---|
| SMS misslyckas (46elks-fel) | INTE debiteras (success-only-charge) |
| SMS-segment överskrider 160 tecken | Multi-segment (2 × 0,52 = 1,04 kr) |
| Cleaner är solo (ingen company) | Ingen company_id → debiteras inte (Spick står för) |
| VD slutar — utestående skuld | Faktureras separat 14 dagar (per villkor §4.8) |
| Stripe-transfer fail efter SMS-debt-reduction | Rollback skuld-avdrag |
| Skulden > utbetalning | Kommande utbetalningar reduceras tills skulden är 0 |
| Negative balance får inte gå under -10000 kr | Throttle/blockera SMS-funktionen |

---

## 6. Frågor till Farhad innan bygge

1. **Pris exkl. eller inkl. moms?** (52 öre exkl. = 65 öre inkl., klargör för VD)
2. **Sprint-ordning:** A→B→C→D eller annan?
3. **Bakåtkompatibilitet:** ska historiska SMS (innan billing aktiverat) faktureras retroaktivt? (Min rek: NEJ — start nytt)
4. **Threshold för auto-paus:** vid hur stor skuld pausas SMS-funktionen? (Förslag: -1000 kr)
5. **Notifikation till VD vid skuld > 500 kr:** SMS, email eller bara dashboard-notif?
6. **CSV-export-format:** vilken kolumn-uppsättning? (Förslag: datum, tid, mottagare-suffix, segments, pris, triggered-by-cleaner, body-utdrag)
7. **Konkurrens med 46elks-direkt-anrop:** ska Spick blockera VD från att skicka SMS via egen 46elks-account till samma kunder, eller acceptera den läckaget?

---

## 7. Min rekommendation

**Bygg Sprint A + B först (~7-9h)** så schema + loggning är på plats. Aktivera **inte** debitering än (sms_billing_enabled=false). Då har vi:
- Fullständig SMS-loggning (för analys + framtida fakturering)
- Verklig data om volym/kostnad efter 1-2 veckor
- Inget risk för buggad avdrag-logik mot riktiga pengar

Sen efter audit-period: bygg Sprint C + D (avdrag + UI + villkor).

Per #30: din jurist-bedömning av moms + BokfL-spårbarhet är obligatorisk innan Sprint C-aktivering.

---

## Säg en bokstav

- **A+B nu** — schema + loggning, ingen avdrag (säkrast, ~7-9h)
- **A+B+C+D** — komplett bygge i ordning (~22-27h)
- **Skissa mer** — utöka detta dokument med fler scenarier
- **Vänta** — diskutera först
- **Justera** — säg vad

Per #27: ingen bygge utan din OK på scope. Per #30: moms + BokfL är din jurist-bedömning.
