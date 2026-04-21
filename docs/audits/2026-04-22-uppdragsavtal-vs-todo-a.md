# Uppdragsavtal-audit vs Todo A

**Datum:** 2026-04-22
**Auditör:** Claude (research)
**Scope:** Verifiera att [uppdragsavtal.html](../../uppdragsavtal.html) uppfyller Todo A-kraven innan bygg.
**HEAD vid audit:** 153c323
**Avtalskällans commit:** `fea7f63` (2026-04-02) – "Block 3 juridik: integritetspolicy kundvillkor uppdragsavtal angerratt"

## Fil och metadata

| Attribut | Värde |
|---|---|
| Path | [uppdragsavtal.html](../../uppdragsavtal.html) |
| Filstorlek | 13 128 bytes |
| Radantal | 142 rader |
| Senast modifierat | 2026-04-16 18:27 |
| Titel | "Underleverantörsavtal – Spick" |
| Parter | Haghighi Consulting AB (bifirma Spick) ↔ egenföretagare som städare |
| "Senast uppdaterat"-stämpel | 16 april 2026 |

## Nuvarande struktur

Avtalet har **15 numrerade sektioner** + en "Grundprincip"-banner ovanför §1:

| § | Rubrik | Kärninnehåll |
|---|---|---|
| — | Grundprincip (banner) | Självständig näringsidkare, inte anställd |
| 1 | Bakgrund | Spick tillhandahåller tjänst, underleverantör utför |
| 2 | Underleverantörens självständighet | 6 friheter (acceptera, tid, andra plattformar, arbetssätt, utrustning, F-skatt) |
| 3 | Registrering och verifiering | F-skatt, BankID, 18 år, profil |
| 4 | Uppdragsförmedling | Matchning + bindande acceptans |
| 5 | **Ersättning och betalning** | 7 underrubriker (5.1-5.7) – se detaljanalys nedan |
| 6 | Försäkring | Ansvarsförsäkring + 90-dagars introduktionsperiod |
| 7 | Kvalitet och betyg | 7.1 GPS-verifiering + 7.2 fotodokumentation |
| 8 | Nöjdhetsgaranti | 48-h kundklagomål → omstädning inom 5 arbetsdagar |
| 9 | Uppförandekod | 6 bullets (respekt, inte kringgå plattform, etc) |
| 10 | Sekretess | Kundinformation konfidentiell |
| 11 | Avtalstid och uppsägning | Tillsvidare, 30-dagars varsel |
| 12 | Ansvar | Skadeståndsansvar + regressrätt |
| 13 | Ändringar | 30 dagars förvarning via e-post |
| 14 | Tillämplig lag | Svensk lag, allmän domstol |
| 15 | Kontakt | Haghighi Consulting AB, hello@spick.se |

## Granskning mot Todo A-krav

Todo A-kraven ([todo-a-rut-notification-transparency.md:66-70](../planning/todo-a-rut-notification-transparency.md)) stipulerar att avtalet ska tydligt beskriva:

1. Två-stegs utbetalning
2. RUT-avslag = ingen del 2
3. Tidsram för Skatteverket-godkännande

### Krav 1 — Två-stegs utbetalning: **MATCHAR**

**§5.6 "Betalning i två steg (RUT-uppdrag)" (rad 77-82):**

> Vid uppdrag med RUT-avdrag betalas Underleverantören i två steg:
> 1. **Steg 1 (efter utfört och godkänt uppdrag):** Underleverantörens andel av det belopp slutkunden betalat betalas ut via Stripe Connect.
> 2. **Steg 2 (efter Skatteverkets utbetalning):** Underleverantörens andel av RUT-beloppet betalas ut efter att Spick mottagit utbetalningen från Skatteverket (normalt 2–4 veckor).

Grep-träffar: "steg 1", "steg 2", "betalning i två steg", "två steg". Explicit numrerad lista med tydliga villkor för varje steg.

**Gap:** Inga.

### Krav 2 — RUT-avslag = ingen del 2: **SAKNAS**

**Analys:** Avtalet nämner aldrig ordet "avslag", "Skatteverket avslår", "utgår ingen" eller motsvarande. §5.6 beskriver det positiva scenariot (Skatteverket betalar → steg 2 utgår) men inte det negativa (Skatteverket avslår → inget steg 2).

Grep-träffar: 0 för `(avslag|ej godk|inte godk|utg\u00e5r|rejected|denied)` i uppdragsavtal.html.

**Implicit tolkning:** §5.6 punkt 2 säger "efter att Spick mottagit utbetalningen från Skatteverket" — en juristlöst tolkning blir "ingen utbetalning, inget steg 2". Men det är en slutledning, inte en uttrycklig bestämmelse, och Todo A:s notifikations-mall säger bokstavligen "Om ansökan avslås utgår ingen andra utbetalning" — den formuleringen måste finnas i avtalet för att notifikationen ska vara juridiskt konsistent med avtalet.

