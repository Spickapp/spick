# DRAFT — Underleverantörsavtal (Spick ↔ Cleaner / Städfirma)

**STATUS:** ⚠️ DRAFT för Farhads jurist-bedömning. **Inte juridiskt giltigt utan din review.** Spick-favör-formuleringar kan vara oskäliga per Avtalsvillkorslagen vid jämställdhetsbrist mellan parter (mikrocleaner vs Spick) — verifiera mot praxis.

**Datum:** 2026-04-25
**Version:** Draft v0.2 (utökad — anti-fraud, vite-skala, trappad avstängning, plattformsdeltagar-roll)
**Källor:** Konkurrent-research (`2026-04-25-konkurrent-research-villkor.md`) + Farhads explicit-önskemål (uppriktighet, skadestånd, RUT-hold, B2B-favör, max-skydd-mot-bedrägeri)
**Spicks position:** Plattform/förmedlare. EU PWD-risk vid styrnings-grad — flaggad till Fas 7.5.

**Ändring v0.1 → v0.2:**
- §3.4 utökad — vite-tabell vid no-show
- §4.5-4.7 NY — back-to-back-betalning + 75-kr-modellen
- §5.2 utökad — bredare bevis-krav + alternativa bevis-vägar
- §7 omarbetad — anti-fraud-arkitektur med 9 specifika scenarier
- §11 omarbetad — trappad avstängning (varning → temp → permanent)
- §16 NY — Plattformsdeltagar-roll (cleaner som kanal till Spicks kunder)
- §17 NY — Bedrägeri-utredning + Spicks befogenheter
- §18 NY — Vite-skala (specifika belopp per misskötsel-typ)
- §19 NY — Återbetalningsmekanism + utmätningsrätt
- §20 NY — Whistleblower + intern incident-rapportering

---

## §1. Parter och tillämplighet

**1.1** Detta avtal ("Avtalet") gäller mellan Haghighi Consulting AB (org.nr 559402-4522), bifirma "Spick", med adress Solna ("Spick") och den fysiska person eller juridiska person som registrerat sig som städare eller städfirma på spick.se ("Underleverantören" / "Cleanern").

**1.2** Avtalet träder i kraft när Underleverantören godkänner Avtalet vid registrering på [spick.se/bli-stadare.html](https://spick.se/bli-stadare.html) eller [spick.se/registrera-foretag.html](https://spick.se/registrera-foretag.html).

**1.3** Underleverantören är **oberoende näringsidkare** med F-skattsedel. Avtalet skapar **ingen anställning** mellan Spick och Underleverantören. Underleverantören bär eget ansvar för:
- Sociala avgifter
- Skatter (preliminärskatt + slutskatt)
- A-kassa, försäkringar, pensionssparande
- Egen utrustning utöver vad Kund tillhandahåller

**1.3.1 Spicks roll varierar per tjänstetyp** — utförare för RUT-berättigade tjänster, förmedlare för icke-RUT (kontors-/byggstädning). Spicks roll för aktuell bokning anges i bokningsacceptansen i Spick-appen. Underleverantörens kontraktuella ansvar mot Spick gäller oavsett Spick-roll, men Kund-ansvarets fördelning skiftar (se [`2026-04-25-utforare-vs-formedlare-hybrid-analys.md`](2026-04-25-utforare-vs-formedlare-hybrid-analys.md)):
- **Spick-utförare-uppdrag:** Spick bär kund-ansvar primärt; Underleverantörens skuld är mot Spick
- **Spick-förmedlar-uppdrag:** Underleverantören bär kund-ansvar primärt; Spick förmedlar + fakturerar

**1.4** Definitioner:
- "Tjänsten" = den städning som Spick förmedlar till Underleverantören
- "Kund" = den fysiska person som beställer Tjänsten via Spick
- "Provision" = Spicks förmedlingsavgift på 12 % flat (låst per `platform_settings.commission_standard` sen 2026-04-17)
- "Check-in" = GPS- + tidsstämpel-bekräftelse vid Tjänstens början, registrerad i Spick-appen
- "Check-out" = motsvarande vid Tjänstens slut
- "Bedrägeri" = uppsåtligt vilseledande för egen vinning (definierad enligt Brottsbalken 9 kap)
- "Vite" = på förhand bestämt belopp som ska betalas vid avtalsbrott
- "Plattformsdeltagar-arbete" = uppdrag som Underleverantören utför mot Kund som Underleverantören själv värvat via Spicks plattform (se §16)
- "Spick-värvat arbete" = uppdrag som Spick förmedlar till Underleverantören från Spicks egen kund-bas

---

## §2. Underleverantörens åtaganden

**2.1** Underleverantören åtar sig att utföra accepterade Tjänster fackmannamässigt och enligt Spicks kvalitetsriktlinjer.

**2.2** Underleverantören ska:
- Vara godkänd för F-skatt (verifieras löpande av Spick mot Skatteverket)
- Inneha gällande verksamhetsansvarsförsäkring enligt **§ 2.2.1 Tier-modell** nedan
- Genomgå Spicks identitetsverifiering (BankID via TIC.io)
- Lämna referenser eller annan dokumentation som Spick begär
- Underteckna och följa Spicks Code of Conduct
- Hålla F-skattbevis och försäkringar uppdaterade i Mitt konto utan dröjsmål

**§ 2.2.1 Försäkrings-Tier-modell** (uppdaterad 2026-04-26):

Spick tillämpar en progressiv onboarding för att inte skapa onödig friktion för nya underleverantörer.

| Tier | Krav | Begränsning |
|---|---|---|
| **Provanställd** (0-90 dagar / första 10 utförda jobb) | Verksamhetsansvar minst **5 000 000 kr per skada** | Inga premium-jobb (>2000 kr per bokning) |
| **Verifierad** (efter 10 jobb + snittbetyg ≥4,5) | Verksamhetsansvar **10 000 000 kr per skada** + ren förmögenhetsskada **2 000 000 kr** + täckning för städverksamhet inkl. nyckelhantering | Auto-uppgradering vid uppfyllt krav |
| **Spick Pro** (Almega-medlem eller motsvarande) | Som Verifierad + sak-försäkring | Prioritet i matching, badge i kund-vy |

**Kompletterande Spick-täckning under Provanställd-period:**
Under provanställning täcker Spick mellanskillnaden upp till 10 MSEK genom plattformsförsäkring för skador som inte täcks av Underleverantörens egen 5 MSEK. Detta gäller endast för bokningar förmedlade via Spick och endast under provanställningsperioden (max 90 dagar).

**Verifiering:**
- Försäkringsbevis (PDF) ska laddas upp i Mitt konto vid registrering
- Spick verifierar belopp och giltighetstid manuellt inom 48 timmar
- Vid förnyelse av försäkring ska nytt bevis laddas upp innan utgångsdatum
- Vid utgånget försäkringsbevis pausas Underleverantörens jobbtilldelning automatiskt

**2.3** Underleverantören är ensam ansvarig för:
- Sin egen arbetstid och planering inom accepterade Tjänster
- Egen logistik mellan uppdrag
- Egen utbildning och kompetensutveckling
- Eget arbetsmaterial när Kund inte tillhandahåller

**2.4** Underleverantören får inte:
- Ta emot direktbetalning från Kund för uppdrag som hanteras via Spicks plattform (all betalning ska gå via Spick)
- Ge Kund kontaktuppgifter utanför Spick-plattformen utan Spicks medgivande
- Använda Spicks varumärke utan skriftligt tillstånd
- Subkontraktera eget Spick-uppdrag till tredje part utan Spicks samtycke
- Använda Spick-data, kund-listor eller marknadsföringsmaterial för egna ändamål utanför plattformen
- Manipulera Check-in/ut, betyg, recensioner eller annan plattforms-data

---

## §3. Tjänsteutförande

**3.1** Spick förmedlar bokningar via plattformen. Underleverantören väljer själv vilka uppdrag att acceptera enligt Spicks accept/reject-flöde.

**3.2** Vid accepterat uppdrag förbinder sig Underleverantören att:
a) Vara på plats vid bokad tid
b) Genomföra **Check-in** via Spick-appen vid Tjänstens början (GPS + tidsstämpel)
c) Utföra Tjänsten enligt bokningsbeskrivning
d) Genomföra **Check-out** via Spick-appen vid Tjänstens slut
e) Rapportera eventuella problem omedelbart via Spick-appen

