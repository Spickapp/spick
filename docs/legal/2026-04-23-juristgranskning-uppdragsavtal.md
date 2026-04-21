# Juristgranskning — Spicks Underleverantörsavtal

**Beställare:** Haghighi Consulting AB (org.nr 559402-4522), bifirma Spick
**Kontaktperson:** Farhad Haghighi — hello@spick.se / farrehagge@gmail.com
**Datum för underlag:** 2026-04-23
**Nuvarande avtalsversion:** 2026-04-16 (commit `fea7f63`, live på spick.se/uppdragsavtal.html)

---

## 1. Kontext

### Om Spick

Spick är en digital plattform för bokning av städtjänster i Sverige. Affärsmodellen är Uber-liknande: kunder bokar direkt via plattformen, och det fysiska städarbetet utförs av självständiga egenföretagare med F-skatt som är anslutna till plattformen som underleverantörer. Spick är gränssnitt och huvudman gentemot slutkund — städaren är underleverantör till Spick.

- **Bolag:** Haghighi Consulting AB, bifirma Spick
- **Rättslig konstruktion:** Spick tillhandahåller städtjänsten till slutkund (huvudman). Städaren är självständig näringsidkare (underleverantör). Detta är ett underleverantörsavtal — inte ett anställningsavtal.
- **RUT-hantering:** Spick ansöker om RUT-avdrag hos Skatteverket i eget namn som utförare. Slutkund betalar halva kostnaden, Skatteverket halva. Städaren får sin andel från båda källor enligt §5.6.
- **Provisionsmodell:** Spick tar provision från varje genomfört uppdrag. Resten utbetalas till städaren via Stripe Connect.
- **Skala idag:** Liten pilot, förberedelser för B2B-pilot ("Rafa-piloten") i april-maj 2026. ~14 aktiva städare, ett mindre antal bokningar/dag.

### Varför revidering nu

Under internrevision 2026-04-22 upptäcktes fyra luckor/inkonsekvenser i nuvarande avtal som behöver åtgärdas innan:
1. Nästa städare registrerar sig (**commission-läckage är kritisk**)
2. Rafa-piloten startar (**RUT-avslags-scenario måste vara avtalsreglerat**)
3. Plattformen skalas med fler städare (**ändringsrätt och bevisbörda vid acceptans**)

Farhad föredrar att hantera alla fyra i en samlad revideringsrunda efter juristgranskning. Utkast finns nedan — juristen ombes validera, justera och flagga ytterligare luckor.

### Vad den här granskningen omfattar

- **Huvudfokus:** Fyra konkreta ändringar/tillägg till befintligt avtal (§5.1, ny §5.7, §13, plus en teknisk fråga om acceptansbevis)
- **Utanför scope:** Fullständig omredigering av avtalet, gränsdragning mot anställningsavtal (separat fråga), konsumenttjänstlagsanalys mot slutkund (separat fråga)
- **Bilaga:** Hela nuvarande avtalstext i ren text (bilaga A nedan)

---

## 2. Fyra frågor

### Fråga 1 — Commission-läckage (KRITISK)

#### Nuvarande text (§5.1 Provision, rad 62-68 i källfilen)

Exakt citat från [uppdragsavtal.html](../../uppdragsavtal.html):

> **5.1 Provision**
>
> Spick tar en förmedlingsavgift (provision) på varje genomfört uppdrag:
>
> - Privatuppdrag: 17 % av jobbvärdet
> - Företagsuppdrag: 12 % av jobbvärdet
>
> Ändring av provisionssats meddelas skriftligen minst 30 dagar i förväg.

#### Problemet

Prod-koden har aldrig tillämpat 17 %-satsen. Alla bokningar — privat som företag — debiteras 12 % provision från ett värde i systemtabellen `platform_settings.commission_standard=12`. Avtalet och faktisk drift har alltså legat isär sedan dag 1.