**Gap:** Avtalet behöver en uttrycklig paragraf (§5.6.3 eller §5.8) som stipulerar:

- Vad som händer om Skatteverkets RUT-ansökan avslås
- Att Underleverantörens steg 2-utbetalning då utgår
- Att Spick inte kompenserar för RUT-avslag som beror på felaktigt PNR, bristfälligt RUT-utrymme hos kunden, eller andra orsaker utanför Spicks kontroll
- Eventuell avstämning/dokumentation mot Underleverantören vid avslag

### Krav 3 — Tidsram för Skatteverket-godkännande: **MATCHAR**

**§5.6 punkt 2** inkluderar tidsramen inline:

> ...efter att Spick mottagit utbetalningen från Skatteverket (**normalt 2–4 veckor**).

Grep-träffar: "normalt 2–4 veckor", "Skatteverket".

**Gap:** Inga för Todo A:s behov. (Notera att verklig behandlingstid kan variera — avtalet använder "normalt" vilket är juridiskt försiktigt.)

### Sammanfattning per krav

| Krav | Status | Paragraf | Gap |
|---|:---:|---|---|
| 1. Två-stegs utbetalning | ✅ MATCHAR | §5.6 | Inga |
| 2. RUT-avslag = ingen del 2 | ❌ SAKNAS | — | Behöver egen paragraf |
| 3. Tidsram för godkännande | ✅ MATCHAR | §5.6 punkt 2 | Inga |

## Andra observationer

### Commission-specifikation i avtalet (§5.1) KONFLIKT mot memory

Avtalet säger:
> - Privatuppdrag: 17 % av jobbvärdet
> - Företagsuppdrag: 12 % av jobbvärdet

**Konflikt:** Auto-memory [project_commission_format.md](../../../.claude/projects/C--Users-farha-spick/memory/project_commission_format.md) dokumenterar att produktionskoden läser `platform_settings.commission_standard=12` (12 % flat på alla bokningar). Alltså:

- **Avtalet:** 17 % privat / 12 % B2B
- **Koden:** 12 % flat (enligt memory)

Detta är utanför Todo A-scope men är en läckage som Farhad bör vara medveten om innan Rafa-piloten — antingen uppdatera avtalet till 12 % flat, eller uppdatera `platform_settings.commission_standard` + `booking-create` till 17/12 split. **Läckage flaggad, ingen åtgärd i denna audit.**

### Signatur-mekanism: FINNS

Avtalet accepteras via checkbox i [registrera-stadare.html:660-664](../../registrera-stadare.html:660):

```html
<input type="checkbox" id="chkTerms">
<span>Jag godkänner Spicks
  <a href="uppdragsavtal.html" target="_blank">uppdragsavtal</a> och
  <a href="integritetspolicy.html" target="_blank">integritetspolicy</a>.</span>
```

Valideras i [registrera-stadare.html:1107](../../registrera-stadare.html:1107):
```js
if (!document.getElementById('chkTerms').checked) { alert('Du måste godkänna uppdragsavtalet och integritetspolicyn'); return; }
```

**Observation:** Klickboxar utan timestamp-logg i databasen är juridiskt svagare än BankID-signatur eller lagrad acceptansrad. För GA-nivå bör acceptansen persisteras i `cleaners`-tabellen (t.ex. `terms_accepted_at TIMESTAMPTZ` + `terms_version`). **Utanför Todo A-scope.**

### Övriga observationer

- **§5.2 Utbetalning:** Beskriver Stripe Connect + 2-7 bankdagar generellt. Överlappar inte §5.6 — hanterar icke-RUT-uppdrag och det tekniska flödet för själva transfers.
- **§5.5 RUT-avdrag:** Fastslår att Spick ansöker i eget namn och att städaren inte hanterar RUT-ansökan. Bra grund för §5.6-modellen.
- **§5.3 Självfakturering:** Spick utfärdar månatlig självfaktura åt städaren enligt ML 11 kap. Relevant för hur steg 1/steg 2-utbetalningarna dokumenteras bokföringsmässigt.
- **Inga referenser till platform_settings eller dynamiska värden** — alla siffror (17 %, 12 %, 2-4 veckor, 90 dagars introduktion, 48 h reklamation) är hårdkodade i avtalstexten. Ändring kräver avtalsuppdatering, inte bara DB-värde.
- **Digital leveransform:** Avtalet levereras som HTML med "Senast uppdaterat"-stämpel. Versionshantering finns i commit-historik (fea7f63, plus senare ändringar via §2.7.2-omgången). Ingen explicit versionsnumrering i avtalstexten.

## Rekommendation för Todo A

**Slutsats:** Todo A kan **INTE** byggas direkt. Krav 2 (RUT-avslag) saknas i avtalet. Avtalsuppdatering måste ske som separat PR INNAN Todo A-notifikationsbygget går live, annars blir notifikationstexten ("Om ansökan avslås utgår ingen andra utbetalning") juridiskt inkonsistent med underlaget städaren accepterat.

