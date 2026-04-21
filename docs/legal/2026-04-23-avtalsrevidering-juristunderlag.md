# Spick — Avtalsrevidering: Juristunderlag

**Datum:** 2026-04-23
**Uppdragsgivare:** Farhad Haghighi, Haghighi Consulting AB (559402-4522), bifirma Spick
**Version:** 1.0 (utkast för juristgranskning)
**Repo-path:** `docs/legal/2026-04-23-avtalsrevidering-juristunderlag.md`

---

## Del 1: Uppdrag till juristen

### 1.1 Vad detta dokument är

Detta är ett strukturerat granskningsunderlag med färdiga textförslag för revidering av Spicks avtalsportfölj (uppdragsavtal, kundvillkor, integritetspolicy + nytt personuppgiftsbiträdesavtal). Syftet är att ge juristen allt material som behövs för en fokuserad genomgång — inte en öppen rådgivning från noll.

### 1.2 Vad som begärs

**Scope:** Granska föreslagna textändringar i Del 4-6 nedan mot:

1. Avtalslagens §36 (oskälighetsprövning) i plattformskontext näringsidkare→näringsidkare
2. EU-plattformsdirektivet 2024/2831 (ska vara genomfört i svensk rätt senast 2 december 2026)
3. GDPR art. 28 (personuppgiftsbiträdesavtal)
4. RUT-regelverket (lagen om förfarandet vid skattereduktion för hushållsarbete, HUSFL)
5. Konsumenttjänstlagen + konsumentskyddslagstiftning
6. Relevant svensk praxis (särskilt AD 2022 nr 45, Svea Hovrätt T 9821-17)

**Leverans från juristen:** Kommentar på varje specifik fråga i Del 7, markering av formuleringar som behöver justeras, samt riskbedömning av plattformsdirektivets genomslag för Spicks affärsmodell.

**Tidsram:** Leverans inom 5-10 arbetsdagar.

**Budgetram:** Cirka 15-25 timmars arbete, 25 000–45 000 kr + moms. Om juristen bedömer att scope behöver utökas — be om offert innan arbete påbörjas.

### 1.3 Vad juristen INTE behöver göra

- Skriva om avtalen från grunden — textförslagen finns färdiga att kommentera
- Göra en strukturell genomgång av affärsmodellen
- Rådgivning om prissättning, pricing strategy eller kommersiella villkor
- Skriva ett nytt personuppgiftsbiträdesavtal från scratch — förslag finns i Del 6

---

## Del 2: Bakgrund

### 2.1 Om Spick

Haghighi Consulting AB (559402-4522), bifirma Spick (godkänd av Bolagsverket 2 april 2026), driver plattformstjänsten spick.se. Spick tillhandahåller städtjänster till privatpersoner (RUT-berättigade tjänster) och företag genom ett nätverk av underleverantörer — enskilda städare med F-skatt samt städfirmor.

**Affärsmodell:**
- Kund bokar via spick.se, betalar till Spick via Stripe
- Spick matchar kund med underleverantör via geografisk algoritm (PostGIS)
- Städaren utför arbetet
- Spick tar 12% provision, betalar ut resten till städaren via Stripe Connect
- Vid RUT-berättigade tjänster ansöker Spick om RUT-utbetalning hos Skatteverket i eget namn

**Driftstatus (april 2026):**
- Stripe LIVE, full E2E bokningsflöde i produktion
- RUT-ombudsgodkänt av Skatteverket 13 april 2026
- Enskilda städare signade, inga i aktiv verksamhet ännu
- Tre företag registrerade i system: GoClean Nordic, Rafa Allservice AB, Haghighi Consulting
- **Rafa-pilot pending** — första skarpa B2B-samarbetet

**GA-mål:** 1 november 2026.

### 2.2 Varför revidering nu

Revideringen triggades av en audit 22 april 2026 som upptäckte fyra öppna frågor i uppdragsavtalet. Vid djupare research upptäcktes ytterligare frågor som gör en helhetsrevidering mer motiverad än punktlagning:

1. Avtalet säger 17% provision för privatuppdrag / 12% för företagsuppdrag — men prod kör 12% flat (pågående diskrepans)
2. Avtalet saknar uttrycklig hantering av RUT-avslag
3. §13 "Ändringar" är tunn och saknar struktur för ensidig ändringsrätt
4. Signatur loggas inte i databas (ingen `terms_accepted_at`, ingen `terms_version`)
5. Inget personuppgiftsbiträdesavtal finns trots att städare behandlar kundens personuppgifter
6. Kringgåendeklausul i §9 saknar karens, utköpsrätt, påföljd
7. Fotografier från uppdrag — licensfrågan oreglerad
8. Försäkringsregress vid skada oreglerad
9. EU-plattformsdirektivet 2024/2831 måste implementeras i Sverige senast 2 december 2026 — en månad efter Spicks GA

---

## Del 3: Nuvarande avtalsportfölj — kritiska observationer

### 3.1 Uppdragsavtalet (underleverantör ↔ Spick)

**Befintlig struktur:** 15 sektioner, version "16 april 2026".

**Styrkor:**
- Tydlig grundprincip om självständig näringsidkare-status
- §2 med 6 tydliga friheter (korrekt positionering mot anställningspresumtion)
- §5.3 självfakturering enligt ML 11 kap — korrekt
- §5.5 RUT-ansökan i Spicks namn — korrekt
- §5.6 tvåstegs RUT-utbetalning — text OK, saknar bara avslagshantering
- §6 försäkring med 90-dagars introduktionsperiod — pragmatiskt
- §7.1 GPS-verifiering + §7.2 fotodokumentation — bra för tvister

