# SPICK – Projektstatus & Kontext
*Klistra in detta i början av nästa chatt så vet Claude allt*

---

## Vem är du
- **Namn:** Farhad Haghighi
- **E-post:** farrehagge@gmail.com · hello@spick.se
- **Telefon:** +46760505153
- **Bolag:** Haghighi Consulting AB · org.nr 559402-4522
- **Bifirma:** Spick (registrerad, inlämnad till Bolagsverket)

---

## Vad är Spick
Sveriges städplattform – Uber-modellen för städning.
- Kunden bokar en specifik, betygsatt städare
- Kunden kan ha SAMMA städare varje vecka (fast relation)
- Städaren sätter sitt eget timpris (250–600 kr/h)
- Spick tar 17% provision
- RUT-avdrag 50% – kunden betalar halva, Skatteverket resten
- Städarna är egenföretagare med F-skatt (enskild firma)
- Marknad: Sverige, 40+ miljarder kr/år
- Inga externa kostnader tills volym motiverar det

---

## Juridik
- Moderbolag: Haghighi Capital
- Dotterbolag: Haghighi Consulting AB (559402-4522)
- Bifirma "Spick" inlämnad till Bolagsverket (2 200 kr)
- Partneravtal för städare: **spick.se/avtal.html** (digitalt, sparas i Supabase)

---

## Teknisk infrastruktur – ALLT LIVE

| Tjänst | Status | Detaljer |
|--------|--------|---------|
| spick.se | ⚠️ DNS-problem | Loopia pekar fel – ring dem imorgon |
| Netlify (live) | ✅ Fungerar | taupe-snickerdoodle-35ebec.netlify.app |
| hello@spick.se | ✅ Aktivt | Google Workspace (nedgradera inom 14 dagar!) |
| GitHub | ✅ Klart | github.com/Spickapp/spick (private) |
| Supabase | ✅ Uppsatt | https://urjeijcncsyuletprydy.supabase.co |
| Facebook-sida | ✅ Skapad | "Spick.se" – med logga och omslagsbild |
| Google My Business | ⏳ Påbörjad | Påbörjad men ej klar – fortsätt på business.google.com |

---

## GitHub – Exakt vilka filer som finns

| Fil | Beskrivning |
|-----|-------------|
| index.html | Startsida – hero, hur det funkar, RUT, städarprofiler |
| stadare.html | Välj din städare – profiler, betyg, pris, boka direkt |
| boka.html | Bokningsformulär med RUT-kalkylator |
| bli-stadare.html | Städaransökan på 8 språk med F-skatt-guide |
| admin.html | Admin-panel – alla bokningar och ansökningar |
| avtal.html | Digitalt partneravtal för städare |
| faq.html | FAQ för städare (ej pushad ännu – ladda upp!) |
| update_schema.sql | SQL för Supabase-uppdatering |

---

## Supabase-tabeller

**bookings:**
id, name, email, phone, address, city, service, date, time, hours, rut, personal_number, message, status

**cleaner_applications:**
id, name, email, phone, city, experience, services, has_fskatt, has_insurance, accepts_keys, message, status

Status-värden städare: ny → granskad → godkand / nekad / avtal_signerat

---

## Varumärke
- **Färger:** #0F6E56 (primär), #1D9E75 (accent), #9FE1CB (ljus), #E1F5EE (pale)
- **Typsnitt:** Playfair Display (rubriker) + DM Sans (brödtext)
- **Tagline:** "Boka en städare du verkligen litar på"
- **Adminlösenord:** Spick2026!

---

## Auto-deploy flöde
Kopiera fil till Dokument/Spick → GitHub Desktop → Commit → Push → Live på 30 sek

---

## Pendande åtgärder – I PRIORITETSORDNING

### Imorgon bitti (måste göras)
1. **Ring Loopia** – fixa DNS så spick.se pekar på Netlify
   - Ta bort A-post 194.9.94.85/86
   - Behåll: A 75.2.60.5, A 99.83.190.102, MX smtp.google.com
2. **Nedgradera Google Workspace** till Business Starter på admin.google.com (14-dagarsgräns!)
3. **Slutför Google My Business** på business.google.com
   - Kategori: Städtjänst
   - Serviceområde: Stockholm, Solna, Sundbyberg, Nacka
   - Webbplats: spick.se
4. **Pusha faq.html** till GitHub (filen finns i outputs-mappen)

### Denna vecka
5. **Skapa företags-Swish** kopplat till Haghighi Consulting AB (via Swedbank-appen)
6. **Posta rekryteringsinlägg** på Facebook (filen spick_rekrytering.md är klar)
7. **Gå med i Facebook-grupper:** Städjobb Stockholm, Ukrainare i Stockholm, Somalier i Sverige, Polska i Sverige

### När du har 10+ bokningar/vecka
8. Stripe-betalning
9. Resend e-postnotiser (EPOST_SETUP.md finns)
10. BankID via Signicat

---

## Masterplan – kortversion
- **Städare FÖRE kunder** – rekrytera 10 städare innan första bokning
- **Manuellt flöde** – Swish istället för Stripe tills volymen kräver det
- **Kvalitet framför kvantitet** – ring varje städare, gör testbokning
- **Du syns inte** – allt kommuniceras som Spick-varumärket
- **KPI-mål vecka 2:** 50 ansökningar, 10 godkända städare

---

## Ekonomi
- Fasta kostnader: ~0 kr/mån just nu (allt gratis)
- Breakeven: ~10 städare × 3 jobb/vecka
- Med 20 städare: ~60 000 kr/mån vinst

---

## Nästa stora byggsteg (Claude gör detta)
- Uppdatera stadare.html med riktiga städare från databasen (istället för demodata)
- Stripe-integration
- React Native-app för kund och städare
- E-postnotiser via Resend

---
*Genererad: 2026-03-23*