**3.3** Underleverantören får avboka accepterat uppdrag senast **48 timmar** före Tjänstens utförande utan sanktion (utom vid sjukdom/akut event där omedelbar rapportering krävs).

**3.4 Sen avbokning, no-show — vite-skala.** Vid sen avbokning eller utebliven Underleverantör (mindre än 24 h före utan giltig grund) gäller:

| Tidpunkt / Misskötsel | Vite |
|---|---|
| Avbokning 24-48 h före | 50 % av Tjänstens fakturerade belopp |
| Avbokning < 24 h före | 100 % av Tjänstens fakturerade belopp + ersättnings-städares mer-kostnad |
| No-show (uteblivet utan avbokning) | 150 % av Tjänstens fakturerade belopp + ersättnings-städares mer-kostnad |
| 3:e no-show inom 90 dagar | Tillfällig avstängning (30 dagar) per §11 + 5 000 kr extra-vite |
| 5:e no-show inom 12 månader | Permanent avstängning per §11 |

**3.4.1** Giltig grund för no-show (befriar från vite §3.4): styrkt sjukdom (läkarintyg vid > 1 dag), trafikolycka (polisanmälan), nära anhörigs dödsfall, force majeure (§12 Kundvillkor analogt).

**3.4.2** Spick avgör i det enskilda fallet om grund är "giltig" enligt §3.4.1. Underleverantören kan överklaga beslutet enligt §12.

---

## §4. Provision och betalning

**4.1** Spick tar 12 % flat provision på fakturerat belopp (efter RUT-avdrag). Provision debiteras vid utbetalning till Underleverantören.

**4.2** Utbetalning sker till Underleverantörens registrerade Stripe Connect-konto. Tidsplan:
- Standard: 24 h efter Kundens bekräftelse av Tjänsten ELLER 24 h efter Tjänsten om Kunden inte aktivt invänder ("auto-release")
- Vid dispute: hålls i escrow tills tvisten är löst (se §6 + Kundvillkor §8)

**4.3** Underleverantören ansvarar själv för att rapportera och betala skatt på utbetalt belopp.

**4.4** Spick ger Underleverantören månatligt bokföringsunderlag (s.k. self-invoice) som underlättar Underleverantörens egen bokföring.

**4.5 Back-to-back-betalning.** Spicks betalningsskyldighet mot Underleverantören förutsätter att Spick själv mottagit motsvarande betalning från Kund. Om Spick inte erhåller fullt betalt från Kund av skäl som inte är hänförliga till Spick (kund-konkurs, kund-vägran, dispute som faller mot Spick, kreditkortsdebitering återförd, etc.) reduceras Underleverantörens ersättning proportionellt.

**4.5.1** Reducering enligt §4.5 sker **endast** vid betalningsfel som **inte** är orsakade av Spicks egen handling eller försummelse. Vid betalningsfel orsakat av Spick (tekniskt fel i fakturering, försenad fakturering, plattforms-bug) bär Spick risken.