**Svagheter:**
- §5.1 provisionssatser (17%/12%) matchar inte produktionskoden (12% flat)
- §5.7 numrerat som Reklamation — RUT-avslag saknas helt
- §9 kringgåendeklausul svag ("under avtalstiden", ingen karens, ingen påföljd)
- §12 ansvarsfördelning för ensidig på underleverantören
- §13 otillräcklig för ensidig ändringsrätt enligt §36-praxis
- Fotografier i §7.2 saknar licensklausul för Spick
- Signatur-acceptans loggas inte i DB
- Saknar GDPR/personuppgiftsbiträdes-hantering

### 3.2 Kundvillkoren (kund ↔ Spick)

**Befintlig struktur:** 12 sektioner, version "16 april 2026".

**Styrkor (viktigt):**
- §4.3 RUT-avdrag uppfyller redan Konsumentverkets informationsplikt — explicit "du är skyldig att betala det återstående beloppet" vid avslag
- §5.2 ångerrätt enligt distansavtalslagen korrekt hanterad
- §5.3 städarens förhinder + auto-delegation välstrukturerad
- §6 reklamation inom 48h
- §7 ansvarsbegränsning till beloppet för aktuell bokning
- §11 ARN-hänvisning korrekt

**Svagheter:**
- §4.3 saknar samarbetsskyldighet för kunden (lämna korrekta uppgifter för RUT-ansökan)
- §4.3 saknar uttrycklig återkravsrätt om kunden orsakat avslaget genom felaktiga uppgifter
- §7 saknar force majeure-klausul uttryckligen
- §5.3 nämner 1 tim svarstid men oklart vad händer vid missat svar vid auto-delegation-flöde

### 3.3 Integritetspolicyn

**Befintlig struktur:** 12 sektioner, version "16 april 2026".

**Styrkor:**
- Tydlig personuppgiftsansvarig-position
- Korrekt art. 6-grund-mappning i §3
- Välstrukturerad retention-tabell i §5
- Explicit hantering av GPS + foton (ny data)
- Tredjelandsöverföring via SCC / Data Privacy Framework noterat
- §6 auto-delegation-samtycke välstrukturerat

**Svagheter:**
- Oklart om städare är personuppgiftsbiträde eller självständigt ansvarig — rollen definieras inte
- Retentionstid 7 år följer bokföringslagen men preskription för avtalsfordringar är 10 år (potentiell konflikt)
- Ingen explicit hänvisning till personuppgiftsbiträdesavtal

---

## Del 4: Reviderat uppdragsavtal (textförslag)

Nedan listas varje föreslagen textändring med: nuvarande text → ny text → motivering → fråga till jurist.

### 4.1 §5.1 Provision — FRÅGA 1

**Nuvarande text:**
> Spick tar en förmedlingsavgift (provision) på varje genomfört uppdrag:
> - Privatuppdrag: 17 % av jobbvärdet
> - Företagsuppdrag: 12 % av jobbvärdet
>
> Ändring av provisionssats meddelas skriftligen minst 30 dagar i förväg.

**Föreslagen text:**
> Spick tar en förmedlingsavgift (provision) om 12 % av jobbvärdet på varje genomfört uppdrag, oavsett om uppdraget utförts åt privatkund eller företagskund.
>
> Spick har rätt att differentiera framtida provisionssatser per tjänstetyp, kundkategori eller volym, förutsatt att ändring meddelas skriftligen minst 30 dagar i förväg enligt §13. Underleverantören har rätt att säga upp avtalet med omedelbar verkan utan karens om ändringen väsentligt påverkar Underleverantörens ersättning.

**Motivering:**
- Fråntar den befintliga diskrepansen mellan avtal och drift
- Bygger in flexibilitet för framtida differentiering utan att låsa konkret struktur nu
- Uppsägningsrätten utan karens är nödvändig för att klausulen ska vara hållbar enligt §36 praxis (kompensatorisk balansering)

**Historisk exponering:** Ingen städare har ännu utfört skarpt arbete mot 17%-avtalet, enligt Farhads verifiering. Inga retroaktiva krav är därmed aktuella. Men städare som redan signat det gamla avtalet behöver acceptera v2026.04.23 innan nästa uppdrag.

**Fråga 1 till jurist:**
Är det juridiskt tillräckligt att be befintliga registrerade städare acceptera v2026.04.23 innan nästa uppdragstilldelning, eller krävs explicit dokumenterad kompensationshantering? Om städaren vägrar acceptera nya villkoren — kan Spick ensidigt säga upp befintligt avtal enligt §11 med 30 dagars varsel utan andra juridiska åtgärder?

### 4.2 Ny §5.7 RUT-avslag (gamla §5.7 Reklamation blir §5.8) — FRÅGA 2

**Nuvarande text:**
Ingen motsvarande paragraf existerar.

**Föreslagen ny §5.7:**
> **5.7 RUT-avslag och återkrav**
>
> Om Skatteverket avslår hela eller delar av RUT-ansökan för ett genomfört uppdrag utgår Steg 2-utbetalningen enligt §5.6 i motsvarande omfattning. Underleverantören har ingen rätt till kompensation för utebliven Steg 2-utbetalning när avslaget beror på:
>
> - Slutkundens förhållanden (saknat RUT-utrymme, felaktigt personnummer, redan utnyttjad kvot hos annan utförare, ålder, skatterättslig hemvist eller andra behörighetshinder)
> - Att slutkunden inte slutfört sin del av processen (exempelvis inte bekräftat uppgifter i e-tjänsten)
> - Skatteverkets skönsbedömning av tjänstens RUT-berättigande
> - Andra orsaker utanför Spicks kontroll
>
> Spick kan, efter egen bedömning, besluta om frivillig kompensation till Underleverantören när avslaget bevisligen beror på dokumenterat administrativt fel från Spicks sida (exempelvis felaktig inmatning av personnummer eller försenad inlämning till Skatteverket orsakad av Spick). Sådant beslut fattas av Spick från fall till fall och skapar ingen rätt eller prejudikat för Underleverantören.
>
> Spick informerar Underleverantören skriftligen så snart besked från Skatteverket mottagits. Meddelandet anger avslagets omfattning och, i den utsträckning Spick får dela informationen, Skatteverkets angivna skäl.
>
> Om Skatteverket efter utbetald skattereduktion återkräver beloppet (exempelvis vid upptäckt av felaktiga uppgifter från slutkund) har Spick rätt att motsvarande minska framtida utbetalningar till Underleverantören, under förutsättning att återkravet inte beror på Spicks eget fel i ansökningsförfarandet.

