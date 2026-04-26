# Jurist-checklist — Spicks villkor (kund + underleverantör)

**Datum:** 2026-04-25
**För:** Farhad Haghighi (jurist + grundare Spick)
**Format:** Beslut-punkter du måste ta innan publicering. **Inte juridisk rådgivning.**
**Referens-docs:**
- [Konkurrent-research](2026-04-25-konkurrent-research-villkor.md)
- [Kundvillkor-draft](2026-04-25-kundvillkor-draft.md)
- [Underleverantörsavtal-draft](2026-04-25-underleverantorsavtal-draft.md)
- [Befintlig RUT/PNR-research](2026-04-25-rut-pnr-bankid-research.md)

---

## 1. Hur använda denna checklist

För varje rad: `[ ]` bock-av när du tagit beslut. Skriv besluts-not där relevant. När alla rader bockade → drafts kan konverteras till `villkor.html` + `villkor-stadare.html` i prod.

Min input där relevant är **förslag baserat på branschpraxis**, inte juridisk bedömning. Du som jurist väger.

---

## 2. KUNDVILLKOR — klausul-för-klausul-beslut

### §1 Parter och definitioner
- [ ] **§1.4 Värdesak-tröskel = 10 000 kr.** OK eller annan nivå? Hemfrid har ingen specifik tröskel. *(Mitt förslag: 10 000 kr ger tydlig praktisk gräns. Lägre = mer admin, högre = mer risk.)*

### §2 Tjänstens omfattning
- [ ] **§2.3 Spick "ansvarar för Städarens utförande".** Kontrast: Hemfrid är direkt arbetsgivare → fullt ansvar. Spick är förmedlare → vill begränsa. **Beslut:** "fullt ansvar" eller "förmedlingsansvar med ansvarsbegränsning §7.3"?

### §3 Pris och betalning
- [ ] **§3.1 Förmedlingsavgift "12% flat ingår i timpriset".** Transparens vs konkurrent-info — vill du explicit visa 12 %? *(Mitt förslag: ja, transparens stärker förtroende.)*
- [ ] **§3.2 Escrow till "24 h efter Tjänsten".** Standard? Eller kortare/längre?
- [ ] **§3.3 Prenumeration: 3 misslyckade debiteringar → paus.** OK?

### §4 Avbokning
- [ ] **§4.3 Avbokningstider:** 48 h gratis / 24-48 h = 25 % / <24 h = 100 %.
  - Konkurrent-jämförelse: Hemfrid 5 arbetsdagar / 25 %, Vardagsfrid 14 d / full debit, Städade Hem 24 h / 100 %.
  - **Mitt förslag:** 48 h är konsumentvänligt + branschstandard.
  - **Beslut:** Behåll 48 h, eller skärp till 5 arbetsdagar (Hemfrid-modell)?
- [ ] **§4.4 Avbokningsavgifter ej RUT-avdragsgilla.** Verifiera mot Skatteverkets vägledning.

### §5 Kundens skyldigheter (KÄRNFRÅGA)
- [ ] **§5.2 Värdesak-upplysningsplikt.** Stark formulering. **Bedöm om "innan Tjänsten påbörjas"-kravet är rimligt** (Konsumentverket kan kräva mer flexibel formulering).
- [ ] **§5.2 c) "Spick får isolera, fotografera eller avstå".** Detta är Farhads explicit önskemål. **Bedöm om foto-rätt utan kund-samtycke kan vara GDPR-problem** (foto av kunds bostad = personuppgift om identifierbar).
  - **Mitigering:** kräv kund-samtycke i §5.2 a) ("Kunden samtycker härmed till att..."), så foto sker med samtycke.
- [ ] **§5.3 Konsekvens vid bristande upplysning.** Hemfrid §14.4-modell. Stark men ARN/Konsumentverket har accepterat motsvarande klausuler.
- [ ] **§5.5 Nyckel-friskrivning.** Vardagsfrid-mönster. Bedöm om formuleringen "friskriver sig från ansvar för förfarandet" håller mot konsumenttjänstlagen §17 (näringsidkarens kontrollansvar).

