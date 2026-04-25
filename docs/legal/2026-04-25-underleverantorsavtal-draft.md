# DRAFT — Underleverantörsavtal (Spick ↔ Cleaner / Städfirma)

**STATUS:** ⚠️ DRAFT för Farhads jurist-bedömning. **Inte juridiskt giltigt utan din review.** Spick-favör-formuleringar kan vara oskäliga per Avtalsvillkorslagen vid jämställdhetsbrist mellan parter (mikrocleaner vs Spick) — verifiera mot praxis.

**Datum:** 2026-04-25
**Version:** Draft v0.1
**Källor:** Konkurrent-research (`2026-04-25-konkurrent-research-villkor.md`) + Farhads explicit-önskemål (uppriktighet, skadestånd, RUT-hold, B2B-favör)
**Spicks position:** Plattform/förmedlare. EU PWD-risk vid styrnings-grad — flaggad till Fas 7.5.

---

## §1. Parter och tillämplighet

**1.1** Detta avtal ("Avtalet") gäller mellan Haghighi Consulting AB (org.nr 559402-4522), bifirma "Spick", med adress Solna ("Spick") och den fysiska person eller juridiska person som registrerat sig som städare eller städfirma på spick.se ("Underleverantören" / "Cleanern").

**1.2** Avtalet träder i kraft när Underleverantören godkänner Avtalet vid registrering på [spick.se/bli-stadare.html](https://spick.se/bli-stadare.html) eller [spick.se/registrera-foretag.html](https://spick.se/registrera-foretag.html).

**1.3** Underleverantören är **oberoende näringsidkare** med F-skattsedel. Avtalet skapar **ingen anställning** mellan Spick och Underleverantören. Underleverantören bär eget ansvar för:
- Sociala avgifter
- Skatter (preliminärskatt + slutskatt)
- A-kassa, försäkringar, pensionssparande
- Egen utrustning utöver vad Kund tillhandahåller

**1.4** Definitioner:
- "Tjänsten" = den städning som Spick förmedlar till Underleverantören
- "Kund" = den fysiska person som beställer Tjänsten via Spick
- "Provision" = Spicks förmedlingsavgift på 12 % flat (låst per platform_settings.commission_standard sen 2026-04-17)
- "Check-in" = GPS- + tidsstämpel-bekräftelse vid Tjänstens början, registrerad i Spick-appen
- "Check-out" = motsvarande vid Tjänstens slut

---

## §2. Underleverantörens åtaganden

**2.1** Underleverantören åtar sig att utföra accepterade Tjänster fackmannamässigt och enligt Spicks kvalitetsriktlinjer.

**2.2** Underleverantören ska:
- Vara godkänd för F-skatt (verifieras löpande av Spick mot Skatteverket)
- Inneha gällande ansvarsförsäkring med minst 5 000 000 kr i försäkringsbelopp
- Genomgå Spicks identitetsverifiering (BankID via TIC.io)
- Lämna referenser eller annan dokumentation som Spick begär
- Underteckna och följa Spicks Code of Conduct

**2.3** Underleverantören är ensam ansvarig för:
- Sin egen arbetstid och planering inom accepterade Tjänster
- Egen logistik mellan uppdrag
- Egen utbildning och kompetensutveckling
- Eget arbetsmaterial när Kund inte tillhandahåller (t.ex. trasor, dammsugare)

**2.4** Underleverantören får inte:
- Ta emot direktbetalning från Kund (all betalning via Spicks plattform)
- Ge Kund kontaktuppgifter utanför Spick-plattformen utan Spicks medgivande
- Använda Spicks varumärke utan skriftligt tillstånd
- Subkontraktera eget Spick-uppdrag till tredje part utan Spicks samtycke

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

**3.4** **Sen avbokning eller no-show** av Underleverantören (mindre än 24 h före utan giltig grund) medför:
- Spick faktiserar Underleverantören för ersättnings-städarens kostnader (om någon hittas)
- Eller debiterar 100 % av planerat utförande som "missed-job-fee"
- Upprepade no-shows medför kontoavstängning enligt §11.2

---

## §4. Provision och betalning

**4.1** Spick tar 12 % flat provision på fakturerat belopp (efter RUT-avdrag). Provision debiteras vid utbetalning till Underleverantören.

**4.2** Utbetalning sker till Underleverantörens registrerade Stripe Connect-konto. Tidsplan:
- Standard: 24 h efter Kundens bekräftelse av Tjänsten ELLER 24 h efter Tjänsten om Kunden inte aktivt invänder ("auto-release")
- Vid dispute: hålls i escrow tills tvisten är löst (se §6 + Kundvillkor §8)

**4.3** Underleverantören ansvarar själv för att rapportera och betala skatt på utbetalt belopp.

**4.4** Spick ger Underleverantören månatligt bokföringsunderlag (s.k. self-invoice) som underlättar Underleverantörens egen bokföring.

---

## §5. Check-in / Check-out — bevis-krav (kärn-säkring för Spick)

**5.1** Check-in/ut är **kontraktuellt obligatoriskt** för varje accepterad Tjänst. Detta är primär bevis för:
- Att Underleverantören utförde arbetet (för Spicks RUT-rapportering till Skatteverket)
- Tjänstens faktiska längd (för korrekt fakturering till Kund)
- Underleverantörens arbetade tid (för Underleverantörens egen redovisning)

**5.2 Konsekvens vid uteblivet eller bristfälligt Check-in/ut.** Om Underleverantören inte kan styrka närvaro genom Check-in OCH Check-out vid en Tjänst, har Spick rätt att:

a) **Hålla 50 % av arbetskostnaden i escrow** tills Underleverantören kan presentera alternativt bevis (t.ex. foto från platsen med tidsstämpel + GPS, kund-bekräftelse)

