# RUT-compliance-rutiner — backlog

**Status:** Backlog, P1 för vecka 17-18
**Författare:** Farhad + Claude, 18 april 2026
**Källa:** Verifierat mot Skatteverket + Bolagsverket

---

## Executive summary

Haghighi Consulting AB är primärt ansvarig som RUT-ombud mot Skatteverket. 
Ansvaret flyttar inte automatiskt till kunden eller underleverantören. 
Dokumentet samlar verifierade fakta, nuvarande lucker i systemet, och 
konkreta åtgärdsförslag.

---

## Del 1: Verifierade fakta från Skatteverket

### Återkravsansvar

Från Skatteverkets officiella sida:

> "Om det i efterhand visar sig att du har fått skattereduktion på 
> felaktiga grunder kan Skatteverket kräva tillbaka pengarna senast 
> sex år efter det aktuella beskattningsåret. Återkravet riktas 
> antingen till företaget eller till dig, beroende på utredningen."

**Tolkning för Spick:** 6-årig återkravs-risk. Skatteverket väljer 
vem de kräver pengarna av — kunden eller Haghighi Consulting AB. 
I praktiken träffar de oftast den part som är lättast att nå.

### Ombudets ansvar

Från Skatteverkets Ombud-sida:

> "Kom ihåg att företaget alltid ansvarar för att uppgifterna som 
> lämnas till Skatteverket är fullständiga och korrekta, även om 
> det är ett ombud som lämnar uppgifterna."

**Tolkning för Spick:** Haghighi Consulting AB som ombud bär ansvaret 
gentemot Skatteverket. Kundens lögn eller fel uppgift fritar inte oss.

### Dokumentationskrav

Från Skatteverkets sida om rutavdraget:

> "Du måste dokumentera hur många timmar du har arbetat och vilken 
> typ av arbete du har gjort. Det gäller även om du har gett din 
> kund fast pris."

**Tolkning för Spick:** Checkin_time/checkout_time + actual_hours 
MÅSTE finnas för varje RUT-bokning. Finns idag via team-jobb.html 
och stadare-dashboard.html. Verifierat 18 april 2026.

### F-skatt-kravet

Från Konsumentverket:

> "Du kan endast göra rotavdrag för hantverkarens arbetskostnad om 
> hantverkaren har F-skattsedel."

**Tolkning för Spick:** Gäller även RUT. Alla underleverantörer 
(Zivar, Rafael, kommande) måste ha F-skatt vid bokningens 
genomförande, inte bara vid onboarding.

---

## Del 2: Nuvarande brister i Spick

### Brist 1: Ingen kundintygs-klausul i bokningsflödet

**Problem:** boka.html har ångerrätt-checkbox men INGEN uttrycklig 
RUT-försäkran där kunden intygar att:
- Arbetet utförs i privatbostad eller fritidsbostad
- Kunden är behörig att ansöka om RUT-avdrag (max 75 000 kr/år)
- Uppgiven tjänstetyp stämmer med faktisk tjänst

**Juridisk konsekvens:** Svårare att återkräva pengar från kund vid 
återkrav från Skatteverket eftersom det saknas skriftligt intyg.

**Åtgärd:** Lägg till checkbox i steg 4 (betalning) av boka.html:

> ☐ Jag intygar att städningen utförs i min privatbostad eller 
> fritidsbostad, att jag har rätt till RUT-avdrag, och att jag är 
> behörig att ansöka om skattereduktion enligt Skatteverkets regler.

**Status:** Ej implementerad. P1 för vecka 17.

### Brist 2: Ingen F-skatt-verifiering vid onboarding

**Problem:** Vid VD-registrering (admin.html, manuellt eller via 
publik registrering) finns ingen systemkontroll att företaget har 
giltig F-skatt.

**Juridisk konsekvens:** Om ett företag tappar F-skatt under året 
(t.ex. skuld till Skatteverket) och fortsätter leverera tjänster 
via Spick → RUT-avdrag för bokningar efter det datumet kan kastas 
ut av Skatteverket. Återkrav mot Haghighi.