### §6 Spicks rätt att neka
- [ ] **§6.1 Sju grunder för nekande.** Modellerat efter Hemfrid §5.1. Bedöm om §6.1 d) ("Värdesak-risk oacceptabel") är tillräckligt konkret eller behöver objektiva kriterier.
- [ ] **§6.2 Avgift vid avbruten tjänst.** Hur stor avgift? Förslag: 100 % vid Kund-fel a-d/f-g, 0 % vid Spick-initierad p.g.a. arbetsmiljö.
- [ ] **§6.3 Konto-avstängning vid upprepade incidenter.** Hur många = "upprepade"? Föreslå: 3 inom 12 månader.

### §7 Försäkring och ansvar
- [ ] **§7.1+§7.2 Spick + cleaner dubbel försäkring.** Verifiera att vår leverantör erbjuder detta upplägg.
- [ ] **§7.3 Ansvars-cap = 1 prisbasbelopp/skadehändelse/år.** Hemfrid-mönster.
  - **Bedöm:** Är 1 PBB tillräckligt? Hemfrid-cap har överlevt branschpraxis.
  - **Risk:** Vid stora skador (brand, översvämning) räcker inte 58 800 kr. Mitigering: Spick håller högre försäkringsbelopp utan att avtalsmässigt åta sig det.
- [ ] **§7.4 Undantag från cap vid grov försummelse + uppsåt.** Tvingande per skadeståndslagen — kan ej friskrivas. OK.

### §8 Escrow + dispute
- [ ] **§8.3 VD-tier-1 (≤500 kr).** OK. Reflekterar prod-arkitektur.
- [ ] **§8.4 Admin-tier-2 (>500 kr).** OK.
- [ ] **§8.5 14 dagar beslutstid.** Konsumentverkets ramverk för konsumentdispute är 30 dagar — vi är snabbare. OK.

### §9 Reklamation
- [ ] **§9.1 48 h kort frist.** Hemfrid-mönster. Bedöm: tillräckligt eller skärp till 24 h (Vardagsfrid)?
- [ ] **§9.2 30 dagar lång frist.** **VIKTIGT:** Tvingande regler i konsumenttjänstlagen ger konsument rätt att reklamera dolda fel inom 3 år (lagstadgad). Klausul §9.2 + §9.5 får inte begränsa detta.
  - **Mitigering:** Lägg till "Detta påverkar inte konsumentens lagstadgade reklamationsrätt vid dolda fel."
- [ ] **§9.5 Tappad reklamationsrätt vid bristande reklamation.** OK för **inte avgörande** dolda fel. Bekräfta formuleringen.

### §10 RUT-avdrag
- [ ] **§10.3 b) Administrativ avgift 500 kr.** Vardagsfrid har 300 kr. Bedöm: 500 kr försvarbart eller sänk till 300 kr?
- [ ] **§10.3 c) "30 dagar betalning från krav".** Standard. OK.
- [ ] **§10.4 Underrättelseplikt vid förändring.** Modellerad efter Vardagsfrid. OK.

### §11 GDPR
- [ ] **§11.3 PNR-behandling.** Verifiera mot pågående PNR-policy (PNR_FIELD_DISABLED + Fas 7.5). Texten antar att PNR-insamling är aktiv — den är AVSTÄNGD just nu. **Justera klausul för current state ELLER vänta tills PNR-aktivering.**

### §12 Force majeure
- [ ] **§12.1 Standardlistan.** OK eller saknar något (cyber-attack, IT-haveri)?

### §13 Tvistlösning
- [ ] **§13.2 ARN.** Konsumentens absoluta rätt — kan ej fråntas. OK.
- [ ] **§13.3 Stockholm tingsrätt + RB 10:8a.** OK.

### §14 Avtalsändringar
- [ ] **§14.2 30 dagars varsel.** Marknadsstandard. OK.

### §15 Kontakt
- [ ] **Postadress** behöver fyllas i. Verifiera mot Bolagsverket-registrerad adress för Haghighi Consulting AB.

---

