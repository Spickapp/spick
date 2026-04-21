# Fas 1 Money Layer – Progress

**Primärkälla:** [docs/planning/spick-arkitekturplan-v3.md](planning/spick-arkitekturplan-v3.md) (v3.1)

**Syfte:** Status-overlay som mappar v3-sub-fas → commit + status. Denna fil är INTE en plan – alla scope-beslut refererar v3.md.

**Senast uppdaterad:** 2026-04-24 morgon (§3.5 STÄNGD + status-sync)

## Session 2026-04-22 – Startpunkt

**Läs denna sektion först.** Den är primärkälla för var vi slutade och vart vi går härnäst.

### Verifiera först (5 min)

```powershell
git log -1                    # ska vara 18f5b5b eller senare
deno task test:money          # ska vara 100 pass (4 ignored = Stripe-tester utan test-secret, normalt)
```

Om något avviker → flagga innan fortsättning.

### Status just nu (2026-04-24)

- **Fas 0:** ✓ KLAR (18-19 april)
- **Fas 1 Money Layer:** ✓ 100 % KLAR (22 april)
- **Fas 2 Migrations-sanering:** ✓ STÄNGD inom v3-scope (7 klara + §2.3 deferred till Fas 3 + §2.8 till Fas 2-utökning)
- **Fas 2.7 B2B-kompatibilitet:** ✓ KLAR
- **Fas 2.5-minifix:** ✓ rut-claim avstängd, skjuts till Fas 7.5
- **Fas 3 Matching:** ◑ PÅGÅENDE
  - §3.1 ✓ designdokument
  - §3.2a ✓ RPC v2 migration live
  - §3.2b ✓ boka.html skickar utökade params
  - §3.2c ✓ STÄNGD (DORMANT DROP exekverad 2026-04-24)
  - §3.2d ✓ cleaner-job-match EF raderad
  - §3.3 ✓ implicit klar (vikter i §3.2a)
  - §3.4 ✓ implicit klar (history_multiplier i §3.2a, inaktiv utan customer_id)
  - §3.5 ✓ STÄNGD (VIEW ej tillämplig, mål uppnått i §3.2a)
  - §3.6 ◯ villkorat på performance (ej akut)
  - §3.7 partial ✓ audit-writing live + verifierad (match_score 0.707)
  - §3.7 full ◯ shadow-mode + v2-aktivering + traffic-split ej påbörjat
  - §3.8 ◯ admin dashboard ej påbörjat
  - §3.9 ◯ pilot-analys (kräver 30 dagars data)
- **Fas 4-14:** ◯ ej påbörjade

**Plan-beslut:** #1 stängt, #3 stängt, #2 stängt 22 april, #4 per_window öppet (väntar Farhad)

**Stripe:** LIVE i prod (13 apr), testat end-to-end

**Parallella skuld-tracks:**
- Hygien #48 Infrastructure audit (migrations-deploy + DORMANT-FK), 8-15h
- Hygien #49 Timezone-audit (1 kritisk prod-bugg + 2 medel), 4-5h

### Nästa steg – välj ett

**Alternativ 1: Plan-beslut #2 (fix-skript-utvidgning §2.7)** – 30-60 min
- Kartlägg 10 fix-skript utanför v3 §2.7 (grep callers, verifiera döda)
- Ta beslut: utöka §2.7 eller separat cleanup-fas
- Låg risk om alla visar sig döda

**Alternativ 2: §1.8 originalplan (admin.html + bli-stadare.html + join-team.html)** – 1-2 h
- Hourly-priser 349/350/399 → platform_settings via helper
- Nu unblocked efter plan-beslut #1 (boka.html är hanterad separat)
- Mekaniskt arbete, helpers-pattern etablerat från §1.9

**Alternativ 3: §1.10 money-layer.md hygien** – 30-45 min
- Uppdatera arkitektur-dok mot nuvarande state (efter §1.2/§1.3/§1.7/§1.9)
- Ren dokumentation, ingen kod

**Alternativ 4: §1.6 Stripe integration-test CI** – egen större session (3-5 h)
- Test-infra-bygge (mockad Stripe, CI-secrets, GitHub Actions)
- Kritiskt för skalning men stor bit
- Kommer aktivera de 4 ignored-testerna

### Rekommenderad ordning

1. Plan-beslut #2 först (rensa öppna beslut)
2. §1.10 hygien (stänger Fas 1-dokumentation)
3. §1.8 (mekanisk, unblocked)
4. §1.6 integration-test (egen session)

### Viktiga regler att bära med

