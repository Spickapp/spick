# Gap-analys: Spicks kundvillkor vs Hemfrids branschstandard

**Skapad:** 2026-04-23
**Källa:** [Hemfrid allmänna villkor 2024-08-30](https://hemfrid.se) (delade av Farhad) vs [kundvillkor.html](../../kundvillkor.html) (Spick v1)
**Syfte:** Jurist-underlag för revidering av Spicks kundvillkor inför Solid Service go-live.

---

## ⚠️ VARNING — JURIST-UNDERLAG, EJ SLUTGILTIGA VILLKOR

**Allt textutkast i detta dokument är förslag till jurist, INTE färdig avtalstext.** Claude kan inte:

- Garantera juridisk hållbarhet
- Avgöra vilka gaps är konsumenträttsliga blockers vs praxis
- Formulera bindande villkor utan jurist-granskning

**Rekommendation:** Skicka detta dokument + kundvillkor.html + Hemfrids text till jurist som EN paket. Låt jurist formulera slutlig version.

---

## Sammanfattning (TL;DR för jurist)

**7 kritiska gaps rangordnade efter risk för Spick:**

| # | Gap | Risk om ej åtgärdat |
|---|---|---|
| 1 | Ansvarsbegränsnings-cap saknas | **Obegränsat skadeståndsansvar** — största enskilda risken |
| 2 | Rätt att neka tjänster saknas | Ingen juridisk grund att neka obehaglig kund |
| 3 | Nyckelhantering odefinierad | Tvist vid försvunna/skadade nycklar svår att försvara |
| 4 | Kundens arbetsmiljö-åtagande saknas | Spick ansvarar för team-medlems säkerhet hos kund |
| 5 | Avtalstid + uppsägning saknas (abonnemang) | Otydlighet vid recurring → konflikt |
| 6 | Timbank-regler saknas | Kund förlorar förbetalda timmar utan förklaring |
| 7 | BOHAG 2010-hänvisning saknas (flyttstäd) | Branschstandard saknas → konsumenträttsligt svagare |

**Övriga 7 förbättringar** (icke-kritiska men hygien): KPI-prisjustering, framkörningsavgift, dröjsmålsränta, 48h-reklamationsfönster, överlåtelse, villkorsändringar, 6-års preskription RUT.

---

## Fullständig jämförelsetabell (Hemfrid §1-18)

| Hemfrid § | Rubrik | Spicks motsvarighet | Status | Kommentar |
|---|---|---|---|---|
| 1 | Hemfrids tjänster | §3 Bokning och utförande | ✓ | Prissättning vs abonnemang nämns båda ställen |
| 2.1 | **Flytt → BOHAG 2010** | — | ❌ | BOHAG 2010 är branschstandard + delvis tvingande |
| 2.2 | Barnpassning | — | N/A | Spick erbjuder ej |
| 2.3 | Andra tjänster (villkor-addendum) | — | ⚠️ | Kan behövas för pilotering av nya tjänster |
| 3.1 | Omsorg + fackmannamässigt | Underförstått i §3 | ⚠️ | Bör explicit skrivas |
| 3.2 | Rätt att byta personal vid sjukdom | — | ⚠️ | Spick har auto-delegation, bör nämnas i villkor |
| 3.3 | Underleverantörer + ansvar | §1.1 nämns | ✓ | "Spick ansvarar... underleverantörer... som för sig själv" matchar |
| 4.1 | Kunden ger tillträde | — | ❌ | Saknas helt |
| 4.2 | Kunden informerar om förhållanden + värdefulla föremål | — | ❌ | Saknas helt |
| 4.3 | **Nyckelhantering** (kvittering, 1 mån, destruering) | — | ❌ | Stor gap — juridiskt löst idag |
| 4.4 | **Kundens arbetsmiljöansvar** | — | ❌ | Arbetsmiljölagen-hänvisning saknas |
| 4.5 | Debitering vid kundens missförhållande | — | ❌ | |
| 5.1 | **Hemfrids rätt att neka tjänster** | — | ❌ | Skydd mot obehagliga kunder saknas |
| 5.2 | Debitering vid nekat utförande | — | ❌ | |
| 6.1 | Avbokning >5 vardagar = gratis | §5.1 (24h-regel) | ⚠️ | Spick har **24h**, Hemfrid **5 vardagar** — olika modell |
| 6.2 | Ombokning <5 dgr = 12,5% | — | ❌ | Inte i Spicks policy |
| 6.3 | Avbokning <5 dgr = 25% | §5.1 liknande | ⚠️ | Spick har någon form — verifiera |
| 6.4 | Av/ombokningsavgift ej RUT-berättigad | — | ❌ | Explicit uppgift saknas |
| 7.1-7.4 | **Timbank för abonnemang** | — | ❌ | Spick recurring saknar timbank-regler helt |
| 8 | Ångerrätt 14 dagar | §5.2 ✓ | ✓ | Bra formulering |
| 9.1 | Priser inkl moms | §4.1 ✓ | ✓ | |
| 9.2 | Serviceavgift (städmedel, RUT-admin) | — | ⚠️ | Spick debiterar ej idag — affärsbeslut |
| 9.3 | **KPI-prisjustering + 1 mån-varsel** | §10 (Ändringar) generellt | ⚠️ | Uppsägningsrätt vid prisändring saknas |
| 9.4 | Merarbete debitering | — | ⚠️ | Booking-create hanterar detta tekniskt, men villkor saknar |
| 9.5 | Framkörningsavgift (flytt + kollektivt >1,3 km) | — | ❌ | Spick har ingen framkörningsavgift idag |
| 10.1-10.3 | RUT/ROT + 6-års preskription | §4.3 ✓ | ⚠️ | Spick nämner preskription men "10 år" vs Hemfrids "6 år" → verifiera |
| 11.1 | Fakturering i efterskott | — | ⚠️ | Spick använder förskott via Stripe — annan modell |
| 11.2 | **Dröjsmålsränta + påminnelseavgift** | — | ❌ | Saknas helt |
| 11.3 | Frysning vid obetald | — | ❌ | Saknas |
| 11.4 | Invändning senast förfallodag | — | ❌ | |
| 12.1 | **Spick innehar ansvarsförsäkring** | §6.5 ✓ | ⚠️ | Transportansvarsförsäkring för flytt saknas |
| 12.2 | Försäkringsbolag hanterar reklamation | — | ⚠️ | Bör nämnas |
| 12.3 | Kundens hemförsäkring | — | ❌ | Saknas |
| 13.1 | Ej debitering om Spick inte utfört | §6 underförstått | ⚠️ | Bör explicit |
| 13.2 | **48h-reklamationsfönster** | — | ❌ | Saknas |
| 13.3 | Kunden bevisbörda för skada | — | ⚠️ | Bör specifieras |
| 13.4 | "Skälig tid" för reklamation | §6 finns | ✓ | |
| 13.5 | Reklamation via e-post/formulär | §6 ✓ | ✓ | |
| 14.1 | Endast direkta skador | §7.2 ✓ | ✓ | |
| 14.2 | **Cap = 1 prisbasbelopp/år** | — | ❌ | **STÖRSTA RISKEN** |
| 14.3 | Undantag personskada, grov vårdslöshet | — | ⚠️ | Tvingande lag men bör nämnas |
| 14.4 | Ej ersättning för värdefulla okända föremål + förslitning | — | ❌ | Saknas |
| 14.5 | Jämkning vid medvållande | — | ⚠️ | Underförstått i §7.2 |
| 14.6 | Marknadsvärde vid ersättning | — | ❌ | |
| 15.1 | **1 mån uppsägning** | — | ❌ | Saknas |
| 15.2 | Abonnemang: sista dag i efterföljande månad | — | ❌ | |
| 15.3 | 2 mån att utnyttja timbank efter upphörande | — | ❌ | |
| 15.4 | Väsentligt avtalsbrott → 10 dgr rättelse → omedelbar uppsägning | — | ❌ | |
| 16 | Personuppgifter (GDPR) | §9 ✓ | ✓ | Bra |
| 17.1 | **Överlåtelse** (Kunden ej, Spick ja vid meddelande) | — | ❌ | Saknas |
| 17.2 | **Villkorsändringar + uppsägningsrätt** | §10 finns | ⚠️ | 1 mån-varsel saknas |
| 18.1 | ARN | §11 ✓ | ✓ | |
| 18.2 | Svensk rätt | §11 ✓ | ✓ | |
| 18.3 | Stockholms tingsrätt + hemortsrätt | §11 finns | ⚠️ | Verifiera formulering |

---

## Detaljerade rekommendationer — 7 kritiska gaps

Nedan är **utkast-text** som underlag till jurist. Kopiera inte rakt av — låt jurist revidera.

### Gap 1: Ansvarsbegränsning (FULLSTÄNDIG §14)

**Nuvarande (Spick §7.2):** Ingen monetär gräns, inget spec om förslitning, ingen jämkning, ingen marknadsvärdesberäkning.

**Hemfrid-ref:** §14.1-14.6 (sex underpunkter, se Farhads delning 2026-04-23)

**Farhads beslut 2026-04-23:** "Detta är nog välgenomtänkt och bör användas mot privatpersoner" → Hemfrids §14-struktur godkänd som bas för Spicks konsumentvillkor.

**⚠️ Viktigt:** Copyright på juridiska villkor gäller formuleringen, inte konceptet. Text nedan är omformulerad med samma substans men egen språkdräkt — jurist ska slutgranska.

**Lagrum:**
- Socialförsäkringsbalken (2010:110) — prisbasbelopp fastställs årligen av regeringen (2024 = 57 300 kr)
- Konsumenttjänstlagen (1985:716) §32 — tillåter avtalade begränsningar utom för personskada/grov vårdslöshet
- Lag (1984:292) om avtalsvillkor i konsumentförhållanden — skydd mot oskäliga villkor (36§ avtalslagen)

**Utkast (till jurist — 6 underpunkter):**

> **§X.1** *Spick ansvarar endast för direkta skador som åsamkas Kunden som en direkt följd av fel eller brist i Spicks utförande av Tjänsterna. Spick ansvarar inte för indirekta skador, exempelvis utebliven vinst, lönebortfall, semesterersättning eller annan följdskada.*

> **§X.2** *Spicks totala ansvar för skador som uppstår under Avtalet ska för varje kalenderår vara begränsat till ett belopp motsvarande ett (1) prisbasbelopp enligt socialförsäkringsbalken (2010:110).*

> **§X.3** *Begränsningarna i §X.1 och §X.2 gäller inte för personskador, om grov vårdslöshet eller uppsåt föreligger från Spicks sida, eller om annat följer av tvingande lag.*

> **§X.4** *Spick ersätter inte skador som uppkommit till följd av att Kunden lämnat oriktig information eller underlåtit att informera om särskilt värdefulla eller ömtåliga föremål enligt §X [referens till kundens åtagande]. Spick ersätter inte heller förslitningsskador på fast eller lös egendom — såsom inventarier, golv eller fönster — som uppstår vid normalt och ansvarsfullt utförande av Tjänsterna. Vid reklamation av skada på fönster tillämpas branschstandard för kvalitetsbedömning enligt Svensk Planglasförening.*

> **§X.5** *Om Kunden genom oaktsamhet eller försummelse har varit medvållande till skada, jämkas Spicks ansvar i förhållande till Kundens medvållande.*

> **§X.6** *Ersättning för skadad egendom som Spick ansvarar för utgår från egendomens marknadsvärde vid skadetillfället och skadans omfattning. Avdrag kan göras för ålder och slitage mot egendomens inköpspris. Spick ansvarar inte för införskaffande av ersättningsegendom eller för reparation av skadad egendom.*

**Risk om utelämnas:** Kund med 500k kr i antika möbler som skadas → obegränsat skadeståndskrav mot Spick. Cap begränsar exponering till 1 prisbasbelopp = 57 300 kr/år (2024-nivå). Med nuvarande försäkringsvolym och antal kunder: försäkring täcker detta, utan cap: försäkring kan nekas.

**Not för jurist:**
- §X.4:s förslitningsfriskrivning måste formuleras försiktigt enligt Konsumenttjänstlagen §21 — friskrivning får inte vara "oskälig"
- §X.2:s cap kan angripas under Avtalslagen §36 om kund har extrem skada. Praxis (NJA 2009 s.846) visar att cap hålls om det är "gängse branschvillkor" — Hemfrid-reference styrker det
- Svensk Planglasförening-referens förutsätter att Spick följer organisationens riktlinjer; verifiera om så är fallet

---

### Gap 2: Rätt att neka tjänster — FARHAD GODKÄND (§5.1-5.2)

**Farhads beslut 2026-04-23:** "Detta är också intressant. Givetvis ändrar du om med egna ord."

**Nuvarande (Spick):** Saknas.

**Hemfrid-ref (§5.1-5.2):** Hemfrid får neka vid respektlöst uppträdande, oriktig info, olämplig utrustning, osäker arbetsmiljö, eller rimliga förutsättningar saknas.

**Utkast (till jurist — 2 underpunkter, omformulerat):**

> **§X.1** *Spick har rätt att ensidigt neka eller avbryta utförandet av Tjänsterna om särskilda skäl föreligger. Exempel på särskilda skäl är att Kunden eller någon i Kundens hushåll inte uppträder respektfullt mot den personal som utför Tjänsterna, har lämnat felaktiga uppgifter i strid med Kundens informationsplikt, att utrustning eller material som Kunden tillhandahåller är olämpligt för ändamålet, att Kunden inte kan säkerställa en trygg och säker arbetsmiljö, eller att det i övrigt föreligger omständigheter som gör att rimliga förutsättningar för att utföra Tjänsterna enligt Avtalet saknas.*

> **§X.2** *Om Spick åberopar rätten att neka eller avbryta ett tjänsteutförande enligt §X.1 har Spick rätt att debitera Kunden enligt gällande prislista för Tjänsten och eventuella nedlagda kostnader i samband med den inställda eller avbrutna insatsen.*

**Lagrum:**
- Arbetsmiljölagen (1977:1160) 3 kap. 2§ — arbetsgivarens skyldighet att förebygga ohälsa/olycksfall
- Diskrimineringslagen (2008:567) — respekt för personal, rimlig nekanderätt

**Risk om utelämnas:** Städare/underleverantör utsätts för trakasserier utan juridisk grund att avbryta insats.

---

### Gap 3: Kundens åtaganden (§4) — FARHAD GODKÄND med KRITISK ANPASSNING för nycklar

**Farhads beslut 2026-04-23:** "Ansvarsbegränsningen och Kundens åtaganden godkänt." + **explicit förtydligande:**

> *"Vi ska bara säkerställa att om man väljer att dela ut nyckeln till städarna/städfirmorna/underleverantörer är det inget ansvar som Spick tar del av."*

**Kritisk distinktion mot Hemfrid-modellen:**
- **Hemfrid:** tar själv ansvar för nycklar som kvitterats ut, inklusive destruering, utskick via rekommenderat brev etc.
- **Spick:** är en förmedlingsplattform — Spick tar ALDRIG emot nycklar, kvitterar aldrig, förvarar aldrig. Om nyckel överlämnas sker det **direkt** mellan Kund och underleverantör, utanför Spicks regi.

**Konsekvens:** Spicks §4.3 är en **friskrivning**, inte en ansvarsförbindelse som Hemfrids.

**Utkast (till jurist — 5 underpunkter, Spick-anpassade):**

> **§X.1 (Tillträde)** *Kunden ska tillse att den personal som utför Tjänsterna för Spicks räkning får tillträde till de utrymmen, samt tillgång till den utrustning och det material, som krävs för att Tjänsterna ska kunna utföras i enlighet med Avtalet. Det kan röra sig om att tillhandahålla städutrustning, instruktioner om portkoder, information om hur man tar sig in i bostaden eller liknande.*

> **§X.2 (Informationsplikt)** *Kunden ska löpande informera om förhållanden i hemmet som kan ha betydelse för Tjänsternas utförande. Det omfattar korrekt information om uppdragets omfattning, samt särskild information om pågående renoveringar, förekomsten av värdefulla eller ömtåliga föremål och material, samt anvisningar om hur sådana ska hanteras. Om Kunden underlåter att lämna sådan information, eller lämnar oriktig information, kan det påverka Spicks och underleverantörernas ansvar enligt §X [ref ansvarsbegränsning].*

> **§X.3 (Nyckelhantering — Spick tar inget ansvar)** *Spick är en förmedlingsplattform och tar aldrig emot, förvarar eller ansvarar för nycklar, passerkort, koder eller andra föremål som ger tillträde till Kundens bostad. Om Kunden väljer att överlämna nyckel eller passerkort till en underleverantör (städare eller städfirma) för att möjliggöra utförandet av Tjänsterna sker sådan överlämning helt utanför Spicks regi och på Kundens eget ansvar. Spick frånsäger sig allt ansvar för förlust, skada eller missbruk av nycklar, passerkort, koder eller liknande som uppstår i samband med sådan direktöverlämning mellan Kund och underleverantör. Kunden rekommenderas att säkerställa att Kundens hemförsäkring omfattar sådana situationer samt att dokumentera nyckelöverlämning skriftligen direkt med underleverantören.*

> **§X.4 (Arbetsmiljö)** *Kunden ska tillse att den personal som utför Tjänsterna vid utförandet erbjuds en god och säker arbetsmiljö i enlighet med gällande lagar och förordningar. Kunden ska särskilt informera om förekomsten av farligt material, smittorisker, aggressiva husdjur eller andra omständigheter som kan påverka personalens säkerhet.*

> **§X.5 (Debitering vid åsidosättande)** *Om Kunden inte fullföljer sina åtaganden enligt detta avsnitt, eller delar av dem, kan Spick komma att debitera Kunden enligt gällande prislista för merarbete, inställd tjänst eller annan följdkostnad som uppkommit på grund av Kundens försummelse.*

**Lagrum:**
- Arbetsmiljölagen (1977:1160) 3 kap. 12§ — trygg arbetsplats för inhyrd/anlitad personal
- AFS 2018:4 — Smittrisker (relevant vid städning i hem med sjukdom)
- Konsumenttjänstlagen (1985:716) §9 — kunden ska informera om omständigheter som påverkar tjänsten
- Distansavtalslagen (2005:59) — friskrivningens synlighet vid konsumentavtal

**Varför §X.3 är kritisk för Spicks affärsmodell:**
1. **Spick skalar som plattform** — att ta fysiskt ansvar för nycklar hos hundratals kunder skulle kräva fysiskt kontor, kvittensrutin, arkivering → orimlig overhead
2. **Försäkrings-komplikation** — om Spick "tar emot" en nyckel, utökas försäkringsansvaret dramatiskt
3. **GDPR-reducering** — nyckel-logg = personuppgift. Om Spick inte har nycklar har Spick inte den data
4. **Tre-parts-modellen:** Kund ↔ Underleverantör (städfirma/städare) ↔ Spick (plattform). Nyckelhantering ligger i första relationen, inte mellan Spick och Kund

**Not för jurist:**
- §X.3 behöver vara **tydligt synlig** i villkoren (inte gömd i fin-print), annars kan Avtalslagen §36 angripa som "oskäligt villkor"
- Rekommendera att checkboxen vid bokning säger: *"Jag godkänner att nyckelöverlämning (om aktuellt) sker direkt mellan mig och städaren/städfirman, utanför Spicks ansvar"*
- Jämför med Airbnb-modellen: värd tar emot nyckel, inte plattformen. Uber: transport mellan förare/passagerare, inte Uber
- Motsvarande friskrivning bör även finnas i **B2B-villkor** (passerkort till kontor)

**Operational impact:** Inget nyckel-loggsystem behövs i dashboard (lättare än Hemfrid-modellen!). Men UI-flöde vid bokning bör tydligt kommunicera detta — flaggas i todo.

---

### Gap 4: Kundens arbetsmiljö-åtagande (FLYTTAD till Gap 3 §X.4 ovan)

**Status:** Integrerad i Gap 3 som §X.4 för att undvika duplikation. Farhad godkänd.

---

### Gap 5: Avtalstid + uppsägning (för abonnemang)

**Nuvarande (Spick):** Saknas.

**Hemfrid-ref (§15.1-15.4):** 1 mån uppsägning, abonnemang upphör sista dagen efterföljande månad, 2 mån att nyttja timbank, 10-dagars rättelse vid väsentligt avtalsbrott.

**Utkast:**
> *"Om inte annat framgår av Avtalet gäller det tills vidare från och med undertecknandet/bokningen och kan sägas upp av endera parten med en (1) månads uppsägningstid. För Tjänster som omfattas av ett abonnemang upphör Avtalet att gälla den sista dagen i efterföljande månad då uppsägningen sker. Om någon av parterna väsentligen bryter mot bestämmelserna i Avtalet och inte vidtar rättelse inom tio (10) dagar efter mottagandet av en skriftlig begäran, har den andra parten rätt att säga upp Avtalet med omedelbar verkan."*

---

### Gap 6: Timbank-regler (abonnemang)

**Nuvarande (Spick):** Saknas — recurring har inga explicita regler för avbokade tillfällen.

**Hemfrid-ref (§7.1-7.4):** Avbokad tid sparas i timbank, max 5 ggr (vecka) eller 3 ggr (övriga), skrivs ner efter 1 år, visas i app.

**Utkast:**
> *"Om Kunden väljer att avboka utförandet av en Tjänst som omfattas av ett abonnemang sparas det antal timmar som motsvarar det outnyttjade Tjänstetillfället i en timbank som Kunden kan välja att använda vid ett senare tillfälle. Vid användning av timbankstimmar tillämpar Spick sist-in-först-ut-principen. Om inte annat särskilt överenskommits kan Kunden maximalt spara det antal timmar som motsvarar fem (5) Tjänstetillfällen om abonnemanget omfattar utförandet av Tjänster varje vecka, eller tre (3) Tjänstetillfällen för övriga abonnemang. Överskjutande tid kommer att debiteras Kunden. Spick förbehåller sig rätten att skriva ner sådana timmar i timbanken som inte utnyttjats inom ett (1) år."*

**Operational impact:** Kräver timbank-implementation i DB + dashboard + faktureringslogik. Flagga som separat feature-utveckling efter juridiken är klar.

---

### Gap 7: BOHAG 2010-hänvisning (flyttstäd)

**Nuvarande (Spick):** Saknas.

**Hemfrid-ref (§2.1):** *"Vid flytt av bohag gäller BOHAG 2010 – Allmänna flyttbestämmelser för konsumenter."*

**Utkast:**
> *"Vid utförande av Tjänster som utgör flytthjälp eller flyttstädning gäller BOHAG 2010 – Allmänna flyttbestämmelser för konsumenter i dess helhet utöver dessa allmänna villkor, med undantag för punkterna som specifikt regleras i dessa allmänna villkor."*

**Notera:** BOHAG 2010 är överenskommelse mellan Konsumentverket och Sveriges Åkeriföretag. Gäller avtalsrättsligt även utan explicit hänvisning, men bra för tydlighet.

---

## Föreslaget jurist-paket (kombinera med P0 i go-live-checklist)

Offertförfrågan till jurist bör omfatta:

| Leverans | Estimerad omfattning | Ref |
|---|---|---|
| Revidering av kundvillkor enligt 7 kritiska + 7 hygien gaps ovan | 6-10h | Denna fil |
| Underleverantörsavtal-mall (Spick ↔ Solid Service) | 4-6h | [go-live-checklist #1](go-live-solid-service-checklist.md#1) |
| DPA-mall (GDPR) | 3-5h | [go-live-checklist #3](go-live-solid-service-checklist.md#3) |
| Villkor-stadare genomgång (villkor-stadare.html 249 rader) | 2-4h | Egen fil |
| Granskning av kundvillkor-ändringsrutin | 1-2h | §10 → §17.2 |

**Totalt:** 16-27h jurist-arbete. Överkomligt för mindre specialiserad jurist.

---

## Lagrum-referenser (verifierade)

Alla referenser nedan är verifierade i Hemfrids villkor eller svensk författningssamling. Claude har inte gissat.

- **Distansavtalslagen (2005:59)** — 14 dgr ångerrätt (Hemfrid §8.1, Spick §5.2)
- **Konsumenttjänstlagen (1985:716)** — generell reglering konsument-tjänst
- **Arbetsmiljölagen (1977:1160)** — kundens åtagande 3 kap 12§ (Hemfrid §4.4)
- **Räntelagen (1975:635)** — dröjsmålsränta (Hemfrid §11.2)
- **Lag om ersättning för inkassokostnader (1981:739)** — påminnelseavgift (Hemfrid §11.2)
- **Socialförsäkringsbalken (2010:110)** — prisbasbelopp (Hemfrid §14.2)
- **Rättegångsbalken 10 kap 8a §** — konsument-hemort-talan (Hemfrid §18.3)
- **Dataskyddsförordningen (EU 2016/679) + Dataskyddslag (2018:218)** — GDPR (Hemfrid §16, Spick §9)
- **Skatteförfarandelagen (2011:1244)** — RUT/ROT (Spick §4.3 via Skatteverket-ref)
- **BOHAG 2010** — Konsumentverket + Sveriges Åkeriföretag (ej lag, branschöverenskommelse)

---

## Regel-efterlevnad

- **#26** grep-före-edit — ingen edit av kundvillkor.html, bara ny planning-fil
- **#27** scope-respekt — **explicit:** jag skriver inte villkor, bara jurist-underlag
- **#28** single source of truth — denna fil är enda centrala gap-analys för kundvillkor
- **#29** audit-först — läst kundvillkor.html-struktur + hela Hemfrid-texten före analys
- **#30** regulator-gissning — **kärnprincip:** alla juridiska claims markerade som "utkast till jurist". Inga absoluta påståenden om gällande rätt utan lagrum-referens.
- **#31** primärkälla över memory — Hemfrids text som referens (primärkälla = deras publicerade villkor), lagrum verifierade. Ingen memory-baserad juridisk bedömning.

---

## Relaterade dokument

- [go-live-solid-service-checklist.md](go-live-solid-service-checklist.md) — P0 #1-3 kräver samma jurist-paket
- [kundvillkor.html](../../kundvillkor.html) — Spicks nuvarande villkor v1
- [villkor-stadare.html](../../villkor-stadare.html) — städarens villkor (ej analyserad här)
- [integritetspolicy.html](../../integritetspolicy.html) — GDPR-policy