## 3. UNDERLEVERANTÖRSAVTAL — klausul-för-klausul-beslut

### §1 Parter och status
- [ ] **§1.3 "Oberoende näringsidkare, ingen anställning".** **VIKTIGT:** EU PWD-risk. Klausulen är vår defens men håller bara om Spick:s faktiska styrning är låg.
  - **Bedöm:** behöver §1.3 utökas med specifika styrnings-friskrivningar (t.ex. "Spick instruerar inte hur arbetet ska utföras")?

### §2 Underleverantörens åtaganden
- [ ] **§2.2 Försäkringsbelopp 5 000 000 kr.** Branschstandard? Mitt förslag: ja. Verifiera med försäkringsmäklare.
- [ ] **§2.3 "Underleverantören ensam ansvarig för arbetstid och planering".** Detta är PWD-defens. OK.
- [ ] **§2.4 Förbud mot direktbetalning.** Hård men nödvändig. OK.

### §3 Tjänsteutförande
- [ ] **§3.2 Check-in/ut-krav.** Kärn-mekanism. **Bedöm:** behöver vi explicit samtycke till GPS-spårning under arbete? GDPR Art 6 — berättigat intresse + samtycke.
- [ ] **§3.4 Sen-avbokning-sanktion.** Bedöm rimlighet. *Mitt förslag: 100 % "missed-job-fee" är hård men avhåller no-shows.*

### §4 Provision
- [ ] **§4.1 12 % flat.** Låst. OK. Kontrollera att klausulen inte låser provision på all framtid (Spick måste kunna höja).
  - **Mitigering:** §13 (avtalsändringar) ger Spick rätt att höja med 30 dagars varsel. OK.

### §5 Check-in / Check-out (KÄRNFRÅGA)
- [ ] **§5.2 a) 50 % escrow-hold vid bristande Check-in/ut.** Farhads explicit önskemål.
  - **Bedöm:** är detta civilrättsligt försvarbart som "skälig kompensation för bristande bevis" (inte vite)?
  - **Mitigering:** beskriv som "interimsåtgärd för att invänta alternativt bevis", inte "straff".
- [ ] **§5.2 b) Permanent 50 %-drag efter 30 dagar.** Hårdare. Bedöm:
  - Civilrättsligt: kan vara oskäligt vite per Avtalslagen 36 §
  - Affärsmässigt: motsvarar Spicks förlorade RUT-utbetalning från SKV
  - **Mitigering:** koppla beloppet till **faktisk** RUT-förlust (inte fast 50 %), eller lägg in proportionalitet.
- [ ] **§5.4 Tekniska fel.** Skälig undantagsklausul. OK.

### §6 Dispute
- [ ] **§6.2 Tabell över dispute-konsekvenser.** OK reflekterar prod-arkitektur.
- [ ] **§6.3 "≥3 disputes inom 90 dagar = utbildnings-/avstängnings-process".** Tröskel rimlig?

### §7 Uppriktighet + skadestånd (KÄRNFRÅGA)
- [ ] **§7.2 a) Skadestånd utan cap.** **VIKTIGT:** Mot mikrocleaner kan obegränsat skadestånd jämkas per Avtalslagen 36 §.
  - **Mitigering:** lägg in cap (10 prisbasbelopp = 588 000 kr 2026), eller koppling till "faktisk skada".
- [ ] **§7.2 b) Omedelbar avstängning.** Bedöm rimlighet vid grovt brott vs misstanke.
- [ ] **§7.2 c) Anmälan till polisen/SKV.** Skälig vid uppenbart fall. Kommunikations-strategi: enbart vid bevisat brott, inte vid misstanke.
- [ ] **§7.3 "Skälig misstanke" utlöser åtgärd.** **VIKTIGT:** Sätt högre bevis-tröskel än "misstanke" — t.ex. "konkret bevis" eller "preliminär utredning visar".

### §8 Konkurrens, kundrelation (KÄRNFRÅGA — B2B-favör)
- [ ] **§8.3 12-månaders konkurrensklausul.** **VIKTIGT:** AD-praxis kan jämka.
  - Verifiera mot AD 2003 nr 84 + senare praxis för konsumenttjänster
  - Bedöm: 6 månader säkrare? Eller koppling till skälig kompensation?
