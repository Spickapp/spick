# RUT-infrastruktur — beslut och minifix

**Datum:** 2026-04-23
**Status:** Minifix verkställd. Full bygge skjuts till **Fas 7.5**.
**Beslutsfattare:** Farhad Haghighi (projektchef)
**Primärkälla:** Skatteverket (verifierat av Farhad 2026-04-23)

---

## TL;DR

RUT-ansökningsinfrastrukturen i prod är bruten på tre oberoende sätt (kolumnmismatch, fel XML-matematik, saknad timing-guard). Ingen kund har någonsin fyllt i personnummer i boka-flödet. `SKV_API_KEY` är registrerad som Supabase-secret men värdet är tomt (SHA256-digest `e3b0...b855` = hash av tom sträng), så ingen XML har någonsin gått till Skatteverket. **Noll ekonomisk exponering idag.**

Rut-claim-triggern i stripe-webhook skapar dock spökstate (`rut_claim_status='pending_api_key'`) i databasen per paid-bokning med `customer_pnr_hash` — varje sådan rad är skräpdata som förorenar framtida audits. Minifix stoppar skapandet. Full refaktor hanteras i ny Fas 7.5.

---

## Diagnostik-sammanfattning

Från §2.5a-0-diagnostik (2026-04-23):

### Punkt 1 — `SKV_API_KEY` tom

| | |
|---|---|
| Status i Supabase secrets | Registrerad |
| Digest | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Tolkning | SHA256 av tom sträng (`""`). Koden läser `Deno.env.get("SKV_API_KEY") ?? ""` → `""`. |
| Guard i [rut-claim:230](../../docs/archive/edge-functions/rut-claim/index.ts:230) | `if (!SKV_API_KEY) { ... return pending_api_key }` triggas alltid. |
| Konsekvens | **0 XML har någonsin skickats till Skatteverket.** |

### Punkt 2 — Kolumnmismatch

Prod-schema har båda `bookings.customer_pnr` (krypterat) och `bookings.customer_pnr_hash` (SHA256-hash). Stripe-webhook-triggern gatekeepar på `customer_pnr_hash IS NOT NULL`, men rut-claim-EF-en läser `customer_pnr` för XML-buildet. Boka.html skickar `customer_pnr: rawPnr` utan att sätta hash. Systemet är inkonsistent mellan callers.

Dessutom: [booking-create:313-314](../../supabase/functions/booking-create/index.ts:313) har villkorlig spread `...(customer_pnr_hash ? { customer_pnr_hash } : {})` — men boka.html skickar aldrig `customer_pnr_hash`. Fältet fylls därför aldrig. Gatekeeper-villkoret `if (isRut && booking.customer_pnr_hash)` i stripe-webhook är alltså **alltid false**.

### Punkt 3 — Fel XML-matematik

[rut-claim:26-28](../../docs/archive/edge-functions/rut-claim/index.ts:26):

```ts
const bruttoBelopp = Number(booking.total_price) * 2;   // kundpris * 2 = brutto (50% RUT)
const rutBelopp    = Math.floor(bruttoBelopp * 0.5);    // 50% RUT-avdrag
const arbetskostnad = Math.round(bruttoBelopp * 0.7);   // ~70% arbetskostnad av brutto
```

Tre fel:
1. `bruttoBelopp = total_price * 2` antar att total_price är **efter-RUT-belopp**. För RUT-bokningar stämmer det. För icke-RUT-bokningar (företag) skulle formeln ge dubbel fakturasumma — men gatekeepern filtrar bort dessa, så inte akut.
2. `arbetskostnad = brutto * 0.7` är **hårdkodat antagande** utan grund. Städtjänster har oftast 100% arbetskostnad (ingen material). Att deklarera 70% underrapporterar arbetskostnad → lägre RUT-avdrag än kunden har rätt till.
3. Ingen verifiering mot Skatteverkets 75 000 kr-tak per kund/år. Överskrider kunden sin RUT-potter blir ansökan avslagen — ingen förvarning i systemet.

### Punkt 4 — Saknad timing-guard

Triggern i [stripe-webhook:518-529](../../supabase/functions/stripe-webhook/index.ts:518) körs vid event `checkout.session.completed` (rad 883-884). Det är vid betalning, vilket kan vara dagar till veckor före utfört arbete.

