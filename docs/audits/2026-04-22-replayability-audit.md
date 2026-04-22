# Replayability Audit — 2026-04-22

**Status:** BLOCKERANDE för Fas 48.5 Del B drift-check CI.
**Scope:** Fas 2.X (ny sprint, tidigare ej planerad).
**Estimat:** 30-50h realistiskt (auditens tidigare 16-24h var underskattning).
**Förutsättning för:** schema-drift-check CI, alla framtida migrations-disciplin.

---

## Kontext

Under arbetet med Fas 48.5 Del B (schema-drift-check CI-workflow, 2026-04-22)
körde vi `supabase db reset --local` för att verifiera att migrations-filerna
kan bygga en fresh DB som matchar prod. Resetten failade upprepade gånger,
vilket avslöjade att dagens migrations-mapp inte är replay-bar.

Detta är djupare drift än schema-drift-auditen 2026-04-22 tidigare rapporterade.
Den auditen räknade tabeller som saknade CREATE TABLE-migration (15 KRITISKA).
Denna replayability-audit upptäcker att drift inte bara gäller individuella
objekt utan hela migration-ordningen.

## Upptäckta problem

### P1 — Saknade tabeller som gamla migrations förutsätter existerar

Gamla migrations (001-010) gör ALTER TABLE på tabeller vars CREATE TABLE
inte finns i någon migration. Upptäckta under db reset-iteration:

- `cleaner_applications` — 001_push.sql ALTER:ar utan CREATE. Bootstrap 00001 skapad idag.
- `bookings`, `cleaners`, `customer_profiles` — skapas i §2.1.1 20260422-serien (för sent).
- `analytics_events`, `messages`, `referrals` — CREATE TABLE finns men behöver ordning-verifiering.
- `reviews` — CREATE TABLE i gamla migrations, men finns INTE som tabell i prod (är en vy).

**Totalt kända tabeller med ordning/saknad-problem: 13 st (från `001-010`-ALTER-analys).**

### P2 — Systemisk Studio-drift

Prod har fått sin form genom migrations + manuella Studio-ingrepp. Migrations-
filerna beskriver en parallell historia som aldrig exakt hänt i prod:

- `reviews` är en VIEW i prod, men flera migrations skapar den som TABLE, sedan
  ALTER:ar den, sedan skapar policies. Var konverterades den till VIEW? Okänt.
- `20260401194505_create_missing_views.sql` drop:ar triggers på reviews men
  skapar inte själva vyn i prod-form. Migrationen är ofullständig.
- Flera tabeller har MULTIPLA CREATE TABLE-uttryck över olika migrations
  (003_subs.sql + 20260325000001_production_ready.sql för reviews, t.ex.).

### P3 — CREATE POLICY / CREATE FUNCTION forward-ref constraints

(Löst idag via konsolidering till 20260422130000_fas_2_1_1_all_policies.sql)

**Lärdomar:**
- `CREATE POLICY` validerar tabell-refs INLINE vid CREATE. Policies måste
  definieras EFTER alla tabeller de refererar.
- `CREATE FUNCTION ... LANGUAGE sql` parsar body inline. LANGUAGE plpgsql
  har sen binding. För forward-refs: använd plpgsql.
- Verifierat via docker postgres:17 test 2026-04-22 11:30.

### P4 — Beroende-kedja är mer komplex än tabeller

Utöver CREATE TABLE krävs också:
- Extensions (postgis för GIST-index)
- Functions (is_admin, is_company_owner_of — delvis bootstrap idag i 00000)
- Types/enums (okänt antal)
- Triggers (nämns men inte verifierat)
- Views (minst reviews, sannolikt fler)
- Sequences, custom aggregates, etc.

## Dagens Del A-framsteg (värdefullt)

Följande är KLART och värdefullt oavsett fortsatt replay-arbete:

1. **15 KRITISKA tabeller har retroaktiva CREATE TABLE-migrations** (§2.1.1)
   - 214 databas-objekt dokumenterade från prod-schema.sql
   - Commits: 4f77d2a, 2f88dab, 6eb2fc8, e284c22, 72588f9, d3bc4c2,
     92df927, 27d5db5

2. **Policies konsoliderade** i 20260422130000_fas_2_1_1_all_policies.sql
   - 79 policies DROP + 79 CREATE, idempotent via DROP POLICY IF EXISTS
   - Commit: 53d6eb0

3. **Bootstrap-serie etablerad** (00000_ och 00001_)
   - 00000: postgis-extension + admin_users + spark_levels + subscriptions
     + is_admin() + is_company_owner_of() (plpgsql för forward-ref-tolerans)
   - 00001: cleaner_applications (audit-missad men KRITISK)
   - Commits: e532395, 7068836, 26c897d

## Varför Del B drift-check CI inte fungerar än

Workflow kan inte bygga en "förväntad state" att jämföra prod mot eftersom:

- `supabase db reset --local` failar på 001_push.sql (ALTER TABLE bookings,
  bookings skapas först i 20260422120000)
- Även efter rename av §2.1.1 till lägre prefix finns resterande dependencies
  (reviews-VIEW-konvertering, okända types/triggers/sequences)
- Alt C (artifact-diff mot föregående körning) fungerar mekaniskt men löser
  inte kärnproblemet — det detekterar delta inte total drift

## Fas 2.X Replayability Sprint — plan

**Mål:** `supabase db reset --local` applicerar alla migrations från scratch
utan fel OCH resulterande schema matchar prod-schema.sql exakt.

**Scope (uppskattat):**

1. **Inventering av ALL drift** (4-6h)
   - Functions, types, triggers, views, sequences, extensions
   - Gruppera per ordning-problem vs saknad-problem
   - Kartlägg hela beroende-kedjan

2. **Konsolidering av §2.1.1 till bootstrap-serie** (2-4h)
   - Rename 20260422080000-120000 till 00002-00016
   - Uppdatera schema_migrations-registret
   - Verifiera sort-ordning

3. **Reverse-engineer saknade objekt** (15-25h)
   - Functions (~30 st enligt prod-schema.sql)
   - Views (~10 st)
   - Types (okänt)
   - Triggers (~40 st enligt prod-schema.sql)
   - Retroaktiva migrations i rätt ordning

4. **Rensa gamla migrations-konflikter** (5-10h)
   - `reviews` dual-create (003_subs.sql + 20260325000001)
   - Identifiera dead code
   - Dokumentera "prod vann"-beslut för varje konflikt

5. **Verifiering** (2-3h)
   - `supabase db reset --local` → success
   - `supabase db dump --local` === `supabase db dump --linked`

**Realistisk estimat: 30-50h.**

## Interim-strategi (tills Fas 2.X körs)

Schema-drift-check-workflow stannar som "delvis klar" med dokumenterad
begränsning. Manuell drift-upptäckt via:

```powershell
supabase db dump --schema public -f prod-schema-new.sql
git diff --stat prod-schema.sql prod-schema-new.sql
```

Köra veckovis manuellt tills Fas 2.X är klar.

## Beroenden

- **Blockerar:** Fas 48.5 Del B (automatisk drift-check), §2.8 hygien-kontroll #12
- **Prioritet:** Medelhög — drift nuvarande har inte orsakat incidenter. Varje ny
  manuell Studio-ändring ökar skulden.
- **När:** När prioriteten ändras. Ej akut idag.

---

**Skapad:** 2026-04-22 efter Alt B-iteration som avslöjade djupare drift än
tidigare känt.

**Referenser:**
- docs/audits/2026-04-22-schema-drift-analysis.md (tidigare audit)
- docs/architecture/retroactive-migrations-template.md (mönster från §2.1.1)
- docs/architecture/schema-drift-check.md (workflow-dokumentation)