Ingen städare har ännu reklamerat, men risken är uppenbar: en städare som läst avtalet (17 % privat) och sedan ser 12 % i självfakturan kan — visserligen i städarens egen favör — hävda avtalsbrott, alternativt använda diskrepansen som argument i annan tvist. Konsekvensen för Spick är främst försvagat juridiskt läge snarare än ekonomiskt.

Farhad har beslutat att **12 % flat** är den kommersiellt korrekta satsen. Avtalet ska harmoniseras nedåt (inte prod-koden uppåt).

#### Föreslagen ny text

> **5.1 Provision**
>
> Spick tar en förmedlingsavgift (provision) om **12 % av jobbvärdet** på varje genomfört uppdrag, oavsett om uppdraget är ett privat- eller företagsuppdrag.
>
> Ändring av provisionssats sker enligt §13.

#### Specifika frågor till juristen

a) Är formuleringen "oavsett om uppdraget är ett privat- eller företagsuppdrag" tillräckligt entydig, eller bör vi räkna upp alternativen mer explicit (hemstädning, flyttstädning, kontorsstädning, fönsterputs, trappstädning)?

b) Behöver avtalet ha en övergångsbestämmelse för de städare som redan signerat 17/12-versionen? Vår bedömning är **nej** eftersom vi aldrig fakturerat 17 % mot någon, men vi vill ha ditt ord på det.

c) Är det juridiskt hållbart att länka till §13 för ändringsförfarandet (se Fråga 3 nedan), eller bör §5.1 upprepa 30-dagarsregeln?

---

### Fråga 2 — §5.7 RUT-avslag (HÖG — pre-Rafa-pilot)

#### Nuvarande text (§5.6, rad 77-82)

Avtalet har följande passus om två-stegs utbetalning vid RUT-uppdrag:

> **5.6 Betalning i två steg (RUT-uppdrag)**
>
> Vid uppdrag med RUT-avdrag betalas Underleverantören i två steg:
>
> 1. **Steg 1 (efter utfört och godkänt uppdrag):** Underleverantörens andel av det belopp slutkunden betalat betalas ut via Stripe Connect.
> 2. **Steg 2 (efter Skatteverkets utbetalning):** Underleverantörens andel av RUT-beloppet betalas ut efter att Spick mottagit utbetalningen från Skatteverket (normalt 2–4 veckor).

#### Problemet

Avtalet beskriver det positiva flödet men inte scenariot där Skatteverket avslår RUT-ansökan. Vanliga skäl till avslag:
- Slutkunden har redan förbrukat sin RUT-kvot (75 000 kr/år)
- Fel personnummer angivet
- Slutkund under 18 eller saknar hemvist i Sverige
- Felaktigt eller ofullständigt RUT-ansökningsunderlag från Spicks sida (sällsynt men möjligt)

Utan avtalsreglering blir frågan öppen: ska städaren ändå få andel av RUT-beloppet? Spick kan inte ekonomiskt bära avslag som beror på slutkundens förhållanden (kvoten, fel PNR) eftersom Spick själv inte får pengarna. Men vid **Spicks eget administrativa fel** vill Spick ha möjlighet att frivilligt kompensera städaren som goodwill, utan att det skapar en precedens eller rättslig skyldighet.

Farhads linje: **mellanväg — Spick har rätten men inte skyldigheten att kompensera.**

#### Föreslagen ny text (ny §5.7, med påverkan på numreringen av §5.7-5.7 → §5.8)