**Ingen check** på:
- `booking.completed_at IS NOT NULL`
- `booking.checkout_time IS NOT NULL`
- `NOW() - booking.completed_at >= INTERVAL '24 hours'` (reklamationsfönster)

Skatteverkets regel: RUT-ansökan får bara göras för **utfört arbete**. Att ansöka vid betalning är regelöverträdelse om arbetet sedan inte utförs (no-show, avbokning, dispute).

### Punkt 5 — Spökkolumn `rut_application_status`

[booking-create:340](../../supabase/functions/booking-create/index.ts:340) skriver `rut_application_status: 'pending' | 'not_applicable'` vid skapande. Men rut-claim-EF skriver till `rut_claim_status`. Två olika kolumner, olika värde-set. Per Farhads verifiering: 33 rader i prod har `rut_application_status` satt; kolumnen nämns inte i `docs/4-PRODUKTIONSDATABAS.md` och läses aldrig av någon annan kod.

### Punkt 6 — Icke-applicerad migration

[migrations/drafts/20260325000003_rut_claims.sql](../../supabase/migrations/drafts/) innehåller `CREATE TABLE rut_claims`. Filen ligger i `drafts/`-mappen (aldrig körd av Supabase CLI). Rut-claim-EF försöker dock `insert` i tabellen ([rut-claim:272-279](../../docs/archive/edge-functions/rut-claim/index.ts:272)) med `.catch()` som tystar felet. Tabellen finns inte i prod. Varje körning loggar varning men fortsätter.

### Punkt 7 — PNR-fält aldrig fyllt i prod

Per Farhads verifiering: 0 historiska bokningar har `customer_pnr` eller `customer_pnr_hash` ifyllda. Alla 33 rader med `rut_application_status='pending'` är alltså **utan personnummer** — de var aldrig aktuella för ansökan ens om infrastrukturen varit hel.

---

## Beslutsmotivation — alternativ A/B/C/D

Efter Spår B-audit (2026-04-23) övervägdes fyra alternativ:

| Alt | Beskrivning | Tidsåtgång | Valt? |
|---|---|---|---|
| **A** | Full bygge nu (Fas 2.5, 25-35h) mellan Fas 2 och Fas 3 | 3-5 arbetsdagar | ❌ |
| **B** | Gradvis fix över 5-6 sub-commits under 2-3 veckor parallellt med Fas 3 | 2-3 veckor | ❌ |
| **C** | Feature-flagga rut-claim-triggern, lämna kod intakt, full fix vid Rafa-pilot-skalning | 1-2 timmar + framtida fullbygge | ❌ |
| **D** | Minifix: stäng av triggern + undeploy EF + arkivera kod, skjut full bygge till Fas 7.5 | **1-2 timmar** | ✅ |

**Varför D valdes:**

1. **Noll ekonomisk exponering idag** (punkt 1 + 7). Ingen brådska motiverar A eller B.
2. **Infrastrukturen behöver omdesign, inte patch**. Kolumnmismatch + fel matematik + timing-bug är tre oberoende problem som kräver samordnad refaktor. En punkt-för-punkt-fix riskerar att lämna fel kvar.
3. **Fas 3 matching-arbetet är oblockerat av RUT**. Ingen anledning att fördröja v3-disciplinen.
4. **Rafa-pilot oförändrad**. 14 cleaners × låg volym är identisk risk före och efter minifix (dvs. noll, givet tom API-nyckel).
5. **Feature-flagga (alt C) ger kod kvar i stripe-webhook som läsare av framtida sessions kan missförstå som aktiv**. Undeploy + arkivering gör avstängningen synlig i git-historik och repo-struktur.

---

## Vad som gjordes i minifix

### C0.5 — Deploy-workflow uppdaterad

[.github/workflows/deploy-edge-functions.yml](../../.github/workflows/deploy-edge-functions.yml):
- Rad 50 (`rut-claim`) borttagen från FUNCTIONS-array.
- Rad 22 räknare `32 Edge Functions` → `30 Edge Functions` (korrigerar tidigare off-by-one; arrayen har nu 30 faktiska funktioner).

### C1 — Trigger avaktiverad i stripe-webhook

[supabase/functions/stripe-webhook/index.ts:518-521](../../supabase/functions/stripe-webhook/index.ts:518): 12-raders `if (isRut && booking.customer_pnr_hash) { ... }`-block ersatt med 4-raders kommentar som pekar hit till audit-dokumentet.

### C2 — Edge Function arkiverad

