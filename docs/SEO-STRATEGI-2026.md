# SPICK.SE — SEO-STRATEGI 2026
## Skalbar organisk tillväxt för en svensk städmarknadsplats

---

## 1. NULÄGESANALYS

### Vad som finns idag
- **51 sidor** i sitemap
- **20 stadssidor** (Stockholm, Göteborg, Malmö, Uppsala, etc.)
- **6 bloggartiklar** (550-880 ord — KORT, behöver 1500+)
- **1 tjänstesida** (tjanster.html — tunn, inga subsidor)
- **39 sidor med Schema.org** (bra)
- **64 sidor med canonical** (bra)
- **0 sidor med hreflang** (inte kritiskt, men kan läggas till)
- **Blogg-intern-linking: 1 sida** (katastrofalt — bloggen är isolerad)

### Tekniska SEO-problem
1. Bloggartiklar har **550-880 ord** — Google premierar 1500+ för informationsinnehåll
2. **Intern linking till bloggen = 1 sida** — blogginnehåll får noll link equity
3. Stadssidor har **~1000 ord** — bra start men behöver stadsdelsinformation
4. **Ingen tjänstespecifik landing page** (hemstadning.html, flyttstadning.html, etc.)
5. **Inga "near me"-optimerade sidor** (hemstädning nära mig)
6. Sitemap inkluderar interna sidor (admin, dashboard) — bör exkluderas
7. Saknar **FAQ-schema** på faq.html (trots att innehållet passar perfekt)

---

## 2. KEYWORD-STRATEGI

### Tier 1: Pengar-keywords (hög köpintention, direkt konvertering)

| Keyword | Sökvolym (est.) | Svårighet | Nuvarande sida | Åtgärd |
|---------|-----------------|-----------|----------------|--------|
| hemstädning stockholm | 2400/mån | Hög | stockholm.html | Optimera, 2000+ ord |
| städfirma stockholm | 1900/mån | Hög | saknas | Skapa städfirma-stockholm.html |
| hemstädning göteborg | 1300/mån | Medel | goteborg.html | Optimera |
| flyttstädning stockholm | 1600/mån | Hög | saknas | Skapa flyttstadning-stockholm.html |
| hemstädning malmö | 880/mån | Medel | malmo.html | Optimera |
| boka städning | 720/mån | Medel | boka.html | Optimera title/H1 |
| hemstädning pris | 1200/mån | Medel | priser.html | Optimera, prisankare |
| kontorsstädning stockholm | 590/mån | Medel | saknas | Skapa kontorsstadning.html |
| fönsterputs stockholm | 480/mån | Låg | saknas | Skapa fonsterputs.html |
| storstädning pris | 390/mån | Låg | priser.html | Lägg till sektion |

### Tier 2: Lokal SEO (stad + stadsdelsnivå)

| Keyword-mönster | Exempel | Sökvolym | Åtgärd |
|-----------------|---------|----------|--------|
| hemstädning [stad] | hemstädning uppsala | 480/mån per stad | 20 stadssidor finns |
| städare [stad] | städare solna | 260/mån per stad | Skapa förortsidor |
| flyttstädning [stad] | flyttstädning göteborg | 320/mån per stad | Skapa stad+tjänst |
| hemstädning [stadsdel] | hemstädning södermalm | 110/mån per stadsdel | Programmatisk SEO |
| städning [stad] pris | städning stockholm pris | 170/mån per stad | Prisjämförelseinnehåll |

### Tier 3: Informationsinnehåll (toppar funneln, bygger auktoritet)

| Keyword | Sökvolym | Svårighet | Innehållstyp |
|---------|----------|-----------|--------------|
| rut-avdrag 2026 | 8100/mån | Medel | Guide (finns, behöver 2000+ ord) |
| rut-avdrag städning | 2400/mån | Medel | Fokuserat blogginlägg |
| vad kostar hemstädning | 1600/mån | Låg | Priser-sida + blogg |
| flyttstädning checklista | 1300/mån | Låg | Guide (finns, behöver utökas) |
| storstädning checklista | 880/mån | Låg | Guide (finns, behöver utökas) |
| städschema mall | 590/mån | Låg | Ny guide med nedladdningsbar PDF |
| f-skatt städare | 480/mån | Låg | Guide för städare |
| hur ofta ska man städa | 390/mån | Låg | Blogginlägg |
| anlita städare svart | 320/mån | Medel | Informativt inlägg |
| bästa städfirma [stad] | 260/mån per stad | Medel | Jämförelsesida |

