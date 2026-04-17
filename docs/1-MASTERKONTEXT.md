# 1 — Spick Masterkontext

> **Senast uppdaterad:** 2026-04-17 efter Dag 1-audit.  
> **Ersätter:** `docs/SPICK_KONTEXT.md` (från 2026-03-23, föråldrad — Netlify-referenser mm).  
> **Syfte:** Startdokument för framtida Claude-sessioner. Läs denna + CLAUDE.md först.

---

## Projekt

**Spick** — Sveriges städplattform, Uber-modellen för städning.

- Kunder bokar betygsatta städare direkt.
- Städare sätter egna priser (250–600 kr/h).
- Spick tar 17% provision (Smart Trappstege 17% → 12% för företag / Top-tier).
- RUT-avdrag 50%.
- Städarna är egenföretagare med F-skatt eller underleverantörer till företag.

**Skala idag:** 26 bokningar, 4 aktiva kunder, 5 städare, 1 företag (Rafa/Solid Service).

---

## Ägare

- **Farhad Haghighi** — farrehagge@gmail.com / hello@spick.se
- **Bolag:** Haghighi Consulting AB (559402-4522), bifirma Spick
- **Partneravtal:** `spick.se/avtal.html` (digitalt, sparas i Supabase)

---

## Tech Stack

| Komponent | Teknik |
|-----------|--------|
| Frontend | Vanilla HTML/CSS/JS (64 sidor), `js/components.js` för nav/footer |
| Typsnitt | Playfair Display (rubriker) + DM Sans (brödtext) |
| Färger | `#0F6E56` primär, `#1D9E75` accent, `#E1F5EE` pale, `#F7F7F5` bg |
| Backend/DB | Supabase PostgreSQL + 15 Edge Functions + 3 VIEWs |
| Hosting | GitHub Pages (auto-deploy vid push till main) |
| E-post | Resend (verifierad) + Google Workspace hello@spick.se |
| Betalning | Stripe live mode (kort + Klarna) via **booking-create EF** |
| CI/CD | 27 GitHub Actions workflows (14 cron-jobb) |
| Analytics | GA4 (G-CP115M45TT) + Meta Pixel + Microsoft Clarity (w1ep5s1zm6) |
| PWA | Service Worker (stale-while-revalidate) + `manifest.json` |

---

## Arkitektur

### Pricing-arkitektur (ÖVERBLICK — full detalj i `7-ARKITEKTUR-SANNING.md`)

Pricing-logik finns på **14 ställen** i kodbasen (verifierat 2026-04-17). Fyra skriver till DB, tio läser för display.

**Autoritativa (skrivande) paths:**
- `boka.html:2001-2099` — frontend preview (3-lagers hierarki)
- `booking-create/index.ts:183-210` — server booking insert (⚠️ pre-Dag2 ignorerar `use_company_pricing`)
- `setup-subscription/index.ts:96-100` — subscription setup (bara `hourly_rate`)
- `stripe-checkout/index.ts:112-164` — **⚠️ DÖD KOD** (se Edge Functions-avsnitt)

**Vid ändring som påverkar pris — verifiera ALLA ställen, inte bara en.**  
Se [`7-ARKITEKTUR-SANNING.md`](7-ARKITEKTUR-SANNING.md) för komplett lista.

**Länk:** [`/docs/dag2-planering/pricing-arkitektur-2026-04-17.md`](dag2-planering/pricing-arkitektur-2026-04-17.md) för radexakt kartläggning.

**Aktuell fix-status:** Pre-Dag 2 (pricing-sync ej fixad). Dag 2 Väg B rekommenderad (se `/docs/dag2-planering/pricing-fix-strategi-2026-04-17.md`).

### Booking-flödet (verifierat 2026-04-17)

**Engångsbokning:**
```
boka.html  →  POST booking-create EF (rad 2847)
                 ↓
            booking-create/index.ts:611 skapar Stripe Checkout session
                 ↓
            Returnerar session.url
                 ↓
            boka.html redirectar kund till Stripe
                 ↓
            Kund betalar  →  stripe-webhook uppdaterar payment_status='paid'
```