**Numreringsändring:** Nuvarande §5.7 "Reklamation och kvalitetsansvar" omnumreras till **§5.8**. Ingen textändring i den paragrafen.

**Motivering:**
- Mellanvägspolicy enligt Farhads beslut 2026-04-23
- Objektiva kriterier för när kompensation *kan* ges (inte vaga formuleringar) — stärker positionen vid §36-prövning
- "Så snart besked mottagits"-formulering istället för specifik tidsfrist — låser inte Spick vid en tid som den tekniska infrastrukturen inte kan leverera ännu (Fas 7.5 RUT-infrastruktur pending)
- Explicit återkravsrätt mot kommande utbetalningar dokumenteras
- Skyddar Spick från kundbaserade avslag (som är majoriteten) utan att vara hårdhänt vid egna fel

**Fråga 2 till jurist:**
(a) Håller formuleringen "Spick kan efter egen bedömning" för §36-prövning, eller behövs ytterligare objektivering? (b) Är återkravsrätten mot framtida utbetalningar (motsvarande svensk kvittningsrätt) hållbar även när Underleverantören redan lämnat plattformen, eller bör en särskild fordringsrätt formuleras? (c) Finns bevisbördekrav som bör specificeras — vem bevisar vad vid tvist om "administrativt fel från Spicks sida"?

### 4.3 §6 Försäkring + ny §6.4 Försäkringsregress — FRÅGA 3

**Nuvarande §6:** Bra i grunden. Ingen ändring av §6.1-6.3 föreslås.

**Föreslagen ny §6.4:**
> **6.4 Försäkringsregress och ansvarsfördelning vid skada**
>
> Vid skada på slutkundens egendom eller person i samband med uppdrag gäller följande:
>
> a) **Vanlig vårdslöshet, skada inom Underleverantörens försäkringstak:** Underleverantörens ansvarsförsäkring reglerar skadan. Spick bistår med dokumentation och kontakt med försäkringsbolag. Ingen regress från Spick mot Underleverantören utöver eventuell självrisk.
>
> b) **Grov oaktsamhet eller uppsåt:** Spick och dess försäkringsgivare har full regressrätt mot Underleverantören för samtliga kostnader som uppkommer till följd av skadan, inklusive ersättning till slutkund, rättegångskostnader och administrativ hantering. Regressrätten är inte begränsad till försäkringsbelopp.
>
> c) **Skada över försäkringstak vid vanlig vårdslöshet:** Den del av skadan som överstiger Underleverantörens försäkringstak hanteras enligt svensk skadeståndsrätt. Spick ansvarar inte för den del av skada som inte täcks av Underleverantörens försäkring.
>
> Bedömningen av vårdslöshetsgrad baseras på svensk skadeståndsrättslig praxis. Vid oenighet avgörs frågan enligt §14.

**Motivering:**
- Trestegsmodell som är pro-Spick där det räknas (stora skador, medveten misskötsel) och mjukt där det behövs (rekrytering, retention)
- Följer svensk skadeståndsrätt (uppsåt/grov oaktsamhet = skärpt ansvar)
- Ger Spick verktyg vid verkliga tvister utan att tömma städarbasen

**Fråga 3 till jurist:**
(a) Är formuleringen "full regressrätt... inte begränsad till försäkringsbelopp" vid grov oaktsamhet/uppsåt hållbar, eller behöver proportionalitetsbegränsning byggas in? (b) Bör definitionen av "grov oaktsamhet" förtydligas i avtalet eller är hänvisning till svensk skadeståndsrättspraxis tillräckligt? (c) Bör tvist om vårdslöshetsgrad hanteras genom försäkringsgivarens bedömning eller direkt via §14 tvistlösning?

### 4.4 §7.2 Fotodokumentation + ny §7.3 Licens för fotografier — FRÅGA 4

**Nuvarande §7.2:** Bra i grunden. Ingen ändring av befintlig text.

**Föreslagen ny §7.3:**
> **7.3 Licens för fotografier och dokumentation**
>
> Underleverantören behåller upphovsrätten till fotografier som tas i samband med uppdrag. Underleverantören ger Spick en evig, royaltyfri, icke-exklusiv, global, överlåtbar licens att använda, bearbeta, anonymisera och publicera sådana fotografier för följande ändamål:
>
> - Kvalitetssäkring och tvistlösning
> - Produktutveckling och intern utbildning
> - Marknadsföring och kommersiell användning, under förutsättning att bilden:
>     - inte innehåller identifierbara personer (kund, städare eller andra)
>     - inte visar läsbara adresser, dokument, kod, smycken eller andra personliga identifierare
>     - inte innehåller kundens egendom på ett sätt som möjliggör identifiering av slutkunden
>
> Underleverantören har rätt att begära att Spick inte använder en specifik bild för marknadsföring framöver. Sådan begäran påverkar inte bilder som redan publicerats i befintliga kampanjer fram tills naturligt kampanjslut.
>
> Licensen enligt denna paragraf gäller oberoende av om avtalet mellan parterna fortfarande är i kraft.

**Motivering:**
- Pro-Spick: maximalt bred användningsrätt
- Men begränsat till anonymiserade bilder — skyddar kunden (som inte är part i avtalet) och efterlever GDPR/integritetspolicyn
- Återkallelserätt är begränsad (bara framåtverkande) vilket skyddar pågående marknadsföring
- Standardkonstruktion i plattformsavtal (Airbnb, Uber m.fl.)

