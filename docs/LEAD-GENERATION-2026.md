# SPICK.SE — LEAD GENERATION SYSTEM
## Förutsägbar och skalbar kundanskaffning

---

## 1. KANALER — PRIORITERAD ORDNING

```
KANAL                  KOSTNAD    TID TILL RESULTAT   SKALBARHET
──────────────────────────────────────────────────────────────────
1. Google Ads (SEM)    💰💰💰     ⚡ Omedelbart         ★★★★★
2. Meta Ads (FB/IG)    💰💰       ⚡ 1-2 veckor         ★★★★★
3. Organisk SEO        💰         🐌 3-6 månader        ★★★★★
4. Referral-program    💰         ⚡ 1-2 veckor         ★★★☆☆
5. Social organic      💰         🐌 2-4 månader        ★★★★☆
6. Google Business     Gratis     🐌 1-3 månader        ★★★☆☆
7. Partnerskap         💰         🐌 1-2 månader        ★★☆☆☆
```

### Nuvarande infrastruktur ✅
- Google Analytics: G-CP115M45TT
- Facebook Pixel: 874536122252551
- Microsoft Clarity: w1ep5s1zm6
- Exit-intent popup med e-postfångst
- 20 stadssidor (lokal SEO)
- 6 bloggartiklar
- Buffer (1 kanal kopplad)

### Saknas ❌
- Google Ads-konto + konverteringsspårning
- Meta Ads Manager-setup med Custom Audiences
- Google Business Profile per stad
- Referral-tracking i Supabase
- E-post-automatisering (welcome + nurture-sekvens)

---

## 2. FUNNEL-ARKITEKTUR

### Funnel A: Google Ads → Bokning (högst intent)

```
[GOOGLE AD]                          [LANDING PAGE]
"Hemstädning Stockholm              →  stockholm.html (optimerad)
 från 175 kr/h med RUT"                │
 ↓ Klick (CPC ~8-15 kr)               │
                                       ▼
                                 [STADARE.HTML]
                                 Filtrera städare i Stockholm
                                       │
                                       ▼
                                  [BOKA.HTML]
                                  4-stegs bokningsflöde
                                       │
                                       ▼
                                  [STRIPE CHECKOUT]
                                  Betalning
                                       │
                                       ▼
                                  [BEKRÄFTELSE]
                                  Email + SMS
```

**Nyckeltal:**
- CPC: 8-15 kr (hemstädning stockholm)
- CTR: 5-8% (med optimerad annons)
- Konvertering landing → bokning: 3-5%
- CPA (kostnad per bokning): 160-500 kr
- LTV (customer lifetime value): ~2 500 kr (5 bokningar × 1047 kr × 17% provision × 2.8 rebookings)
- **ROI: 4-15x**

### Funnel B: Meta Ads → Lead → Bokning (medelhög intent)

```
[META AD]                           [LEAD CAPTURE]
"Visste du att städning             →  Exit-intent ELLER
 kostar bara 175 kr/h?"               dedicated landing page
 ↓ Klick (CPC ~3-8 kr)                │
                                       ▼
                                 [EMAIL SEQUENCE]
                                 Dag 0: Rabattkod (10%)
                                 Dag 2: Social proof
                                 Dag 5: RUT-förklaring
                                 Dag 7: Urgency (koden snart)
                                       │
                                       ▼
                                  [BOKA.HTML]
                                       │
                                       ▼
                                  [STRIPE]
```

**Nyckeltal:**
- CPC: 3-8 kr
- Lead capture rate: 15-25%
- Email → bokning: 5-10%
- CPA: 200-600 kr
- **ROI: 3-10x**

### Funnel C: Organisk SEO → Bokning (varierande intent)

```
[GOOGLE SEARCH]                     [CONTENT PAGE]
"vad kostar hemstädning"           →  blogg/vad-kostar...
"rut-avdrag 2026"                  →  blogg/rut-avdrag...
"hemstädning malmö"                →  malmo.html
 ↓ Klick (gratis)                      │
                                       ▼
                                 [CTA I ARTIKEL]
                                 "Boka hemstädning → spick.se"
                                       │
                                       ▼
                                  [BOKA.HTML]
                                       │
                                       ▼
                                  [STRIPE]
```