b) Om bevis ej presenteras inom **30 dagar:** Spick kan **permanent dra 50 % av arbetskostnaden** som motsvarighet till nekat RUT-avdrag (Skatteverket kräver bevis för utförd tjänst för RUT-utbetalning)

c) Vid systematisk brist: avstängning från plattformen enligt §11.2

**5.3 Bakgrund §5.2:** Spick är RUT-ombud till Skatteverket sen 13 april 2026. Spick:s rätt att begära RUT-utbetalning bygger på **dokumenterat utfört arbete**. Om Skatteverket nekar utbetalning pga otillräckligt bevis från Underleverantörens sida, är Underleverantören kontraktuellt ansvarig för det förlorade RUT-beloppet (motsvarande ~50 % av arbetskostnad).

**5.4 Tekniska fel.** Vid bevisat tekniskt fel i Spick-appen (server-nedtid, GPS-fel pga app-bug, etc.) gäller §5.2 inte. Spick verifierar tekniska fel via egna logs.

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
| Skadestånd > Tjänstens värde | Faktureras till Underleverantören (se §7) |

**6.3** Vid återkommande disputes (≥ 3 inom 90 dagar med fel hos Underleverantören) inleds **utbildnings- eller avstängnings-process** enligt §11.

---

## §7. Uppriktighetskrav + skadestånd

**7.1** Underleverantören förbinder sig att lämna **sanningsenliga uppgifter** vid:
- Registrering (CV, referenser, F-skattbevis, försäkring)
- Acceptans av uppdrag (möjlighet att utföra)
- Check-in/ut (faktisk närvaro och tider)
- Skaderapportering (vad som hänt)
- Uppdragsbeskrivning till Kund

**7.2 Falsk eller missvisande information.** Om Underleverantören lämnat felaktiga uppgifter och detta orsakar skada för Spick, Kund eller tredje man:

a) **Skadestånd.** Underleverantören är skyldig att ersätta Spick för:
- Direkt ekonomisk skada (refunds till Kund, ersättnings-städares kostnader)
- Administrativa kostnader för utredning (1 500 kr/timme, max 20 timmar per fall)
- Eventuella myndighetsavgifter (t.ex. Skatteverkets återkrav vid felaktig RUT-rapport)

b) **Avstängning.** Spick har rätt att omedelbart avstänga Underleverantörens konto utan föregående varning.

