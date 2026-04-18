# Spick Arkitekturplan v2 — Hybrid refactor mot skalbarhet

**Version:** 2.0  
**Författare:** Farhad + Claude  
**Datum:** 18 april 2026  
**Status:** Aktiv plan  
**Mål:** 30 städfirmor + 500 bokningar/månad, redo Q4 2026  
**Strategi:** Hybrid — refactor parallellt med minimal feature-utveckling  
**Tidsbudget:** 5-10h/vecka, 10-14 veckor totalt

---

## Sammanfattning för den som skummar

Spick har 80% av en komplett plattform byggd. De återstående 20% är inte nybygge — det är **centralisering av fragmenterat byggd kod**. Denna plan beskriver 6 faser över 10-14 veckor som tar Spick från "fungerar för 2 piloter" till "skalar till 30 firmor".

Ingen feature-frys. Rafael och Zivar fortsätter använda plattformen som vanligt. Små features får levereras, men inga stora. Refactor sker i bakgrunden.

**Efter planen:** Spick hanterar 30 firmor och 500 bokningar/månad utan manuell support per firma. Data lever i centraliserade tabeller istället för spridda hardcoded-listor. Alla regel #26/#27/#28 efterlevs.

---

## Del 1: Vad du redan har byggt (80%)

Regel #26: Verifierat via SQL mot prod + kodgranskning 17-18 april.

### Kärnfunktioner som fungerar

- Bokningsflöde end-to-end (kund → boka → Stripe → bokning)
- Stripe Connect destination charges (12% provision, 88% till VD)
- RUT-beräkning (50% split korrekt)
- PostGIS-matchning (find_nearby_cleaners)
- Company Wizard (företag + VD + team i en knapptryckning)
- Publika profiler (/f/slug, /f/slug/cleaner)
- Admin-UI (40-60% täckning)
- view_as-impersonate (säkrad)
- Stripe-webhooks med idempotency
- Auto-refund vid double-booking
- Pricing-resolver (centraliserad sedan 18 april)
- OTP-inloggning (alla rolltyper)
- BankID-verifiering för städare
- Self-invoice + kundkvitton
- 3-lagers rollbaserat dashboardsystem
- Auto-delegation (3 EFs live, SLA-timers)
- 78 databastabeller med PostGIS
- RUT-ombud godkänd (Skatteverket, 13 april 2026)

### Vad som gör denna lista viktig

Om du tappar modet under refactor — läs denna lista. Du har byggt mer än de flesta solo-grundare skulle på ett år. Det som återstår är polish, inte grunder.

---

## Del 2: Verifierade problem (18 april)

### Fragmenteringar enligt regel #28

1. **Services** — hardcoded i 5+ filer med divergens (5 vs 9 tjänster)
2. **RUT-listor** — duplicerade i 4 filer
3. **Pricing** — 14 ställen, 2 fixade
4. **Languages** — hardcoded överallt
5. **Commission** — blandade format i prod (17/12/0.17)
6. **cleaner_availability** — v1 + v2 parallellt
7. **bookings vs jobs vs booking_staff** — tre parallella modeller
8. **coupons vs discounts** — två parallella rabattsystem
9. **ratings vs reviews** — reviews är VY på ratings
10. **referrals vs cleaner_referrals** — två tabeller
11. **activity_log vs admin_audit_log** — potentiellt redundanta

### Tysta buggar verifierade

12. Admin schedule-editor skriver till v1-tabell (ineffektiv)
13. Dag-numreringsbugg boka.html:1896 (JS getDay vs ISO)
14. Reassign via PATCH utan notis (stadare-dashboard.html:8072-8094)
15. Bonusbugg: cleaner_email sätts till VD:s email vid team-accept
16. Booking_staff är död kod
17. Endast `booking_created` loggas — övriga events saknas
18. Wizard skapar VD utan hemadress (krävde manuell fix för Zivar)
19. Wizard skapar bara mån-fre availability (helger saknas)

### RLS-problem