`supabase/functions/rut-claim/` → [docs/archive/edge-functions/rut-claim/](../archive/edge-functions/rut-claim/). Koden bevaras oförändrad för Fas 7.5-referens. Ingen CLI-deploy-risk eftersom mappen ligger utanför `supabase/functions/`-trädet.

### C3 — Undeploy från prod

```powershell
npx supabase functions delete rut-claim --project-ref urjeijcncsyuletprydy
```

Verifierat via `supabase functions list` (0 `rut-claim`-träffar).

### C4 — Detta audit-dokument

Skapat som primärkälla för framtida Fas 7.5-session.

### C5 — Progress-fil uppdaterad

Hygien-tasks #17 + #18 öppnade. Session-lärdom #6 tillagd. Fas 7.5-sektion schemalagd.

### C6 — v3-plan uppdaterad

Ny Fas 7.5 "RUT-infrastruktur" insatt mellan Fas 7 och Fas 8. 6 sub-faser (§7.5.1-§7.5.6) skissade.

---

## Vad som skjuts till Fas 7.5

| Område | Komponent | Referens |
|---|---|---|
| Kolumn-konsolidering | Välj mellan `rut_claim_status` och `rut_application_status`, droppa duplikaten. Backfill 33 spökrader. | Punkt 5 ovan |
| Schema-migration | Bestäm fate för `migrations/drafts/20260325000003_rut_claims.sql` (applicera + använda ELLER radera). | Punkt 6 + hygien-task #18 |
| XML-matematik | Bygg om `buildRutXml` med korrekt arbetskostnads-antagande + 75 000 kr-takcheck per kund/år. | Punkt 3 |
| Timing-guard | Trigger endast efter `completed_at IS NOT NULL AND checkout_time IS NOT NULL AND NOW() - completed_at >= 24h`. | Punkt 4 |
| Ansökan-flow | Admin-godkänd kö första kvartalet (alt B från F2.5-2-rekommendation), hybrid-threshold senare baserat på data. | F2.5-2 |
| Kreditnota vid refund | `rut-reverse`-EF som återkallar ansökan hos Skatteverket + genererar kreditnota. | RUT-4, RUT-5 i Spår B |
| Fakturanr | Sekventiell serie via `generate_invoice_number()` i stället för UUID-prefix. | RUT-7 i Spår B |
| Moms-rad | Lägg till 0 %-moms-rad i faktura.html för RUT-tjänster. | RUT-6 i Spår B |
| Persistent faktura | `customer_invoices`-tabell med snapshot-data + immutable efter `issued_at`. | RUT-2 i Spår B |
| Material-spec | Fakturafält för arbete-vs-material-fördelning (flyttstäd, fönsterputs med specialprodukter). | RUT-8 i Spår B |
| Change-log | `customer_invoices.change_log` efter persistering. | RUT-9 i Spår B |
| 31 januari-vakt | `rut-deadline-check`-cron som flaggar december-bokningar utan ansökan senast 25 jan. | B5 i Spår B |

**Estimerad scope Fas 7.5: 25-35h** (matchar Spår B-estimat).

---

## Regel #31 (för memory)

**Verifiera schema före kod-antaganden.** Kod-grep visar vad koden försöker göra, inte om den faktiskt fungerar. DB-schema är primärkällan för om en kolumn/tabell/villkor existerar. Vid drift mellan grep och schema: schema vinner.

Bakgrund: §3.1-research antog att `customer_profiles.preferences` JSONB existerade (baserat på v3-text), men prod-schema visade att kolumnen inte fanns. Samma mönster upptäcktes i rut-claim-audit: kod läser `booking.customer_pnr_hash` men boka.html skickar aldrig hashen → gatekeepern false → hela flödet en no-op trots att koden ser korrekt ut vid grep.

---

## Handover till Fas 7.5-session

**Startpunkt:** Läs detta dokument + [docs/v3-phase1-progress.md](../v3-phase1-progress.md) Fas 7.5-sektion + [docs/planning/spick-arkitekturplan-v3.md](../planning/spick-arkitekturplan-v3.md) §7.5-blocket.

**Arkiverad kod:** [docs/archive/edge-functions/rut-claim/index.ts](../archive/edge-functions/rut-claim/index.ts) + drafts-migration.

