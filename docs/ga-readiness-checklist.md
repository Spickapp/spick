# GA-readiness Checklist (Fas 13 §13.9)

**Syfte:** Levande dokument som aggregerar status för GA-kandidatur. Uppdateras när §13-items levereras. Farhads sign-off per område krävs innan GA-lansering.

**GA-kandidat-datum (per arkitekturplan v3):** 1 november 2026
**Senast uppdaterad:** 2026-04-24
**Primärkälla för status:** `docs/v3-phase1-progress.md` + `docs/sanning/*.md` + `platform_settings`

---

## 1. GA-definition

Spick är GA-redo när:

1. Systemet har verifierat klarat 1000+ städare och 1500+ bokningar/månad i load-test
2. GDPR-rättigheter (export, radering, rättelse, begräsning) fungerar end-to-end utan manuell intervention
3. Ekonomisk lag (BokfL, momsredovisning, RUT-ansökan) är automatiserad eller tydligt manuell med audit-trail
4. Pentest utförd med zero critical/high-severity findings
5. Privacy policy + kundvillkor uppdaterade för EU Platform Work Directive (2 dec 2026-deadline)
6. Inga öppna kritiska buggar (P0/P1) i produktion
7. Farhad (som VD) har sign-off på alla §13-områden nedan

---

## 2. §13-uppgifter per primärkälla

