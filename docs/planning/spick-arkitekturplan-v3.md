# Spick Arkitekturplan v3 — Skalbar till 1000+ städare

**Version:** 3.1
**Författare:** Farhad + Claude
**Datum:** 20 april 2026
**Status:** Aktiv plan (ersätter v2)
**Mål:** 1000+ städare, 1500+ bokningar/månad, nästan självgående drift
**EU-deadline:** 2 december 2026 (Platform Directive) — icke-förhandlingsbar
**GA-kandidat:** 1 november 2026
**Strategi:** Audit-driven prioritering. Refactor parallellt med minimal feature-utveckling.
**Tidsbudget:** 10-12h/vecka, 20-25 veckor totalt (~201-348h)
**Primärkälla:** [`docs/audits/2026-04-20-scalability-audit.md`](../audits/2026-04-20-scalability-audit.md) (commit `72d082f`)

---

## Sammanfattning (5 minuter)

Skalbarhetsauditen 20 april 2026 identifierade åtta konkreta flaskhalsar mellan nuvarande system och 1000+ städare. v3 adresserar dem i strikt prioritetsordning baserat på auditens fynd — inte på teoretisk struktur.

**De tre mest kritiska fynden:**

1. **Money-layer är fragmenterat.** Commission hardcodad på fyra ställen (`stripe-checkout:88`, `stripe-connect:172`, `js/commission.js`, `bli-stadare.html:511`). `admin.html:markPaid()` PATCH:ar bara `payout_status` utan att gå via Stripe. Silent drift när platform_settings ändras.

2. **Matchnings-RPC är utanför migrations-kedjan.** `find_nearby_cleaners` ligger i `sql/` istället för `supabase/migrations/`. Blockerar CI/CD, lokal utveckling och disaster recovery. Plus: sorteringen är endimensionell (distance + rating NULLS LAST) → cold-start-problem, nya städare får aldrig jobb.

3. **Dispute/escrow saknas helt.** 0 EFs, 0 tabeller. Alla klagomål går via e-post → manuell bedömning. Blockerar EU-compliance, B2B-försäljning och försäkring.

**Vad v3 gör annorlunda än v2:**

- Auditen dikterar prioritetsordning, inte teoretisk struktur.
- Fas 1 är **Money-layer**, inte Services-tabell (v2:s Fas 1 är 40% klar och flyttas till Fas 4).
- Fas 2 är **Migrations-sanering** — blockerar allt annat.
- Fas 5 är **Kundretention/Recurring** — prioriterat tidigt eftersom många befintliga kunder är återkommande.
- Fas 6 är **Event-system** (flyttat upp eftersom Dispute behöver audit-trail).
- Fas 8 är **Dispute + Full Escrow** (60-80h refactor till separate-charges-and-transfers).
- Lägger till Fas 9 (VD-autonomi), Fas 10 (Observability), Fas 13 (GA-readiness), Fas 14 (Systemic Robustness).
- Tar bort "Supply-automation"-fas — Stripe Connect-onboarding är redan skalbart tack vare Sprint B.

**Efter v3:** Spick hanterar 1000+ städare med admin-intervention 2-4h/vecka. Money-layer har audit-trail. Dispute-process strukturerad med full escrow. Matchning multivariat. Ny tjänst = 1 INSERT. Nytt språk = 1 INSERT. Recurring-kunder stödda från dag 1. Ny regulation (t.ex. RUT-ändring) = 1 uppdatering av platform_settings.

---

## Del 1 — Var vi står (verifierad 20 april 2026)

### Det som är klart (Fas 0 från v2)

- **Säkerhet & stabilitet:** RLS-audit klar, qual=true-policies stängda där möjligt, admin-policies dokumenterade. Wizard-dublett städad. Bonusbugg cleaner_email fixad. Admin schedule-editor migrerad till v2-tabell. Dag-numreringsbugg fix. VD-hemadress krav i Wizard.
- **Infrastruktur:** 66 Edge Functions, 89 migrations, 34 GitHub Actions workflows. 78 DB-tabeller med PostGIS.
- **Stripe Connect-onboarding:** Fullt auto via `stripe-connect-webhook` + `poll-stripe-onboarding-status` cron. Skalbar till 1000+ städare enligt audit.
- **Self-service företagsregistrering:** bli-foretag.html + registrera-foretag.html + company-self-signup EF live sedan Sprint B (19 april).
- **Team-invitations:** company-invite-member + accept-team-invitation live via SMS. join-team.html + foretag-dashboard.html live.
- **Admin pending-queue:** admin-approve-company + admin-reject-company live.
- **RUT-ombud:** Godkänd av Skatteverket 13 april. generate-self-invoice + serve-invoice + self_invoices-tabell live.
- **Auto-delegation:** 3 EFs live med SLA-timers (vd_nudge_1h, vd_timeout_2h, customer_nudge_30m, customer_timeout_1h).
- **Juridik:** integritetspolicy, kundvillkor, uppdragsavtal, ångerrätt-checkbox. Bifirma godkänd Bolagsverket 2 april. Momsregistrerat (25%).

### Delvis klart (Fas 1 från v2)

- **Services-tabell:** `services` + `service_addons` tabeller finns med `ui_config`-kolumn. `services-list` EF live. `services-loader.js` live. `boka.html` DB-driven. **Kvar:** tjanster.html, priser.html, foretag.html, admin.html service-referenser, stadare-dashboard.html, i18n-filer, blogg-artiklar, 20+ stads-sidor.

### Klart utanför v2-planen

- **Sprint B (Onboarding-infrastruktur):** VD kan registrera företag självt, bjuda in team, admin godkänner via queue. Stripe Connect auto-polling fungerar. Bug-fix: companies.stripe_account_id-sync.
- **Fas 1.1 (Cleaners PII-lockdown):** v_cleaners_public vy skapad (25 kolumner, filter `is_approved=true`). 4 av 8 frontend-filer migrerade. **Kvar:** 4 filer + REVOKE anon på cleaners + DROP gamla anon-policies.
- **Fas 1.2 (Unified Identity Architecture):** Dag 1-4 klart. customers-tabell droppad, PKCE-fix, public-auth-exchange, magic-sms.

### Kritiska problem som auditen identifierade

Dessa adresseras direkt i v3-faserna nedan:

- Money-layer: payout fake, commission fragmenterat (Fas 1)
- Migrations-drift: SQL i `sql/`, ej i `migrations/` (Fas 2)
- Matchning: endimensionell sortering, cold-start-problem (Fas 3)
- Services: ~50 filer med hardcoded strings (Fas 4)
- Retention: recurring-kunder delvis stödda, behöver full matris (Fas 5)
- Event-system: bara `booking_created` loggas (Fas 6)
- Languages: hardcoded överallt (Fas 7)
- Dispute/escrow: 0 infrastruktur (Fas 8)
- VD-autonomi: många admin-beroenden (Fas 9)
- Observability: inga proaktiva alerts (Fas 10)
- CLAUDE.md-drift: 15 vs 66 EFs i dokumentation (Fas 11)
- Systemic skuld: error-bus, rate limiting, shared types, state machine, cache, secret rotation (Fas 14)

---

## Del 2 — Strategiska principer

### Princip 1: Audit är primärkälla

Alla prioriteringar i v3 härleds från [`2026-04-20-scalability-audit.md`](../audits/2026-04-20-scalability-audit.md). Avvikelser från auditens ordning motiveras explicit i fas-introduktionen.

### Princip 2: Regel #26, #27, #28, #29 är obligatoriska

- **#26** Verifiera med grep + användarflöde + alla användartyper + inga hardkodade värden + data-audit mot backups.
- **#27** Verifiera mot primärkälla innan bygge baserat på "saknas" eller "finns inte".
- **#28** Ingen business-data-fragmentering. Värde på 2+ ställen → centralisera till DB först.
- **#29** Memory är hypoteser. Primärkälla för plan-status är detta dokument + auditen + kodbasen.