20. Admin saknar SELECT-policies för 5 tabeller (401-errors)
21. Admin-UPDATE-policy för cleaners i prod men ej i repo
22. `Company owner reads team bookings` — samma sak
23. 8 redundanta SELECT-policies på bookings (konsolidera)
24. `Anon can read bookings`-läcka fanns tidigare (raderad 18 april)

### Saknade funktioner

25. Ingen SMS-invite till teammedlemmar
26. Ingen admin-trigger för Stripe Connect-onboarding
27. Underleverantörsavtal saknar signatur-flöde
28. Admin saknar UI för company_service_prices + cleaner_service_prices
29. Admin saknar UI för cleaner_availability_v2

**Total: 29 identifierade problem.** Alla ska adresseras i denna plan.

---

## Del 3: Strategiska principer

### Princip 1: Regel #26/#27/#28 gäller alltid

Varje påstående verifieras mot primärkälla (grep + SQL). Ingen ny fragmentering tillåts. Varje ändring dokumenteras med fil:rad.

### Princip 2: Inget rivs utan ersättare

Gammal kod/tabell bevaras tills ny är verifierad i produktion. Ingen "big bang"-migration.

### Princip 3: Hybrid-tempo

5-10h/vecka. Ingen feature-frys. Rafael och Zivar prioriteras vid support.
Små features (t.ex. språk-visning) får skeppas under refactor.
Stora features (t.ex. premiumstädning för Rafael) pausas till efter Fas 3.

### Princip 4: Bakåtkompatibelt först, rensa sist

Ny tabell/kolumn läggs till **parallellt**, inte ersätter. Först när 100% av läsare migrerat tas gammal struktur bort.

### Princip 5: Central källa per koncept

För varje koncept (service, language, commission, RUT-status, pricing, event) — **en källa**. Alla vyer läser därifrån. Ingen hardcoded duplicering.

### Princip 6: Feature flags där risk finns

Nya flöden skyddas bakom feature flags. Om något går fel → slå av flaggan, gammalt flöde återtar. Ingen hårdkopplad migration.

---

## Del 4: Hybridplan — 10-14 veckor

### Vecka 1 — Fas 0: Säkerhet & stabilitet (5-8h)

**Mål:** Fixa akuta säkerhetsbuggar innan de orsakar problem.

**Uppgifter:**

- [ ] 0.1 — Audit alla RLS-policies (lista qual=true SELECT per tabell)
- [ ] 0.2 — Dokumentera odokumenterade prod-policies som migration-filer
- [ ] 0.3 — Fixa bonusbuggen cleaner_email i cleaner-booking-response
- [ ] 0.4 — Fixa admin schedule-editor (skriva till v2-tabellen)
- [ ] 0.5 — Bugfix boka.html:1896 dag-numrering
- [ ] 0.6 — Wizard default mån-sön (inte bara mån-fre)
- [ ] 0.7 — Wizard kräver VD-hemadress + geokodar

**Leverabler:**

- `/docs/audits/2026-04-XX-rls-full-audit.md`
- `/supabase/migrations/20260420_admin_policies.sql`
- 5-6 commits som fixar specifika buggar

**Regel #26/#27/#28:**

- Varje fix verifieras mot prod efter deploy
- Ingen "snabb-fix" som centralisering skulle ha förhindrat
- Backlog uppdateras med restkonflikter

---

### Vecka 2-3 — Fas 1: Services-tabell (10-15h)

**Mål:** Flytta hardcoded service-listor till DB. Ny service = rad i tabell.

**Uppgifter:**

- [ ] 1.1 — Skapa `services`-tabell med seed för 7 befintliga tjänster
- [ ] 1.2 — Bygg services-resolver helper (`getServiceBySlug`, `getRutEligibleServices`)
- [ ] 1.3 — Migrera boka.html att läsa från tabell
- [ ] 1.4 — Migrera admin.html
- [ ] 1.5 — Migrera foretag.html
- [ ] 1.6 — Migrera stadare-profil.html
- [ ] 1.7 — Migrera stadare-dashboard.html
- [ ] 1.8 — Radera hardcoded listor när alla migrerat
- [ ] 1.9 — Feature: lägg till "Premiumstädning" via INSERT (för Rafael)

