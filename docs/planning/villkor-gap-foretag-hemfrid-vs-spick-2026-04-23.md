# Gap-analys: Företagsvillkor — Hemfrid B2B vs Spick

**Skapad:** 2026-04-23
**Källa:** Hemfrid B2B-villkor (22 punkter, delade av Farhad) vs Spicks nuvarande dokument
**Relaterad:** [villkor-gap-hemfrid-vs-spick-2026-04-23.md](villkor-gap-hemfrid-vs-spick-2026-04-23.md) (konsumentvillkor)

---

## ⚠️ JURIST-UNDERLAG — EJ SLUTGILTIGA VILLKOR

Samma kärnprincip som konsument-dokumentet: allt utkast här är förslag till jurist, inte färdig avtalstext.

---

## Status i Spick (brutal sammanfattning)

**Spick har i praktiken inga B2B-villkor.**

- [kundvillkor.html](../../kundvillkor.html) §4.4 "Företagskunder" — **3 meningar**, enbart om moms (ingen B2B-specifik reglering)
- [avtal.html](../../avtal.html) — redirect till `uppdragsavtal.html` (det är STÄDARE-underleverantörsavtal, inte kundavtal)
- Ingen sida `villkor-foretag.html` eller motsvarande

**Konsekvens:** Varje B2B-bokning (Solid Services primära segment!) körs idag på konsument-villkor som är:
- Olämpliga juridiskt (distansavtalslag gäller ej B2B)
- Saknar sekretess, värvningsförbud, 3 mån uppsägning (ej 1 mån)
- Saknar B2B-specifika betalningsvillkor (20 dgr faktura efterskott)

---

## Hemfrid B2B vs B2C — nyckel-skillnader

| Område | Hemfrid B2C | Hemfrid B2B |
|---|---|---|
| Uppsägning | 1 mån | **3 mån** |
| Reklamation | Skälig tid | **72h** |
| Avbokning engångs | 5 vardagar / 25% | **14 dgr / skäligt belopp** |
| Avbokning abonnemang | Timbank | **Ingen kreditering** (helgdagar inbyggda i pris) |
| Ångerrätt | 14 dgr (Distansavtalslag) | **Ingen** (B2B saknar) |
| Priser | Inkl moms | **Exkl moms** |
| Fakturering | Varierande | 20 dgr efterskott |
| Värvningsförbud | — | **1 år ej-anställa** |
| Sekretess | — | **2 år efterverkan** |
| Tvist | ARN | Stockholms tingsrätt |

Dessa är inte småfix — de är **fundamentalt olika avtal**.

---

## Fullständig jämförelsetabell (Hemfrid B2B §1-22)

| § | Rubrik | Spick motsv. | Status | Kommentar |
|---|---|---|---|---|
| 1 | Allmänt | §1 (konsument) | ⚠️ | Ej B2B-specifik |
| 2 | **Avtalstid 3 mån** | — | ❌ | Saknas helt |
| 3 | **Kontaktperson** | — | ❌ | Saknas — juridiskt tomt för B2B |
| 4 | Bolagets åtagande | Implicit | ⚠️ | Fackmässigt utförande bör explicit |
| 5.1 | Tillträde + utrustning | — | ❌ | |
| 5.2 | Info om värdefulla föremål | — | ❌ | |
| 5.3 | **Nyckelhantering 3 mån** | — | ❌ | (Jfr konsument: 1 mån) |
| 5.4 | Arbetsmiljö | — | ❌ | |
| 6.1 | Utbildning | — | ❌ | |
| 6.2 | **Värvningsförbud 1 år** | — | ❌ | **Stor gap** — skyddar Spick + Solid Service |
| 7.1 | 48h ersättare vid sjukdom | §5.3 (konsument) | ⚠️ | Formulering skiljer |
| 7.2 | Force majeure-transport | §7.1 (konsument) | ⚠️ | |
| 8 | Underentreprenör | §1.1 (konsument) | ✓ | Finns |
| 9 | **Rätt att neka tjänst** | — | ❌ | Samma som konsumentgap |
| 10.1 | Prissättning med arbetsfria dagar inbyggda | — | ❌ | Affärsmodell-fråga |
| 10.2 | **Ingen kreditering löpande** | — | ❌ | B2B-specifikt |
| 10.3 | **14 dgr avbokning engångs** | §5.1 (24h?) | ❌ | Helt annat mönster för B2B |
| 10.4 | 14 dgr omboka | — | ❌ | |
| 11.1 | Priser exkl moms | §4.4 ✓ | ✓ | Enda B2B-punkten som finns |
| 11.2 | Prisjustering 1 mån varsel | — | ⚠️ | |
| 11.3 | Merarbete-debitering | — | ❌ | |
| 12.1 | **20 dgr efterskott faktura** | — | ❌ | Spick har förskott idag via Stripe — annan modell |
| 12.2 | Tilläggstjänster-fakturering | — | ❌ | |
| 12.3 | Engångsuppdrag-fakturering efter utförande | — | ❌ | |
| 12.4 | Invändning senast förfallodag | — | ❌ | |
| 12.5 | **Dröjsmålsränta + påminnelseavgift** | — | ❌ | Lagrum |
| 12.6 | Avbryta tjänst vid obetald | — | ❌ | |
| 12.7 | **Uppsägning vid 20 dgr obetald** | — | ❌ | |
| 13.1 | Ansvarsförsäkring | §6.5 (konsument) | ⚠️ | B2B bör spec. |
| 13.2 | **Kundens egen försäkring** | — | ❌ | B2B-skydd |
| 14.1 | Ej debitering vid ej utfört | Implicit | ⚠️ | |
| 14.2 | Avhjälpande före prisavdrag | — | ❌ | |
| 14.3 | Bevisbörda skada | — | ⚠️ | |
| 14.4 | **72h reklamation** | — | ❌ | Kortare än konsument |
| 14.5 | Reklamation via mail | §6 (konsument) | ⚠️ | |
| 15.1 | Direkta skador | §7.2 (konsument) | ⚠️ | |
| 15.2 | Ej indirekt skada | §7.2 | ✓ | |
| 15.3 | **Cap 1 prisbasbelopp/år** | — | ❌ | **STÖRSTA risken — B2B också** |
| 15.4 | Undantag grov vårdslöshet | — | ⚠️ | |
| 15.5 | Ej förslitning + värdefulla okända | — | ❌ | |
| 15.6 | Jämkning medvållande | — | ⚠️ | |
| 16 | **Sekretess 2 år efterverkan** | — | ❌ | **Stor gap** — affärshemligheter |
| 17 | Personuppgifter | §9 (konsument) | ⚠️ | |
| 18 | Cookies | Integritetspolicy | ⚠️ | Bör länkas |
| 19 | **Överlåtelse (koncern + fordringar)** | — | ❌ | |
| 20 | **Force majeure** | §7.1 (konsument) | ⚠️ | Utvidga till B2B-lista |
| 21 | Villkorändringar | §10 (konsument) | ⚠️ | |
| 22 | **Tvist → Stockholms tingsrätt** (EJ ARN) | §11 (konsument → ARN) | ❌ | Helt fel för B2B |

