# Legal-research: PNR-via-BankID-consent för RUT-flow (Spick)

**Datum:** 2026-04-25
**Syfte:** Underlag för Farhads jurist-bedömning av lagligt grund för Spicks RUT-PNR-flow via TIC.io BankID
**Format:** DATA + källor, INGA juridiska tolkningar (rule #30)

---

## 1. GDPR / DSL — lagligt grund

### 1.1 Art 6 GDPR

**Skatteverkets egen tolkning (rättslig vägledning):**
> "Skatteverket får behandla personuppgifter om behandlingen är nödvändig för att myndigheten ska kunna fullgöra en rättslig förpliktelse som följer av lag eller annan författning… (artikel 6.1 c EU:s dataskyddsförordning och 2 kap. 2 § den kompletterande dataskyddslagen)."
- Källa: https://www4.skatteverket.se/rattsligvagledning/edition/2021.3/368077.html (ed. 2021.3)

**EDPB SME Guide:** Art 6(1)(c) "legal obligation" gäller endast när förpliktelsen följer av EU- eller medlemsstatsrätt och åligger personuppgiftsansvarig.
- Källa: https://www.edpb.europa.eu/sme-data-protection-guide/process-personal-data-lawfully_en

### 1.2 Art 9 GDPR — känsliga personuppgifter

**IMY ordagrant:**
> "Personnummer och samordningsnummer är inte känsliga personuppgifter enligt dataskyddsförordningen, men de har getts ett särskilt skydd."
- Källa: https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/introduktion-till-gdpr/personuppgifter/personnummer/

Art 9 omfattar: ras/etniskt ursprung, politiska åsikter, religion, fackförening, hälsa, sexuell läggning, biometrisk/genetisk data — **PNR + adress + namn omfattas inte**.

### 1.3 Dataskyddslagen 3 kap 10 § (SFS 2018:218)

**Ordagrant:**
> "Personnummer och samordningsnummer får behandlas utan samtycke endast när det är klart motiverat med hänsyn till ändamålet med behandlingen, vikten av en säker identifiering eller något annat beaktansvärt skäl."
- Källa: https://lagen.nu/2018:218

**3 kap 11 §:** Regeringen får meddela ytterligare föreskrifter. (Ingen specifik förordning för plattformsbolag identifierad per 2026-04-25.)

---

## 2. Skatteverkets RUT-rapportering

### 2.1 XML-format för utbetalning

> "Ange alltid ditt organisationsnummer och dina kontaktuppgifter samt **kundens personnummer** när du fyller i uppgifterna."
- Källa: https://www.skatteverket.se/foretag/etjansterochblanketter/allaetjanster/tjanster/rotochrutforetag/reglerforattimporterafiltillrotochrut.4.76a43be412206334b89800033198.html

> "Köparens person-/organisationsnummer ska vara formellt korrekt"
(samma källa, valideringsregel)

**XSD-schemafiler:** Begaran.xsd / BegaranCOMPONENT.xsd (v3, v4, v6) på xmls.skatteverket.se. **Ingen verifierad källa** hittad som tillåter hash istället för klartext-PNR i XML — schemat kräver "formellt korrekt" personnummer (12 siffror).

### 2.2 F-skatt-krav

> "Företaget måste vara godkänt för F-skatt för att kunna delta i rot- och rutavdrag."
- Källa: https://www.foretagarna.se/juridisk-faq/rot--och-rut-avdrag/fakta-om-rut--och-rot-avdrag/

### 2.3 "Förmedlare" vs "Utförare"

**Ingen verifierad SKV-vägledning** hittad som direkt klassificerar plattformsbolag som "förmedlare" vs "utförare" för RUT. Frågan kräver direktkontakt med SKV eller HFD-praxis.

---

## 3. IMY (Integritetsskyddsmyndigheten)

### 3.1 Proportionalitet vid PNR-behandling

**IMY ordagrant:**
> "Utan samtycke får ni bara behandla personnummer om det är klart motiverat med hänsyn till ändamålet med behandlingen, vikten av en säker identifiering, något annat beaktansvärt skäl."

> "Personnummer ska exponeras så lite som möjligt."
- Källa: https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/introduktion-till-gdpr/personuppgifter/personnummer/

**IMY:s exempel-användning:** Endast personaladministration (löne-/behörighetshantering) nämns. **RUT, skattelagstiftning eller plattformsbolag nämns INTE som exempel.**

### 3.2 Pseudonymisering vs anonymisering — EDPB Guidelines 01/2025

**EDPB ordagrant:**
> "hashed personal data are often pseudonymised personal data, and you must also comply with the GDPR if you apply hashing."

> "Hash values are reproducible. You can derive the original data from a new calculation of the hash values of all possible original data… This is called a 'brute force' attack."

> "Pseudonymised data, which could be attributed to an individual by the use of additional information, remains information related to an identifiable natural person and is therefore still personal data."

> "The deletion of the additional information does not automatically render the pseudonymised data anonymous."
- Källa: https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf (publicerad 2025-01-16, public consultation t.o.m. 2025-02-28)

### 3.3 IMY-tillsynsbeslut om plattformar

Identifierade beslut 2023–2024 berör Bonnier News, Apotea, Avanza, Tele2, Apohem, Spotify, Kry — fokus på Meta-pixel + tredjelandsöverföring + finansiella PNR-uppgifter. **Inget hittat tillsynsbeslut specifikt för städplattform/RUT-förmedlare.**
- Källa: https://www.imy.se/globalassets/dokument/beslut/2024/

---

## 4. Rättsfall / EU-praxis

### 4.1 CJEU C-553/07 Rijkeboer (2009-05-07)

> "Protection of individuals with regard to the processing of personal data — Directive 95/46/EC — Respect for private life — Erasure of data — Right of access… Time-limit on the exercise of the right to access."
- Källa: https://curia.europa.eu/juris/liste.jsf?num=C-553/07&language=en

CJEU: 1-årig retention för åtkomstlogg violerar Direktiv 95/46.

### 4.2 BankID-baserat samtycke

**Ingen specifik svensk dom** identifierad som direkt prövar BankID-app-klick som "freely given, specific, informed" samtycke per Art 7 GDPR. Hänvisas till Art 4(11) + Art 7 GDPR-ramverket.

### 4.3 GDPR Recital 71 — automatiserad behandling

Recital 71 begränsar **profilering med rättsliga effekter** för enskilda. Inte direkt prövat på RUT-flow i identifierad praxis.

---

## 5. Plattformsekonomi-specifik lagstiftning

### 5.1 EU Platform Work Directive (Direktiv 2024/2831)

> "Adopted by the co-legislators on 23 October 2024… took effect on December 1, 2024, but EU member states have until December 2, 2026, to implement it into national law."
- Källa: https://eur-lex.europa.eu/eli/dir/2024/2831/oj/eng

**Rebuttable presumption:** Plattform→städare relation antas vara anställning vid kontroll/styrning. **Ingen verifierad analys** hittad om Spick-modellens specifika position.

### 5.2 DSA Artikel 30 — Trader Traceability

> "Marketplaces must verify trader identities before allowing them to sell to EU consumers."

> "Information collection: contact details, identification documents or electronic identification, payment account details including account holder name, trade register information if applicable, and compliance self-certification."

> "Providers must store trader information in a secure manner for a period of six months after the end of the contractual relationship with the trader, then delete it."
- Källa: https://www.eu-digital-services-act.com/Digital_Services_Act_Article_30.html

---

## 6. Branschpraxis (svenska konkurrenter)

### 6.1 Hemfrid integritetspolicy

> "Kontaktuppgifter, såsom namn, **personnummer**, adress, telefonnummer och epostadress"

> "KEYTO Group kan också komma att kommunicera med dig och administrera ditt kundärende (såsom **RUT-avdragsansökningar**)."

> "Behandlingen är nödvändig för att fullgöra avtalet med kunden."

> "Vissa personuppgifter kommer, i syfte att uppfylla relevant **bokföringslagstiftning**, att sparas i **sju år**."
- Källa: https://www.hemfrid.se/integritetspolicy (hämtad 2026-04-25)

**Nyckelobservation:** Hemfrid lagrar PNR i klartext (ej hash), åberopar avtalsfullgörande (Art 6(1)(b)) + bokföringslag som rättslig grund, retention 7 år.

### 6.2 Cleano, Hemstad, Sopra, Tipset/Hyrhem

**Ingen verifierad publik integritetspolicy** med PNR-detaljer hittad.

---

## 7. Specifika risk-frågor

### 7.1 BankID-samtycke och "informerat" per Art 7

GDPR Art 4(11): "frivillig, specifik, informerad och otvetydig viljeyttring". GDPR Art 7(3): rätt att återkalla. **Ingen specifik vägledning** om BankID-tap som dokumentation av samtycke hittad.

### 7.2 Återkallelse + radering

GDPR Art 17 + Art 7(3) ger rätt att återkalla. **Undantag enligt Art 17(3)(b):** rättslig förpliktelse.

### 7.3 7-års retention BokfL vs GDPR-radering

> "Om behandlingen av personuppgifter i bokföringen stöds på den rättsliga förpliktelsen i bokföringslagen, gäller skyldigheten att ta bort personuppgifterna efter 7 år… under förutsättning att ingen andra skäl finns att spara uppgifterna."

> "Rätten till radering ska inte gälla i den utsträckning behandlingen är nödvändig för att uppfylla en rättslig förpliktelse… (GDPR artikel 17.3.b)."
- Källor: https://gdprhero.se/fragor-och-svar/personuppgiftshantering-i-bokforingen/ + https://www.imy.se/privatperson/dataskydd/dina-rattigheter/radering/

**Bokföringslagen 7 kap 2 §:** räkenskapsinformation ska bevaras minst 7 år.

---

## Frågor som kräver Farhads bedömning

1. **Rättslig grund-val:** Art 6(1)(c) (rättslig förpliktelse via SKV) eller Art 6(1)(b) (avtalsfullgörande, som Hemfrid)?

2. **"Klart motiverat" per 3 kap 10 § DSL:** Räcker "säker identifiering för RUT-utbetalning" som motivering? Behövs DPIA?

3. **SHA-256-hash + krypterad referens — pseudonymisering eller anonymisering?** Per EDPB Guidelines 01/2025 är hash + behållen klartextkälla (TIC.io/SPAR) **fortfarande personuppgift**. Spicks position?

4. **DSA Art 30-tillämplighet:** Klassas Spick som "online platform allowing consumers to conclude distance contracts with traders"?

5. **Platform Work Directive-implementeringsrisk:** Sverige måste implementera senast 2026-12-02. Hur positionerar sig Spick re: rebuttable presumption?

6. **Förmedlare-status hos SKV:** Om Spick endast förmedlar, kan Spick undvika att hantera PNR helt — eller kräver SKV att plattformen agerar utförare i RUT-XML-flödet?

7. **Återkallelse-konflikt:** Om kund återkallar BankID-samtycke direkt efter bokning men före RUT-utbetalning, kan Art 17(3)(b) åberopas?

---

## Källor (alla hämtade 2026-04-25)

- Skatteverket: https://www4.skatteverket.se/rattsligvagledning/edition/2021.3/368077.html
- SFS 2018:218 (DSL): https://lagen.nu/2018:218
- IMY personnummer: https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/introduktion-till-gdpr/personuppgifter/personnummer/
- IMY pseudonymisering: https://www.imy.se/nyheter/edpb-antog-riktlinjer-om-pseudonymisering
- EDPB Guidelines 01/2025: https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf
- EDPB SME Guide: https://www.edpb.europa.eu/sme-data-protection-guide/process-personal-data-lawfully_en
- SKV RUT-import: https://www.skatteverket.se/foretag/etjansterochblanketter/allaetjanster/tjanster/rotochrutforetag/reglerforattimporterafiltillrotochrut.4.76a43be412206334b89800033198.html
- CJEU C-553/07: https://curia.europa.eu/juris/liste.jsf?num=C-553/07&language=en
- EU Platform Work Directive 2024/2831: https://eur-lex.europa.eu/eli/dir/2024/2831/oj/eng
- DSA Art 30: https://www.eu-digital-services-act.com/Digital_Services_Act_Article_30.html
- Hemfrid integritetspolicy: https://www.hemfrid.se/integritetspolicy
- GDPR HERO bokföring: https://gdprhero.se/fragor-och-svar/personuppgiftshantering-i-bokforingen/
- IMY radering: https://www.imy.se/privatperson/dataskydd/dina-rattigheter/radering/
- Företagarna RUT: https://www.foretagarna.se/juridisk-faq/rot--och-rut-avdrag/fakta-om-rut--och-rot-avdrag/

---

**Rule #30:** Inga juridiska tolkningar levererade. Farhad bedömer själv.
