# Frontend UI Audit — 2026-04-26

**Scope:** 20 viktigaste publika frontend-sidor på https://spick.se
**Metod:** curl HEAD/GET för HTTP-status + meta-tags + headers, WebFetch för innehållsanalys
**Read-only:** Ingen kod ändrad

## Sammanfattning

- **20 sidor granskade** — alla returnerar **HTTP 200** med svarstid 0.21–0.48s (utmärkt)
- **0 kritiska, 4 höga, 6 medel, 5 låga** findings
- **Alla sidor har viewport-tag** + canonical + de flesta har description + og:image
- **JSON-LD schema** finns på index, boka, foretag, stadare-profil, stockholm, tjanster
- **Sitemap** giltig (77 URL:er, application/xml, max-age=600)

## Top findings

| # | Sida | Severity | Finding | Rekommendation |
|---|------|----------|---------|----------------|
| 1 | sitemap.xml | **HÖG** | `_f1_test.html`, `admin-chargebacks.html`, `admin-disputes.html`, `admin-matching.html`, `admin-pnr-verifiering.html` exponeras i publik sitemap → SEO-indexering av interna admin-paths | Filtrera bort `admin-*`, `_f1_*`, `cleaner-disputes.html` ur `sitemap-profiles` EF; lägg `noindex` på dem |
| 2 | sakerhetsplan.html | **HÖG** | Innehåller "runbooks och secret management info, accessible without authentication" enligt WebFetch (säkerhetsstatus, risk register, key rotation locations). Endast skydd är `<meta name="robots" content="noindex,nofollow">` — ingen auth-gate | Flytta till `/admin/`-skyddad sida, eller minimum: server-side guard (Cloudflare Access / EF-skyddad route). `noindex` är inte säkerhet. |
| 3 | foretag.html?slug=solid-service-sverige-ab | **HÖG** | Sidan visar "Laddar företagsprofil..." utan att laddas klart i WebFetch-vyn — ingen slug-rendering. **Canonical saknar `href`** (`<link rel="canonical" id="canonical-link">` utan href, ska sättas dynamiskt av JS) → SEO-tomt om JS inte kör | Verifiera JS-rendering live; sätt fallback-canonical i HTML; pre-render via EF för crawlers |
| 4 | stadare-profil.html?s=dildora-kenjaeva | **HÖG** | "Laddar profil..." stuck i WebFetch — alla fält visar "–" (namn, betyg, jobb, pris). Canonical = `/stadare-profil.html` (utan slug → alla profiler kanoniseras till samma sida) | Sätt dynamisk canonical med slug i JS; verifiera Supabase-fetch fungerar; pre-render för crawler |
| 5 | mitt-konto.html | MEDEL | WebFetch visar fel "E-postadressen hittades inte. Kontrollera och försök igen" *innan* användarinteraktion. Sannolikt initial-state-rendering av error-element (ska vara hidden by default) | Grep `display:none` på error-div i mitt-konto.html; säkerställ initial-CSS hidden |
| 6 | Alla sidor | MEDEL | **Inga security-response-headers** från GitHub Pages: ingen `Strict-Transport-Security`, `X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options` i HTTP-svaren (curl -I tomt) — endast meta-CSP per sida | GitHub Pages stöder ej custom headers. Överväg Cloudflare framför för security-headers, eller dokumentera att meta-CSP är "best effort" |
| 7 | foretag.html | MEDEL | Saknar `<meta name="description">` och `<meta property="og:image">` i HTML-head | Lägg till statiska defaults; överrid med JS när profil laddas |
| 8 | sakerhetsplan.html, admin.html | MEDEL | Saknar `<meta name="description">` (admin har dock canonical) | Lägg till neutral description, t.ex. "Spick Adminpanel — endast för behöriga" |
| 9 | betyg.html, villkor-stadare.html, stockholm.html | LÅG | Dubbel `<meta property="og:image">` taggar (samma URL två gånger) | Ta bort duplicate; harmless men signalerar template-bloat |
| 10 | boka.html, foretag.html, registrera-foretag.html, bli-foretag.html, sakerhetsplan.html, admin.html | LÅG | Saknar `<meta property="og:image">` | Lägg till global og:image-fallback i `_shared/components.js` |
| 11 | tack.html | LÅG | WebFetch visar fullständig confirmation-vy även utan `?session_id=` query — inga "missing session"-state | Verifiera att backend ändå validerar session_id för data-fetches; pure presentation-fallback OK |
| 12 | betyg.html | LÅG | Visar rating-form utan booking-ID-validering — kan generera "ghost ratings" om submit fungerar utan ID | Verifiera EF rejects rating utan giltig booking_id |
| 13 | registrera-stadare.html | LÅG | "TEST MODE — ID-verifiering körs i testläge" banner synlig publikt | Verifiera att text endast visas om `STRIPE_TEST_MODE=true` (förmodligen by-design tills ID-prov live) |
| 14 | sitemap.xml | LÅG | Innehåller `cleaner-disputes.html` (städar-intern) och `foretag-dashboard.html` (auth-skyddad) — inte hemliga men SEO-onödigt | Exkludera dashboards/disputes från sitemap |
| 15 | Sites överlag | LÅG | Inkonsistent `viewport`-syntax: vissa har `width=device-width, initial-scale=1.0`, andra `width=device-width,initial-scale=1`, andra `width=device-width,initial-scale=1.0` | Standardisera (kosmetiskt, ingen funktionsskillnad) |