### Funnel D: Referral → Bokning (högst trust)

```
[BEFINTLIG KUND]                    [REFERRAL-SIDA]
Får email: "Tipsa en vän,         →  tipsa-en-van.html
 båda får 15% rabatt"                  │
 ↓ Delar länk                         ▼
                                 [NY BESÖKARE]
                                 Landing med personlig hälsning:
                                 "Anna rekommenderar Spick!"
                                       │
                                       ▼
                                  [BOKA.HTML]
                                  (rabattkod auto-ifylld)
```

---

## 3. GOOGLE ADS-STRATEGI

### Kampanjstruktur

```
KONTO: Spick.se
│
├─ KAMPANJ 1: Branded (varumärkesskydd)
│  Budget: 50 kr/dag
│  Keywords: "spick", "spick.se", "spick städning"
│  Match: Exact
│  Mål: Fånga varumärkessökningar
│
├─ KAMPANJ 2: Hemstädning [stad] (pengar-keywords)
│  Budget: 200 kr/dag
│  Ad groups:
│  ├─ Hemstädning Stockholm (CPC ~12 kr)
│  │  Keywords: hemstädning stockholm, städfirma stockholm,
│  │            boka hemstädning stockholm, hemstäd stockholm
│  ├─ Hemstädning Göteborg (CPC ~10 kr)
│  ├─ Hemstädning Malmö (CPC ~8 kr)
│  └─ Hemstädning Uppsala (CPC ~6 kr)
│  Landing: respektive stadssida (stockholm.html, etc.)
│
├─ KAMPANJ 3: Tjänster (specifika tjänster)
│  Budget: 100 kr/dag
│  Ad groups:
│  ├─ Flyttstädning (CPC ~15 kr, hög intent)
│  ├─ Storstädning (CPC ~8 kr)
│  ├─ Fönsterputs (CPC ~6 kr)
│  └─ Kontorsstädning (CPC ~10 kr)
│
├─ KAMPANJ 4: Information (top-of-funnel)
│  Budget: 50 kr/dag
│  Keywords: vad kostar hemstädning, rut avdrag städning,
│            hemstädning pris, städning pris per timme
│  Landing: priser.html, blogg/rut-avdrag-guide.html
│
└─ KAMPANJ 5: Retargeting (RLSA)
   Budget: 50 kr/dag
   Publik: Besökt spick.se senaste 30 dagarna
   Keywords: breda hemstädning-keywords
   Budstrategi: +50% bid adjustment
```

### Annonsexempel

**Annons 1: Hemstädning Stockholm**
```
Hemstädning Stockholm — Från 175 kr/h
BankID-verifierade städare · 4.9★ snittbetyg
Boka online på 2 min. Nöjdhetsgaranti.
[spick.se/stockholm]
Sitelinks: Priser | Se städare | Hur det funkar | RUT-avdrag
```

**Annons 2: Flyttstädning**
```
Flyttstädning? Vi fixar det ✓
Depositionen tillbaka — garanterat
Professionell flyttstäd med RUT-avdrag 50%
[spick.se/boka]
```

**Annons 3: Pris-fokus**
```
Hemstädning 524 kr (3h med RUT)
Sluta städa själv — boka en proffs
BankID-verifierad · Gratis avbokning 24h
[spick.se/priser]
```

### Konverteringsspårning (behöver implementeras)

```javascript
// Tracking events att sätta upp i Google Ads
// 1. Bokning påbörjad (boka.html laddad)
gtag('event', 'begin_checkout');

// 2. Bokning steg 2 (valt städare)
gtag('event', 'add_to_cart', { value: totalPrice });

// 3. Bokning slutförd (Stripe success)
gtag('event', 'purchase', { 
  value: totalPrice, 
  currency: 'SEK',
  transaction_id: bookingId 
});

// 4. Lead (exit-intent email capture)
gtag('event', 'generate_lead', { value: 50 });
```

---

## 4. META ADS-STRATEGI

### Kampanjstruktur

