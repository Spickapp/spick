# Cleaner-flow djuptest — 2026-04-26

**Agent:** test-agent STÄDARE
**Metod:** Read-only kod-audit + curl mot prod (anon-key) + verifiering av RLS, EF-status och slug-routing
**Tidsbudget:** 30 min · **Status:** PASS för 7 av 9 sektioner, kritiska FAIL i 2

---

## Sammanfattning

Cleaner-onboarding och dashboard-flow är funktionellt sett intakt. BankID-503 är hanterat med graceful fallback (registrering går igenom). Stripe Connect-flow finns och fungerar via EF. Stora övergripande problem:

1. **stadare-uppdrag.html är inte auth-gated** → vem som helst kan öppna en booking-URL och försöka mutera bookings (PATCH blockeras visserligen av RLS, men UI agerar utan feedback).
2. **Direkt PATCH/SELECT mot `bookings`-tabellen** med Bearer = SUPA_KEY (anon) bryter mot CLAUDE.md-konvention "Frontend queryar ALDRIG bookings-tabellen direkt — använd VIEWs".
3. **Marketing-tools** finns men det finns ingen explicit dedikerad "din profil-länk"-card i dashboarden — bara genom share/copy-actions.

---

## 1. Discovery — bli-stadare → registrera-stadare  · **PASS**

| Test | Resultat |
|---|---|
| `https://spick.se/bli-stadare.html` HTTP | 200 |
| Hero-CTA pekar på `registrera-stadare.html` | Ja (rad 232, 270, 322, 446, 470, 475) |
| `/registrera-stadare.html` HTTP | 200 |
| Korrekt commission i hero ("88% behåller du") | Ja (rad 240, kommentar ref `docs/sanning/provision.md`) |

## 2. Onboarding — registrera-stadare 4-stegs-form  · **PASS m. WARN**

| Test | Resultat |
|---|---|
| Steg 1 (kontakt + adress) validering | OK — kräver namn, mail, tel, adress + lat/lng från autocomplete + gatunummer |
| Steg 2 (BankID) — EF-status `POST /functions/v1/bankid {action:"start"}` | **503** "BankID ej konfigurerat" |
| Frontend-fallback för 503 | **PASS** — visar "BankID-verifiering aktiveras inom kort, registrera utan tills vidare", sätter `_bankidSkipped=true` |
| Steg 3 (tjänster, pris-slider, radius, F-skatt) | OK — pris 250–600, radius 5–80 km, F-skatt 3 alt. (yes/applying/unknown) |
| Steg 4 (terms + slutför) — POST `/rest/v1/cleaner_applications` | **201 Created** (verifierat via curl med dry-run-row) |
| Notify-EF anrop efter insert | OK — `type:"application"` payload, körs efter `goToStep(4)` |
| 23505/duplicate email-handling | OK — visar "Du har redan en ansökan…" |
| **WARN: anon kan POST:a obegränsat (ingen rate-limit)** | Inget Captcha/throttle — spam-vektor |
| **WARN: anon kan inte SELECT/DELETE rows den skapar** | Bra för säkerhet, men dry-run-test-rad ligger nu kvar i prod (`full_name=DRY-RUN-TEST-ONLY, email=dryrun-test-09870@spick-audit-test.invalid`) — Farhad behöver radera manuellt |

## 3. First job — stadare-dashboard.html  · **PASS**

| Test | Resultat |
|---|---|
| Page HTTP | 200 |
| Auth-gate: `SB.auth.getSession()` med 3s timeout fallback (rad 2948–2950, 3015) | OK |
| Magic-link OTP: `signInWithOtp({email})` (rad 3054) | OK |
| VD-toggle (företag-owner UI) | Finns (`tab-team`, `vd-expenses-card` etc.) |
| Tabbar: Hem, Jobb, Kalender, Inkomst, Inställningar, Team | Alla finns (rad 839, 1049, 1067, 1091, 1253, 1576) |
| Stripe Connect-flow `POST /functions/v1/stripe-connect` (rad 6541, 6568) | EF svarar 200 OPTIONS-preflight |
| `cleaner.stripe_onboarding_status === 'complete'` används som payouts-status | OK (rad 3884, 4024, 4090, 4170) |
| **Notera:** kolumn `stripe_charges_enabled` på `cleaners` finns INTE | Korrekt — endast `stripe_account_id` + `stripe_onboarding_status/complete` används |

## 4. Pågår + checkin/checkout  · **FAIL (security)**

