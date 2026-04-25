# Analys — 14 dagars ångerrätt-formulering i boka.html

**Datum:** 2026-04-25
**Trigger:** Farhads fråga: "Stämmer verkligen 14 dagars ångerrätt? Den gäller väl inte när arbetet utförs. Dubbelkolla gärna detta."
**Format:** DATA + lagrum-citat + textförslag. Min disclaimer #30 — du som jurist bedömer.

---

## 1. Slutsats (TL;DR)

**Befintlig text i `boka.html` rad 701** (per grep 2026-04-25):

> "Jag godkänner kundvillkoren och integritetspolicyn. Jag är informerad om min **14 dagars ångerrätt** enligt distansavtalslagen och samtycker till att städtjänsten kan påbörjas inom ångerfristen."

**Min observation (data, inte juridisk bedömning):**

Lag (2005:59) 2 kap 11 § 1 ställer **två krav** för att ångerrätten ska upphöra vid en tjänst som påbörjats:

1. ✅ Konsumenten har **samtyckt till att tjänsten börjar utföras** — *texten i boka.html uppfyller detta*
2. ❌ Konsumenten har **gått med på att det inte finns någon ångerrätt när tjänsten har fullgjorts** — *texten saknar denna explicit formulering*

**Farhads misstanke är korrekt.** Befintlig text täcker bara halva lagkravet. Du som jurist bedömer juridisk konsekvens.

---

## 2. Lagrum ordagrant