## Per-sida-detaljer

### 1. /index.html
- HTTP: 200 (0.30s)
- Title: "Hemstädning från 349 kr/h med RUT-avdrag | Spick"
- Description: ✅ "Hemstädning från 349 kr/h (175 kr/h med RUT). ID-verifierade städare med nöjdhetsgaranti..."
- og:image: ✅ `/assets/og-image.png`
- Canonical: ✅ `https://spick.se`
- Viewport: ✅
- JSON-LD: ✅ (2 st)
- Console: rena
- Nav-links: boka, hur-det-funkar, priser, bli-stadare, faq → alla 200

### 2. /boka.html (KRITISK)
- HTTP: 200 (0.38s)
- Title: "Boka hemstädning online — Se pris direkt med RUT-avdrag | Spick"
- Description: ✅
- og:image: ❌ saknas
- Canonical: ✅
- Viewport: ✅
- JSON-LD: ✅ (2 st)
- 4-stegs bokningsflöde renderas korrekt
- Klarna + kort + Stripe + RUT BankID-flow synlig

### 3. /foretag.html?slug=solid-service-sverige-ab
- HTTP: 200 (0.40s)
- Title: "Spick för företag — Professionell städning utan strul"
- Description: ❌ saknas
- og:image: ❌ saknas
- Canonical: ⚠️ `<link rel="canonical" id="canonical-link">` utan href (tomt)
- Viewport: ✅
- JSON-LD: ✅ (2 st)
- **Stuck på "Laddar företagsprofil..."** i WebFetch — JS-render krävs men crawlers ser tomt

### 4. /stadare-profil.html?s=dildora-kenjaeva
- HTTP: 200 (0.48s)
- Title: "Städarprofil | Spick"
- Description: ✅ generisk
- og:image: ✅
- Canonical: ⚠️ `/stadare-profil.html` (saknar slug → alla profiler → samma URL)
- Viewport: ✅
- JSON-LD: ✅
- **Stuck på "Laddar profil..."** — alla fält "–"

### 5. /mitt-konto.html
- HTTP: 200 (0.27s)
- Title: "Mitt konto – Spick"
- Description: ✅
- og:image: ❌ saknas i grep men sidan har inte SEO-prio
- Canonical: ✅
- Viewport: ✅
- ⚠️ **Error-element synligt vid load:** "E-postadressen hittades inte. Kontrollera och försök igen"

### 6. /min-bokning.html
- HTTP: 200 (0.25s)
- Title: "Min bokning – Spick"
- Description: ✅
- Canonical: ✅
- Viewport: ✅
- Korrekt fallback-vy utan auth

### 7. /tack.html
- HTTP: 200 (0.39s)
- Title: "Bokning bekräftad – Spick"
- Description: ✅
- Canonical: ✅
- Viewport: ✅
- Visar full confirmation även utan `?session_id=` (kosmetiskt OK om backend fortfarande validerar)

### 8. /betyg.html
- HTTP: 200 (0.27s)
- Title: "Betygsätt din städning – Spick"
- Description: ✅
- og:image: ✅ (DUBBLERAD)
- Canonical: ✅
- Viewport: ✅
- Form rendrar utan booking-ID-context

### 9. /kundvillkor.html (publicerad v1.0 idag)
- HTTP: 200 (0.26s)
- Title: "Kundvillkor – Spick"
- Description: ✅
- og:image: ✅
- Canonical: ✅
- Viewport: ✅
- ✅ Version 1.0 + "Senast uppdaterad: 26 april 2026" + "Gäller från: 26 april 2026"
- 15 sektioner + ARN + Stockholms tingsrätt jurisdiktion