**Prenumeration:**
```
mitt-konto.html / boka.html  →  setup-subscription EF (kortregistrering)
                 ↓
         Cron auto-rebook (daglig)  →  booking-create EF (ny bokning per period)
                 ↓
         Cron charge-subscription-booking (dagen innan)  →  Stripe PaymentIntent
```

---

## Edge Functions (15 st)

| Funktion | Syfte | Status | Auth |
|----------|-------|--------|------|
| **booking-create** | **ENDA aktiva Stripe-integrerade EF för engångsbokningar.** Skapar booking-rad + Stripe checkout session (rad 611). Returnerar URL till frontend. | ✅ Aktiv | Anon |
| **stripe-checkout** | ⚠️ **DÖD KOD** (verifierat 2026-04-17). Anropas inte från någon frontend- eller annan EF-fil. Har korrekt `use_company_pricing`-logik som flyttas till `_shared/pricing-resolver.ts` i Dag 2. **Kan raderas efter Dag 2-refaktor.** | ❌ Oanvänd | Anon |
| **stripe-webhook** | Betalningsbekräftelse, auto-tilldelning, email, idempotency (processed_webhook_events). | ✅ Aktiv | Stripe sig |
| **setup-subscription** | Kortregistrering för prenumerationer. Separat flöde från engångsbokningar. | ✅ Aktiv | Anon |
| **charge-subscription-booking** | Cron-triggad (dagen innan). Debiterar sparade kort för prenumerationsbokning. Läser `booking.commission_pct` korrekt (/100). | ✅ Aktiv | CRON_SECRET |
| **auto-rebook** | Cron-triggad (daglig). Skapar ny bokning från subscription. | ✅ Aktiv | CRON_SECRET |
| cleanup-stale | Rensar pending >30min (cron var 15 min). | ✅ Aktiv | CRON_SECRET |
| auto-remind | Bokningspåminnelser (cron var 30 min). 🟡 BUG 2: hårdkodar `*0.83` i email. | ✅ Aktiv | CRON_SECRET |
| notify | Transaktionsmail (bekräftelse, avbokning etc). 🟡 BUG 2. | ✅ Aktiv | Anon |
| admin-data | Säker dataåtkomst för admin-panel. | ✅ Aktiv | Supabase Auth |
| admin-create-company | Admin skapar företag + initialer `company_service_prices` + ägarens `cleaner_service_prices`. | ✅ Aktiv | Admin |
| admin-approve-cleaner | Admin godkänner cleaner-ansökan, skapar `cleaner_service_prices`. | ✅ Aktiv | Admin |
| health | Systemstatus + business metrics (DB, Stripe, Resend). | ✅ Aktiv | Anon |
| geo | Geocoding + nearest-cleaner matching (Nominatim). | ✅ Aktiv | Anon |
| email-inbound | Inkommande e-post → AI-kategorisering. | ✅ Aktiv | Resend sig |
| rut-claim | RUT-ansökan till Skatteverket. | ✅ Aktiv | Service role |
| push | Push-notiser till städare. | ✅ Aktiv | Service role |
| bankid | BankID-verifiering. | ✅ Aktiv | Anon |
| social-media | Buffer-integration för auto-posting. | ✅ Aktiv | Service role |
| stripe-connect | Stripe Connect payout setup. | ✅ Aktiv | Service role |
| stripe-refund | Återbetalning via Stripe. | ✅ Aktiv | Service role |
| generate-self-invoice | Självfakturering städare (månatlig). | ✅ Aktiv | Service role |
| generate-receipt | Kvitto-generering för kund. | ✅ Aktiv | Anon |
| swish | Swish-betalning (ej live ännu). | ⏳ Inaktiv | Anon |
| booking-cancel-v2 | Avbokning med bypass för admin/VD. | ✅ Aktiv | Anon |
| booking-auto-timeout | Timeout pending-bokningar. | ✅ Aktiv | CRON_SECRET |
| cleaner-booking-response | Städare accepterar/avböjer. | ✅ Aktiv | Anon |
| cleaner-job-match | Matching-algoritm. | ✅ Aktiv | Anon |
| company-propose-substitute | VD föreslår ersättare. | ✅ Aktiv | Anon |
| cleaner-og | OG-bild generering för cleaner-profiler. | ✅ Aktiv | Anon |
| noshow-refund | No-show refund-flöde. | ✅ Aktiv | Service role |

---

