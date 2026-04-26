# Audit: Kund-flow djuptest 2026-04-26

**Auditor:** test-agent KUND (Claude)
**Datum:** 2026-04-26
**Scope:** Kundens hela upplevelse — discovery → bokning → bekräftelse → recension. Read-only via curl + kod-läsning.
**Tidsbox:** 30 min
**Verifieringsmetod:** Live-prod via curl mot spick.se + Supabase REST/RPC + EF.

> Rule #30/#31-respekt: Inga regulator-claims. Alla DB-/EF-fynd är curl-verifierade mot prod. Findings utan curl-bevis är märkta `[STATIC]` (kod-inspektion).

---

## Sammanfattande status per moment

| # | Moment | Status | Anteckningar |
|---|--------|--------|--------------|
| 1 | Discovery — index/stockholm/foretag laddar | PASS | Alla returnerar 200 inom 280 ms. |
| 2 | Boking happy-path UI-skelett | PASS | boka.html steg 1 visar 9 services, kalender, frekvens. |
| 3 | booking-create EF — happy-path | PASS | Returnerar Stripe-checkout-URL, booking_id, customer_price. |
| 4 | Edge: ogiltigt service-namn | PASS | `service:"Quantum Quark Cleaning"` blockeras med "Kunde inte skapa bokning". |
| 5 | Edge: pris/timmar utanför rimlighet | PASS | `hours: 99999` blockeras. |
| 6 | Edge: out-of-coverage Norrland (lat 65, lng 21) | **FAIL (HÖG)** | booking-create accepterar Lulea-koordinat och skapar Stripe-checkout. Ingen geo-rejection. |
| 7 | Edge: bokning i förfluten tid (date 2020-12-01) | **FAIL (HÖG)** | booking-create accepterar past date och skapar Stripe-checkout — webhook hanterar förmodligen senare, men fel ordning. |
| 8 | BankID-RUT init EF | **FAIL (MEDEL)** | `bankid-rut-init` returnerar `404 NOT_FOUND` — RUT-BankID-flow inaktiv (matchar §7.5 disable-state, men UI på boka.html exponerar fortfarande knapp). |
| 9 | Bekräftelse — get_booking_by_session RPC | PASS | RPC funkar (param `_session_id`, inte `p_session_id` som Stripe-konventionen). Returnerar `[]` för okänd session utan fel. |
| 10 | tack.html — GA4 purchase-tracking | **FAIL (MEDEL)** | `gtag('event','purchase',{value:525, items:[{price:525}]})` är **hardcoded 525** istf actual booking-värde. |
| 11 | min-bokning.html — saknas-bid-fallback | PASS | Visar "Bokningslänk saknas" + Mitt konto-link. |
| 12 | betyg.html / betygsatt.html — laddar | PASS | Båda returnerar 200, design konsekvent. |
| 13 | Färgkonsistens (#0F6E56) | PASS | Alla 9 testade pages använder brand-green. |
| 14 | Typografi (Playfair + DM Sans) | PASS | Konsekvent på alla 9 pages. |
| 15 | viewport-meta på alla pages | PASS | Alla 9 pages har korrekt viewport-meta. |
| 16 | Form-labels med `for=`-attribut | **FAIL (MEDEL)** | boka.html har 35+ `<label>` utan `for=`-attribut → screen-readers tappar bind. Endast 2 labels (`auto-delegation-checkbox`, `sqm`) har `for=`. |
| 17 | CSP-header live | **FAIL (HÖG)** | `_headers`-fil finns med CSP-direktiv men **GitHub Pages processar ej** Netlify-syntax. Inga `<meta http-equiv="Content-Security-Policy">` fallback. CLAUDE.md-claim "CSP utan unsafe-eval" är **felaktig i prod**. |
| 18 | foretag.html med okänd slug | PASS | Renderar "Företaget hittades inte" + "Boka städning"-CTA. Graceful. |
| 19 | Performance — alla 8 huvudpages | PASS | Snittsvarstid 0.20-0.28 s (cache-hits via Cloudflare/Fastly). Ingen page > 0.3 s. |
| 20 | 404.html med korrekt copy | PASS | "Sidan hittades inte" + tillbaka-länk. |
| 21 | Email/telefon-konsistens | PASS | hello@spick.se + +46760505153 konsekvent över alla pages. |
| 22 | Engelska smyger in (i sv-copy) | PASS | Inga engelska CTAs eller stavfel hittade i de 9 huvudpages. |
| 23 | Kontent: stale prising (199/249/299 kr/h) | PASS | Inga stale priser. Allt visar 349 kr/h (via platform_settings.subscription_price=349). |
| 24 | health-EF | PASS | Returnerar `status:"healthy"`, alla 4 critical_checks gröna. 13 active_cleaners. |

**Totalt:** 19 PASS / 5 FAIL (3 HÖG, 2 MEDEL).

---

## Top 10 findings (severity-ranked)

### F1 (HÖG) — booking-create accepterar geografiskt out-of-coverage utan rejection
- **Repro:** `curl -X POST .../functions/v1/booking-create -d '{"customer_lat":65.0,"customer_lng":21.0,...}'` → returnerar Stripe checkout URL.
- **Impact:** Kund i Lulea kan boka, betala 1050 kr, sedan ingen städare matchas → manuell refund + customer-relation-skada.
- **Fix-rek:** Lägg server-side coverage-check i booking-create EF — t.ex. via PostGIS `ST_DWithin` mot service_areas-tabell, eller hardcoded bbox för Stockholm/Göteborg/Malmö. Rejection före Stripe-session-create.
- **Verifierad:** Live booking_id `b992a53d-ea19-4eff-a1...` skapad i prod under audit. Bör städas bort manuellt.

### F2 (HÖG) — booking-create accepterar förflutna datum (past_date)
- **Repro:** `date:"2020-12-01"` → returnerar Stripe-checkout URL (verifierad via `b6b901038-3444-4767...`).
- **Impact:** Kund kan av misstag/medvetet boka i historiskt datum, betala, sedan webhook + auto-delegate förvirras.
- **Fix-rek:** Lägg `if (new Date(date) < new Date()) return error("date_in_past")` tidigt i booking-create EF.
- **Notera:** CLAUDE.md säger "Booking validation: Server-side trigger (...bokningar i förfluten tid)" — triggern verkar inte aktiv på create-time, bara på `booking_status_log` insert? Verifiera mot DB-trigger-listing.

### F3 (HÖG) — CSP-header saknas i prod-response
- **Repro:** `curl -I https://spick.se/` → ingen `Content-Security-Policy`-header.
- **Impact:** XSS-skydd förlorat. CLAUDE.md §"Säkerhet" påstår "CSP utan unsafe-eval, med HSTS" men curl visar bara HSTS + X-Content-Type-Options + Referrer-Policy. `_headers`-filen är skriven i Netlify-syntax men GitHub Pages stödjer **inte** custom headers via `_headers` (det är en Netlify/Cloudflare Pages-feature).
- **Fix-rek:** Antingen (a) migrera till Cloudflare Pages som stödjer `_headers`, eller (b) lägg till `<meta http-equiv="Content-Security-Policy" content="...">` i alla HTML-pages som fallback. Det står `_headers` är public-served (200 OK på `/`_headers`) — CSP-policy är dessutom läckt.

### F4 (MEDEL) — tack.html GA4 purchase-event har hardcoded value:525
- **Repro:** `tack.html:261` — `gtag('event', 'purchase', { value: 525, ... items: [{ price: 525 }] })`.
- **Impact:** GA4 conversion-tracking visar fake intäkt för alla bokningar (525 kr × N bokningar). Real ROAS/ROI-data är förvanskad.
- **Fix-rek:** Använd `b.total_price` från RPC-svaret efter `fetchBookingBySession()` har resolvat. Eller skicka `value` som URL-param från Stripe success_url.

### F5 (MEDEL) — boka.html form-labels saknar `for=`-attribut (a11y)
- **Repro:** `grep -nE "for=\"" boka.html` → bara 2 träffar bland 35+ `<label>`-tags.
- **Impact:** Screen-reader-användare får ingen auto-bind label↔input. Kunder med synnedsättning kan inte använda boka-formuläret korrekt. Bryter mot WCAG 2.1 SC 1.3.1 (Info and Relationships) [STATIC: ej regulator-claim, bara WCAG-spec].
- **Fix-rek:** Lägg `for="<input-id>"` på alla `<label>`-element. Trivial 30-min-fix, men 35+ punkter.

### F6 (MEDEL) — bankid-rut-init EF saknas i prod (returnerar 404)
- **Repro:** `curl -X POST .../functions/v1/bankid-rut-init` → `{"code":"NOT_FOUND","message":"Requested function was not found"}`.
- **Impact:** boka.html har RUT-BankID-knapp synlig (steg 3, line 599) som vid klick troligen kraschar med 404. Kund får inte felmeddelande, knapp bara "fryser".
- **Fix-rek:** Antingen (a) deploya bankid-rut-init EF, eller (b) flagga UI-knappen `display:none` tills EF är live (matchar Fas 7.5-pause-läge i CLAUDE.md). Frontend-UI och backend är ur synk.

### F7 (LÅG) — companies-tabellen tom på prod (slug=null)
- **Repro:** `GET .../rest/v1/companies?onboarding_status=eq.complete` → 1 row, slug=NULL, name="[TEST] Test VD AB".
- **Impact:** Brieffen påstår "foretag.html?slug=solid-service-sverige-ab" — den slug existerar inte. Foretag-discovery via slug fungerar inte i prod (utöver test-companies). Sitemap-profiles EF har troligen tom output. SEO-värdet av /f/-routing är 0.
- **Fix-rek:** Antingen (a) onboarda riktiga företag och sätt slugs, eller (b) ta bort foretag.html-länkar från publika pages tills första företag är live.

### F8 (LÅG) — betygsatt.html och betyg.html har samma `<title>`
- **Repro:** Båda har `<title>Betygsätt din städning – Spick</title>`.
- **Impact:** Browser-tab visar samma titel både före + efter inskickat betyg. Användare som scrollar tillbaka i historik kan inte skilja på "lämna betyg" och "tack-page". GA4-/Clarity-funnel-rapportering förvirras.
- **Fix-rek:** Ändra betygsatt.html till `<title>Tack för ditt betyg – Spick</title>` (matchar redan `og:title`).

### F9 (LÅG) — index.html har 0 `<img>`-tags (saknad OG-image-fallback)
- **Repro:** `grep "<img" index.html` → 0 träffar. Hela hero är CSS+emoji-baserad.
- **Impact:** Bra för performance, men inga social-share-thumbnails kan auto-genereras från sidan; helt beroende av OG-image-meta. WCAG-mässigt OK (inga img → ingen alt-krav). Ingen action behövs men noteras som arkitekturval.
- **Fix-rek:** Verifiera att `https://spick.se/assets/og-image.png` (referenced i og:image) faktiskt finns + är 1200x630.

### F10 (LÅG) — boka.html har 9 console.log-statements (debug-läckage)
- **Repro:** `grep "console.log" boka.html | wc -l` → 9 statements (`[SPICK]`, `[QR]`, `[TIC keys]`, `[BankID poll]`).
- **Impact:** Prod-användare ser teknisk debug-data i DevTools-console. Mindre allvarligt men slarv. `[TIC keys]` loggar dessutom `qr_data` direkt, som kan innehålla session-känsligt material.
- **Fix-rek:** Ta bort alla `console.log` i boka.html eller wrappa i `if (window.SPICK_DEBUG) console.log(...)` med flagga från config.js.

---

## Bonus-observationer (icke-actionable nu)

- **public_stats VIEW visar 0 bookings/0 ratings** trots health-EF visar `paid_bookings: 4` — sannolikt VIEW filtrerar på något (deleted_at? booking_status?). Dashboard på index.html kan visa "0 bokningar idag" felaktigt. Verifiera VIEW-definition.
- **boka.html har 5 träffar på "TODO/placeholder"-kommentarer** — alla refererar till §7.5/Fas 7.5 PNR-arbete (planerade, inte buggar).
- **min-bokning.html `aria-label="Öppna meny"`** finns på hamburger-knappen — bra a11y-praxis. Men `<input>`-fälten har inga aria-describedby för `field-error`-divs.
- **boka.html `tack.html` `betyg.html`** har **inga preconnect/preload på kritiska Stripe-resurser** — checkout-redirect kunde varit ~200 ms snabbare.
- **Performance medel 240 ms** — bra. Bara index.html är 38 kb (relativt stor inline CSS+JS); kandidat för ev. Astro-migrering (planerad enligt CLAUDE.md).

---

## Slutsats

Kunden kan boka, betala och få bekräftelse end-to-end via UI. Men **3 HÖG-severity-issues** kräver action före växande betatrafik:

1. **CSP saknas live** → XSS-risk + säkerhetsclaim är felaktig i CLAUDE.md
2. **booking-create accepterar Norrland + past dates** → manuella refund-jobb + customer-skada
3. **GA4 purchase-tracking är fake (525 kr hardcoded)** → all marknadsföringsdata förvanskad

Kund-design + copy + perf är solid. Företagsdiscovery via /f/-slug är dock funktionellt halvfärdig (tom DB).

---

*End of audit. Read-only — inga kod-ändringar gjorda. Två test-bookings skapades i prod under F1+F2-repro (`b992a53d-...`, `b6b901038-...`) — bör manuellt rensas av Farhad.*