c) **Anmälan.** Vid uppenbart bedrägeri eller upprepade felaktigheter har Spick rätt att anmäla till polisen, Skatteverket och övriga relevanta myndigheter.

**7.3 Misstanke om felgivning.** Om Spick har skälig misstanke om felgivning från Underleverantörens sida har Spick rätt att:
a) Hålla utbetalning för aktuella Tjänster i avvaktan på utredning
b) Begära kompletterande bevis från Underleverantören (foton, kommentarer, vittnen)
c) Genomföra extern revision på Underleverantörens bekostnad om revisionen visar avvikelse

---

## §8. Konkurrens, kundrelation och plattforms-trohet (B2B-favör Spick)

**8.1** All kundrelation tillhör Spick. Underleverantören har endast tillgång till kund-uppgifter i den utsträckning som krävs för att utföra Tjänsten.

**8.2 Förbud mot kund-stöld.** Underleverantören får inte:
- Erbjuda Kund att utföra städning utanför Spick-plattformen
- Acceptera direktbokning från Kund som lärt känna Underleverantören via Spick
- Lämna ut sina egna kontaktuppgifter (privat telefon, andra plattformar) till Kund

**8.3 Konkurrensklausul (post-uppdrag).** Underleverantören förbinder sig att **under 12 månader efter sista utförda Tjänst för en specifik Kund** inte:
- Utföra städtjänster för den Kunden privat
- Förmedla städtjänster till den Kunden via konkurrerande plattform
- Marknadsföra sina tjänster till den Kunden

**Sanktion vid brott:** Vite om 25 000 kr per tillfälle plus skadestånd för Spicks förlorade förmedlingsavgift.

> ⚠️ **Jurist-bedömning krävs:** 12-månaders konkurrensklausul mot mikronäringsidkare kan jämkas. AD-praxis för konsumentnära tjänster behöver verifieras. Alternativ: 6 månader, eller frivillig "no-poach"-pakt utan vite.

**8.4** Spicks rätt att marknadsföra plattformen till Underleverantörens befintliga kund-bas (efter att Underleverantören registrerat sig) är ovillkorad.

---

## §9. Sekretess + GDPR

**9.1** Underleverantören förbinder sig att inte sprida:
- Kunds personuppgifter (namn, adress, personnummer, telefonnr)
- Information från eller om Kunds bostad
- Spicks affärshemligheter (priser, algoritmer, kund-listor)

**9.2** Brott mot sekretess kan medföra:
- Avstängning per §11
- Skadestånd per §7
- Anmälan till Integritetsskyddsmyndigheten (IMY) vid GDPR-brott

**9.3** Vid avtalets upphörande ska Underleverantören:
- Radera Kund-uppgifter från egna system inom 30 dagar
- Återlämna eventuell utrustning eller material från Spick
- Inte fortsätta använda Spicks varumärke

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

---

## §11. Hävning, uppsägning, avstängning

**11.1 Underleverantörens uppsägning.** Underleverantören kan när som helst säga upp avtalet med **30 dagars varsel** via "Mitt konto" eller [hello@spick.se](mailto:hello@spick.se). Under uppsägningstiden kan Underleverantören acceptera nya uppdrag enligt normal flow.

**11.2 Spicks avstängning.** Spick har rätt att omedelbart avstänga Underleverantörens konto utan särskild grund med **30 dagars varsel** (utan motivering krävs).

**11.3 Spicks omedelbar avstängning utan varsel.** Spick har rätt att avstänga utan varsel vid:
a) Brott mot §5 (Check-in/ut), §7 (uppriktighet), §8 (konkurrensklausul) eller §9 (sekretess)
b) Misstänkt brottslig gärning
c) Förlust av F-skattsedel eller försäkring
d) Allvarlig kund-klagomål eller incident
e) Brott mot Spicks Code of Conduct

**11.4 Effekt vid avstängning.** Vid avstängning:
- Pågående bokade uppdrag genomförs eller omfördelas (Spicks val)
- Utbetalningar för utförda men ej slutreglerade Tjänster sker enligt normal flow
- Tillgång till Spick-app + Mitt konto upphör
- Sekretess och konkurrensklausul §8.3 fortsätter gälla

