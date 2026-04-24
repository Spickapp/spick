# Fas 7.5 — Jurist-underlag för RUT-infrastruktur + plattformsmodell

**Datum:** 2026-04-24
**Status:** Research-sammanställning för jurist-granskning
**Källa:** Claude (AI-assistent) + primärkällor (EU-direktiv, SFS, myndighetsvägledning, konkurrenters publika villkor)

> **⚠️ DISCLAIMER (rule #30):** Detta är INTE juridisk rådgivning. Claude är inte licensierad jurist. Detta dokument är research-sammanställning som måste granskas av svensk jurist med erfarenhet av:
> - Skatterätt (RUT-avdrag, F-skatt)
> - Plattformsarbete (EU PWD 2024/2831 + SOU 2026:3)
> - GDPR/dataskyddsrätt
> - Konsumenträtt
>
> Ingen implementering sker baserat på detta dokument utan jurist-OK.

---

## 1. Exekutiv sammanfattning

**3 klass A-blockerande jurist-frågor:**

1. **Är Spick "utförare" eller "förmedlare" hos Skatteverket?** Avgör hela RUT-modellen.
2. **Är tvåstegs-payout förenlig med PWD-anställningspresumtionen?** Deadline 2 dec 2026.
3. **Hantering av befintliga 36 PNR-rader** (3 riktiga kunder med klartext) — IMY-incidentrapport krävs?

**Unik konkurrensfördel:** Ingen identifierad konkurrent har GPS-incheckning eller tvåstegs-payout i publika villkor. Spick kan bli branschledande — MEN detta gör också juridisk pre-granskning extra kritisk.

---

## 2. RUT-avdrag: lagstiftning + praxis

### 2.1 Grundlag
- **Inkomstskattelagen (1999:1229)**, 67 kap. 11-19 §§
- **Lag (2009:194) om förfarandet vid skattereduktion för hushållsarbete** — utbetalning + återkrav
- **Skatteförfarandelagen (2011:1244)** — generella regler om skattetillägg

**⚠️ Osäkerhet:** Verbatim-text av 67 kap. 13 § kunde ej hämtas via automatisk research. **Jurist extraherar direkt från SFS-databas.**

### 2.2 Kvalificerande tjänster (Skatteverkets vägledning)
- Enklare hemstädning, storstädning, flyttstädning
- Fönsterputs, textilvård (tvätt, strykning)
- Trappstädning i privatbostad
- **EJ RUT:** Kontorsstädning, byggstädning, städning i lokaler/företag

### 2.3 75 000 kr-tak
- **Per kalenderår, inte rullande.** Resettar 1 januari.
- RUT + ROT räknas gemensamt efter regeländring 1 jan 2026: maxtak 75 000 kr, varav ROT max 50 000 kr.
- **⚠️ Diskrepans mellan källor:** En källa (Företagarna) skriver att 75 000 kr-höjningen är "tillfällig" — kan återgå till 50 000 kr vid okänd tidpunkt. **Jurist-fråga:** Aktuell status 2026?

### 2.4 Arbetskostnad vs material
Enligt **Lag (2009:194) § 9**:
- Endast arbetskostnad inkl. moms → skattereduktion
- Material, resor, maskinkostnader **ingår INTE** i underlaget
- **Ska separeras på fakturan** (fakturamodellen, införd 1 juli 2009)

**Jurist-fråga:** Om Spick använder schablon 100% arbetskostnad för städtjänster (ingen materialdebitering), är det tillräckligt eller krävs bevis?

### 2.5 Konsekvenser vid felaktig ansökan
- **Återbetalning** enligt Lag (2009:194) §§ 13-14: utförare ska **omedelbart** meddela SKV
- **Tidsfrist för återkrav:** **6 år** efter beskattningsår (§ 14)
- **Ränta:** Kostnadsränta från utbetalningsdag (§ 22)
- **Återkrav kan riktas mot företaget ELLER kunden** — "beroende på utredningen" (SKV)
- **Skattetillägg:** 40% av undandragen inkomstskatt, 20% för moms/avgifter, 10% vid fel beskattningsår
- **Skattebrottslagen (1971:69)** kan aktualiseras vid uppsåt/grov oaktsamhet

**Jurist-frågor:**
1. Kan Spick bli ansvarigt för kundens felaktiga PNR-uppgift?
2. Om Spick skickar in RUT men kunden redan använt sitt tak — vem bär risken?
3. Ansvar vid systematiska fel (t.ex. kontorsstädning felklassad som RUT)?

---

## 3. RUT-ombud-rollen (KRITISK FÖR SPICKS MODELL)

### 3.1 Laglig grund
- **Lag (2009:194) § 8** (verbatim-verifierat):
  > "Begäran ska vara undertecknad av utföraren eller **av den som är ombud eller annan behörig företrädare för utföraren**."
- **Blankett SKV 4854** "Begäran genom ombud"
- **E-tjänsten "Ombud och behörigheter"** — registrering med mobilt BankID

### 3.2 Stående mandat vs per-ansökan BankID?
- Behörighet gäller **tills återkallad eller angiven tidsperiod löpt ut**
- **Ombudet signerar själv med SITT personliga BankID** vid varje begäran — **inte kunden**
- Detta är ombuds-relation mellan utföraren och en fysisk person, **inte mellan utförare och kund**

### 3.3 🔴 KRITISK OSÄKERHET: Vem är "utförare" i Spicks modell?

Två scenarion:
- **Scenario A:** Spick AB fakturerar kunden → Spick är utförare → Spick ansöker om RUT i eget namn
- **Scenario B:** Städare fakturerar kunden direkt → Städaren är utförare → Städaren (eller deras ombud) ansöker

**Detta är den mest centrala frågan för jurist.** Det avgör:
- Vem registrerar sig som ombud
- Vem är ansvarig vid fel
- Hur tvåstegs-payout juridiskt struktureras
- Om Spick behöver arbetsgivar-status

### 3.4 Jurist-frågor (klass A)
1. Är Spick "utförare" enligt 67 kap. 16-17 § IL eller "ombud för utföraren"?
2. Vid tvåstegs-modell (Spick tar 12%, städare får 88%) — vem är formellt utförare hos SKV?
3. Om städaren är egen utförare, måste Spick vara deras ombud?
4. Finns praxis/förhandsbesked från Skatterättsnämnden om plattformar som Spick?

### 3.5 Batch/månadsansökan
- § 8 anger senast 31 januari året efter betalningen
- **Ingen regel mot batch.** Praxis: Hemfrid ansöker månadsvis.

---

## 4. Tvåstegs-payout för städare

### 4.1 Rättslig grund
Ingen specifik lag förbjuder split payment. Det är en avtalsfråga.

Relevanta ramverk:
- **Avtalslagen (1915:218)** — fritt avtalade villkor
- **Lagen om oskäliga avtalsvillkor mellan näringsidkare (1984:292)** — jämkning
- **Skatteförfarandelagen** — F-skattesystemet

### 4.2 Lagligt att städare bär RUT-risken?
**Civilrättsligt sannolikt ja** OM:
- Klart avtalat i förväg
- Städaren är F-skattad (näringsidkare)
- Risken är begriplig och inte manifest oskälig

**🔴 Men:** Exakt den typ av struktur som EU PWD 2024/2831 ska motverka. Anställningspresumtion kan triggas om Spick utövar "ledning och kontroll" (algoritmisk tilldelning, prissättning, kvalitetskontroll via GPS/foto).

### 4.3 Konkurrentstruktur
| Företag | Modell | RUT-risk vid avslag |
|---|---|---|
| **Hemfrid** | Anställda | Kund |
| **Vardagsfrid** | Anställda | Kund (+300 kr adminavgift) |
| **Städade Hem** | Anställda | Kund |
| **Hjälper.se** | Plattform | Oklart |
| **Spick (planerat)** | Plattform | **Städare** (del 2 uteblir) |

**Observation:** Alla anställnings-modeller lägger risken på kund. Plattforms-modeller är oklara. Spick är unik i att planerat lägga risken på städaren.

### 4.4 Obligatoriska klausuler i uppdragsavtal
1. **Tydlig statusbestämmelse:** Städaren är F-skattad näringsidkare, inte anställd
2. **Prissättnings-autonomi:** Städaren sätter egna priser (viktigt mot PWD-presumtion)
3. **Riskfördelning:** Vem bär RUT-risken vid avslag
4. **Återbetalningsvillkor:** Vad händer om Spick redan utbetalat del 2 och SKV senare nekar (6-årsrisk)
5. **Provision:** 12% flat (redan i `platform_settings`)
6. **Försäkring:** Städarens egen ansvarsförsäkring eller via Spick
7. **Reklamation:** Vem hanterar kundklagomål, kostnadsfördelning
8. **Tvistelösning:** ARN-frist, forum
9. **Uppsägningsbestämmelser:** **OBS PWD Art 11** — mänsklig kontaktperson vid avstängning

### 4.5 Jurist-frågor
1. Är tvåstegs-payout förenlig med PWD-anställningspresumtionen?
2. Kan Spick garantera del 1 oberoende av SKV-utfall?
3. Om städaren ej är F-skattad — blir Spick automatiskt arbetsgivare?
4. Ränta under väntetid på del 2 — krav enligt räntelagen?

---

## 5. Personnummer under GDPR

### 5.1 KORRIGERING AV VANLIG MISSUPPFATTNING
**Personnummer är INTE särskild kategori enligt GDPR Art 9.**

IMY:s vägledning:
> "Personnummer och samordningsnummer räknas inte som känsliga personuppgifter enligt dataskyddsförordningen"

Istället reglerat via:
- **Dataskyddslagen (2018:218), 3 kap. 10 §:**
  > "Personnummer och samordningsnummer får behandlas utan samtycke endast när det är klart motiverat med hänsyn till ändamålet med behandlingen, vikten av en säker identifiering eller något annat beaktansvärt skäl"

### 5.2 Laglig grund för RUT-PNR
- **GDPR Art 6.1.c** — rättslig förpliktelse: SKV kräver PNR enligt Lag (2009:194) § 9. **Solid grund.**
- **Dataskyddslagen 3 kap. 10 §** — säker identifiering är klart motiverat

### 5.3 Krypterings-krav
- **GDPR Art 32** — "lämpliga tekniska åtgärder" — **ingen konkret lagstadgad gräns**
- IMY-praxis: kryptering **rekommenderas starkt** för PNR
- Branschstandard: AES-256 / pgcrypto
- **🔴 Klartext-PNR i DB = sannolikt överträdelse av Art 32** vid IMY-tillsyn

### 5.4 Retention: BokfL vs GDPR
- **Bokföringslagen 7 kap. 2 §** — räkenskapsinformation sparas i **7 år**
- **GDPR Art 5.1.e** — dataminimering
- **Konflikt löses via:** BokfL = rättslig förpliktelse (Art 6.1.c), gör GDPR-radering sekundär
- **Efter 7 år:** Radering krävs enligt GDPR
- **Praktisk implementation:** Separat "arkiv-tabell" med begränsad åtkomst, automatisk radering efter 7 år

### 5.5 🔴 Befintliga 36 PNR-rader — INCIDENT?
Per `docs/sanning/pnr-och-gdpr.md`:
- 11 klartext-PNR (12 tecken YYYYMMDDNNNN) från **3 riktiga kunder**
- claraml@hotmail.se (10 bokningar), derin.bahram@ivory.se (1), zivar.majid@outlook.com (1)
- Lagrade i strid med utfästelsen i boka.html ("krypteras och används endast för RUT-ansökan")

**🔴 Jurist-fråga klass A:** Ska detta rapporteras till IMY som personuppgiftsincident?

### 5.6 Jurist-frågor
1. Krävs separat "vault" (pgcrypto/KMS) eller räcker DB-kolumn-kryptering?
2. Krävs DPIA (Art 35) för PNR-hantering?
3. Hur hantera radering när ny bokning förlänger retention på gammal data?
4. **Klass A:** IMY-incidentrapport för klartext-PNR?

---

## 6. GPS-incheckning + foto-bevis

### 6.1 GDPR-ramverk
IMY:s vägledning "Platstjänster på jobbet":
- **Laglig grund:** Intresseavvägning (Art 6.1.f), **INTE samtycke** (anställdas samtycke "inte giltigt" pga beroendeförhållande)
- **Krav:** Verksamhetsbehov väger tyngre än integritet
- **Informationskrav:** Vad, varför, hur, var lagrat, hur länge, vem har tillgång — **före aktivering**
- **Real-tidsövervakning:** Tillåts **inte** utan konkret verksamhetsbehov
- **Retention:** Endast så länge nödvändigt (Art 5.1.c)

### 6.2 🔴 Spicks modell: kritiska spörsmål
Om städare är F-skattade egenföretagare (ej anställda), är IMY:s anställnings-vägledning direkt tillämplig? **Oklart.**

**Check-in vid kundbesök kan motiveras av:**
- Trygghet för kund (rätt person kom)
- Kvalitetskontroll (jobbet utfört)
- Bevisning vid tvist

### 6.3 Fotobevis
- Foto av arbete = **inte biometrisk data** om inte ansiktsigenkänning
- Foto av städare själv = möjligen integritetskänsligt
- **Foto av kundens hem** = kan innehålla känsliga personuppgifter (familjeförhållanden, religion, medicinska, politiska)

### 6.4 Samtyckes-krav
- **Städaren:** Intresseavvägning, inte samtycke
- **Kunden:** **Samtycke krävs vid foto i hemmet** (GDPR + bostadens privata karaktär)

### 6.5 Retention
Ingen lagstadgad periodsgräns. Branschpraxis:
- GPS-loggar: 30-90 dagar
- Foto-bevis: 6-12 månader (tvistehantering) eller längre vid aktiv tvist
- Försäkringsärende: motiverar längre

### 6.6 Jurist-frågor
1. Krävs DPIA för GPS + foto-systemet (Art 35)?
2. Vilken laglig grund för kundens foton — samtycke vid bokning eller per bild?
3. Hur uppfylls transparens-kravet (Art 13-14) konkret i Spicks flow?
4. Kan kunden motsätta sig GPS-lagring pga "särskild situation" (Art 21)?
5. Rimlig retention-policy?

---

## 7. EU Platform Work Directive (PWD) — deadline 2 dec 2026

### 7.1 Grundfakta
- **Directive (EU) 2024/2831** av 23 oktober 2024
- **I kraft:** 1 december 2024
- **Deadline för nationell implementation:** **2 december 2026**
- **Svensk implementation:** SOU 2026:3 "Genomförande av plattformsdirektivet" (publicerad 12 jan 2026, på remiss)
- Föreslagen ny lag: **Lag om plattformsarbete**

### 7.2 Anställningspresumtion (Art 5)
- Presumerad anställning när plattformen utövar **ledning och kontroll**
- Plattformen bär bevisbördan
- **Svensk utredning:** Presumtionen ska **inte tillämpas i skatte- och straffrättsliga förfaranden**
- Kommittén vill "värna det svenska arbetstagarbegreppet"

### 7.3 🔴 Algoritm-transparens (Art 9)
**Plattformar måste informera** plattformsarbetare om:
- Att automatiska övervaknings- och beslutssystem används
- Vilka typer av beslut som fattas
- Datakategorier som behandlas
- Beslutsgrunder

**Form:** Skriftligt dokument, klart och lättförståeligt språk, **före systemets användning**.

### 7.4 Förbjuden automatiserad databehandling (Art 7)
Plattformar får **INTE** behandla:
- Uppgifter om emotionellt/psykologiskt tillstånd
- Privata samtal/kommunikation (inkl. med facklig representant)
- Data insamlad utanför arbetstid
- Data om åsikter i fackliga frågor
- Hälsouppgifter utöver strikt nödvändigt

### 7.5 🔴 Omprövnings-rätt för avstängda städare (Art 11)
**KRITISKT för Spick:**
- Automatiserade system får **inte ensidigt fatta beslut** om att begränsa/stänga av/säga upp plattformsarbetarens konto
- **Obligatorisk mänsklig kontaktperson** med kompetens och mandat att diskutera
- **Rätt till förklaring** utan otillbörligt dröjsmål
- **Rätt att få beslutet omprövat av människa**
- Plattformen måste **bevisa objektiva skäl** om avstängning sker efter att arbetaren utövat direktivets rättigheter

### 7.6 Förhandlingsrätt (svensk modell)
- Plattform som arbetsgivare **ska förhandla** med arbetstagarorganisation före införande/ändring av automatiska system
- Om >250 anställda — plattformen betalar expertkostnad åt facket

### 7.7 Jurist-frågor
1. Är Spicks städare "plattformsarbetare" enligt PWD även om F-skattade?
2. Spicks auto-tilldelning (auto-delegate, matching-wrapper) — kräver mänsklig oversight redan nu?
3. Spicks kvalitetskontroll (betyg, avstängning) — processkrav före 2 dec 2026?
4. Hur förbereder sig Spick optimalt under remissperioden för SOU 2026:3?
5. Kräver PWD Art 15 rapportering till myndighet redan idag?

---

## 8. Konkurrent-villkor (publika)

### 8.1 Hemfrid (anställningsmodell)
- RUT: Ombud, ansöker för kund. Kund betalar för nekad RUT-del.
- Betalning: Efterhandsfakturering
- Dispute: 48h reklamationsfrist, möjlighet att avhjälpa, sedan prisavdrag, sist ARN
- Försäkring: Ansvarsförsäkring + transportansvar
- GPS/foto: **Ingenting i publika villkor**

### 8.2 Vardagsfrid (anställningsmodell)
- RUT: Direkt på faktura. **300 kr adminavgift om RUT nekas**
- Betalning: 20:e månad, 10 dagars frist. 60 kr påminnelseavgift
- Dispute: **24h reklamationsfrist** (striktast). Efter 10 dagar → kunden förlorar rätten
- Försäkring: Ansvarsförsäkring + polis-bakgrundskontroll + sekretessavtal
- GPS/foto: **Ingenting**

### 8.3 Städade Hem (anställningsmodell)
- RUT: Kunden ansvarig för sitt tak. Företaget kräver kund om SKV nekar
- Betalning: 15:e varje månad, 15 dagar
- Dispute: Senast 10 arbetsdagar
- Försäkring: Ansvarsförsäkring + låsbytesförsäkring
- GPS/foto: **Ingenting**

### 8.4 Hjälper.se (plattformsmodell — närmast Spick)
- RUT: Nämns, otydligt vem som är ombud
- Betalning: Faktura 10 dagar, 11% dröjsmålsränta, 25 kr fakturaavgift
- Dispute: **24h reklamationsfrist**
- Försäkring: Ansvars- och personalförsäkring hos IF
- GPS/foto: **Ingenting**

### 8.5 Städia, Samhall, HomeQ, Städgruppen
Inga signifikanta publika villkor tillgängliga för forskning.

### 8.6 Jämförelse-tabell
| Aspekt | Hemfrid | Vardagsfrid | Städade Hem | Hjälper.se | **Spick (plan)** |
|---|---|---|---|---|---|
| Struktur | Anställda | Anställda | Anställda | Plattform | Plattform |
| Reklamationsfrist | 48h | 24h | 10 dagar | 24h | **24h+7d paus** |
| RUT-risk vid avslag | Kund | Kund (+300 kr) | Kund | Oklart | **Städare** |
| GPS/foto-bevis | Nej | Nej | Nej | Nej | **Planerat** |
| Split-payment | Nej | Nej | Nej | Oklart | **Planerat** |
| Försäkring | Ja | Ja | Ja | Ja | **Oklart** |

**Observation:** Spick är unik med GPS + foto + tvåstegs-payout. Juridisk pre-granskning extra kritisk.

---

## 9. Prioriterade jurist-frågor (sammanfattning)

### Klass A — Blockerande innan produktion
1. Är Spick **utförare** eller **förmedlare** hos Skatteverket? (Avgör hela RUT-modellen)
2. Är tvåstegs-payout förenlig med **PWD-anställningspresumtionen** (Art 5)?
3. **IMY-incidentrapport** för befintliga 36 PNR-rader (3 kunder med klartext)?

### Klass B — Före Fas 7.5 RUT-relansering
4. Var registreras städaren vs Spick som "utförare" vs "ombud"?
5. **DPIA** för PNR + GPS + foto enligt Art 35?
6. Obligatoriska klausuler i uppdragsavtal städare?

### Klass C — Strategiska, 6-12 månader
7. Spicks auto-delegate — omprövningsflöde enligt PWD Art 11?
8. SOU 2026:3 remiss — behöver Spick lämna yttrande?
9. 75 000 kr-takets status 2027 — riskanalys?

---

## 10. Begränsningar i denna research

1. Verbatim lagtext från 67 kap. 11-19 § IL ej hämtad via automatisk research
2. Skatterättsnämndens förhandsbesked om plattformar ej systematiskt sökta
3. Arbetsdomstolens domar om F-skatt/anställningsfråga för plattformsarbetare ej granskade
4. Fullständig PWD-text verifierades partiellt via sekundärkällor
5. Konkurrenters icke-publika avtal (städar-uppdragsavtal) ej tillgängliga
6. 75 000 kr-takets permanenta status 2026 har potentiell diskrepans mellan källor

---

## 11. Källhänvisningar

### EU-rätt
- [Directive (EU) 2024/2831](https://eur-lex.europa.eu/eli/dir/2024/2831/oj) — Platform Work Directive
- [Consolidated text 02024L2831-20241111](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024L2831-20241111)

### Svensk lagstiftning
- [Inkomstskattelag (1999:1229)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/inkomstskattelag-19991229_sfs-1999-1229/), 67 kap. 11-19 §§
- [Lag (2009:194)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2009194-om-forfarandet-vid-skattereduktion_sfs-2009-194/)
- [Konsumenttjänstlag (1985:716)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/konsumenttjanstlag-1985716_sfs-1985-716/)
- [Kommittédirektiv 2024:116](https://lagen.nu/dir/2024:116) — Utredning om plattformsdirektivet
- [SOU 2026:3](https://www.regeringen.se/rattsliga-dokument/statens-offentliga-utredningar/2026/01/sou-20263/)
- Dataskyddslagen (2018:218), 3 kap. 10 §
- Bokföringslagen (1999:1078), 7 kap. 2 §

### Myndighetsvägledning
- [Skatteverket — Rot och rut](https://www.skatteverket.se/foretag/skatterochavdrag/rotochrut.4.2ef18e6a125660db8b080002674.html)
- [Skatteverket — SKV 4854 Begäran genom ombud](https://www.skatteverket.se/foretag/etjansterochblanketter/blanketterbroschyrer/blanketter/info/4854.4.46ae6b26141980f1e2d3fd1.html)
- [IMY — Känsliga personuppgifter](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/introduktion-till-gdpr/personuppgifter/kansliga-personuppgifter/)
- [IMY — Platstjänster (GPS) på jobbet](https://www.imy.se/verksamhet/dataskydd/vi-guidar-dig/integritet-pa-jobbet/sa-far-du-som-arbetsgivare-anvanda-platstjanster-gps/)

### Konkurrent-villkor
- [Hemfrid Terms of Agreement](https://www.hemfrid.se/en/terms-of-agreement)
- [Vardagsfrid Allmänna villkor](https://vardagsfrid.se/allmanna-villkor/)
- [Städade Hem](https://stadadehem.se/allmanna-villkor)
- [Hjälper.se](https://hjalper.se/villkor-stadning/)

### Akademisk/branschanalys
- [CMS — Platform Work Directive analysis](https://cms.law/en/aut/legal-updates/from-gig-to-guarantee-how-the-eu-is-transforming-platform-work)
- [Mannheimer Swartling — Platform Directive Sweden](https://www.mannheimerswartling.se/en/insights/implementation-of-the-platform-directive-in-sweden/)

---

## 12. Nästa steg

1. **Jurist-möte** — bok 2-3h med jurist med erfarenhet av skatterätt + plattformsarbete
2. Skicka detta dokument som underlag 48h före mötet
3. Fokus på Klass A-frågor (3 st)
4. Efter möte: dokumentera svar + uppdatera `docs/sanning/rut.md`
5. Starta Fas 7.5-implementation enligt verifierade beslut

**Rekommenderad jurist-profil:**
- Skatterätt (RUT, F-skatt)
- Arbetsrätt (EU PWD, SOU 2026:3)
- GDPR (IMY-tillsyn)
- Erfarenhet av plattforms-ekonomi (Uber/Taskrabbit/Foodora-ärenden)

---

## Ändringslogg

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-24 | Initial research efter Farhads mandat | Claude |