### Princip 3: Inget rivs utan ersättare

Gammal kod eller tabell bevaras tills ny är verifierad i produktion i 30 dagar. Ingen big-bang-migration. Parallell skrivning + validering innan rivning.

### Princip 4: Hybrid-tempo

10-12h/vecka. Ingen feature-frys. Rafael och Zivar prioriteras vid support. Små features (t.ex. språk-visning) får skeppas. Stora features pausas till efter respektive fas.

### Princip 5: Bygg för 1000+ städare, optimera när data finns

Arkitekturen designas för skala (indexerade queries, materialized views om behov, event-driven). Men komplicerade algoritmer (ML-matchning, team-optimering) byggs först när verklig data finns att kalibrera mot. Hellre enkel algoritm som fungerar vid 100 städare än avancerad algoritm utan data.

### Princip 6: EU-deadline är icke-förhandlingsbar

2 december 2026 måste Spick vara compliant med Platform Work Directive. Det kräver: strukturerad dispute-process, audit-trail, transparent data-rätt för städare. Fas 8 (Dispute + Full Escrow) är absolut deadline.

### Princip 7: Feature flags för riskfyllda flöden

Money-layer, matchning och dispute skyddas bakom feature flags i `platform_settings`. Om något går fel → slå av flaggan → gammalt flöde återtar. Ingen hårdkopplad migration.

### Princip 8: Dependencies respekteras

Varje fas har explicit `Dependencies`-sektion. Fas får inte startas innan dependencies är klara (såvida inte parallellt arbete uttryckligen tillåts).

---

## Del 3 — Planen fas för fas

### Fas 0 — KLAR ✅ (säkerhet & stabilitet, vecka 1)

Slutförd 18-19 april 2026. Se v2-planen för detaljer.

---

### Fas 1 — Money Layer (vecka 2-5, 30-50h)

**Motivation:** Audit-prioritet 🔴 1. Money-fragmentering är produktion-nivå risk. Silent drift när platform_settings eller Smart Trappstege aktiveras. `admin.html:markPaid()` har ingen idempotency och rör inte Stripe.

**Mål:** En central `_shared/money.ts` är enda vägen för commission-lookup, payout-beräkning, RUT-split och transfer. Ingen hardcodad procent finns i kod.

**Uppgifter:**

- **1.1** Skapa `_shared/money.ts` med funktioner: `getCommission(context)`, `calculatePayout(booking)`, `calculateRutSplit(amount, eligible)`, `triggerStripeTransfer(booking)`. Alla läser från `platform_settings`.
- **1.2** Migrera `stripe-checkout:88` hardcoded `0.12`/`0.17` → `money.getCommission({customer_type, company_id})`.
  > **SUPERSEDED 2026-04-20:** Verifiering visade 0 invocations senaste 20 dgr + 0 callers. stripe-checkout raderad. booking-create:604 bär betalningen och använder redan platform_settings.commission_standard.
- **1.3** Migrera `stripe-connect:172` hardcoded `0.83` → beräkning via `money.calculatePayout()`.
- **1.4** Fixa `admin.html:markPaid()` att gå via ny EF `mark-payout-paid` som: (a) kontrollerar idempotency, (b) verifierar Stripe Transfer existerar, (c) sätter payout_status + payout_date. Ingen direkt PATCH mot DB.
- **1.5** Skapa reconciliation-cron `payout-reconciliation` som dagligen: hämtar Stripe Transfer events, matchar mot `bookings.payout_status`, flaggar mismatch i `payout_audit_log`.
- **1.6** Integration-test i Stripe test mode: full booking → checkout → transfer → payout → verify amounts i båda konton. Ingår i CI.
- **1.7** Analysera `js/commission.js` Smart Trappstege. Om aktiv: integrera i `money.ts`. Om inaktiv: arkivera i `docs/archive/`. Ingen mellanstat.
- **1.8** Migrera hardcoded hourly-priser (349, 350, 399) i admin.html, bli-stadare.html, join-team.html → `platform_settings.default_hourly_rate`.
- **1.9** Migrera `faktura.html` fallback `commission_pct || 17` → `money.getCommission()`.
- **1.10** Dokumentera money-layer i `docs/architecture/money-layer.md`. Inkludera: hierarki, fallback-regler, event-flöde, reconciliation-process.

**Leverabler:**
- `_shared/money.ts` (ny, central)
- `mark-payout-paid` EF (ny)
- `payout-reconciliation` cron (ny)
- `payout_audit_log` tabell (ny migration)
- Integration-tester för money-path
- Dokumentation `docs/architecture/money-layer.md`
- 10+ kod-commits som eliminerar hardcoded commission

**Skalnings-impact:** Låser upp prissättnings-flexibilitet (regional pris, Smart Trappstege, per-företag commission) utan silent drift. Skyddar Spick från bokförings-fel vid 100+ städare. Förbereder för full escrow (Fas 8) som kräver separate-charges-and-transfers.

**Dependencies:** Ingen. Kan startas omedelbart.

---

### Fas 2 — Migrations-sanering (vecka 6, 8-12h)

**Motivation:** Audit-prioritet 🔴 3 men flyttad upp eftersom den blockerar Fas 3 (matchning behöver `find_nearby_cleaners` i migrations) och alla framtida refaktoreringar.

**Mål:** Prod-DB kan reproduceras deterministiskt från `supabase/migrations/`. Inga SQL-objekt i `sql/` eller ad-hoc-skript.

**Uppgifter:**

- **2.1** Kör `pg_dump --schema-only` mot prod. Jämför med `migrations/` output. Lista skillnader.
- **2.2** Skapa migration-fil för `find_nearby_cleaners` (flytta från `sql/radius-model.sql`).
- **2.3** Skapa migration-fil för `v_available_jobs_with_match` + `jobs`-tabell (från audit 2026-04-19-nytt-jobb-matchar-bugg).
- **2.4** Skapa migration-filer för odokumenterade prod-policies (hello@spick.se-policy, admin-UPDATE för cleaners, `Company owner reads team bookings`).
- **2.5** Flytta alla övriga SQL från `sql/` till migrations eller arkivera. Prioritet: `companies-and-teams.sql`, `p0-waitlist.sql`, `approval-and-booking-response.sql`, `cleaner-applications-geo.sql`.
- **2.6** Rensa `.claude/worktrees/wonderful-euler/`. Merga eller radera branch `claude/wonderful-euler`.
- **2.7** Arkivera fix-skripten (`fix-b2b-foretag.js`, `fix-b2b-services.js`, `fix-leak.js`, `fix-leak2.js`, `fix-multi3.js`, `fix-multi4.js`, `fix-multiflow.js`, `fix-multiservice.js`). Kör inventering: aktiv eller död? Död → `docs/archive/fix-scripts/`.
  > **Not 2026-04-22:** Faktiskt scope var 19 fix-skript, inte 8. Alla K1-klassade (0 callers, 0 workflows, hårdkodade Windows-paths omöjliga att exekvera utanför ursprunglig dator). Raderade 2026-04-22 (se `git log --diff-filter=D -- 'fix-*.js'`). git log återskapar vid behov.
- **2.8** CI-workflow: veckovis kör `pg_dump --schema-only` och flagga diff mot migrations via PR.
- **2.9** Uppdatera `docs/7-ARKITEKTUR-SANNING.md` med aktuell sanning.

**Leverabler:**
- 3-6 nya migration-filer (beroende på diff-resultat)
- `docs/archive/fix-scripts/` med beslut per skript
- CI-workflow `schema-drift-check.yml`
- Ren `sql/`-mapp (bara aktiva drafts)