**Fråga 4 till jurist:**
(a) Är "evig, överlåtbar licens" hållbart eller bör begränsningar byggas in för skälighet enligt §36? (b) Är återkallelseskrivningen för begränsad — är det juridisk skillnad i Sverige mellan återkalla licens framåt och återkalla helt vid personliga porträttbilder även om de är anonymiserade? (c) Behövs explicit hänvisning till integritetspolicyn och GDPR i paragrafen?

### 4.5 Ny §9.7 Kringgåendeklausul + utköpsrätt — FRÅGA 5

**Nuvarande §9 kringgåendeklausul:**
> Inte aktivt rekrytera Spick-förmedlade kunder utanför plattformen under avtalstiden

**Föreslagen omarbetning — befintlig bulletpunkt tas bort från §9 och ersätts med ny §9.7:**
> **9.7 Kringgående av plattformen**
>
> Underleverantören får inte, under avtalstiden eller under en karens om 12 månader efter avtalets upphörande, utföra städtjänster direkt eller genom annan aktör till en slutkund som först förmedlats via Spick, annat än genom någon av följande vägar:
>
> a) **Utköpsrätt:** Underleverantören kan utöva rätt att ta över kundrelationen genom att betala Spick en förmedlingslösen motsvarande 6 månaders genomsnittlig provision från aktuell slutkund, dock minst 2 000 kr per kund. Efter erlagd förmedlingslösen upphör karensen för den specifika kunden.
>
> b) **Kundens initiativ utan påverkan:** Om slutkunden självständigt kontaktar Underleverantören för fortsatt samarbete utanför plattformen och Underleverantören omedelbart anmäler detta skriftligen till Spick, har Spick 14 dagar att utöva sin förmedlingsrätt genom att erbjuda slutkunden fortsatt tjänst via plattformen. Om Spick inte utövar förmedlingsrätten inom denna tid förfaller Spicks anspråk avseende aktuell slutkund.
>
> Vid brott mot denna paragraf har Spick rätt till vite om 10 000 kr per konstaterat tillfälle, samt ersättning för dokumenterad skada utöver vitet. Underleverantören ska på begäran lämna information om pågående kundkontakter som kan omfattas av klausulen.

**Motivering:**
- 12 månaders karens är gränslinjen i svensk praxis för vad som står sig mot §36
- Utköpsrätten gör klausulen proportionerlig — städaren har alltid en väg framåt, vilket är kritiskt för oskälighetsbedömning
- Vitesbelopp är specifikt och förutsägbart (viktigt för genomdrivning)
- Anmälningsplikt + förmedlingsrätt ger Spick faktisk kontroll istället för bara formellt förbud
- Standardmodell från franchising-avtal och seriösa plattformsavtal

**Fråga 5 till jurist:**
(a) Är 12 månaders karens hållbar mot §36 vid §38 avtalslagen (konkurrensbegränsning)? (b) Är utköpslösen på 6 mån genomsnittlig provision / minst 2 000 kr rimlig, eller kan formuleringen angripas som oskäligt betungande? (c) Vitesbeloppet 10 000 kr — konsekvent med svensk skiljedoms- och domstolspraxis, eller bör det justeras? (d) Kan Spick hävda klausulen även om Underleverantören inte längre har F-skatt men fortfarande utför arbete hos kunden som anställd hos ett annat städbolag?

### 4.6 §13 Ändringar — omarbetad — FRÅGA 6

**Nuvarande §13:**
> Väsentliga ändringar meddelas via e-post minst 30 dagar innan ikraftträdande.

**Föreslagen ny §13:**
> **§13 Ändringar av avtalet**
>
> **13.1 Spicks ändringsrätt.** Spick har rätt att ensidigt ändra villkoren i detta avtal, inklusive provisionssatser, tekniska krav och tjänstebeskrivningar, vid:
>
> a) Ändringar i tvingande lagstiftning eller myndighetsbeslut som påverkar tjänsten
> b) Väsentliga förändringar i Spicks kostnadsstruktur (t.ex. Stripe-avgifter, regelverksförändringar, infrastrukturkostnader)
> c) Anpassning till utveckling av tjänstens funktionalitet eller säkerhet
> d) Marknadsmässiga förändringar som påverkar tjänstens kommersiella förutsättningar
>
> Ändringen ska vara proportionerlig i förhållande till skälen och får inte snedvrida balansen i avtalet till Underleverantörens väsentliga nackdel utan motsvarande möjlighet att säga upp avtalet.
>
> **13.2 Meddelande.** Väsentliga ändringar meddelas skriftligen via e-post till den adress Underleverantören registrerat hos Spick, minst 30 dagar före ikraftträdande. Meddelandet ska ange:
>
> - Vilka villkor som ändras
> - Skälen för ändringen
> - Ikraftträdandedatum
> - Underleverantörens rätt att säga upp avtalet vid invändning
>
> **13.3 Acceptans och uppsägning.** Om Underleverantören fortsätter att ta emot uppdrag via plattformen efter ikraftträdandedatumet utgör detta acceptans av ändringen. Om Underleverantören inte accepterar ändringen har Underleverantören rätt att säga upp avtalet med omedelbar verkan utan karens fram till ikraftträdandedatumet. Vid sådan uppsägning gäller §11 avseende slutbetalning för redan genomförda uppdrag.
>
> **13.4 Redaktionella ändringar.** Icke-väsentliga ändringar (språkliga förtydliganden, strukturella omarbetningar som inte påverkar materiella rättigheter, uppdateringar av kontaktuppgifter) kan göras utan 30-dagarsvarsel men ska kommuniceras vid nästa inloggning.
>
> **13.5 Versionshantering.** Varje version av avtalet märks med versionsdatum. Underleverantörens accepterade version lagras i Spicks system tillsammans med tidpunkt för acceptans.

