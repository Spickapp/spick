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

### §13.2 DB-index-audit

| Aspekt | Status | Anteckning |
|---|---|---|
| Critical-path-queries inventerade | ✓ | 571 query-patterns mappade, rapport: `docs/audits/2026-04-24-db-indexes-static.md` |
| EXPLAIN ANALYZE mot 100k-data | ◯ | Kräver testmiljö eller prod-seed |
| Indexes review | ✓ | 126 indexes identifierade (explicit CREATE INDEX + PK/UNIQUE). Gap-analys + oanvända-kandidater flaggade. |
| Materialized views för stats | ◯ | `public_stats` view finns (CLAUDE.md), oklart om materialized |
| Audit-script underhållbart | ✓ | `scripts/audit-db-indexes.ts` (regenererbar) |

**Topp-gaps (static):** platform_settings.key (18 queries), bookings.booking_date (14), customer_profiles.email (8), cleaners.auth_user_id (8), admin_users.email (7), cleaners.is_company_owner (7). Dessa kan ha indexes i prod som inte är i migrations-filer — rule #31 verify mot prod innan migration skrivs.

**Owner:** Claude (script + static-rapport ✓) + Farhad (prod-EXPLAIN-beslut)

**Nästa steg:** Farhad kör `EXPLAIN ANALYZE` för top-10 gap-queries i Studio. Beroende på query-plan: migration för saknade indexes. Detta blir §13.2-slutfas.

---

### §13.3 Stripe rate-limit-verifiering

| Aspekt | Status | Anteckning |
|---|---|---|
| Dokumenterade rate-limits | ◯ | Stripe prod-mode: 100 read + 100 write req/s per account |
| Retry-logik med backoff | ◯ | Behöver verifiera att alla Stripe-calls har exponential backoff |
| Idempotency-keys överallt | ✓ | Verifierat för `booking-create` (Idempotency-Key). `stripe-webhook` använder `processed_webhook_events`-tabell. |
| Webhook buffering vid peak | ◯ | Outbox-pattern ej implementerat |

**Regulator-flagg (⚠):** Stripe-regler + API-spec får inte gissas (rule #30). Verifiera mot Stripe docs + eventuell support-kontakt.

**Owner:** Farhad (Stripe-konto-ägare) + Claude (kod-review)

**Nästa steg:** Claude auditerar retry-logik i alla Stripe-calls. Farhad verifierar rate-limits i Stripe Dashboard.

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