**4.5.2** Spick ska informera Underleverantören skriftligen inom 14 dagar om reducering enligt §4.5 inkluderande:
- Belopp som reduceras
- Anledning + bevis (kopia av kund-vägran, dispute-beslut, etc.)
- Tidpunkt för slutreglering

**4.6 Återkrav vid efter-betalning.** Om Kund senare betalar belopp som tidigare reducerats per §4.5, ska Spick utbetala motsvarande andel till Underleverantören utan dröjsmål.

**4.7 Kvittning.** Spick har rätt att kvitta:
- Vite per §3.4 / §18
- Skadestånd per §7
- Återkrav per §17
- Mot kommande utbetalningar till Underleverantören

Kvittning ska föregås av skriftligt meddelande med specifikation av belopp och grund.

---

## §5. Check-in / Check-out — bevis-krav (kärn-säkring för Spick)

**5.1** Check-in/ut är **kontraktuellt obligatoriskt** för varje accepterad Tjänst. Detta är primär bevis för:
- Att Underleverantören utförde arbetet (för Spicks RUT-rapportering till Skatteverket)
- Tjänstens faktiska längd (för korrekt fakturering till Kund)
- Underleverantörens arbetade tid (för Underleverantörens egen redovisning)
- Spicks förmåga att svara mot kund-disputes med tidsstämplad bevisning

**5.2 Konsekvens vid uteblivet eller bristfälligt Check-in/ut.** Om Underleverantören inte kan styrka närvaro genom Check-in OCH Check-out vid en Tjänst, har Spick rätt att:

a) **Hålla 50 % av arbetskostnaden i escrow** tills Underleverantören kan presentera alternativt bevis (godkänt enligt §5.2.1)

b) Om bevis ej presenteras inom **30 dagar:** Spick kan **permanent dra 50 % av arbetskostnaden** som motsvarighet till nekat RUT-avdrag (Skatteverket kräver bevis för utförd tjänst för RUT-utbetalning)

c) Vid systematisk brist (3+ tillfällen inom 90 dagar): avstängning från plattformen enligt §11

**5.2.1 Alternativa bevisformer.** Underleverantören kan styrka närvaro via följande alternativa bevis:
- Foto från platsen med EXIF-data (tidsstämpel + GPS-koordinater) före och efter städningen
- Skriftlig kund-bekräftelse (e-post, SMS, app-meddelande) med tidsangivelse
- Tredjepartsbevis (vittne, kvitto från transporttjänst, parkeringsbiljett)
- Spotify/Strava/annan tredjeparts-app-loggning av rörelse till och från adressen

**5.2.2 Bevisvärdering.** Spick avgör vilket bevis som är tillräckligt. Vid tvist gäller Spicks beslut tills annat fastställts av domstol.

**5.3 Bakgrund §5.2:** Spick är RUT-ombud till Skatteverket sen 13 april 2026. Spick:s rätt att begära RUT-utbetalning bygger på **dokumenterat utfört arbete**. Om Skatteverket nekar utbetalning pga otillräckligt bevis från Underleverantörens sida, är Underleverantören kontraktuellt ansvarig för det förlorade RUT-beloppet.

**5.4 Tekniska fel.** Vid bevisat tekniskt fel i Spick-appen (server-nedtid, GPS-fel pga app-bug, etc.) gäller §5.2 inte. Spick verifierar tekniska fel via egna logs och meddelar Underleverantören skriftligen om undantag.

**5.5 Manipulation av Check-in/ut.** Försök att manipulera Check-in/ut (felaktig GPS, falsk tidsstämpel, kollegas check-in på annan plats, mock-locations) klassas som **bedrägeri** per §17 och §18 vite-tabell rad 1-3.

**5.6 Underleverantörens medvetenhet om Kund-RUT-mekanismen.** Underleverantören är medveten om och accepterar att:

a) Spick har enligt Kundvillkor §10.3 rätt att efterdebitera Kund 50 % av arbetskostnaden om Skatteverket nekar RUT-avdrag av kund-orsakade skäl (fel personnummer, RUT-tak överskridet, ej folkbokförd på adressen).

b) **Kund-orsakade nekanden** påverkar inte Underleverantörens utbetalning negativt. Spick efterdebiterar Kund + Underleverantören får sin normala utbetalning per §4.

c) **Underleverantör-orsakade nekanden** (otillräckligt Check-in/ut-bevis enligt §5.2, falskt RUT-underlag enligt §17.1 rad 3) hanteras enligt §5.2 b) — permanent 50 %-drag av Underleverantörens arbetskostnad. Detta är en separat mekanism från §10.3 i Kundvillkor.

d) **Spick-orsakade nekanden** (felaktigt RUT-XML-underlag, system-bug, fel registrerad personuppgift hos Spick) bär Spick risken för. Varken Kund eller Underleverantör drabbas.

**5.6.1 Bevisbörda.** Klassificering av "vem orsakade nekandet" görs av Spick vid första bedömning. Underleverantören kan överklaga enligt §12.4 inom 14 dagar från beslut.

---

## §6. Dispute / reklamation från Kund

**6.1** Vid Kund-dispute hålls escrow tills tvisten är löst per Kundvillkor §8. Underleverantören har rätt att:
- Inkomma med svar + bevis (foto, kommentar)
- Bestrida Kundens påståenden
- Be om VD-tier-1-eskalering (max 500 kr)

**6.2** Vid bekräftat fel av Underleverantören (avhjälpt via omstädning, prisreduktion eller refund):

