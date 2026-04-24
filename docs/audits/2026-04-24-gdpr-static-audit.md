# GDPR Static Audit (Fas 13 §13.4)

**Genererad:** 2026-04-24
**Metod:** Static code + dokumentation-audit. Verifierar om nuvarande implementation täcker rättigheter som utlovas i `integritetspolicy.html` §7.
**Begränsningar:**
- Denna rapport TOLKAR INTE GDPR-artiklar (rule #30). Jurist krävs för slutbedömning av compliance.
- Rapporten verifierar **endast** gap mellan vår egen policy-utfästelse och faktisk implementation.
- Runtime-verifiering (faktiskt exekvera export-flow) inte utförd här.

**Primärkällor:**
- Policy: [integritetspolicy.html](../../integritetspolicy.html) §7 "Dina rättigheter"
- Implementation: `supabase/functions/export-cleaner-data/`
- UI: `stadare-dashboard.html:1254-1258`
- Sanningsfil: [docs/sanning/pnr-och-gdpr.md](../sanning/pnr-och-gdpr.md)

---

## 1. Policy-utfästelser per `integritetspolicy.html` §7

Vår policy lovar kunder/städare följande rättigheter — svar inom 30 dagar, kontakt via hello@spick.se:

| # | Rättighet | Policy-text |
|---|---|---|
| 7.1 | Tillgång | "få veta vilka uppgifter vi behandlar och få en kopia" |
| 7.2 | Rättelse | "få felaktiga uppgifter korrigerade" |
| 7.3 | Radering | "'rätten att bli bortglömd' — gäller ej lagstadgade uppgifter" |
| 7.4 | Begränsning | "begränsa behandlingen tillfälligt" |
| 7.5 | Dataportabilitet | "få ut uppgifter i maskinläsbart format" |
| 7.6 | Invändning | "invända mot behandling baserad på berättigat intresse" |
| 7.7 | Återkalla samtycke | "t.ex. avregistrera från nyhetsbrev" |

## 2. Implementation-status per rättighet och målgrupp

### 2.1 Städare (cleaner)

| Rättighet | Status | Evidence | Kommentar |
|---|---|---|---|
| 7.1 Tillgång | ✓ **Automatiserad** | `export-cleaner-data` EF + `stadare-dashboard.html:1254` UI-knapp | Returnerar JSON med 23 sektioner (profil, bokningar, ratings, disputes, payouts, etc.) |
| 7.2 Rättelse | ✓ **Self-service** | `stadare-dashboard.html` profil-redigering | Cleaner kan ändra profil, tjänster, priser, tillgänglighet direkt |
| 7.3 Radering | ◯ **Manuell** | Ingen EF, ingen UI | Måste göras via hello@spick.se. Retention-policy ej dokumenterad (se §3). |
| 7.4 Begränsning | ◯ **Ej implementerat** | — | Inget sätt att pausa data-behandling separat från konto |
| 7.5 Dataportabilitet | ✓ **Automatiserad** | Samma EF som 7.1 (JSON-format) | Täcker även Art 20 per EF-metadata |
| 7.6 Invändning | ◯ **Ej implementerat** | — | Inget sätt att opt-out av berättigat-intresse-behandling separat |
| 7.7 Återkalla samtycke | ◑ **Delvis** | cookie-banner + auto-delegation-opt-out | Auto-delegation har opt-out (policy §6.3). Nyhetsbrev-opt-out via email-link. |

### 2.2 Kund (customer)

| Rättighet | Status | Evidence | Kommentar |
|---|---|---|---|
| 7.1 Tillgång | ✗ **GAP** | Ingen customer-export-EF existerar | Policy lovar tillgång men ingen automatisering. 100% manuell via email. |
| 7.2 Rättelse | ◑ **Delvis** | `mitt-konto.html` kontaktinfo-redigering | Kund kan ändra namn/telefon/adress, men historiska bokningar immutable |
| 7.3 Radering | ✗ **GAP** | Ingen EF, ingen UI, ej dokumenterad flow | Samma som cleaner — måste via email |
| 7.4 Begränsning | ◯ **Ej implementerat** | — | Samma gap som cleaner |
| 7.5 Dataportabilitet | ✗ **GAP** | Ingen customer-export-EF existerar | Samma gap som 7.1 |
| 7.6 Invändning | ◯ **Ej implementerat** | — | Samma som cleaner |
| 7.7 Återkalla samtycke | ◑ **Delvis** | cookie-banner finns | Auto-delegation opt-out gäller för kund enligt policy §6.3 |

### 2.3 PNR-specifika datapunkter (särskild kategori)

Per [docs/sanning/pnr-och-gdpr.md](../sanning/pnr-och-gdpr.md):

- **36 rader** `customer_pnr` i prod (3 riktiga personer: clara, derin, zivar + testdata)
- **Stabiliserat:** ackumulation stoppad 2026-04-24 (PNR_FIELD_DISABLED)
- **Kvarstår:** 36 rader för GDPR-beslut. Mix av klartext (8) + krypterad (28) där nyckel är okänd.
- **Ingen radering-flow för PNR-rader specifikt.**

---

## 3. Retention-policy status

**Policy-utfästelse:** Ingen explicit retention-policy i `integritetspolicy.html`.

**Faktisk lagring (static observation):**

| Datatyp | Retention i prod | Åtgärd |
|---|---|---|
| `bookings` | Ingen TTL, ingen auto-purge | ◯ Dokumentera BokfL-retention (7 år för fakturerade transaktioner) |
| `ratings` | Ingen TTL | ◯ Dokumentera (kopplad till booking-retention) |
| `emails` | Ingen TTL | ⚠ Kan ackumulera — potentiellt PII-läcka över tid |
| `booking_events` | Ingen TTL | ◯ Audit-logg — troligen permanent retention per BokfL |
| `customer_pnr` | 36 rader, status "låsta för GDPR-beslut" | ⊘ Kräver jurist + Fas 7.5 |
| `customer_profiles` | Ingen TTL | ◯ Koppling till aktiva-konto-status ej dokumenterad |
| `processed_webhook_events` | Ingen TTL | ◯ Kan rensas efter 30 dagar (idempotency-fönster) |
| `booking_status_log` | Ingen TTL | ◯ Audit-logg — troligen BokfL-retention |

**Rekommendation:** Skriv explicit retention-policy per datatyp och länka från `integritetspolicy.html`.

---

## 4. Sub-processor-karta

**Policy-utfästelse (pages/integritetspolicy.html §4):** "Städaren du bokat (nödvändig kontaktinfo), Skatteverket (RUT-avdrag), Supabase (databas, GDPR-kompatibel)".

**Faktiska sub-processorer (från CLAUDE.md + infrastruktur):**

| Sub-processor | Roll | DPA-status | Nämnd i policy |
|---|---|---|---|
| **Supabase** (EU-region) | Databas + Auth + Edge Functions | ⚠ Verifiera DPA finns | ✓ |
| **Stripe** | Betalningar + Stripe Connect | ⚠ Verifiera DPA finns | ✗ **GAP** |
| **Resend** | Email-utskick | ⚠ Verifiera DPA finns | ✗ **GAP** |
| **Google Workspace** (hello@spick.se) | Email-mottagning | ⚠ Verifiera DPA finns | ✗ **GAP** |
| **GitHub Pages** | Statisk hosting | ⚠ Verifiera om applicable | ✗ **GAP** |
| **Google Analytics 4** | Analytics (cookie-samtycke) | ⚠ | ✓ (policy §8) |
| **Microsoft Clarity** | Session-recording (cookie-samtycke) | ⚠ | ✓ (policy §8) |
| **Meta Pixel** | Marknadsföring (cookie-samtycke) | ⚠ | ✓ (policy §8) |
| **46elks** (om aktiverat) | SMS | ⚠ | ✗ **GAP** (ej aktivt än) |
| **Skatteverket** | RUT-ansökan (AVSTÄNGD tills Fas 7.5) | N/A | ✓ |
| **Nominatim / OpenStreetMap** | Geocoding | — | ✗ **GAP** |

**Rekommendation:** Lista alla sub-processorer i policy §4 med roll + överföringsskydd. Rule #30: jurist verifierar DPA-status.

---

## 5. Hash-summerad GAP-lista

### Hårda gaps (policy-löfte utan implementation)

1. **Customer-export-EF saknas** — kunder kan inte utöva Tillgång (7.1) eller Dataportabilitet (7.5) utan email-ticket.
2. **Delete-flow saknas för både cleaner och customer** — manuell email-process med 30-dagars SLA, ingen audit-trail.
3. **Sub-processorer icke-fullständigt listade i policy** — Stripe/Resend/GA4-detaljer fragmenterade, kräver konsolidering.
4. **Retention-policy odokumenterad** — policy §10 (Barn) hänvisar till radering "omgående" men ingen generell retention-matris.

### Mjuka gaps (ej policy-löfte men förväntning)

1. **Begränsning (7.4) + Invändning (7.6) ej self-service** — email-process enda kanalen.
2. **PNR-rader (36 st) har ingen radering-flow** — blockerat av Fas 7.5-krypteringsbeslut.
3. **Duplicerad policy-fil** — `integritetspolicy.html` (rot) vs `pages/integritetspolicy.html` (äldre). Konsolidera till en.
4. **Audit-trail för manuella data-requests finns ej** — måste dokumenteras per IMY-krav vid incident.

---

## 6. Prioriterade åtgärder (jurist-input krävs för regulator-känsliga)

### Omedelbart (Claude-kan-göra, ingen regulator-gissning)

- **A1:** Bygg `export-customer-data` EF (spegla export-cleaner-data-strukturen). 2-3h.
- **A2:** Lägg UI-knapp i `mitt-konto.html` för "Ladda ner mina data (JSON)". 1h.
- **A3:** Konsolidera `pages/integritetspolicy.html` (äldre) — redirect till `integritetspolicy.html` (rot). 30 min.

### Kort sikt (kräver jurist-beslut — rule #30)

- **B1:** Skriv retention-policy-matris och länka från policy. Jurist + Farhad.
- **B2:** Uppdatera sub-processor-lista i policy §4 med alla 11 aktörer + DPA-status. Jurist.
- **B3:** Bygg `delete-account-request` EF — kund/städare → pending → admin-approval → cascade-delete (mjuk-delete med hard-delete-SLA). Jurist-input på BokfL-retention-undantag.
- **B4:** Dokumentera audit-trail för manuella data-requests (inkomst-log + handläggningstid).

### Fas 7.5-beroende

- **C1:** 36 PNR-rader — beslut per docs/sanning/pnr-och-gdpr.md (kräver jurist + Skatteverket-research).

---

## 7. Sign-off per GA-checklista §13.4

Status i [docs/ga-readiness-checklist.md](../ga-readiness-checklist.md) §13.4 uppdaterad med denna rapport som evidence.

**Claude-kan-göra utan jurist:** A1, A2, A3 (~4h)
**Jurist-beroende:** B1, B2, B3, B4 (kräver möte)
**Fas 7.5-beroende:** C1

---

## 8. Metod-verifiering

- Auditens omfång **tolkar inte GDPR-artiklar** (rule #30).
- Alla "gaps" är gap mot **vår egen policy-utfästelse**, inte mot en tolkning av GDPR-texten.
- Jurist krävs för slutbedömning om policy-löften motsvarar förordningens krav och om de åtgärder som listas räcker för GA.

---

## 9. Ändringslogg

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-24 | Initial audit efter §8.20 export-cleaner-data-leverans | Claude |