---

## §12. Tvistlösning

**12.1** Tvist ska parterna i första hand lösa genom förhandling.

**12.2** Tvist som ej kan lösas avgörs av Stockholms tingsrätt som första instans, med tillämpning av svensk lag.

**12.3** Spick har rätt att inhämta extern medling före domstolsförfarande.

---

## §13. Avtalsändringar

**13.1** Spick kan ändra Avtalet med **30 dagars skriftligt varsel** via e-post eller notifiering i app.

**13.2** Vid ändringar som väsentligt försämrar Underleverantörens villkor (t.ex. höjd provision) har Underleverantören rätt att säga upp avtalet utan iakttagande av 30-dagars-uppsägningstid.

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
- **Postadress:** Haghighi Consulting AB, [postadress att verifiera]
- **Org.nr:** 559402-4522

---

## Appendix A — Ändringshistorik

| Datum | Version | Ändring | Av |
|---|---|---|---|
| 2026-04-25 | v0.1 | DRAFT skapad baserat på Farhads explicit-önskemål + branschpraxis | Claude (review krävs av Farhad jurist) |

---

## Appendix B — Disclaimer (regel #30) + risk-flaggor

**Detta är en DRAFT producerad av AI-assistans.** Innehållet är **inte juridisk rådgivning** och får inte publiceras utan Farhads (jurist) bedömning av varje klausul.

### B.1 EU PWD-risk (verifiering blockerad till Fas 7.5)

EU Platform Work Directive (2024/2831, ikraftträder 2 dec 2026) inför **rebuttable presumption** att plattform→städare är anställning vid kontroll/styrning. Klausuler som ökar Spicks styrning av Underleverantören ökar risk för anställningsomklassificering — vilket skulle:
- Ge Underleverantören anställdas-rättigheter (semester, sjuklön, kollektivavtal)
- Tvinga Spick att betala arbetsgivaravgifter (~31,42 %)
- Trigga LAS-skydd

**Specifika klausuler med PWD-risk i denna draft:**
- §3.2 "förbinder sig att vara på plats vid bokad tid" (kan tolkas som arbetstidsstyrning)
- §3.3 "Sen avbokning medför sanktion" (kan tolkas som disciplin-kontroll)
- §5.2 "50 % drag vid bristande Check-in/ut" (kan tolkas som löneavdrag)
- §11.3 "omedelbar avstängning utan varsel" (kan tolkas som arbetsgivar-rättigheter)

**Mitigering att överväga:** mjuka formuleringar ("rekommenderas" istf "förbinder sig"), eller acceptera PWD-risk + plan för anställningsomklassificering.

### B.2 Konkurrensklausul-jämkning (§8.3)

12-månaders konkurrensklausul mot mikronäringsidkare kan jämkas av AD per:
- Avtalslagen 38 § (oskälig konkurrensbegränsning)
- AD-praxis (t.ex. AD 2003 nr 84) — typiskt accepterar 6-12 månader för säljare/specialister, kortare för "vanliga" tjänster

**Mitigering:** sänk till 6 månader, eller koppla till skälig kompensation.

### B.3 Skadestånds-cap

§7.2 a) saknar cap på skadestånd. Mot mikrocleaner kan obegränsat skadestånd vara oskäligt per Avtalslagen 36 §.

**Mitigering:** lägg in cap (t.ex. 10 prisbasbelopp) eller koppling till orsakad faktisk skada.

### B.4 RUT-konsekvens (§5.2 b)

50 %-drag vid bristande Check-in/ut är affärsmodellsmässigt logiskt eftersom Spick förlorar RUT-utbetalning. **Men:** klausulen behöver verifieras mot:
- Skatteverkets faktiska bevis-krav (vad räcker som "utfört arbete"?)
- Kollektivavtalsmotsvarighet (Hemfrid är kollektivavtalsbundet — Spick är inte)
- Konsumentverkets praxis om "vitesklausuler" mot näringsidkare

**Farhad: se `2026-04-25-jurist-checklist.md` för klausul-för-klausul-bedömningspunkter.**