**Motivering:**
- Objektivt rättfärdigade ändringsgrunder (a-d) — står bättre emot §36 än generell "väsentliga ändringar meddelas"
- Proportionalitetskravet i 13.1 sista meningen är viktig balanspunkt
- Uppsägningsrätten utan karens i 13.3 är nödvändig kompensation för ensidig ändringsrätt
- 13.5 versionshantering möjliggör signatur-DB-logg (teknisk implementering beskrivs i Del 8)
- Distinktionen materiella vs redaktionella ändringar undviker att Spick behöver 30-dagarsvarsel för triviala justeringar

**Fråga 6 till jurist:**
(a) Är (a-d) tillräckligt konkreta som objektiva ändringsgrunder, eller behövs ytterligare precisering? (b) Är "fortsatt användning = acceptans" hållbart som tyst acceptans, eller bör aktiv re-accept krävas vid materiella ändringar? Svensk avtalsvillkorsdirektiv-praxis har underkänt tyst acceptans i B2C — gäller motsvarande i B2B-plattform? (c) Behövs explicit hänvisning till konkurrensbegränsande lag vid ändring av §9.7?

### 4.7 Ny §15 Personuppgiftsbiträdesförhållande — FRÅGA 7

**Föreslagen ny §15:**
> **§15 Behandling av personuppgifter**
>
> **15.1 Roller.** Spick är personuppgiftsansvarig för slutkundens personuppgifter som samlas in via plattformen. Underleverantören får genom avtalet tillgång till viss kunddata (namn, adress, kontaktuppgifter, eventuella tillträdesinstruktioner) för att kunna utföra uppdraget.
>
> **15.2 Personuppgiftsbiträdesavtal.** Underleverantörens behandling av slutkundens personuppgifter regleras separat i Personuppgiftsbiträdesavtalet (PuB-avtalet) som utgör integrerad bilaga till detta avtal. Genom att acceptera detta avtal accepterar Underleverantören även PuB-avtalet.
>
> **15.3 Spicks instruktionsrätt.** Underleverantören får endast behandla slutkundens personuppgifter enligt Spicks dokumenterade instruktioner och endast i den utsträckning som krävs för att utföra uppdraget. Underleverantören får inte lagra kundens uppgifter efter uppdragets slutförande utöver vad som krävs enligt lag.
>
> **15.4 Incidentrapportering.** Vid säkerhetsincident eller personuppgiftsincident ska Underleverantören omedelbart, dock senast inom 24 timmar, rapportera detta till Spick via e-post till hello@spick.se.
>
> **15.5 Återlämning/radering.** Vid avtalets upphörande ska Underleverantören omgående radera eller återlämna samtliga personuppgifter som erhållits genom plattformen, utom i den mån lagring krävs enligt lag.

**Motivering:**
- GDPR art. 28 kräver skriftligt personuppgiftsbiträdesavtal
- Utan denna paragraf bryter Spick mot GDPR oavsett resten av dokumentationen
- Kompletterande PuB-avtal behandlas i Del 6

**Fråga 7 till jurist:**
(a) Är städaren rätt klassificerad som personuppgiftsbiträde, eller bör hen klassificeras som gemensam personuppgiftsansvarig enligt GDPR art. 26 (faktiska förhållanden kan tala för det senare när städaren självständigt hanterar uppgifterna i kundens hem)? (b) Vad är konsekvensen för ansvarsfördelningen beroende på klassificering?

### 4.8 §14 Tillämplig lag — precisering — FRÅGA 8

**Nuvarande §14:**
> Svensk lag. Tvister avgörs i första hand genom förhandling, i andra hand av svensk allmän domstol.

**Föreslagen ny §14:**
> **§14 Tillämplig lag och tvistlösning**
>
> Detta avtal regleras av svensk lag. Parterna ska i första hand söka lösa tvister genom direkta förhandlingar. Om förhandling inte leder till lösning inom 30 dagar avgörs tvisten av Stockholms tingsrätt som första instans, såvida inte tvisten lämpar sig för Allmänna reklamationsnämnden (ARN) vid konsumentärenden.

**Motivering:**
- Specifikation av Stockholms tingsrätt som exklusivt forum ger förutsägbarhet
- Uteslutande av skiljeklausul är pro-Spick av tre skäl: (1) billigare vid egna stämningsärenden, (2) standardavtalskliffrance skyddar inte Spick från skiljeklausulens ensidighet som §36-argument, (3) hemmaplan för Spick (Solna → Stockholms tingsrätt)
- ARN-hänvisning för konsumenträttsärenden är formellt korrekt men påverkar egentligen bara kundvillkoren

**Fråga 8 till jurist:**
Är Stockholms tingsrätt som exklusivt forum invändningsfritt, eller bör forumklausulen mildras med "svensk allmän domstol i den ort där Spick har sitt säte" för att undvika forumklausul-angrepp?

---

## Del 5: Reviderade kundvillkor — ändringar

Kundvillkoren är i grunden väl strukturerade. Tre tillägg föreslås.

### 5.1 §4.3 RUT-avdrag — tillägg om samarbetsskyldighet och återkrav

**Nuvarande text:**
> Spick ansöker om RUT-utbetalning hos Skatteverket för din räkning. Du betalar 50 % av arbetskostnaden. Om Skatteverket avslår ansökan helt eller delvis (t.ex. om du nått taket på 75 000 kr/år) är du skyldig att betala det återstående beloppet.

**Föreslaget tillägg efter nuvarande text:**
> **Ditt samarbetsåtagande:** Du ansvarar för att uppgifter du lämnar till Spick (personnummer, ägarförhållande till bostaden, eventuell omfördelning till make/maka/sambo) är korrekta vid bokningstillfället. Spick ansöker om RUT baserat på de uppgifter du lämnat.
>
> **Fakturering vid avslag:** Om Skatteverket avslår RUT-ansökan helt eller delvis fakturerar Spick dig det återstående beloppet med 14 dagars betalningsvillkor. Om betalning uteblir tillkommer dröjsmålsränta enligt räntelagen (8 %) samt eventuell påminnelse- och inkassoavgift.
>
> **Skatteverkets återkrav:** Om Skatteverket efter utbetald skattereduktion återkräver beloppet från Spick på grund av uppgifter du lämnat eller dina förhållanden (exempelvis felaktigt personnummer eller att du redan använt RUT-kvoten hos annan utförare) har Spick rätt att fakturera dig motsvarande belopp inom den preskriptionstid som gäller för avtalsfordringar (10 år).