Status-symboler: ✓ klart · ◑ pågår · ◯ ej påbörjat · ⊘ blockerad · ⚠ regulator-känslig (rule #30)

### §13.1 Load-test 1000+ samtidiga användare

| Aspekt | Status | Anteckning |
|---|---|---|
| Infra (k6) | ✓ | `tests/load/read-endpoints.k6.js` (Fas 12 §12.4) |
| 50 VUs read-path | ✓ | Verifierad i Fas 12 |
| 1000 VUs full-path | ◯ | Kräver separat test-env + Stripe-test-isolering |
| DB-query-tider vid 100k bookings | ◯ | Beror på §13.2 |
| EF response-tider | ◯ | Mätas i 1000-VU-körning |
| Stripe rate-limits | ⚠ | Se §13.3 |

**Blocker:** Behöver dedicerat test-Supabase-projekt så write-path kan testas utan prod-risk.

**Owner:** Farhad + Claude (infra-setup)

**Nästa steg:** Skapa test-projekt i Supabase. Skjuts post-GA om resurser kräver det, eller prioriteras pre-GA om skalnings-osäkerhet är för hög.

---

### §13.2 DB-index-audit — ✓ KLART (vid aktuell volym)

**Static audit:** [docs/audits/2026-04-24-db-indexes-static.md](audits/2026-04-24-db-indexes-static.md)
**Prod-verifierad 2026-04-24 (rule #31):** Row-counts + Gap #6 EXPLAIN-sample.

| Aspekt | Status |
|---|---|
| Critical-path-queries inventerade | ✓ 571 mappade |
| Indexes inventerade | ✓ 126 (explicit + PK/UNIQUE) |
| EXPLAIN mot prod | ✓ Sample verifierad. Data-volym 0-84 rader per tabell → Seq Scan är optimalt val. |
| Migrations behövs nu | ✗ **NEJ** vid aktuell volym. Index skulle göra queries långsammare. |
| Audit-script underhållbart | ✓ `scripts/audit-db-indexes.ts` regenererbar |
| Re-audit-trigger dokumenterad | ✓ [rapportens §0.1](audits/2026-04-24-db-indexes-static.md) |

**Re-audit-trigger:** När någon kritisk tabell når 1000+ rader (bookings) eller EXPLAIN visar > 100 ms. Övervakas via admin-morning-report + pg_stat_user_tables.

**Owner:** Claude (re-audit vid trigger) + Farhad (trigger-notifiering från morning-report)

---

### §13.3 Stripe rate-limit + retry/idempotency

**Static audit klar:** [docs/audits/2026-04-24-stripe-retry-audit.md](audits/2026-04-24-stripe-retry-audit.md)

| Aspekt | Status | Fynd |
|---|---|---|
| Centraliserad Stripe-helper | ◑ Fragmenterad | `_shared/stripe.ts::stripeRequest` finns men bara 2 EFs använder den (escrow-release + triggerStripeTransfer). 10+ EFs anropar raw fetch direkt. |
| Idempotency-keys på refunds | ✗ **HÅRDA GAPS** | 7 refund-sites utan idempotency-header: stripe-refund, booking-auto-timeout, auto-remind, booking-cancel-v2, booking-reassign, noshow-refund, stripe-webhook. Dubbel-refund-risk vid retry. |
| Idempotency på payment_intents | ✗ **HÅRDGAP** | `charge-subscription-booking` saknar. Dubbeldebitering-risk. |
| Retry-logik (429/5xx) | ✗ Saknas centralt | `stripeRequest` har ingen auto-retry. Application-level retry finns i 2 platser (charge-subscription + triggerStripeTransfer). |
| Rate-limit-instrumentation | ◯ Saknas | Vi vet inte hur nära Stripe-limits vi är. |
| Farhad-verify Stripe Dashboard rate-limits | ◯ | Rule #30 — kräver Farhads hand |

**Rekommenderade fixes (audit §6):**
- **R2** ✓ **KLART** Auto-retry i stripeRequest — exponential backoff 250/500/1000ms + Retry-After-header-support + network-error-retry. 12 nya tester.
- **R3** ✓ **KLART** Idempotency-keys per refund-site + PI-creation + capture. 9 fetch-calls fixade i 8 EFs: stripe-refund (`refund-${id}-admin`), booking-auto-timeout (`refund-${id}-auto-timeout`), auto-remind (`refund-${id}-auto-timeout-90`), booking-cancel-v2 (`refund-${id}-cancel-${pct}`), booking-reassign (`refund-${id}-reassign-reject`), noshow-refund (`refund-${id}-noshow`), stripe-webhook (`refund-${id}-double-booking` + `capture-${id}`), charge-subscription-booking (`pi-sub-${id}-attempt-${n}`). Rent additiv — 146/146 money-tests passerar, alla 8 TS-checks rena.
- **R1** ◯ Konsolidera alla Stripe-calls till stripeRequest (4-6h, rule #28) — post-GA.
- **R5** ✓ **KLART** Stripe-bekräftade gränser 2026-04-24: 100 ops/sec globalt, 15/sec payouts, 30/sec Connect. Räcker för 1000+ bokningar/månad. Vid 10k+/månad: kontakta Stripe 6v innan.

**Pre-GA §13.3:** ✓ FULLT KLART (R2+R3+R5).

**Owner:** Claude (R1-R4 kod) + Farhad (R5 Dashboard)

---

### §13.4 GDPR-audit

**Static audit klar:** [docs/audits/2026-04-24-gdpr-static-audit.md](audits/2026-04-24-gdpr-static-audit.md)

| Rättighet (policy §7) | Städare | Kund | Kommentar |
|---|---|---|---|
| 7.1 Tillgång | ✓ EF+UI | ✗ **GAP** | Customer-export-EF saknas |
| 7.2 Rättelse | ✓ Self-service | ◑ Delvis | Historiska bokningar immutable |
| 7.3 Radering | ◯ Manuell | ✗ **GAP** | Delete-EF saknas helt |
| 7.4 Begränsning | ◯ | ◯ | Ej implementerat |
| 7.5 Dataportabilitet | ✓ JSON | ✗ **GAP** | Samma som 7.1 |
| 7.6 Invändning | ◯ | ◯ | Ej implementerat |
| 7.7 Återkalla samtycke | ◑ Delvis | ◑ Delvis | Cookie-banner + auto-delegation opt-out |

**Retention-policy:** ◯ ej dokumenterad (rapport §3).
**Sub-processors i policy:** ✗ 5 saknade (Stripe/Resend/GA4/Clarity/Nominatim) — rapport §4.

**Prioriterade åtgärder:**
- **A1** ✓ KLART (export-customer-data EF + browser-verifierad) — `supabase/functions/export-customer-data/index.ts`
- **A2** ✓ KLART (mitt-konto-UI + JS-funktion + knapp renderad + funktion registrerad) — `mitt-konto.html:324-335, 1175-1225`
- **A3** ✓ KLART (policy-konsolidering) — `pages/integritetspolicy.html` är nu redirect till `/integritetspolicy.html` (rot-version). SSOT uppfyllt.
- **B1-B4** (jurist-beroende): retention-matris, sub-processor-DPA, delete-flow, audit-trail — pending Farhads jurist-möte
- **C1** (Fas 7.5): 36 PNR-rader — blockad

**Regulator-flagg (⚠):** Slutbedömning av GDPR-compliance kräver jurist. Audit tolkar INTE artiklarna, bara verifierar gap mot egen policy.

**Owner:** Claude (A1-A3) + Farhad + jurist (B1-B4, C1)

---

### §13.5 RUT-deklaration-automation ⊘

**Blockad av:** Fas 7.5 (RUT-infrastruktur)

**Status:** `SKV_API_KEY` tom, `rut-claim` EF undeployad, all RUT-automation avstängd per `docs/sanning/rut.md`.

**Owner:** Farhad (Skatteverket-kontakt + jurist) + Claude (implementation)

**Nästa steg:** Genomför Fas 7.5 (25-35h). Kan GA kräva detta? **Beslut behövs:** kan Spick lansera utan RUT och aktivera det som v1.1-feature? Eller är RUT GA-blocker?

---

### §13.6 Moms-rapport-automation ⚠

**Regulator-flagg:** BokfL (Bokföringslagen) + skattelag. Rule #30.

| Aspekt | Status | Anteckning |
|---|---|---|
| Månatlig moms-summa per företag | ◯ | Ingen EF byggd |
| SIE-export | ◯ | Fas 9 §9.7 markerat "BokfL-blocked" |
| Kvitto-generering | ✓ | `generate-receipt` EF finns |
| Sekventiell fakturanr | ✓ | Receipt-number-seq migration (§2.5-R2) |

**Owner:** Farhad (revisor-kontakt) + Claude (EF-implementation)

**Nästa steg:** Farhad verifierar SIE-format-krav med revisor. Claude bygger EF efter spec.

---

### §13.7 Pentest (extern)

| Aspekt | Status | Anteckning |
|---|---|---|
| OWASP Top 10-scan | ◯ | Kräver extern auditor |
| RLS-policy-audit | ◑ | Automatiserad CI-lint fångar nya USING(true) (§12.5) |
| Auth-bypass-test | ◯ | Kräver external pentester |
| DOS-skydd | ◯ | Rate-limiting via `check_rate_limit` RPC (CLAUDE.md) — räcker det? |

**Owner:** Farhad (auditor-urval + kontrakt)

**Nästa steg:** Identifiera 2-3 pentester-kandidater (OWASP-certifierade). Boka in 1-2 veckor före GA.

---

### §13.8 Privacy policy + kundvillkor (EU Platform Work Directive)

**Deadline:** 2 december 2026 (EU PWD)

| Aspekt | Status | Anteckning |
|---|---|---|
| Privacy policy-sida | ✓ | Finns (integritet.html) — ej verifierad för PWD 2 dec-krav |
| Kundvillkor | ✓ | Finns (kundvillkor.html) |
| Städar-avtal | ✓ | Finns (uppdragsavtal.html) |
| Dispute-hantering dokumenterad | ✓ | garanti.html + nojdhetsgaranti.html uppdaterade (§8.21) |
| Algoritm-transparens (PWD-krav) | ◯ | Matchning använder `providers`-algoritm (platform_settings). Behöver förklaring i villkor. |
| Omprövning-rätt (PWD-krav) | ◯ | Ingen formell omprövningsprocess för cleaner-beslut |

**Regulator-flagg (⚠):** PWD-tolkningar kräver jurist. Rule #30.

**Owner:** Farhad + jurist

**Nästa steg:** Farhad bokar jurist-möte för PWD-review av text.

---

### §13.9 GA-checklista signoff ← Detta dokument

| Aspekt | Status |
|---|---|
| Checklist dokumenterad | ✓ (denna fil) |
| Levande status-tracking | ◑ (uppdateras vid §13.x-leveranser) |
| Farhad sign-off per område | ◯ (pending §13.1-§13.8) |
| GA-launch-plan (go/no-go-beslut) | ◯ (senaste 2 veckor före GA) |

---

## 3. Externa beroenden (Farhads hand)

| Item | Ägare | Status | Risk vid GA |
|---|---|---|---|
| Supabase dispute-evidence storage-bucket | Farhad | ◯ (Dashboard-setup, 5 min) | Fas 8 §8.13 blockad |
| ADMIN_ALERT_WEBHOOK_URL (Slack/Discord) | Farhad | ◯ (Supabase Secrets) | Console-fallback räcker för GA, ej ideal |
| Skatteverket-API-spec 2026 review | Farhad | ◯ | §13.5 blockad |
| Revisor-möte (SIE + moms) | Farhad | ◯ | §13.6 blockad |
| Jurist-möte (GDPR + PWD + RUT) | Farhad | ◯ | §13.4 + §13.8 + §7.5 blockade |
| Pentester-kontrakt | Farhad | ◯ | §13.7 blockad |
| Ansvarsförsäkrings-dokumentation | Farhad | ◯ | §8.25 |
| Grafana-dashboard-setup | Farhad | ◯ | §10.3 blockad (observability inte GA-blockerande) |
| Uptime-monitor-provider (t.ex. Better Uptime) | Farhad | ◯ | §10.4 blockad (ej GA-blockerande) |

---

## 4. Risk-matrix: lansera utan vilka §13-items?

| Item | GA-blocker? | Orsak | Alternativ |
|---|---|---|---|
| §13.1 1000 VUs load-test | Mjuk | Ovisshet om skalning | Starta med soft-launch (begränsat antal kunder) |
| §13.2 DB-index-audit | Hård | Risk för prod-incidenter vid tillväxt | Static audit minst |
| §13.3 Stripe rate-limits | Mjuk | Idempotency skyddar mot double-charge | Farhad verifierar Stripe Dashboard-limits |
| §13.4 GDPR-audit | Hård | Regulator-risk (sanktionsavgifter) | Soft-launch kräver minst Art 15 + 17 end-to-end |
| §13.5 RUT-automation | Hård för marknadslöfte | Spick säljer "RUT-städning". Utan automation = manuell RUT = inte marknadsledande. | Lansera utan RUT som v1, fokusera på företag utan RUT-behov |
| §13.6 Moms-automation | Hård | BokfL-krav | Kan hanteras manuellt första 3 månader med audit-trail |
| §13.7 Pentest | Hård | Säkerhet | Ej förhandlingsbart |
| §13.8 EU PWD | Hård | Deadline 2 dec 2026 | Ej förhandlingsbart |

---

## 5. Sign-off-blockerare (innan GA)

**Hård blockers (måste fixas):**

- [ ] §13.7 Pentest: zero critical/high findings
- [ ] §13.8 EU PWD-text verifierad av jurist
- [ ] §13.4 GDPR Art 15 + Art 17 end-to-end fungerar
- [ ] Farhad (VD) sign-off per §13-område
- [ ] §13.2 DB-index-audit static eller full
- [ ] §13.6 Moms-process dokumenterad (manuell eller automatisk)

**Mjuka (kan GA utan, följer post-launch):**

- [ ] §13.1 1000 VUs load-test (soft-launch strategi räcker)
- [ ] §13.3 Stripe rate-limit-verifiering (idempotency skyddar)
- [ ] §13.5 RUT-automation (produktlöfte kan justeras)
- [ ] §10.3-§10.6 Observability-extern (console-fallback räcker för GA)

---

## 6. Nästa leverans-milstolpe

**Rekommenderad:** Static §13.2 DB-index-audit (3-4h). Ger konkret rapport som identifierar query-plan-risker utan krav på test-env. Rule #30 + #27 kompatibel.

**Alternativ:** §13.4 GDPR-audit (verifiering + test av Art 15/20-flows). Konkret leverans men regulator-gränsfall — kräver Farhads jurist-input för slutversion.

**Farhads hand:** Schedulera jurist-möte för §13.4 + §13.8 + Fas 7.5 i en session (~2h möte).

---

## 7. Ändringslogg

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-24 | Initial checklista skapad efter Fas 12-stängning | Claude + Farhad |
