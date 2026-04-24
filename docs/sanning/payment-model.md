# Sanning: Betalningsmodell

**Senaste verifiering:** 2026-04-28 (farrehagge-session — Farhad låste modell efter legal-research-analys 2026-04-24)
**Status:** AFFÄRSBESLUT LÅST · JURIST-VERIFIERING PENDING (textformuleringar + adminavgift-belopp)
**Verifierad av:** Farhad + Claude, mot booking-create-kod (rad 451/454) + platform_settings + Fas 8 escrow-design
**Ändras genom:** commit som uppdaterar denna fil + jurist-beslut dokumenteras

---

## 1. Affärsbeslut (låst)

### 1.1 Spick = utförare (INTE förmedlare)
Spick AB är formell utförare enligt Lag (2009:194) § 8. Spick fakturerar kunden, ansöker om RUT i eget namn, signerar batch till SKV genom ombud (Farhad med personligt BankID), och bär regulator-ansvar gentemot SKV.

Städare är **underleverantörer** — F-skattade enskilda firmare ELLER anställda i F-skattade bolag (company owners). Teammedlemmar är anställda hos sin company owner, inte hos Spick (se `cleaners.company_role`).

### 1.2 Kund betalar EFTER RUT-avdrag vid bokning (fakturamodellen)
Standard enligt Lag (2009:194) — "fakturamodellen" sedan 1 juli 2009. Kunden betalar aldrig hela beloppet i förskott för RUT-berättigade tjänster.

| Bokning | Arbetskostnad brutto | RUT-avdrag 50% | Kundens betalning |
|---|---|---|---|
| 4h @ 400 kr/h | 1 600 kr | 800 kr | **800 kr** |
| 8h storstäd @ 450 kr/h | 3 600 kr | 1 800 kr | **1 800 kr** |
| 3h fönsterputs @ 500 kr/h | 1 500 kr | 750 kr | **750 kr** |

### 1.3 Ensteg-payout till städare (INTE tvåsteg)
Städaren får hela sin ersättning efter utfört arbete, oberoende av SKV-utfall. Betalningsfönster = Fas 8 escrow v2 (24-72h efter `completed_at` + attestering).

**Spick bär aldrig risk mot städare.** Stripe Connect transfer sker via auto-release efter escrow-fönstret, oavsett om RUT senare godkänns eller nekas av SKV.

### 1.4 Vid SKV-avslag — kund faktureras i efterhand
Om SKV nekar RUT-ansökan för en bokning fakturerar Spick kunden nekad del + eventuell adminavgift. Grund: avtalsklausul kunden accepterat vid bokning.

Branschparitet: Hemfrid, Vardagsfrid (+300 kr adminavgift), Städade Hem gör samma sak. Konsumenttjänstlag + avtalslag grund.

---

## 2. Primärkälla (single source of truth)

### 2.1 Kodreferenser

| Fil | Rad | Funktion |
|---|---|---|
| [booking-create/index.ts](../../supabase/functions/booking-create/index.ts) | 451 | `total_price = Math.round(netPrice)` — alltid efter-RUT |
| [booking-create/index.ts](../../supabase/functions/booking-create/index.ts) | 454 | `rut_amount = useRut ? Math.round(rutDeduction) : 0` — separat fält |
| [booking-create/index.ts](../../supabase/functions/booking-create/index.ts) | 437-439 | `escrowMode === 'escrow_v2' → initialEscrowState = 'pending_payment'` |
| [stripe-webhook/index.ts](../../supabase/functions/stripe-webhook/index.ts) | — | Escrow v2 auto-release efter attest-fönster |

### 2.2 platform_settings (aktuella + pending)

**Aktuella (LIVE):**
```sql
SELECT key, value FROM platform_settings WHERE key IN (
  'commission_standard',       -- 12 (flat)
  'escrow_mode',               -- 'escrow_v2'
  'matching_algorithm_version' -- 'providers'
);
```