---

## Top-7 kritiska gaps B2B (utöver konsument-gaps)

Tillägg utöver de 7 konsument-gaps. B2B har unika risker:

### 1. 3 månaders uppsägning (§2)
**Utkast:** *"Löpande avtal gäller tills vidare från undertecknande och kan sägas upp med iakttagande av tre (3) månaders uppsägningstid. Avtalet upphör sista dagen i den månad som infaller efter att tre (3) månader har passerat."*

**Varför:** B2B-avtal med återkommande städning behöver längre uppsägning än konsument (personal-planering, ny kundupphandling).

---

### 2. Värvningsförbud 1 år (§6.2)
**Utkast:** *"Kunden har inte rätt att utan Bolagets skriftliga medgivande, under avtalstiden eller inom ett (1) år efter avtalstidens utgång, anställa eller i övrigt anlita person som utfört arbete hos Kunden för Bolagets räkning."*

**Varför:** Kritiskt för Solid Service-modellen — team-medlemmar kan lätt poachas direkt av företagskund som vill gå runt Spick-provisionen. Utan denna klausul: kund kan säga upp avtal, anställa Nasiba direkt, betala henne mindre, Spick + Zivar förlorar allt.

**Risk utan:** Hela Solid Service-affärsmodellen är sårbar.

---

### 3. Sekretess 2 år (§16)
**Utkast:** *"Vardera parten förbinder sig att inte utan den andra partens medgivande till tredje man under avtalstiden eller under en tid av två (2) år därefter utlämna uppgifter om den andra partens verksamhet som kan vara att betrakta som affärs- eller yrkeshemlighet."*

**Varför:** Städare ser kontor inifrån — dokument på skrivbord, whiteboards, samtal. Sekretess skyddar båda parter.

**Lagrum:** Lag (2018:558) om företagshemligheter.

---

### 4. 72h reklamation (§14.4)
**Utkast:** *"Kunden ska reklamera fel eller brist avseende en utförd Tjänst till Bolaget så snart som möjligt och senast inom sjuttiotvå (72) timmar från det att Tjänsten utfördes."*

**Varför:** Kortare tid än konsument. B2B-kund har professionella rutiner att inspektera arbete.

---

### 5. 14 dgr avbokning engångs + ingen kreditering löpande (§10.2-10.4)
**Utkast:** *"Om Kund avbokar tjänstetillfälle vid löpande avtal sker ingen kreditering av priset. Kund kan kostnadsfritt avboka köp av engångstjänst om avbokningen sker senast 14 dagar innan utförandedatum. Om Kunden avbokar närmare utförandedatum än 14 dagar debiteras Kunden skäligt belopp."*

**Varför:** B2B-modell med helgdagar inbyggda i pris = ingen återbetalning vid avbokning. Helt annat än konsument-timbank.

---