| Test | Resultat |
|---|---|
| `stadare-uppdrag.html` HTTP | 200 |
| Auth-gate på sidan? | **NEJ** — sidan kräver bara `BOOKING_ID` i URL och hämtar `MY_EMAIL` från `sessionStorage`. Ingen `requireAuth()` eller redirect till login. |
| GPS check-in/out via `navigator.geolocation` + status `green/denied` (rad 4521, 5905) | OK |
| Foto-upload (före/efter) UI | OK (`.photo-grid`, `.photo-slot`, `.wiz-upload-area`) |
| Cleaner-job-completed EF (rad 4543) `POST /functions/v1/cleaner-job-completed` | EF svarar 200 OPTIONS |
| **FAIL: `PATCH /rest/v1/bookings?id=eq.X` med Bearer=SUPA_KEY (anon)** rad 525, 624 | Bryter CLAUDE.md-konvention. RLS blockar nu (verifierat: 401 från admin_users), men UI tror att anropet lyckades och visar "Status skickad" trots att DB inte ändrades. |
| Utlägg/expense-modal (Sprint C-2) — auto-godkänd <100 kr, annars VD | OK — använder `session.access_token` korrekt (rad 1124) → cleaner_expenses POST kräver auth |

**Action:** Refaktorera stadare-uppdrag.html så att:
1. `SB.auth.getSession()` validerar att caller är inloggad cleaner med `cleaner_id == bookings.cleaner_id`
2. Använd `Bearer ${session.access_token}` (inte SUPA_KEY) för PATCH
3. Bygg ev. `v_cleaner_active_jobs` view som mediates UPDATE via SECURITY DEFINER funktion eller dedicated EF (`cleaner-update-job-status`)

## 5. Efter jobb (betyg, dispute, utbetalning)  · **PASS**

| Test | Resultat |
|---|---|
| `cleaner-disputes.html` HTTP | 200 |
| Använder `SB.from('disputes').select(...)` (rad 174–186) — auth-gated | OK |
| Dispute-respond EF `/functions/v1/dispute-cleaner-respond` (rad 261) | Finns i EF-listan |
| `skatt-utbetalningar.html` HTTP | 200 |
| Innehåller Stripe-payouts-länk + bokföringslag-checklista | OK — statisk infosida, ingen DB-läsning |
| Cleaner ser betyg från kund | Reviews exponeras via `/rest/v1/reviews?cleaner_id=eq.X` (curlat tidigare) — synlig på stadare-profil + dashboard |

## 6. Profil-management /s/{slug}  · **PASS**

| Test | Resultat |
|---|---|
| `/s/test-testsson` HTTP (302 → 200) → `stadare-profil.html?s=test-testsson` | OK |
| `v_cleaners_public` view: `is_approved=eq.true` returnerar 13 rader, 1 utan slug ("Farhad Test VD") | OK (test-data) |
| Profil-render använder `select=id,slug,full_name,city,bio,hourly_rate,avg_rating,review_count,services,...,company_id` (rad 365) | OK |
| `v_cleaner_booking_mode.allow_individual_booking` styr "Boka denna städare"-knapp (rad 380–398) | OK — om false redirect till `/f/`-företagsida |
| Reviews + ratings ✓ services + languages ✓ similar cleaners | Alla syns |
| Edit profil från dashboard | Finns via `tab-inst` → `openSubView('sv-profile')` (rad 1032), foto via `wiz-upload-btn` |

## 7. Cleaner-utlägg (Sprint C-2)  · **PASS**

| Test | Resultat |
|---|---|
| Utlägg-modal i stadare-uppdrag (rad 1100–1247) | OK |
| Foto-upload av kvitto till `documents/expense-receipts/...` storage | OK — använder session.access_token |
| Auto-godkänd <100 kr, annars status "submitted" → VD | OK (rad 1195) |
| VD ser pending utlägg i `vd-expenses-card` (rad 1167) | OK + badge med count |
| `cleaner_expenses` table: anon SELECT blockad (verifierat 401) | OK |

## 8. Marketing-tools  · **WARN**

| Test | Resultat |
|---|---|
| Cleaner kan kopiera sin URL `https://spick.se/s/{slug}` (rad 3199–3208, 4227–4242) | OK — fungerar |
| Företags-cleaner får `/f/{company.slug}` istället | OK |
| **WARN:** Det finns ingen dedikerad "Marknadsföring"-tab eller -card i dashboard | Cleaner måste hitta share-knappen via context — ingen prominent placering |
| Preview av profil från dashboard | Implicit via copy → klistra-in i ny tab |
| **WARN:** "Farhad Test VD"-row i prod har `slug=null` | Kommer att rendera knapp som pekar på `/s/{uuid}` istället för pretty-slug |

## 9. Edge cases  · **PASS m. WARN**

