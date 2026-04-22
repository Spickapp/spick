# Session handoff — Sprint 1 (24 april 2026)

**Föregående session:** 23 april kväll (commit `4400245`).
**Denna session:** Sprint 1 (stabilisering före skalning).
**Commits:** `25bd74f`, `a9e0b3f`, `6bdf8c5`, `580281c`, `e128016`, + unique-constraint-migration (senaste).
**Status vid avslut:** Sprint 1 Dag 1-3 klart. Dag 4-5 omdesignat (§2.1.1-utökning skjuts till Sprint 7).

---

## Strategisk kontext

Farhads mål: "Tusentals bokningar per dag, så automatiserat som möjligt, marknadsdominans".
V3-planen siktade på 1500/månad (~50/dag). Målet är 20-60× större.

Accepterad 8-sprint-plan (2026-04-24):
1. **Sprint 1 (denna vecka):** STABILISERING — stoppa aktiva läckor innan skalning
2. Sprint 2 (2-3v): Fas 3 Matching klart
3. Sprint 3 (3-4v): Fas 6 Events + Fas 7.5 RUT parallellt
4. Sprint 4 (2v): Fas 5 Retention/Recurring
5. Sprint 5 (6-8v): Fas 8 Dispute + Full Escrow (EU-deadline 2 dec 2026)
6. Sprint 6 (4-5v): Fas 9 VD-autonomi + Fas 10 Observability parallellt
7. Sprint 7 (3-4v): **NY** — Tusentals-bokningar-härdning (rate limiting, cache, load-test, idempotency)
8. Sprint 8 (resterande): Fas 4/12/13 polish + GA

Detta avviker från v3: ny Sprint 7, Fas 4 skjuts bakåt, Fas 7/11 skjuts till sidospår.

---

## Sprint 1 complete summary (2026-04-24)

### 1. PNR-fält avstängt i boka.html ✅ (Dag 1 — commit `25bd74f`, pushad + GitHub Pages deployed)

**Varför:** GDPR-fynd från 23 apr — 11 klartext-PNR från 3 riktiga kunder ackumulerade i prod trots löfte om kryptering. Utan fix = fortsatt ackumulation vid varje ny RUT-bokning.

**Implementation:** Kill-switch `PNR_FIELD_DISABLED = true` + guards på alla 7 visa-ställen + HTML dolt via `display:none !important`.

**Data-flöde verifierat dött:** `rawPnr = ''` → `customer_pnr: undefined` → booking-create tar aldrig emot PNR.

**UI-påverkan:** RUT-rabatt (50%) visas och tillämpas som tidigare. Endast PNR-fältet är dolt. Ärlig text ersätter vilseledande "krypteras..."-text.

**Återaktivering:** Endast efter Fas 7.5 §7.5.1 Skatteverket-API-research + korrekt server-side-kryptering + jurist-verifierad text.

**Filer ändrade:**
- `boka.html` — 7 edits (kill-switch + HTML + 5 JS-guards)
- `docs/sanning/pnr-och-gdpr.md` — status uppdaterad

### 2. Sanningsfilen uppdaterad ✅

`docs/sanning/pnr-och-gdpr.md`:
- Status: AKTIVT PROBLEM → STABILISERAT
- Risker: 🔴 aktiv insamling → 🟢 stoppad
- Planerad åtgärd steg 1: markerad KLART
- Hårda låsningar: förtydligade kring återaktivering

### 3. Pricing-resolver min-pris-guard + services-fallback ✅ (Dag 2 — commit `a9e0b3f`, booking-create EF deployed på 54s)

**Bakgrund:** Hygien #30 (2026-04-23). Fönsterputs-testbokning `681aaa93` debiterades 100 kr/h (cleaner-solo-dubbletten) istället för 349 kr/h eftersom pricing-resolver föll tillbaka på `cleaner.hourly_rate` utan min-pris-kontroll.

**Fix (3 delar):**

1. **Seed-migration** `20260424230000_sprint1d2_min_hourly_rate_seed.sql` — `platform_settings.min_hourly_rate=200`
2. **Ny 6-stegs-hierarki** i `supabase/functions/_shared/pricing-resolver.ts`:
   - Lager 4 (`cleaner.hourly_rate`) endast om >= `min_hourly_rate`
   - NY lager 5: `services.default_hourly_price`
   - Lager 6: `platform_settings.base_price_per_hour`