**Åtgärd fas 1 (manuell):** Krav i onboarding-checklistan att 
verifiera F-skatt via Skatteverkets formulär (https://skatteverket.se).
Spara skärmdump av bekräftelsen.

**Åtgärd fas 2 (halvautomatisk, maj-juni):** Bolagsverket API för 
grundläggande företagsstatus + månadsvis manuell F-skatt-koll.

**Åtgärd fas 3 (automatisk, när Skatteverket släpper API):** 
Automatisk F-skatt-verifiering via API vid onboarding + kvartalsvis 
recheck.

### Brist 3: Ingen rapporteringskanal för underleverantörsavvikelser

**Problem:** Om Zivar eller hennes team anländer till en adress och 
märker att det är ett kontor istället för en bostad — inget system 
för att flagga detta innan de börjar jobba.

**Juridisk konsekvens:** Arbetet utförs, kunden faktureras RUT-avdrag, 
Skatteverket betalar. Vid senare granskning → återkrav.

**Åtgärd:** Två delar:
1. Avtalsklausul i underleverantörsavtalet: "Underleverantören ska 
   kontakta Spick via XXXX innan arbetet påbörjas om det finns 
   avvikelse mellan bokad tjänstetyp och faktisk lokaltyp."
2. UI-feature i team-jobb.html: "Flagga avvikelse" knapp som pausar 
   bokningen och notifierar admin.

**Status:** Ej implementerad. P2 för maj.

### Brist 4: Ingen adressvalidering för RUT-lämplighet

**Problem:** Systemet accepterar alla adresser. En kontorsadress 
godkänns lika enkelt som en bostadsadress.

**Juridisk konsekvens:** Kund kan av misstag (eller avsiktligt) 
boka hemstädning på en kontorsadress. Om underleverantören inte 
flaggar → RUT utbetalas felaktigt.

**Åtgärd:** Via Google Places API (redan integrerat) — kontrollera 
place_type. Om `commercial`, `industrial`, `office`:
- För RUT-tjänster: visa varning "Detta ser ut att vara en 
  företagsadress. RUT-avdrag gäller endast privatbostäder. 
  Vänligen bekräfta att adressen stämmer."
- Kräv ny bekräftelse innan fortsättning

**Status:** Ej implementerad. P2 för maj.

---

## Del 3: F-skatt / moms-automatisering — roadmap

### Situation idag (18 april 2026)

**Skatteverket har ingen publik API för F-skatt/moms-kontroll.**

Citat direkt från Skatteverket:
> "Tjänsten kräver idag manuell inmatning av information där svaret 
> ges via e-post. Skatteverket har startat en utredning för att se 
> om det finns legala och tekniska möjligheter att erbjuda denna 
> tjänst där ett mer maskinellt informationsutbyte kan ske via API."

Källa: https://skatteverket.se/omoss/digitalasamarbeten/utvecklingsomraden/foretagsuppgifter

Ingen tidsplan för när API:n släpps.

### Tillgängliga alternativ

| Källa | Data | Kostnad | Automatiserad |
|-------|------|---------|---------------|
| Skatteverket webbformulär | F-skatt, moms, arbetsgivare | Gratis | Nej (manuell + e-post-svar) |
| Skatteverket API | F-skatt, moms, arbetsgivare | Okänd | Ej släppt än |
| Bolagsverket värdefulla datamängder | Företagsstatus, firmatecknare | Gratis | Ja (REST API, OAuth 2) |
| Bolagsverket företagsinformation | Fördjupad info, finansiell rapport | Anslutningsavgift + månadsavgift | Ja |
| Roaring.io | F-skatt, moms, Kreditdata (aggregerat) | ~5-10 kr/uppslagning | Ja |
| Creditsafe | Kreditupplysning + F-skatt | Månadsabonnemang ~1000-3000 kr | Ja |
| Syna | Bolagsinformation | Transaktionsbaserat | Ja |
| UC | Kreditupplysning | Abonnemang | Ja |

**Regel #27-flagg:** Priser och exakta data-innehåll för tredjepart 
är inte verifierade idag. Behöver göras vid val av leverantör.

### Rekommenderade faser

**Fas 1 — Nu till 10 företag (vår 2026)**
- Manuell F-skatt-verifiering via Skatteverkets formulär vid onboarding
- Spara bekräftelse-mejl från Skatteverket i dokumentsystem
- Del av onboarding-checklistan

**Fas 2 — 10-30 företag (sommar 2026)**
- Integrera Bolagsverket värdefulla datamängder API (gratis)
- Auto-check företagsstatus vid onboarding (aktivt, inte i konkurs)
- Manuell F-skatt-koll fortsätter månadsvis
- Roaring.io eller liknande för F-skatt-batch-check månadsvis

**Fas 3 — 30+ företag eller när Skatteverket släpper API (höst 2026-)**
- Byte till Skatteverkets API direkt om släppt
- Eller fortsätt via Roaring/Creditsafe för full integration
- Auto-verifiering vid varje onboarding + recheck månadsvis eller vid bokning

**Fas 4 — Löpande compliance-övervakning (pågående)**
- Cron-job som kollar alla aktiva företag månadsvis
- Auto-flagga om F-skatt förlorats → pausa företagets bokningar
- Notifiera VD + admin

---

## Del 4: Underleverantörsavtalets krav

För varje underleverantör (Rafa Allservice, Solid Service, framtida):

### Måste regleras skriftligt

1. **Ansvar för F-skatt:** Underleverantör garanterar att behålla 
   F-skatt under hela avtalstiden och meddelar omedelbart vid 
   förändring.

2. **Korrekt utförande:** Underleverantör utför bara arbeten i 
   enlighet med bokad tjänstetyp. Avvikelser flaggas före start.

3. **Tidsdokumentation:** Underleverantör ska använda Spicks 
   incheckning/checkout-system för varje bokning. Manuell 
   tidsrapportering accepteras inte.

4. **Adress-verifiering:** Underleverantör verifierar vid ankomst 
   att adress matchar förväntan (privatbostad för RUT-tjänster).

5. **Återkravsansvar:** Om Skatteverket återkräver RUT-avdrag på 
   grund av underleverantörens felaktigheter → underleverantören 
   ersätter Haghighi.

### Status

Haghighi har underleverantörsavtal live (acceptance-datum lagras 
i `companies.underleverantor_agreement_accepted_at`). Versionen 
kan verifieras via `companies.underleverantor_agreement_version`.

**Åtgärd:** Kontrollera att nuvarande avtalsversion innehåller 
punkterna 1-5 ovan. Om inte → uppdatera version + kräv omsignering.

---

## Del 5: Kundvillkorens RUT-klausul

### Föreslagen klausul att lägga till i kundvillkor.html

```
§X RUT-avdrag och återkrav

X.1 Kunden intygar vid bokning att tjänsten utförs i privatbostad eller 
    fritidsbostad som kunden är folkbokförd i, äger eller hyr, och att 
    kunden uppfyller Skatteverkets villkor för RUT-avdrag.

X.2 Om Skatteverket återkräver beviljat RUT-avdrag på grund av att 
    kundens uppgifter var felaktiga eller ofullständiga — oavsett om 
    felet var avsiktligt eller inte — är kunden skyldig att ersätta 
    Spick för det belopp som återkrävs från Spick, inklusive eventuella 
    ränte- och avgiftskostnader.

X.3 Kunden förstår att RUT-avdraget är en preliminär skattereduktion 
    som kan omprövas av Skatteverket inom sex år från beskattningsåret.

X.4 Spick har rätt att kräva betalning av kunden senast 30 dagar efter 
    att Spick mottagit besked om återkrav från Skatteverket.
```

**Juridisk notering:** Denna klausul flyttar betalningsansvaret till 
kunden. Den fritar dock INTE Spick från primär betalningsskyldighet 
till Skatteverket. Den ger Spick ett civilrättsligt anspråk mot kunden.

**Åtgärd:** Fråga jurist om klausulen är tillräcklig + lägg till i 
kundvillkor.html. Verifiera med Farhad innan.

---

## Del 6: Konkreta åtgärder — prioriterade

### P1 (vecka 17-18)

1. Lägg till kundintygs-checkbox i boka.html steg 4
2. Komplettera underleverantörsavtal med F-skatt-kontinuitet-klausul
3. Lägg till RUT-klausul i kundvillkor.html (efter juridisk granskning)
4. Dokumentera manuell F-skatt-onboardingrutin i stadare-handbok

### P2 (maj-juni)

5. Integrera Bolagsverket värdefulla datamängder API (gratis, aktivt-check)
6. Adress-validering mot Google Places för place_type
7. "Flagga avvikelse"-knapp i team-jobb.html
8. Utvärdera Roaring.io eller liknande för F-skatt-batch

### P3 (höst 2026)

9. Skatteverkets API om släppt, annars tredjepart
10. Löpande compliance-cron-job (månadsvis F-skatt-recheck)
11. Auto-paus av bokningar om F-skatt förlorats

---

## Del 7: Regel #26 + #27 på detta dokument

**Verifierat enligt regel #26:**
- Skatteverkets återkravsregel: direktcitat från 
  skatteverket.se/privat/fastigheterochbostad
- Ombudets ansvar: direktcitat från Skatteverkets Ombud-sida
- Dokumentationskrav: direktcitat från 
  skatteverket.se/foretag/skatterochavdrag/rotochrut
- F-skatt-krav: Konsumentverkets sida
- API-status: Skatteverkets officiella sida om utveckling

**Inte verifierat (regel #27-flagg):**
- Tredjepartsleverantörers aktuella prissättning (Roaring, Creditsafe)
- Exakt datum för Skatteverkets API-släpp
- Om nuvarande underleverantörsavtal-version täcker alla 5 punkterna
- Om nuvarande kundvillkor har någon RUT-klausul alls
- Om Skatteverket faktiskt använder 6-årig återkravsgräns eller 
  längre i specialfall

**Nästa steg:** Verifiera ovan punkter innan implementation påbörjas.

---

## Del 8: Dokumentets historik

| Datum | Ändring | Författare |
|-------|---------|-----------|
| 18 april 2026 | Första versionen skriven efter Farhads oro | Farhad + Claude |
| — | — | — |

---

## Referenser

- Skatteverket rot/rut i deklaration: https://skatteverket.se/privat/fastigheterochbostad/rotarbeteochrutarbete/rotochrutavdragideklarationen
- Skatteverket ombud: https://skatteverket.se/foretag/drivaforetag/ombudforettforetag
- Skatteverket så fungerar rutavdraget: https://skatteverket.se/foretag/skatterochavdrag/rotochrut/safungerarrutavdraget
- Skatteverket API-utveckling: https://skatteverket.se/omoss/digitalasamarbeten/utvecklingsomraden/foretagsuppgifter
- Bolagsverket API: https://bolagsverket.se/apierochoppnadata/hamtaforetagsinformation
- Konsumentverket rotavdrag: https://www.konsumentverket.se/varor-och-tjanster/rotavdrag