## Databasvyer (säkra, anon-åtkomst)

| View | Syfte | Exponerade kolumner |
|------|-------|-------------------|
| `booking_slots` | Kalender (`boka.html`) | cleaner_id, date, time, hours |
| `booking_confirmation` | Tack/betyg-sidor | id, service, date, city, total_price, cleaner_name, customer_name |
| `public_stats` | Homepage-statistik | total_bookings, bookings_today, active_cleaners, avg_rating |
| `v_cleaners_for_booking` | Städarlista för bokning | Filtrerar `is_approved=true AND is_active=true`. Joinar `cleaners` + `companies`. Se [`4-PRODUKTIONSDATABAS.md`](4-PRODUKTIONSDATABAS.md) för full definition. |

---

## Provision och priser

### Format-regel (verifierat via Dag 1-audit, 32 träffar)

**Alla commission-värden i DB och kod är i PROCENT-format (17 = 17%).**

- `bookings.commission_pct` = `17`
- `cleaners.commission_rate` = `17` eller `12` (trots att schema-default är `0.17`)
- `companies.commission_rate` = `17`
- `commission_log.commission_pct` = `17`
- `pricing-engine.ts` konstanter: `COMMISSION_STANDARD=17`, `COMMISSION_TOP=14`

**Koden MÅSTE dividera med 100 innan Stripe-beräkning.**

### Verifieringsstatus per 2026-04-17

| Kodställe | Format-hantering |
|-----------|------------------|
| `charge-subscription-booking:188-190` | ✅ KORREKT — läser `booking.commission_pct`, /100 |
| `faktura.html:121,205` | ✅ KORREKT — `commissionPct \|\| 17`, /100 |
| `team-jobb.html:382-383` | ✅ KORREKT |
| `admin.html:2378,2558` | ✅ KORREKT |
| `generate-self-invoice:190-191` | ✅ KORREKT |
| `booking-create:497` | 🔴 BUG 1 — hårdkodar `commissionRate = 0.17`/`0.12`, ignorerar DB |
| `stripe-checkout:88` | 🔴 BUG 1 — samma hårdkod |
| `stadare-uppdrag.html:637` | 🔴 BUG 3 — läser fel fält (`commission_rate` finns ej på bookings) |
| `auto-remind.ts`, `notify.ts` | 🟡 BUG 2 — hårdkodar `*0.83` i email |
| `stadare-dashboard.html:9080` | 🟡 BUG 4 — hårdkodar 0.12 fallback |

**Sammanfattat:** INKONSISTENT. Se [`/docs/dag2-planering/commission-audit-2026-04-17.md`](dag2-planering/commission-audit-2026-04-17.md) för full tabell.

### Smart Trappstege (commission_tier)

- `new` → 17%
- `established` → 15%
- `professional` → 13%
- `elite` → 12%
- `top` (pricing-engine) → 14%

**⚠️ Obs:** `pricing-engine.ts` definierar `COMMISSION_TOP=14` men `booking-create:497` hårdkodar 0.17 för Stripe — mismatch om någon cleaner är `tier=top`. Per 2026-04-17 verkar ingen cleaner ha `tier=top` (SQL ej körd, men ingen känd indikation).

---

## Kritiska DB-regler

### use_company_pricing-flaggan

Kräver att **booking-create** och **stripe-checkout** BÅDA läser flaggan. Om bara ett ställe läser flaggan → latent bug som aktiveras när flaggan blir `true`.

**Status 2026-04-17:**
- `boka.html` ✅ läser
- `stripe-checkout` ✅ läser (rad 123-127), men DÖD KOD
- `booking-create` 🔴 **LÄSER EJ** — detta är kärnan i Dag 2-fix
- `foretag.html` 🟡 ignorerar flaggan (listningssida)

**Konsekvens idag:** Rafas flagga (`use_company_pricing=false`) får INTE sättas till `true` förrän Dag 2-fix deployats. Om flaggan sätts nu → DB.total_price ≠ Stripe amount → data-inkonsistens.

### Övriga regler (från CLAUDE.md)