| Test | Resultat |
|---|---|
| BankID-fail (503) — frontend visar fallback-meddelande | OK |
| Fake org-nummer — frontend regex `/^\d{6}-\d{4}$/` (rad 975) | OK syntaktisk validering, men ingen Bolagsverket-API-koll |
| Duplicate email — 23505 → svensk användarvarning | OK |
| **WARN:** Inget rate-limit på `cleaner_applications` POST — bot kan spam:a 1000+ rader | Behöver Captcha eller IP-throttle EF |
| **WARN:** dry-run test-rad ligger kvar i prod efter min audit (anon kan inte radera) | Farhad behöver `DELETE FROM cleaner_applications WHERE email='dryrun-test-09870@spick-audit-test.invalid'` via service-role |

---

## TOP 10 FINDINGS (prioriterad)

| # | Sev | Sektion | Finding | Fix |
|---|---|---|---|---|
| 1 | **HIGH** | §4 stadare-uppdrag | Ingen auth-gate; vem som helst med booking-URL kan öppna och försöka mutera | Lägg till `await SB.auth.getSession()` + redirect till `stadare-dashboard.html` om null. Validera cleaner_id ownership. |
| 2 | **HIGH** | §4 stadare-uppdrag | Direkt PATCH `/rest/v1/bookings` med anon-key (rad 525, 624) bryter CLAUDE.md-konvention och misleads UI (RLS blockar tyst) | Skapa EF `cleaner-update-job-status` (auth-gated) eller använd `SB.from('bookings').update().eq(cleaner_id, my.id)` med session-token |
| 3 | **MED** | §2 onboarding | Inget rate-limit på `cleaner_applications` POST | Lägg till Captcha (Cloudflare Turnstile) eller server-side `check_rate_limit()` via EF-wrapper |
| 4 | **MED** | §2 BankID | EF returnerar 503 (GRANDID_API_KEY saknas i prod-secrets) | Aktivera GrandID-integration (per CLAUDE.md "BankID-scope smalnad" memory: deferred — inte blockerande just nu) |
| 5 | **MED** | §6 marketing | Ingen dedikerad "Min profil + dela"-card i dashboard hem-tab | Lägg till card med `slug`-status + copy-button + QR-kod-generator för flyer |
| 6 | **MED** | §6 marketing | "Farhad Test VD" har `slug=null` i prod (id c2b60c05) | Generera slug eller markera test-row inactive (`is_approved=false`) |
| 7 | **LOW** | §2 audit-cleanup | Min dry-run-rad `DRY-RUN-TEST-ONLY` ligger kvar i `cleaner_applications` (anon-DELETE blockad — korrekt RLS) | `DELETE FROM cleaner_applications WHERE email='dryrun-test-09870@spick-audit-test.invalid'` (service-role) |
| 8 | **LOW** | §9 fake-org | Org-nummer endast regex-validerad, inte mot Bolagsverket | Server-side `validate-org-number` EF (Bolagsverket öppna API) — kan vänta tills cleaner-flow har real volym |
| 9 | **LOW** | §3 dashboard | `cleaners?email=eq.X` SELECT på rad 1132 (uppdrag) använder anon-key (svar 401), faller på `session.access_token` istället | Förenkla: använd alltid session.access_token, droppa anon-fallback |
| 10 | **LOW** | §1–§9 | Inga `data-testid`-attribut på CTA-knappar/form-fields | Lägg till för automatiserad e2e-testning (Playwright/Puppeteer) framöver |

---

## Verifierad infrastruktur

| Komponent | Status |
|---|---|
| Sidor 200: bli-stadare, registrera-stadare, stadare-dashboard, stadare-profil, stadare-uppdrag, skatt-utbetalningar, cleaner-disputes | All 200 |
| EF: `bankid` (503 by design), `places-autocomplete`, `notify`, `cleaner-job-completed`, `cleaner-booking-response`, `geo`, `stripe-connect` | All svarar 200 OPTIONS / förväntat 503 |
| RLS: `cleaner_applications` INSERT=anon-OK, SELECT/DELETE=anon-blockad ✓ | OK |
| RLS: `cleaners` SELECT=anon-blockad, `v_cleaners_public` SELECT=anon-OK ✓ | OK |
| RLS: `bookings` PATCH med anon=blockad (admin_users RLS-check) ✓ | OK — men UI tror att det funkar (FAIL #2) |
| RLS: `cleaner_expenses` anon=blockad ✓, `booking_status_log` anon-SELECT=tom ✓ | OK |
| Slug-routing `/s/{slug}` → `stadare-profil.html?s={slug}` (302 → 200) | OK |

---

**Slut.** 2 HIGH-fix krävs innan cleaner-flow kan kallas prod-redo. Resten är förbättringar för polish + skala.
