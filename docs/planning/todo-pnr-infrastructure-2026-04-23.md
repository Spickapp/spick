# TODO — PNR-infrastruktur: GDPR + Fas 7.5 pre-arbete

**Öppnat:** 2026-04-23 kväll (session-slut)
**Prio:** HÖG (men icke-akut — ingen ekonomisk exponering idag)
**Blockerar:** Fas 7.5-start, Rafa-pilot-skalning
**Primärkällor:** [docs/audits/2026-04-23-rut-infrastructure-decision.md](../audits/2026-04-23-rut-infrastructure-decision.md), [docs/sessions/SESSION-HANDOFF_2026-04-23-kvall.md](../sessions/SESSION-HANDOFF_2026-04-23-kvall.md)

## Upptäckt 2026-04-23 kväll

Under H2 RUT-formalisering (commit `a7bb559`) verifierades i PROD Studio:

- `bookings.customer_pnr` innehåller 36 rader (audit 21 apr sa 0)
- Kolumnen har tre samexisterande format:
  - 24 rader med 56 tecken (AES-krypterad?) — alla `farrehagge@gmail.com` testdata
  - 11 rader med 12 tecken (**klartext YYYYMMDDNNNN**) — inkluderar 3 riktiga kunder
  - 1 rad med 48 tecken (annan kryptering eller hash) — riktig kund (zivar.majid)
- `boka.html:584-586` aktivt PNR-fält med text: "🔒 Ditt personnummer krypteras och används endast för RUT-ansökan till Skatteverket."
- `boka.html:2975` skickar `customer_pnr: rawPnr` utan kryptering på klient eller server
- `boka.html:2941` kommentar: "SHA-256 används INTE längre — Skatteverket kräver riktigt personnummer."
- `SKV_API_KEY` är tom, rut-claim EF avstängd (sedan 21 apr) — **inga PNR skickas till Skatteverket**
- `rut_amount = total_price` för alla 36 rader (bugg i booking-create — RUT ska vara 50% av arbetskostnad, inte hela priset)

## Påverkade riktiga kunder (3 st)

- `claraml@hotmail.se`: 10 bokningar 3-11 apr (4 completed+paid, 6 avbokade). Blandat 12/56-tecken format.
- `derin.bahram@ivory.se`: 1 avbokad bokning 6 apr. 12-tecken klartext.
- `zivar.majid@outlook.com`: 1 avbokad bokning 20 apr. 48-tecken format.

Alla bokningar är Stripe-testmode (0 kr verkliga pengar). Ingen RUT-ansökan skickad. Men PNR i klartext existerar i DB i strid med utfästelsen i boka.html.

## Risker

| Risk | Nivå | Anledning |
|---|---|---|
| Aktiv insamling fortsätter | 🔴 | Varje ny RUT-bokning genererar ny klartext-PNR |
| GDPR-överträdelse | 🟡 | Art. 9 särskild kategori + falsk utfästelse. Volym 3 personer. Ej rapporterbar incident ännu men bör hanteras. |
| Ekonomisk | 🟢 | 0 kr exponering idag (testmode) |
| Förtroende | 🟡 | Kunder lämnade PNR i god tro på kryptering som inte finns |

## Åtgärder i prioritetsordning

### Åtgärd 1: Stoppa ackumulation (snabb)

Dölja PNR-fält + rätta text i boka.html. 5 min arbete, stoppar tillväxt av problemet.

**Två alternativ:**
- (a) `style="display:none"` på PNR-blocket + ta bort kryptering-text — minimal diff, enkel rollback
- (b) Borttagning av hela PNR-flödet inkl validering — större refaktor, kräver regression-test

Rekommendation: (a) som interim tills Fas 7.5 är klar. Vid Fas 7.5: restaurera fältet med ordentlig kryptering + tydlig text.

### Åtgärd 2: Hantera befintlig data (kräver GDPR-bedömning)

3 riktiga kunder har PNR-data i DB. Beslut krävs:

- **Radera:** Rensa `customer_pnr` för alla 36 rader? Eller bara riktiga kunder?
- **Anonymisera:** Ersätt med "REDACTED" men behåll audit-spår?
- **Kommunicera:** Informera de 3 kunderna? Om ja, vad säger vi?
- **Bokföra:** Behålla någon form av PNR-data för bokföringslag-krav? (BokfL 7 år)

Dessa frågor är **inte tekniska** — de är juridiska och kommunikativa. Kräver:
- Jurist-konsultation (1-2h)
- Formell GDPR-bedömning
- Kommunikations-utkast till berörda

### Åtgärd 3: Fixa `rut_amount`-bugg

`rut_amount = total_price` är matematiskt fel. RUT = 50% av arbetskostnad, inte hela priset. Ska fixas i booking-create EF **innan någon riktig Stripe-transaktion sker**.

### Åtgärd 4: Integrera in i Fas 7.5

Fas 7.5 (RUT-infrastruktur) måste omfatta:
- Korrekt kryptering av PNR (hela kolumnen, inte bara nya)
- Korrekt beräkning av RUT-belopp
- Ärlig text i boka.html om vad som händer med PNR
- Migration av befintliga 36 rader till ny struktur (eller radering om GDPR-beslut så säger)

## Beslut att ta innan start av åtgärder

1. Åtgärd 1 (dölja fält): (a) CSS-dölj eller (b) full borttagning?
2. Åtgärd 2 (befintlig data): vilken GDPR-hantering? Jurist-konsultation först?
3. Åtgärd 3: ta in i Fas 7.5 eller göra punktfix tidigare?
4. Åtgärd 4: Fas 7.5-schemaläggning — när?

## Nästa session — första steg

1. Läs denna fil
2. Läs [docs/audits/2026-04-23-rut-infrastructure-decision.md](../audits/2026-04-23-rut-infrastructure-decision.md) post-mortem
3. Beslut om Åtgärd 1 (snabb-fix idag eller ej)
4. Plan för Åtgärd 2-4 (Fas 7.5-start eller separat fix?)

## Relaterade filer

- `boka.html:584-586` — PNR-fält och text
- `boka.html:2941-2975` — submit-logik
- `supabase/functions/booking-create/index.ts:313-314` — villkorlig spread för customer_pnr_hash
- `docs/archive/edge-functions/rut-claim/index.ts` — arkiverad RUT-EF
- `docs/archive/migrations/rut-sprint-1-deferred-to-fas-7-5.sql` — pausad datamodell