> **5.7 Avslag från Skatteverket**
>
> Om Skatteverket avslår slutkundens RUT-ansökan för ett uppdrag — helt eller delvis — utgår Underleverantörens Steg 2-utbetalning enligt §5.6 inte, respektive utgår endast i den utsträckning Skatteverket betalar ut. Spick bär ingen ekonomisk skyldighet att ersätta Underleverantören för det uteblivna beloppet.
>
> Spick kan emellertid i det enskilda fallet besluta om frivillig kompensation till Underleverantören, särskilt när avslaget beror på administrativa fel som Spick ansvarar för (exempelvis felaktig ansökningsrutin eller bristfällig rapportering från Spicks sida). Ett sådant beslut är en skönsmässig goodwillåtgärd. Det skapar ingen rätt till kompensation för Underleverantören i framtida fall och utgör inte någon precedens för Spicks agerande vid andra avslag.
>
> Vid avslag informerar Spick Underleverantören skriftligen inom 7 dagar från att Spick mottagit besked från Skatteverket. Meddelandet innehåller avslagets omfattning (del- eller helavslag) samt, i den utsträckning Spick har rätt att dela informationen, Skatteverkets angivna skäl.
>
> Om Skatteverket i efterhand återkräver redan utbetalat RUT-belopp (exempelvis efter kontroll som avslöjar felaktiga uppgifter från slutkunden) har Spick rätt att kvitta motsvarande belopp från Underleverantörens framtida utbetalningar, under förutsättning att återkravet inte beror på fel i Spicks eget ansökningsförfarande.

(Efterföljande §5.7 "Reklamation och kvalitetsansvar" numreras om till §5.8.)

#### Motivering för mellanväg-formulering

- **"Spick bär ingen ekonomisk skyldighet"** — etablerar huvudregeln.
- **"Spick kan emellertid … besluta om frivillig kompensation"** — bevarar Spicks handlingsfrihet vid eget fel.
- **"skönsmässig goodwillåtgärd … skapar ingen rätt … ingen precedens"** — skyddar mot att en enskild goodwill-utbetalning tolkas som avtalsenlig skyldighet vid nästa avslag.
- **"informerar skriftligen inom 7 dagar"** — ger städaren rimlig transparens utan att öppna för bevisbördeförflyttning.
- **Sista stycket om återkrav** — skyddar Spick mot senare Skatteverk-kontroller.

#### Specifika frågor till juristen

a) Är formuleringen "skönsmässig goodwillåtgärd som inte skapar rätt till kompensation i framtida fall" tillräckligt tydlig för att undvika att det enskilda beslutet tolkas som culpa in contrahendo eller som konkludent handlande som binder framtida beteende?

b) **Avtalslag 36 § (oskälighet):** Bedömer du att klausulen — sett i ljuset av att städaren inte har inflytande över Skatteverkets beslut eller över slutkundens RUT-underlag — står sig mot jämkning? Vår bedömning är att den står sig eftersom (i) Spick själv inte får pengarna vid avslag och därför inte gör någon obehörig vinst, (ii) städaren får fullt betalt för utfört arbete i den mån Skatteverket betalar, (iii) Steg 1-utbetalningen (den andel slutkunden betalat) är oberoende av Skatteverkets beslut.

c) Räcker 7-dagars-fristen för skriftligt besked, eller bör den förlängas? Stripe-utbetalningen sker normalt 2-4 veckor efter Skatteverket-godkännande. Om besked om avslag kommer dag 25 och städaren förväntar Steg 2 dag 28, kan en 7-dagars-frist från Spicks mottagande kännas för snäv för städaren.

d) Skulle du rekommendera att vi uttryckligen listar de vanligaste avslagsgrunderna (slutkundens RUT-kvot förbrukad, fel PNR, åldersgräns) i avtalstexten som pedagogisk upplysning, eller bidrar det till onödig komplexitet?

---

### Fråga 3 — Ensidig ändringsrätt §13 (MEDIUM — skalningsrisk)

#### Nuvarande text (§13 Ändringar, rad 131-132)

> **13. Ändringar**
>
> Väsentliga ändringar meddelas via e-post minst 30 dagar innan ikraftträdande.

#### Problemet

