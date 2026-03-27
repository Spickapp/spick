# SPICK — CRO-RAPPORT
## Conversion Rate Optimization — Mars 2026

---

## 1. FUNNEL-ANALYS

### Kundfunnel: Besökare → Betalande kund

```
Landningssida (index.html)     100%   ← Trafik in
      ↓
Stadare/Priser-sida             ~45%   ← Drop: oklart vart man ska
      ↓
Boka.html (Steg 1: Tjänst)     ~25%   ← Drop: för många val
      ↓
Boka.html (Steg 2: Välj städare) ~15% ← Drop: "finns det verkligen folk?"
      ↓
Boka.html (Steg 3: Uppgifter)  ~10%   ← Drop: personnummer, adress
      ↓
Boka.html (Steg 4: Betala)      ~6%   ← Drop: prissticker
      ↓
Betalning genomförd              ~3%   ← Konvertering
```

### Städarfunnel: Besökare → Registrerad städare

```
bli-stadare.html                100%   ← Trafik in
      ↓
Fyller i steg 1 (info)          ~60%   ← Drop: "är det seriöst?"
      ↓
Fyller i steg 2 (tjänster)      ~40%   ← Drop: för mycket info
      ↓  
Fyller i steg 3 (pris & tid)    ~25%   ← Drop: osäkerhet om intäkter
      ↓
BankID-verifiering               ~15%  ← Drop: "vill inte ge personnummer"
      ↓
Registrerad                      ~10%  ← Konvertering
```

---

## 2. KRITISKA DROP-OFF-PUNKTER

### 🔴 DROP #1: Startsidan → Bokningsflödet (estimerad 55% förlust)

**Problem:**
- Två konkurrerande CTAs: "Boka städning nu →" (till boka.html) och "Se alla städare" (till stadare.html) — besökaren vet inte vilken som är rätt
- Ingen tydlig prisindikation above the fold — "vad kostar det?" är den första frågan
- Rabattkoden "VALKOMMEN10" visas men har ingen förklaring eller urgency
- Hero-sektionen är 590px hög men ger ingen prisinfo, inget socialt bevis med siffror, inga ansikten

**Bevis:**
- `urgency-badge` har `display: none` — urgency-triggern är inaktiverad
- Bara 1 testimonial-sektion med 3 omdömen (Anna S., Marcus L., Sofia K.) — alla känns generiska
- 0 trust-logotyper (ingen Trustpilot, Google Reviews, eller liknande)
- Stat-siffrorna (50%, 9, 4.9★, 100+) visas under fold — de flesta ser dem aldrig

### 🔴 DROP #2: Stadare.html — Beslutsstöd saknas (estimerad 40% förlust)

**Problem:**
- Städarkorten laddar utan foton (grå placeholder-bilder) — massivt trustproblem
- Inget "Rekommenderas"-märke på toppstädare
- Ingen "Boka direkt"-knapp på varje kort — man måste klicka in, sedan navigera till boka.html
- Filter och sökning är kraftfulla men overwhelming — 6 filter-chips + slider + kartvy
- Ingen "Mest populära denna vecka" eller social proof per städare

### 🔴 DROP #3: Boka.html Steg 1 → Steg 2 (estimerad 40% förlust)

**Problem:**
- Steg 1 kräver tjänstval + kvm + datum + tid innan man ser EN ENDA städare
- "Beräknad tid: Fylls i automatiskt" — tomt fält, signalerar att systemet inte vet
- Kalender-widget kräver interaktion — ingen "Nästa lediga tid" quick-pick
- RUT-toggle finns men ingen prisindikation förrän alla fält är ifyllda
- Summa-panelen till höger visar "Välj tjänst och tid för att se pris" — motivationen att fortsätta saknas

### 🔴 DROP #4: Boka.html Steg 3 — Personnummer (estimerad 40% förlust)

**Problem:**
- Personnummer-fältet är det mest friktionsfyllda momentet i hela funneln
- Placeholder "YYYYMMDD-XXXX" utan förklaring VARFÖR det behövs
- Saknar "Behövs för RUT-avdrag — du sparar 525 kr" koppling
- Nyckelinfo-fältet (hur städaren kommer in) har `display:none` — gömt bakom en toggle

### 🔴 DROP #5: Registrera-stadare — BankID-start (estimerad 40% förlust)

**Problem:**
- Första steget kräver BankID-verifiering DIREKT — innan personen ens skrivit sitt namn
- Ingen "prova utan BankID"-option (t.ex. spara ansökan, verifiera senare)
- Texten "Ditt riktiga namn visas aldrig" är defensiv — väcker tvivel istället för att lugna
- Ingen "X städare registrerade sig denna vecka" social proof
- Ingen inkomstberäkning visible (den finns på rekrytera.html men inte här)

---

## 3. PSYKOLOGISKA TRIGGERS SOM SAKNAS