**Pending (Fas 7.5 — läggs till efter jurist-beslut):**
```sql
-- Adminavgift vid SKV-avslag (värde låses av jurist — Vardagsfrid-referens: 300 kr)
INSERT INTO platform_settings (key, value) VALUES
  ('rut_denial_admin_fee_sek', '<pending>'),
  ('rut_denial_policy_version', 'v1');
```

### 2.3 Databas-kolumner (bekräftade existera)

| Tabell | Kolumn | Betydelse |
|---|---|---|
| `bookings` | `total_price` | Nettobelopp kund betalar (efter RUT) |
| `bookings` | `rut_amount` | RUT-avdragsbelopp för SKV-ansökan |
| `bookings` | `escrow_state` | Fas 8: pending_payment → held → released |
| `bookings` | `rut_application_status` | pending / submitted / approved / rejected |
| `bookings` | `payment_status` | pending / paid / refunded |
| `platform_settings` | `escrow_mode` | `escrow_v2` (LIVE) |

---

## 3. Flöde (konkret)

### 3.1 Normalflöde — SKV godkänner

```
Dag 0      Kund bokar 4h @ 400 kr/h = 1 600 kr brutto
           Stripe Checkout: 800 kr (efter RUT) → Spicks platform-konto
           bookings.total_price = 800
           bookings.rut_amount  = 800
           bookings.escrow_state = 'pending_payment'

Dag 0-N    Städare utför arbete
           checkin_time + completed_at sätts
           bookings.escrow_state = 'held'

Dag N+1-3  Escrow-fönster (24-72h, konfigurerbart)
           Ingen dispute → auto-release

Dag N+3    Stripe Connect transfer till city owner / enskild firma
           Beräkning: 1 600 × (1 - 0.12) = 1 408 kr (netto provision)
           MEN: kund har bara betalt 800 kr — resten (608 kr) finansieras av
           kommande SKV-utbetalning.
           bookings.escrow_state = 'released'

Dag N+30   Farhad signerar RUT-batch (BankID-sign)
           Spick → SKV: begär 800 kr RUT-utbetalning

Dag N+45-60  SKV utbetalar 800 kr till Spick
              bookings.rut_application_status = 'approved'
              Spick kassaflöde netto: +800 (kund) + 800 (SKV) − 1 408 (städare) = +192 kr
              (motsvarar 12% provision på 1 600 kr brutto, ingen annan marginal)
```

**OBS cash-flow-not:** Spick finansierar 608 kr per bokning tills SKV-utbetalning (30-60 dgr). Vid skalning behövs rörelsekapital. Flaggat för separat finansierings-diskussion.

### 3.2 Undantagsflöde — SKV nekar

```
Dag N+45   SKV-svar: rejected (fel PNR, överskridet 75k-tak, etc.)
           bookings.rut_application_status = 'rejected'

Dag N+45   rut-denial-invoice EF (pending bygge, Fas 7.5):
           - Skapa Stripe Invoice till kund: 800 kr + adminavgift (pending belopp)
           - Skicka kundmail med förklaring + länk
           - Admin-UI markerar för manuell verifiering innan utskick

Dag N+60   Kund betalar tilläggsfaktura
           Spick kassaflöde netto: matchar normalfall

Dag N+60+  Vid betalningsvägran:
           - Påminnelse (+60 kr avgift)
           - Inkasso (enligt inkassolag 1974:182)
           - ARN om kund invänder
```

### 3.3 Avbokning/refund (innan arbete)

Separat dispute-flöde via Fas 8 escrow — pengar i `pending_payment`-state kan refundas via stripe-refund EF. RUT-ansökan skapas aldrig. Ingen av dessa rutiner ändras av betalningsmodellen.

---

## 4. Juridisk grund (primärkällor)

### 4.1 Lagrum
- **Lag (2009:194)** — fakturamodellen, § 8 (ombud), § 9 (arbetskostnad separeras), § 13-14 (återbetalning vid felaktig ansökan), § 22 (kostnadsränta)
- **Inkomstskattelag (1999:1229)** — 67 kap. 11-19 §§
- **Konsumenttjänstlag (1985:716)** — 31 § (oskäliga villkor)
- **Avtalslag (1915:218)** — 36 § (jämkning)
- **Inkassolag (1974:182)** — krav vid eftersläpande betalning
- **Dataskyddslag (2018:218)** — 3 kap. 10 § (PNR-behandling)

