# Spick Arkitekturplan v3
**Status:** Aktiv plan (ersätter v2)
**Skriven:** 2026-04-19
**Ersätter:** docs/planning/spick-arkitekturplan-v2.md (behålls som historik)
**Horisont:** 22 veckor (19 apr 2026 → ~25 sep 2026 för kodkomplett, GA Q4 2026)

---

## 1. Executive Summary

v2 riktade plattformen mot **30 städfirmor + 500 bokningar/mån, Q4 2026**, över 14 veckor och 8 faser. Planen var välskriven och tekniskt sund — men under v2:s första vecka drev arbetet iväg från strukturen: Sprint B (självgående onboarding, ~30h) byggdes 13–19 april utanför planen, med parallell "Fas 1.x"-numrering som dolde avvikelsen. Memory fick drift-status istället för planen. Sprint A (escrow) pausades samtidigt pga Stripe Connect-blockerare.

**Rotorsaken** var att memory användes som primärkälla för plan-status. Regel #29 införs därför i v3: **memory är hypotes, arkitekturplan är sanning**. Alla framtida sprintar prefixas med en Regel #27/#29-pre-check mot `docs/planning/`.

**v3 höjer ambitionsnivån:** från 30 firmor till **1 000+ städare**, från "minimal Farhad-intervention" till **verifierbar självgående drift**, och bakar in EU-plattformsdirektivets **hårda deadline 2 december 2026** i kritisk bana. v3 består av **13 faser** (Fas 0 klar, Fas ID-1/ID-2 klara utanför plan, 10 återstående) fördelade över ~22 veckor.

**Nya faser jämfört med v2:**
- **Fas 4** (escrow + dispute) — från pausad Sprint A
- **Fas 7** (VD-autonomi) — självservicefunktioner företag kan hantera själva
- **Fas 8** (observability + admin-skalning) — grundbult för 1000+ städare
- **Fas 9** (kvalitetsmatchning) — ranking, utslagning, supply-kvalitet
- **Fas 10** (supply-side growth) — onboarding-funnel, referral, aktiveringsmetrik
- **Fas 13** (skalningstest + GA-readiness) — lasttest, chaos, runbooks

**v2:s faser bevaras** i ordning (services → languages → pricing → events → notifier → admin → E2E → audit), men numreras om till Fas 1–6, 11, 12.

---

## 2. Vad som redan är levererat (nuläge 19 apr 2026)

Verifierat mot git (primärkälla), inte memory.

### 2.1 v2 Fas 0 — Säkerhet & stabilitet: **KLART**
- RLS full audit ([docs/audits/2026-04-18-rls-full-audit.md](docs/audits/2026-04-18-rls-full-audit.md))
- Anon-write-läckor stängda ([docs/incidents/2026-04-18-anon-write-leaks-closed.md](docs/incidents/2026-04-18-anon-write-leaks-closed.md))
- INTENTIONAL_ANON_POLICIES.md dokumenterat
- V1 RLS-hardening + PKCE-fix
- Customers-tabell DROP + orphan artefakter rensade

### 2.2 Identity-spår (utanför v2:s struktur — tidigare kallat "Fas 1.1/1.2")
Dessa är **inte** v2:s Fas 1 (som handlade om services-tabellen). De omnumreras i v3 till **ID-1** och **ID-2** för att undvika terminologi-kollision.

- **ID-1 — cleaners PII DB-enforcerat via v_cleaners_public**
  Commits: `e0a1298` → `96036f6` → `723d8a4` (markerad COMPLETE 2026-04-18)
  ⚠ Öppen tråd att verifiera vid Fas 1-start: Memory noterade "4 av 8 filer kvar" vid någon tidpunkt. Git säger COMPLETE. Primärkälla vinner; kör grep-check i Fas 1-pre-check för att stänga tvetydigheten definitivt.

- **ID-2 — Unified Identity Architecture (Dag 1–4)**
  Klart 2026-04-19 morgon. Design, migrations, RLS-lockdown, PKCE-fix levererade.