- [ ] **§8.3 Vite 25 000 kr per tillfälle.** Bedöm rimlighet. Kan jämkas.
- [ ] **§8.4 Spick får marknadsföra mot Underleverantörens kund-bas.** OK.

### §9 Sekretess + GDPR
- [ ] **§9.1+9.2 OK.**
- [ ] **§9.3 Radering vid avslut.** Undantag för bokföringspliktig data (BokfL 7 år) behöver flaggas.

### §10 Försäkring
- [ ] **§10.1 5 000 000 kr.** Verifiera marknads-praxis.
- [ ] **§10.2 "Underleverantören primärt ansvarig".** OK.

### §11 Hävning + avstängning
- [ ] **§11.2 "30 dagars varsel utan motivering".** Spick-favör. Bedöm:
  - Underleverantören har avstängd tillgång under 30 dagar — försörjnings-risk
  - **Mitigering:** kortare uppsägning (14 dagar) eller behåll 30 dagar
- [ ] **§11.3 "Omedelbar avstängning utan varsel".** Hård. Vid grovt brott OK, vid misstanke risk-fylld. Verifiera mot LAS-analogi (anställningsfall-praxis).

### §12 Tvistlösning
- [ ] **§12.2 Stockholm tingsrätt.** OK för B2B (ingen konsument-skydd-RB-regel som gäller).

### §13 Avtalsändringar
- [ ] **§13.1 30 dagars varsel.** OK.
- [ ] **§13.2 "Väsentligt försämrade villkor".** Definition saknas. Behöver konkretiseras (t.ex. "höjd provision >2 %, sänkta utbetalningar, nya sanktioner").

---

## 4. RISK-FLAGGOR (sammanställning)

### 4.1 EU PWD-risk (hög)

EU Platform Work Directive 2024/2831, ikraft 2 dec 2026, inför rebuttable presumption om anställning. Klausuler med "kontroll/styrning" ökar risk.

**I drafts som triggar risk:**
- Underleverantörsavtal §3.2 (Check-in/ut-krav)
- §3.4 (sanktioner vid no-show)
- §5.2 (50 % drag = "löneavdrag"-tolkning)
- §11.3 (omedelbar avstängning utan varsel)

**Hantering:** vänta på Fas 7.5 jurist-bedömning av PWD-implikationer för Spicks modell. Eller acceptera risk + plan B vid ev. omklassificering.

### 4.2 Konkurrensklausul (medel)

§8.3 (12 mån + 25 000 kr vite) kan jämkas av AD/tingsrätt. Mitigering ovan.

### 4.3 Skadestånds-cap (medel)

§7.2 a) saknar cap. Kan jämkas mot mikrocleaner. Mitigering ovan.

### 4.4 Foto-/GPS-samtycke (medel-låg)

Kundvillkor §5.2 c) + Underleverantörsavtal §3.2 → behöver explicit samtycke i UI/avtalets accept-flow för GDPR-säkerhet.

### 4.5 Reklamationsrätt vid dolda fel (låg)

Kundvillkor §9.2-9.5 får inte överskugga konsumenttjänstlagens 3-årsregel. Mitigering: tilläggsformulering ovan.

### 4.6 PNR-policy-konflikt (operativt)

Kundvillkor §11.3 antar aktiv PNR-insamling. Just nu AVSTÄNGD. Justera draft eller vänta på Fas 7.5-aktivering.

### 4.7 RUT-konsekvens-styrka (verifiering)

Underleverantörsavtal §5.2 b) (permanent 50 %-drag) bygger på antagande om Skatteverkets bevis-krav. Verifiera mot SKV:s faktiska vägledning innan klausulen tillämpas operativt.

---

## 5. EXTERNA VERIFIERINGAR FÖR DIN BEDÖMNING