**Skalnings-impact:** Alla framtida refaktoreringar säkra. Lokal utveckling möjlig. Disaster recovery fungerar. Ny utvecklare onboardas på timmar istället för dagar.

**Dependencies:** Ingen direkt, men MÅSTE vara klar innan Fas 3.

---

### Fas 3 — Matchning med multivariat ranking (vecka 7-9, 16-24h)

**Motivation:** Audit-prioritet 🔴 2. Cold-start-problemet är dödligt — nya städare får aldrig jobb → aldrig reviews → permanent längst ner. Vid 100+ städare i samma stad blir nuvarande distance-sortering meningslös.

**Mål:** `find_nearby_cleaners` returnerar multivariat ranking-score. Nya städare får exploration-boost under 30 dagar. Kund-preferenser påverkar resultatet.

**Uppgifter:**

- **3.1** Design-dokument `docs/architecture/matching-algorithm.md`. Inkludera: formel, vikter, cold-start-strategi, edge cases, A/B-test-plan.
- **3.2** Uppdatera `find_nearby_cleaners` (nu i migrations efter Fas 2) med `match_score`-kolumn. Returnera sorterat på `match_score DESC`.
- **3.3** Implementera vikter:
  - `distance_score` (40%): `1 - min(distance_km, max_radius) / max_radius`
  - `rating_score` (20%): Bayesian smoothing `(C×m + Σratings) / (C + n)` där C=10, m=4.5
  - `completed_jobs_score` (15%): `min(completed_jobs, 50) / 50`
  - `preference_match_score` (10%): boolean-match mot kundens `preferences` JSONB (hund, katt, barn, trappor, etc.)
  - `verified_score` (10%): `is_approved + identity_verified + has_fskatt`
  - `exploration_bonus` (5%): `max(0, 1 - days_since_approval / 30)` — boost första 30 dagarna
- **3.4** Kund-historik-boost: om kund bokat denna städare tidigare med betyg ≥4, addera +10% till score.
- **3.5** Uppdatera `boka.html` att läsa från ny vy `v_matched_cleaners_for_booking` istället för RPC direkt. Frontend sorterar inte längre själv.
- **3.6** Om query-tid > 200ms vid 500+ städare: inför materialized view `mv_cleaner_scores` med refresh-cron varje 15 min.
- **3.7** A/B-test-ramverk: flagga `matching_algorithm_version` i `platform_settings`. Spara `chosen_cleaner_match_score` per bokning för analys.
- **3.8** Dashboard i admin: "Top/Bottom 10 städare per match_score", cold-start-monitor.
- **3.9** Analys efter 30 dagars pilot: justera vikter baserat på acceptance-rate och rating-utfall.

**Leverabler:**
- `docs/architecture/matching-algorithm.md`
- Ny version av `find_nearby_cleaners` i migrations
- `v_matched_cleaners_for_booking` vy
- `mv_cleaner_scores` materialized view (om behövs)
- A/B-test-metadata i bookings
- Admin-dashboard för match-score

**Skalnings-impact:** Plattformen kan hantera 100+ städare per stad utan kollaps. Cold-start-problemet löst. Företagstillväxt möjlig utan att nya städare droppar ut.

**Dependencies:** Fas 2 (RPC måste vara i migrations).

---

### Fas 4 — Services-tabell genomgående (vecka 10-11, 8-16h)

**Motivation:** Audit-prioritet 🟡 5. Färdigställande av v2 Fas 1 (40% klar). Lågt-hängande frukt — DB-strukturen finns, bara frontend-migration kvar.

**Mål:** Ingen hardcoded tjänst-lista någonstans. Ny tjänst = 1 INSERT i services-tabellen.

**Uppgifter:**

- **4.1** Migrera `tjanster.html` till services-loader.
- **4.2** Migrera `priser.html` till services-loader.
- **4.3** Migrera `foretag.html` till services-loader.
- **4.4** Migrera `admin.html` service-referenser (15 träffar) till DB-lookup.
- **4.5** Migrera `stadare-dashboard.html` till services-loader (34 träffar — största jobbet).
- **4.6** Flytta service-strings från `js/i18n-bli-stadare.js` till DB-översättningar (ny kolumn `services.translations JSONB`).
- **4.7** Migrera Edge Functions som har service-referenser i e-postmallar: auto-remind, generate-receipt, notify. Lookup via services-list EF.
- **4.8** Stads-landningssidor och blogg: lämna som statiska SEO-texter men flagga för framtida CMS.
- **4.9** Lägg till Rafaels Premiumstädning via INSERT (första beviset att refactor lönar sig).
- **4.10** Ta bort/arkivera `fix-b2b-services.js`, `fix-multiservice.js` (engångsskript).
  > **Not 2026-04-22:** Superseded av §2.7 cleanup (2026-04-22). Båda skripten ingick i den gemensamma raderingen av 19 fix-skript.

**Leverabler:**
- 10+ frontend-filer migrerade
- `services.translations` JSONB-kolumn
- Premiumstädning live utan kodändring
- Dokumentation "Så lägger du till en ny tjänst" (1-INSERT-process)

**Skalnings-impact:** Ny tjänst på 30 sekunder istället för 8-16h per tjänst idag.

**Dependencies:** Ingen (services-tabell finns redan).

---

### Fas 5 — Kundretention + Recurring bookings (vecka 12-13, 10-15h)

**Motivation:** Flyttat upp från sent i v3. Många befintliga kunder är redan återkommande — måste stödjas strukturerat så fort som möjligt. 60% av städning är recurring. Utan retention-system förloras långsiktigt LTV.

**Mål:** Recurring bookings med full flexibilitet. Customer preferences kommer ihågs och återanvänds.

**Uppgifter:**

- **5.1** Inventera befintlig `subscriptions`-tabell. Jämför med kravlista nedan. Utöka istället för att skapa ny.
- **5.2** Utöka för full recurring-matris:
  - Dagar (mån-sön multi-select)
  - Frekvens (varje vecka, varannan, var 3:e, var 4:e, månadsvis på dag N, månadsvis på vecka-X-dag)
  - Längd (slutdatum / X gånger / tillsvidare)
  - Samma-städare-preferens (cleaner_id eller "vem som helst från företag X")
  - Betalningsmodell (per tillfälle / månadsvis i förskott / helt förskott)
- **5.3** Cron `generate-recurring-bookings` genererar bokningar 4 veckor i förväg (rullande horisont).
- **5.4** Kund kan: pausa serie, hoppa över enskilt tillfälle, ändra tid för ett enskilt tillfälle, säga upp helt.
- **5.5** `customer_preferences`-tabell: favorit-städare, standard-preferenser (hund/katt/barn/trappor), notes till städare, budget-range.
- **5.6** "Boka samma som sist"-knapp på min-bokning.html (hämtar senaste bokningens parametrar).
- **5.7** "Boka samma städare igen" på bokningsbekräftelse.
- **5.8** Preference-learning: efter 3 bokningar, föreslå recurring baserat på mönster (samma dag-tid-städare).
- **5.9** Email-nudges: 7 dagar efter första bokning → "Ska vi lägga in detta varje vecka?"
- **5.10** Pris-binding vid recurring-start: lås pris för hela serien (skyddar mot pris-höjningar mid-serie).
- **5.11** Helgdag-hantering: auto-skip eller auto-flytta till närmaste vardag? Flagga i serien.
- **5.12** RUT-kvotsplitting över årsskifte: varje bokning räknar mot rätt år.

**Leverabler:**
- Utökad `subscriptions`-tabell
- `customer_preferences`-tabell
- `generate-recurring-bookings` cron-EF
- Kund-UI för paus/skip/avsluta
- "Boka igen"-flöden
- Email-nudges för retention
- Pris-binding mekanism