3. **13 unit-tester** i `supabase/functions/_tests/money/pricing-resolver.test.ts` — alla passerar, plus regressionstest: 134 money-tester, 0 failures.

**Verifiering:** booking-create EF live i prod sedan 2026-04-24. Även utan seed-migration i DB skyddar koden via fallback `min_hourly_rate=200` i resolvern.

### 4. Defensive cleaner-unique-constraint migration ✅ (Dag 3 — migration skriven, ej deployad pga run-migrations CI-drift)

**Bakgrund:** Hygien #29. Farhad existerade som två cleaner-rader (solo 100 kr/h + företag 350 kr/h). Solo raderad manuellt 23 apr. Constraint förhindrar upprepning.

**Fil:** `supabase/migrations/20260424230500_sprint1d3_cleaners_email_unique.sql`

**Design:**
- UNIQUE INDEX på `(lower(email), COALESCE(company_id, zero-uuid))` (case-insensitive + NULL-säker)
- Samma email får finnas på flera företag (ägare med flera bolag), ej i samma företag
- Pre-check: migration abortera med tydligt felmeddelande om kvarvarande dubletter finns
- Rollback: `DROP INDEX IF EXISTS cleaners_email_company_unique_idx`

**Deploy-status:** Commit ligger i main. `run-migrations.yml` är bruten (pre-existing Fas 2.X-drift). Migration körs manuellt i Studio — se "Öppna manuella steg" nedan.

### 5. DB-audit-workflow (infrastruktur-försök) ⚠️ (Dag 3 — nätverk-blockad i runner)

**Mål:** Automatiserad kanal för prod-read-only audits utan manuell Studio-query.

**Status:** Workflow skriven (`.github/workflows/db-audit.yml`) men fail:ad att ansluta till prod-DB:
- Pooler-URL: `FATAL: tenant/user postgres.{ref} not found` — okänd region-config
- Direct-URL: `Network is unreachable` (IPv6-only host, runner saknar IPv6)

**Beslut:** Parkeras. Fortsättning via annan väg senare: (a) bygga admin-query EF + curl, (b) Supabase REST API-polling, (c) fixa pooler-region. Manuell Studio-query räcker för Sprint 1-2.

---

## Öppna manuella steg (Farhad gör själv i PROD Studio)

### Steg 1 — Droppa backup-tabell (5 sek)

**Kontext:** Skapades 23 apr vid verifiering innan commission-UPDATE. UPDATE kördes aldrig. Tabellen användes inte men ligger kvar.

**Kör i PROD SQL Editor:**

```sql
-- Verifiera först att tabellen finns och är tom/testdata
SELECT COUNT(*) AS rows, MIN(id) AS sample_id
FROM bookings_backup_commission_17_before_sync;

-- Om rader > 0, bekräfta att de matchar bookings (det är en kopia)
SELECT COUNT(*) AS matching_bookings
FROM bookings_backup_commission_17_before_sync b
INNER JOIN bookings ON bookings.id = b.id;

-- Droppa om bekräftat
DROP TABLE IF EXISTS bookings_backup_commission_17_before_sync;

-- Verifiera borttagning
SELECT COUNT(*) FROM information_schema.tables
WHERE table_name = 'bookings_backup_commission_17_before_sync';
-- Förväntat: 0
```

### Steg 2 — Radera `RUT_PNR_ENCRYPTION_KEY` från PROD vault

**Kontext:** Skapades av misstag när RUT.1 byggdes i fel Studio 23 apr förmiddag.
UUID: `86767fda-4dcf-44c6-8869-7e5b9a0145f1`

**Innan radering, verifiera att inga rader använder nyckeln:**

```sql
-- Båda ska returnera 0
SELECT COUNT(*) FROM bookings WHERE customer_pnr_encrypted IS NOT NULL;
SELECT COUNT(*) FROM bookings WHERE customer_pnr_hash IS NOT NULL;
```

**Om båda = 0 → radera i Studio:**
1. PROD Studio → Settings → Vault
2. Sök UUID `86767fda-4dcf-44c6-8869-7e5b9a0145f1`
3. Delete

**VIKTIGT:** Rör INTE den lokala vault-nyckeln (annan UUID). Den behålls intakt.

---

## Regler som obligatoriska per commit (bekräftat 24 apr)

Alla commits i Sprint 1+ ska följa dessa. Ingen gissning, aldrig antagande.