- Grep-truncering har orsakat scope-läckage 2 ggr (§1.7 + plan-beslut #1). ALLTID `| Measure-Object -Line` för count, aldrig head_limit vid scope-räkning
- Verifiera aktiv-status via produktionsdata innan migrera/radera någon EF (stripe-checkout-lärdom: 0 invocations 20 dgr räddade oss från att migrera död kod)
- Primärkällor kan konflikta. Nyare slår äldre när data stödjer (SUPERSEDED-status legitim)
- Använd §-referens i commit-meddelanden: `§X.Y (v3.md:rad): beskrivning`
- PowerShell, inte bash

### 2026-04-21 commits (ordning)

- eb898fe §1.4 markPaid → EF + swishPay borttagen
- 5cce033 §1.7 commission.js arkiverad
- 641226e §1.7 läckage-fix + getCommissionRate helper
- 4f90fae docs: progress-overlay + TODO-rättning
- c3df068 §1.3 payout_cleaner raderad (död + bruten)
- e7e113f docs: progress-konvention (hash → §-sökning)
- 69af63e §1.9a commission-helpers.js infrastruktur
- 22875d5 §1.9b 17 hardcodes centraliserade
- d8ad532 §1.2 SUPERSEDED: stripe-checkout raderad (+ EF undeploy:ad)
- 18f5b5b plan-beslut #1: SAFETY_FALLBACK_RATE i boka.html (15 fallbacks)

### Loose end att knyta

Preview-sandbox kunde inte live-testa parse-time-wrapparna i §1.9b (marknadsanalys.html + rekrytera.html). Statisk verifiering gav hög konfidens, men nästa gång Farhad öppnar staging/prod: 30-sekunders smoke-test av kalkylatorerna på dessa sidor. Om något kraschar → rollback av 22875d5 är rent.

## Fas 2 — Migrations-sanering (pågår)

Referens: [docs/planning/spick-arkitekturplan-v3.md rad 168-198](planning/spick-arkitekturplan-v3.md) (vecka 6, 8-12h, 9 sub-faser).

| Sub-fas | v3.md rad | Beskrivning | Status | Ändring | Kommentar |
|---------|----------:|-------------|:------:|---------|-----------|
| §2.1 | 176 | `pg_dump --schema-only` mot prod + diff-lista | ✓ | Schema drift-inventering + klassificering 2026-04-22 | prod-schema.sql (Farhad dumpade 22 apr, 200KB, gitignored). Rapport: [docs/audits/2026-04-22-schema-drift-analysis.md](audits/2026-04-22-schema-drift-analysis.md). Prod: 72 tables / 31 functions / 217 policies / 11 views / 3 types. Drift: ~41 tables + 17 functions saknar migrations (Kategori A); ~17 migrations-tabeller utan prod (B); minst 1 innehållsdrift verifierad (C, löst §2.2). Klassificering: 15 KRITISKA, 15 LEGACY, 10 DORMANT, 38 BENIGNT. INGA migrations byggda – levererar på v3-scope "Lista skillnader". Framtida §2.1.1-5 schedulerat (16-24h). |
| §2.2 | 177 | Migrera `find_nearby_cleaners` från sql/radius-model.sql | ✓ | Migration skapad 2026-04-22 från prod-verifierad källa | Ny fil: [supabase/migrations/20260422_f2_2_find_nearby_cleaners.sql](../supabase/migrations/20260422_f2_2_find_nearby_cleaners.sql). Källa: Studio SQL-query via `pg_get_functiondef` 2026-04-22, INTE sql/-filer. v3.md §2.2 pekade på obsolet sql/radius-model.sql (home_coords existerar ej i prod). Alla 3 sql/-filer drev från prod-sanningen (text[]/jsonb-konflikt, 19 vs 24 returfält, annat company-filter). 24 returfält, services jsonb, LEFT JOIN companies, filter `(company_id IS NULL OR is_company_owner = true)`. Idempotent via DROP FUNCTION IF EXISTS + CREATE OR REPLACE. sql/-filer orörda — hanteras §2.5. |
| §2.3 | 178 | `v_available_jobs_with_match` + `jobs`-tabell | ⊘ SUPERSEDED | Deferred till Fas 3 (beslut 2026-04-22) | Prod har 3 DORMANT-tabeller (jobs 39r, job_matches 39r, cleaner_job_types) + ingen view. 0 kod-referenser grep-verifierat 22 apr. v3 §2.3-antagandet (1 view + 1 tabell) stämmer inte mot prod. Scope överlappar Fas 3 §3.1-§3.3 (matching-algorithm design). Fas 3 beslutar om tabellerna ska integreras, raderas, eller omdesignas. Inga migrations skapas i §2.3 – det vore att cementera DORMANT-infrastruktur. Se research-rapport 22 apr och [audit 2026-04-19-nytt-jobb-matchar-bugg.md](audits/2026-04-19-nytt-jobb-matchar-bugg.md). |
| §2.4 | 179 | 3 odokumenterade prod-policies | ✓ | 3 policies prod-verifierade + fixade 2026-04-22 | Diff mot prod-schema.sql: 0/3 fullständig match. Policy 1 (admin_reads_all_customers) BROKEN — refererade icke-existerande tabell `customers`. Filnamn bytt + tabell ändrad + policy-namn matchar nu prod rad 5385. Policy 2 (admin_cleaner_update): TO authenticated borttagen för match mot prod rad 4514 (implicit TO public). Policy 3 (company_owner_reads_team_bookings): inner alias `c2` → `owner` för match mot prod rad 4970. Alla 3 idempotenta med DROP IF EXISTS. |
| §2.5 | 180 | Flytta `sql/` → migrations eller arkivera | ✓ | 6 radera + 2 arkivera, sql/-mapp borta 2026-04-22 | Klassificering: 4 find_nearby-filer (superseded av §2.2) + approval-and-booking-response + cleaner-applications-geo (ALREADY_APPLIED via migrations) → RADERA (6). p0-waitlist + companies-and-teams (ALREADY_APPLIED, kritisk infrastruktur) → ARKIVERA till [docs/archive/sql-legacy/](archive/sql-legacy/) med README som dokumenterar cut-off 2026-04-22. sql/-mappen auto-raderad av git. Uppdaterade docs/4 rad 451 (source-pekare till ny migration). |
| §2.6 | 181 | Rensa worktree + branch `claude/wonderful-euler` | ✓ | Branch raderad 2026-04-22 | 0 unique commits vs main (main 201 ahead = abandonerad). Lokal delete via `git branch -D` + remote delete via `git push --delete` + `git fetch --prune` för stale tracking-ref. Reversibel via git reflog 30 dagar (sha `d165f18`). Worktree var redan borta innan §2.6-start. |
| §2.7 | 182 | Arkivera fix-skripten | ✓ | 19 fix-skript raderade 2026-04-22 | plan-beslut #2, commit `1d41099`. v3 listade 8, faktiskt scope 19. Alla K1 (0 callers, 0 workflows, hårdkodade Windows-paths) |
| §2.8 | 184 | CI-workflow schema-drift-check | ⊘ | Deferred till Fas 2-utökning 2026-04-22 | §2.8 utan §2.1.1-4 (KRITISK-migrations) skulle bli baseline som accepterar 60+ drift-objekt som norm — signalerar att skuld är OK. Bygg §2.8 efter §2.1.1 (15 KRITISK-tabeller migrerade) för meningsfull drift-check. |
| §2.9 | 185 | Uppdatera `docs/7-ARKITEKTUR-SANNING.md` + `docs/4-PRODUKTIONSDATABAS.md` | ✓ | Sync mot Fas 1-leverans 2026-04-22 | docs/7: Money-layer-referens-sektion (NY), pricing-helper uppdaterad (pricing-resolver EXISTERAR + commission-helpers.js), post-§1.X-annotationer + 🔍-flaggor för osäkra rader. docs/4: platform_settings utökad 6→13 nycklar (SQL-verifierad 22 apr), money-layer-tabeller (payout_attempts, payout_audit_log) + services-tabeller (services, service_addons) tillagda, datum-bump, stripe-checkout-referenser uppdaterade till RADERAD. |

**Fas 2 STÄNGD inom v3-scope 2026-04-22:** 7 klara (§2.1, §2.2, §2.4, §2.5, §2.6, §2.7, §2.9) + 2 deferred (§2.3 → Fas 3, §2.8 → Fas 2-utökning).

**Fas 2-utökning (skuld-roadmap, schedulerad separat):**
- §2.1.1: 15 KRITISK-tabeller → CREATE TABLE migrations (5-8h)
- §2.1.2: 15 LEGACY → Studio COUNT + DROP-beslut (3-5h)
- ~~§2.1.3: 10 DORMANT → Fas 3-integration eller DROP~~ ✓ **Stängd 2026-04-22 (Fas 3 §3.1-beslut)**: `jobs`, `job_matches`, `cleaner_job_types` raderas (push-modell ej behövd, pull räcker). Exekvering i kommande migration (§3.2 eller separat cleanup-commit). Övriga DORMANT-kandidater (cleaner_customer_relations, cleaner_preferred_zones, cleaner_skills, cleaner_zones, cleaner_referrals, customer_selections, earnings_summary) kvarstår för separat grep+COUNT-beslut.
- §2.1.4: 217 policies-diff (4-6h)
- §2.1.5: 11 views + 3 types migrations (2h)
- §2.8: CI schema-drift-check (2-3h, efter §2.1.1 minst)
- **Total: 16-24h** — rekommendation: hantera som Fas 7.5 eller under Fas 13 "GA-readiness".

---

## Status per sub-fas

| Sub-fas | v3.md rad | Beskrivning | Status | Ändring | Kommentar |
|---------|----------:|-------------|:------:|---------|-----------|
| §1.1 | 141 | `_shared/money.ts` skelett + helpers | ✓ | Alla helpers implementerade | getCommission, calculatePayout, calculateRutSplit, triggerStripeTransfer |
| §1.2 | 142 | stripe-checkout:88 hardcoded → money.getCommission() | ⊘ SUPERSEDED | stripe-checkout raderad 2026-04-21 + v3.md-not tillagd | stripe-checkout EF var död kod (0 invocations 20 dgr + 0 callers). Katalog raderad. CI-workflows och docs-Tier1 uppdaterade. booking-create:604 bär betalningen och läser commission från platform_settings. Tier2-docs (historiska snapshots) orörda. EF undeploy kvar som manuell åtgärd. |
| §1.3 | 143 | stripe-connect:172 hardcoded 0.83 → money.calculatePayout() | ✓ | payout_cleaner-action raderad (91 rader) | 0 callers + bruten mot DB-schema (3 kolumner saknas). Transfer-logiken finns i `money.ts::triggerStripeTransfer`. EF:n behålls aktiv för 6 onboarding-callers. |
| §1.4 | 144 | admin.html:markPaid → EF, idempotency + transfer-verifiering | ✓ | markPaid → EF, swishPay borttagen | Idempotency + Stripe transfer-verifiering via `money.ts` |
| §1.5 | 145 | Reconciliation-cron | ✓ | Reconciliation-cron aktiverad | Auto-activation + auto-rollback i kod men ej i v3.md – hygien-task |
| §1.6 | 146 | Stripe integration-test i CI (full booking → checkout → transfer → payout) | ✓ | §1.6a: 21 unit-tests med mocks. §1.6b: 3 integration aktiverade + GitHub Actions CI. Destination-transfers kräver verified Connect-account (väntar) | §1.6a (2026-04-22): 21 enhetstester. §1.6b (2026-04-22): [test-money.yml](.github/workflows/test-money.yml) med 2-job-struktur (unit blockerar merge, integration advisory). Env-rename: STRIPE_TEST_DESTINATION_ACCT → STRIPE_TEST_CONNECT_ACCOUNT_ID. Test 4 (E2E transfer) stay-ignored (Väg C) tills verified Connect-konto provisioneras. Nya deno-tasks: test:money:unit + test:money:integration. |
| §1.7 | 147 | `js/commission.js` arkivering eller integrering | ✓ | commission.js arkiverad, helpers getKeepRate + getCommissionRate | Display-only Smart Trappstege (INAKTIV i prod). Läckage-fix fångade stadare-dashboard.html:9182. |
| §1.8 | 148 | Hardcoded hourly-priser (349/350/399) → platform_settings | ✓ | default_hourly_rate centralisering + commission-läckage-fix | 13 K1/K2-ställen centraliserade via `getDefaultHourlyRate()`: admin.html (9), bli-stadare.html (3), join-team.html (1). bli-stadare.html:511 commission=0.17 hardcode bytt till `getCommissionRate()` i samma commit (stänger hygien-task #3). Migration kördes i prod 2026-04-22 av Farhad. K3 (subscription 349, 3 ställen) + K4 (CW_SERVICES_CATALOG 349) utanför scope. |
| §1.9 | 149 | faktura.html commission_pct‖17-fallback → money.getCommission() | ✓ | commission-helpers.js + 17 ställen centraliserade i 7 filer | §1.9a infrastruktur + §1.9b applicering. Helpers: getKeepRate, getCommissionRate, getCommissionPct. Konsumenter: admin.html, faktura.html, stadare-dashboard.html, stadare-uppdrag.html, team-jobb.html, marknadsanalys.html, registrera-stadare.html, rekrytera.html. |
| §1.10 | 150 | Dokumentera money-layer i docs/architecture/money-layer.md | ✓ | Sync mot nuvarande arkitektur 2026-04-22 | Sektioner uppdaterade efter §1.2/§1.3/§1.4/§1.5/§1.7/§1.9. Aktiveringsstatus-tabell + §-mappning + §17 Frontend commission-helpers + §4.7 isMoneyLayerEnabled + §4.8 error-katalog + reconcile auto-governing dokumenterade. cleaners/companies.commission_rate-droppning kvarstår som framtida migration. |

**Status-symboler:** ✓ klar · ◯ ej påbörjad · ◑ delvis · ⊘ superseded

## Git-historik

Commits per sub-fas hittas via:
```bash
git log --grep="§1.X" --oneline
```

Konvention från 2026-04-20: commit-meddelanden använder §-referens i format `§X.Y (v3.md:rad): beskrivning`.

## Sammanfattning

- **Klart:** §1.1, §1.3, §1.4, §1.5, §1.6, §1.7, §1.8, §1.9, §1.10 (9 av 10)
- **Superseded:** §1.2 (1 av 10) – verifierad mot produktionsdata 20 apr
- **Delvis:** – (0 av 10)
- **Ej påbörjad:** – (0 av 10)

**Fas 1 komplett** pending Farhads CI-aktivering (STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET_TEST i GitHub Secrets). Destination-transfer-coverage (test 4) återaktiveras när verified Connect-account provisioneras.

## Öppna plan-beslut

### #4 per_window-prissättning (öppnat 2026-04-22)
**Kontext:** Fönsterputs kan prissättas per fönster i andra branscher.
Admin-UI tillät tidigare `per_window`-option men pricing-resolver +
boka.html hanterar inte detta – skulle gett felaktigt pris. Option
borttagen 2026-04-22 i admin.html som tillfällig fix.
**Beslut behövs:** Bygga full per_window end-to-end (5-7 h: DB-schema +
pricing-resolver + booking-create + boka.html + stadare-dashboard),
eller permanent dokumentera att fönsterputs bara stöder per_hour +
per_sqm?
**Väntar:** Farhad.

## Hygien-tasks (ej blockerare)

- Kod avviker från v3.md i reconcile-payouts (auto-activation + auto-rollback). Plan-sync behövs.
- ~~`money-layer.md` refererar code-snippets som ändrats i §1.4/§1.7 – uppdatera vid §1.10-färdigställande.~~ ✓ Klart 2026-04-22 (§1.10).
- Commit-meddelandens "Fas X.Y"-numrering matchar inte v3 §-numrering konsekvent. Ny konvention: använd v3 §-referens i framtida commit-meddelanden.
- ~~bli-stadare.html:511 commission=0.17 hardcoded – scope-läckage från §1.9. Tredje fallet efter §1.7 (9182) + plan-beslut #1 (2415). Alla tre kan samlas i en §1.9c läckage-fix senare.~~ ✓ Stängd 2026-04-22 (§1.8-commit använde getCommissionRate()).
- **platform_settings konsolidering (öppen 2026-04-22):** `base_price_per_hour=399` (pricing-resolver fallback) + `default_hourly_rate=350` (UI-default) har olika värden men semantiskt liknande. Verifiera om de ska konsolideras till en nyckel. Kräver verifiering av pricing-resolver-flow med riktig data.
- **admin.html commission-hardcodes (upptäckta 2026-04-22 under §1.8-grep):** `admin.html:1119` `value="12"` i cw-commission input (VD-onboarding) + `admin.html:3763` `: 17` fallback i cd-commission. Samma mönster som bli-stadare.html:511 — scope-läckage från §1.9. Kan samlas i framtida §1.9c läckage-fix.
- **mock-duplicering (öppen 2026-04-22):** `createMockSb`-pattern i 7 test-filer — överväg delad `_tests/_shared/mock-sb.ts` när nästa money-test läggs till (ej blockerare, inte gjort i §1.6b).
- **`cleaner_job_types` odokumenterad (öppen 2026-04-22, från §2.3-research):** tabell existerar i prod med 4 kolumner men nämns inte i [docs/4-PRODUKTIONSDATABAS.md](4-PRODUKTIONSDATABAS.md). Lägg till i §2.9b eller när Fas 3 integrerar job-infrastrukturen.
- **`jobs`-tabell saknar migration (öppen 2026-04-22, från §2.3-research):** 27 kolumner, 39 rader i prod. Ingen CREATE TABLE i `supabase/migrations/` eller `sql/`. Källa okänd (troligen manuell Studio-SQL pre-22 mars). Regel #27-överträdelse. Löses av Fas 3 eller explicit DORMANT-radering.
- **`job_matches`-tabell saknar migration (öppen 2026-04-22, från §2.3-research):** 21 kolumner, 39 rader i prod. Ingen CREATE TABLE i repo. Innehåller 7 match-kriterier (distance_ok, job_type_ok, time_ok, elevator_ok, pets_ok, materials_ok, client_rating_ok) som matchar Fas 3 §3.3-design. Löses av Fas 3.
- **Admin-policies TO-uppgradering (öppen 2026-04-22, från §2.4-verifiering):** flera admin/owner-policies i prod saknar `TO authenticated`-klausul (implicit `TO public` = mer permissivt). Defense-in-depth-uppgradering kräver medveten prod-SQL-körning (`ALTER POLICY` eller DROP+CREATE). Kandidater: `Admin can update any cleaner` (rad 4514), `Admin can update emails` (rad 4518), och troligen flera andra av de 217 policies. Kräver fullständig 217-policies audit innan batch-fix.
- **Duplikat-policy i prod customer_profiles (öppen 2026-04-22, från §2.4-verifiering):** rad 4473 `"Admin SELECT customer profiles"` och rad 5385 `"admin_reads_all_customer_profiles"` har identisk logik (samma USING + samma TO authenticated på samma tabell). Bör konsolideras (DROP en av dem) för att undvika framtida förvirring och dubbel-evaluering.
- **destination-transfer-coverage (öppen 2026-04-22, §1.6b Väg C):** test 4 i `stripe-transfer-integration.test.ts` stay-ignored tills verified Stripe Connect-konto med `transfers_enabled=true` provisioneras. Express-accounts kan inte API-verifieras. Aktivera via att lägga till `STRIPE_TEST_CONNECT_ACCOUNT_ID` i GitHub Secrets + ta bort `continue-on-error` då transfer-E2E körs.
- **§2.8 CI schema-drift (öppen 2026-04-22, deferred till Fas 2-utökning):** Bygg efter §2.1.1 (15 KRITISK-migrations). Utan prior drift-reducering skulle CI baseline:a 60+ drift-objekt = oanvändbar larm-signal. Total: 2-3h.
- **#13 admin.html:5146-5176 matching-UI bruten (öppnad 2026-04-22, Fas 3 §3.1):** Refererar `admin_settings`-tabell som ej existerar i prod (Kategori B i §2.1-audit). Matching-kategori-UI renderar tomt. Blockerar §3.8 admin-dashboard. Åtgärd: antingen skapa `admin_settings`-migration eller refaktorera admin-UI till platform_settings med en `category`-kolumn. Kräver separat scope-beslut. Se [docs/architecture/matching-algorithm.md §2](architecture/matching-algorithm.md).
- **#14 days_since_approval-härledning (öppnad 2026-04-22, Fas 3 §3.1):** Matching-design använder `cleaners.signup_date` (DATE, DEFAULT CURRENT_DATE) för exploration_bonus, matchar prod-precedens i `get_new_cleaner_boost()`-funktionen ([prod-schema.sql:513-521](../prod-schema.sql)). Åtgärd före v2-aktivering: verifiera att `signup_date` är rimlig för alla 14 aktiva cleaners (inte NULL, inte framtida, inte pre-1970). Studio COUNT: `SELECT COUNT(*) FROM cleaners WHERE signup_date IS NULL OR signup_date > CURRENT_DATE OR signup_date < '2020-01-01'`. Se [matching-algorithm.md §5.6](architecture/matching-algorithm.md).
- **#15 cleaner-kolumn-duplikater audit (öppnad 2026-04-22, Fas 3 §3.1):** Duplikater i `cleaners`-tabellen dokumenterade i [matching-algorithm.md §9.1](architecture/matching-algorithm.md): `avg_rating`/`rating`, `review_count`/`total_reviews`/`total_ratings`, `completed_jobs`/`total_jobs`, `has_fskatt`/`f_skatt_verified`, `signup_date`/`member_since`. RPC v2 läser en av varje par (prod-precedens). Framtida migration: DROP oanvända duplikater efter 30 dagars pilot + kod-grep-verifiering att inget läser dem. Scope: 2-3h analys + 1 migration. Hanteras lämpligen som del av §2.1.2 LEGACY-audit.
- ~~**#16 cleaner-job-match EF radering (öppnad 2026-04-22, Fas 3 §3.1):** Efter §3.2 konsoliderar scoring i `find_nearby_cleaners` RPC blir EF:n överflödig.~~ ✓ **Stängd 2026-04-23 (§3.2d)**: alla 4 repo-artefakter raderade (boka.html:2058-2086 try-block, supabase/functions/cleaner-job-match/ mapp, .github/workflows/deploy-edge-functions.yml:36 deploy-rad, tests/smoke.spec.ts A05-test). Lokal defensive cleaners.sort() på boka.html:2056 behålls som fallback. EF undeploy i Supabase (manuellt via CLI eller Studio) kvarstår som separat operativ åtgärd — hygien-task #26 (EF-deploy-drift 31 vs 66 EFs) fångar detta i en bredare audit.
- **#17 `rut_application_status` spökkolumn (öppnad 2026-04-23, §2.5-minifix):** Kolumn på `bookings` som [booking-create:340](../supabase/functions/booking-create/index.ts:340) skriver (`'pending'|'not_applicable'`) men ingen annan kod läser. Rut-claim-EF skrev istället till `rut_claim_status` (separat kolumn, annat värde-set). Per Farhads prod-verifiering 2026-04-23: 33 rader har `rut_application_status='pending'`, alla utan PNR — spökdata. Åtgärd i Fas 7.5: besluta konsolidering (`rut_claim_status` vinner enligt rut-claim-EFs konvention) + backfill de 33 raderna + DROP kolumnen. Se [2026-04-23-rut-infrastructure-decision.md punkt 5](audits/2026-04-23-rut-infrastructure-decision.md).
- **#18 `migrations/drafts/20260325000003_rut_claims.sql` icke-applicerad (öppnad 2026-04-23, §2.5-minifix):** CREATE TABLE-migration ligger i `drafts/`-mappen (aldrig körd av Supabase CLI). Den arkiverade rut-claim-EFn försöker `insert` i tabellen med `.catch()` som tystar felet → varje körning loggade varning i prod, ingen faktisk data sparades. Åtgärd i Fas 7.5: beslut (a) applicera migration + använd tabellen som audit-logg för framtida RUT-ansökningar, eller (b) radera drafts-filen om ny design inte kräver den. Se [2026-04-23-rut-infrastructure-decision.md punkt 6](audits/2026-04-23-rut-infrastructure-decision.md).
- **#20 SPF-post saknas för spick.se (öppnad 2026-04-23, §2.5-R2 Fas A):** DNS-lookup mot 8.8.8.8 bekräftade att `resend._domainkey.spick.se` (DKIM) + `_dmarc.spick.se` (DMARC `p=none`) finns, men **ingen SPF TXT-post** med `v=spf1`. Konsekvens: kvittomejl via Resend kan hamna i spam hos strikta mottagare (Outlook/Exchange). Åtgärd: lägg till `v=spf1 include:amazonses.com ~all` som TXT-post på spick.se via Loopia-DNS. Verifiera med `dig TXT spick.se`. Out-of-band DNS-ändring. Ingen kod-påverkan. Scope: 15 min DNS + 5 min verifikation. Eskaleras om deliverability-smoke-test i §2.5-R2 E2E visar spam-problem.
- **#21 Test-session-guard i stripe-webhook (öppnad 2026-04-23, §2.5-R2):** Selma Claras 4 paid-bokningar hade `stripe_session_id = cs_test_*` trots att boka.html använder live-key. Stripe accepterade test-nycklar i prod-miljö. Åtgärd: i stripe-webhook `handlePaymentSuccess`, guard som rejectar sessioner med `cs_test_*`-prefix i produktions-endpoint. Om test-session upptäcks → logga warning + returnera 200 OK (så Stripe inte retryr) men skapa INTE paid-state i DB. Defense-in-depth. Scope: 1h. Låg prioritet.
- **#22 Company-uppgifter-hardcodes-läckage (öppnad 2026-04-23, §2.5-R2):** Efter R2 läser generate-receipt från `platform_settings.company_*`-nycklar. Kvarstår hardcodes i [faktura.html:134,198,282](../faktura.html:134) + [generate-self-invoice:283,420](../supabase/functions/generate-self-invoice/index.ts:283) + [docs/archive/edge-functions/rut-claim/:17](../docs/archive/edge-functions/rut-claim/index.ts). Refaktor efter R4 landat (faktura.html rörs ej isolerat). Scope: 1-2h.
- **#23 Uppdatera company_address till registrerad postadress (öppnad 2026-04-23, §2.5-R2 F-R2-1):** Seed i §2.5-R2 satte `company_address='Solna, Sverige'` som fallback. Bokföringslag accepterar detta som minimum men bästa praxis är registrerad postadress. När Haghighi Consulting AB har verifierad postadress via Bolagsverket → `UPDATE platform_settings SET value='<adress>' WHERE key='company_address'`. Ingen kod-ändring. Scope: 5 min SQL.
- **#24 Refaktor generate-receipt pure-funktioner till _lib.ts (öppnad 2026-04-23, §2.5-R2 C4):** Pure-funktioner (`computePricingBreakdown`, `buildReceiptEmailHtml`, `escHtml`, `fmtKr`, osv.) är duplicerade mellan [generate-receipt/index.ts](../supabase/functions/generate-receipt/index.ts) och [_tests/receipt/receipt-email.test.ts](../supabase/functions/_tests/receipt/receipt-email.test.ts) för att testerna ska kunna importeras utan att starta `serve()`. Åtgärd: skapa `generate-receipt/_lib.ts` + importera från båda. Scope: 1-2h. Låg prioritet (testerna fungerar som är).
- **#25 `supabase db push` bruten pga migration-drift (öppnad 2026-04-23, §2.5-R2 hygien):** Under R2-deploy 23 apr 2026 kunde `supabase db push` inte tillämpa `20260423_f2_5_R2_company_settings.sql` ordentligt pga drift mellan lokal migrations-kedja och prod-state (totalt ~41 KRITISK-tabeller saknar CREATE TABLE i migrations per [§2.1-audit](audits/2026-04-22-schema-drift-analysis.md)). Farhad tvingades köra migration-innehållet manuellt i Studio SQL. Blockerar CI/CD för schema. Åtgärd: kör `§2.1.1 KRITISK-tabeller → CREATE TABLE migrations` (5-8h från Fas 2-utökning) + eventuell `supabase migration repair` för att synka lokal kedja med prod. Scope: ingår i redan planerad Fas 2-utökning.
- **#26 deploy-edge-functions.yml-drift 31 vs 66 EFs (öppnad 2026-04-23, §2.5-R2 hygien, ersätter #19):** Efter R2-hygien-add av `generate-receipt` är FUNCTIONS-arrayen 31 items, men [supabase/functions/](../supabase/functions/) har 66 kataloger. 35 EFs (53%) är osynkade från auto-deploy. Åtgärd: `npx supabase functions list` + jämför mot repo + klassificera AKTIV / DORMANT / ORPHAN / MANUAL-DEPLOY. Exempel på EFs som EJ är i workflow men troligen aktiva i prod: `admin-approve-cleaner`, `admin-approve-company`, `booking-reassign`, `charge-subscription-booking`, `customer-upsert`, `generate-self-invoice`, `noshow-refund`, `reconcile-payouts`, `serve-invoice`, `services-list`, `setup-subscription`, `stripe-connect-webhook`. Scope: 3-5h. **Ersätter hygien-task #19** (samma problem, mer specifik efter R2-fynd). Hanteras under Fas 11 eller Fas 13.
- **#27 GRANT receipt_number_seq saknades i migrations (öppnad 2026-04-23, §2.5-R2 hygien, STÄNGD denna commit):** ~~generate-receipt-EF failade vid första körning pga att `service_role` saknade `USAGE+SELECT` på `receipt_number_seq`. Fixat ad-hoc via Studio SQL 23 apr 2026 av Farhad.~~ ✓ **Versionskontrollerad 2026-04-23** i [20260423_f2_5_R2_grants.sql](../supabase/migrations/20260423_f2_5_R2_grants.sql). Preventivt även för `commission_levels_id_seq` + `spark_levels_id_seq`.
- **#28 Sequences-GRANT-audit (öppnad 2026-04-23, §2.5-R2 hygien):** Primärkälle-verifiering via `prod-schema.sql` 22 apr 2026 visar **3 sequences i public**: `receipt_number_seq`, `commission_levels_id_seq`, `spark_levels_id_seq`. Alla tre får `GRANT USAGE, SELECT TO service_role, authenticated` i #27-migrationen. **Framtida åtgärd:** när nya sequences läggs till (SERIAL-kolumner eller standalone counters), verifiera att GRANT inkluderas i samma migration — inte som eftertanke. Hanteras lämpligen via CI-check (Fas 12 E2E) eller PR-review-checklista. Scope: 0h för nuvarande state (redan fixad), ~1h för CI-check.
- **#29 Duplicerade cleaner-rader i prod (öppnad 2026-04-23, §2.5-R2 E2E-test):** Upptäckt under R2-verifiering 23 apr: Farhad Haghighi existerade som **två cleaner-rader** — solo (`hourly_rate=100`) + företag (`hourly_rate=350`). Solo-raden raderad manuellt 23 apr. Bidrog till fel prissättning i Fönsterputs-testbokningen (se #30). Framtida åtgärd: unique constraint på `cleaners(email, company_id)` eller periodisk duplikat-audit via admin.html. Scope: 1-2h (constraint-migration + eventuell backfill-granskning). Risk: befintliga dubletter utanför Farhad-raderna kan finnas — kör audit innan constraint appliceras.
- **#30 Pricing-resolver ignorerar `services.default_hourly_price` (öppnad 2026-04-23, §2.5-R2 E2E-test):** Fönsterputs-testbokning `681aaa93` 23 apr 2026 avslöjade att `pricing-resolver.ts` föll tillbaka på `cleaner.hourly_rate` (100 kr för Farhad-solo-raden, se #29) istället för att läsa `services.default_hourly_price` (349 kr för Fönsterputs). Resultat: kunden debiterades 100 kr/h istället för 349 kr/h. R2-kvittot (`KV-2026-00001`) renderade korrekt **mot den debiterade summan** — bokföringslag-compliance är intakt. Pricing-resolver-felet är separat från R2-scope. Öppnas som §2.6 "Pricing-konsistens audit" eller egen hygien-sprint. Scope: 4-6h (grep pricing-resolver-callers + trace fallback-kedja + fix + regressionstest). Relaterade: #29 (dubletten), #31 (hours-drift).
- **#31 Fönsterputs timme-drift frontend vs backend (öppnad 2026-04-23, §2.5-R2 E2E-test):** Samma testbokning `681aaa93`: boka.html visade `1h`, booking-create EF sparade `booking_hours=2.0`. Logic-drift mellan UI-beräkning och server-sidan. Kopplat till #30 — troligen samma pricing-resolver-väg som har inkonsistent timme-beräkning för per_hour vs per_sqm vs per_unit-tjänster. Scope: ingår i §2.6-audit (se #30), 1-2h extra för att trace hours-kedjan. Icke-kritisk (kund debiteras rätt mot debiterad hours, inte mot visad hours), men UX-bug.
- **#36 `Europe/Stockholm`-hardcodes i calendar-EFs (öppnad 2026-04-23, §2.7.1 Fas A5):** 4 hardcodes kvarstår efter §2.7.1 införde `platform_settings.company_timezone`. Ställen: [calendar-sync/index.ts:270, 273](../supabase/functions/calendar-sync/index.ts:270) (Google Calendar event timeZone) + [calendar-ical-feed/index.ts:127, 131, 168, 169](../supabase/functions/calendar-ical-feed/index.ts:127) (iCal VCALENDAR/VEVENT TZID). Åtgärd: ersätt med `fetchCompanyTimezone(supabase)`-helper (analog med fetchCompanyInfo från R2). Scope: 1h. Ingen funktionell påverkan idag (alla Spick-cleaners är i Europe/Stockholm), men Regel #28-läckage. Hanteras efter §2.7 eller som del av framtida calendar-refaktor.
- **#38 Harmonisera B2B-state i boka.html (öppnad 2026-04-23, §2.7.2 B-6-beslut):** Nya B2B-fält (§2.7.2) lagras i `state`-objektet (`state.bizVat`, `state.bizContact`, osv.) men befintliga `biz-name`, `biz-org`, `biz-ref` läses fortfarande direkt från DOM i submit. Inkonsistent pattern. Åtgärd: flytta gamla fält till state med `oninput`-handlers som matchar nya mönstret. Uppdatera validering + submit-payload att läsa från state. Scope: 30 min. Strikt scope-efterlevnad i §2.7.2 behöll inkonsekvensen.
- **#39 Auto-format 10-siffriga org.nr i boka.html (öppnad 2026-04-23, §2.7.2 B-7-beslut):** Befintlig regex `/^\d{6}-\d{4}$/` kräver strikt `XXXXXX-XXXX`-format. UX-förbättring: auto-insert streck när användare skriver 10 obrutna siffror. Gäller både `biz-org` (befintlig) och ny `biz-vat`. Scope: 1h (oninput-handler + testfall). Ingen funktionell regression — bara quality-of-life.
- **#40 Arkitekturdok §-numrering omkastad (öppnad 2026-04-23, §2.7.2 observation #7):** Vid extrapolering av [docs/planning/fas-2-7-b2b-kompatibilitet.md](planning/fas-2-7-b2b-kompatibilitet.md) blev §-numreringen inte exakt samma som Farhads chatt-referens (Farhad refererade "§5 boka.html UX-design", extrapolerat dokument har §5 som "Faktura-prefix-strategi"). Åtgärd: gå igenom arkitekturdok + Farhads chatt-historik → synka §-numrering ELLER dokumentera mappning i en appendix. Lågprio. Scope: 30 min. Bara för framtida referens-tydlighet.
- **#43 booking-create saknar automated testsvit (öppnad 2026-04-23, §2.7.3 Fas A4):** `supabase/functions/booking-create/` har bara `index.ts`, ingen `_tests/`-subfolder eller mock-infrastruktur. §2.7.3 levererade [docs/deploy/2.7.3-test-plan.md](deploy/2.7.3-test-plan.md) med 9 manuella tester för E2E-verifiering. Framtida åtgärd: skapa `supabase/functions/_tests/booking-create/` med unit-tests för payload-parsing, customer_type-validering, null-tvång, sanitize-helper, RUT-samverkan. Scope: 4-6h (mock supabase client, mock pricing-engine, edge-case coverage). Hanteras lämpligen som del av Fas 12 (E2E-tester + Audit-pipeline).
- **#44 serve-invoice behöver fullständig refaktor i §2.7.5 (öppnad 2026-04-23, §2.7.4 B-14):** §2.7.4 gjorde en 1-rads regex-fix för att tillåta F-prefix (`(SF|KV)` → `(SF|KV|F)`). Fullständig §2.7.5-arbete: uppdatera regex-validering (är den tight nog?), införa content-type-header per fil-typ (idag hårdkoden `text/html`), lägga till CSP-headers (idag saknas `Content-Security-Policy`), eventuell path-traversal-validering (dagens regex skyddar men defense-in-depth), rate-limiting. Scope: 2-3h. Blockerar ingen §2.7-sub-fas men är kvar-att-göra innan B2B-flödet är GA-kvalitet. **Not per #45:** kundfacing webbversion är avvecklad — #44 gäller nu främst intern/admin-användning eller framtida re-aktivering med custom domain.
- **#45 Webbversion-länk avvecklad pga Supabase CSP-sandbox (öppnad 2026-04-23, §2.7.4-fix1):** Supabase Edge Runtime strippar content-type + lägger på CSP-sandbox på alla GET-responses från user Edge Functions. Verifierat via PowerShell HEAD vs GET-test 2026-04-23. Konsekvens: serve-invoice kan inte rendera HTML-kvitto/faktura till browsern — visar källkod istället. `fix1`-commit tog bort "Öppna webbversion"-länken från båda mejl-mallar. Kvittot/fakturan finns komplett i mejlet självt. `receipt_url` sparas fortfarande i DB för framtida bruk. **Framtida lösningsalternativ:** (a) custom domain som proxar till storage direkt (kvitto.spick.se eller liknande), (b) PDF-generering via browserless.io eller pdf-lib (attachment till mejl), (c) spick.se-backend-route (Next.js eller fetch från storage i GitHub Pages-miljö svårt). Scope: 3-6h beroende på alt. Låg prioritet — alla bokföringskrav uppfyllda av mejl-innehållet.
- **#49 TIMEZONE-AUDIT** — ✓ STÄNGD 2026-04-24. 4 faser klara (kritisk + formatDate × 4 + auto-rebook + docs). Konvention live i [docs/architecture/timezone-convention.md](architecture/timezone-convention.md). 4h total.
- **#48 INFRASTRUCTURE AUDIT** — Fas 48.1 DIAGNOS ✓ (korrigerad 2026-04-24) + Fas 48.3 DEPLOY ✓ klara. Återstår: Fas 48.2 (schema_migrations-repair + filnamn-refaktorering, 4-6h), Fas 48.4 (CI-härdning, 1-2h), Fas 48.5 (drift-check, 2-3h), Fas 48.6 (retrospektiv, 30 min). 7-12h kvar.
- **#47 Verifiera shadow-mode logging innan v2 aktiveras (öppnad 2026-04-23, Fas 3 §3.2a):** §3.2a seed:ar `platform_settings.matching_algorithm_version='v1'` (default = nuvarande beteende). Designdokumentet ([matching-algorithm.md §10.1](architecture/matching-algorithm.md)) föreskriver `'shadow'`-läge (v1 till kund, v2 bakom kulisserna + diff-loggning) som mellansteg innan `'v2'`-rollout. **§3.2a implementerar INTE shadow-loggning** — `matching_shadow_log`-tabellen är DEFERRED till §3.9. Åtgärd innan `UPDATE platform_settings SET value='v2' WHERE key='matching_algorithm_version'`: (1) verifiera att §3.2b (boka.html skickar alla params) + §3.2c-d (DORMANT-radering) är landade, (2) implementera `matching_shadow_log`-tabell + loggning i §3.9, (3) kör 48h shadow för diff-analys, (4) rollout 10%/100% per [matching-algorithm.md §10.3](architecture/matching-algorithm.md). **Not:** User-spec i §3.2a bad om hygien-task #17, men #17 redan upptagen (rut_application_status, öppnad 2026-04-23). Numrering fortsätter naturligt från #46 → #47. Scope: 4-6h (tabell-migration + RPC-wrapper + loggning-trigger). Ingår i §3.9 pilot-analys-arbete.
- **#46 Bokning d2499a79-c415... har business_name='5593447443' (öppnad 2026-04-23, §2.7.4 smoke-test):** Testbokning under E2E-verifiering hade session-state-bugg där `business_name` fick värdet av `business_org_number`. Icke-reproducerbar efter cache-clear. Inte produktionsbug — inträffade under manuell test med restaurerad sessionStorage. Åtgärd: backfilla om publik exposure blir kritisk (UPDATE bookings SET business_name='...' WHERE id='d2499a79-c415-...'). Annars: låt vara tills kunden upptäcker eller bokningen raderas. Scope: 2 min SQL.
- **#19 EF-deploy-drift, 66 repo vs 30 workflow (öppnad 2026-04-23, från §2.5-minifix C0.5):** `ls supabase/functions/` ger **66 EF-kataloger** i repo men [.github/workflows/deploy-edge-functions.yml](../.github/workflows/deploy-edge-functions.yml) deployar bara 30 via explicit FUNCTIONS-array. 36 EFs (55 %) är alltså osynkade från auto-deploy: manuellt deployade, aldrig deployade, eller orphans. Exempel från repo: `admin-approve-cleaner`, `admin-approve-company`, `admin-create-company`, `admin-mark-payouts-paid`, `admin-reject-company`, `auto-delegate`, `auto-rebook`, `booking-auto-timeout`, `booking-reassign`, `calendar-google-auth`, `calendar-google-callback`, `calendar-ical-feed`, `calendar-sync`, `charge-subscription-booking`, `cleaner-booking-response`, `cleaner-og`, `company-accept-invite`, `company-invite-member`, `company-propose-substitute`, `company-self-signup`, `customer-approve-proposal`, `customer-check-auto-delegation`, `customer-upsert`, `expire-team-invitations`, `generate-receipt`, `generate-self-invoice`, `noshow-refund`, `poll-stripe-onboarding-status`, `public-auth-exchange`, `public-auth-link`, `reconcile-payouts`, `serve-invoice`, `services-list`, `setup-subscription`, `stripe-connect-webhook`. Åtgärd: audit via `supabase functions list --project-ref urjeijcncsyuletprydy` → jämför mot `ls supabase/functions/` → klassificera (aktiv-manuellt-deployad / död-kod-orphan / aldrig-deployad-prototyp) → uppdatera workflow-array eller arkivera per kategori. Scope: 3-5h. Icke-blockerare för någon pågående fas, men auto-deploy fungerar inte som "single source of truth" idag. Hanteras lämpligen som hygien-sub-fas under Fas 11 (CLAUDE.md auto-gen) eller Fas 13 (GA-readiness).

## Fas 3 — Matching v2 (pågår)

Referens: [docs/planning/spick-arkitekturplan-v3.md rad 199-233](planning/spick-arkitekturplan-v3.md) (§3.1-§3.9). Designdokument: [docs/architecture/matching-algorithm.md](architecture/matching-algorithm.md) (commit f967e5d).

**Motivation:** Cold-start-dödsloop + endimensionell distance-sort + arkitektur-fragmentering (RPC + `cleaner-job-match` EF med olika vikter). §3.1 levererade formeln, §3.2 verkställer i SQL/kod.

**§3.2-splittring (beslut 2026-04-23):** Uppdelning i sub-steg för att hålla varje commit liten + verifierbar:
- §3.2a — SQL-migration (find_nearby_cleaners v2 + audit-kolumner + seed)
- §3.2b — boka.html-uppdatering (skicka nya params + läs match_score)
- §3.2c — radera DORMANT `jobs`/`job_matches`/`cleaner_job_types` (per designdok §12)
- §3.2d — radera `cleaner-job-match` EF + workflow + smoke-test

| Sub-fas | v3.md rad | Beskrivning | Status | Commit |
|---------|----------:|-------------|:------:|---|
| §3.1 | 205 | Designdokument matching-algorithm.md | ✓ | `f967e5d` |
| §3.2a | 207 | find_nearby_cleaners v2 + audit-kolumner + platform_settings seed | ✓ (kod) / ◑ (deploy) | `6bbd1a4` |
| §3.2b | 207 | boka.html skickar booking_date/time/hours/has_pets/has_elevator/materials/customer_id | ✓ | `afdcfa4` |
| §3.2c | 207 | DROP `jobs`/`job_matches`/`cleaner_job_types` (DORMANT) | ✓ | `aa3b282` + deploy 2026-04-24 |
| §3.2d | 207 | cleaner-job-match EF radering | ✓ | `9281d4c` |
| §3.7 partial | 211 | chosen_cleaner_match_score + matching_algorithm_version audit-writing | ✓ | `f8b91b8` |
| §3.3 | 208 | Vikter implementerade | ✓ implicit | i §3.2a |
| §3.4 | 209 | History-multiplier | ✓ implicit | i §3.2a (inaktiv utan customer_id) |
| §3.5 | 210 | VIEW-indirektion | ✓ STÄNGD (ej tillämplig) | (denna commit) |
| §3.6, §3.7 full, §3.8, §3.9 | 211-233 | Materialiserad vy, A/B-ramverk, admin-UI, pilot-analys | ◯ | — |

> **⚠️ BLOCKERAD från prod-deploy** — upptäckt 2026-04-23 kväll att `supabase_migrations.schema_migrations` är ur sync med repo (1 rad i prod vs 52 filer i repo). Se [docs/planning/todo-migrations-deploy-audit-2026-04-23.md](planning/todo-migrations-deploy-audit-2026-04-23.md). §3.2a manuell deploy via Studio SQL kan köras för att oblockera Fas 3-progress, men strukturell repair behövs före §3.2b deploy.

> **§3.2c** ✓ STÄNGD 2026-04-24. DORMANT-tabeller borta i prod (manuell Studio-deploy verifierad). Migration `20260424_f3_2c_drop_dormant_tables.sql`. Studio visade 42P01-artefakt mot slutet men transaktionen körde framgångsrikt — primärkälla-verifiering bekräftar 0 tabeller + 0 cron + 0 functions + 0 FK-constraints kvar + find_nearby_cleaners fungerar.

**§3.2a-leverabel:**
- Utökad `find_nearby_cleaners`-signatur: 9 parametrar (2 obligatoriska + 7 NULLABLE DEFAULT NULL för bakåtkompat)
- RETURNS TABLE utökad med: `match_score`, `distance_score`, `rating_score`, `completed_jobs_score`, `preference_match_score`, `verified_score`, `exploration_bonus`, `history_multiplier`, `company_display_name` (33 kolumner totalt)
- Hard filter utökade: `status='aktiv'`, `is_blocked=false`, pet-disqualifier, availability (de två sista bara om relevanta params angivna)
- Bayesian rating-smoothing (C=10, PRIOR=4.5), cold-start-boost (30-dagars fönster, exploration-cap), history-multiplier ×1.10
- Deterministisk tie-break: match_score → distance → rating → reviews → id
- Audit-kolumner: `bookings.chosen_cleaner_match_score numeric(4,3)`, `bookings.matching_algorithm_version text`
- Platform settings seed: `matching_algorithm_version='v1'` (rollout till 'v2' i §3.7)
- Index: `idx_cleaners_approval_active` (hard filter partial), `idx_cleaners_home_geo` (PostGIS GIST), `idx_availability_v2_lookup`

**Avvikelser från designdokumentet (bokförda i migration-fil):**
- `verified_score` inkluderar `is_approved` (designdok §5.5 exkluderar; user-spec auktoritativ)
- `history_multiplier` joinar `ratings.customer_id = param` via `uuid` (designdok §7 säger `bookings.customer_email`; user-spec anger uuid-param, enklare + undviker DORMANT `ratings.job_id`-FK)
- `ratings.rating` används (designdok säger felaktigt `ratings.score`)

**Bakåtkompatibilitet (§3.2b ännu inte landad):** boka.html:1928 fortsätter fungera med 2-arg-anrop. När nya params är NULL: preference_match_score + history_multiplier = 1.0 (neutraliserade).

**§3.7 partial — audit-writing:** `chosen_cleaner_match_score` + `matching_algorithm_version` skrivs till bookings vid varje booking-create. Grundar A/B-analys i §3.9. `matching_algorithm_version` läses server-side från `platform_settings` (klient otrusted). Full §3.7 A/B-ramverk (shadow mode, v2-aktivering, traffic-split) kvarstår.

## Fas 2.5 — Minor RUT/dokument-fix (pågår)

**Motivation:** Separata från Fas 2 (migrations-sanering). Skapade 2026-04-23 efter Spår B-audit (RUT-compliance) avslöjade 5 systemiska 🔴-risker. Farhad beslutade minifix + stegvisa dokument-fix istället för full bygge (full refaktor → Fas 7.5).

| Sub-fas | Beskrivning | Status | Commit |
|---|---|:---:|---|
| §2.5-minifix | rut-claim-trigger avstängd + EF arkiverad + undeploy | ✓ | `d901cc1` |
| §2.5-R1 | Revisor-audit 4 dokument-flöden mot Bokföringslag + MervL | ✓ | (rapport, ingen kod) |
| §2.5-R2 | Bokföringslag-kompatibelt kund-kvitto via mejl + 9 platform_settings seed + receipt_email_sent_at idempotens | ✓ | `8790de0` |
| §2.5-R2 hygien | Grants-migration (receipt_number_seq + preventiv) + deploy-yml (generate-receipt) + progress-sync | ✓ | (denna commit) |
| §2.5-R3 | Moms-rad i `faktura.html` D1/D3 | ◯ | — |
| §2.5-R4 | Persistera D1/D3 eller avveckla (scope-beslut öppet) | ◯ | — |
| §2.5-R5 | Kreditnota-flöde vid refund + adressfält + städar-mejl | ◯ | — |

**Beroenden:** R2 fristående ✓. R3 fristående. R4 kräver scope-beslut. R5 beror på R4.

## Fas 2.7 — B2B-kompatibilitet (kort-only) (pågår)

**Motivation:** Företagskunder behöver formell faktura med F-YYYY-NNNNN-prefix som uppfyller BokfL 5 kap 7§ + MervL 11 kap 8§. KV-kvittot räcker inte för företagsbokföring (Fortnox/Visma kräver fakturanummer). Rafa-pilot har stor B2B-del — begränsad av dagens B2C-only-flöde.

**Arkitekturdokument:** [docs/planning/fas-2-7-b2b-kompatibilitet.md](planning/fas-2-7-b2b-kompatibilitet.md) (14 sektioner + appendix).

**Designbeslut (verifierade 2026-04-23):**

- RPC: `generate_b2b_invoice_number()` — undviker namnkollision med befintliga `generate_invoice_number()` (returnerar SF- för städar-självfaktura)
- Sequence: `b2b_invoice_number_seq` — monotoniskt ökande genom alla år
- Storage-bucket: `invoices/` (delad med SF-) — semantisk konsistens (fakturor i invoices/, kvitton i receipts/)
- Timezone: config-driven via `platform_settings.company_timezone` (ny nyckel, seed i §2.7.1)

| Sub-fas | Beskrivning | Status | Commit |
|---|---|:---:|---|
| §2.7.1 | DB-schema (7 kolumner + sequence + RPC + timezone seed) + serve-invoice i deploy-yml | ✓ | `9889b93` |
| §2.7.2 | UI-form för B2B-data i boka.html (6 nya fält + fakturaadress-checkbox + validering) | ✓ | `d8c0778` |
| §2.7.3 | booking-create sparar 10 B2B-fält + customer_type-validering (hybrid) + sanitize-helper + null-tvång | ✓ | `de5493e` |
| §2.7.4 | generate-receipt FAKTURA-rendering för B2B + F-serien + dubbel-mejl + serve-invoice F-regex | ✓ | (denna commit) |
| §2.7.5 | serve-invoice regex-utökning för F-prefix | ◯ | — |
| §2.7.6 | Admin-UI för B2B-faktura + E2E-test | ◯ | — |

**Total estimat:** 10-15h över 6 commits. Kortare än §2.5 tack vare R2-infrastruktur-återanvändning.

**Blockerare att verifiera före §2.7.2-start:**
- Migration applicerad i prod (se [docs/deploy/2.7.1-manual-apply.md](deploy/2.7.1-manual-apply.md))
- `SELECT generate_b2b_invoice_number()` returnerar `F-2026-00001`

**R2-verifiering i prod 2026-04-23:**
- Första kvittot utställt: **`KV-2026-00001`** för bokning `681aaa93` (Fönsterputs-testbokning). Sekventiell serie via `generate_receipt_number()`.
- Alla 11 BokfL 5 kap 7§ + MervL 11 kap 8§-fält renderade korrekt i mejlet.
- 3 retrospektiva fynd hanterade i första hygien-commit (`e854ee5`): (a) `receipt_number_seq` GRANT fix ad-hoc i Studio → versionskontrolleras i [20260423_f2_5_R2_grants.sql](../supabase/migrations/20260423_f2_5_R2_grants.sql), (b) `generate-receipt` saknas i deploy-yml → tillagd, (c) hygien-tasks #25-28 öppnade.
- 3 ytterligare fynd under E2E-test (denna commit): (d) duplicerade cleaner-rader #29, (e) pricing-resolver ignorerar services.default_hourly_price #30, (f) hours-drift frontend vs backend #31. Alla utanför R2-scope — kvittot renderade korrekt mot faktiskt debiterad summa, pricing-felet är sibling-bug.

## TODOs (post-Fas-1-upptäckter)

### TODO: Avtals-revidering (KRITISK, blockerar Todo A)
- Prio: **KRITISK** (Fråga 1 commission-läckage = pågående avtalsbrott-risk)
- Estimat: 1-2h revidering + juristtid (~1500-3000 kr)
- Fil: [docs/planning/todo-avtals-revidering-2026-04-22.md](planning/todo-avtals-revidering-2026-04-22.md)
- 4 frågor: commission-läckage, §5.7 RUT-avslag, prisändringsrätt, signatur-DB-logg
- Beroendeschema: Farhads §5.7-beslut → jurist → PR1 text → Todo A UI-bygge (PR2 signatur-DB-logg kan gå parallellt)
- Status: scope klart, §5.7-policybeslut + juristgranskning pending

### TODO A: RUT Notification Transparency
- Prio: HÖG (pre-Rafa-pilot)
- Estimat: 2-4h
- Fil: [docs/planning/todo-a-rut-notification-transparency.md](planning/todo-a-rut-notification-transparency.md)
- Status: **BLOCKERAD** av avtals-revidering (se ovan)
- Kan byggas när avtal uppdaterat + §5.7-policy klarlagd
- Uppdragsavtal-audit genomförd 22 apr: se [docs/audits/2026-04-22-uppdragsavtal-vs-todo-a.md](audits/2026-04-22-uppdragsavtal-vs-todo-a.md). Status: **KRÄVER_AVTAL_UPPDATERING** (Krav 2 RUT-avslag saknas i §5.6; Krav 1 + Krav 3 MATCHAR). Avtals-PR måste landa före notifikations-bygget.

### TODO B: RUT Two-Step Payout Pipeline
- Prio: MEDIUM
- Estimat: 10-15h
- Fil: [docs/planning/todo-b-rut-two-step-payout.md](planning/todo-b-rut-two-step-payout.md)
- Status: scope-beslut pending (§1.11 vs Fas 8 vs standalone)
- Beroende på Todo A

## Schemalagda framtida faser

### Fas 7.5 — RUT-infrastruktur (öppnad 2026-04-23)

**Motivation:** Spår B-audit 2026-04-23 avslöjade 5 systemiska 🔴-risker i RUT-ansökningsinfrastrukturen (kolumnmismatch, fel XML-matematik, saknad timing-guard, spökkolumn, icke-applicerad migration). Noll ekonomisk exponering idag (`SKV_API_KEY` tom + 0 historiska PNR), men infrastrukturen är inte produktionsklar. Minifix 2026-04-23 (§2.5) stängde triggern + arkiverade EF — full refaktor skjuten hit.

**Placering i v3-ordning:** mellan Fas 7 och Fas 8 (insatt i [spick-arkitekturplan-v3.md](planning/spick-arkitekturplan-v3.md)).

**Beroenden:** inga — kan startas när som helst efter 2026-04-23. Rafa-pilot kan skalas först när Fas 7.5 är klar OCH `SKV_API_KEY` satts till verkligt värde.

**Scope: 25-35h** över 6 sub-faser (§7.5.1-§7.5.6 — grovskissade i v3-planen, detaljeras när fasen startar).

**Primärkälla vid start:** [docs/audits/2026-04-23-rut-infrastructure-decision.md](audits/2026-04-23-rut-infrastructure-decision.md) + arkiverad kod i [docs/archive/edge-functions/rut-claim/](archive/edge-functions/rut-claim/).

## Session-lärdomar (löpande)

Numrering fortsätter från 5 lärdomar i [session-snapshot-2026-04-22.md](planning/session-snapshot-2026-04-22.md).

### #6 Research-drift — kod-grep ≠ primärkälla när schema är sanningen (2026-04-23)

Verifiera mot DB-schema före kod-antaganden. Kod-grep visar vad koden försöker göra, inte om den faktiskt fungerar. Vid drift mellan grep och schema: schema vinner. Samma mönster upptäckt i både §3.1-research (`customer_profiles.preferences` JSONB antagen men existerar ej) och §2.5-RUT-audit (stripe-webhook läser `booking.customer_pnr_hash` men boka.html skickar aldrig hashen → gatekeeper alltid false, hela flödet en no-op).

## Stängda plan-beslut

### #1 boka.html scope (stängt 2026-04-21)
Beslut: alt D – SAFETY_FALLBACK_RATE-konstant för 15 defensive fallbacks (14 listade i scope-rapport 20 apr + 1 missad pga grep-truncering, alla samma K1-pattern). boka.html förblir utanför §1.8-scope (som behåller admin.html + bli-stadare.html + join-team.html). De 15 fallback-ställena var defensive programming vid DB-kedjebrott, inte hardcoded pricing. Primärväg oförändrad: `service_price (DB) > cleaner.hourly_rate (DB) > SAFETY_FALLBACK_RATE`.

### #3 stripe-checkout radering (stängt 2026-04-21)
Beslut: alt 1 – radera kod + CI + docs. EF undeploy:ad som separat manuell åtgärd av Farhad.

### #2 fix-skript-utvidgning §2.7 (stängt 2026-04-22)
Beslut: Väg A – radera alla 19 fix-skript (scope växte från v3:s 8+2 till faktiska 19). Alla K1-klassade. git log är arkivet. v3.md §2.7 + §4.10 uppdaterade med noter om faktiskt scope.

## Session-notes-konvention

Alla framtida prompts ska referera v3-sub-fas (§X.Y) INTE session-numrering ("1.10.3"). Gamla session-numrering är **deprecated per 2026-04-20**.

## Startpunkt för ny session

1. Läs denna fil
2. Verifiera HEAD + senaste commits mot tabellen
3. Kontrollera öppna plan-beslut – är någon avklarad?
4. Välj nästa §-fas från "Ej påbörjad"
