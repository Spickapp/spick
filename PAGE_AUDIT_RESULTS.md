# Sidaudit -- resultat
Datum: 2026-04-01

---

## Fixade problem

### DEL 1 -- Navigationsrensning

- **admin.html**: `stadare-dashboard.html` deep-link andrad till `/portal` (rad 1722)
- **admin.html**: `mitt-konto.html?email=` deep-link andrad till `/konto?email=` (rad 1806)
- **noindex, nofollow** tillagt pa 10 interna sidor: `intern-kalkyl.html`, `data-dashboard.html`, `marknadsanalys.html`, `sakerhetsplan.html`, `seo-snippet.html`, `skatt-utbetalningar.html`, `registrera-firma.html`, `cookie-banner.html`, `google363231d5ff56bd63.html`, `docs/spick_masterplan.html`
- **noindex** tillagt pa 3 "kommer snart"-sidor: `prenumerera.html`, `spark.html`, `swish-return.html`

### DEL 3 -- Terminologifix

- **"efter RUT" -> "med RUT"** fixat pa 6 stallen:
  - `priser.html` (rad 243, 248) -- prisjamlforelsen
  - `mitt-konto.html` (rad 658) -- bokningskort
  - `min-bokning.html` (rad 250) -- prisetiketten
  - `blogg/rut-avdrag-guide.html` (rad 139)
  - `blogg/storstadning-checklista.html` (rad 139)
- **"efter RUT-avdrag" -> "med RUT-avdrag"** i `docs/spick_masterplan.html`

### Portallankar fixade

- **registrera-firma.html**: `stadare-dashboard.html` -> `/portal` (rad 254)
- **stadare-uppdrag.html**: `stadare-dashboard.html` -> `/portal` (rad 151)
- **villkor-stadare.html**: JS-redirect `stadare-dashboard.html` -> `/portal` (rad 317)

### Navigation och footer

- **components.js + spick-footer** tillagt pa 4 sidor som saknade det:
  - `boka-igen.html`
  - `kalkyl-stadare.html`
  - `prenumerera.html`
  - `spark.html`

---

## Kraver manuell atgard (Supabase/Stripe/extern)

- **Stripe live-mode** -- bookingsflode anvander `booking-create` EF korrekt men Stripe ar fortfarande i testlage
- **BankID-verifiering** -- `registrera-stadare.html` visar "TEST MODE" banner; koppla riktig BankID-leverantor (Signicat/Freja)
- **Supabase Storage 'photos' bucket** -- `stadare-dashboard.html` forsoker ladda upp till bucket `photos`; skapas via Supabase Dashboard
- **Resend e-postdomann** -- magic link-mail (mitt-konto, stadare-dashboard) kraver verifierad doman
- **public_stats-vy** -- index.html anvander hardkodade siffror (50% RUT, 4.9 stjarnor, 100+ bokningar), inte dynamisk vy
- **referral-register EF** -- `tipsa-en-van.html` anvander direkt `referrals` INSERT + `notify` EF, ingen dedikerad `referral-register` edge function
- **Win-back rabattkod** -- rabattkod skickas men valideras inte i Stripe (status fran SYSTEM_STATUS.md)
- **Stripe Connect for stadare** -- ej aktiverat, kravs for automatisk utbetalning

---

## Sidor med innehallsproblem (kraver Farhads beslut)

- **index.html statistiksektion** -- visar hardkodade siffror. Vill du byta till dynamisk `public_stats`-vy eller behalla nuvarande?
- **priser.html** -- jamforelsesektion visar "Genomsnitt stadfirmor 450 kr/h" vs "Spick 250 kr/h". Stammer dessa siffror fortfarande?
- **garanti.html** -- lovar "Omkostnadsfri omstadning inom 48h". Kan ni leverera pa detta med nuvarande stadarbas?
- **sakerhet.html** -- namner BankID-verifiering som existerande feature, men BankID ar i testlage
- **boka-igen.html** -- saknar eget nav/header (bara footer via components.js); kanske bor ha fullstandig nav

---

## Status per flode