```
KONTO: Spick.se
│
├─ KAMPANJ 1: Medvetenhet (top-of-funnel)
│  Mål: Trafik
│  Budget: 100 kr/dag
│  Publik: 25-55 år, Stockholm/Göteborg/Malmö
│  Intressen: Hemrenovering, inredning, föräldrar
│  Format: Video (15s satisfying cleaning)
│  Landing: index.html
│
├─ KAMPANJ 2: Konvertering (bottom-of-funnel)
│  Mål: Konverteringar (ViewContent → Purchase)
│  Budget: 150 kr/dag
│  Publik: Lookalike 1% av bokare (när data finns)
│  Format: Karusell (före/efter) + Single image (pris)
│  Landing: stadare.html
│
├─ KAMPANJ 3: Retargeting
│  Mål: Konverteringar
│  Budget: 75 kr/dag
│  Publik:
│  ├─ Besökt stadare.html men ej bokat (7d)
│  ├─ Besökt boka.html men ej slutfört (3d)
│  └─ Exit-intent leads (14d)
│  Format: Dynamic (med urgency-copy)
│
└─ KAMPANJ 4: Lead Generation
   Mål: Lead Form
   Budget: 50 kr/dag
   Publik: Bred targeting i storstäder
   Format: Lead Ad med instant form
   Erbjudande: "10% rabatt — ange e-post"
```

### Annonskreativ

**Video-annons (15s TikTok-stil):**
```
[0-2s] Split-screen: Smutsigt kök → rent kök
[2-4s] Text: "Hemstädning från 175 kr/h"
[4-6s] Text: "BankID-verifierade städare"
[6-8s] Text: "RUT-avdrag = du betalar hälften"
[8-10s] Kundcitat: "Bästa investeringen — Anna, Stockholm"
[10-12s] CTA: "Boka nu → spick.se"
[12-15s] Logo + trust badges
```

**Karusell-annons:**
- Kort 1: Före/efter kök (hook: "Så här blev Annas kök")
- Kort 2: Pris: "3h hemstädning = 524 kr med RUT"
- Kort 3: Trust: "4.9★ · BankID-verifierade · Nöjdhetsgaranti"
- Kort 4: CTA: "Se lediga städare → spick.se"

**Retargeting-annons (urgency):**
```
"Du var nära att boka! 🧹

Din städare väntar. Slutför din bokning
och få 10% rabatt med kod VALKOMMEN10.

Erbjudandet gäller till fredag.

[Slutför bokning →]"
```

### Custom Audiences (Facebook Pixel)

```javascript
// Tracking events (redan delvis implementerade)
fbq('track', 'ViewContent', { content_name: 'stadare' });
fbq('track', 'InitiateCheckout', { value: 1047, currency: 'SEK' });
fbq('track', 'Purchase', { value: 1047, currency: 'SEK' });
fbq('track', 'Lead', { content_name: 'exit_intent' });
```

**Audiences att skapa i Ads Manager:**
1. Alla besökare (180d) — för retargeting
2. Besökt stadare.html (30d) — hög intent
3. Besökt boka.html (14d) — mycket hög intent
4. Bokare (alla) — för Lookalike
5. Exit-intent leads — för e-postretargeting
6. Lookalike 1% av bokare — för prospecting

---

## 5. KONVERTERINGSOPTIMERING PER KANAL

### Google Ads → Stadssida → Bokning

**Stadssidorna (stockholm.html, etc.) behöver:**
1. ✅ Keyword i H1 ("Hemstädning Stockholm")
2. ✅ Pris above the fold ("från 175 kr/h")
3. ⚠️ Saknas: Dedikerad CTA knapp above fold → boka.html
4. ⚠️ Saknas: Telefonnummer (click-to-call)
5. ⚠️ Saknas: Google Ads konverteringsspårning
6. ⚠️ Saknas: UTM-parametrar i annonslänkar

### Meta Ads → Index → Stadare → Bokning

**Index.html (för Meta-trafik):**
1. ✅ Pris i headline ("175 kr/h")
2. ✅ Trust bar
3. ✅ Urgency badge
4. ✅ Social proof toasts
5. ⚠️ Saknas: Facebook-pixel events på CTA-klick
6. ⚠️ Saknas: Video-hero (istället för statisk bild)

### Alla kanaler → Boka.html

**Bokningssidan behöver:**
1. ✅ 4-stegs wizard
2. ✅ Sticky prispanel
3. ✅ Trust-element i sidebar
4. ⚠️ Saknas: Progress-bar med "X steg kvar"
5. ⚠️ Saknas: Escape-route vid avhopp (chatbot)
6. ⚠️ Saknas: Abandoned cart email (sparar e-post i steg 3)