| Beslut | Konsekvens för Underleverantören |
|---|---|
| Avhjälpande (omstädning) | Underleverantören utför omstädningen utan extra ersättning |
| Prisreduktion | Underleverantörens utbetalning minskas proportionellt |
| Full refund | Underleverantören får ingen utbetalning för aktuell Tjänst |
| Skadestånd > Tjänstens värde | Faktureras till Underleverantören (se §7 + §18 vite-skala) |

**6.3** Vid återkommande disputes (≥ 3 inom 90 dagar med fel hos Underleverantören) inleds **utbildnings- eller avstängnings-process** enligt §11.

---

## §7. Uppriktighetskrav + skadestånd (anti-fraud-grund)

**7.1** Underleverantören förbinder sig att lämna **sanningsenliga uppgifter** vid:
- Registrering (CV, referenser, F-skattbevis, försäkring, BankID-identitet)
- Acceptans av uppdrag (möjlighet att utföra)
- Check-in/ut (faktisk närvaro och tider)
- Skaderapportering (vad som hänt)
- Uppdragsbeskrivning till Kund
- Kommunikation med Spick eller Kund

**7.2 Falsk eller missvisande information.** Om Underleverantören lämnat felaktiga uppgifter och detta orsakar skada för Spick, Kund eller tredje man:

a) **Skadestånd.** Underleverantören är skyldig att ersätta Spick för:
- Direkt ekonomisk skada (refunds till Kund, ersättnings-städares kostnader, plattforms-skada)
- Administrativa kostnader för utredning (1 500 kr/timme, **max 10 prisbasbelopp per fall**)
- Eventuella myndighetsavgifter (t.ex. Skatteverkets återkrav vid felaktig RUT-rapport)

b) **Vite per §18 vite-skala.**

c) **Avstängning per §11 trappad-avstängnings-process** (för icke-uppsåtliga fel) eller **omedelbar avstängning** (för uppsåtliga eller upprepade fel).

d) **Anmälan.** Vid uppenbart bedrägeri (§17) eller upprepade felaktigheter har Spick rätt att anmäla till polisen, Skatteverket, IMY och övriga relevanta myndigheter.

**7.3 Misstanke om felgivning — Spicks utredningsrätt.** Om Spick har **konkret bevis** om felgivning från Underleverantörens sida (inte bara misstanke) har Spick rätt att:
a) Hålla utbetalning för aktuella Tjänster i avvaktan på utredning (max 90 dagar)
b) Begära kompletterande bevis från Underleverantören (foton, kommentarer, vittnen)
c) Genomföra extern revision på Underleverantörens bekostnad **om revisionen visar avvikelse**
d) Tillfälligt suspendera Underleverantörens konto enligt §11.2 under utredningstiden

**7.4 Skuldbörda.** I tvist om uppgifters riktighet bär Underleverantören bevisbördan att uppgift är korrekt.

**7.4.1** Undantag: vid Spicks anklagelse om bedrägeri enligt §17 ligger högre bevis-krav på Spick (sannolikhets-överbevisning).

---

## §8. Konkurrens, kundrelation och plattforms-trohet (B2B-favör Spick)

**8.1** All kundrelation tillhör Spick avseende Spick-värvade kunder (definierat i §1.4). Underleverantören har endast tillgång till kund-uppgifter i den utsträckning som krävs för att utföra Tjänsten.

**8.2 Förbud mot kund-stöld (Spick-värvade kunder).** Underleverantören får inte:
- Erbjuda Spick-värvad Kund att utföra städning utanför Spick-plattformen
- Acceptera direktbokning från Spick-värvad Kund
- Lämna ut sina egna kontaktuppgifter (privat telefon, andra plattformar) till Spick-värvad Kund

**8.3 Konkurrensklausul (post-uppdrag).** Underleverantören förbinder sig att **under 12 månader efter sista utförda Tjänst för en specifik Spick-värvad Kund** inte:
- Utföra städtjänster för den Kunden privat
- Förmedla städtjänster till den Kunden via konkurrerande plattform
- Marknadsföra sina tjänster till den Kunden

**Sanktion vid brott:** Vite om 25 000 kr per tillfälle plus skadestånd för Spicks förlorade förmedlingsavgift (se §18 rad 7).

> ⚠️ **Jurist-bedömning krävs:** 12-månaders konkurrensklausul mot mikronäringsidkare kan jämkas. AD-praxis för konsumentnära tjänster behöver verifieras. Alternativ: 6 månader, eller frivillig "no-poach"-pakt utan vite.

**8.4 Skiljelinje plattformsdeltagar-arbete (§16).** För kunder som Underleverantören själv värvat via plattformens marknadsplats-funktion gäller andra regler — se §16. §8.2-§8.3 gäller bara Spick-värvade kunder.

**8.5** Spicks rätt att marknadsföra plattformen till Underleverantörens befintliga kund-bas (efter att Underleverantören registrerat sig) är ovillkorad.

---

## §9. Sekretess + GDPR

**9.1** Underleverantören förbinder sig att inte sprida:
- Kunds personuppgifter (namn, adress, personnummer, telefonnr)
- Information från eller om Kunds bostad
- Spicks affärshemligheter (priser, algoritmer, kund-listor)
- Information om andra underleverantörer på plattformen

**9.2** Brott mot sekretess kan medföra:
- Avstängning per §11
- Skadestånd per §7
- Vite per §18 rad 8
- Anmälan till Integritetsskyddsmyndigheten (IMY) vid GDPR-brott
- Polisanmälan vid grov sekretessbrott (Brottsbalken 4 kap 8 § företagsspioneri-analogt)

