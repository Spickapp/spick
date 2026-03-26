# CLAUDE.md – Spick Projektkontext
> Uppdaterad: 2026-03-26 (kväll) – Komplett status efter session 2

## Projekt
**Spick** — Sveriges städplattform. Uber-modellen för städning.
Kunder bokar betygsatta städare direkt. Städare sätter egna priser (250–600 kr/h). Spick tar 17% provision. RUT-avdrag 50%.

## Ägare
- **Farhad Haghighi** — farrehagge@gmail.com / hello@spick.se
- **Bolag:** Haghighi Consulting AB (559402-4522), bifirma Spick
- **Telefon:** +46760505153

## Tech Stack
| Komponent | Teknik |
|-----------|--------|
| Frontend | Vanilla HTML/CSS/JS (60 sidor) |
| Typsnitt | Syne (nya sidor) + Playfair Display (äldre) + DM Sans (brödtext) |
| Färger | #0F6E56 primär, #1D9E75 accent, #9FE1CB ljus, #E1F5EE pale |
| Backend/DB | Supabase PostgreSQL + 11 Edge Functions |
| Hosting | GitHub Pages (auto-deploy vid push till main, ~2 min) |
| E-post | Resend (verifierad) + Google Workspace hello@spick.se |
| Betalning | Stripe live mode + Klarna |
| CI/CD | 19 aktiva GitHub Actions workflows |

## Systemstatus – ALLT LIVE (2026-03-26 kväll)
| Komponent | Status | Detalj |
|-----------|--------|--------|
| spick.se | ✅ Live | GitHub Pages |
| Supabase DB | ✅ Live | 26 migrationer körda |
| Stripe | ✅ Live mode | sk_live_ + whsec_ satta i GitHub + Supabase |
| Stripe Webhook | ✅ Live | whsec_al4z5aWMSGg5Q5Qpf9WERYl7FUeREFHl synkat till Supabase |
| Resend mail | ✅ Live | RESEND_API_KEY satt |
| Edge Functions | ✅ Deployade | Alla 11 st |
| Daily automation | ✅ 08:00 | Påminnelser, win-back, admin-rapport |
| GA4 | ✅ Live | G-CP115M45TT på alla 58 sidor |
| Meta Pixel | ✅ Live | 874536122252551 på alla 58 sidor |
| Microsoft Clarity | ✅ Live | w1ep5s1zm6 på alla 58 sidor |
| Search Console | ✅ Verifierad | Meta-tag aktiv i index.html |
| Google My Business | ⚠️ Påbörjad | Farhad slutför på business.google.com |

## GitHub Secrets (alla satta)
- STRIPE_SECRET_KEY (sk_live_51TEsG3FQ...)
- STRIPE_PUBLISHABLE_KEY (pk_live_51TEsG3FQ...)
- STRIPE_WEBHOOK_SECRET (whsec_MWbvuu...)
- RESEND_API_KEY ✅
- ANTHROPIC_API_KEY ✅
- SUPABASE_ACCESS_TOKEN ✅
- SUPABASE_ANON_KEY ✅
- SUPABASE_DB_PASSWORD ✅ (återställd 2026-03-26)
- SUPABASE_SERVICE_KEY ✅
- SUPABASE_SERVICE_ROLE_KEY ✅
- LOOPIA_API_USER/PASS ✅
- LOOPIA_FTP_USER/PASS ✅
- GH_PAT ✅
- BUFFER_ACCESS_TOKEN ✅

## Supabase-tabeller
- cleaners (services är TEXT[] – ALLTID hantera med Array.isArray())
- bookings (cleaner_id, payment_status, stripe_payment_intent, sqm, total_price...)
- cleaner_applications (available_days, languages, hourly_rate)
- cleaner_availability (veckoschema, day_of_week 0-6)
- cleaner_blocked_dates
- reviews / ratings
- invoices
- guarantee_requests
- referrals
- customers
- push_subscriptions

## Städare i DB (9 demo-städare, alla godkända)
Olena Kovalenko, Ahmed Hassan, Maria Andersson, Fatima Al-Rashid,
Sara Lindqvist, Kofi Mensah, Natasha Petrov, Mohammed Al-Farsi, Anna-Lena Berg
– Alla med gmail-adresser, korrekt services TEXT[], availability mån-fre 08-17

## Viktiga kodregler
1. services är TEXT[] i DB → `Array.isArray(c.services) ? c.services.join(',') : (c.services||'')`
2. hero::before på alla hero-sektioner behöver `pointer-events:none`
3. Formulärkort behöver `position:relative; z-index:2` för att ligga ovanpå overlays
4. goStep() i formulär: använd explicit for-loop, inte forEach med classList.add('')

## Kvarstående för Farhad
✅ KLART – Stripe webhook endpoint satt + whsec_ synkat

## Nästa dev-prioriteringar
1. End-to-end testbokning med Stripe test-kort 4242...
2. Push-notiser till städare (VAPID, funktionen är skriven)
3. Abonnemangs-flöde (subscriptions-tabell finns, backend saknas)
4. Buffer-integration för automatiska sociala medieposter
5. BankID via GrandID (produktionsavtal krävs)

## Deploy
Push till `main` → GitHub Actions → Live ~2 min
`git add -A && git commit -m "..." && git push origin main`