### 4.2 Farhads juridiska bedömning pending (interna beslut, blockerande för Fas 7.5 full build)

Farhad är juristutbildad och gör interna bedömningar baserat på lagrum + primärkällor. Datapunkter sammanställt av Claude för hans granskning:

| # | Datapunkt för bedömning | Relevanta lagrum |
|---|---|---|
| **A3** | IMY-incidentrapport för 11 klartext-PNR (3 riktiga kunder) | GDPR Art 33 (72h-anmälan) · IMY-praxis |
| **A4** | Villkorstext "kund bär SKV-avslag-risk" | Konsumenttjänstlag 31 § (oskäliga villkor) · Avtalslag 36 § |
| **A5** | Adminavgift-belopp vid SKV-avslag (referens Vardagsfrid: 300 kr) | Inkassolag 1974:182 · proportionalitetsprincipen |
| **A7** | derin-dubbelroll (kund + avstängd cleaner) | GDPR Art 17 (radering) · BokfL 7 kap 2 § (retention) |
| **A8** | Member-BankID-samtyckestext (PWD-riskfri formulering) | EU PWD 2024/2831 Art 5 (anställningspresumtion) · Art 9 (algoritm-transparens) |
| **A10** | UA v2.0-format enskild firma (särskiljs från v1.0 företag) | Inkomstskattelag 67 kap · F-skattesystemet |
| **B1** | BankID-auth som GDPR-samtycke för PNR-lagring | GDPR Art 6.1.a + Dataskyddslag 3 kap 10 § |
| **C2** | PNR-retention (7 år BokfL vs GDPR-dataminimering) | BokfL 7 kap 2 § · GDPR Art 5.1.e |

Full datasammanställning: [docs/planning/fas-7-5-rut-legal-research-2026-04-24.md](../planning/fas-7-5-rut-legal-research-2026-04-24.md) — 427 rader med primärkällor.

---

## 5. Konkurrent-jämförelse (bekräftar branschparitet)

| Plattform | Kund betalar vid bokning | Ensteg/tvåsteg | Vid SKV-avslag | Adminavgift |
|---|---|---|---|---|
| Hemfrid | Efter-RUT | Ensteg | Kund | — |
| **Vardagsfrid** | Efter-RUT | Ensteg | Kund | **+300 kr** |
| Städade Hem | Efter-RUT | Ensteg | Kund | — |
| Hjälper.se | Efter-RUT (oklart) | Oklart | Oklart | — |
| **Spick (plan)** | **Efter-RUT** | **Ensteg** | **Kund** | **Pending Farhads bedömning (A5)** |

Källor: [legal-research §4.3 + §8](../planning/fas-7-5-rut-legal-research-2026-04-24.md).

**Slutsats:** Spicks modell matchar Vardagsfrid exakt. Ingen juridisk anomali — standardrisk.

---

## 6. Hårda låsningar (bryts ALDRIG utan Farhads uttryckliga samtycke)