**Leverabler:**

- Services-tabell i prod
- 5 frontend-filer migrerade
- Rafaels Premiumstädning live utan kodändring
- `/docs/architecture/services-catalog.md`

**Feature-leverans under refactor:**

När services-tabellen är klar (Fas 1.8) → Rafaels begäran om Premiumstädning blir en 30-sekunders INSERT. Detta är det första beviset att refactor lönar sig.

---

### Vecka 4 — Fas 2: Languages + språkpicker (5-8h)

**Mål:** Centralisera språk per cleaner/company.

**Uppgifter:**

- [ ] 2.1 — Skapa languages-tabell + 37 språk-seed (från /js/languages.js)
- [ ] 2.2 — Lägg till `cleaners.languages` jsonb-array
- [ ] 2.3 — Lägg till `companies.languages` jsonb-array
- [ ] 2.4 — Bygg sökbar språk-picker-komponent
- [ ] 2.5 — Integrera i 5-6 UI-platser (Wizard, cleaner-profil, admin, etc)
- [ ] 2.6 — GIN-index för framtida matchning

**Leverabler:**

- Zivars team kan markera uzbekiska
- Kunder ser språk på cleaner-profil
- Ingen matchning på språk än (kommer i Fas 5)

**Feature-leverans:**

Zivar får språk-funktionen hon troligen kommer önska.

---

### Vecka 5-6 — Fas 3: Pricing + commission (10-15h)

**Mål:** Alla pricing-läsningar går genom pricing-resolver (12 återstående ställen).

**Uppgifter:**

- [ ] 3.1 — Migrera boka.html (preview-beräkning)
- [ ] 3.2 — Migrera stadare-profil.html
- [ ] 3.3 — Migrera foretag.html
- [ ] 3.4 — Migrera admin.html (VD-vy)
- [ ] 3.5 — Migrera stadare-dashboard.html
- [ ] 3.6 — Utöka pricing-resolver med quote-baserat stöd (för offert-tjänster)
- [ ] 3.7 — Radera `cleaners.commission_rate` + `companies.commission_rate` (flagga som deprecated)
- [ ] 3.8 — Dokumentera pricing-arkitektur

**Leverabler:**

- 14 pricing-ställen → 1 central källa
- Quote-baserat infrastruktur för framtid (Rafaels mattrengöring)
- Rena DB-kolumner utan commission-fragment

---

### Vecka 7-8 — Fas 4: Event-system (10-15h)

**Mål:** Full audit-trail för bokningars livscykel.

**Uppgifter:**

- [ ] 4.1 — Utöka `booking_events`-schemat med fler event-types
- [ ] 4.2 — Trigger-funktion `log_booking_event()` enhetlig
- [ ] 4.3 — Logga: `cleaner_assigned`, `cleaner_reassigned`, `payment_received`, `checkin`, `checkout`, `completed`, `cancelled`, `reviewed`
- [ ] 4.4 — Bygg event-timeline-vy i admin (för support)
- [ ] 4.5 — Bygg event-timeline i VD-dashboard (för transparens)
- [ ] 4.6 — Deprecate `booking_status_log` om redundant

**Leverabler:**

- Full audit-trail
- Admin kan svara "när byttes städaren?" utan att gissa
- VD ser hela bokningshistorik

---

### Vecka 9-10 — Fas 5: Notifikationer (10-15h)

**Mål:** Tysta flöden blir meddelade. Teammedlemmar får notiser.

**Uppgifter:**