- Alla `innerHTML` med DB-data MÅSTE använda `escHtml()`.
- Alla dynamiska URL-parametrar MÅSTE använda `encodeURIComponent()`.
- Nya Edge Functions som anropas via cron MÅSTE kräva `CRON_SECRET`.
- Frontend queryar ALDRIG `bookings`-tabellen direkt — använd VIEWs.
- Supabase JS laddas utan `defer` (utom `index.html` som har DOMContentLoaded-wrapper).

---

## Säkerhet (efter audit 2026-03-30)

- **XSS:** `escHtml()` i 29 filer, 174 sanerade renderingspunkter.
- **RLS:** Alla öppna `USING(true)` UPDATE-policies borttagna.
- **CSP:** Utan unsafe-eval, med HSTS (`max-age=31536000`).
- **Booking validation:** Server-side trigger (dubbelbokningar, ogiltiga belopp, bokningar i förfluten tid).
- **Stripe:** Booking-verifiering + Idempotency-Key på checkout.
- **Rate limiting:** `check_rate_limit()` RPC-funktion i Edge Functions.
- **Webhook:** `processed_webhook_events`-tabell (idempotency).
- **Cron auth:** `CRON_SECRET` krävs för cleanup-stale + auto-remind.
- **booking_status_log:** Auditlogg för statusändringar.

---

## Kända problem / Nästa sprint

Se [`3-TODOLIST-v2.md`](3-TODOLIST-v2.md) för prioriterad lista.

**P0 blockerare för Rafa-live:**
- Pricing-sync-fix (Väg B enligt fix-strategi, ~8h)
- Commission-BUG 1 + 3 (löses i samma PR som pricing-sync)
- Underleverantörsavtal-signering UI

**P0 externa (väntar på):**
- Stripe Connect complete (Rafael)
- Hemadresser för Daniella + Lizbeth (Rafael)
- Försäkringsmäklare-offert 1 Mkr

---

## GitHub Secrets

```
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET,
RESEND_API_KEY, ANTHROPIC_API_KEY, SUPABASE_ACCESS_TOKEN,
SUPABASE_ANON_KEY, SUPABASE_DB_PASSWORD, SUPABASE_SERVICE_KEY,
BUFFER_ACCESS_TOKEN, CRON_SECRET
```

---

## Viktiga filer

| Fil | Syfte |
|-----|-------|
| `CLAUDE.md` | Projektinstruktioner (läses automatiskt av Claude). |
| `js/config.js` | Config (SUPA_URL, SUPA_KEY, escHtml, spickFetch, error handling). |
| `js/components.js` | Nav, footer, mobilmeny (injiceras i alla sidor). |
| `js/cro.js` | Social proof toasts (riktig data från reviews), exit-intent popup. |
| `sw.js` | Service Worker v2026-03-30-v1. |
| `supabase/PREFLIGHT_RUN_THIS.sql` | Allt-i-ett SQL (10 block, kör vid deploy). |
| `supabase/functions/_shared/pricing-engine.ts` | Marginal/rabatt/kredit-motor. Kompletteras i Dag 2 med pricing-resolver. |
| `docs/OPERATIONS_RUNBOOK.md` | Komplett drifthandbok. |
| `scripts/verify-deploy.sh` | Post-deploy verifiering (18 checks). |

---

## Konventioner

- **Farhads PowerShell:** använd `;` istället för `&&` för att kedja kommandon.
- **Språk i dokumentation:** Svenska.
- **Språk i koden (kommentarer):** Svenska är OK.
- **i18n:** Google Translate client-side på frontend (11 språk efter uz-patch). Backend (notify/sms) 100% svenska.

---

## Referensdokument

- [`CLAUDE.md`](../CLAUDE.md) — projektinstruktioner (alltid i context).
- [`3-TODOLIST-v2.md`](3-TODOLIST-v2.md) — prioriterad todolist.
- [`4-PRODUKTIONSDATABAS.md`](4-PRODUKTIONSDATABAS.md) — schema-sanning + RPC-signaturer.
- [`7-ARKITEKTUR-SANNING.md`](7-ARKITEKTUR-SANNING.md) — fragmenterade logikplatser.
- [`rafa-dag1-rapport-2026-04-17.md`](rafa-dag1-rapport-2026-04-17.md) — audit-master.
- [`SPICK_KONTEXT.md`](SPICK_KONTEXT.md) — ⚠️ **föråldrad (2026-03-23)**, behåll endast för historik.