**9.3** Vid avtalets upphörande ska Underleverantören:
- Radera Kund-uppgifter från egna system inom 30 dagar
- Återlämna eventuell utrustning eller material från Spick
- Inte fortsätta använda Spicks varumärke
- Vid avtalsslut avseende plattformsdeltagar-arbete (§16) — kund-relationer som Underleverantören etablerat före plattforms-medverkan **berörs ej**

---

## §10. Försäkring och ansvar

**10.1** Underleverantören ska under hela avtalstiden hålla:
- Ansvarsförsäkring med minst 5 000 000 kr försäkringsbelopp
- Olycksfallsförsäkring för egen del (rekommenderat, ej obligatoriskt)

**10.2** Underleverantören är primärt ansvarig för skada som uppstår vid Tjänstens utförande. Spicks ansvarsförsäkring fungerar som "back-stop" enligt Kundvillkor §7.2.

**10.3** Vid skada ska Underleverantören:
a) Omedelbart rapportera till Spick via app eller [hello@spick.se](mailto:hello@spick.se)
b) Dokumentera skadan (foto, beskrivning)
c) Samarbeta med Spicks försäkringsbolag vid skaderegleringen

**10.4 Försäkrings-bortfall.** Om Underleverantören förlorar sin ansvarsförsäkring (uppsagd, för-fallit) inträder omedelbar avstängning per §11.3 c).

---

## §11. Hävning, uppsägning, avstängning — trappad process

**11.1 Underleverantörens uppsägning.** Underleverantören kan när som helst säga upp avtalet med **30 dagars varsel** via "Mitt konto" eller [hello@spick.se](mailto:hello@spick.se).

**11.2 Trappad disciplinär process.** Spick tillämpar en trappad process vid icke-uppsåtliga avtalsbrott:

| Steg | Trigger | Konsekvens |
|---|---|---|
| **1. Skriftlig varning** | Första brott mot kvalitets- eller bevis-krav | Notering i konto + utbildningsmaterial |
| **2. Tillfällig avstängning 7 dagar** | Andra brott inom 90 dagar | Inga nya uppdrag accepteras under 7 dagar |
| **3. Tillfällig avstängning 30 dagar** | Tredje brott inom 90 dagar ELLER allvarligt enskilt brott | Inga nya uppdrag + utbildningskrav före åter-aktivering |
| **4. Permanent avstängning** | Fjärde brott inom 12 månader ELLER bekräftat bedrägeri (§17) | Konto stängs, befintlig pågående uppdrag genomförs eller omfördelas |

**11.3 Spicks omedelbar avstängning utan trappad process.** Vid följande gäller direkt steg 4:
a) Bekräftat bedrägeri per §17 (manipulation, falsk identitet, RUT-fusk)
b) Misstänkt brottslig gärning som rapporterats till polisen
c) Förlust av F-skattsedel eller försäkring
d) Allvarlig kund-incident (övergrepp, stöld, vägran att lämna kund-bostad)
e) Grovt brott mot sekretess §9
f) Manipulation av Spicks plattform (falsk recension, GPS-spoofing, betyg-manipulation)

**11.4 Förenklad uppsägning (utan grund).** Spick har rätt att säga upp Avtalet utan särskild grund med **60 dagars varsel** (utökat från v0.1 30 dagar för bättre näringsidkar-skydd).

**11.5 Effekt vid avstängning.** Vid avstängning:
- Pågående bokade uppdrag genomförs eller omfördelas (Spicks val)
- Utbetalningar för utförda men ej slutreglerade Tjänster sker enligt normal flow, **minus** ev. vite/skadestånd kvittade per §4.7
- Tillgång till Spick-app + Mitt konto upphör efter avstängningstid (vid temp) eller permanent (vid steg 4)
- Sekretess §9 + konkurrensklausul §8.3 fortsätter gälla

**11.6 Återinträde efter avstängning.** Underleverantör som avstängts permanent (steg 4) kan ansöka om återinträde tidigast efter 24 månader. Spick har ingen skyldighet att godkänna återinträde.

---

## §12. Tvistlösning

**12.1** Tvist ska parterna i första hand lösa genom förhandling.

**12.2** Tvist som ej kan lösas avgörs av Stockholms tingsrätt som första instans, med tillämpning av svensk lag.

**12.3** Spick har rätt att inhämta extern medling före domstolsförfarande.

**12.4 Överklagande av disciplinära beslut.** Underleverantören har rätt att överklaga avstängnings-, vite- eller återbetalningsbeslut inom 14 dagar genom skriftlig begäran till [hello@spick.se](mailto:hello@spick.se). Spick ska besvara överklagan inom 30 dagar.

---

## §13. Avtalsändringar

**13.1** Spick kan ändra Avtalet med **30 dagars skriftligt varsel** via e-post eller notifiering i app.

**13.2** Vid ändringar som väsentligt försämrar Underleverantörens villkor (definierat: höjd provision >2 procentenheter, sänkta utbetalningsvillkor, nya sanktioner > 5 000 kr per tillfälle) har Underleverantören rätt att säga upp avtalet utan iakttagande av 30-dagars-uppsägningstid.

**13.3** Fortsatt användning av plattformen efter ändringarnas ikraftträdande utgör godkännande.

---

## §14. Övrigt

**14.1** Underleverantören ansvarar för att hålla sina kontaktuppgifter, F-skattbevis och försäkringar uppdaterade i Mitt konto.

**14.2** Spick samarbetar i god tro med Underleverantören men förbehåller sig rätten att fatta affärsbeslut (t.ex. ny commission-modell, tjänsteutbud, prissättning).

**14.3** Avtalets ogiltighet i någon del påverkar ej giltigheten av övriga delar.

---

## §15. Kontakt