- **#26 Grep-before-edit:** Läs exakt text + kartlägg alla callers innan str_replace
- **#27 Scope-respekt:** Gör vad som blev ombedd, inget mer
- **#28 Pricing-konsolidering:** En källa för värden (`platform_settings`)
- **#29 Audit-först:** Läs hela audit-filen innan agera på "audit säger X"
- **#30 Ingen regulator-gissning:** Skatteverket/GDPR/BokfL/Stripe verifieras mot spec
- **#31 Primärkälla över memory:** `prod-schema.sql` + sanningsfiler slår memory

---

## Nästa steg

### Omedelbart (Farhad, 10 min)

1. Kör **Steg 1** (backup-drop) och **Steg 3** (seed min_hourly_rate) i Studio
2. Kör **Steg 4** (audit-queries) och rapportera resultaten
3. Baserat på audit: kör eller blockera **Steg 5** (unique-constraint)

### Sprint 2 — Fas 3 Matching-avslut (2-3 veckor)

§3.6, §3.7-full, §3.8, §3.9 (se `docs/v3-phase1-progress.md` Fas 3-sektion).

Matching-automation blir "produktion-ready" = matchning skalbart vid 100+ städare/stad. Kräver shadow-mode, traffic-split, admin-dashboard, pilot-analys efter 30 dgrs data.

### Parallellt Sprint 2 kan förberedas

- **Design-dokument Fas 6 Events** (för Sprint 3): event-types, schema, helper-pattern
- **§7.5.1 research Fas 7.5** (för Sprint 3): Farhad + web_search om Skatteverkets API-spec 2026

---

## Primärkällor för denna session

- `docs/sanning/pnr-och-gdpr.md` (uppdaterad idag)
- `docs/sanning/provision.md` (oförändrad)
- `docs/sanning/rut.md` (oförändrad)
- `docs/planning/todo-pnr-infrastructure-2026-04-23.md` (Åtgärd 1 bockas av)
- `docs/audits/2026-04-23-rut-infrastructure-decision.md` (post-mortem bakgrund)
- `docs/planning/spick-arkitekturplan-v3.md` (v3.1, 8-sprint-plan för skalning)
- `docs/v3-phase1-progress.md` (fas-status)

---

## Miljö och checkpoints

- **Repo-status vid avslut:** Clean på main. 5 commits under Sprint 1: `25bd74f` (PNR), `a9e0b3f` (pricing-resolver), `6bdf8c5` + `580281c` + `e128016` (db-audit-försök), + pending unique-constraint.
- **Prod:** PNR-fix live via GitHub Pages. booking-create EF live med pricing-min-guard + services-fallback. 134/134 money-tester passerar.
- **PROD DB:** Oförändrad. 3-5 manuella Studio-steg väntar (se "Öppna manuella steg").
- **Stripe:** LIVE mode, oförändrat. Inga transaktioner påverkade.
- **RUT:** Förblir AVSTÄNGD. Fas 7.5 ej startad.
- **Auto-deploy:** Bekräftat fungerar för Edge Functions + GitHub Pages. Bekräftat BRUTEN för migrations (`run-migrations.yml` exit 1, Fas 2.X-drift). Manuell Studio för nya migrations.

## Sprint 1-lärdomar

1. **GitHub Pages auto-deploy fungerar** för pushar till main (verifierat 3 gånger: PNR, pricing, db-audit). 15-20 sek deploy-tid.
2. **Edge Functions auto-deploy fungerar** via `deploy-edge-functions.yml` (verifierat för booking-create Sprint 1 Dag 2). 54 sek för 31 funktioner.
3. **run-migrations-workflow är bruten** sedan Fas 2.X-drift. Kräver omdesign eller §2.1.1-utökning-slutförande.
4. **DB-audit-workflow blockad** av nätverk/region-config. Parkeras för senare sprint.
5. **Code-first defensive pattern lönar sig:** pricing-resolver fallback:ar till min=200 i koden → fix gäller även utan DB-seed.

## Kommande handoff-format

Nästa session läser i denna ordning:
1. `docs/START_HERE.md`
2. `docs/sanning/*.md` (3 sanningsfiler)
3. `docs/sessions/SESSION-HANDOFF_2026-04-24-sprint-1-dag-1.md` (denna fil, senaste)
4. `docs/v3-phase1-progress.md` + `docs/planning/spick-arkitekturplan-v3.md`