### Tier 4: Städar-recruiting keywords

| Keyword | Sökvolym | Åtgärd |
|---------|----------|--------|
| jobb städare stockholm | 720/mån | bli-stadare.html + stadssida |
| lediga jobb städning | 480/mån | Ny sida: jobb-stadare.html |
| tjäna pengar som städare | 320/mån | Blogg: guide |
| starta städfirma | 590/mån | Blogg: guide (leder till Spick) |
| f-skatt ansökan | 1300/mån | Blogg: guide + länk till registrering |

---

## 3. SIDSTRUKTUR — Ny informationsarkitektur

### Nuvarande struktur (platt)
```
spick.se/
├── index.html
├── boka.html
├── stadare.html
├── priser.html
├── stockholm.html (+ 19 stadssidor)
├── blogg/ (6 artiklar)
└── ... (diverse sidor)
```

### Ny struktur (hub & spoke)

```
spick.se/
│
├── TJÄNSTE-HUBBAR ────────────────────────
│   ├── hemstadning/              ← HUB: "Hemstädning – Priser, tips & boka"
│   │   ├── stockholm.html        ← SPOKE: "Hemstädning Stockholm"
│   │   ├── goteborg.html         ← SPOKE: "Hemstädning Göteborg"
│   │   ├── malmo.html            
│   │   ├── sodermalm.html        ← PROGRAMMATISK: stadsdel
│   │   └── pris.html             ← "Vad kostar hemstädning 2026?"
│   │
│   ├── flyttstadning/            ← HUB: "Flyttstädning"
│   │   ├── stockholm.html
│   │   ├── checklista.html       ← "Komplett checklista"
│   │   └── pris.html
│   │
│   ├── storstadning/             ← HUB: "Storstädning"
│   │   ├── checklista.html
│   │   └── pris.html
│   │
│   ├── kontorsstadning/          ← HUB: "Kontorsstädning"
│   │   ├── stockholm.html
│   │   └── pris.html
│   │
│   └── fonsterputs/              ← HUB: "Fönsterputs"
│
├── STAD-HUBBAR ───────────────────────────
│   ├── stockholm/                ← HUB: "Städning Stockholm"
│   │   ├── sodermalm.html        
│   │   ├── kungsholmen.html      
│   │   ├── vasastan.html         
│   │   ├── ostermalm.html        
│   │   └── ... (10+ stadsdelar)  
│   │
│   ├── goteborg/                 ← HUB: "Städning Göteborg"
│   │   ├── hisingen.html
│   │   ├── centrum.html
│   │   └── ...
│   │
│   └── malmo/                    ← HUB: "Städning Malmö"
│
├── BLOGG (Content marketing) ─────────────
│   ├── blogg/
│   │   ├── rut-avdrag-guide-2026.html     ← 2500+ ord
│   │   ├── vad-kostar-hemstadning.html    ← 2000+ ord
│   │   ├── flyttstadning-checklista.html  ← 2000+ ord
│   │   ├── stadschema-mall.html           ← downloadable
│   │   ├── starta-stadfirma-guide.html    ← recruiting funnel
│   │   ├── f-skatt-guide-stadare.html     ← recruiting
│   │   ├── anlita-stadare-svart-risker.html
│   │   ├── hur-ofta-ska-man-stada.html
│   │   ├── basta-stadfirma-stockholm.html ← jämförelse
│   │   └── ... (20+ artiklar)
│
├── KONVERTERINGSSIDOR ────────────────────
│   ├── boka.html
│   ├── stadare.html
│   ├── priser.html
│   ├── bli-stadare.html
│   └── registrera-stadare.html
│
└── STÖDSIDOR ─────────────────────────────
    ├── hur-det-funkar.html
    ├── garanti.html
    ├── faq.html
    ├── om-oss.html
    ├── kontakt.html
    └── ...
```

