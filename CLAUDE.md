# CLAUDE.md – Spick Projektkontext
> Uppdaterad: 2026-03-30 – Efter fullständig säkerhets- och systemaudit

## Projekt
**Spick** — Sveriges städplattform. Uber-modellen för städning.
Kunder bokar betygsatta städare direkt. Städare sätter egna priser (250–600 kr/h). Spick tar 17% provision (Smart Trappstege: 17%→12% baserat på volym). RUT-avdrag 50%.

## Ägare
- **Farhad Haghighi** — farrehagge@gmail.com / hello@spick.se
- **Bolag:** Haghighi Consulting AB (559402-4522), bifirma Spick

## Tech Stack
| Komponent | Teknik |
|-----------|--------|
| Frontend | Vanilla HTML/CSS/JS (64 sidor), components.js (nav/footer) |
| Typsnitt | Playfair Display (rubriker) + DM Sans (brödtext) |
| Färger | #0F6E56 primär, #1D9E75 accent, #E1F5EE pale, #F7F7F5 bg |
| Backend/DB | Supabase PostgreSQL + 15 Edge Functions + 3 VIEWs |
| Hosting | GitHub Pages (auto-deploy vid push till main) |
| E-post | Resend (verifierad) + Google Workspace hello@spick.se |
| Betalning | Stripe live mode (kort + Klarna) |
| CI/CD | 27 GitHub Actions workflows (14 cron-jobb) |
| Analytics | GA4 (G-CP115M45TT) + Meta Pixel + Microsoft Clarity (w1ep5s1zm6) |
| PWA | Service Worker (stale-while-revalidate) + manifest.json |

## Edge Functions (14 st)
| Funktion | Syfte | Auth |
|----------|-------|------|
| stripe-webhook | Betalningsbekräftelse, auto-tilldelning, email, idempotency | Stripe sig |
| cleanup-stale | Rensar pending >30min (cron var 15 min) | CRON_SECRET |
| auto-remind | Bokningspåminnelser (cron var 30 min) | CRON_SECRET |
| notify | Transaktionsmail (bekräftelse, avbokning etc) | Anon |
| admin-data | Säker dataåtkomst för admin-panel | Supabase Auth |
| health | Systemstatus + business metrics (DB, Stripe, Resend) | Anon |
| geo | Geocoding + nearest-cleaner matching (Nominatim) | Anon |
| email-inbound | Inkommande e-post → AI-kategorisering | Resend sig |
| rut-claim | RUT-ansökan till Skatteverket | Service role |
| push | Push-notiser till städare | Service role |
| bankid | BankID-verifiering | Anon |
| social-media | Buffer-integration för auto-posting | Service role |
| stripe-connect | Stripe Connect payout setup | Service role |
| swish | Swish-betalning (ej live ännu) | Anon |

## Databasvyer (säkra, anon-åtkomst)
| View | Syfte | Exponerade kolumner |
|------|-------|-------------------|
| booking_slots | Kalender (boka.html) | cleaner_id, date, time, hours |
| booking_confirmation | Tack/betyg-sidor | id, service, date, city, total_price, cleaner_name, customer_name |
| public_stats | Homepage-statistik | total_bookings, bookings_today, active_cleaners, avg_rating |

## Säkerhet (efter audit 2026-03-30)
- **XSS:** escHtml() i 29 filer, 174 sanerade renderingspunkter
- **RLS:** Alla öppna USING(true) UPDATE-policies borttagna
- **CSP:** Utan unsafe-eval, med HSTS (max-age=31536000)
- **Booking validation:** Server-side trigger (dubbelbokningar, ogiltiga belopp, bokningar i förfluten tid)
- **Stripe:** Booking-verifiering + Idempotency-Key på checkout
- **Rate limiting:** check_rate_limit() RPC-funktion i Edge Functions
- **Webhook:** processed_webhook_events-tabell (idempotency)
- **Cron auth:** CRON_SECRET krävs för cleanup-stale + auto-remind
- **booking_status_log:** Auditlogg för statusändringar

## Kända problem / Nästa sprint
- [ ] Innovation Sprint-migrationer (referral, coupons, spark) — ej körda i prod
- [ ] SMS-integration (46elks) — bokningsbekräftelser
- [ ] Google Business Profile — ej skapat
- [ ] PostHog analytics — ej installerat
- [ ] Sentry error monitoring — ej installerat
- [ ] Astro-migrering (64 HTML → komponentbaserat) — framtid

## GitHub Secrets
```
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET,
RESEND_API_KEY, ANTHROPIC_API_KEY, SUPABASE_ACCESS_TOKEN,
SUPABASE_ANON_KEY, SUPABASE_DB_PASSWORD, SUPABASE_SERVICE_KEY,
BUFFER_ACCESS_TOKEN, CRON_SECRET
```

## Viktiga filer
| Fil | Syfte |
|-----|-------|
| js/config.js | Config (SUPA_URL, SUPA_KEY, escHtml, spickFetch, error handling) |
| js/components.js | Nav, footer, mobilmeny (injiceras i alla sidor) |
| js/cro.js | Social proof toasts (riktig data från reviews), exit-intent popup |
| sw.js | Service Worker v2026-03-30-v1 |
| supabase/PREFLIGHT_RUN_THIS.sql | Allt-i-ett SQL (10 block, kör vid deploy) |
| docs/OPERATIONS_RUNBOOK.md | Komplett drifthandbok |
| scripts/verify-deploy.sh | Post-deploy verifiering (18 checks) |

## Konventioner
- Alla innerHTML med DB-data MÅSTE använda escHtml()
- Alla dynamiska URL-parametrar MÅSTE använda encodeURIComponent()
- Nya Edge Functions som anropas via cron MÅSTE kräva CRON_SECRET
- Frontend queryar ALDRIG bookings-tabellen direkt — använd VIEWs
- Supabase JS laddas utan defer (utom index.html som har DOMContentLoaded-wrapper)
- Farhads PowerShell: använd semikolon (;) istf && för att kedja kommandon