**Källa:** [Lag (2005:59) om distansavtal och avtal utanför affärslokaler](https://lagen.nu/2005:59) (verifierat WebFetch 2026-04-25)

### 2 kap 10 § — Ångerfristens längd

> "Konsumenten har rätt att frånträda avtalet (ångerrätt) genom att till näringsidkaren lämna eller sända ett tydligt meddelande om detta inom **14 dagar** från den dag som anges i 12 §"

### 2 kap 11 § punkt 1 — Undantag (KRITISK FÖR SPICK)

> "[Ångerrätt gäller inte för avtal som] avser en tjänst som har fullgjorts – mot betalning om konsumenten uttryckligen har **samtyckt till att tjänsten börjar utföras** och **gått med på att det inte finns någon ångerrätt när tjänsten har fullgjorts**"

### 2 kap 2 § — Informationskrav före avtal

> "[Näringsidkaren ska] informera om huruvida och under vilka förutsättningar det finns en **ångerrätt, tidsfristen och övriga villkor för ångerrätten**"

### 2 kap 4 § — Bekräftelse efter avtal

> "[Bekräftelsen ska visa] om konsumenten i enlighet med 11 § har gått med på att det inte finns någon ångerrätt"

---

## 3. Konsekvens-analys

### 3.1 Vad händer juridiskt om bara halva kravet uppfylls?

**Min läsning av lagtexten (data, inte tolkning):**
- Om bara samtycke till påbörjande finns (§11 p.1 första del) men INTE explicit avstående (§11 p.1 andra del)...
- ...kan konsument hävda att 14 dagars ångerrätt **fortsatt gäller** trots att tjänsten utförts
- Konsekvens: konsument kan kräva återbetalning + Spick kan inte hävda fullt undantag

**Du som jurist bedömer faktisk juridisk konsekvens.** Min roll är data-leverans.

### 3.2 Vad händer praktiskt?

Realistiskt scenario:
1. Kund bokar städning. Klickar checkbox enligt befintlig text.
2. Spick utför städningen.
3. Kund ångrar sig 5 dagar senare. Hänvisar till distansavtalslagen 14 dagars ångerrätt.
4. Spick svarar: "Du samtyckte till att tjänsten påbörjas inom ångerfristen."
5. Kund: "Men jag avstod inte uttryckligen min ångerrätt."
6. **Vid tvist:** ARN/domstol bedömer om texten är tillräcklig per §11 p.1.

**Risk:** Kund kan vinna och få full återbetalning trots att tjänsten utförts.

### 3.3 Branschpraxis

**Hemfrid (verifierat WebFetch 2026-04-25):**
- Hemfrid §6 om avbokning behandlar ekonomiska frågor men nämner inte explicit ångerrätt
- §13.2 reklamation 48 h är separat fråga från distansavtals-ångerrätt
- **Slutsats:** Hemfrid har inte publik klausul som matchar precis denna situation. Kan vara medvetet val (de kanske debiterar enligt §6.3 25 % oavsett ångerrätt) eller hanteras i kund-kommunikation snarare än villkor.

**Vardagsfrid:**
- Avbokning 14+ dagar gratis, mindre än 14 dagar = full debit utan RUT
- Inget explicit om distansavtals-ångerrätt
- Praktiskt: 14 dagars-avbokning matchar 14 dagars-ångerrätt-period

**Städade Hem:**
- 24 timmar avbokning gratis, sedan 100 % debit
- Inget explicit om distansavtals-ångerrätt

**Slutsats:** Inget direkt branschmönster för att ange explicit "avstå ångerrätt". Många plattformar verkar lita på att §11 p.1 första del räcker eller hanterar via avbokning-villkor.

---

## 4. Textförslag — alternativ för boka.html-checkbox

### Alternativ A — Strikt lag-konform (rekommenderad mest skyddsvärd)

> "Jag godkänner [kundvillkoren](kundvillkor.html) och [integritetspolicyn](integritetspolicy.html). Jag är informerad om min 14 dagars ångerrätt enligt distansavtalslagen (2 kap 10 § lag 2005:59). **Jag samtycker uttryckligen till att städtjänsten påbörjas inom ångerfristen och godkänner att jag därigenom förlorar ångerrätten när tjänsten har fullgjorts** (2 kap 11 § p. 1)."

**Fördel:** Uppfyller båda lagkravs delar explicit.
**Nackdel:** Längre, mer juridiskt språk → kan avskräcka kund.

### Alternativ B — Vardagligt språk

> "Jag godkänner [kundvillkoren](kundvillkor.html) och [integritetspolicyn](integritetspolicy.html). Jag är informerad om min 14 dagars ångerrätt enligt distansavtalslagen, men förstår och godkänner att ångerrätten upphör när städtjänsten har utförts."

**Fördel:** Lättläst för konsument.
**Nackdel:** "Förstår" är otydligare än "samtycker uttryckligen".

### Alternativ C — Två-stegs (separata checkboxar)

```
[ ] Jag godkänner kundvillkoren och integritetspolicyn.
[ ] Jag samtycker till att städtjänsten påbörjas inom 14 dagars ångerfrist.
[ ] Jag godkänner att ångerrätten upphör när tjänsten har fullgjorts.
```

**Fördel:** Tydligast separation av samtycken — starkast juridiskt skydd.
**Nackdel:** 3 checkboxar = friktion i bokningsflöde.

### Alternativ D — Smart formulering med pris-kontext

> "Jag godkänner [kundvillkoren](kundvillkor.html), [integritetspolicyn](integritetspolicy.html) och avbokningsvillkoren. **Jag förstår att jag har 14 dagars ångerrätt enligt distansavtalslagen, men begär uttryckligen att städtjänsten påbörjas inom ångerfristen och avstår därmed från ångerrätten när tjänsten har fullgjorts. Vid avbokning före utförande gäller §4 i kundvillkoren** (24-48 h = 25 %, < 24 h = 100 %)."

**Fördel:** Kopplar ångerrätt-avstående till avbokning-villkor — pedagogiskt.
**Nackdel:** Längst.

---

## 5. Min rekommendation

**Alternativ A** är min rekommendation om du prioriterar juridisk styrka. **Alternativ C** är starkast men ger UX-friktion.

Du som jurist bedömer:
- Om "explicit samtycke" i lag 2005:59 §11 p.1 kräver två separata checkbox-handlingar
- Eller om en enda checkbox med tydlig text räcker
- Branschpraxis verkar luta åt en checkbox med tydlig text — men ARN-/HD-praxis kan ha skärpt sedan

---

## 6. Skiljelinje ångerrätt vs avbokning vs reklamation

För kund-kommunikation och Spicks villkor är det viktigt att skilja på:

| Begrepp | Lag/källa | När gäller | Vad innebär |
|---|---|---|---|
| **Ångerrätt** | Lag 2005:59 (distansavtalslagen) | 14 dagar från avtal vid distans-/utanför-lokal-avtal | Konsument kan ångra avtalet utan grund |
| **Avbokning** | Privaträttsligt avtal | Reglerat av kundvillkor §4 | Kund avbokar bokad tid; kostnader per kundvillkor §4.3 |
| **Reklamation** | Konsumenttjänstlagen 17 § + kundvillkor §9 | Vid fel i utförd tjänst | Avhjälpande, prisreduktion, skadestånd |

**Varför viktigt:** Befintlig text i `boka.html` blandar ångerrätt-begrepp med avbokning-mekanism. Det skapar förvirring.

**Förslag:** Kundvillkor bör ha separat §X "Ångerrätt" (utöver §4 Avbokning + §9 Reklamation) som klart beskriver:
- Att 14 dagars ångerrätt finns vid bokning via spick.se (distansavtal)
- Hur kunden avstår vid bokning
- Hur kunden utövar ångerrätt om hen vill (mejl till hello@spick.se)
- Återbetalning-process
- Eventuell ersättning för utförd del om kund ångrar mid-tjänst (lagen kräver proportionerlig ersättning)

---

## 7. Konkreta action-items för dig

| # | Beslut | Min input |
|---|---|---|
| 1 | Bekräfta att §11 p.1 kräver båda samtycken (påbörjande + avstående) | Lag-texten är tydlig om båda kraven, men din juridiska bedömning av "uttryckligen" + branschpraxis fäller |
| 2 | Välj Alt A / B / C / D för boka.html-checkbox-text | Min rek: A (juridisk styrka) eller C (starkast skydd) |
| 3 | Lägg till §X "Ångerrätt" i kundvillkor (separat från avbokning §4) | Föreslår + skissar vid OK |
| 4 | Granska om Hemfrid/Vardagsfrid har varit i ARN för denna fråga | Du verifierar |
| 5 | Beslut: ändra boka.html-text nu eller vänta tills full villkor-paket är jurist-OK:at? | Min rek: ändra direkt eftersom risken är lågt-hängande frukt |

---

## 8. Bonus — informationskrav §2

Lag 2005:59 §2 kräver att Spick informerar om "ångerrätt, tidsfristen och övriga villkor" **före** avtal. Detta sker idag via:

- Checkbox-texten själv (under boka.html-rad 698-701)
- Länk till `kundvillkor.html` (måste innehålla detaljer)
- Bekräftelse-mejl efter bokning

**Granska att kundvillkor.html har egen sektion om ångerrätt.** Idag saknas det enligt befintlig draft `2026-04-25-kundvillkor-draft.md` — det finns reklamation §9 men ingen separat ångerrätt-paragraf.

---

## 9. Disclaimer (#30)

Lagrum ordagrant + min strukturerade observation att texten saknar (b)-delen är **data**, inte juridisk bedömning. Faktisk konsekvens (ARN-bedömning, jämknings-risk, branschpraxis-acceptans) är **din** bedömning som jurist.

Specifikt jag INTE bedömer:
- Om "samtycker till att tjänsten kan påbörjas" implicit innefattar avstående från ångerrätt (HD-praxis kan ha sagt nej)
- Om ARN typiskt kräver två separata checkboxar
- Om det finns case-law som löst frågan
- Om Konsumentverkets vägledning är ändrad

---

## 10. Källor

- [Lag (2005:59) om distansavtal och avtal utanför affärslokaler — lagen.nu](https://lagen.nu/2005:59)
- [Konsumentverket — Lagen om distansavtal](https://www.konsumentverket.se/lagar/lagen-om-distansavtal-och-avtal-utanfor-affarslokaler-konsument/)
- [Konsumentverket — Informationskrav vid distansavtal (företag)](https://www.konsumentverket.se/marknadsratt-foretag/informationskrav-vid-distansavtal-regler-for-foretag/)
- [Sveriges riksdag — Lag (2005:59)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-200559-om-distansavtal-och-avtal-utanfor_sfs-2005-59/)
- [Villaägarna — Ångerrätt vid hantverkstjänster](https://www.villaagarna.se/radgivning-och-tips/bygg/hantverkare/angerratt-for-hantverkstjanster/)