---

## 4. PROGRAMMATISK SEO — SKALBAR TILLVÄXT

### Möjlighet: Stad × Tjänst × Stadsdel-matriser

**Formel:** `[tjänst] + [plats]` = unik landing page

**Existerande matris:**
- 4 tjänster × 20 städer = 80 möjliga sidor (har 20 idag)

**Utökad matris:**
- 4 tjänster × 20 städer × ~5 stadsdelar per stad = 400 sidor
- + 20 "pris"-sidor per tjänst = ytterligare 80
- **Total: ~500 programmatiska sidor**

### Template för programmatiska sidor

Varje sida genereras med template som inkluderar:

```
H1: [Tjänst] i [Plats] — Boka med RUT-avdrag
Meta title: [Tjänst] [Plats] – Pris från 175 kr/h | Spick
Meta desc: Boka [tjänst] i [Plats]. BankID-verifierade städare, 
           4.9★ snittbetyg. RUT-avdrag 50%. Boka på 2 min.

Innehåll:
1. Hero med lokal pris + CTA
2. Städare i [Plats] (dynamiskt från Supabase)
3. Priser för [Tjänst] i [Plats]
4. Omdömen från kunder i [Plats] (dynamiskt)
5. FAQ: "Vad kostar [tjänst] i [Plats]?" (FAQ-schema)
6. Intern linking: relaterade stadsdelar + tjänster
```

### Implementering

Bygg ett Node.js-script (`scripts/generate-seo-pages.js`) som:
1. Läser en JSON-fil med städer, stadsdelar och tjänster
2. Genererar HTML-sidor med unika title/H1/meta/content
3. Pushar till GitHub Pages
4. Uppdaterar sitemap.xml automatiskt

---

## 5. INTERN LINKING-STRATEGI

### Nuläge (dåligt)
- boka.html: 46 inlänkar ✅
- stadare.html: 38 inlänkar ✅
- priser.html: 34 inlänkar ✅
- bli-stadare.html: 28 inlänkar ✅
- blogg/: **1 inlänk** ❌ (katastrofalt)

### Ny strategi

**Regel 1: Varje sida ska ha 3-5 kontextuella interna länkar**

**Regel 2: Hub → Spoke linking**
- Tjänste-hub (hemstadning/) → alla stadssidor
- Stads-hub (stockholm/) → alla tjänstesidor
- Kors-linking: Stockholm hemstädning → Göteborg hemstädning

**Regel 3: Blogg → Konverteringssidor**
- Varje bloggartikel ska ha minst 2 länkar till konverteringssidor
- "Boka hemstädning i Stockholm →" i varje relevant artikel
- Kontextuella CTA-boxar mitt i artiklarna

**Regel 4: Footer-navigation med SEO-ankar**
```
Tjänster: Hemstädning | Storstädning | Flyttstädning | Fönsterputs | Kontorsstädning
Populära städer: Stockholm | Göteborg | Malmö | Uppsala | Helsingborg | Linköping
Guide: RUT-avdrag 2026 | Vad kostar städning? | Flyttstädning checklista | Städschema
Bli städare: Registrera dig | F-skatt guide | Inkomstkalkylator
```

**Regel 5: Breadcrumbs**
```
Spick > Stockholm > Hemstädning > Södermalm
```
Implementera med BreadcrumbList schema.

---

## 6. TEKNISKA SEO-FÖRBÄTTRINGAR

### Omedelbart (Quick wins)

**1. FAQ-schema på faq.html**
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Vad kostar hemstädning med RUT?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Med RUT-avdrag kostar hemstädning från 175 kr/h..."
      }
    }
  ]
}
```

**2. LocalBusiness-schema per stad**
```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Spick Stockholm",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Stockholm",
    "addressCountry": "SE"
  },
  "areaServed": "Stockholm",
  "priceRange": "175-600 kr/h"
}
```

**3. Rensa sitemap**
- Ta bort interna sidor: admin, dashboard, intern-kalkyl, stadare-dashboard
- Lägg till bloggartiklar med korrekt lastmod och priority
- Lägg till framtida tjänste- och stadssidor

**4. Fixa robots.txt**
```
User-agent: *
Allow: /

