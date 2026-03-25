# Spick – Sveriges Städplattform

> Boka en städare du verkligen litar på

Spick kopplar ihop kunder med betygsatta städare. Kunden väljer sin egen städare, ser betyg och pris, och kan ha samma person varje vecka. Städarna sätter sitt eget pris och Spick tar 17% provision. Med RUT-avdrag betalar kunden bara hälften.

## Live

- **Webbplats:** [spick.se](https://spick.se)
- **GitHub Pages:** [spickapp.github.io/spick](https://spickapp.github.io/spick/)
- **Admin:** [spick.se/admin.html](https://spick.se/admin.html)

## Tech Stack

Vanilla HTML/CSS/JS · Supabase (PostgreSQL) · GitHub Pages · Resend · Google Workspace

## Projektstruktur

```
spick/
├── index.html              Startsida
├── stadare.html            Städarprofiler med sök + filter
├── boka.html               Bokningsformulär + RUT-kalkylator
├── bli-stadare.html        Städaransökan (8 språk)
├── admin.html              Admin-dashboard (KPIs, bokningar, ansökningar)
├── avtal.html              Digitalt partneravtal
├── faq.html                FAQ med kategorier och sök
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

## Kontakt

Farhad Haghighi · hello@spick.se
Spick · org.nr 559402-4522
