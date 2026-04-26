# Chargeback-buffer 5% per transfer — designanalys

**Datum:** 2026-04-26
**Trigger:** Min rekommendation i `2026-04-26-b2b-faktura-vs-stripe-direct-analys.md` §7. Farhad-mandat: "kör enligt dina rekommendationer."

**KORRIGERING (rule #29-brott i tidigare doc):**
Jag refererade tidigare till "§8.24-25" som var fel — i `docs/planning/spick-arkitekturplan-v3.md` är §8.24 = "Interaktion med recurring" och §8.25 = "Ansvarsförsäkringsmäklare". Chargeback-buffer är en NY arkitektur som inte finns i v3-planen. **Förslag: ny §8.26 eller separat Fas 8.X — kräver Farhads beslut innan jag uppdaterar plan-dokumentet.**

---

## 1. Problemet (re-stated)

**Idag (verifierat 2026-04-26):**
- Kund betalar via Stripe Checkout → pengar i Spicks Stripe Balance
- Escrow-period 3-7 dagar → frigörs vid attest/auto-release
- `triggerStripeTransfer` flyttar 88% till företaget (Alt A B2B-fallback) eller cleaner direkt
- Kund kan göra **chargeback via banken upp till 180 dagar EFTER betalning**
- Vid chargeback: Spick får negativ Stripe-balance, måste claw-back från företaget (svårt)

**Risk-volym:**
- Industry-snitt: 0.5-1% av kortbetalningar leder till chargeback
- Med 1000 jobb à 800 kr/månad: ~5-10 chargebacks/månad à snitt 800 kr = 4 000-8 000 kr/månad i exponering
- Reell förlust om företaget vägrar claw-back: kanske 1-3 fall/månad = 800-2 400 kr/månad

---

## 2. Lösning: 5% reservation per transfer

**Konceptet:**
- Vid varje transfer till företag/cleaner: reservera 5% av cleaner-share i en intern buffer
- Faktisk transfer = cleaner-share × 0.95
- Buffer-belopp släpps tillbaka 180 dagar senare (chargeback-fönster passerat)
- Vid chargeback inom 180 dagar: dra från buffer först, eskalera till företag om otillräckligt

**Cash-flow-effekt för cleaner-owner:**
- Företag får 95% av sin betalning direkt, 5% holdback
- Efter 180 dagar: holdback frigörs
- Steady state efter 6 månader: företaget har en rullande "buffer" som täcker ~6 månaders vanlig volym × 5% — dvs samma 5% rullande, ingen kassaflödesförsämring efter ramp-up

**Spick-skydd:**
- 5% buffer täcker ~5% chargeback-rate (40-100x branschsnitt)
- Vid extrem chargeback-spike (kris hos en VD): Spick har likviditet att claw-back från
- Vid otillräckligt buffer: eskalera + claw-back-ENGAGEMANG via avtal

---

## 3. Schema (Etapp 1 — säker, ingen money-flow-impact)

**Ny tabell:** `chargeback_buffer`
```sql
CREATE TABLE public.chargeback_buffer (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  cleaner_id      uuid REFERENCES cleaners(id) ON DELETE CASCADE,
  -- En av dessa är satt (CHECK), inte båda
  balance_ore     bigint NOT NULL DEFAULT 0,
  total_reserved_lifetime_ore bigint NOT NULL DEFAULT 0,
  total_released_lifetime_ore bigint NOT NULL DEFAULT 0,
  total_consumed_lifetime_ore bigint NOT NULL DEFAULT 0,
  last_reserved_at timestamptz,
  last_released_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chargeback_buffer_owner_xor
    CHECK ((company_id IS NOT NULL) <> (cleaner_id IS NOT NULL)),
  CONSTRAINT chargeback_buffer_balance_nonneg
    CHECK (balance_ore >= 0)
);
```

**Ny tabell:** `chargeback_buffer_log` (audit-trail per transaktion)
```sql
CREATE TABLE public.chargeback_buffer_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buffer_id       uuid NOT NULL REFERENCES chargeback_buffer(id),
  booking_id      uuid REFERENCES bookings(id),
  chargeback_id   uuid,  -- FK till chargebacks-tabellen (skapas i Etapp 4)
  action          text NOT NULL,  -- 'reserve' | 'release' | 'consume_chargeback' | 'manual_adjust'
  amount_ore      bigint NOT NULL,  -- positiv för reserve, negativ för release/consume
  balance_before_ore bigint NOT NULL,
  balance_after_ore  bigint NOT NULL,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chargeback_buffer_log_action_check
    CHECK (action IN ('reserve', 'release', 'consume_chargeback', 'manual_adjust'))
);

CREATE INDEX idx_chargeback_buffer_log_buffer ON chargeback_buffer_log(buffer_id, created_at DESC);
CREATE INDEX idx_chargeback_buffer_log_booking ON chargeback_buffer_log(booking_id) WHERE booking_id IS NOT NULL;
```

**Ny platform_setting:**
```
chargeback_buffer_pct = 5             -- procent av cleaner-share som reserveras
chargeback_buffer_release_days = 180  -- dagar efter booking_date innan release
chargeback_buffer_enabled = false     -- soft-rollout-flagga (default OFF)
```

**RLS:**
```sql
ALTER TABLE chargeback_buffer ENABLE ROW LEVEL SECURITY;
ALTER TABLE chargeback_buffer_log ENABLE ROW LEVEL SECURITY;

-- VD ser sitt företags buffer
CREATE POLICY chargeback_buffer_vd_read ON chargeback_buffer FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM cleaners c WHERE c.auth_user_id = auth.uid() AND c.is_company_owner = true AND c.company_id = chargeback_buffer.company_id));

-- Cleaner ser eget buffer (om solo)
CREATE POLICY chargeback_buffer_cleaner_read ON chargeback_buffer FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM cleaners c WHERE c.auth_user_id = auth.uid() AND c.id = chargeback_buffer.cleaner_id));
```

---

## 4. Helper: `_shared/chargeback-buffer.ts`

**API:**
```typescript
// Reservera 5% innan transfer
async function reserveBufferForBooking(opts: {
  supabase: SupabaseClient,
  bookingId: string,
  companyId?: string,
  cleanerId?: string,
  cleanerShareOre: bigint,
}): Promise<{ reservedOre: bigint, transferOre: bigint, bufferLogId: string }>;

// Frigör buffer 180 dagar efter booking_date
async function releaseExpiredReservations(supabase: SupabaseClient): Promise<{ released: number, totalReleasedOre: bigint }>;

// Claw-back vid chargeback
async function consumeBufferForChargeback(opts: {
  supabase: SupabaseClient,
  chargebackId: string,
  bookingId: string,
  amountOre: bigint,
}): Promise<{ consumedOre: bigint, shortfallOre: bigint, escalateNeeded: boolean }>;

// Hämta buffer-status (VD-dashboard)
async function getBufferStatus(opts: {
  supabase: SupabaseClient,
  companyId?: string,
  cleanerId?: string,
}): Promise<{ balance_ore: bigint, total_reserved_ore: bigint, total_released_ore: bigint, total_consumed_ore: bigint, last_reserved_at: string | null }>;
```

---

## 5. Etapper (4 separata sprintar)

### Etapp 1 — Schema + helper (säker, ingen money-flow-impact) ~4-5h
- Migration: 2 tabeller + 3 platform_settings + RLS
- `_shared/chargeback-buffer.ts` med 4 funktioner (ovan)
- Tester (Deno-test)
- Flag-gated (`chargeback_buffer_enabled=false` default)
- **Status: kan deployeas idag utan effekt på prod-flow**

### Etapp 2 — Reservation vid transfer (kritisk) ~3-4h
- Modifiera `_shared/money.ts::triggerStripeTransfer`:
  - Före Stripe-transfer: anropa `reserveBufferForBooking`
  - Stripe-transfer-belopp = cleaner-share - reserved
  - Stripe-metadata utökas med `chargeback_buffer_reserved_ore`
  - `payout_audit_log.details` får `chargeback_buffer_reserved_ore`-flagg
- Tester (kritisk — money-flow)
- **Status: kräver Farhad-OK (ändrar pågående money-flow)**

### Etapp 3 — Auto-release-cron (180-dagars frigörelse) ~3-4h
- Ny EF `chargeback-buffer-release` (cron daglig)
- För varje reservation där `booking_date + 180 dagar < idag`:
  - Anropa `releaseExpiredReservations`
  - Buffer-saldo ökar (företag/cleaner har frigjort kapital)
  - Tilläggs-Stripe-transfer för att faktiskt skicka pengarna (eller VD kan välja "behåll i buffer")
- Workflow: `.github/workflows/chargeback-buffer-release.yml` (cron 0 4 * * *)
- **Status: kräver Etapp 2 + Farhad-OK**

### Etapp 4 — Chargeback-webhook-claw-back (Stripe + Klarna) ~3-4h
- Stripe-webhook handler `charge.dispute.created` event
- Tabell `chargebacks`:
  - id, booking_id, stripe_charge_id, amount_ore, status ('open', 'won', 'lost'), created_at, resolved_at, evidence_submitted
- Vid event: skapa chargeback-rad + anropa `consumeBufferForChargeback`
- Om shortfall: admin-alert + escalate till företag-claw-back
- VD-dashboard: chargeback-historik + buffer-status
- **Status: kräver Etapp 1-3 + Farhad-OK**

**Total: ~13-17h över 4 sprintar.**

---

## 6. Risk-flaggor (per #30)

### A. Chargeback-buffer som "låst kapital"
- **Risk:** Företag kan se 5% holdback som "Spick håller mina pengar"
- **Mitigering:** Tydlig kommunikation i VD-dashboard (visa både balans + release-datum + total reserverat hittills)
- **Avtal:** Klausul i underleverantörsavtalet § 4.X

### B. Konkurslagen 5 kap (om Spick går i konkurs)
- **Risk:** Buffer är Spicks tillgång på balansräkningen. Vid Spick-konkurs blir det oprioriterad fordran för företaget.
- **Mitigering:** Hantera buffer som "klientmedel" i bokföringen → separat kontoföring, ej Spicks egen tillgång
- **Kräver jurist-bedömning** (rule #30): kan bufferten klassas som klientmedel under PenningTjL?

### C. Bokföringslagen 5 kap 7 §
- **Risk:** Buffer-transaktioner måste bokföras med spår-konto (debit/kredit) per BokfL
- **Mitigering:** chargeback_buffer_log är audit-trail per transaktion, retention 7 år (matchar BokfL)
- **Kräver jurist-bedömning** (rule #30): är buffer-rörelser "transaktioner" i BokfL-mening?

### D. Avtalslagen 36 § jämkning
- **Risk:** "5% holdback i 180 dagar" kan ses som oskäligt om inte tydligt kommunicerat
- **Mitigering:** Explicit klausul i underleverantörsavtalet med specifika belopp + tidsangivelser

### E. Räntelagen 6 §
- **Risk:** Företag kan kräva ränta på holdback
- **Mitigering:** Klausul som specifikt undantar ränta på chargeback-buffer (B2B-avtal — jämförbart med factoring-praxis)

---

## 7. Edge cases

| Case | Hantering |
|---|---|
| Cleaner solo (ingen company_id) | Buffer per cleaner_id istället |
| Cleaner byter företag | Buffer stannar i ursprungs-företaget tills release |
| Företag stängs ner | Frigör buffer omedelbart till företagets bankkonto eller cleaner-individer |
| Chargeback efter buffer-release | Claw-back direkt från företag/cleaner (ingen buffer kvar) |
| Refund initierat av Spick (inte chargeback) | Buffer påverkas INTE — refund-amount dras från Spicks pengar (kommer från cleaner-share INNAN buffer-reservation) |
| Buffer > 100 000 kr (extremt företag) | Möjlighet för VD att begära partial-early-release |

---

## 8. Frågor till Farhad innan Etapp 2-4

1. **Etapp 1 OK att deploya idag?** (skema + helper, flag-gated, ingen risk)
2. **Etapp 2-4 OK att fortsätta efter Etapp 1?** (kräver klausul i underleverantörsavtalet + jurist-bedömning på 3 risk-flaggor)
3. **Buffer-procent:** 5% OK eller annan? (3% mer cleaner-vänligt, 7% säkrare för Spick)
4. **Release-period:** 180 dagar OK? (Stripe + Visa/MC chargeback-fönster)
5. **Klassning som "klientmedel" eller "Spicks medel"?** (jurist-bedömning av PenningTjL)
6. **Vid Spick-konkurs:** ska buffer vara skyddad för cleaner via separate-bank-account? (Banktekniskt + jurist)
7. **Update v3-arkitekturplan:** ska detta läggas till som §8.26 eller egen Fas 8.X-sub?

---

## 9. Min rekommendation

**Bygg Etapp 1 nu** (~4-5h, säker). Pausa Etapp 2-4 tills:
- Farhad-OK på 7 frågor ovan
- Jurist-bedömning av risk-flaggor B + C (klientmedel + BokfL)
- Ny § i underleverantörsavtalet (~1h tillägg till v0.3)

Etapp 1 ger:
- Schema + helper på plats
- VD-dashboard kan visa "Aktivera chargeback-buffer för ditt företag" (toggle, default OFF)
- Möjlighet för företag att opt-in INDIVIDUELLT (frivillig partner-skydd-feature)

Etapp 2-4 kräver:
- Ändring av core money-flow → kritisk, kräver Farhad-godkänd design + jurist-OK
- Stripe-webhook-utvidgning → måste samsa med befintlig stripe-webhook-EF
- Chargeback-händelse-respons → kan trigga support-ärenden, kräver runbook