**Estimat avtalstext:** ~100-150 ord (en ny kort underparagraf §5.6.1 eller ny §5.7, med ommöblering av efterföljande numrering om §5.7 väljs).

**Juristkonsultation?** Nej, Farhads egna formuleringar räcker. Resonemanget bakom bestämmelsen är enkelt och icke-kontroversiellt: RUT är statligt utrymme som städaren inte äger, utbetalning förutsätter att Skatteverket betalar. Det finns inget oklart juridiskt tolkningsutrymme att tvista om.

### Förslag på paragraftext (att lägga till eller ersätta §5.6 i sin helhet)

Två alternativ — välj ett:

#### Alternativ A (minimal ändring): lägg till en tredje punkt i §5.6

```html
<h3>5.6 Betalning i två steg (RUT-uppdrag)</h3>
<p>Vid uppdrag med RUT-avdrag betalas Underleverantören i två steg:</p>
<ol>
<li><strong>Steg 1 (efter utfört och godkänt uppdrag):</strong> Underleverantörens andel av det belopp slutkunden betalat betalas ut via Stripe Connect.</li>
<li><strong>Steg 2 (efter Skatteverkets utbetalning):</strong> Underleverantörens andel av RUT-beloppet betalas ut efter att Spick mottagit utbetalningen från Skatteverket (normalt 2–4 veckor).</li>
<li><strong>Avslag från Skatteverket:</strong> Om Skatteverket avslår hela eller delar av RUT-ansökan utgår motsvarande del av Steg 2 inte. Spick ersätter inte Underleverantören för avslag som beror på att slutkunden saknar RUT-utrymme, angett felaktigt personnummer, redan använt sin RUT-kvot hos annan utförare, eller andra orsaker utanför Spicks kontroll. Vid avslag informeras Underleverantören inom 7 dagar efter att Spick mottagit besked från Skatteverket, med uppgift om avslagets omfattning.</li>
</ol>
```

#### Alternativ B (tydligare struktur): ny §5.7 "Avslag och återkrav"

```html
<h3>5.7 RUT-avslag och återkrav</h3>
<p>Om Skatteverket avslår RUT-ansökan — helt eller delvis — utgår Underleverantörens Steg 2-utbetalning enligt §5.6 i motsvarande omfattning. Spick ersätter inte Underleverantören för avslag som beror på slutkundens förhållanden (saknat RUT-utrymme, fel personnummer, redan utnyttjad kvot, ålder under 18 år eller andra behörighetshinder) eller andra orsaker utanför Spicks kontroll.</p>
<p>Vid avslag informeras Underleverantören skriftligen inom 7 dagar efter att Spick mottagit besked från Skatteverket. Meddelandet innehåller: avslagets omfattning (del- eller helavslag), Skatteverkets angivna skäl i den utsträckning Spick får dela dem, och påverkan på pågående och redan utförda uppdrag.</p>
<p>Om Skatteverket i efterhand återkräver redan utbetalat RUT-belopp (t.ex. vid upptäckt av felaktiga uppgifter från slutkund) har Spick rätt att kvitta motsvarande belopp från Underleverantörens framtida utbetalningar, under förutsättning att återkravet inte beror på Spicks eget fel i ansökningsförfarandet.</p>
```

**Rekommendation:** Alternativ B. Separerar avslag från det positiva flödet + täcker in det viktiga edge-caset "Skatteverket återkräver efter utbetalning". Numrering av §5.7-5.7 blir då §5.8-5.8 (Reklamation och kvalitetsansvar).

### Åtgärdsordning

1. **PR X:** uppdragsavtal.html §5.6 + §5.7 enligt Alternativ B ovan. Bumpa "Senast uppdaterat" till aktuellt datum.
2. **PR X+1:** Todo A notifikationsbygget (cleaner-booking-notification EF + dashboard-UI + stadare-uppdrag.html).
3. **Efter PR X:** Uppdatera auto-memory om platform_settings vs avtalstext (17 % vs 12 %) om Farhad väljer att harmonisera.

### Parallellt (inte blockerande för Todo A)

- **Commission-läckage 17 % vs 12 %:** Antingen uppdatera avtalet till "12 % av jobbvärdet" (flat) eller uppdatera `platform_settings.commission_standard`. Bör lösas före Rafa-pilot.
- **Acceptanslogg i DB:** `cleaners.terms_accepted_at` + `terms_version`-kolumner för starkare juridiskt spår. Fas 13 GA-readiness.

## Status

**KRÄVER_AVTAL_UPPDATERING.**

Todo A:s notifikationsarbete går inte att bygga utan att avtalet först kompletteras med RUT-avslags-paragrafen. Estimat för avtals-PR: 15-30 minuter (copy-paste av Alternativ B ovan, Farhads granskning, commit).