- [ ] 5.1 — Audit existerande notifikations-EFs (grep resend, 46elks)
- [ ] 5.2 — Central notifikations-dispatcher (1 EF, 1 tabell)
- [ ] 5.3 — Trigger SMS/email vid: ny bokning tilldelad, cleaner-reassign, kund-reassign, checkin-påminnelse, completion-bekräftelse
- [ ] 5.4 — Team-SMS-invite från Wizard
- [ ] 5.5 — Kundmejl vid städarbyte (transparens)
- [ ] 5.6 — Notifications-preferenser per cleaner/kund

**Leverabler:**

- Dildora får SMS när Zivar tilldelar jobb
- Kunder vet att städare byttes
- Wizard skickar invite-SMS till team (saknades idag)

---

### Vecka 11-12 — Fas 6: Admin + RLS-konsolidering (10-15h)

**Mål:** Admin täcker 95%+ av operationer. RLS enkla och säkra.

**Uppgifter:**

- [ ] 6.1 — Admin-UI: company_service_prices + cleaner_service_prices
- [ ] 6.2 — Admin-UI: cleaner_availability_v2 redigering
- [ ] 6.3 — Admin-UI: Stripe Connect-trigger-knapp (SMSar länk till VD)
- [ ] 6.4 — Admin-UI: underleverantörsavtal-signatur-flöde
- [ ] 6.5 — Konsolidera 8 SELECT-policies på bookings till 3-4
- [ ] 6.6 — Admin SELECT-policies för 5 tabeller (fix 401-errors)
- [ ] 6.7 — Radera booking_staff (död kod)
- [ ] 6.8 — Radera cleaner_availability v1 (efter 30 dagars buffer)

**Leverabler:**

- Admin hanterar allt utom Stripe/BankID själv
- RLS minimalt och verifierat
- Död kod rensad

---

### Vecka 13 — Fas 7: E2E-verifiering + matchnings-utökning (5-10h)

**Mål:** Full E2E-test + matchnings-RPC utökad med nya filter.

**Uppgifter:**

- [ ] 7.1 — Utöka `find_nearby_cleaners` med valfria parametrar: `p_service_slug`, `p_languages`, `p_require_fskatt`, `p_min_rating`
- [ ] 7.2 — E2E-test: kund → bokning → Stripe → tilldelning → notis → incheckning → klar → faktura
- [ ] 7.3 — E2E-test: auto-delegation vid avbokning
- [ ] 7.4 — E2E-test: VD-impersonate fungerar för alla funktioner
- [ ] 7.5 — Last-test: 50 samtidiga bokningar

**Leverabler:**

- Matchning kan filtrera på språk/tjänst/F-skatt
- E2E-tester körs i CI

---

### Vecka 14 — Fas 8: Audit-pipeline + dokumentation (5-8h)

**Mål:** Framtida drift upptäcks automatiskt.

**Uppgifter:**

- [ ] 8.1 — CI-script: upptäck hardcoded services
- [ ] 8.2 — CI-script: upptäck hardcoded commission
- [ ] 8.3 — CI-script: upptäck duplicerade RUT-listor
- [ ] 8.4 — CI-script: RLS-policies med qual=true på SELECT
- [ ] 8.5 — Dokumentera arkitektur i /docs/architecture/
- [ ] 8.6 — Onboarding-guide för framtida utvecklare

**Leverabler:**

- Arkitekturen försvarar sig själv mot framtida drift
- Dokumentation som gör systemet läsbart

---

## Del 5: Feature-kö under refactor

Små features får levereras parallellt. Stora pausas.

### Get-levererade under refactor (grönt ljus)

- **Rafaels Premiumstädning** — efter Fas 1 (vecka 3), 30-sekunders insert
- **Zivars språkpicker** — efter Fas 2 (vecka 4)
- **Team-SMS-invite** — efter Fas 5 (vecka 9-10)
- **Stripe Connect från admin** — efter Fas 6 (vecka 11-12)
- **Kundmejl vid städarbyte** — efter Fas 5

### Pausat (rött ljus — tas efter vecka 14)