Avtalet säger HUR en ändring sker (e-post, 30 dagar) men inte OM Spick har rätt att genomföra den ensidigt. Passiv konstruktion — "meddelas" utan angiven aktör. Om Spick senare höjer provisionen från 12 % till 15 % och en aktiv städare bestrider, kan städaren argumentera att avtalet aldrig gav Spick ensidig ändringsrätt — bara en notifikationsmekanism som förutsätter att ändringen redan har avtalats på annat sätt.

Ensidig ändringsrätt är affärskritiskt i en plattformsmodell där vi kan behöva justera ekonomiska parametrar i takt med att marknaden utvecklas. Men klausulen måste vara utformad så den inte uppfattas som oskälig enligt Avtalslag 36 §.

#### Föreslagen ny text

> **13. Ändringar**
>
> Spick har rätt att ensidigt ändra provisionssats, avgifter och övriga avtalsvillkor genom skriftlig förvarning via e-post till den adress Underleverantören angivit. Förvarningen ska ske minst 30 dagar innan ändringens ikraftträdande.
>
> Fortsatt användning av plattformen efter ikraftträdandedatumet innebär att Underleverantören har accepterat ändringen.
>
> Om Underleverantören inte accepterar ändringen kan avtalet sägas upp enligt §11 utan uppsägningstid, med rätt till full utbetalning för uppdrag som genomförts före uppsägningstidpunkten.
>
> Ändringar av villkor som följer av tvingande lag eller myndighetsbeslut kan träda i kraft omedelbart utan 30-dagars-fristen, mot meddelande till Underleverantören så snart det är möjligt.

#### Specifika frågor till juristen

a) **Avtalslag 36 § (primärrisk):** Är 30-dagars-fristen + fortsatt-användning-konstruktionen + "utan uppsägningstid"-utvägen tillräcklig för att klausulen ska vara skälig? Vår bedömning är att kombinationen motsvarar branschpraxis hos plattformar som Foodora, Tiptapp och liknande. Men vi saknar kompetens att bedöma gränsen.

b) Bör "fortsatt användning" definieras mer precist? Alternativ: "Fortsatt inloggning på plattformen" / "Fortsatt accepterande av uppdrag" / "Genomförande av uppdrag". Vilken ger starkast bevisvärde utan att bli onödigt restriktiv?

c) Sista stycket om "tvingande lag eller myndighetsbeslut" — är den formuleringen tillräcklig eller behöver vi specificera typer (skatteregler, arbetsmiljöregler, dataskyddsregler)?

d) Behöver vi kombinera med en rätt för städaren att **invända mot** ändringen (inte bara säga upp)? I så fall: vad händer om städaren invänder men inte säger upp? Vår instinkt är att undvika den mekanismen för att hålla det enkelt, men vi vill höra din bedömning.

---

### Fråga 4 — Acceptansbevis och DB-logg (MEDIUM — teknisk)

#### Nuvarande tillstånd

Avtalsacceptansen sker idag genom en HTML-kryssruta på [registrera-stadare.html:659-664](../../registrera-stadare.html:659):

```html
<label class="check-row">
  <input type="checkbox" id="chkTerms">
  <span data-i18n="chkTermsLabel">Jag godkänner Spicks
    <a href="uppdragsavtal.html" target="_blank">uppdragsavtal</a> och
    <a href="integritetspolicy.html" target="_blank">integritetspolicy</a>.</span>
</label>
```

Validering i [registrera-stadare.html:1107](../../registrera-stadare.html:1107):
```
if (!document.getElementById('chkTerms').checked) {
  alert('Du måste godkänna uppdragsavtalet och integritetspolicyn'); return;
}
```

**Databasen loggar idag INGET** om:
- När städaren godkände avtalet (`terms_accepted_at`)
- Vilken version av avtalet som godkändes (`terms_version`)
- IP-adress, enhet eller annan metadata som skulle styrka att det var städaren själv

Om en städare om två år bestrider "jag har aldrig godkänt den versionen" har Spick idag ingen bevisning att erbjuda utöver "vår plattform kräver bockruta för att komma vidare".

#### Planerad teknisk åtgärd