| Flode | Status | Detaljer |
|-------|--------|----------|
| **Kundflode** | ✅ | boka -> tack -> min-bokning -> betyg fungerar. RUT-toggle, PNR-validering, avbokning, betygsattning -- allt korrekt. |
| **Stadarflode** | ⚠️ | Registrering, dashboard, 5 flikar, jobb-accept/checkin/klar -- allt implementerat. BankID i testlage. Fotouppladdning kraver Storage-bucket. |
| **Admin** | ✅ | Deep-links fixade till /portal och /konto. |
| **Navigation** | ✅ | components.js laddas pa alla kundvanda sidor. "efter RUT" borta. Alla stadare-dashboard-lankar uppdaterade till /portal. |
| **SEO** | ✅ | Stadssidor har canonical-taggar, konsekvent navbar, CTA:er till boka.html. noindex pa alla interna sidor. |

---

## Granskade sidor (sammanfattning)

### Kundflode
- **boka.html** -- ✅ Steg 1-5, RUT-toggle, PNR-disclaimer, frekvensknappar, booking-create EF, svenska felmeddelanden, exit-popup dold
- **tack.html** -- ✅ Laser stripe_session_id, booking_confirmation-vy, knapp till min-bokning med bid
- **min-bokning.html** -- ✅ Laser ?bid, statusvisning, booking-cancel-v2, stadarinfo, progressbar, tomma falt doljs
- **mitt-konto.html** -- ✅ Magic link, bokningshistorik, betygsmodal, avbokningsknapp, utloggning
- **betyg.html** -- ✅ Laser ?bid och ?cname, klickbara stjarnor, reviews INSERT, garantitrigger vid <=2, customer_name korrekt, ingen duplicerad "boka igen"-lank
- **boka-igen.html** -- ✅ Laser tidigare bokning, prefylls, CTA till boka.html med parametrar
- **garanti.html** -- ✅ Forklaring, kontaktformular till messages-tabell + notify EF, lank till hello@spick.se
- **tipsa-en-van.html** -- ✅ Referral-kod genereras, delningslankar (kopiera/WhatsApp/share API), sparar till referrals-tabell

### Stadarflode
- **bli-stadare.html** -- ✅ CTA till registrering, inkomstkalkylator, ingen stadare-dashboard-lank, mobilvanlig hero
- **bli-stadare-guide.html** -- ✅ JS-syntax korrekt, sticky header utan kollision (nav top:44px), AI-chat anropar claude EF, 290-450 kr/h, 1-3 bankdagar, sprakknappar, registrerings-CTA
- **registrera-stadare.html** -- ✅ --accent:#0F6E56 finns, BankID-integration (testlage), alias-preview, alla 4 checkboxar valideras, inget losenordssteg, cleaner_applications INSERT, plattformsavtal inuti formular, en bekraftelse
- **kalkyl-stadare.html** -- ✅ Korrekt berakning (jobb x timmar x 290 kr/h), CTA till bli-stadare.html
- **utbildning-stadare.html** -- ✅ Relevant innehall, CTA till registrering
- **stadare-dashboard.html** -- ✅ Magic link, 5 flikar, safe-area-inset, ingen fallback-sakeringshall, accept/checkin/klar-knappar, fotouppladdning till Storage
- **villkor-stadare.html** -- ✅ Plattformsavtal och non-solicitation, lankbar fran registrering

### Marknadsforing
- **index.html** -- ✅ Hero CTA till boka.html, bli-stadare-lank, presentkort inaktiverat, mobilmeny
- **priser.html** -- ✅ Priser stammer (349 kr/h), RUT-formulering fixad till "med RUT", CTA till boka.html
- **hur-det-funkar.html** -- ✅ Korrekta steg, ratt timing, CTA:er gar ratt
- **faq.html** -- ✅ Aktuella svar, kontaktlank till hello@spick.se
- **kontakt.html** -- ✅ hello@spick.se korrekt, formular anropar messages-tabell + notify EF
- **om-oss.html** -- ✅ Org.nr 559402-4522 korrekt, inga placeholder-texter
- **sakerhet.html** -- ⚠️ Namner BankID-verifiering (ar i testlage)

### SEO-stadssidor
- **stockholm.html** (+ 19 andra) -- ✅ CTA till boka.html, korrekta priser, canonical-taggar, konsekvent navbar via components.js, inga stadare-dashboard-lankar