1. **Kund betalar ALDRIG full brutto-summa i förskott** (förbud mot avvikelse från fakturamodellen)
2. **Städare bär ALDRIG SKV-avslagsrisk** (PWD-skydd + inkomstsäkring)
3. **Ingen tvåsteg-payout** (Spick håller ALDRIG städarens pengar >72h escrow-fönster)
4. **Spick är ALLTID utförare** (om detta ändras → hela modellen omstruktureras)
5. **Inga RUT-ansökningar utan Farhads BankID-sign** (SKV-ombudsansvar personligt)
6. **Ingen batch-SKV-submission utan Farhad-granskad XML-template** (rule #30 — Claude gissar aldrig regulator-innehåll, Farhad granskar mot SKV V6-spec)

---

## 7. Kodintegrationer

### 7.1 Redan LIVE (ingen förändring krävs)

| Komponent | Status | Funktion |
|---|---|---|
| `booking-create` | ✓ | `total_price` sparas som efter-RUT, `rut_amount` separat |
| Stripe Checkout | ✓ | Tar emot efter-RUT-belopp |
| `escrow v2` | ✓ | Håller pengar 24-72h för kvalitet/dispute |
| `stripe-webhook` auto-release | ✓ | Transfer till Stripe Connect efter attest |
| Fas 8 dispute-flöde | ✓ | Kvalitet/tvist, inte RUT-relaterat |

### 7.2 Ej byggt (Fas 7.5 scope — efter jurist)

| Komponent | Syfte | Estimat |
|---|---|---|
| `rut-denial-invoice` EF | SKV-avslag → kundfaktura via Stripe Invoice | 4-6h |
| Kund-mailtemplate "SKV nekade" | Transparens + betalningslänk | 1h |
| Admin-UI: denial-kö | Manuell verifiering innan kundfaktura | 3-4h |
| `villkor-privat.html` uppdatering | Klausul A4 (jurist-text) | 1h + jurist-review |
| `boka.html` RUT-checkbox text | Informerat samtycke vid bokning | 1h + jurist-review |
| `platform_settings.rut_denial_admin_fee_sek` | SSOT för adminavgift | <1h |
| Scheduled retry cron | Vid betalningsvägran — påminnelser | 2-3h |

**Summa:** 12-17h efter jurist-beslut. Del av Fas 7.5 resterande 20% scope.

---

## 8. Referenser

### 8.1 Sanning-filer (komplementära)
- [provision.md](provision.md) — 12% flat provision
- [rut.md](rut.md) — RUT-infrastruktur status + AVSTÄNGNING-state
- [pnr-och-gdpr.md](pnr-och-gdpr.md) — PNR-hantering + 36 rader i DB

### 8.2 Architecture-docs
- [dispute-escrow-system.md](../architecture/dispute-escrow-system.md) — Fas 8 escrow v2-design
- [money-layer.md](../architecture/money-layer.md) — central money-hantering

### 8.3 Planning
- [fas-7-5-rut-legal-research-2026-04-24.md](../planning/fas-7-5-rut-legal-research-2026-04-24.md) — jurist-underlag
- [todo-pnr-infrastructure-2026-04-23.md](../planning/todo-pnr-infrastructure-2026-04-23.md) — 4-stegs plan

### 8.4 Audits
- [2026-04-23-rut-infrastructure-decision.md](../audits/2026-04-23-rut-infrastructure-decision.md) — minifix-beslut

---

## 9. Regel-efterlevnad (#26-#31)

Denna fil har skapats enligt:

- **#26 (grep-före-edit):** Ingen befintlig fil ändrad. Ny fil skriven en gång. Inga str_replace-operationer.
- **#27 (scope-respekt):** Endast dokumentation av låsta beslut + pending jurist-frågor. Ingen kod ändrad, inga migrationer skapade, inga EFs byggda. Scope = sanning-fil.
- **#28 (SSOT):** Denna fil är den enda primärkällan för betalningsmodellen framöver. platform_settings-keys listade, kodreferenser till booking-create + stripe-webhook, ingen fragmentering.
- **#29 (audit-först):** Läst i sin helhet före skapande: fas-7-5-rut-legal-research-2026-04-24.md, 2026-04-23-rut-infrastructure-decision.md, todo-pnr-infrastructure-2026-04-23.md, provision.md, rut.md, pnr-och-gdpr.md.
- **#30 (regulator-gissning förbjuden):** Adminavgift-belopp, villkorstext, IMY-anmälan, DPIA, retention-period — alla markerade som "pending jurist" med explicit källhänvisning. Ingen konkret implementation av dessa föreslås.
- **#31 (primärkälla över memory):** Kodreferenser verifierade (booking-create:451/454 läst). platform_settings-keys listade som SQL-query att köra, inte som gissning. DB-kolumner bekräftade existera via migration-referenser.

---

## 10. MVP-status (2026-04-28, prod-verifierat)

Denna sanning-fil gäller framtida produktion. Idag är Spick i MVP-/pilot-fas. Nuläget:

### 10.1 Cleaner-flottan (prod-query 2026-04-28)

| Kategori | Antal | Not |
|---|---|---|
| Totalt cleaners i DB | 18 | |
| Markerade som testkonto | 1 (före denna session) + 2 (pending Fix 2) | 3 efter full rensning |
| Riktiga cleaners | 15 | Efter full rensning |
| **Jobb utförda totalt** | **0** | **Ingen har utfört ett enda jobb** |
| F-skatt verifierad | 1 (Farhad, Haghighi Consulting AB) | 14 pending verifiering |
| BankID-verifierad | 0 | Infrastruktur ej byggd |
| Underleverantörsavtal signerat | 0 | Infrastruktur ej aktiverad |

### 10.2 Companies (4 riktiga + 1 testkonto)

| Company | Org-nr | Onboarding | UA | DPA | Insurance | Stripe | employment_model |
|---|---|---|---|---|---|---|---|
| Haghighi Consulting AB | 559402-4522 | pending_stripe | ✗ | ✗ | ✗ | pending | employed |
| Solid Service Sverige AB | 559537-7523 | pending_stripe | ✗ | ✗ | ✗ | pending | employed |
| Rafa Allservice AB | 559499-3445 | pending_stripe | ✗ | ✗ | ✗ | pending | employed |
| GoClean Nordic AB | 559462-4115 | pending_stripe | ✗ | ✗ | ✗ | pending | employed |
| Test VD AB | 000000-0000 | complete | ✗ | ✗ | ✗ | complete | employed |

**Team-struktur (bekräftad):**
- 4 companies = 4 underleverantörer
- 3 solo-cleaners aktiva (Clara-Maria, Jelena, Maria) — alla onboarding, saknar F-skatt
- 2 avstängda (derin, Ahmad) — dataminimering pending (Fix 3)

### 10.3 Risk-kalibrering

Risken är **förebyggande**, inte retroaktiv:

- 0 jobb utförda → ingen SKV-exponering
- 0 RUT-ansökningar skickade → ingen skatteåterkrav-risk
- 0 kr verklig Stripe-volym → ingen ekonomisk exposure
- 0 arbetsgivaravgifts-skuld (inga utbetalningar till icke-F-skattade cleaners utförda)

**Blockerare att lösa innan Rafa-pilot aktiveras eller Fas 7.5 startar:**

1. F-skatt-verifiering för alla 4 companies (SKV öppna data via org_number)
2. UA v1.0 signerat av alla 4 owners (BankID-sign)
3. DPA signerat där relevant
4. Försäkring verifierad
5. 3 solo-cleaners: F-skatt-status avgjord (Clara-Maria, Jelena, Maria)
6. PNR-hantering för 11 klartext-rader (A3 Farhad-bedömning)
7. BankID-infrastruktur byggd (Steg 2-3 efter avtalsutkast)

### 10.4 Data-hygien-fixar aktuella (2026-04-28)

| Fix | Status | Syfte |
|---|---|---|
| Fix 1 (Farhad-konto) | ✅ KÖRT 2026-04-28 | Riktiga `farrehagge@gmail.com` är nu owner av Haghighi Consulting AB |
| Fix 2 (testkonton frikoppling) | ⏳ SQL levererad | Frikoppla `farrehagge+test7` + `farrehagge-test7` från Haghighi Consulting AB |
| Fix 3 (avstängda dataminimering) | ⏳ SQL levererad | Minimera derin + Ahmad (GDPR Art 5.1.c) |
| Test VD AB-markering | ⏳ Pending | Markera som testdata |

---

## 11. Ändringar av denna fil

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-28 | Fil skapad. Affärsbeslut låsta: Spick utförare, efter-RUT betalning, ensteg-payout, SKV-risk mot kund. | Farhad + Claude session |
| 2026-04-28 | MVP-status tillagd (sektion 10). "Pending jurist"-formuleringar omformulerade till "Farhads bedömning pending" efter omkalibrering (Farhad är jurist). Jurist-agenda-frågor utökade med A7/A8/A10 från team-struktur-research. | Farhad + Claude session |