**Skalnings-impact:** LTV per kund ökar ~2-3x. Stabilare revenue-stream. Rafaels och Zivars befintliga återkommande kunder hanteras strukturerat.

**Dependencies:** Fas 1 (money-layer hanterar recurring-betalningar), Fas 3 (matchning respekterar preferenser).

**Viktig nyans för Fas 8:** Recurring-serie interagerar med escrow-flödet. Varje enskild bokning i serien har egen escrow-hold. Dispute på en bokning påverkar inte övriga i serien. Detta måste hanteras i Fas 8-designen.

---

### Fas 6 — Event-system (vecka 14, 10-15h)

**Motivation:** v2 Fas 4 flyttat upp. Bara `booking_created` loggas idag. **Blockerar Fas 8 (Dispute behöver event-audit-trail)** och Fas 10 (Observability).

**Mål:** 10+ event-types fångas i strukturerad `booking_events`-tabell. Event-timeline i admin + VD-dashboard + kund-facing.

**Uppgifter:**

- **6.1** Utöka `booking_events`-tabell (finns, per memory) med alla event-types: cleaner_assigned, cleaner_reassigned, payment_received, payment_captured, checkin, checkout, completed, cancelled_by_customer, cancelled_by_cleaner, refund_issued, dispute_opened, dispute_resolved, review_submitted, recurring_generated, recurring_skipped.
- **6.2** `_shared/events.ts` helper — varje EF måste logga via denna (Regel #28: en källa).
- **6.3** Retrofit alla befintliga EFs att logga sina events: booking-create, auto-delegate, cleaner-booking-response, stripe-webhook, noshow-refund, auto-remind, etc.
- **6.4** Event-timeline-komponent i admin.html och foretag-dashboard.html.
- **6.5** Min-bokning.html visar kund-relevanta events (transparens + förtroende).
- **6.6** Stadare-dashboard.html visar städar-relevanta events.
- **6.7** Event-schema dokumenterat i `docs/architecture/event-schema.md`.
- **6.8** Retention-integration: recurring_generated och recurring_skipped events från Fas 5 loggas här.

**Leverabler:**
- 15+ event-types strukturerat loggade
- `_shared/events.ts` helper
- Event-timeline UI (3 vyer: admin, VD, kund, städare)
- Dokumentation över event-schema

**Skalnings-impact:** Grund för observability (Fas 10) och dispute-audit-trail (Fas 8). Farhad kan svara på "vad hände med bokning X?" på 10 sekunder.

**Dependencies:** Fas 5 (recurring events ingår).

---

### Fas 7 — Languages + språkpicker (vecka 15, 5-8h)

**Motivation:** Audit flaggar som fragmenterat. Zivars team (uzbekiska) kan inte markeras i strukturerad form idag. Liten fas, oberoende — passar mellan större faser.

**Mål:** Centraliserad `languages`-tabell. Språk används i matchning (Fas 3 kan uppdateras efteråt att lägga till språk-match).

**Uppgifter:**

- **7.1** `languages`-tabell med 37 språk (ISO 639-1).
- **7.2** `cleaner_languages`-länktabell (många-till-många).
- **7.3** Migrera befintliga språk-strings till tabell.
- **7.4** Uppdatera cleaner-profil med språkpicker-UI.
- **7.5** Uppdatera `bli-stadare.html` + `join-team.html` med språk-val.
- **7.6** GIN-index på language_codes för snabb filtrering.
- **7.7** Extend `find_nearby_cleaners` med valfri `p_languages` array-parameter.

**Leverabler:**
- `languages`-tabell + `cleaner_languages` många-till-många
- UI i 3-4 frontend-filer
- Språk-match som valfri matchning-kriterium

**Skalnings-impact:** Zivar kan markera uzbekiska. Internationella städare kan synas för rätt kunder. Låg omedelbar impact, men förbereder för språk-baserad matchning.

**Dependencies:** Ingen.

---

### Fas 7.5 — RUT-infrastruktur (vecka TBD, 25-35h)

**Motivation:** Skjuten hit från original-tänkt Fas 2.5 efter Spår B-audit 2026-04-23 (se [docs/audits/2026-04-23-rut-infrastructure-decision.md](../audits/2026-04-23-rut-infrastructure-decision.md)). 5 systemiska 🔴-risker: kolumnmismatch (`rut_application_status` vs `rut_claim_status` vs spökkolumn), fel XML-matematik (hårdkodat 70 % arbetskostnad, ingen 75 000 kr-tak-check), saknad timing-guard (ansökan vid betalning, ej vid utfört arbete), icke-applicerad `drafts/20260325000003_rut_claims.sql`-migration, avsaknad av kreditnota-flöde vid refund.

**Minifix 2026-04-23 (§2.5):** trigger avaktiverad i stripe-webhook, EF arkiverad till [docs/archive/edge-functions/rut-claim/](../archive/edge-functions/rut-claim/), undeploy verifierad. Ingen ekonomisk exponering idag (`SKV_API_KEY` tom + 0 historiska PNR). Full refaktor sker i denna fas.

**Mål:** RUT-ansökan fungerar regel-korrekt, auditbar, idempotent. Kund ser komplett faktura som uppfyller bokföringslag. Refund triggar kreditnota automatiskt. 31 januari-deadline bevakas av cron.

**Sub-faser (grovskiss — detaljer när fasen startar):**

- **7.5.1** Research + prod-verifiering: `SKV_API_KEY`-status, Skatteverkets API-spec 2026, räkna spökrader (`rut_application_status='pending'`), PNR-flöde-karta i boka.html.
- **7.5.2** Kolumn-konsolidering: välj kanonisk kolumn (`rut_claim_status`), backfill + DROP `rut_application_status` (hygien-task #17). Beslut + exekvering på `drafts/20260325000003_rut_claims.sql` (hygien-task #18).
- **7.5.3** Timing-guard + admin-godkänd kö: flytta trigger från `stripe-webhook` till cron som körs ≥24 h efter `completed_at`. Admin-godkänner första kvartalet (alt B från F2.5-2).
- **7.5.4** XML-matematik + takcheck: refaktor `buildRutXml` med korrekt arbetskostnad (100 % för städtjänster, uppdelning vid material) + 75 000 kr/år-tak per kund.
- **7.5.5** Persistent kundfaktura-infrastruktur: ny `customer_invoices`-tabell (sekventiell nr, snapshot, immutable), moms-rad, automatisk kreditnota vid refund, `rut-reverse`-EF för återkallelse hos Skatteverket.
- **7.5.6** Årsskifte-vakt + återaktivering: `rut-deadline-check`-cron (dec/jan-vakt), återaktivera rut-claim-EF från arkivet med ny kod, åter-deploya. Sätt verkligt `SKV_API_KEY`-värde.

**Leverabler:**

- Refaktorerad `rut-claim`-EF (återaktiverad från arkiv)
- Ny `customer_invoices`-tabell + `generate-customer-invoice`-EF
- `rut-reverse`-EF
- `rut-deadline-check`-cron
- Kolumn-konsolidering-migration
- Uppdaterad `faktura.html` med moms-rad + sekventiell nr

**Dependencies:** Ingen. Kan startas när som helst efter 2026-04-23. Blockerar ingen feature-fas direkt, men **Rafa-pilot får inte skalas** (eller `SKV_API_KEY` sättas till verkligt värde) förrän §7.5 är klar.

**Primärkälla vid start:** [docs/audits/2026-04-23-rut-infrastructure-decision.md](../audits/2026-04-23-rut-infrastructure-decision.md).

---

### Fas 8 — Dispute + Full Escrow (vecka 16-21, 60-80h)

**Motivation:** Audit-prioritet 🟡 4 men absolut EU-deadline 2 dec 2026. Blockerar B2B-försäljning och ansvarsförsäkring. R4 i auditen: kräver design-dokument först.

**Beslut:** **Full escrow via separate-charges-and-transfers** (Farhads val 20 april). Bättre differentiator mot konkurrens och mer rent juridiskt. 60-80h istället för 40-60h för soft escrow via reversals.

**Mål:** Kundpengar hålls hos Stripe tills kunden attesterat (eller 24h auto-release efter städning). Dispute-process strukturerad. Full audit-trail.

**Arkitektur-övergång:** Spick byter från Stripe Connect "destination charges" (pengarna går direkt till städaren) till "separate charges and transfers" (pengarna stannar hos Stripe plattformskonto tills transfer). Detta är refactor av booking-create + stripe-webhook + alla refund-ställen. Större arbete men tekniskt korrekt modell.

**Uppgifter:**

- **8.1** Design-dokument `docs/architecture/dispute-escrow-system.md`. Inkludera: state-machine, Stripe-interaktion, SLA-timers, evidence-hantering, EU Platform Directive mapping, interaktion med recurring-bokningar (Fas 5).
- **8.2** Stripe Connect refactor: `booking-create` ändras från destination charges till separate charges. Pengarna går till Spicks plattformskonto.
- **8.3** Ny state: `escrow_state text` på bookings. Tillåtna värden: `pending_payment`, `paid_held`, `awaiting_attest`, `released`, `disputed`, `resolved_full_refund`, `resolved_partial_refund`, `resolved_dismissed`, `refunded`, `cancelled`. Strikt state-machine (se R1 nedan).
- **8.4** Tabeller:
  - `escrow_events` (alla state-transitioner)
  - `disputes` (en per bokning)
  - `dispute_evidence` (foto-bevis från kund + städare)
  - `attested_jobs` (formell markering från kund)
- **8.5** Storage-bucket `dispute-evidence` med RLS: kund uppladdar till `/customer/`, städare till `/cleaner/`, admin läser båda. Max 5 MB per foto, max 5 foton per part.
- **8.6** `escrow-state-transition` EF (enda som får ändra `escrow_state`). Validerar tillåtna övergångar, loggar i `escrow_events`.
- **8.7** `escrow-release` EF. Triggas när kund godkänner ELLER 24h timer går ut. Kallar `stripe.transfers.create` för 88% till cleaner.
- **8.8** `dispute-open` EF. Validerar, skapar dispute, kräver minst 1 foto, notifierar städare + admin.
- **8.9** `dispute-cleaner-respond` EF. Städare har 48h att svara med egen evidence.
- **8.10** `dispute-admin-decide` EF. Beslut: full_refund / partial_refund / dismissed. Hanterar Stripe refund + transfer enligt beslut.
- **8.11** Unified `refund-booking` EF. Ersätter 6 befintliga refund-ställen. Hanterar alla refund-scenarier konsekvent.
- **8.12** Cron `escrow-auto-release` (var 15 min). Auto-release efter 24h.
- **8.13** Cron `escrow-sla-check` (dagligen). Påminner parter vid 24h/48h, eskalerar till admin vid 72h utan svar.
- **8.14** Frontend: attest-UI på min-bokning.html (godkänn/invänd-knappar, 24h timer synlig).
- **8.15** Frontend: dispute-form med foto-upload (min-bokning.html).
- **8.16** Frontend: städar-dispute-response-UI (stadare-dashboard.html).
- **8.17** Frontend: admin dispute-queue i admin.html (aktiva disputes, SLA-räknare, filter).
- **8.18** Migration av befintliga bokningar: pågående → `paid_held_legacy`, klara → `released_legacy`. Legacy-mode kör klart i gamla flödet, nya bokningar kör nya flödet.
- **8.19** Rollback-plan per dag dokumenterad.
- **8.20** EU Platform Directive compliance-mapping: audit-log för alla dispute-events, data-exporträtt för städare.
- **8.21** Uppdatera `garanti.html` + `nojdhetsgaranti.html` med formell process (ersätt "skriv till hello@spick.se").
- **8.22** Migrera alla 6 befintliga refund-ställen till `refund-booking`: booking-auto-timeout, auto-remind, booking-reassign, booking-cancel-v2, noshow-refund, stripe-refund.
- **8.23** Klarna chargeback-handler: `charge.dispute.created` webhook → auto-move till `disputed` + admin-alert.
- **8.24** Interaktion med recurring (Fas 5): dispute på en bokning påverkar INTE övriga i serien. Dokumentera i design-dok.
- **8.25** Ansvarsförsäkringsmäklare: skicka dispute-process-dokumentation för att låsa försäkring.

**Leverabler:**
- Design-dokument (R4-krav från auditen)
- 4 nya tabeller + migrations
- 7 nya Edge Functions
- Storage bucket dispute-evidence
- 6 refund-ställen konsoliderade till unified EF
- Admin dispute-queue UI
- Kund dispute-form
- Städar dispute-response
- EU-compliance-dokumentation

**Skalnings-impact:** Möjliggör B2B-försäljning, ansvarsförsäkring, EU-compliance. Hanterar 50+ disputes/vecka utan admin-flaskhals. Differentiator mot Hemfrid och konkurrens: "Pengar frigörs först när du är nöjd."

**Dependencies:** Fas 1 (money-layer), Fas 6 (events för audit-trail). Delvis parallellt med Fas 5 (recurring måste interagera med escrow-stater).

---

### Fas 9 — VD-autonomi (vecka 22-23, 15-25h)

**Motivation:** Nytt i v3. För att skala till 100+ företag måste VD kunna hantera sitt eget team utan admin-intervention.

**Mål:** VD gör 95% av företagsoperationer själv. Admin fokuserar på systemnivå-problem.

**Uppgifter:**

- **9.1** Dashboard-widgets: pause/aktivera team-medlem (sätter `status='pausad'`).
- **9.2** Självständig dispute-hantering (tier 1) — VD kan godkänna refund upp till 500 kr utan admin.
- **9.3** Service-priser per företag UI (för `company_service_prices` — finns tabell).
- **9.4** Per-cleaner prisoverride UI (för `cleaner_service_prices`).
- **9.5** Tillgänglighets-editor för team (cleaner_availability_v2).
- **9.6** KPI-dashboard: bokningar/vecka, genomsnittlig rating, completion-rate, team-utnyttjande.
- **9.7** Bokförings-export: månatlig SIE-fil (Fortnox/Visma-kompatibel) för egna transaktioner. CSV fallback.
- **9.8** RUT-rapport per månad (för företagets bokföring).
- **9.9** Underleverantörsavtal-signatur-flöde för nya team-medlemmar.
- **9.10** VD-översikt över självfakturor genererade på företagets vägnar.

**Leverabler:**
- Fullt utbyggd foretag-dashboard.html
- SIE-export-EF
- RUT-rapport-EF
- Avtals-signatur-flöde

**Skalnings-impact:** Admin-belastning minskar från daglig till 2-4h/vecka även vid 100+ företag.

**Dependencies:** Fas 1 (money-layer), Fas 8 (dispute tier-1).

---

### Fas 10 — Observability + Auto-alerts (vecka 24-25, 20-40h)

**Motivation:** Audit-prioritet 🟡 6. Nödvändigt vid 100+ städare. Bygger på Fas 6 event-system.

**Mål:** Proaktiva alerts på business-kritiska händelser. Real-time KPI-dashboard. Ingen manuell övervakning krävs.

**Uppgifter:**

- **10.1** Centraliserad notifikations-dispatcher (`_shared/notify.ts` — utökning av befintlig `notifications.ts`).
- **10.2** Event-stream till Slack/Discord via webhook:
  - Inaktiva städare (>14d utan login)
  - 3 dåliga betyg i rad för en städare
  - Payout pending >48h
  - Webhook-fel (Stripe, BankID)
  - EF error-rate-spike (>5% failure på 1h)
  - Commission-drift (platform_settings ändrad + hardcoded värden)
  - Disputes över 48h utan svar
  - Recurring-bokningar som failat att genereras
- **10.3** Grafana/Supabase-dashboard med business-metrics:
  - Bokningar per dag
  - Revenue + commission
  - Active cleaners
  - Completion-rate
  - Average match_score
  - Dispute-rate
  - Recurring-retention-rate
- **10.4** Externt uptime-monitoring (BetterStack eller liknande) pointing på `health`-endpoint.
- **10.5** Daily morning report uppgraderad: filtrerad "intressanta events", inte rad-för-rad.
- **10.6** Alerts för avvikande data-mönster (ML-light): plötslig drop i bokningar, onormal pris-distribution.

**Leverabler:**
- Slack/Discord webhook-integration
- Grafana-dashboard
- Externt uptime-monitoring
- Filtrerad morning report
- Alert-ramverk

**Skalnings-impact:** Problem upptäcks proaktivt istället för via kund-klagomål. Admin sover lugnt.

**Dependencies:** Fas 6 (events).

---

### Fas 11 — CLAUDE.md + dokumentations-autogenerering (vecka 26, 4-8h)

**Motivation:** Audit-prioritet 🟠 7. Meta-skuld. Varje AI-session börjar med felaktig information (15 EFs vs 66 i verkligheten).

**Mål:** Dokumentation genereras från kodbasen, inte handmatad. Regel #29-drift elimineras för infrastruktur-fakta.

**Uppgifter:**

- **11.1** Script `generate-claude-md` som läser:
  - `ls supabase/functions/` → räknar EFs
  - `ls .github/workflows/` → räknar workflows
  - `ls supabase/migrations/` → senaste migration-timestamp
  - `pg_dump --schema-only | grep 'CREATE VIEW'` → räknar views
  - Per-EF första kommentar → kort beskrivning
- **11.2** CI-workflow `update-claude-md` — veckovis PR som uppdaterar CLAUDE.md.
- **11.3** Lägg till "Senast verifierad"-kolumn med datum på alla infrastruktur-claims.
- **11.4** Uppdatera `docs/7-ARKITEKTUR-SANNING.md` till att peka på auto-genererad källa.

**Leverabler:**
- `scripts/generate-claude-md.ts`
- CI-workflow för auto-uppdatering
- Handskriven dokumentation begränsad till arkitektur-beslut och affärslogik

**Skalnings-impact:** Varje framtida session startar med korrekt kontext. Onboarding av nya utvecklare snabbare.

**Dependencies:** Ingen.

---

### Fas 12 — E2E-tester + Audit-pipeline (vecka 27-28, 10-15h)

**Motivation:** v2 Fas 7-8. Krävs för tryggt utrullande av vidare förändringar.

**Mål:** Automatiserade tester fångar regression. CI flaggar hardcoded värden.

**Uppgifter:**

- **12.1** E2E-test: kund → bokning → Stripe test → tilldelning → notis → incheckning → klar → attestering → payout → faktura.
- **12.2** E2E-test: dispute-flöde end-to-end (kund → foto → städar-svar → admin-beslut → refund).
- **12.3** E2E-test: recurring-serie (kund skapar → 4 auto-genererade → pausar → återupptar).
- **12.4** Load-test: 50 samtidiga bokningar (via `k6` eller liknande).
- **12.5** CI-linter: hardcoded services, commission, hourly_rate, RUT-listor, qual=true SELECT-policies. Fail build vid upptäckt.
- **12.6** Schema-drift-check (från Fas 2) blir permanent CI.
- **12.7** Backup-restore-test en gång per månad (verifiera disaster recovery fungerar).

**Leverabler:**
- E2E test suite (Playwright eller liknande)
- Load-test suite
- CI-linters för Regel #28-efterlevnad
- Automatiserade backup-restore-tester

**Skalnings-impact:** Varje deploy tryggt. Ingen silent regression.

**Dependencies:** Fas 1-11 (allt kärnsystem måste vara klart).

---

### Fas 13 — GA-readiness + skalningstest (vecka 29, 5-10h)

**Motivation:** Slutlig validering inför 1 november GA-kandidat.

**Mål:** Systemet verifierat att klara 1000+ städare och 1500+ bokningar/månad.

**Uppgifter:**

- **13.1** Load-test: 1000 samtidiga bokningar via k6. Mät DB-query-tider, EF response-tider, Stripe rate-limits.
- **13.2** DB-index-audit: alla queries som kör >100ms vid 100k bookings → optimera.
- **13.3** Stripe Connect rate-limit-verifiering: hanterar vi Stripe test account limits?
- **13.4** GDPR-audit: data-exporträtt fungerar, radering-flöde komplett, inga PII-läckor.
- **13.5** RUT-deklaration-automation: månatlig sammanställning per kund för Skatteverket.
- **13.6** Moms-rapport-automation: månatlig moms-summa för bokföring.
- **13.7** Pentest (extern): OWASP Top 10, RLS-policies, auth-bypass.
- **13.8** Privacy policy + kundvillkor-uppdatering för EU Platform Directive.
- **13.9** GA-checklista signoff.

**Leverabler:**
- Load-test-rapport
- GDPR-audit-rapport
- Pentest-rapport
- Automatiska skatte-rapporter
- GA-signoff-dokument

**Skalnings-impact:** Officiell GA-kandidat. Redo för aggressiv tillväxt.

**Dependencies:** Fas 1-12 klara.

---

### Fas 14 — Systemic Robustness Polish (vecka 30-31, 20-30h) [VALFRI]

**Motivation:** Efter v3 Fas 0-13 är systemet 85% centraliserat. De återstående 15% är inte kritiska för GA men krävs för ett system som håller i 5+ år utan ombyggnad. Fas 14 adresserar dessa.

**Mål:** 100% centraliserat system med error-bus, rate limiting, shared types, unified state machine, cache-strategi.

**Uppgifter:**

- **14.1** Central error-bus: `error_log` tabell + `_shared/errors.ts` helper. Varje EF wrappar try/catch och loggar strukturerat. Slack-alert vid high-severity.
- **14.2** Rate limiting: middleware på EFs som kontrollerar per-IP/per-user rate. Anti-DOS. Skyddar Supabase-quota vid bot-attack.
- **14.3** Shared types mellan frontend och EFs: `types/`-paket med TypeScript-interfaces för Booking, Cleaner, Company, etc. Ingen duplikation av payload-strukturer.
- **14.4** Booking state machine konsolidering: 6 fält (`status`, `payment_status`, `payout_status`, `attest_status`, `dispute_status`, `escrow_state`) → 1 enum `booking_state`. Migration med parallell skrivning i 30 dagar, sen borttagning av gamla fält.
- **14.5** Cache-strategi: Supabase edge cache för läs-tunga queries (services-list, platform_settings). CDN för statiska assets. Redis för session-data om behövs.
- **14.6** Secret rotation automation: script som roterar Stripe webhook-secrets, 46elks API-keys, Resend API-keys. Triggas månadsvis via CI.
- **14.7** Idempotency-nycklar på alla state-ändrande EFs: booking-create, dispute-open, etc. Förhindrar double-submit och safe retries.

**Leverabler:**
- `error_log` tabell + `_shared/errors.ts`
- Rate-limit-middleware
- `types/`-paket (npm workspace eller Deno-module)
- Unified `booking_state` enum
- Cache-layer dokumentation
- Secret rotation script
- Idempotency-ramverk

**Skalnings-impact:** Systemet håller för 10-års horisont. Nästa utvecklare kan ta över utan ombyggnad.

**Dependencies:** Fas 1-13 klara. Valfri — kan skjutas till Q1 2027 om tid är knapp.

---

## Del 4 — Feature-kö under refactor

### Grönt ljus (kan skeppas under vald fas)

| Feature | Väntar på | Fas | ETA |
|---|---|---|---|
| Rafaels Premiumstädning | Services-migration | 4 | Vecka 10-11 |
| Recurring för Rafaels befintliga kunder | Retention | 5 | Vecka 12-13 |
| Zivars uzbekiska-picker | Languages-tabell | 7 | Vecka 15 |
| VD-initierad refund upp till 500 kr | Dispute tier-1 | 9 | Vecka 22-23 |
| SIE-export för bokföring | VD-autonomi | 9 | Vecka 22-23 |
| "Boka samma igen"-knapp | Retention | 5 | Vecka 12-13 |
| Slack-alerts för admin | Observability | 10 | Vecka 24-25 |

### Rött ljus (skjuts till efter v3)

- Mobilapp native iOS/Android (PWA räcker)
- Multi-stad-support (timezones, regional tax)
- ML-matchning med RL (för tidigt utan data)
- Team-optimering Hungarian Algorithm (väntar på 200+ städare)
- Multi-currency
- Whitelabel-plattform
- Offentlig API för tredjepart
- Internationalisering av backend-mallar

---

## Del 5 — Riskregister

| # | Risk | Sannolikhet | Påverkan | Mitigation |
|---|------|-------------|----------|------------|
| 1 | Fas 1 (money) orsakar betalnings-incident | Medel | Kritisk | Feature flag + integration-tester i Fas 1.6 innan prod |
| 2 | Fas 2 migrations-sanering avslöjar större drift än väntat | Hög | Medel | Avsätt 14-18h (uppåt 50% buffer) |
| 3 | Fas 8 full escrow-refactor bryter befintliga bokningar | Medel | Kritisk | Legacy-mode parallellt, bara nya bokningar på nya flödet. Se 8.18. |
| 4 | Fas 8 tar längre tid pga EU-compliance + recurring-interaktion | Hög | Hög | Starta design-dok i vecka 14, bygg tidigt. Tidsram justerbar. |
| 5 | Tid räcker inte (4-6 veckors överdrag) | Hög | Medel | EU-deadline 2 dec är lås — Fas 14 kan skjutas till 2027 |
| 6 | Claude Code introducerar buggar | Bekräftad | Medel | Regel #26/#27/#28/#29 per commit + integration-tester |
| 7 | Rafael/Zivar kräver stor feature under refactor | Medel | Medel | Kommunicera timing öppet ("efter fas X") |
| 8 | Ny regulation (RUT-ändring, EU-tillägg) tvingar omprioritering | Låg | Hög | Platform_settings möjliggör snabb regulator-anpassning efter Fas 1 |
| 9 | Stripe ändrar Connect-API | Låg | Hög | Pin SDK-version, följ Stripe changelog |
| 10 | Farhad tappar motivation vecka 15-21 (dispute är tungt) | Medel | Hög | Fira vinster: Rafaels Premium (vecka 11), Retention (13), Zivars språk (15), dispute live (21) |
| 11 | Q4 2026 konkurrent-lansering | Medel | Medel | EU-compliance + full escrow = differentiator, kör hårt |
| 12 | Matchning-algoritm ger sämre utfall än distance-only | Låg | Medel | A/B-test-ramverk i Fas 3.7 + vikterna justerbara via platform_settings |
| 13 | GDPR-audit avslöjar stora brister | Medel | Hög | Avsätt buffert i Fas 13 |
| 14 | 1000-städare-load kraschar DB | Låg | Kritisk | Load-test tidigt (Fas 13) + materialized views i Fas 3.6 |
| 15 | Migrations-fix bryter prod (Fas 2) | Låg | Kritisk | Kör mot staging först, ingen prod-ändring utan rollback-plan |
| 16 | Recurring + escrow edge case skapar double-charge | Medel | Kritisk | Integration-test täcker recurring → dispute → escrow-reversal-flöde |
| 17 | Observability-data används inte | Medel | Låg | Design dashboard med VD:s konkreta frågor som utgångspunkt |
| 18 | Fas 14 skjuts permanent | Hög | Låg | OK — Fas 1-13 räcker för marknadsledarskap |

---

## Del 6 — Framgångskriterier

### Kvantitativt

- 0 hardcoded commission i kod
- 0 hardcoded service-strings utanför `services`-tabellen
- 0 SQL-objekt i `sql/` utanför migrations
- 100% pricing går genom `money.ts`
- 100% payout-status stämmer med Stripe Transfer events (reconciliation-audit)
- Matchnings-RPC <100ms vid 1000 städare
- Event-log innehåller 15+ event-types per bokning
- Dispute-process SLA: kund < 24h response, städare < 48h response, admin < 72h beslut
- 95%+ admin-operationer via UI (ingen direkt SQL i admin.html)
- Recurring-retention-rate >70% efter 3 månader

### Kvalitativt

- Ny tjänst via 1 INSERT → live på 30 sekunder
- Nytt språk via 1 INSERT → aktivt i matchning direkt
- Ny firma onboardas fullt auto utan admin-intervention
- VD hanterar egen dispute upp till 500 kr utan admin
- Farhad kan svara på "vad hände med bokning X?" på 10 sekunder via event-timeline
- CLAUDE.md är alltid aktuell (auto-genererad)
- Kund kan boka recurring med en knapptryckning

### Affärsmässigt

- 30+ aktiva företag vid Q4 2026
- 1500+ bokningar/månad
- Admin-belastning 2-4h/vecka (från daglig)
- EU Platform Directive compliance 2 dec 2026 ✅
- Ansvarsförsäkring tecknad (kräver strukturerad dispute-process)
- 0 säkerhetsincidenter
- 0 betalningsincidenter (ingen silent commission-drift)
- LTV per kund +2-3x tack vare retention

---

## Del 7 — Avbrottsplan

- **1-2 veckors paus:** OK. Dokumentera var du är, uppdatera denna plan med "paused" per fas.
- **3-5 veckors paus:** Verifiera prod-state innan återupptagning. Memory kan vara stale — läs audit + denna plan som primärkälla.
- **>5 veckors paus:** Revidera hela planen. EU-deadline 2 dec är konstant — anpassa övriga faser baserat på tid kvar.
- **Akut-incident:** Pausa refactor → fixa incident → dokumentera → återuppta. Incidenten blir en rad i riskregistret.
- **Sprint-liknande sidospår:** OK **om det flaggas explicit**. Skapa `docs/planning/sprint-X-deviation.md` med motivering, tids-impact på v3. Regel #29 i praktiken.

---

## Del 8 — Utanför scope

Dessa är Q1-Q2 2027 eller senare:

- Native mobilapp (PWA räcker till Q4 2026)
- Multi-region (Norge/Finland) — schema-förberedelse i Fas 4 räcker för nu
- ML-baserad matchning med reinforcement learning
- Multi-cleaner team-optimering (Hungarian Algorithm)
- Multi-currency (SEK räcker för Sverige)
- Offentlig API för tredjepartsintegrationer
- Whitelabel-plattform för andra städbolag
- Marketplace för relaterade tjänster (trädgård, flytt, handyman)
- Blockchain/NFT/crypto (nej, aldrig)
- AI-assistent för kund (kan vara Q1 2027 om LLM-kostnader kommer ner)

---

## Del 9 — Nästa steg (vecka 2 startar)

**Omedelbart efter commit av denna plan:**

1. **Stäng öppna trådar från pågående arbete** (före Fas 1 startar):
   - Slutför v_cleaners_public-migration (4 kvarvarande filer + REVOKE anon + DROP policies). Estimat: 2-3h.
   - Rafael + Zivar Stripe-slutförande (skicka refresh_account_link-URLs). Estimat: 30 min.

2. **Fas 1 Dag 1** (vecka 2 mån):
   - Design-dok `_shared/money.ts` struktur (2h).
   - Skapa `money.ts` med tom skelett-funktioner (1h).

3. **Fas 1 Dag 2-5**:
   - Migrera hardcoded values i stripe-checkout + stripe-connect (8-10h).
   - Integration-tester (3-4h).

4. **Månatlig review:** 20 maj, 20 juni, 20 juli, 20 augusti, 20 september, 20 oktober.

---

## Del 10 — Referenser

- [`docs/audits/2026-04-20-scalability-audit.md`](../audits/2026-04-20-scalability-audit.md) — primärkälla för alla prioriteringar
- [`docs/planning/spick-arkitekturplan-v2.md`](spick-arkitekturplan-v2.md) — föregångare (behålls som historik)
- [`docs/architecture/fas-1-2-unified-identity-architecture.md`](../architecture/fas-1-2-unified-identity-architecture.md) — Unified Identity (klart)
- [`docs/architecture/00-design-sprint-b.md`](../architecture/00-design-sprint-b.md) — Sprint B onboarding (klart)
- Kommande: `docs/architecture/money-layer.md` (Fas 1)
- Kommande: `docs/architecture/matching-algorithm.md` (Fas 3)
- Kommande: `docs/architecture/event-schema.md` (Fas 6)
- Kommande: `docs/architecture/dispute-escrow-system.md` (Fas 8)

---

## Del 11 — Historik

- **v1.0** (18 april 2026) — Första planen. 8 faser, 14 veckor, 30 firmor. Författad i kvällssession tillsammans med Fas 0-arbete.
- **v2.0** (18 april 2026) — Hybrid refactor-version. Ingen feature-frys, refactor parallellt med support. Daglig rutin + riskregister + avbrottsplan.
- **v3.0** (20 april 2026) — Audit-driven prioritering. Ersätter v2. 13 faser, 18-22 veckor, 1000+ städare. Mål Q4 2026 + EU-deadline 2 dec 2026.
  - Drivet av [skalbarhetsaudit](../audits/2026-04-20-scalability-audit.md) som identifierade 8 flaskhalsar.
  - Lärdomar från Sprint B-avvikelse: avvikelser från plan MÅSTE flaggas explicit (Regel #29).
  - Ersätter gissningar med fil:rad-referenser från audit.
- **v3.1** (20 april 2026) — Justerad ordning + Fas 14 tillagd baserat på Farhads beslut.
  - Fas 5 flyttat till "Kundretention" (var Languages). Motivation: många befintliga kunder är redan recurring, måste stödjas tidigt.
  - Fas 6 flyttat till "Event-system" (var Dispute). Motivation: Dispute behöver event-audit-trail.
  - Fas 7 blev "Languages" (flyttat ner från 5).
  - Fas 8 blev "Dispute + Full Escrow" 60-80h (istället för soft escrow 40-60h). Motivation: bättre differentiator + juridiskt renare.
  - Fas 14 tillagd som valfri slutfas: Systemic Robustness Polish (20-30h). Adresserar error-bus, rate limiting, shared types, state machine-konsolidering, cache, secret rotation, idempotency.
  - Tidsram justerad: 20-25 veckor (från 18-22).

---

## Appendix A — Fas-översikt (för snabb orientering)

| Fas | Namn | Veckor | Timmar | Prio | Audit-ref |
|-----|------|--------|--------|------|-----------|
| 0 | Säkerhet & stabilitet | 1 | KLAR | — | — |
| 1 | Money Layer | 2-5 | 30-50 | 🔴 1 | Sekt. 2-3 |
| 2 | Migrations-sanering | 6 | 8-12 | 🔴 3 | Sekt. 7 |
| 3 | Multivariat matchning | 7-9 | 16-24 | 🔴 2 | Sekt. 5 |
| 4 | Services genomgående | 10-11 | 8-16 | 🟡 5 | Sekt. 1 |
| 5 | Kundretention + Recurring | 12-13 | 10-15 | — | Nytt (v3.1) |
| 6 | Event-system | 14 | 10-15 | — | v2-arv |
| 7 | Languages + picker | 15 | 5-8 | — | v2-arv |
| 7.5 | RUT-infrastruktur | TBD | 25-35 | 🔴 | Spår B 2026-04-23 |
| 8 | Dispute + Full Escrow | 16-21 | 60-80 | 🟡 4 | Sekt. 4 |
| 9 | VD-autonomi | 22-23 | 15-25 | — | Nytt |
| 10 | Observability + alerts | 24-25 | 20-40 | 🟡 6 | Sekt. 6 |
| 11 | CLAUDE.md auto-gen | 26 | 4-8 | 🟠 7 | Sekt. 8 |
| 12 | E2E + Audit-pipeline | 27-28 | 10-15 | — | v2-arv |
| 13 | GA-readiness | 29 | 5-10 | — | Nytt |
| 14 | Systemic Robustness [VALFRI] | 30-31 | 20-30 | — | Nytt (v3.1) |
| **Totalt** | | **20-25v + 7.5 schemaläggs separat** | **246-413h** | | |

**Buffer:** Tidsbudgeten 10-12h/vecka ger ~240-300h över 25 veckor. Om tajtare: skjut Fas 14 till Q1 2027 (den är markerad VALFRI av denna anledning).

---

## Appendix B — Regel #26/#27/#28/#29 — snabbreferens

**#26** Verifiera med:
- Grep -rn kodbasen
- Användarflöde (laddas data? fastnar UI?)
- Alla användartyper (solo/VD/team/kund/admin)
- Inga hardcoded värden som ska vara dynamiska
- Data mot backups — identifiera inkonsistenser

Deklarera aldrig "fungerar" baserat enbart på kodsökning.

**#27** Verifiera mot primärkälla **INNAN** förslag om bygge baserat på "saknas" eller "finns inte". Memory kan vara utdaterad. Gäller strukturella beslut.

**#28** Ingen business-data-fragmentering. Värde på 2+ ställen → centralisera till DB-tabell först. Teknik-konstanter undantag. Ambition: 110% centraliserad vid skala.

**#29** Memory är hypoteser, inte sanningar. Primärkälla för plan-status är denna fil + audit + kodbas. Memory får ALDRIG användas för plan-status, sprint-val, procent mot plan. Får användas för kontextetablering och regelpåminnelser.

---

## Appendix C — Beroendegraf

```
Fas 0 (KLAR)
  ↓
Fas 1 (Money) ────────────────────────┐
  ↓                                    │
Fas 2 (Migrations) ──────────┐         │
  ↓                           │         │
Fas 3 (Matchning) ──┐         │         │
                     ↓         ↓         │
Fas 4 (Services) ← parallellt OK        │
                     ↓                   │
Fas 5 (Retention) ← behöver Fas 1+3 ────┤
                     ↓                   │
Fas 6 (Events) ← parallellt OK          │
                     ↓                   │
Fas 7 (Languages) ← parallellt OK       │
                     ↓                   │
Fas 8 (Dispute) ← behöver Fas 1+6, delvis parallell med 5
                     ↓
Fas 9 (VD-autonomi) ← behöver Fas 1+8
                     ↓
Fas 10 (Observability) ← behöver Fas 6
                     ↓
Fas 11 (CLAUDE.md) ← parallellt OK
                     ↓
Fas 12 (E2E) ← behöver Fas 1-11
                     ↓
Fas 13 (GA) ← behöver Fas 1-12
                     ↓
Fas 14 (Robustness) [VALFRI] ← behöver Fas 1-13
```

**Parallellisering:** Fas 4, 5, 6, 7 kan delvis köras parallellt om tid finns. Fas 11 kan göras när som helst. Detta är buffer om totaltiden hotar överskrida 25 veckor.

---

*Slut på plan. Audit är primärkälla. Regel #26-29 obligatoriska. Klistra in commit-prompten när du är redo.*