- Mobilapp (native iOS/Android)
- Multi-stad-support (regioner, timezones)
- Avancerade matchnings-algoritmer (ML)
- Full PWA-offline-stöd
- Internationalisering av backend-mallar
- Mattrengöring-offerter (kräver quote-flöde som byggs i Fas 3)

### Bedömning i gråzon

Nya small features som inte passar ovan → **Regel #28**: om featuren kräver hardcoded värde någonstans → vänta tills refactor fasen för det konceptet är klar.

---

## Del 6: Riskregister

| # | Risk | Sannolikhet | Påverkan | Mitigation |
|---|------|-------------|----------|------------|
| 1 | Tid räcker inte (4-6 veckors överdrag) | Hög | Medel | Scope-kryp-skydd: säg nej till features |
| 2 | Fas 5 (notifikationer) mer komplex än väntat | Medel | Hög | Budget 15h, buffer 5h |
| 3 | Rafael/Zivar kräver snabb leverans | Hög | Medel | Kommunicera tidigt: "efter fas X" |
| 4 | Claude Code introducerar buggar under refactor | Bekräftad | Medel | Regel #26/#27/#28 per commit |
| 5 | Ny kund (3:e firma) kräver onboarding | Medel | Medel | Be dem vänta till vecka 8+ |
| 6 | Prod-migration i Fas 3 pricing orsakar bokningsfel | Låg | Hög | Parallell skrivning + validering |
| 7 | Bug-fixar under Fas 0 avslöjar fler bugg-nätet | Hög | Låg-Medel | Dokumentera, uppdatera plan |
| 8 | Datamigration v1→v2 i Fas 6 tappar data | Låg | Hög | 30-dagars buffer + backup |
| 9 | Farhad tappar motivation vecka 8-10 | Medel | Hög | Fira små vinster (Rafaels premium) |
| 10 | Stripe ändrar API i Fas 5 | Låg | Hög | Pin SDK-version |

---

## Del 7: Framgångskriterier

Planen är lyckad när:

### Kvantitativt

- [ ] 0 hardcoded service-listor (CI-script grönt)
- [ ] 0 hardcoded commission-värden
- [ ] 0 duplicerade RUT-listor
- [ ] 100% av pricing läses via pricing-resolver
- [ ] Alla 29 identifierade problem adresserade
- [ ] Matchnings-RPC latens < 50ms vid 100 cleaners
- [ ] Event-system loggar minst 8 event-types
- [ ] 95%+ admin-operationer görs via admin-UI (inte SQL)

### Kvalitativt

- [ ] Ny tjänst läggs till med INSERT (ingen kod-ändring)
- [ ] Nytt språk läggs till med INSERT
- [ ] Ny städfirma onboardas under 15 min självbetjäning
- [ ] Reassign triggar notis till alla parter
- [ ] Farhad kan besvara "vad hände med bokning X?" från event-timeline

### Affärsmässigt

- [ ] Rafael kvar som aktiv pilot
- [ ] Zivar kvar som aktiv pilot
- [ ] Minst 3 nya firmor onboardade under refactor
- [ ] Ingen downtime > 5 min under migrations
- [ ] 0 säkerhetsincidenter

---

## Del 8: Daglig rutin

För att hålla 5-10h/vecka strukturerat:

### Måndag (1-2h)

- Läs veckans fas i plan
- Starta Claude Code-prompts för veckans uppgifter
- SQL-verifiering av nuvarande tillstånd

### Onsdag (2-3h)

- Review av Claude Code-arbete
- Regel #26/#27/#28-granskning
- Testdeploy till staging

### Fredag (2-3h)

- Produktionsdeploy (efter testdeploy ok)
- Verifiera Rafael + Zivar fungerar
- Uppdatera backlog

### Helgen

- Fritt. Vila. Eller smått om lust finns.

---

## Del 9: Kommunikation till Rafael + Zivar

Ärlighet bygger förtroende:

**Vecka 1 (måndag 20 april):**