**Motivering:**
- Förtydligar samarbetsskyldigheten — stärker Spicks position vid avslag
- Betalningsvillkor och ränta gör att Spick kan driva in utan ytterligare avtalsmoment
- Uttryckligt stöd för 10-årig preskription skyddar Spick mot sena återkrav från Skatteverket
- Svea Hovrätt T 9821-17-linjen följd: villkoret står i ursprungligt avtal, inte först på fakturan

**Fråga (ingår i Fråga 9 nedan).**

### 5.2 Ny §7.1 Force majeure

**Föreslagen ny §7.1 (före nuvarande §7-innehåll, som blir §7.2):**
> **7.1 Force majeure**
>
> Spick ansvarar inte för försening eller utebliven leverans av tjänst som orsakats av omständighet utanför Spicks rimliga kontroll, inklusive men inte begränsat till: strejk, lockout, brand, översvämning, pandemi, offentliga påbud, avbrott i allmän trafik, avbrott i teletjänster eller betalningsleverantörer, eller underleverantörens plötsliga förhinder vid sjukdom eller olycka.
>
> Vid force majeure informerar Spick dig så snart som möjligt och erbjuder antingen omboking, ersättare eller full återbetalning enligt §5.3.

**Motivering:**
- Uttryckligt skydd vid oförutsedda händelser
- Standardklausul — förväntas i plattformsavtal
- Hänvisar till befintlig §5.3 som redan hanterar städarens förhinder

### 5.3 §5.3 Auto-delegation — precisering vid tystnad

**Nuvarande text (utdrag):**
> Du har 1 timme att svara. Om du inte svarar går bokningen automatiskt till "välj själv"-läge.

**Föreslaget tillägg direkt efter denna mening:**
> Om du inte valt någon städare inom 4 timmar efter att "välj själv"-läge aktiverats, avbokar Spick uppdraget automatiskt och full återbetalning initieras inom 5–10 bankdagar.

**Motivering:**
- Nuvarande text stannar vid "välj själv"-läge utan att förklara vad som händer om kunden inte agerar
- Utan tidsfrist hänger bokningen i luften juridiskt
- 4 timmar är rimligt för kund att hantera
- Pro-Spick: möjliggör resursfrigöring istället för att resurser låses obegränsat

---

## Del 6: Integritetspolicy + nytt Personuppgiftsbiträdesavtal

### 6.1 Integritetspolicy — mindre tillägg

**§5 Retentionstider:** Lägg till rad:
> | Avtalsdokumentation (signerade villkor + signaturlogg) | Avtalstid + 10 år | Preskriptionstid för avtalsfordringar (Preskriptionslagen §2) |

**§4 Mottagare:** Lägg till rad efter "Städare / Kund":
> | **Underleverantör (via PuB-avtal)** | Behandling av kundens personuppgifter för uppdragets genomförande | Sverige |

**§6 Auto-delegation:** Oförändrad.

### 6.2 Nytt Personuppgiftsbiträdesavtal (PuB-avtal)

**Föreslås som separat dokument:** `pub-avtal-stadare.html` (eller sektion i uppdragsavtal.html)

**Struktur (skelett, komplett text efter juristgranskning):**

```
§1 Definitioner
§2 Personuppgiftsansvarig och biträde
§3 Behandlingens art, ändamål, typ av personuppgifter
§4 Skriftliga instruktioner
§5 Tystnadsplikt för behandlande personal
§6 Säkerhetsåtgärder (tekniska och organisatoriska)
§7 Anlitande av underbiträde (default: förbjudet utan skriftligt medgivande)
§8 Personuppgiftsincident (24h rapporteringsplikt)
§9 Bistå vid registrerads rättigheter (tillgång, radering, portabilitet)
§10 Bistå vid DPIA och förhandssamråd
§11 Tredjelandsöverföring (förbjuden utan SCC)
§12 Återlämning/radering vid avtalets upphörande
§13 Revision och granskningsrätt
§14 Ansvar och skadestånd
§15 Avtalstid (följer uppdragsavtalet)
```

**Rekommenderad källa för formuleringar:** EU-kommissionens standardavtalsklausuler för personuppgiftsbiträdesavtal. Dessa är färdiga mallar som rekommenderas av IMY.

**Fråga 9 till jurist:**
(a) Rekommendation om användning av EU:s standardavtalsklausuler vs svenska Datainspektionens mall vs egen-skriven? (b) Bör städaren klassas som personuppgiftsbiträde (Spick instruerar) eller som gemensam personuppgiftsansvarig? (c) Räcker det med ett PuB-avtal i svenska mot F-skattebolag, eller behövs särskild hantering för enskilda näringsidkare utan F-skattebolag?

---

## Del 7: Frågor till juristen — samlad lista

Frågorna är numrerade för enkel referens vid granskning.

**Fråga 1 (§5.1 Provision):** Tillräckligt med ny acceptans vid nästa uppdragstilldelning, eller krävs explicit kompensationshantering retroaktivt?

**Fråga 2 (§5.7 RUT-avslag):** (a) Håller "efter egen bedömning"-formuleringen för §36? (b) Är återkrav mot framtida utbetalningar hållbar även efter avtalets upphörande? (c) Bevisbördefördelning vid tvist om administrativt fel?