- **Underleverantörsupport:** [hello@spick.se](mailto:hello@spick.se)
- **Akut (helger):** se Mitt konto för aktuellt jour-nummer
- **Bedrägeri-rapportering:** [hello@spick.se](mailto:hello@spick.se) (märk "BEDRÄGERI" i ämnesrad)
- **Postadress:** Haghighi Consulting AB, [postadress att verifiera]
- **Org.nr:** 559402-4522

---

## §16. Plattformsdeltagar-roll (cleaner som kanal till plattformens kunder)

**16.1** Utöver Spick-värvat arbete (§1.4) erbjuder plattformen Underleverantören möjlighet att ta emot bokningar från kunder som Underleverantören själv värvat genom egen marknadsföring eller direktrelation, men där bokningen och betalningen hanteras via Spick-plattformen ("Plattformsdeltagar-arbete").

**16.2** För Plattformsdeltagar-arbete gäller **samma villkor** som för Spick-värvat arbete med följande undantag:

a) **Konkurrensklausul §8.3 gäller inte** för kunder som Underleverantören själv värvat
b) **Provision §4.1** är fortfarande 12 % flat (Spick kostar plattform + betalning + RUT-hantering)
c) Underleverantören är fri att fortsätta erbjuda samma kunder via andra plattformar eller direktrelation

**16.3** Skiljelinje mellan "Spick-värvad" och "Plattformsdeltagar".** Avgörande är **vem som först kontaktade kunden**:
- Om kund initialt fann Spick (sökmotor, marknadsföring, rekommendation av Spick) → Spick-värvad
- Om kund initialt fann Underleverantören (egen marknadsföring, social media, befintlig kund-relation före plattforms-anslutning) → Plattformsdeltagar

**16.3.1** Vid tvivel **ligger bevisbördan på den part som hävdar Plattformsdeltagar-status** (typiskt Underleverantören).

**16.4** Underleverantören får marknadsföra sina egna tjänster med uppgift om att betalning sker via Spick-plattformen, inkluderande:
- Egen webbsida
- Sociala medier
- Visitkort, broschyrer
- Mun-till-mun

**16.5** Underleverantören får **inte** påstå att Underleverantören "är Spick" eller agerar som Spicks anställd. Marknadsföring ska tydligt visa att Underleverantören är oberoende.

**16.6 Sanktioner mot kund-typ-manipulation.** Om Underleverantören felaktigt klassificerar Spick-värvad kund som "Plattformsdeltagar" (för att undvika §8.3 konkurrensklausul):
- Vite per §18 rad 9: 15 000 kr per tillfälle
- Möjlig avstängning per §11
- Återbetalning av provision om Underleverantören tagit kunden utanför plattformen efter felaktig klassificering

---

## §17. Bedrägeri-utredning + Spicks befogenheter

**17.1** Spick definierar följande som **bedrägeri** (per §1.4) i avtalsbetydelse:

| # | Scenario | Beskrivning |
|---|---|---|
| 1 | **Identitets-bedrägeri** | Annan person använder Underleverantörens konto, eller Underleverantören använder annans BankID/identitet |
| 2 | **GPS-spoofing / falsk Check-in** | Manipulering av plats-data eller tidsstämpel vid Check-in/ut |
| 3 | **Falskt RUT-underlag** | Fakturering för arbete som ej utförts, eller överrapporterad tid |
| 4 | **Kund-stöld via plattformen** | Användning av Spicks plattform för att värva kunder och sedan ta dem utanför |
| 5 | **Falsk skaderapportering** | Påstående om skada som ej skett, eller döljande av faktisk skada |
| 6 | **Falsk recension / betyg-manipulation** | Påverkan på betygssystem genom falska recensioner (egen eller andras) |
| 7 | **Falsk frånvaro / sjukdom** | Falskt sjukintyg eller påståd akut grund för no-show |
| 8 | **Manipulation av prissättning** | Konstruerad merdebitering, ej-utförd extra-tjänst, etc. |
| 9 | **Sekretess-läckage för vinning** | Försäljning av kund-listor, fotografering av kund-bostad för publicering |

**17.2 Spicks befogenheter vid bedrägeri-misstanke (konkret bevis krävs).** Spick har rätt att:

a) **Frysa** Underleverantörens konto + alla utbetalningar inom 24 h från konkret bevis (t.ex. video, vittnesutsaga, server-log)
b) **Begära** komplett dokumentation från Underleverantören inom 7 dagar från frysning
c) **Genomföra** intern utredning inkluderande:
   - Granskning av all Underleverantörens plattforms-aktivitet
   - Begäran om kund-bekräftelser för misstänkta uppdrag
   - GPS-/tids-/foto-loggar från Spick-appen
   - Konsultation med extern utredare på Underleverantörens bekostnad om utredningen bekräftar bedrägeri
d) **Återbetala** Kund för uppdrag som omfattas av bedrägeri (även retroaktivt) — kostnaden faktureras Underleverantören per §19
e) **Anmäla** till polisen, Skatteverket, IMY enligt §7.2 d)
f) **Permanent avstänga** per §11.3 a)
g) **Vite** per §18

**17.3 Avstängning under utredning.** Tillfällig avstängning under utredning är **inte** sanktion (steg 11.2-3) utan säkerhetsåtgärd. Om utredningen friar Underleverantören:
- Frysta utbetalningar släpps
- Kontot återaktiveras
- Inget vite eller skadestånd
- Spick ger skriftlig friande motivering

**17.4 Felaktig anklagelse — kompensation.** Om Underleverantören friades efter utredning som varade > 30 dagar och utredningen inte var grundad i konkret bevis (utan i lös misstanke), har Underleverantören rätt till:
- Ränta på frysta belopp enligt referensränta + 2 procentenheter
- Kompensation för förlorade bokningsmöjligheter — beräknat som 50 % av Underleverantörens snitt-månadsinkomst på plattformen senaste 6 månaderna × utredningstidens månader