> "Hej [Rafael/Zivar], vi är inne i en infrastrukturperiod april-juli där vi förbättrar grunderna i Spick så vi kan växa till fler firmor. Du märker inget direkt — plattformen fungerar som vanligt. Men vissa nya features du önskar kommer levereras i specifika veckor:
> 
> - Rafael: Premiumstädning levereras ~v.18 (början av maj)
> - Zivar: Språk-picker i profil ~v.19
> - Nya features med prioritet kan diskuteras — ring mig direkt.
> 
> Efter juli är Spick redo att skala, och då har vi bättre verktyg för er."

Det räcker. Transparent, realistiskt, engagerande.

---

## Del 10: Avbrottsplan

Om planen stannar av (sjukdom, familj, annat):

**Om paus 1-2 veckor:**
Inget händer. Plan fortsätter där vi slutade.

**Om paus 3-5 veckor:**
Verifiera att prod fortfarande fungerar. Uppdatera plan — troligen 2 veckor sen.

**Om paus > 5 veckor:**
Revidera hela plan. Möjligen Alternativ C (minimal refactor) istället för full B.

**Om Rafael eller Zivar hoppar av:**
Inte katastrof. Fortsätt plan. Deras feedback fortsätter styra, men refactor är inte beroende av dem.

**Om kritisk produktion-incident:**
Pausa refactor. Fixa incident. Återuppta plan. Dokumentera lärdom.

---

## Del 11: Vad som INTE ingår

Medvetna avgränsningar:

- Mobilapp-byggsnation
- Multi-stad geo
- ML/AI-matchning
- Multi-currency
- Offentlig API för tredjeparter
- Whitelabel
- Marketplace-affiliate (andra plattformar)

Dessa är roadmap för Q1-Q2 2027, inte denna plan.

---

## Del 12: Första konkreta steget — denna helg eller måndag

**Stoppa idag:** Nej. Planen börjar måndag.

**Denna helg:**
- Zivar-mötet kl 12:30 söndag (huvudfokus)
- Lördag eftermiddag + söndag efter mötet: vila eller planera
- Söndag kväll: Läs denna plan en gång till. Justera vid behov.

**Måndag morgon (vecka 1):**
- Öppna denna fil
- Starta Fas 0: Säkerhet & stabilitet
- Första uppgift: RLS-full-audit (2-3h med Claude Code)

**Första veckan** sätter tonen. Håll tempot realistiskt.

---

## Del 13: Regel #27 — ärliga begränsningar

Denna plan är min bästa uppskattning baserad på:

- Dagens 29 identifierade problem
- 78 tabeller verifierade
- Spicks nuvarande skala (2 firmor, ~3 testkunder)
- Din tidsbudget (5-10h/vecka)
- Ambitionsnivå Q3 → Q4 2026

**Det jag INTE vet säkert:**

- Hur Claude Code presterar under 10-14 veckor av fokuserat arbete
- Om fler bugg-nät avslöjas under refactor
- Om Stripe/Supabase gör plattformsändringar som tvingar omprioritering
- Om Rafael eller Zivar kräver akuta features som pausar plan
- Om du hittar lösningar som är bättre än vad jag föreslår

**Planen är en karta, inte en kontrakt.** Den ska revideras månadsvis baserat på faktiskt framsteg.

---

## Del 14: Dokumentets historik

| Datum | Version | Ändring | Författare |
|-------|---------|---------|-----------|
| 2026-04-18 | v1.0 | Första utkast (strangler fig pattern) | Farhad + Claude |
| 2026-04-18 | v2.0 | Hybrid refactor, 10-14 veckor, målbild 30 firmor | Farhad + Claude |

---

## Del 15: Nästa revideringsdatum

**Månadsvis review:** 18 maj 2026, 18 juni 2026, 18 juli 2026.

Vid varje review:
- Jämför framsteg vs plan
- Uppdatera riskregister
- Justera tidsbudget vid behov
- Dokumentera nya fynd i backlog

---

*Slut på plan. Lycka till, Farhad. Du har en riktning nu.*