| Källa | Vad verifiera |
|---|---|
| Konsumentverket | Vägledning för städbranschen (om finns) |
| ARN (avgöranden 2023-2026) | Praxis kring städklagomål, värdesak-friskrivningar, reklamationsfrister |
| Skatteverket | Vägledning för RUT-bevis (vad räcker som "utfört arbete"?) |
| AD-praxis | Konkurrensklausuler för mikronäringsidkare i tjänstesektor |
| HD/HovR-praxis | Avtalslagen 36 § jämkning vid B2B-asymmetri (Spick stor / cleaner liten) |
| EU PWD | Praktiska riktlinjer från Kommissionen efter 2 dec 2026 |
| IMY | GDPR-bedömning av foto-/GPS-samtycke i tjänsteleveranskedjan |

---

## 6. REKOMMENDERAD ORDNING FÖR DIN BEDÖMNING

**Steg 1 (4-6 h):** Läs igenom båda drafts. Markera klausuler där du har omedelbar invändning.

**Steg 2 (2-3 h):** Bock-av i denna checklist + skriv besluts-noter. Fokusera på markerade KÄRNFRÅGOR först.

**Steg 3 (1-2 h):** Gå igenom risk-flaggor §4. Ta beslut om mitigering eller accepterad risk.

**Steg 4 (variabel):** Gör externa verifieringar §5 där det behövs.

**Steg 5 (1-2 h):** Ge mig din feedback per klausul. Jag justerar drafts.

**Steg 6 (1-2 h):** Konvertera klar draft till `villkor.html` (kund) och uppdatera `villkor-stadare.html` (underleverantör) för publikation.

**Total tid din sida:** 8-15 timmar för noggrann genomgång.

---

## 7. Min disclaimer (regel #30)

Inget i denna checklist eller drafts är juridisk rådgivning. Allt är data-aggregering + förslag-text baserat på publika konkurrent-villkor. **Du som jurist bär ansvar för slutlig bedömning.**

Specifika sifferförslag (1 PBB cap, 48 h reklamation, 30 dagar lång frist, 500 kr admin-avgift, 12 mån konkurrensklausul, 25 000 kr vite) är **branschpraxis-extrapoleringar**, inte verifierade mot specifik svensk rättspraxis. Validera mot ARN, AD, HD, Konsumentverket innan publicering.

---

## Appendix — Status-tracking

| Deliverable | Status | Fil |
|---|---|---|
| Konkurrent-research | ✅ KLAR | [2026-04-25-konkurrent-research-villkor.md](2026-04-25-konkurrent-research-villkor.md) |
| Kundvillkor draft v0.2 | ✅ **PUBLICERAD som v1.0 i `kundvillkor.html` 2026-04-26** | [2026-04-25-kundvillkor-draft.md](2026-04-25-kundvillkor-draft.md) → [kundvillkor.html](../../kundvillkor.html) |
| Underleverantörsavtal draft v0.2 | ✅ KLAR (anti-fraud + vite-skala + hybrid-roll-medvetenhet) | [2026-04-25-underleverantorsavtal-draft.md](2026-04-25-underleverantorsavtal-draft.md) |
| Utförare-vs-förmedlare-analys | ✅ KLAR (NY) | [2026-04-25-utforare-vs-formedlare-hybrid-analys.md](2026-04-25-utforare-vs-formedlare-hybrid-analys.md) |
| Jurist-checklist | ✅ KLAR (utökad §11-12 nedan) | [2026-04-25-jurist-checklist.md](2026-04-25-jurist-checklist.md) (denna fil) |
| Farhads bedömning | ⏳ Väntar på dig | — |
| Konvertering till HTML | ⏳ Efter din OK | `villkor.html` + `villkor-stadare.html` (eller två filer per hybrid-modell) |

---

## 11. NYA BESLUTSPUNKTER v0.2 — Hybrid-roll (utförare/förmedlare)

Per din 2026-04-25-fråga: "RUT-krav är obligatoriskt att Spick är utföraren, men i de fall RUT inte gäller så kan förmedlarroll vara mer intressant."

Min analys: [`2026-04-25-utforare-vs-formedlare-hybrid-analys.md`](2026-04-25-utforare-vs-formedlare-hybrid-analys.md). Min rekommendation: hybridmodell.

