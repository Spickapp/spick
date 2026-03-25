# CLAUDE.md – Spick Projektkontext

> Denna fil läses automatiskt av Claude Code, Claude Chat och Claude Cowork.
> Uppdatera den när projektet förändras.

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
| Frontend | Vanilla HTML/CSS/JS (inga frameworks) |
| Typsnitt | Playfair Display (rubriker) + DM Sans (brödtext) |
| Färger | #0F6E56 (primär), #1D9E75 (accent), #9FE1CB (ljus), #E1F5EE (pale) |
| Backend/DB | Supabase (PostgreSQL + Edge Functions) |
| Hosting | GitHub Pages (primär), Loopia DNS |
| E-post | Resend + Google Workspace (hello@spick.se) |
| CI/CD | GitHub Actions (7 workflows) |
| Repo | github.com/Spickapp/spick (private) |

## Projektstruktur

```
spick/
├── CLAUDE.md              ← DU LÄSER DENNA FIL
├── index.html             ← Startsida
├── stadare.html           ← Städarprofiler med betyg
├── boka.html              ← Bokningsformulär + RUT-kalkylator
├── bli-stadare.html       ← Städaransökan (8 språk, F-skatt-guide)
├── admin.html             ← Admin-panel (lösen: byt från Spick2026!)
├── avtal.html             ← Digitalt partneravtal
├── faq.html               ← FAQ för städare
├── index_1.html           ← Alternativ startsida (test)
│
├── pages/
│   ├── stader/            ← 20 stadssidor (stockholm.html, goteborg.html, ...)
│   ├── 404.html
│   ├── ai-support.html
│   ├── betyg.html         ← Betygsformulär
│   ├── hur-det-funkar.html
│   ├── integritetspolicy.html
│   ├── kontakt.html
│   ├── om-oss.html
│   ├── priser.html
│   ├── rekrytera.html
│   └── tack.html          ← Tack-sida efter bokning
│
├── js/
│   └── email-engine.js    ← E-postlogik (Resend)
│
├── supabase/
│   └── functions/notify/index.ts  ← Edge function för notiser
│
├── .github/workflows/
│   ├── deploy.yml          ← GitHub Pages deploy
│   ├── deploy-loopia.yml   ← FTP deploy till Loopia
│   ├── backup.yml          ← Nattlig backup (02:00)
│   ├── monthly-invoices.yml ← Fakturagenerering 1:a varje månad
│   ├── claude.yml          ← Claude Code via GitHub Issues
│   ├── loopia-dns.yml      ← DNS-hantering via Loopia API
│   └── inject-tracking.yml ← GA4 + Meta Pixel injection
│
├── assets/                 ← Logotyper och bilder
├── docs/                   ← All dokumentation
├── archive/                ← Gamla zip-backuper
│
├── CNAME                   ← spick.se
├── sitemap.xml
├── robots.txt
├── manifest.json
├── _redirects
└── update_schema.sql
```

## Supabase-tabeller

```sql
-- bookings
id, name, email, phone, address, city, service, date, time, hours,
rut, personal_number, message, status

-- cleaner_applications
id, name, email, phone, city, experience, services, has_fskatt,
has_insurance, accepts_keys, message, status
-- Status: ny → granskad → godkand / nekad / avtal_signerat

-- cleaners (godkända städare, visas på stadare.html)
-- ratings (betyg från kunder, trigger uppdaterar snittbetyg)
-- invoices (månadsprovisioner, genereras av GitHub Action)
-- guarantee_requests (nöjdhetsgaranti vid betyg ≤ 2)
```

## Supabase-anslutning

- **Projekt:** urjeijcncsyuletprydy
- **URL:** https://urjeijcncsyuletprydy.supabase.co
- **Dashboard:** supabase.com/dashboard/project/urjeijcncsyuletprydy

## Deploy

Push till `main` → GitHub Actions → Live inom 2 minuter.
Dual deploy: GitHub Pages + Loopia FTP.

## Kommandon / Workflows

```bash
# Kör via GitHub Actions workflow_dispatch:
# DNS-fix:       loopia-dns.yml (action: fix-github-pages | add-google-mx | verify-dns)
# Tracking:      inject-tracking.yml (ga4_id + meta_pixel_id)
# Backup:        backup.yml (kör också 02:00 varje natt)
# Fakturor:      monthly-invoices.yml (kör också 1:a varje månad)
```

## Kodstil

- Ren vanilla HTML/CSS/JS — inga npm-paket, inga bundlers
- All CSS inline i `<style>` i varje HTML-fil (ingen extern .css)
- Supabase JS-client via CDN: `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`
- Mobilanpassad design (responsive grid, media queries)
- Playfair Display för rubriker, DM Sans för brödtext
- Grönt tema: alla knappar/CTA i --green (#0F6E56)

## Affärsmodell

- Städarpris: 250–600 kr/h (städaren bestämmer)
- Spick provision: 17%
- RUT-avdrag: 50% för kunden
- Breakeven: ~10 städare × 3 jobb/vecka
- Snittbokning: 350 kr/h × 3h = 1 050 kr → Spick 178,50 kr

## Prioriterade uppgifter (uppdatera löpande)

1. Fixa DNS: spick.se → GitHub Pages (ring Loopia / kör workflow)
2. Google Workspace: nedgradera till Business Starter
3. GA4 + Meta Pixel: injicera via workflow
4. Städarnas riktiga email i Supabase
5. Testbokning: hela flödet end-to-end
6. Byt admin-lösenord (hårdkodat i admin.html)
7. Stripe-integration (när volym motiverar)
8. React Native-app (framtida)