> ⚠️ **Jurist-bedömning krävs:** §17.4 är defensiv mot anklagelser om "fishing expeditions". Verifiera mot LAS-analogi (felaktig avskedande-praxis).

**17.5 Spicks förebyggande åtgärder.** Spick får genomföra följande utan föregående information till Underleverantören:
- Slumpvis verifiering av Check-in/ut-bevis (GPS-/tids-jämförelse)
- Mystery-shopping (Spick-personal som testar Underleverantörens tjänst)
- Kund-uppföljning post-tjänst för kvalitetskontroll
- Granskning av betyg-mönster för manipulation-detektering

---

## §18. Vite-skala

**18.1** Vid följande misskötsel utgår fast vite. Vite kan kvittas mot kommande utbetalningar per §4.7.

| # | Misskötsel | Vite | Hänvisning |
|---|---|---|---|
| 1 | Falsk Check-in / GPS-spoofing (engångs) | 5 000 kr | §17 rad 2 |
| 2 | Falskt RUT-underlag (engångs) | 10 000 kr + RUT-belopp | §17 rad 3 |
| 3 | Identitetsbedrägeri | 50 000 kr + omedelbar avstängning + polisanmälan | §17 rad 1 |
| 4 | No-show 3:e gången inom 90 dagar | 5 000 kr (utöver §3.4-vite) | §3.4 |
| 5 | Kund-stöld bekräftat (Spick-värvad) | 25 000 kr per kund + provision för förlorade uppdrag | §8.3, §17 rad 4 |
| 6 | Falsk skaderapportering | 10 000 kr + faktisk skadekostnad | §17 rad 5 |
| 7 | Konkurrensklausul-brott §8.3 | 25 000 kr per tillfälle | §8.3 |
| 8 | Sekretess-brott | 10 000 kr per kund vars data läckt | §9 |
| 9 | Felaktig kund-typ-klassificering (§16.6) | 15 000 kr per tillfälle | §16.6 |
| 10 | Försök till betyg-manipulation | 5 000 kr per försök | §17 rad 6 |
| 11 | Falsk frånvaro / falsk sjukgrund | 3 000 kr + §3.4 ordinarie vite | §17 rad 7 |
| 12 | Manipulation av prissättning | 10 000 kr + felaktig debitering återgår | §17 rad 8 |

**18.2 Maxbelopp.** Total vite-summa enligt §18.1 är begränsad till **20 prisbasbelopp per kalenderår** (≈ 1 176 000 kr 2026). Detta motsvarar ungefär en heltidscleaners hela årsinkomst — vid övervikt indikeras avstängning per §11 istället för fortsatt vite.

> ⚠️ **Jurist-bedömning krävs:** Specifika belopp är förslag baserade på affärsrisk-kalkyl. Avtalslagen 36 § ger jämkningsrätt vid oskäliga viten — verifiera proportionalitet per misskötsel.

**18.3** Vite enligt §18.1 är **inte** RUT-avdragsgilla utgifter för Underleverantören.

**18.4** Vite enligt §18.1 är **kumulativa** med skadestånd per §7. Vite täcker normaliserad skada, skadestånd täcker faktisk merskada.

---

## §19. Återbetalningsmekanism + utmätning

**19.1** Om Spick återbetalar Kund med belopp orsakat av Underleverantörens fel (§6.2 / §17), faktureras Underleverantören motsvarande belopp.

**19.2 Faktura-villkor.** Faktura från Spick till Underleverantör har:
- Förfallotid: 14 dagar från fakturadatum
- Dröjsmålsränta: referensränta + 8 procentenheter (motsvarande räntelagen 6 §)
- Påminnelseavgift: 60 kr
- Inkassokrav: 180 kr
- Ärendet kan överlämnas till Kronofogden vid uteblivet betalning > 60 dagar

**19.3 Kvittning §4.7.** Spick har rätt att i första hand kvitta belopp mot kommande utbetalningar innan faktura skickas.

**19.4 Återbetalningsplan.** Vid större belopp (> 50 000 kr) erbjuder Spick frivillig avbetalningsplan över max 12 månader, mot räntan i §19.2.

**19.5 Borgen / säkerhet.** Spick har rätt att begära borgensman eller säkerhet för utestående skulder över 100 000 kr.

---

## §20. Whistleblower + intern incident-rapportering

**20.1** Underleverantören uppmanas rapportera följande till Spick:
- Misstänkt bedrägeri av andra underleverantörer
- Säkerhetsbrister i plattformen
- Brott mot Spicks Code of Conduct
- GDPR-incidenter (data-läckage, otillbörlig åtkomst)
- Kund som ber Underleverantören gå utanför plattformen

**20.2 Skydd för rapportör.** Underleverantör som rapporterar i god tro:
- Får ej sanktioneras för rapportering (även om misstanke ej bekräftas)
- Får ej delas identitet med rapporterad part utan rapportörens samtycke
- Skyddas av den svenska Visselblåsarlagen (2021:890) i tillämpliga delar

**20.3 Rapportering.** Sker via [hello@spick.se](mailto:hello@spick.se) (märk "INTERNAL") eller anonymt via formulär på spick.se/whistleblower (om implementerat).

---

## Appendix A — Ändringshistorik

| Datum | Version | Ändring | Av |
|---|---|---|---|
| 2026-04-25 | v0.1 | DRAFT skapad baserat på Farhads explicit-önskemål + branschpraxis | Claude (review krävs av Farhad jurist) |
| 2026-04-25 | v0.2 | Utökad: anti-fraud (§17), vite-skala (§18), trappad avstängning (§11.2), plattformsdeltagar-roll (§16), back-to-back-betalning (§4.5-4.7), återbetalningsmekanism (§19), whistleblower (§20) | Claude (review krävs av Farhad jurist) |