1. Lägg till kolumner i `cleaners`-tabellen (eller `cleaner_applications`):
   - `terms_accepted_at TIMESTAMPTZ` — exakt tidsstämpel
   - `terms_version TEXT` — t.ex. `"v2026.04.23"`
2. Vid registrering fyller frontend i båda värden tillsammans med övrig profildata.
3. Avtalstexten märks upp med version i filhuvudet (`<meta name="version" content="v2026.04.23">` + synlig text "Version: 2026-04-23").
4. Vid framtida ändring av avtalet bumps versionen och städare som är inloggade ombeds acceptera ny version (kräver separat ombaccepterings-flöde — **utanför scope för denna granskning**).

#### Specifika frågor till juristen

a) **Bevisvärde:** Är kombinationen `terms_accepted_at` + `terms_version` + HTML-kryssruta tillräcklig bevisning i en svensk domstol/tingsrätt, eller krävs starkare verifiering (BankID-signatur, IP-logg, e-post-bekräftelse)? Vi har idag BankID-verifiering **som separat steg** i onboarding men den är inte kopplad till själva avtalsacceptansen.

b) **Retroaktiv versionering:** Vad gör vi med de ~14 aktiva städare som signerade nuvarande avtal utan logg? Alternativ:
   - (i) Sätt `terms_accepted_at = signup_date` och `terms_version = "v2026.04.16 (pre-logging)"` retroaktivt
   - (ii) Skicka omaccepterings-mejl till samtliga och kräv ny acceptans
   - (iii) Inget — tolka första inloggning efter ikraftträdande av nya avtalet som konkludent acceptans

c) **Integritetspolicyn:** Samma kryssruta täcker både avtal och integritetspolicy. Räcker en gemensam `terms_accepted_at`, eller bör vi logga `privacy_accepted_at` separat? (Vår bedömning är att det räcker med gemensam tidsstämpel + två versionsfält, men vill höra din åsikt.)

d) **GDPR-interaktion:** `terms_accepted_at` och `terms_version` är personuppgifter med rättslig grund "avtal". Är den lagringsperiod som gäller för övriga avtalsbevis (normalt 10 år efter avtalets upphörande) även rätt för dessa loggar?

---

## 3. Risker att särskilt validera

Utöver de specifika frågorna ovan önskar vi att du med extra omsorg granskar följande övergripande risker:

### 3.1 Avtalslag 36 § (generalklausul om oskäliga villkor)

- **Provisions-klausulen** (§5.1 ny lydelse): 12 % flat — är satsen förutsebar nog? Referens till §13 för framtida ändringar?
- **RUT-avslags-klausulen** (ny §5.7): Placering av ekonomisk risk på städaren vid avslag som beror på slutkundens förhållanden — skälig?
- **Ensidig ändringsrätt** (§13 ny lydelse): Kombinationen av förvarning + fortsatt-användning-acceptans + uppsägningsrätt — skälig?
- **Reklamationsbestämmelsen** (nuvarande §5.7, framtida §5.8): "Innehålla betalning för aktuellt uppdrag" + "dra beloppet från Underleverantörens kommande utbetalningar" — skälig storlek av sanktion?

### 3.2 Arbetstagarrättslig gränsdragning

Avtalet är utformat som underleverantörsavtal (§2 "Underleverantörens självständighet" med 6 bullets om frihet att acceptera, bestämma tid, arbeta för andra osv.) — men Spick erbjuder betalning via plattformen, kvalitetsstyrning, matchning och betygssystem. Flera av dessa element återfinns i ärenden där Arbetsdomstolen (AD) omprövat klassificeringen (jfr Uber-prejudikat i andra jurisdiktioner).

Önskad bedömning: är gränsdragningen i dagens §2 hållbar gentemot AD-praxis? Behöver något förstärkas? (Exempel: om Spick inför utbildningsobligatorier, kläddesign eller beteendestandarder kan balansen tippa.)