**Blockerare att verifiera vid start:**
1. Är `SKV_API_KEY` fortfarande tom? (`npx supabase secrets list`)
2. Har antalet `rut_application_status='pending'`-spökrader vuxit sedan 2026-04-23? (Studio: `SELECT COUNT(*) FROM bookings WHERE rut_application_status = 'pending'`)
3. Finns nya caller-ställen för PNR-fältet i boka.html (utöver 19 kartlagda 2026-04-23)?

**Första-commit-förslag för Fas 7.5-session:** `§7.5.1 research (v3.md:rad): prod-state + Skatteverket-API-spec 2026`.

---

## Referenser

- Spår B-audit 2026-04-23: inline i chat-session (ej persisterat som fil)
- [docs/v3-phase1-progress.md](../v3-phase1-progress.md) — hygien-tasks #17 + #18, session-lärdom #6
- [docs/planning/spick-arkitekturplan-v3.md](../planning/spick-arkitekturplan-v3.md) — Fas 7.5-blocket
- Arkiv: [docs/archive/edge-functions/rut-claim/](../archive/edge-functions/rut-claim/)
- Prod-schema granskad: `prod-schema.sql` (gitignored, 2026-04-22-dump)

---

## Post-mortem: Sprint RUT.1-avvikelse 2026-04-23 (tillagt kväll 2026-04-23)

**Vad hände:** 23 apr förmiddag byggdes Sprint RUT.1 (commit `0b82f2d`) lokalt. Migrationsfil `20260423000001_rut_sprint_1_datamodell.sql` skapade 21 kolumner + 3 tabeller inklusive `customer_pnr_encrypted`, `customer_pnr_last4`, `rut_requested` m.fl. — exakt de kolumner denna audit-fil uttryckligen sa skulle vara "rört EJ tills Fas 7.5" (se scope-gränser i minifix-commit `d901cc1c`).

**Varför det är Regel #29-brott:**

1. **§7.5.1 research inte genomförd.** Denna audit föreskrev explicit att "första-commit-förslag för Fas 7.5-session" är `§7.5.1 research: prod-state + Skatteverket-API-spec 2026`. RUT.1 byggde datamodellen utan att API-specen verifierats.
2. **Scope-gränser överträdda.** Audit listade 4 områden att inte röra tills Fas 7.5: `customer_pnr`/`customer_pnr_hash`-kolumner, `rut_application_status`-spökkolumn, XML-matematik, PNR-flöde i boka.html. RUT.1 överlappade minst två av dessa.
3. **Tidsbudget inkonsistent.** Audit estimerade Fas 7.5 till 25-35h samordnad refaktor. RUT.1 byggdes på en dag — tempot matchar inte den föreskrivna omfattningen.
4. **Regel #30-brott.** Datamodellen gjordes på hypoteser om vad Skatteverket kräver (t.ex. vilka PNR-format, vilka statusvärden, vilken buffertlogik). Skatteverket-API-spec 2026 var aldrig verifierad som primärkälla.

**Åtgärd 2026-04-23 kväll:**

- **RUT.1-migrationsfil flyttad** från `supabase/migrations/20260423000001_rut_sprint_1_datamodell.sql` till `docs/archive/migrations/rut-sprint-1-deferred-to-fas-7-5.sql`. Skyddar mot accidental deploy, bevarar design som referens.
- **PROD vault-nyckel raderad manuellt** av Farhad: `RUT_PNR_ENCRYPTION_KEY` (UUID `86767fda-4dcf-44c6-8869-7e5b9a0145f1`) som skapades av misstag i PROD-vault när RUT.1 kördes i fel Studio. Verifierat att 0 PNR-rader krypterats med nyckeln (0 rader med `customer_pnr_encrypted IS NOT NULL`).
- **Progress-fil uppdaterad** med tidslinje och referens till denna post-mortem.

**Lärdom för Fas 7.5-sessionen:**

När Fas 7.5 startar (ej schemalagd än): börja med §7.5.1 research. Betrakta RUT.1-designen i arkivet som **ostestad hypotes**, inte som "huvud-start". Jämför varje kolumn, statusvärde och funktionsdefinition i arkivfilen mot Skatteverkets faktiska API-spec 2026 innan du använder något av det.

**Regel som skulle förhindrat detta:** Regel #29 i kombination med Regel #27 — Fas 7.5-arbete får aldrig startas på "RUT-audit 2026-04-23 säger vi ska bygga X" utan att audit-filen lästs i helhet. Research-steget §7.5.1 är inte en formalia — det är primärkällan som hela fasen bygger på.