### 6. 20 dgr efterskott-fakturering (§12.1) — OBS avviker från Spicks nuvarande modell
**Utkast:** *"Vid löpande avtal faktureras utförda Tjänster månadsvis i efterskott. Betalning ska vara Bolaget tillhanda senast tjugo (20) dagar efter fakturadatum."*

**Affärsbeslut:** Spick kör idag FÖRSKOTT via Stripe (kort/Klarna). Ska B2B få annat betalningsvillkor?
- **Behåll Stripe förskott:** enklare, ingen dröjsmålsrisk, men svårare att vinna B2B-affär
- **20 dgr faktura:** branschstandard för B2B, bättre konverterings men kreditrisk
- **Hybrid:** nya kunder → förskott; etablerade kunder → faktura

**Verifiera med Farhad.**

---

### 7. Tvist → Stockholms tingsrätt (§22)
**Utkast:** *"Detta Avtal regleras av och tolkas i enlighet med svensk lag. Tvister som uppstår i anledning av detta Avtal ska avgöras av allmän domstol varvid Stockholms tingsrätt ska vara första instans."*

**Varför:** B2B-kund kan INTE vända sig till ARN (ARN är endast konsument-forum). Krävs separat tvistklausul.

---

## Rekommenderad arkitektur

Två separata villkorssidor istället för en blandad:

```
/kundvillkor.html          ← konsument (som idag, kompletterad enligt gap-analys A)
/villkor-foretag.html      ← NY, B2B-specifik
/avtal.html                ← omdirigerar idag felaktigt till uppdragsavtal; bör bli B2B-ramavtal
/uppdragsavtal.html        ← städare-underleverantör (oförändrat)
```

**Navigationsflöde i boka.html:**
- `customerType='privat'` → länk till `kundvillkor.html`
- `customerType='foretag'` → länk till `villkor-foretag.html`

**Book-flow i UI:** checkbox "Jag godkänner villkoren" med länk till rätt sida beroende på kundtyp.

---

## Uppdaterat jurist-paket

Kombinerat med konsumentgap-analys + go-live-checklist:

| Leverans | Estimerad tid |
|---|---|
| Revidering kundvillkor.html (konsument) | 6-10h |
| **NY villkor-foretag.html (B2B)** | **8-14h** |
| Underleverantörsavtal-mall (Spick ↔ Solid) | 4-6h |
| DPA-mall | 3-5h |
| Villkor-stadare genomgång | 2-4h |
| Ramavtal-mall (B2B engångs vs löpande) | 3-5h |
| **Totalt** | **26-44h** |

B2B-delen är ~40% av totalarbetet — men det är kritiskt för Solid Service-affären.

---

## Extra frågor för Farhad + jurist

1. **Betalningsmodell B2B:** Stripe förskott eller 20 dgr faktura? Avgörande för cash-flow.
2. **Värvningsförbud:** ska gälla mellan kund och Spick, mellan kund och Solid, eller båda? Hemfrid har "anställd person som utfört arbete hos Kunden för Bolagets räkning" — täcker båda men entydigt formulering behövs för three-party-struktur (Kund, Spick, Städföretag).
3. **RUT ej tillämpligt B2B** — redan nämnt i kundvillkor §4.4 men bör flyttas till B2B-villkor.
4. **Försäkrings-minima:** Solid Services försäkring måste täcka B2B-klienter. Hemfrid nämner "lämplig i förhållande till Tjänsterna" — jurist bör specificera min-belopp (10-50 MSEK ansvarsförsäkring typiskt).

---

## Regel-efterlevnad

- **#26** grep-före-edit — ingen edit av villkorsfiler
- **#27** scope-respekt — analysdokument + jurist-underlag, INTE implementering
- **#28** single source — denna fil är enda B2B-gap-analysen
- **#29** audit-först — läst kundvillkor + avtal.html + Hemfrids B2B innan analys
- **#30** kärnprincip — **alla utkast markerade "till jurist"**, inga absoluta juridiska påståenden
- **#31** primärkälla över memory — Hemfrids B2B-text + SFS-referenser

---

## Relaterade dokument

- [villkor-gap-hemfrid-vs-spick-2026-04-23.md](villkor-gap-hemfrid-vs-spick-2026-04-23.md) — konsumentgap (parallell analys)
- [go-live-solid-service-checklist.md](go-live-solid-service-checklist.md) — operationell plan
- [todo-foretag-dashboard-vd-workflows-2026-04-23.md](todo-foretag-dashboard-vd-workflows-2026-04-23.md) — dashboard-gaps

---

## Nästa steg

1. **Farhad:** verifiera betalningsmodell-beslut (fråga 1 ovan)
2. **Farhad:** skicka ALLA tre planningsfiler + existing villkorsfiler till jurist
3. **Jurist:** leverera B2C + B2B-villkor + avtalmallarna (26-44h arbete)
4. **Claude:** när jurist-text kommer tillbaka → publicera i HTML-filerna (B2C-revidering av kundvillkor.html + NY villkor-foretag.html)
5. **Claude:** uppdatera boka.html för att länka rätt villkor beroende på kundtyp