**Fråga 3 (§6.4 Försäkringsregress):** (a) Hållbar regressrätt utan beloppsbegränsning vid grov oaktsamhet? (b) Bör grov oaktsamhet definieras i avtalet? (c) Hantering vid tvist om vårdslöshetsgrad?

**Fråga 4 (§7.3 Fotolicens):** (a) "Evig, överlåtbar licens" hållbar? (b) Återkallelse av licens framåt — skillnad från helt återkallande? (c) GDPR-hänvisning i paragrafen?

**Fråga 5 (§9.7 Kringgående):** (a) 12 månaders karens hållbar? (b) Utköpslösens belopp rimlig? (c) Vitesbeloppet 10 000 kr rimlig? (d) Räckvidd när städaren inte längre har F-skatt?

**Fråga 6 (§13 Ändringar):** (a) Objektiva ändringsgrunder tillräckliga? (b) Tyst acceptans hållbar i B2B-plattform? (c) Konkurrensbegränsnings-hänvisning vid ändring av §9.7?

**Fråga 7 (§15 GDPR-roller):** Städare som personuppgiftsbiträde eller gemensam personuppgiftsansvarig?

**Fråga 8 (§14 Tvistlösning):** Stockholms tingsrätt exklusivt forum invändningsfritt?

**Fråga 9 (PuB-avtal):** (a) Mall-val (EU-kommissionen vs Datainspektionen vs egen)? (b) Roll-klassificering? (c) Hantering av enskilda näringsidkare utan AB?

**Fråga 10 (Plattformsdirektivet — strategisk):** Givet att EU-plattformsdirektivet 2024/2831 ska genomföras i Sverige senast 2 december 2026 med anställningspresumtion vid "kontroll och ledning" — vilken av följande åtgärder rekommenderas:

- (a) Ingen ändring, förlita sig på nuvarande friheter i §2 som motargument
- (b) Proaktiv mjukning av klausuler som kan tolkas som kontroll och ledning (prissättning, matchning-algoritm, uppförandekod)
- (c) Avvakta utredningens slutbetänkande och svensk genomförandelag innan strukturella ändringar

**Fråga 11 (Retroaktiv provisions-exponering):** Givet att produktionen kört 12% flat sedan Stripe LIVE medan avtalet säger 17/12 split — uppskatta juridisk exponering om första stämningen kommer från en städare som registrerat sig innan revidering av §5.1. Finns preskription eller annan rättsfigur som begränsar retroaktiva krav?

**Fråga 12 (Signatur-DB-logg):** Är textformuleringen "Underleverantörens accepterade version lagras i Spicks system" i föreslagen §13.5 tillräcklig för bevisvärde vid tvist om vilken version som accepterats, eller krävs starkare bevismekanism (BankID-signering av avtal, tidsstämpling via tredje part, etc.)?

---

## Del 8: Implementationsplan

### 8.1 Efter juristens svar

**Steg 1 — PR 1: Textrevisioner** (Claude Code, 1-2h):
- Uppdatera uppdragsavtal.html enligt jurist-kommenterade förslag
- Uppdatera kundvillkor.html enligt §4.3, §5.3, §7.1 tilläggen
- Uppdatera integritetspolicy.html med retentions- och mottagartillägg
- Bumpa "Senast uppdaterat"-stämpel till aktuellt datum
- Versionsnamn: v2026.05.XX (månadsdatum vid release)

**Steg 2 — PR 2: PuB-avtal** (separat commit, 2-3h):
- Skapa pub-avtal-stadare.html enligt jurist-rekommenderad mall
- Länk från uppdragsavtal §15 till PuB-dokumentet
- Länk från integritetspolicy §4 till PuB-dokumentet

**Steg 3 — PR 3: Signatur-DB-logg** (2-3h):
- Migration: lägg till kolumner `cleaners.terms_accepted_at TIMESTAMPTZ`, `cleaners.terms_version TEXT`, `cleaner_applications.terms_accepted_at TIMESTAMPTZ`, `cleaner_applications.terms_version TEXT`
- Uppdatera registrera-stadare.html med auto-fylld version + timestamp vid submit
- Backfill befintliga rader med `v2026.04.16` (gamla versionen) som default

**Steg 4 — Re-acceptans för befintliga städare** (workflow, 2-3h):
- Implementera "Villkoren har uppdaterats"-banner vid inloggning för befintliga städare
- Blockera nya uppdragstilldelningar tills re-acceptans klar
- Email-utskick till befintliga städarkonton med ändringssammanfattning
- Logga re-acceptans med ny `terms_version`

### 8.2 Tidsplan mot GA 1 november 2026

```
2026-04-23 (idag)  Dokument skickas till jurist
2026-05-03 (+10d)  Juristens svar tillbaka (typiska 5-10 arbetsdagar)
2026-05-10 (+17d)  PR 1 + PR 2 + PR 3 implementerade, deploy till prod
2026-05-15 (+22d)  Re-acceptans-workflow aktiverat för befintliga städare
2026-05-20 (+27d)  Rafa-pilot kan starta (tidigast)
2026-11-01          GA
2026-12-02          Plattformsdirektivet träder i kraft
```

**Kritisk observation:** Plattformsdirektivet träder i kraft 1 månad efter GA. Det finns fönster efter GA men innan direktiv-ikraftträdande att genomföra eventuella strukturella ändringar av affärsmodellen baserat på slutbetänkandet (som regeringen mottog 2026-01-12). Betänkandet bör läsas senast augusti 2026 för att ge marginal.

### 8.3 Retroaktiv exponerings-audit (parallellt med juridik-PR:er)

**SQL-fråga för att kvantifiera exponering:**

```sql
-- Antal privatbokningar genomförda av städare registrerade
-- med 17/12-avtal (= alla signerade före v2026.05.XX)
SELECT
  COUNT(DISTINCT b.id) AS antal_bokningar,
  COUNT(DISTINCT b.cleaner_id) AS antal_stadare,
  SUM(b.total_price) AS total_omsattning,
  SUM(b.total_price * 0.05) AS exponering_kr_5pct_diff
FROM bookings b
JOIN cleaners c ON b.cleaner_id = c.id
WHERE
  b.customer_type = 'privat'
  AND b.payment_status = 'paid'
  AND c.created_at < '2026-05-XX'  -- Datum för v2026.05.XX release
  AND b.created_at > c.created_at;
```