### 3.3 Ensidig ändringsrätt mot konsumentperspektiv

Städarna är formellt näringsidkare (F-skatt) men många opererar som ensamföretagare nära konsumentliknande svaghet i förhandling. Är det någon aspekt av avtalet som en domstol skulle kunna bedöma med konsumentanaloga skyddsbetraktelser?

### 3.4 Mervärdesskattelagen 11 kap (självfakturering)

Avtalet §5.3 hänvisar till självfaktureringsförfarandet enligt ML 11 kap. Räcker den nuvarande formuleringen som godkännande-grund, eller bör den förstärkas?

### 3.5 Övriga luckor

Flagga gärna allt du upptäcker utöver de fyra frågorna — vi föredrar att rätta flera saker i en revideringsrunda framför att komma tillbaka om tre månader.

---

## 4. Process för vidare arbete

1. **Du återkopplar** med utlåtande per fråga (1-4) + risker 3.1-3.5 + egna flaggor.
2. **Farhad** beslutar baserat på utlåtandet och eventuella justeringar.
3. **Utvecklare** bygger PR med textändringar till [uppdragsavtal.html](../../uppdragsavtal.html) + teknisk DB-migration för Fråga 4.
4. **Eventuell andra granskningsrunda** om du önskar se slutgiltig text innan publicering.

Estimerad total tid för din granskning: 1-2 timmar. Arvode enligt offert.

---

## Bilaga A — Hela nuvarande avtalstext (ren text, version 2026-04-16)

Följande är fullständig avskrift av [uppdragsavtal.html](../../uppdragsavtal.html) utan HTML-markering, i den version som ligger live på spick.se 2026-04-23.

---

**Underleverantörsavtal – Spick**

*Senast uppdaterat: 16 april 2026 · Gäller från: 16 april 2026*

**Parter:** Haghighi Consulting AB (559402-4522), bifirma Spick ("Spick") och den egenföretagare som registrerar sig som städare ("Underleverantören")

**Grundprincip:** Underleverantören är en självständig egenföretagare — inte anställd av Spick. Spick tillhandahåller städtjänster till slutkund. Underleverantören utför det fysiska arbetet som en del av Spicks tjänst. Detta är ett underleverantörsavtal, inte ett anställningsavtal.

### 1. Bakgrund

Spick (spick.se) tillhandahåller städtjänster till privatpersoner och företag. Det fysiska städarbetet utförs av självständiga underleverantörer — städfirmor och enskilda städare med F-skatt. Spick ansvarar gentemot slutkund för bokning, betalning, kvalitet, RUT-hantering och kundservice. Underleverantören utför städtjänsten som självständig näringsidkare.

### 2. Underleverantörens självständighet

**2.1 Frihet att acceptera eller avböja.** Varje uppdrag kan accepteras eller avböjas utan negativa konsekvenser, med undantag för punkt 7 (betyg).

**2.2 Frihet att bestämma arbetstid.** Underleverantören sätter sin tillgänglighet, arbetsdagar och arbetstider via plattformen. Spick styr inte schemat.

**2.3 Frihet att arbeta för andra.** Full frihet att arbeta för andra plattformar, städföretag eller direkt mot egna kunder. Ingen exklusivitet.

**2.4 Eget sätt att utföra arbetet.** Underleverantören bestämmer hur arbetet utförs. Spick tillhandahåller riktlinjer som vägledning, inte detaljstyrning.

**2.5 Egen utrustning.** Underleverantören tillhandahåller i normalfallet egna rengöringsmedel och utrustning.

**2.6 Eget företag.** Underleverantören bedriver verksamhet med giltig F-skatt och ansvarar själv för skatter, sociala avgifter och moms.

### 3. Registrering och verifiering

Krav: giltig F-skatt, BankID-verifiering, minst 18 år, profilbild och presentation. Underleverantören ansvarar för att alla uppgifter är korrekta. Spick förbehåller sig rätten att avslå ansökningar utan att ange skäl.