### Urgency ❌
- `urgency-badge` finns i koden men display:none — "3 bokningar gjorda idag" visas aldrig
- Ingen "Sara i Solna bokade för 12 min sedan" notification
- Ingen "Bara 2 städare lediga imorgon" scarcity
- Ingen countdown på rabattkoden VALKOMMEN10

### Social Proof ⚠️ (svag)
- 3 omdömen på index.html — alla generiska förnamn + stad
- Inga verifierade betyg (Trustpilot/Google-integrering)
- Inga foton på kunder
- Stat-siffror (100+ bokningar) är under fold
- Stadare.html laddar utan foton

### Risk Reversal ✅ (finns men gömd)
- "Nöjdhetsgaranti" nämns i boka.html sidebar men utan detaljer
- "Avbokning gratis upp till 24h" finns men inte framträdande
- "Ingen betalning förrän städning klar" finns men liten text

### Anchoring ❌
- Priser visas utan jämförelse — "349 kr/h" utan "Hemtjänst.se: 499 kr/h"
- RUT-avdraget framhävs bra (50%) men priset EFTER avdrag borde vara den primära siffran
- Ingen "Populärast"-markering på Hemstädning (det markeras på priser.html men inte på boka.html)

---

## 4. HÖGT IMPACT-FÖRBÄTTRINGAR

### ⚡ QUICK WIN #1: Aktivera urgency-badge + social proof-notiser
**Estimerad impact: +15-25% CTR på hero-CTA**

Urgency-badgen finns redan i koden men är `display:none`. Aktivera den och gör den dynamisk:

```
Ändra: display:none → display:flex
Koppling: Hämta senaste bokningsdata från Supabase
Copy: "⚡ 7 bokningar gjorda idag i Stockholm"
```

Lägg till "social proof toast" — en liten popup nere till vänster:
```
"Anna i Solna bokade hemstädning för 8 min sedan"
(Roterar var 30:e sekund med riktiga eller syntetiska datapunkter)
```

### ⚡ QUICK WIN #2: Visa pris above the fold
**Estimerad impact: +20-30% på startsida → boka**

Nuvarande hero har INGEN prisinformation. Lägg till:
```
NUVARANDE: "Boka med RUT-avdrag 50%"
NYTT: "Hemstädning från 175 kr/h med RUT-avdrag"
```

Och under CTA-knappen:
```
"✓ 175 kr/h med RUT  ✓ Gratis avbokning  ✓ Nöjdhetsgaranti"
```

### ⚡ QUICK WIN #3: Vänd bokningsflödet — visa städare FÖRST
**Estimerad impact: +30-50% på steg 1 → steg 2**

Nuvarande flöde: Tjänst → kvm → datum → tid → SE STÄDARE
Nytt flöde: VÄLJ STÄDARE → datum → tid → uppgifter → betala

Motivation: Människor vill se VEM som kommer — inte fylla i kvm först.
Städarkorten med betyg och bio skapar emotional connection som driver genom resten av funneln.

### ⚡ QUICK WIN #4: Flytta BankID till SISTA steget i städarregistrering
**Estimerad impact: +50-80% på registreringskonvertering**

Nuvarande: BankID → Alias → Lösenord → Klart
Nytt: Info → Tjänster → Pris → BankID (sist)

"Commitment escalation" — personen har redan investerat 3 minuter i formuläret.
BankID-steget känns som "bara ett till steg" istället för "det första hindret".

### ⚡ QUICK WIN #5: Sticky prissammanfattning i boka.html
**Estimerad impact: +15-20% genom hela bokningsflödet**

"Din bokning"-panelen till höger scrollar bort. Gör den `position: sticky; top: 80px` så att priset alltid är synligt. Och visa priset TIDIGT — redan vid tjänstval:
```
"Hemstädning 3h → 1 047 kr → med RUT: 524 kr ✓"
```

---

## 5. KONKRETA UI/COPY-ÄNDRINGAR

### Index.html — Hero-sektion

**NUVARANDE headline:**
> Boka en städare du verkligen litar på

**NY headline (A/B-test A):**
> Hemstädning från 175 kr/h
> BankID-verifierade städare med nöjdhetsgaranti

**NY headline (A/B-test B):**
> Din nästa städning kostar 524 kr
> 3h hemstädning med RUT-avdrag. Boka på 2 minuter.

**NUVARANDE CTA:**
> Boka städning nu →

**NY CTA:**
> Se lediga städare →  (grön, primär)
> Räkna ut ditt pris   (vit, sekundär)

**NY trust bar under CTA (saknas helt idag):**
> ✓ 4.9/5 snittbetyg · ✓ 100+ genomförda städningar · ✓ Gratis avbokning 24h

### Boka.html — Steg 1

**NUVARANDE:**
> Vad vill du ha städat?
> Välj tjänst – vi visar lediga städare direkt

**NYTT:**
> Välj tjänst och se pris direkt
> 50% billigare med RUT-avdrag – vi hanterar allt automatiskt

