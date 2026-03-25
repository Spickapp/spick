<<<<<<< Updated upstream
# Spick – Sveriges städplattform

Boka en betygsatt städare nära dig. Med RUT-avdrag betalar du bara hälften.

## 🌐 Live
- **Webbplats:** https://spick.se
- **GitHub Pages:** https://spickapp.github.io/spick/
- **Admin:** https://spick.se/admin.html (lösenord: Spick2026!)

## 📄 Sidor
| Sida | Beskrivning |
|------|-------------|
| index.html | Startsida med hero, städar-preview, RUT-kalkyl |
| stadare.html | Städarlista från Supabase med sök + filter |
| boka.html | Bokningsformulär med RUT-toggle |
| profil.html | Individuell städarprofil |
| priser.html | Prisöversikt + interaktiv kalkylator |
| hur-det-funkar.html | 3-steg, RUT-info, FAQ |
| om-oss.html | Historia, värderingar, grundare |
| bli-stadare.html | Ansökningsformulär för städare |
| rekrytera.html | Rekryteringssida med kalkylator |
| faq.html | 20+ frågor med kategorier och sök |
| kontakt.html | Kontaktformulär + öppettider |
| avtal.html | Partnersavtal för städare |
| admin.html | Admin-dashboard (KPIs, bokningar, ansökningar) |
| tack.html | Bokningsbekräftelse |
| integritetspolicy.html | GDPR-policy |
| 404.html | Felsida |

## 🛠 Tech
- **Frontend:** Vanilla HTML/CSS/JS
- **Databas:** Supabase (PostgreSQL)
- **Hosting:** GitHub Pages → spick.se
- **E-post:** Resend

## 👤 Kontakt
Farhad Haghighi · hello@spick.se
Spick AB · org.nr 559402-4522
=======
# Spick – Sveriges Städplattform

> Boka en städare du verkligen litar på

Spick kopplar ihop kunder med betygsatta städare. Kunden väljer sin egen städare, ser betyg och pris, och kan ha samma person varje vecka. Städarna sätter sitt eget pris och Spick tar 17% provision. Med RUT-avdrag betalar kunden bara hälften.

## Live

- **Sajt:** [spick.se](https://spick.se) / [taupe-snickerdoodle-35ebec.netlify.app](https://taupe-snickerdoodle-35ebec.netlify.app)
- **Admin:** [spick.se/admin.html](https://spick.se/admin.html)
- **Repo:** [github.com/Spickapp/spick](https://github.com/Spickapp/spick) (private)

## Tech Stack

Vanilla HTML/CSS/JS · Supabase · GitHub Pages · Resend · Google Workspace

## Projektstruktur

```
spick/
├── index.html              Startsida
├── stadare.html            Städarprofiler
├── boka.html               Bokningsformulär + RUT-kalkylator
├── bli-stadare.html        Städaransökan (8 språk)
├── admin.html              Admin-panel
├── avtal.html              Digitalt partneravtal
├── faq.html                FAQ
├── pages/stader/           20 stadssidor
├── pages/                  Övriga sidor (404, priser, kontakt, m.m.)
├── js/                     JavaScript (email-engine)
├── supabase/functions/     Edge functions (notiser)
├── .github/workflows/      CI/CD (deploy, backup, fakturor, DNS)
├── assets/                 Logotyper och bilder
├── docs/                   Dokumentation
└── CLAUDE.md               AI-projektkontext
```

## Deploy

Push till `main` → GitHub Actions → Live inom 2 minuter.

## Dokumentation

Se `docs/`-mappen för admin-guide, operations manual och teknisk dokumentation.
Se `CLAUDE.md` för AI-assisterad utveckling.
>>>>>>> Stashed changes