### 4. Uppdragsförmedling

Spick matchar kunder med städare baserat på geografisk närhet, tillgänglighet och betyg. En acceptans är bindande. Upprepad avbokning av accepterade uppdrag kan påverka synlighet i matchningen.

### 5. Ersättning och betalning

**5.1 Provision.** Spick tar en förmedlingsavgift (provision) på varje genomfört uppdrag:

- Privatuppdrag: 17 % av jobbvärdet
- Företagsuppdrag: 12 % av jobbvärdet

Ändring av provisionssats meddelas skriftligen minst 30 dagar i förväg.

**5.2 Utbetalning.** Utbetalning sker automatiskt via Stripe Connect till Underleverantörens anslutna bankkonto. Utbetalningen sker normalt inom 2–7 bankdagar beroende på Stripes utbetalningsschema. Underleverantören ansvarar för att slutföra Stripe Connect-registreringen och hålla sina bankuppgifter uppdaterade.

**5.3 Självfakturering.** Spick utfärdar månadsvis självfakturor å Underleverantörens vägnar i enlighet med mervärdesskattelagen (ML) 11 kap. Självfakturan utgör bokföringsunderlag för båda parter och dokumenterar utbetalda belopp under perioden. Genom att acceptera detta avtal godkänner Underleverantören förfarandet med självfakturering. Underleverantören har rätt att granska och invända mot varje faktura inom 7 dagar från utfärdandet.

**5.4 Skatt.** Underleverantören ansvarar helt för sin egen beskattning, sociala avgifter och eventuell momsredovisning. Spick rapporterar utbetalda belopp till Skatteverket i den utsträckning lagen kräver.

**5.5 RUT-avdrag.** Spick ansöker om RUT-utbetalning hos Skatteverket i eget namn som utförare av städtjänsten. Underleverantören behöver inte hantera RUT-ansökan — detta sköts helt av Spick.

**5.6 Betalning i två steg (RUT-uppdrag).** Vid uppdrag med RUT-avdrag betalas Underleverantören i två steg:

1. **Steg 1 (efter utfört och godkänt uppdrag):** Underleverantörens andel av det belopp slutkunden betalat betalas ut via Stripe Connect.
2. **Steg 2 (efter Skatteverkets utbetalning):** Underleverantörens andel av RUT-beloppet betalas ut efter att Spick mottagit utbetalningen från Skatteverket (normalt 2–4 veckor).

**5.7 Reklamation och kvalitetsansvar.** Underleverantören ansvarar för att åtgärda reklamationer inom 48 timmar efter att Spick meddelat om klagomål. Åtgärd kan vara omstädning, prisavdrag eller annan överenskommen kompensation.

Om Underleverantören inte åtgärdar reklamation inom avtalad tid har Spick rätt att:

1. Innehålla betalning för aktuellt uppdrag
2. Anlita annan underleverantör för omstädning på Underleverantörens bekostnad
3. Återbetala slutkunden och dra beloppet från Underleverantörens kommande utbetalningar

Vid upprepade reklamationer (3 eller fler per kvartal) har Spick rätt att säga upp avtalet med omedelbar verkan.

### 6. Försäkring

Underleverantören ska ha giltig ansvarsförsäkring som täcker skador i samband med städuppdrag i såväl privatbostäder som företagslokaler. Försäkringen ska vara i kraft under hela perioden Underleverantören tar emot uppdrag via Spick.

Nytillkomna städare har en introduktionsperiod på 90 dagar att teckna ansvarsförsäkring. Under denna period bistår Spick med rekommendationer om lämpliga försäkringsalternativ.

Vid skada i kundens hem ansvarar Underleverantören i första hand genom sin ansvarsförsäkring. Spick bistår med dokumentation och kommunikation mellan parterna.

### 7. Kvalitet och betyg