### 10. /integritetspolicy.html
- HTTP: 200 (0.30s)
- Title: "Integritetspolicy – Spick"
- Description: ✅
- og:image: ✅
- Canonical: ✅
- Viewport: ✅
- GDPR-art 6.1 b/c/f/a refererade, retention, IMY-länk

### 11. /registrera-stadare.html
- HTTP: 200 (0.26s)
- Title: "Bli städare hos Spick – Sätt ditt eget pris & få RUT-bokningar | Spick"
- Description: ✅
- og:image: ✅
- Canonical: ✅
- Viewport: ✅
- ⚠️ "TEST MODE — ID-verifiering körs i testläge" banner

### 12. /registrera-foretag.html
- HTTP: 200 (0.27s)
- Title: "Registrera företag — Spick"
- Description: ✅
- og:image: ❌
- Canonical: ✅
- Viewport: ✅
- Multi-step form OK + BankID

### 13. /bli-stadare.html
- HTTP: 200 (0.29s)
- Title: "Anslut dig till Spick — Tjäna som städare på dina egna villkor"
- Description: ✅
- og:image: ✅ `/assets/og-recruit.png` (egen img)
- Canonical: ✅
- Viewport: ✅

### 14. /bli-foretag.html
- HTTP: 200 (0.23s)
- Title: "Bli partner-företag — Starta ditt städföretag på Spick"
- Description: ✅
- og:image: ❌
- Canonical: ✅
- Viewport: ✅
- "12% flat provision" + Stripe Connect omnämnt

### 15. /tjanster.html
- HTTP: 200 (0.23s)
- Title: "Våra städtjänster – vad ingår & vad behöver du ha hemma | Spick"
- Description: ✅
- og:image: ✅
- Canonical: ✅
- Viewport: ✅
- JSON-LD: ✅
- 4 tjänster fully loaded

### 16. /villkor-stadare.html
- HTTP: 200 (0.23s)
- Title: "Villkor för underleverantörer – Spick"
- Description: ✅
- og:image: ✅ (DUBBLERAD)
- Canonical: ✅
- Viewport: ✅
- Version 1.0, uppdaterad 16 april 2026

### 17. /sakerhetsplan.html (admin-skyddad??)
- HTTP: 200 (0.24s)
- Title: "Säkerhet & Riskhantering | Spick Intern"
- Description: ❌
- og:image: ❌
- Canonical: ❌
- Viewport: ✅
- Robots: ✅ `noindex,nofollow`
- ⚠️ **Publikt åtkomlig — exponerar säkerhetsruntbooks, risk register, key locations**

### 18. /admin.html
- HTTP: 200 (0.24s)
- Title: "Spick Admin"
- Description: ❌
- Canonical: ✅
- Viewport: ✅
- Login-form (email + 6-siffrig kod)

### 19. /stockholm.html
- HTTP: 200 (0.42s)
- Title: "Hemstädning Stockholm – Boka ID-verifierad städare med RUT | Spick"
- Description: ✅
- og:image: ✅ (DUBBLERAD)
- Canonical: ✅
- Viewport: ✅
- JSON-LD: ✅ (2 st)
- City-specifikt content + intern-länkar (Sundbyberg/Solna/Nacka/Täby/Huddinge)

### 20. /sitemap.xml
- HTTP: 200 (0.35s)
- Content-Type: application/xml
- Cache-Control: max-age=600
- 77 URL:er
- ⚠️ Innehåller: `_f1_test.html`, `admin-chargebacks.html`, `admin-disputes.html`, `admin-matching.html`, `admin-pnr-verifiering.html`, `cleaner-disputes.html`, `foretag-dashboard.html`

## HTTP-headers (alla sidor — GitHub Pages-default)
- ❌ `Strict-Transport-Security` saknas
- ❌ `X-Frame-Options` saknas
- ❌ `Content-Security-Policy` (response-header) saknas
- ❌ `X-Content-Type-Options` saknas
- Säkerhet sker via meta-CSP per sida (CLAUDE.md §Säkerhet anger HSTS max-age=31536000 — verifieras inte i HTTP-response, så det är endast meta-tag-baserat)

## Performance
- Alla 20 sidor: 0.21–0.48s response time (mediocre nät; bra)
- Genomsnitt ~0.30s