### 2.3 Sprint B — Självgående onboarding: **KLART utanför plan**
Levererat 14–19 apr, 6 dagar, 14 commits (`c23dde1` → `1471ecb`). Omfattar:
- Stripe Connect-webhook + refresh_account_link
- Self-service företagsregistrering (slug-retry, cirkulär FK rollback)
- Team-invitations via SMS + VD-dashboard
- Admin pending-companies queue + approve/reject EFs
- Cron-jobb för hanteringsautomation

**Klassificering i v3:** Delar av v2:s Fas 5 (notifier/SMS) och Fas 6 (admin) har de facto levererats i förtid. Detta ska reflekteras i Fas 5 och Fas 6 genom att streamline scope — inte genom att dölja Sprint B som retroaktiv planuppfyllelse.

### 2.4 Sprint A — Escrow + Dispute: **PAUSAD, design klar**
Design-dokument skrivet 2026-04-19 (`/home/claude/sprint-a-escrow/00-design-sprint-a.md`, **ej committat**). Pausades pga Stripe Connect pilot-blockerare. Bakas in som **Fas 4** i v3 och committas under Fas 4:s första dag.

**Bekräftad scope från design:**
- Stripe Connect refactor: destination charges → separate charges & transfers
- 4-state booking machine: paid → completed → released (alt. disputed → resolved)
- 24h auto-release + 7 dagars dispute-fönster
- Obligatoriskt foto-bevis + städar-svar
- Unified refund-EF + migrering av 6 befintliga
- Admin dispute-queue + notifieringar
- audit_log för state-changes

---

## 3. Terminologi & namngivning

För att undvika den kollision som orsakade v2-drift:

| Prefix | Betydelse | Exempel |
|---|---|---|
| **F0–F13** | v3-faser | F4 = Escrow + Dispute |
| **ID-N** | Identity-spår (klara utanför plan) | ID-1 = cleaners PII |
| **Sprint A/B/...** | Nytt ska **inte** introduceras | Alla nya sprintar numreras som F-N |

**Regel (del av v3 från dag 1):** Ingen ny parallell numrering. Om något måste byggas utanför plan — pausa, flagga till Farhad, uppdatera planen, sedan bygg.

---

## 4. Strategiska mål

| Dimension | v2-mål | v3-mål |
|---|---|---|
| Antal städare | Ej specificerat (30 firmor) | **1 000+ städare** |
| Drift | "Minimal intervention" | **Verifierbar självgående** (mätbart: VD kan onboarda, ändra priser, hantera disputes utan Farhad) |
| Compliance | Ej specificerat | **EU-plattformsdirektiv 2 dec 2026** (hård deadline) |
| GA | Q4 2026 | Q4 2026 (behållen) |

**Verifierbart självgående** definieras som: ett slumpvis valt företag (VD) kan genomföra följande utan stöd från Farhad, inom 7 dagar från första klick:
- Skapa konto + Stripe-onboarding
- Lägga till 3 teammedlemmar
- Sätta egna priser för minst 3 tjänster
- Ta emot och hantera 10 bokningar inkl. 1 dispute
- Få utbetalning

Fas 13 innehåller verifieringsprotokoll för detta.

---

## 5. EU-plattformsdirektivets kritiska bana

Deadline **2 dec 2026**. 32 veckor från idag. Kritisk bana:

| Krav | Uppfylls av | Hard-stop datum |
|---|---|---|
| Effektiv dispute-resolution | F4 (escrow + dispute) | 15 sep 2026 |
| Transparens kring ranking | F9 (kvalitetsmatchning) | 15 okt 2026 |
| Klagomålshanteringssystem | F4 + F8 (admin-skalning) | 1 nov 2026 |
| B2B-villkor & T&C | F7 (VD-autonomi) | 1 nov 2026 |
| Årsrapport + loggar | F5 + F12 (events + audit) | 1 dec 2026 |

**Alla Fas 4, 5, 7, 8, 9, 12 måste vara kodkompletta senast 1 nov 2026** för att lämna 4 veckor till juridisk review + publicering.

---

## 6. Faserna

Timestimat baseras på 10–15h effektiv byggtid/vecka (Farhads tempo, sologrundare, parallellt med pilot-support).