---

## Appendix B — Disclaimer (regel #30) + risk-flaggor

**Detta är en DRAFT producerad av AI-assistans.** Innehållet är **inte juridisk rådgivning** och får inte publiceras utan Farhads (jurist) bedömning av varje klausul.

### B.1 EU PWD-risk (FÖRHÖJD i v0.2)

EU Platform Work Directive (2024/2831, ikraftträder 2 dec 2026) inför **rebuttable presumption** att plattform→städare är anställning vid kontroll/styrning. Klausuler som ökar Spicks styrning av Underleverantören ökar risk för anställningsomklassificering.

**v0.2 ökar PWD-risk genom:**
- §3.4 detaljerad vite-skala vid no-show (kan tolkas som disciplin-system)
- §5.5 manipulation klassad som bedrägeri (kontroll-mekanism)
- §11.2 trappad disciplinär process (klassisk arbetsgivar-modell)
- §17 utredningsrätt + frysning (analog med arbetsgivarens utredning)
- §18 detaljerad vite-skala (ekonomisk styrning)
- §17.5 Spicks förebyggande åtgärder inkl. mystery-shopping (kvalitetskontroll = arbetsgivar-funktion)

**Mitigering att överväga:** Mjuka formuleringar ("rekommenderas" istf "förbinder sig"), eller acceptera PWD-risk + plan för anställningsomklassificering.

**Trade-off:** Stark anti-fraud-arkitektur ↔ Lägre PWD-risk är delvis motsatta mål. Du måste välja prioritet.

### B.2 Konkurrensklausul-jämkning (§8.3)

12-månaders konkurrensklausul mot mikronäringsidkare kan jämkas av AD per:
- Avtalslagen 38 § (oskälig konkurrensbegränsning)
- AD-praxis (t.ex. AD 2003 nr 84) — typiskt accepterar 6-12 månader för säljare/specialister, kortare för "vanliga" tjänster

**Mitigering:** sänk till 6 månader, eller koppla till skälig kompensation.

### B.3 Skadestånds-cap

§7.2 a) v0.2 har cap på 10 prisbasbelopp (≈ 588 000 kr 2026). v0.1 saknade cap. Bedöm om 10 PBB är rimligt.

### B.4 RUT-konsekvens (§5.2 b)

50 %-drag vid bristande Check-in/ut är affärsmodellsmässigt logiskt eftersom Spick förlorar RUT-utbetalning. **Men:** klausulen behöver verifieras mot:
- Skatteverkets faktiska bevis-krav (vad räcker som "utfört arbete"?)
- Konsumentverkets praxis om "vitesklausuler" mot näringsidkare

### B.5 Vite-skala (§18) — proportionalitet

Specifika belopp är förslag baserade på affärsrisk. **Avtalslagen 36 § ger jämkningsrätt vid oskäliga viten.** Domstol kan jämka enskilda belopp.

**Bedöm per rad:**
- Är 50 000 kr för identitetsbedrägeri proportionerligt mot Underleverantörens vinst-möjlighet?
- Är 25 000 kr per kund-stöld balanserat mot Spicks faktiska förlust (förlorad provision)?
- Finns vites-kumulering-risk där Underleverantör drabbas av 5+ poster samtidigt?

### B.6 Back-to-back-betalning (§4.5-4.7)

Modell: Underleverantörens betalning förutsätter Spicks betalning från kund.

**Risker:**
- Avtalslagen 36 § kan jämka om reduktion är orimlig
- §4.5.1-4.5.2 mitigerar genom att Spick bär risk för Spick-orsakade betalningsfel
- Skatterättsligt: Spick ska redovisa moms + RUT till SKV även om Spick inte fått betalt — separat fråga från Underleverantör-utbetalning

### B.7 Plattformsdeltagar-roll (§16) — DSA + IL-klassning

§16 introducerar tvådelad modell. Frågor:
- DSA Art 30 — Trader Traceability gäller Spick som "online platform with marketplace"
- Inkomstskattelagen — påverkar inte direkt cleanerns skatte-status (F-skatt) men SKV kan ifrågasätta Spicks verksamhetstyp
- Konkurrenslagen — om Spick missbrukar dominerande ställning genom §8.3 konkurrensklausul kan KOV/KKV agera

### B.8 Whistleblower (§20)

Visselblåsarlagen (2021:890) gäller arbetsgivare med ≥ 50 anställda + offentlig sektor. Spicks status som platform → ej direkt obligatorisk lagstiftning, men bästa praxis. Kan adopteras frivilligt utan att utlösa lag-skyldigheter.

### B.9 Generell asymmetri-risk

Hela v0.2 är konstruerat med tydlig Spick-favör. **Detta är medvetet val per Farhads request "Spick säkrar upp på alla fronter"**. Konsekvens:

- Domstolar kan tillämpa "in dubio mitius" (vid tvekan, mildare tolkning) mot avtalskonstruktören (Spick)
- ARN/Konsumentverket har visat ökad benägenhet att jämka mot mikronäringsidkare
- Risk att enskilda klausuler ogiltigförklaras → "salvatorisk klausul" §14.3 räddar resten

**Strategisk fråga för dig som jurist:** Är "robust enligt §18 vite-skala" värt risken att specifika klausuler jämkas? Alternativ: mjukare formuleringar med samma faktiska effekt.

---

**Farhad: se uppdaterad `2026-04-25-jurist-checklist.md` för v0.2-bedömningspunkter.**