Underleverantören förväntas utföra varje uppdrag fackmannamässigt och i tid. Kunder betygsätter efter varje uppdrag. Om genomsnittsbetyget sjunker under en viss nivå kan Spick kontakta Underleverantören för förbättringsåtgärder.

**7.1 Incheckning och GPS-verifiering.** Vid påbörjande och avslutande av uppdrag registrerar Underleverantören detta via Spicks webbapplikation ("Påbörja uppdrag" respektive "Markera klar"). I samband med detta loggas Underleverantörens GPS-position i syfte att verifiera att uppdraget utfördes på rätt plats. GPS-data lagras i enlighet med Spicks integritetspolicy och raderas när den inte längre behövs för verifiering eller tvistlösning.

**7.2 Fotodokumentation vid flyttstädning.** Vid flyttstädning kan Underleverantören valfritt fotografera resultat före och efter utfört arbete. Syftet är dokumentation vid eventuell besiktning eller tvist. Fotografier lagras i enlighet med Spicks integritetspolicy och raderas när de inte längre behövs för dokumentation eller tvistlösning. Fotografier delas aldrig med tredje part utan kundens samtycke.

### 8. Nöjdhetsgaranti

Alla uppdrag via Spick omfattas av en nöjdhetsgaranti. Om en kund inte är nöjd med utfört arbete och kontaktar Spick inom 48 timmar, åtar sig Underleverantören att återvända och åtgärda de anmärkta bristerna utan ytterligare ersättning.

Spick utreder klagomålet och kontaktar Underleverantören med en beskrivning av vad kunden vill ha åtgärdat. Underleverantören och kunden kommer överens om en tid för omstädning inom 5 arbetsdagar.

Om Underleverantören inte kan eller vill genomföra omstädningen kan Spick erbjuda kunden hel eller delvis återbetalning. Upprepade nöjdhetsärenden kan påverka Underleverantörens synlighet i matchningen.

### 9. Uppförandekod

- Behandla kunder med respekt och professionalism
- Inte diskriminera någon kund
- Respektera kundens hem och egendom
- Inte ta emot betalning utanför plattformen för Spick-förmedlade uppdrag
- Inte aktivt rekrytera Spick-förmedlade kunder utanför plattformen under avtalstiden
- Omedelbart rapportera skador och incidenter till Spick

### 10. Sekretess

Kundinformation (namn, adress, instruktioner) är konfidentiell och får enbart användas för att genomföra aktuellt uppdrag. Se även integritetspolicyn (spick.se/integritetspolicy.html).

### 11. Avtalstid och uppsägning

Avtalet gäller tillsvidare. Underleverantören kan säga upp när som helst. Spick kan säga upp med 30 dagars varsel. Vid allvarliga avtalsbrott — bedrägeri, förlorad F-skatt, upprepad misskötsel — kan Spick stänga kontot omedelbart. Utbetalning för genomförda uppdrag sker enligt normal rutin. Underleverantörens rätt att granska och invända mot självfakturor kvarstår även efter avtalets upphörande. Sekretessåtaganden gäller även efter avtalets upphörande.

### 12. Ansvar

Underleverantören ansvarar för skada som orsakas i samband med uppdrag och ska hålla Spick skadelös om krav riktas mot Spick från tredje part till följd av Underleverantörens agerande. Spick ansvarar gentemot slutkund för tjänstens kvalitet och hantering av reklamationer. Spick har regressrätt mot Underleverantören för kostnader som uppstår till följd av Underleverantörens bristfälliga utförande.

### 13. Ändringar

Väsentliga ändringar meddelas via e-post minst 30 dagar innan ikraftträdande.

### 14. Tillämplig lag

Svensk lag. Tvister avgörs i första hand genom förhandling, i andra hand av svensk allmän domstol.

### 15. Kontakt

**Haghighi Consulting AB** (org.nr 559402-4522), bifirma Spick
E-post: hello@spick.se · Webb: spick.se

---

*Slut bilaga A.*