### 11.1 Hybrid eller enhets-modell?
- [ ] **Hybrid (rek):** Spick = utförare för RUT-tjänster, förmedlare för icke-RUT
- [ ] **Bara utförare:** enklare avtal, högre risk för icke-RUT-tjänster
- [ ] **Bara förmedlare:** lägre risk men kan ifrågasätta RUT-ombud-status

### 11.2 Verifiering Skatteverket
- [ ] **VIKTIGT:** Verifiera att Spick kan vara förmedlare för icke-RUT-tjänster utan att RUT-ombud-status (godkänd 13 apr 2026) påverkas. Kontakta SKV direkt eller läs RUT-ombud-villkoren noga.

### 11.3 Avtals-strukturering
- [ ] **Variant A (rek):** Två separata kundvillkor — `villkor-rut.html` (Spick = utförare) + `villkor-formedlare.html` (Spick = förmedlare)
- [ ] **Variant B:** Ett avtal med roll-flagga per tjänstetyp

### 11.4 Backend-impl (om hybrid-OK)
- [ ] `services.spick_role_default` — kolumn per tjänst-typ
- [ ] `bookings.spick_role` — kolumn per bokning (snapshot)
- [ ] EF-logik för dispute-flow per Spick-roll

### 11.5 Frontend-impl
- [ ] `boka.html` — laddar rätt villkor-länk per vald tjänst
- [ ] Bokningsbekräftelse — anger explicit Spick-roll
- [ ] FAQ-sida om "Vad innebär det att Spick är utförare/förmedlare?"

---

## 12. NYA BESLUTSPUNKTER v0.2 — 50%-drag-mot-kund vid RUT-nekande

Per din 2026-04-25-fråga: "Spick har rätten till 50 % avdrag i de fall slutkundens rutansökan inte beviljas av vissa skäl, och att underleverantörer är medveten om det."

### 12.1 Kundvillkor §10.3 (uppdaterad v0.2)
- [ ] **§10.3 a)** Spick efterdebiterar Kund 50 % av arbetskostnaden vid RUT-nekande pga kund-orsak. Bedöm formulering.
- [ ] **§10.3.1 Avgränsning:** §10.3 gäller bara kund-orsakat nekande — inte Spick-orsakat. Acceptabel formulering?
- [ ] **§10.3.2 Bevisbörda:** Vid tvist om vem som orsakade — bevisbörda på den part som hävdar. Bedöm rimlighet.

### 12.2 Underleverantörsavtal §5.6 (NY)
- [ ] **§5.6 a-c)** Underleverantörens medvetenhet om §10.3-mekanismen + skiljelinjen kund-orsak / underleverantör-orsak / Spick-orsak. Bedöm pedagogiken.
- [ ] **§5.6 d)** Spick bär risk vid Spick-orsakade nekanden. OK?
- [ ] **§5.6.1 Bevisbörda + överklagande inom 14 dagar.** OK?

### 12.3 Operativa frågor
- [ ] **Hur kommunicera till kund?** Vid bokning? Vid nekande?
- [ ] **Vilka är "kund-orsakade skäl"?** Lista att precisera (fel PNR, RUT-tak, ej folkbokförd, andra?)
- [ ] **Vilka är "Spick-orsakade skäl"?** Lista att precisera (XML-fel, fel sparad PNR, system-bug, andra?)
- [ ] **Beslut hos Spick — appeal till ARN/domstol om kund vägrar?** Workflow-design.

---

## 13. KORS-REFERENS NYA SEKTIONER

| Beslut | Påverkar |
|---|---|
| 11.1 Hybrid-modell | Kundvillkor §1.3, §7, §8; Underleverantörsavtal §1.3.1 |
| 11.3 Variant A vs B | Hela kundvillkor-strukturen |
| 12.1 50%-drag-mot-kund | Kundvillkor §10.3, §10.3.1, §10.3.2 |
| 12.2 Underleverantörens medvetenhet | Underleverantörsavtal §5.6, §5.6.1 |
