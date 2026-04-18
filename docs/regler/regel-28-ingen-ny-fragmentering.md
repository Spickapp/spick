# REGEL #28 — Ingen ny business-data-fragmentering

**Införd:** 18 april 2026  
**Efter:** Dagens insikter om fragmenteringsproblematik  
**Ambition:** 110% centraliserad arkitektur vid skala — utan funktionsförlust

## Kort

Innan du hardcodar ett business-värde (service-typ, pris, commission, 
språk, RUT-status, compliance-regel) i kod — grep kodbasen först. 
Om värdet finns på 2+ andra ställen → **centralisera till DB-tabell 
INNAN du fortsätter med uppgiften**.

## Varför

Fragmentering föds av mentaliteten "fixar snabbt nu, centraliserar senare". 
Den "senare" kommer aldrig. Varje nytt fragment multiplicerar underhålls-
bördan. När du har 14 pricing-ställen och 4 RUT-listor och 5 divergerande 
service-listor — du har byggt en fälla för ditt framtida jag.

Regel #28 är förbyggnads-mekanismen. Den stoppar fragmentering vid 
källan: när den är på väg att skapas.

## När regeln GÄLLER

Om du är på väg att hardcoda något av följande OCH värdet finns på 
andra ställen i kodbasen:

- Service-typer ("Hemstädning", "Storstädning", osv)
- Priser per tjänst (kr/h, kr/kvm)
- Commission-värden (12%, 17%, etc)
- Språk-koder och översättningar
- RUT-berättigade-tjänster
- Compliance-regler (Skatteverket, moms, F-skatt-krav)
- Företagsspecifika business-regler

## När regeln INTE gäller

- **Tekniska konstanter:** `const TIMEOUT_MS = 5000`, retry-count, 
  buffer-storlekar
- **UI-text unik för en vy:** "Välkommen till din dashboard"
- **Datum- och tidformat**
- **Tester och mock-data**
- **Prototyper som är uppenbart temporära**

## Beslutsflöde

```
Ska hardcoda ett business-värde i kod?
         │
         ▼
   grep kodbasen för liknande värden
         │
         ▼
   Finns på 2+ andra ställen?
         │
    ┌────┴────┐
    │         │
   Ja        Nej (unikt)
    │         │
    ▼         ▼
  STOPP    OK att hardcoda
  Centralisera  Men dokumentera
  till DB-tabell  i backlog
  FÖRST         (för när andra
  Sedan         instansen dyker
  fortsätt      upp)
```

## Praktiskt exempel

### Dåligt beteende (utan regel #28)

Rafael vill ha "Premiumstädning". Farhad hardcodar i:
- boka.html
- admin.html
- stadare-dashboard.html
- foretag.html
- stadare-profil.html

Total tid: 30 min. Total fragmentering: +1 service i 5 filer. Nästa 
tjänst kostar lika mycket.

### Bra beteende (med regel #28)

Rafael vill ha "Premiumstädning". Farhad kör grep → ser att service-typer 
finns på 5 ställen. STOPP.

Skapar services-tabell + seed-data för alla 7+1 tjänster. Migrerar boka.html 
att läsa därifrån. Total tid: 3 timmar.

MEN: Nästa tjänst tar 30 sekunder (INSERT INTO services ...). Och 
den därefter. Och alla framtida.

## Filosofin: "Vi tappar inget"

Centralisering är **additiv**, inte substraktiv. Ingen befintlig 
funktionalitet försvinner. Ingen flexibilitet reduceras. Enda skillnaden 
är att värdet bor i DB istället för utspritt i kod.

110% centraliserad betyder: 100% funktionalitet + 10% extra 
underhållsbarhet och skalbarhet.

## Relation till övriga regler

| Regel | Adresserar | Timing |
|-------|-----------|--------|
| #26 | Verifiera innan "fungerar" | Efter implementation |
| #27 | Verifiera innan "bygga" | Innan design |
| #28 | Förhindra ny fragmentering | Under implementation |

Tillsammans: Regel #26 + #27 + #28 omfattar **hela livscykeln** för 
en kod-ändring.

## Dokumenterad lärdom som ledde till regeln

### 18 april 2026 — Dag med 14 pricing-ställen + 5 service-listor + 4 RUT-listor

Farhad genomförde audit som avslöjade:
- Services hardcoded på 5+ ställen med divergenser (5 vs 9 i olika filer)
- RUT-listor duplicerade i 4 filer
- Pricing-beräkningar på 14 ställen (varav 2 fixade under dagen via pricing-resolver)

Grundorsak: Gradvis tillagda features utan central arkitektur. Varje 
feature kopierade mönstret från föregående.

**Regel #28 hade förhindrat detta** om den funnits från dag 1. Varje 
feature-tillägg hade triggat centralisering när det andra stället 
dök upp.

## Hur Claude och Claude Code följer regeln

**Claude (denna chat):** 
- Vid förslag om kod-ändring — påminner om regel #28 om business-värde 
  är involverat
- Ställer frågan "finns detta värde någon annanstans?" innan 
  implementation föreslås

**Claude Code (i terminalen):**
- Kör automatiskt grep före kod-ändring med hardcoded business-värde
- Pausar och frågar Farhad om centralisering behövs innan fortsättning
- Dokumenterar i commit-meddelande om fragmentering medvetet accepterades

## Kulturell förändring

Regel #28 kräver en disciplin: **säga nej till att lägga till nytt 
fragment även när det är snabbast just nu**.

Det betyder:
- Ibland säger Farhad till Rafael "det tar 2 dagar istället för 30 min, 
  men alla framtida tjänster blir snabbare"
- Ibland pausar Claude Code mitt i en uppgift för att centralisera först
- Ibland känns det långsamt

Men över 6-12 månader: Spick är centraliserat. Utan feature-frys. 
Utan stor refactor. Bara genom disciplin.

## Framgångskriterier

### Kvantitativt (mätbart över tid)

- **Divergenta business-listor ska minska**, inte öka
- **Antal hardcoded service-typer i kod:** mål 0 vid Q3 2026
- **Antal hardcoded commission-värden:** mål 0 vid Q2 2026
- **Antal duplicerade RUT-listor:** mål 0 vid Q2 2026

### Kvalitativt (upplevt)

- **Farhads intuition:** "Jag kommer inte ihåg ställen jag måste uppdatera"
- **Onboarding-tid för ny firma:** minskar stadigt
- **Nya tjänster läggs till:** snabbare, inte långsammare över tid

## Om regeln bryts

1. **Erkänn.** Commit-meddelande säger uttryckligen "regel #28 ignorerad p.g.a. [skäl]"
2. **Dokumentera** i `/docs/backlog/fragmentering-skuld.md`
3. **Planera** när skulden ska betalas (inom max 30 dagar)
4. **Spåra** — över tid ska brytningar minska

## Referenser

- Regel #26 — primärkälla-verifiering efter "fungerar"
- Regel #27 — primärkälla-verifiering innan "bygga"
- `/docs/audits/2026-04-18-servicetyp-flexibilitet.md` — bevis för dagens fragmentering
- `/docs/planning/spick-arkitekturplan-v2.md` — konkret 10-14 veckors 
  hybrid refactor-plan, förankrad i dagens 29 verifierade fynd.