---

## 6. RETARGETING-STRATEGI

### Segment och meddelanden

| Segment | Storlek (est.) | Kanal | Meddelande | Budget |
|---------|----------------|-------|------------|--------|
| Besökt men ej bokat (7d) | 70% av trafik | Meta + Google | "Städning från 175 kr/h — boka din favorit" | 50 kr/dag |
| Boka.html steg 1-2 (3d) | 15% av trafik | Meta | "Du var nära! 10% rabatt med VALKOMMEN10" | 30 kr/dag |
| Boka.html steg 3-4 (1d) | 5% av trafik | Meta + Email | "Slutför din bokning — din städare väntar" | 20 kr/dag |
| Exit-intent leads (14d) | Email-lista | Email | Welcome-sekvens (4 mejl över 7 dagar) | 0 kr |
| Tidigare bokare (30-90d) | Kundlista | Meta + Email | "Dags igen? Boka [samma städare]" | 25 kr/dag |

### Abandoned Booking Recovery (NYT — implementera)

```
TRIGGER: Kund fyller i e-post i steg 3 men slutför inte bokning

T+1h:  Email: "Din bokning väntar — slutför på 30 sekunder"
       Innehåll: Sammanfattning av vald tjänst + städare + pris
       CTA: "Slutför bokning →" (deeplink till steg 4)

T+24h: Email: "Glöm inte din 10% rabatt 🎟️"
       Innehåll: Rabattkod + social proof
       CTA: "Boka med rabatt →"

T+72h: Email: "Sista chansen — erbjudandet upphör"
       Innehåll: Urgency + garanti
       CTA: "Boka nu →"
```

---

## 7. AUTOMATISERAT LEAD CAPTURE-SYSTEM

### Nuvarande lead capture-punkter
1. ✅ Exit-intent popup (js/cro.js) → e-post → Supabase subscriptions
2. ✅ Waitlist-formulär på stadssidor
3. ✅ Bokningsformulär (boka.html steg 3)
4. ❌ Facebook Lead Ads → saknar integration
5. ❌ Abandoned booking → saknar tracking

### E-post nurture-sekvens (NYT — implementera)

**Welcome-sekvens (för exit-intent leads):**

```
Dag 0 (direkt): "Välkommen! Här är din 10% rabattkod"
  - Kod: VALKOMMEN10
  - Kort intro till Spick
  - CTA: "Se lediga städare →"

Dag 2: "Visste du? Du betalar bara hälften med RUT"
  - RUT-avdrag förklarat i 3 steg
  - Prisexempel: 1047 kr → 524 kr
  - CTA: "Räkna ut ditt pris →"

Dag 5: "Så tycker våra kunder"
  - 3 kundcitat med betyg
  - "4.9★ snittbetyg av 100+ kunder"
  - CTA: "Boka din första städning →"

Dag 7: "Din rabatt går snart ut ⏰"
  - "VALKOMMEN10 gäller bara 3 dagar till"
  - Urgency + garanti
  - CTA: "Använd rabatt nu →"
```

### Lead scoring (för framtida CRM)

| Åtgärd | Poäng |
|--------|-------|
| Besökt index.html | +1 |
| Besökt stadare.html | +3 |
| Besökt priser.html | +3 |
| Besökt boka.html | +5 |
| Exit-intent email capture | +10 |
| Klickat email-länk | +5 |
| Besökt boka.html steg 2+ | +15 |
| Bokare (konverterad) | +50 |

---

## 8. KOSTNADSEFFEKTIVITET — BUDGET-ALLOKERING

### Fas 1: Bootstrap (0-1 000 kr/vecka)
```
Google Ads: 300 kr/vecka (branded + hemstädning stockholm)
Meta Ads:   200 kr/vecka (retargeting-only)
Organisk:   500 kr/mån (Anthropic API för content)
Total:      ~2 500 kr/mån
```

### Fas 2: Tillväxt (1 000-3 000 kr/vecka)
```
Google Ads:  1 000 kr/vecka (4 kampanjer)
Meta Ads:      800 kr/vecka (prospecting + retargeting)
Influencers:   500 kr/vecka (micro, 1-2 per vecka)
Referral:      200 kr/vecka (15% rabatt per referral)
Total:       ~10 000 kr/mån
```

