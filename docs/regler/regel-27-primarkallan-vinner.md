# REGEL #27 — Primärkällan vinner alltid

**Införd:** 18 april 2026
**Efter:** Lärdom från Dag 2 Väg B tid-tracking-miss

## Kort

Innan du föreslår att bygga, lägga till eller ändra något baserat på
påståenden om vad som "finns" eller "saknas" — verifiera mot
primärkällan (faktisk kod eller prod-DB). Memory kan vara utdaterad.

## Triggers som kräver verifiering

När någon av dessa fraser förekommer i memory, masterkontext,
session-sammanfattning, eller Farhads beskrivning:

- "Det finns inte..."
- "Vi har inte..."
- "Funktionen saknas..."
- "Behöver byggas..."
- "Jag tror att..."
- Vilket fält/kolumn/EF som helst som nämns utan fil:rad-citat

## Sätt att verifiera

1. grep/Select-String mot kodbasen — citera fil:rad
2. SQL mot prod-DB — använd information_schema, faktiska queries
3. Läs faktisk fil — citera fil:rad

## Vid tidsbrist

Säg uttryckligen:

> "Jag har inte verifierat att X saknas — jag utgår från memory.
> Om det visar sig finnas en befintlig implementation ska vi pausa
> och göra om. Vill du att jag verifierar först (5 min) eller
> går vi vidare med antagandet?"

Farhad bestämmer om tiden är värd det.

## När regeln GÄLLER

- Strukturella beslut: bygga nya Edge Functions, skapa nya DB-kolumner,
  ny arkitektur, större refactors
- Beslut baserade på "finns/finns inte"-påståenden
- Större ingrepp i existerande flöden

## När regeln INTE gäller

- Små UI-tweaks (ändra text, färg, rubrik)
- Explicita uppgifter där Farhad säger "gör X på rad Y"
- Diagnos-arbete som i sig är verifiering

## Vad händer vid brott

1. Claude erkänner omedelbart — ingen försvaring
2. Arbete baserat på fel antagande rullas tillbaka
3. Lärdom dokumenteras här + i memory
4. Process-förbättring (exempel: ny grep-kommandon att köra per session)

## Dokumenterade brott

### 18 april 2026 — booking-time-tracker-misstaget

**Vad hände:** Claude föreslog Dag 2 Väg B med ny booking-time-tracker
EF + actual_start_at/actual_end_at-kolumner baserat på memory-text
som sa "tid-tracking saknas".

**Primärkällan visade:** team-jobb.html, stadare-uppdrag.html,
stadare-dashboard.html hade redan komplett tid-tracking via
checkin_time/checkout_time + completed_at + beräknad actual_hours.

**Konsekvens:** En timmes arbete rullades tillbaka:
- Edge Function booking-time-tracker raderad (commit 8afeb92)
- Migration för actual_start_at/actual_end_at reverterad (commit 785da31)
- Kvar: pricing-resolver (värdefull, behölls — commits 32b8a81 + c9bb32b)

**Rätt hade varit:** Innan prompten skrevs, köra:

    Select-String -Path *.html -Pattern "checkin_time|checkout_time|actual_hours"

Då hade redan-befintlig implementation upptäckts omedelbart.

## Relation till Regel #26

Regel #26 säger "verifiera innan du deklarerar att något fungerar".
Regel #27 säger "verifiera innan du föreslår att bygga något nytt".

Tillsammans: varje förslag OCH varje slutsats måste ha faktabas.