**Beslut baserat på exponering:**

- < 5 000 kr total: ingen åtgärd, acceptera som juridisk restrisk
- 5 000–25 000 kr: överväg preventiv kommunikation + goodwill-erbjudande vid enskilt krav
- \> 25 000 kr: proaktiv kontakt med berörda städare, dokumenterad överenskommelse om att övergå till 12% flat

---

## Del 9: Plattformsdirektiv-analys

### 9.1 Fakta om direktivet

EU-direktiv 2024/2831 antaget 23 oktober 2024. Sveriges genomförande senast 2 december 2026. Utredningens slutbetänkande avlämnat till regeringen 12 januari 2026 med förslag på ny "lag om plattformsarbete".

**Kärnpunkter:**

1. **Rättslig presumtion om anställning** utlöses vid omständigheter som tyder på kontroll och ledning. Bevisbördan flyttas till plattformen.
2. **Algoritmisk verksamhetsledning** — transparens- och informationsplikter för plattformar som använder automatiserade system för arbetsledning.
3. **Personuppgiftsskydd** specifikt för plattformsarbetare.

### 9.2 Spicks riskposition — pro-Spick-argument

**Starka argument mot anställningspresumtion:**

- §2.1 Frihet att acceptera/avböja utan negativa konsekvenser
- §2.2 Underleverantören sätter själv tillgänglighet och arbetstider
- §2.3 Frihet att arbeta för andra plattformar och direkt mot egna kunder — **ingen exklusivitet**
- §2.4 Underleverantören bestämmer hur arbetet utförs
- §2.5 Egen utrustning
- §2.6 Eget företag med F-skatt — ekonomisk risk bärs av Underleverantören
- Spick erbjuder aldrig anställningsvillkor (fast lön, sjuklön, semester, pension)
- Ingen uniformskrav, ingen logotyp på kläder, ingen GPS-tracking utöver check-in/out

**Svaga punkter som kan tolkas som kontroll och ledning:**

- Spick sätter priset (platform_settings) — kund och städare förhandlar inte sinsemellan
- Spick bestämmer matchning via algoritm
- Kvalitetskontroll via betyg (§7) med påföljd vid lågt betyg (minskad synlighet)
- Uppförandekod (§9)
- Bindande acceptans (§4)
- Spick ensidigt kan säga upp vid "misskötsel" (§11)

### 9.3 Proaktiva åtgärder att överväga (för jurist-bedömning)

**A. Priskonstruktion:** Idag bestäms pris av Spick. Modell B vore "Spick rekommenderar pris, Underleverantören har rätt att avvika" — men detta bryter affärsmodellen (kunden ser fast pris). Alternativ mjukning: publicera prissättnings-logiken öppet så det inte är "Spick bestämmer" utan "marknaden bestämmer enligt transparent formel".

**B. Uppförandekod:** Dokumentera att koden är minimikrav för plattformstillhörighet, inte arbetsledning i anställningsmening.

**C. Uppsägning:** §11 kan mjukas — "Spick kan säga upp med 30 dagars varsel vid väsentliga avtalsbrott" istället för "vid misskötsel". Objektivt kriterium.

**D. Match-algoritmen:** Publicera transparent beskrivning av matchningskriterier i integritetspolicy eller separat dokument. Direktivet kräver det ändå.

### 9.4 Fråga till jurist (redan kvitterad som Fråga 10)

Vilken kombination av ovanstående rekommenderas — och i vilken ordning bör de implementeras?

---

## Bilaga A: Befintliga avtal (referensversion)

Bifogas som separat paket:
- uppdragsavtal.html (version 2026-04-16)
- kundvillkor.html (version 2026-04-16)
- integritetspolicy.html (version 2026-04-16)

---

## Bilaga B: Relevant praxis (referens för juristen)

**Avtalslagen §36 — kommersiella avtal:**
- NJA 2020 s. 624 "Den oskäliga skifteslikviden"
- NJA 1989 s. 346 "Pälsbolaget"
- B. Flodgren, SvJT 2024 s. 32 (jämkning mellan jämbördiga parter)

**RUT-avslag och återkrav:**
- Svea Hovrätt mål nr T 9821-17 (villkor som tillkommit efter avtalsslut)
- Lagen om förfarandet vid skattereduktion för hushållsarbete (HUSFL)

**Plattform vs anställning:**
- AD 2022 nr 45 "Foodora" (bemanningsbolag-konstruktion)
- AD 2013:92 (AD såg igenom inskjutet bolag — relevant för Spicks direktrelation)

**GDPR:**
- EDPB Guidelines 07/2020 om personuppgiftsansvarig och personuppgiftsbiträde
- IMY:s mall för PuB-avtal
- EU-kommissionens standardavtalsklausuler för personuppgiftsbiträdesavtal

---

## Slutkommentar

Detta dokument är framtaget av Farhad Haghighi med AI-assisterad research, inte av jurist. Syftet är att ge den granskande juristen ett strukturerat underlag för effektiv granskning — inte att ersätta juristens egen bedömning. Alla föreslagna textformuleringar är utkast att kommentera, justera eller förkasta.

Juristens uppdrag är att validera, korrigera eller motivera avsteg från föreslagna formuleringar, samt ge riskbedömning där detta dokument uttryckligen ber om det.

Slutgiltig avtalstext fastställs av Farhad efter juristens kommentarer. Implementation sker i separata pull requests enligt Del 8.

---

**Kontaktuppgifter för juristen:**
Farhad Haghighi
Haghighi Consulting AB (559402-4522)
hello@spick.se