---

### Fas 0 — Säkerhet & stabilitet ✅ KLART
Se §2.1.

---

### Fas 1 — Services-tabell
**Mål:** Centralisera alla hardcoded service-listor till en DB-tabell. Möjliggör Rafaels Premiumstädning + Mattrengöring utan kod-deploy.

**Primärkälla för scope:** 314 träffar över 50 filer (pre-check, steg F).

**Leverabler:**
- `services`-tabell (id, key, label_sv, label_en, default_hourly_price, rut_eligible, active, display_order, created_at, updated_at)
- Seed: 9 existerande tjänster + Premiumstädning + Mattrengöring
- Migrera boka.html (37 träffar), admin.html (14), foretag.html (9) — topp 3 prioriterade
- Migrera 6 blogg-sidor (blogg/*.html)
- Ny Edge Function `services-list` (cached, 5 min TTL) för publika läsare
- Admin-UI i admin.html för CRUD
- RUT-eligibility per tjänst (ej global)

**Tidsestimat:** 14–18h (1.5 veckor)

**Dependencies:** Inga blockerare. ID-1 klar ger ren cleaners-bas.

**Skalnings-impact:** Grundbult. Varje ny tjänst utan detta = +5 filer att ändra. Vid 1000+ städare där varje firma vill lägga till egen nischtjänst (kontor/flytt/djup) är detta obligatoriskt.

**Risk:** Hardcoded-listorna i bloggen är SEO-kritiska — migrera till {{services.key}}-mall via build-steg, inte dynamisk DOM-fetch (SSR-kompromiss).

**Öppen tråd innan start:** Verifiera v_cleaners_public-status via grep mot koden (stäng ID-1-tvetydigheten från §2.2).

---

### Fas 2 — Languages + språkpicker
**Mål:** Centralisera språkhantering. Möjliggöra Zivars språkval (+ andra flerspråkiga städare).

**Leverabler:**
- `languages`-tabell (code, label_sv, label_en, iso_639_1)
- Seed: 37 språk (från v2-seed)
- `cleaner_languages`-junction + vy
- Språkpicker-UI i städar-profil + VD-dashboard (för team)
- Filter i kund-matchning: "Jag vill ha städare som pratar [språk]"

**Tidsestimat:** 8–12h (1 vecka)

**Dependencies:** Fas 1 klar (ingen strikt teknisk, men bättre refaktor-ergonomi när services redan är centraliserade).

**Skalnings-impact:** Medel. Svensk marknad har många nationaliteter — särskiljning på språk är konkurrensfördel. För EU-direktivet: indirekt, men bra för ranking-transparens.

**Risk:** Låg. Isolerad feature.

---

### Fas 3 — Pricing-konsolidering
**Mål:** Migrera 12 återstående hardcoded prispunkter till en pricing-resolver. Introducera dynamic pricing per tid/dag (helger +10%, sent kväll +15%).

**Leverabler:**
- `pricing_rules`-tabell (scope: global/company/cleaner, service_id, base_price, modifiers JSONB)
- Pricing-resolver Edge Function (samma input alltid → samma output)
- Migrera alla 12 hardcoded ställen
- Dynamic modifiers (tid/dag/urgency) — modulär arkitektur
- Commission-resolver flyttad hit (12% flat via platform_settings, men utbyggt schema för framtida tiered commission)

**Tidsestimat:** 18–24h (2 veckor)

**Dependencies:** Fas 1 (services-tabellen är input till pricing-resolver).

**Skalnings-impact:** Hög. Vid 1000+ städare vill enskilda firmor sätta egen prissättning. Detta är fundamentet för prisautonomi (F7).

**Risk:** Hög om inte testat rigoröst. Felaktig pricing = tvist med varje kund. E2E-tester (F11) måste täcka alla prisscenarion.

---

### Fas 4 — Escrow + Dispute ⚠ EU-KRITISK
**Mål:** Implementera pausad Sprint A. Pengar hålls i escrow tills attest/auto-release eller dispute resolved.

**Leverabler (från Sprint A-design):**
- Stripe Connect refactor: destination charges → separate charges & transfers
- `booking_state`-kolumn (4-state: paid → completed → released ⊕ disputed → resolved)
- 24h auto-release-trigger efter städar-checkout
- 7 dagars dispute-fönster efter completed
- `disputes`-tabell + obligatorisk foto-upload (bucket: `dispute-evidence`)
- Städar-svar-fönster (48h)
- Unified refund-EF + migrera 6 befintliga refund-ställen
- Admin dispute-queue i admin.html
- state-change events i audit_log

**Tidsestimat:** 28–30h (2.5 veckor — bekräftat från Sprint A design-analys)

**Dependencies:**
- Stripe Connect pilot-onboarding klar (Rafael + Zivar) — **pågår, blockerar Fas 4-start**
- `dispute-evidence` bucket skapas
- Sprint A design-dok committas första dagen av Fas 4 till `docs/architecture/00-design-sprint-a.md`

**Skalnings-impact:** EU-kritisk (direktivkrav). Utan detta kan Spick inte lagligt operera i EU efter 2 dec 2026.

**Risk:** Hög. Stripe-refactor påverkar produktionsflöde. Feature flag + staging-branch + dubbel-run (gammal + ny i parallell) under 1 vecka.

**Hard-stop:** Kodkomplett 15 sep 2026.

---

### Fas 5 — Event-system + notifikationer (konsoliderad från v2 Fas 4+5)
**Mål:** Full audit-trail över allt som händer i bokningen. Notifier-system som lyssnar på events.

v2 hade detta som två faser. Sprint B levererade redan notifier-infrastruktur för onboarding (SMS-invites, approve/reject). v3 konsoliderar: eventsystemet är motorn, notifier är en konsument.

**Leverabler:**
- `booking_events`-tabellen fullt utbyggd (Sprint B gjorde delar)
- Event-emitter Edge Function (centralt log_booking_event-RPC)
- Event-typer: created, cleaner_accepted, paid, started, completed, released, disputed, dispute_responded, resolved, refunded, cancelled
- Notifier-Edge Function: läser events → skickar SMS (46elks) / e-post (Resend) baserat på routing-tabell
- `notification_templates`-tabell (per språk, per event-typ)
- Kund-mejl vid städarbyte (v2 feature-kö)
- Team-SMS (v2 feature-kö) — **delvis gjort i Sprint B, verifiera kompletthet**

**Tidsestimat:** 18–24h (2 veckor)

**Dependencies:** Fas 4 (escrow-events måste emittas). Fas 2 (notification_templates per språk).

**Skalnings-impact:** Hög. Vid 1000+ städare går det inte att debugga utan event-log. Krävs också för EU-rapportering (årsrapport).

**Risk:** Medel. Notifier-spam om events dubbleras. Idempotency-krav på event-emit.

---

### Fas 6 — Admin + RLS-konsolidering
**Mål:** Slutföra admin-dashboarden (delar gjorda i Sprint B). Konsolidera RLS-policies till DRY-pattern.

**Leverabler:**
- Slutföra admin.html: dispute-queue (från F4), events-viewer (F5), företagsöversikt (pending/active/suspended)
- RLS-macro-funktioner (`is_customer_of`, `is_staff_of_company`, `is_platform_admin`) — ersätt 40+ inline-policies
- Audit-lista över alla tabeller → RLS-policy-mappning
- Admin OTP-inloggning verifierad

**Tidsestimat:** 14–18h (1.5 veckor)

**Dependencies:** F4, F5.

**Skalnings-impact:** Medel-hög. Utan konsoliderad RLS är 1000+ städare en policy-explosion. Också EU-kritisk (klagomålshantering).

**Risk:** RLS-byte är högriskigt. Dry-run mot prod-kopia + Postgres-snapshot före deploy.

---

### Fas 7 — VD-autonomi (NY) ⚠ EU-KRITISK
**Mål:** VD kan hantera sitt företag utan Farhad. Bakgrund till 1000+ skalning.

**Leverabler:**
- VD-dashboard: full CRUD på teammedlemmar (Sprint B gjorde invites, här kompletteras edit/remove/suspend)
- Prisautonomi: VD sätter egna priser per tjänst + per tid (använder F3:s pricing-rules)
- Tjänsteutbud: VD väljer vilka F1-services firman erbjuder
- Tillgänglighet: VD sätter team-schemaler (arbetstider, semesterperioder)
- VD-godkännande/avvisning av inkommande bokningar (auto-godkännande togglas individuellt — ersätter minnets `allow_customer_choice`-tråd)
- VD kan se/exportera utbetalningar, dispute-statistik, intäktsöversikt
- B2B-T&C (EU-direktivkrav) presenteras vid onboarding

**Tidsestimat:** 24–32h (3 veckor)

**Dependencies:** F1, F2, F3, F6 (admin-mönster för rollbaserad CRUD).

**Skalnings-impact:** Avgörande för 1000+. Varje Farhad-touch per firma är skalningsblockerare.

**Risk:** Scope-drift. Låsa scope till listan ovan — ny feature-kö hanteras efter v3.

---

### Fas 8 — Observability + admin-skalning (NY) ⚠ EU-KRITISK
**Mål:** Göra plattformen observerbar. Vid 1000+ städare krävs mätbart hälsotillstånd + effektivt klagomålshanteringsverktyg (EU-krav).

**Leverabler:**
- Health-endpoint (`/api/health`) — DB, Stripe, Resend, 46elks-status
- Metrics-dashboard (intern, Supabase-vy): bokningar/h, payment success rate, dispute rate, active cleaners, stuck bookings
- Stuck-booking-detector (cron-jobb): flagga bokningar >24h utan state-change
- Admin-bulkoperationer (suspendera 10 firmor, skicka meddelande till 100 städare)
- Klagomålshanteringsverktyg (EU-krav): strukturerad inbox, SLA-timers, eskalationsflöde
- Log aggregator: sök över Edge Function-logs, booking_events, audit_log från en yta

**Tidsestimat:** 18–26h (2 veckor)

**Dependencies:** F5 (events), F6 (admin).

**Skalnings-impact:** Avgörande. Utan observability är 1000+ blindfäkting.

**Risk:** Låg-medel. Mest nybyggnation.

---

### Fas 9 — Kvalitetsmatchning (NY) ⚠ EU-KRITISK
**Mål:** Ranking-algoritm med transparens (EU-krav) + kvalitetsutslagning.

**Leverabler:**
- Ranking-score per städare: f(rating, completion_rate, response_time, dispute_rate, distance, last_7d_activity)
- Score-vikter lagrade i `platform_settings` (ej hardkodat — Regel #28)
- Publik förklaring: "Så fungerar vår matchning" (EU-transparenskrav)
- Suspendering: städare med dispute_rate >15% auto-suspenderas pending admin-review
- A/B-ramverk för scoring-vikter (persisted experiments)
- Matchningsexplainer: varje bokning lagrar varför just dessa städare visades (EU-krav vid klagomål)

**Tidsestimat:** 22–30h (2.5 veckor)

**Dependencies:** F5 (events ger completion_rate, response_time). F8 (dispute_rate-metrik).

**Skalnings-impact:** Hög. Vid 1000+ är matchning avgörande för kundnöjdhet. Utan kvalitetsutslagning förgiftas poolen.

**Risk:** Medel. Felaktig vikt kan nuka städares inkomst → dispute. Starta konservativt, rulla ut A/B.

---

### Fas 10 — Supply-side growth (NY)
**Mål:** Systematisk städar-tillväxt. Från "Farhad rekryterar manuellt" till funnel.

**Leverabler:**
- Självservice-onboarding-funnel för solo-städare (Sprint B gjorde för företag — utöka till individer)
- Referral-program: existerande städare bjuder in (bonus vid första 3 slutförda jobb)
- Aktiveringsmetrik: TTFB (time-to-first-booking) för nya städare, dashboard
- Drop-off-analys: var i onboarding stuckar nya städare
- Lifecycle-emails: nykläckt → inaktiv → återaktiveringskampanj

**Tidsestimat:** 18–26h (2 veckor)

**Dependencies:** F5 (lifecycle-events), F7 (VD-autonomi-mönster).

**Skalnings-impact:** 1000+-målet förutsätter detta. Linjär tillväxt via Farhad-touch = kapat vid ~100.

**Risk:** Låg. Additivt.

---

### Fas 11 — E2E-tester
**Mål:** Komplett testsvit. Körbar före varje deploy.

**Leverabler:**
- Playwright-setup, headless, CI-körd
- 15+ scenarion: bokning happy path, escrow-flöde, dispute, VD CRUD, prisändring, team-invite, refund, cancellation
- Städar-POV + VD-POV + kund-POV + admin-POV (4 roller)
- Deterministiska fixtures (Stripe test clock, tid-mocking)
- Pre-deploy gate: alla tester gröna, annars blocked

**Tidsestimat:** 24–32h (3 veckor)

**Dependencies:** Alla tidigare faser (F11 testar allt).

**Skalnings-impact:** Avgörande. Utan tester är regressionsrisken oöverkomlig vid 1000+.

**Risk:** Låg. Additivt.

---

### Fas 12 — Audit-pipeline
**Mål:** CI-script som förhindrar regression till hardkodade värden (Regel #28-enforcement automatiserat).

**Leverabler:**
- CI-script som scannar för nya hardkodade services, priser, språk, commission
- GitHub Action som blockerar PR om nya hardkodade värden introduceras
- Weekly scan mot existerande kod + JIRA-liknande rapport över tech-debt
- EU-rapportgenerator (årsrapport från audit_log + booking_events)

**Tidsestimat:** 8–12h (1 vecka)

**Dependencies:** F1, F2, F3 (för att veta vad som ska vara i DB).

**Skalnings-impact:** Avgörande för långsiktig hygien.

**Risk:** Låg.

---

### Fas 13 — Skalningstest + GA-readiness (NY)
**Mål:** Verifiera att plattformen klarar 1000+ städare innan publik GA.

**Leverabler:**
- Lasttest: 500 simultana bokningsförfrågningar, 10 000 aktiva städar-profiler
- Chaos-test: Stripe nere 10 min, Resend nere 30 min, DB-hiccup — systemet ska degrade gracefully
- "Självgående-drift"-verifiering (från §4): slumpmässig VD-kohort + mätprotokoll
- Runbooks för alla incident-typer (Stripe outage, DB failover, 46elks-spam)
- Pre-GA checklista (50+ punkter): legal, compliance, security, drift, supply, demand
- Publik GA-meddelande (om alla gates passerar)

**Tidsestimat:** 18–26h (2 veckor)

**Dependencies:** Alla tidigare. Särskilt F11 (tester) och F8 (observability).

**Skalnings-impact:** Ingen GA utan detta.

**Risk:** Fas 13 avslöjar arkitekturbrister som kräver retroaktiva fixar i tidigare faser. Planera 1 vecka buffert.

---

## 7. Tidsplan & kritisk bana

| Fas | Timmar (mitten) | Veckor | Kumulativ vecka | Kalenderdatum (slut) |
|---|---|---|---|---|
| F1 Services | 16h | 1.5 | 1.5 | 1 maj 2026 |
| F2 Languages | 10h | 1.0 | 2.5 | 8 maj 2026 |
| F3 Pricing | 21h | 2.0 | 4.5 | 22 maj 2026 |
| F4 Escrow | 29h | 2.5 | 7.0 | 8 juni 2026 |
| F5 Events + Notifier | 21h | 2.0 | 9.0 | 22 juni 2026 |
| F6 Admin + RLS | 16h | 1.5 | 10.5 | 3 juli 2026 |
| F7 VD-autonomi | 28h | 3.0 | 13.5 | 24 juli 2026 |
| F8 Observability | 22h | 2.0 | 15.5 | 7 aug 2026 |
| F9 Kvalitetsmatchning | 26h | 2.5 | 18.0 | 25 aug 2026 |
| F10 Supply growth | 22h | 2.0 | 20.0 | 8 sep 2026 |
| F11 E2E-tester | 28h | 3.0 | 23.0 | 29 sep 2026 |
| F12 Audit-pipeline | 10h | 1.0 | 24.0 | 6 okt 2026 |
| F13 Skalningstest | 22h | 2.0 | 26.0 | 20 okt 2026 |

**Totalt:** ~271h, 26 veckor. Inkluderar ingen buffert för pilot-support, incidents, eller scope-förändring.

**Realistisk GA-kandidat:** 1 nov 2026 (med 1 vecka buffert). 4 veckor kvar till EU-deadline 2 dec 2026 = kompatibelt.

**Hard-stops mot EU-deadline 2 dec 2026:**
- F4 kodkomplett: 8 juni 2026 ✅ (marginal: ~6 mån till hard-stop 15 sep)
- F9 kodkomplett: 25 aug 2026 ✅ (marginal: ~7 veckor till hard-stop 15 okt)
- F4 + F5 + F7 + F8 + F9 + F12 kodkompletta: 6 okt 2026 ✅ (marginal: ~4 veckor till hard-stop 1 nov)

---

## 8. Revisionscadence

v3 revideras månadsvis:
- **17 maj 2026** (1 mån in) — har F1 + F2 levererat? Pricing-resolver redo?
- **17 juni 2026** (2 mån) — F4 escrow-refactor i produktion?
- **17 juli 2026** — halvvägs. Kritisk check mot EU-deadline.
- **17 aug 2026** — F8 + F9 på väg?
- **17 sep 2026** — pre-GA. Är lasttest realistiskt inom 4 veckor?
- **17 okt 2026** — sista chansen före GA-lansering.

Revision = 1h session: läs planen, jämför mot git, uppdatera scope, notera drift. Inget mer, inget mindre.

---

## 9. Regelramverk (oförändrat från v2, utökat med #29)

- **Regel #26** — Verifiera med grep + flöde + användartyper + inga hardkodade + data-audit
- **Regel #27** — Verifiera mot primärkälla INNAN bygge
- **Regel #28** — Ingen business-data-fragmentering. Värde på 2+ ställen → centralisera till DB först
- **Regel #29** — Memory är hypoteser, arkitekturplan är primärkälla

---

## 10. Öppna trådar att stänga tidigt i v3

1. **v_cleaners_public-verifiering** (ID-1-tvetydighet) — kör grep i F1-pre-check
2. **Sprint A design-dok commit** — committa som del av F4 dag 1 till `docs/architecture/00-design-sprint-a.md`
3. **Rafael + Zivar Stripe-onboarding** — blockerar F4. Lösning pågår utanför v3 (pilot-support)
4. **allow_customer_choice VD-toggle** — paketeras in i F7 VD-autonomi
5. **17 bokningar med inkonsistent status/payment_status** — fixas i F4 migrations-steget
6. **customer_profiles tom (ingen upsert i booking-create)** — fixas i F5 (eventflöde måste emitta customer_profile_updated)
7. **P1-buggar (per-kvm visas som kr/h, företagsnamn saknas)** — fixas i F1 vid migration av boka.html

---

## 11. Pausat (ej i v3, ej GA-gate)

- Mobilapp (React Native/Expo) — Q1 2027
- Multi-stad-utvidgning utanför Storstockholm — Q1 2027 (geografiskt: plattformen stödjer redan hela Sverige, men aktiv marknadsföring fokuseras)
- ML-baserad matchning — Q2 2027 (regelbaserad F9 räcker till GA)
- Mattrengöring-offerter som fullskaligt flöde (enkel offertkanal via F1 räcker för pilot)

---

## 12. Slutnotering

v3 är strängare än v2 på tre sätt:
1. **Primärkällsdisciplin** (Regel #29) — ingen mer memory-driven drift
2. **Ingen parallell sprintnumrering** — allt är F-N eller ID-N
3. **EU-deadline är hård** — 1 nov 2026 är gate, inte önskemål

Om scope eller tempo halkar — pausa, uppdatera v3, kommunicera. Aldrig bygga "utanför plan" igen.

**Nästa steg efter commit:** F1 pre-check i Claude Code (verifiera v_cleaners_public + inventera services-referenser).