### Fas 3: Skalning (3 000+ kr/vecka)
```
Google Ads:  2 000 kr/vecka (alla städer, alla tjänster)
Meta Ads:    1 500 kr/vecka (lookalike, video, lead gen)
TikTok Ads:    500 kr/vecka (satisfying cleaning videos)
Influencers:   500 kr/vecka
Referral:      500 kr/vecka
Total:       ~20 000 kr/mån
```

### ROI-prognos per fas

| Fas | Budget/mån | Bokningar | Intäkt (provision) | ROI |
|-----|-----------|-----------|-------------------|-----|
| 1   | 2 500 kr  | 10-15     | 1 780-2 670 kr    | 0.7-1.1x |
| 2   | 10 000 kr | 40-60     | 7 120-10 680 kr   | 0.7-1.1x |
| 3   | 20 000 kr | 100-150   | 17 800-26 700 kr  | 0.9-1.3x |

**Obs:** ROI blir positiv först med retention. En kund som rebookar 3 gånger = 3x LTV.
Med 25% retention → ROI i fas 3: **2.5-4x**.

---

## 9. PSYKOLOGISKA TRIGGERS PER KANAL

### Google Ads
- **Intent match:** Annonsen matchar exakt vad personen söker
- **Pris-ankare:** "Från 175 kr/h" (lägre än förväntat)
- **Social proof:** "4.9★ · 100+ bokningar" i sitelinks
- **Risk reversal:** "Nöjdhetsgaranti · Gratis avbokning"

### Meta Ads
- **Visuell wow:** Före/efter-bilder som stoppar scrollandet
- **FOMO:** "Bara 3 städare lediga denna vecka i [stad]"
- **Social proof:** Kundcitat med namn och stad
- **Urgency:** "Rabattkod gäller till fredag"

### Landing pages
- **Anchoring:** Visa "normalpris" genomstruket, sedan RUT-pris
- **Commitment:** 4-stegs wizard (micro-commitments)
- **Authority:** BankID-verifiering, Spick AB org.nr
- **Scarcity:** "X bokningar gjorda idag" (urgency badge)

### Email
- **Personalisering:** "Hej [namn], din rabattkod väntar"
- **Deadline:** "Gäller 7 dagar"
- **Loss aversion:** "Missa inte din 10% rabatt"
- **Social proof:** "2 500+ nöjda kunder"

---

## 10. IMPLEMENTATION PRIORITY

### Vecka 1: Tracking & Foundation
- [ ] Sätt upp Google Ads-konto
- [ ] Implementera Google Ads konverteringsspårning
- [ ] Skapa Facebook Custom Audiences
- [ ] Skapa Google Business Profile (Stockholm)
- [ ] Implementera UTM-parametrar i alla CTA-länkar

### Vecka 2: Google Ads Launch
- [ ] Skapa kampanj 1 (Branded) + 2 (Hemstädning Stockholm)
- [ ] A/B-test 3 annonsvarianter per ad group
- [ ] Sätt upp konverteringsspårning (begin_checkout → purchase)
- [ ] Budget: 300 kr/vecka

### Vecka 3: Meta Ads + Retargeting
- [ ] Skapa retargeting-kampanj (besökt stadare.html)
- [ ] Skapa 3 annonskreativ (video, karusell, singel)
- [ ] Budget: 200 kr/vecka retargeting-only
- [ ] Implementera Facebook Lead Ad-integration

### Vecka 4: Email Automation
- [ ] Bygg welcome-sekvens (4 mejl)
- [ ] Implementera abandoned booking tracking
- [ ] Koppla exit-intent leads → welcome-sekvens
- [ ] A/B-test ämnesrader

### Vecka 5-8: Optimera & Skala
- [ ] Analysera CPA per kanal och keyword
- [ ] Pausa underpresterande keywords
- [ ] Skala vinnande annonser
- [ ] Expandera till fler städer i Google Ads
- [ ] Starta Lookalike-kampanjer i Meta

---

*Strategi designad för Spick.se · Mars 2026*
*Startbudget: 2 500 kr/mån → skalbar till 20 000 kr/mån*