**Lägg till under tjänstkorten:**
> 💡 Hemstädning är populärast – 87% av våra kunder väljer detta

**Förfyll "Beräknad tid" istället för "Fylls i automatiskt":**
> 3h (rekommenderat för 65 kvm)

### Boka.html — Steg 3 (Personnummer)

**NUVARANDE:**
> Personnummer (för RUT-avdrag)
> YYYYMMDD-XXXX

**NYTT:**
> Personnummer — du sparar 524 kr i RUT-avdrag ✓
> Vi behöver ditt personnummer för att ansöka om RUT-avdrag hos Skatteverket.
> 🔒 Krypterat och lagras aldrig i klartext

### Bli-stadare.html

**NUVARANDE subheadline:**
> Sätt ditt eget pris, välj dina arbetstider och bygg upp en stabil kundkrets.

**NYTT:**
> Sara i Solna tjänar 28 000 kr/mån på 20h/vecka. Kom igång på under 5 minuter.

**Lägg till ovanför formuläret:**
> 🟢 14 nya städare registrerade sig denna vecka
> ⏱️ Ansökan tar 3 minuter — svar inom 24h

### Registrera-stadare.html

**NUVARANDE steg 1:**
> Verifiera med BankID (FÖRSTA steget)

**NYTT steg 1:**
> Berätta om dig (namn, stad, e-post — SNABBT)

**Nytt steg 4 (sist):**
> Verifiera med BankID — sista steget!
> 🔒 Vi verifierar din identitet för kundernas trygghet.
> Ditt namn och personnummer visas aldrig.

---

## 6. A/B-TEST ROADMAP

### Prioriterad ordning (högst impact först)

| # | Test | Variant A (kontroll) | Variant B | Estimerad impact | Effort |
|---|------|---------------------|-----------|-----------------|--------|
| 1 | **Hero headline** | "Boka en städare du verkligen litar på" | "Hemstädning från 175 kr/h med RUT" | +20-30% CTA-klick | Låg |
| 2 | **Bokningsflöde-ordning** | Tjänst→Tid→Städare→Info | Städare→Tid→Info→Betala | +30-50% completion | Hög |
| 3 | **BankID-placering (städare)** | BankID först | BankID sist | +50-80% registrering | Medel |
| 4 | **Urgency-notiser** | Ingen urgency | "Anna bokade för 8 min sedan" toast | +10-15% CTR | Låg |
| 5 | **Prisvisning above fold** | Ingen pris i hero | "från 175 kr/h" badge | +15-25% scroll-depth | Låg |
| 6 | **Städarfoton** | Grå placeholder | Riktiga/avatar-foton | +20-30% klick → boka | Medel |
| 7 | **Trust bar** | Inga trust-element | "4.9★ · 100+ bokningar · Garanti" | +10-20% CTR | Låg |
| 8 | **Personnummer-copy** | "Personnummer (för RUT)" | "Du sparar 524 kr med RUT ✓" | +15-25% steg 3 | Låg |
| 9 | **Sticky pris-panel** | Scrolls away | position:sticky | +10-15% completion | Låg |
| 10 | **Single CTA** | 2 CTAs (Boka + Se städare) | 1 CTA "Se lediga städare →" | +10-15% CTR | Låg |

### Sprint 1 (vecka 1-2): Quick Wins
- Test 1: Hero headline med pris
- Test 4: Urgency-notiser (aktivera befintlig kod)
- Test 5: Pris-badge above fold
- Test 7: Trust bar under CTA
- Test 10: Single CTA

### Sprint 2 (vecka 3-4): Formuläroptimering
- Test 8: Personnummer-copy
- Test 9: Sticky pris-panel
- Test 6: Städarfoton

### Sprint 3 (vecka 5-8): Arkitekturförändringar
- Test 2: Nytt bokningsflöde
- Test 3: BankID-placering

---

## 7. YTTERLIGARE REKOMMENDATIONER

### Exit-intent popup
Visa när besökaren rör musen mot stängknappen:
> "Vänta! Få 15% rabatt på din första städning"
> [E-post-fält] [Skicka rabattkod →]

### Prisankare på priser.html
Visa "jämfört med"-priser:
> Hemstädning: ~~499 kr/h~~ **175 kr/h med RUT**
> (Branschsnitt: 400-500 kr/h före RUT)

### Återaktivering
Skicka mejl till ofullständiga bokningar:
> "Du var nära! Din städning väntar — boka nu och spara 15%"
> (Kräver att steg 3 e-post sparas som lead)

### Städar-onboarding
Skicka välkomstmejl med earnings-kalkyl:
> "Välkommen Sara! Om du tar 4 jobb/vecka tjänar du ~24 000 kr/mån efter provision."

---

*Denna rapport baseras på analys av live-sajten spick.se den 27 mars 2026.*
*Alla estimerade impact-siffror är baserade på branschbenchmarks för tvåsidig marknadsplats.*