Disallow: /admin.html
Disallow: /intern-kalkyl.html
Disallow: /data-dashboard.html
Disallow: /stadare-dashboard.html
Disallow: /stadare-uppdrag.html
Disallow: /backups/
Disallow: /docs/

Sitemap: https://spick.se/sitemap.xml
```

**5. Breadcrumbs med schema.org**
Implementera BreadcrumbList-schema på alla sidor.

### Medellångt (1-3 månader)

**6. Core Web Vitals**
- Preload fonter (DM Sans)
- Inline critical CSS
- Lazy load alla bilder under fold (redan gjort — 56 st)
- Minska JavaScript-bundlen

**7. Hreflang (om flerspråkig i framtiden)**
```html
<link rel="alternate" hreflang="sv" href="https://spick.se/" />
```

**8. XML Sitemap Index**
Separata sitemaps per sektion:
```xml
<sitemapindex>
  <sitemap><loc>https://spick.se/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://spick.se/sitemap-cities.xml</loc></sitemap>
  <sitemap><loc>https://spick.se/sitemap-services.xml</loc></sitemap>
  <sitemap><loc>https://spick.se/sitemap-blog.xml</loc></sitemap>
</sitemapindex>
```

---

## 7. CONTENT PLAN — 6 MÅNADER

### Månad 1-2: Foundation

| Vecka | Åtgärd | Keyword-target | Est. trafik |
|-------|--------|----------------|-------------|
| 1 | Utöka RUT-avdrag guide till 2500+ ord | rut-avdrag 2026 | 300/mån |
| 1 | Skapa hemstadning.html (tjänste-hub) | hemstädning | 200/mån |
| 2 | Skapa flyttstadning.html (tjänste-hub) | flyttstädning | 150/mån |
| 2 | Utöka flyttstädning-tips till 2000+ ord | flyttstädning checklista | 200/mån |
| 3 | Skapa "Vad kostar hemstädning 2026?" | vad kostar hemstädning | 250/mån |
| 3 | Skapa kontorsstadning.html | kontorsstädning | 100/mån |
| 4 | Skapa fonsterputs.html | fönsterputs | 80/mån |
| 4 | Blogg: "Städschema mall (gratis PDF)" | städschema mall | 100/mån |

### Månad 3-4: Lokal expansion

| Vecka | Åtgärd | Keyword-target | Est. trafik |
|-------|--------|----------------|-------------|
| 5-6 | Skapa tjänst+stad-matriser (hemstädning-stockholm, etc.) | [tjänst] [stad] | 500/mån |
| 7-8 | Skapa 10 stadsdelssidor för Stockholm | hemstädning södermalm, etc. | 300/mån |
| 7 | Blogg: "Bästa städfirma Stockholm 2026" | bästa städfirma stockholm | 200/mån |
| 8 | Blogg: "Anlita städare — vad du behöver veta" | anlita städare | 150/mån |

### Månad 5-6: Skalning

| Vecka | Åtgärd | Keyword-target | Est. trafik |
|-------|--------|----------------|-------------|
| 9-10 | Programmatisk SEO: 50 stadsdelssidor | [tjänst] [stadsdel] | 500/mån |
| 11 | Blogg: "Starta städfirma — komplett guide" | starta städfirma | 100/mån |
| 11 | Blogg: "F-skatt guide för städare" | f-skatt ansökan | 150/mån |
| 12 | Skapa jämförelsesidor: Spick vs konkurrenter | [konkurrent] vs spick | 100/mån |
| 12 | Blogg: "Hur ofta ska man städa?" | hur ofta städa | 100/mån |

### Kumulativ trafik-prognos

```
Månad 0 (nu):     ~100 besök/mån (organiskt)
Månad 2:          ~400 besök/mån (+300 från content)
Månad 4:          ~1 200 besök/mån (+800 från lokal SEO)
Månad 6:          ~3 000 besök/mån (+1800 från programmatisk SEO)
Månad 12:         ~8 000 besök/mån (med fortsatt content + backlinks)
```

---

## 8. QUICK WINS VS LÅNGSIKTIGA SPEL

### Quick Wins (implementera denna vecka) ⚡

1. **FAQ-schema på faq.html** — Google visar FAQ-svar direkt i SERP. Gratis click-through.
2. **Utöka RUT-avdrag-guiden till 2500+ ord** — redan rankar, behöver mer djup.
3. **Lägg till LocalBusiness-schema per stad** — ger lokala rich snippets.
4. **Intern linking: blogg ↔ konverteringssidor** — bloggen har 1 inlänk, ska ha 30+.
5. **Title-tag-optimering** — "Spick – Boka en städare" → "Hemstädning från 175 kr/h — Boka BankID-verifierad städare | Spick"
6. **Meta descriptions med CTA** — varje meta desc ska ha "Boka direkt" eller pris.
7. **Rensa sitemap** — ta bort admin/dashboard/interna sidor.

### Medellångt (1-3 månader) 🔧

8. **Tjänste-hubbar** — hemstadning/, flyttstadning/, kontorsstadning/ med 2000+ ord.
9. **Tjänst × Stad-matriser** — 80 nya landing pages.
10. **5 nya bloggartiklar** à 2000+ ord med informationsinnehåll.
11. **Breadcrumbs med schema** på alla sidor.
12. **Stadsdelssidor** för Stockholm (10 st), Göteborg (5 st), Malmö (5 st).

### Långsiktigt (3-12 månader) 🚀

13. **Programmatisk SEO** — 500 sidor via template-system.
14. **Backlink-kampanj** — PR-artiklar, gästinlägg, lokala företagslistor.
15. **Google Business Profile** — skapa per stad.
16. **YouTube-kanal** — städtips, before/after, recruiter-videor.
17. **Jämförelsesidor** — "Spick vs Hemfrid", "Spick vs Helpling".

---

## 9. TITLE-TAG-OPTIMERING — KONKRETA FÖRSLAG

| Sida | Nuvarande | Optimerat |
|------|-----------|-----------|
| index.html | Spick – Boka en städare du verkligen litar på | Hemstädning från 175 kr/h — Boka BankID-verifierad städare ∣ Spick |
| boka.html | Boka städning – Spick | Boka hemstädning online — Se pris direkt med RUT ∣ Spick |
| stadare.html | Hitta städare nära dig – Spick | Hitta betygsatta städare nära dig — Boka med RUT ∣ Spick |
| priser.html | Priser hemstädning – Räkna ut ditt pris med RUT ∣ Spick | Hemstädning pris 2026 — Från 175 kr/h med RUT-avdrag ∣ Spick |
| faq.html | Vanliga frågor – Spick | Vanliga frågor om hemstädning & RUT-avdrag ∣ Spick |
| stockholm.html | Hemstädning Stockholm – Boka BankID-verifierad städare med RUT ∣ Spick | ✅ Bra redan |
| blogg/rut-avdrag-guide.html | RUT-avdrag 2026 – Komplett guide: Vad gäller? ∣ Spick | RUT-avdrag 2026 — Så sparar du 75 000 kr/år på städning ∣ Spick |

---

## 10. MÄTNING & KPI:er

### Spåra varje vecka
- **Organisk trafik** (Google Search Console)
- **Ranking per keyword** (top 20 pengar-keywords)
- **Klickfrekvens (CTR)** per sida i Search Console
- **Impressions** per stadssida
- **Indexed pages** (ska öka med programmatisk SEO)

### Målsättning
- **Månad 3**: 30+ keywords i topp-20
- **Månad 6**: 100+ keywords i topp-20, 3000+ organiska besök/mån
- **Månad 12**: 300+ keywords, 8000+ organiska besök/mån
- **Konvertering**: 3-5% av organisk trafik → bokning

---

*Denna strategi baseras på analys av spick.se den 27 mars 2026.*
*Sökvolymer är estimerade baserat på svenska branschbenchmarks.*
