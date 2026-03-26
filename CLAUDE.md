# CLAUDE.md – Spick Projektkontext
> Uppdaterad: 2026-03-26 – Automatiskt av Claude

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
| Frontend | Vanilla HTML/CSS/JS |
| Typsnitt | Syne (rubriker, nya sidor) + Playfair Display (äldre sidor) + DM Sans (brödtext) |
| Färger | #0F6E56 (primär), #1D9E75 (accent), #9FE1CB (ljus), #E1F5EE (pale) |
| Backend/DB | Supabase (PostgreSQL + Edge Functions) |
| Hosting | GitHub Pages (primär) + Loopia FTP (backup) |
| E-post | Resend + Google Workspace (hello@spick.se) |
| Betalning | Stripe (live mode, Klarna inkluderat) |
| CI/CD | GitHub Actions (19 aktiva workflows) |

## Systemstatus (2026-03-26)
| Komponent | Status |
|-----------|--------|
| spick.se | ✅ Live |
| Supabase | ✅ Aktiv, 25 migrationer körda |
| Stripe | ✅ Live mode, Klarna aktiverat |
| Resend mail | ✅ Verifierad |
| Edge Functions | ✅ Alla 11 deployade |
| Daily automation | ✅ Kör 08:00 dagligen |
| Stripe Webhook | ⚠️ Behöver endpoint i Stripe Dashboard |
| GA4 / Meta Pixel | ⚠️ Behöver ID:n från Farhad |

## Supabase-tabeller (aktuella)
- bookings (+ cleaner_id, payment_status, stripe_payment_intent)
- cleaners (+ avg_rating, identity_verified, services TEXT[])
- cleaner_applications (+ available_days, languages, hourly_rate)
- cleaner_availability (veckoschema per städare)
- cleaner_blocked_dates
- ratings / reviews
- invoices
- guarantee_requests
- referrals
- customers
- push_subscriptions

## Viktiga buggar fixade
- services kolumn är TEXT[] (array) i DB – kod hanterar nu Array.isArray()
- hero::before pointer-events blockerade formulärkort – fixat
- cleaner_availability tabell saknades – skapad + seeddata

## Vad Farhad behöver göra
1. Stripe webhook endpoint i Stripe Dashboard → spara whsec_ → GitHub Secret STRIPE_WEBHOOK_SECRET
2. Städarnas riktiga e-postadresser (9 st har @spick.se-platshållare)
3. GA4 Measurement ID → ge till Claude
4. Meta Pixel ID → ge till Claude
5. Google My Business → slutför på business.google.com

## Deploy
Push till `main` → GitHub Actions → Live inom 2 minuter.

## Kodstil
- Ren vanilla HTML/CSS/JS
- All CSS inline i `<style>` i varje HTML-fil
- Supabase JS-client via CDN
- services-kolumn: ALLTID hantera som Array.isArray(c.services) ? c.services.join(',') : c.services
