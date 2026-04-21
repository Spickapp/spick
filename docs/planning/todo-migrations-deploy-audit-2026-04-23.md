# TODO: Migrations deploy-audit

**Upptäckt:** 2026-04-23, kvällssession
**Trigger:** §3.2a-deploy kunde inte verifieras — query mot supabase_migrations.schema_migrations returnerade bara 1 row (20260401000001)
**Status:** Utredning krävs innan fler migrationer skrivs eller §3.2a deployas via CI

## Observerat läge

| Källa | Antal migrationer | Senaste |
|---|---|---|
| `supabase/migrations/` i repot | 52 filer | `20260423_f3_2a_matching_v2_core.sql` |
| `supabase_migrations.schema_migrations` i prod | 1 rad | `20260401000001` |

**Mismatch:** 51 migrationer från 1 april till 23 april saknas i prod-registret.

## Varför detta är konstigt men inte krasch

Systemet fungerar i prod:

- Stripe LIVE fungerar (kräver payout_audit_log, payout_attempts)
- Auto-delegation fungerar (kräver auto_delegation_phase1-kolumner)
- 121 pass tests
- RUT-ombudsgodkänt och körbart
- Inga rapporterade bugs från sakandevillkor på missande tabeller/kolumner

Slutsats: migrationer HAR applicerats. Men inte via mekanismen som uppdaterar `schema_migrations`.

## Plausibla förklaringar

**H1 — Manuell Studio-körning:** Migrationer har kopierats in i Supabase Studio SQL Editor och körts direkt. Studio uppdaterar INTE `supabase_migrations.schema_migrations` — den tabellen är bara för CLI-drivna `supabase db push`. Detta förklarar allt observerat.

**H2 — CI har fallit tyst:** `run-migrations.yml` har `|| exit 0` på `supabase db push` vilket gör att fel sväljs. Workflow kan ha misslyckats i tysthet varje gång.

**H3 — `migration repair` strippade registret:** Workflow-steget "Markera alla befintliga migrationer som applied" refererar till ett hårdkodat IDs-mönster (`20260325000001`-format) som INTE matchar dagens filnamn (`20260325_namn.sql`). Möjligt att `migration repair --status applied` + CLI-mismatch faktiskt raderade istället för stämplade.

Mest troligt: kombination av H1 + H2.

## Risker om inget görs

1. Framtida `supabase db push` kommer försöka applicera ALLA 51 migrationer som "nya" eftersom registret säger de inte är applicerade. Skapar kollisioner (tabeller existerar redan, CREATE TABLE IF NOT EXISTS räddar men CREATE OR REPLACE FUNCTION skriver över med kanske fel version).
2. Rollback-förmåga är borta. Utan schema_migrations kan `supabase db reset` inte återställa till en specifik punkt.
3. Lokal dev fungerar inte — ny utvecklare eller disaster recovery kan inte köra migrations i ordning och få samma prod-state.
4. CI-skydd mot schema-drift är meningslöst (hygien-task #12 §2.8).

## Frågor som måste besvaras

1. Har `supabase db push` någonsin lyckats via CI? Hämta GitHub Actions-logg för senaste 5 run-migrations-körningar.
2. Hur har tidigare migrationer (20260401000001 → 20260423_f2_7_1_b2b_schema.sql) faktiskt applicerats? Studio manuellt? Annan mekanism?
3. Om vi `migration repair --status applied` alla 51 filer nu — skapar det problem? Filerna måste ha formatter som CLI känner igen.
4. Vad är korrekt format för migration-filer? `20260325000001_namn.sql` (workflow-lista) vs `20260325_namn.sql` (repo)?

## Föreslagen åtgärd (preliminär, ej godkänd)

**Fas 1 — Diagnos (1-2h):**
- Hämta GitHub Actions-logg från 5 senaste run-migrations-körningar
- Kör `supabase migration list` lokalt och jämför mot repo + prod
- Identifiera exakt var mekanism-brottet skedde

**Fas 2 — Repair (2-4h):**
- Migrera filnamnformat om nödvändigt (till numeriskt löpnummer)
- Kör `supabase migration repair --status applied <version>` för varje fil som bevisligen är applicerad
- Verifiera schema_migrations matchar repot efter repair

**Fas 3 — CI-härdning (1-2h):**
- Ta bort `|| exit 0` från run-migrations.yml så fel rapporteras
- Lägg till post-deploy verifiering: SELECT version FROM schema_migrations efter push
- Notification vid drift mellan repo och prod

**Fas 4 — Schema-drift-check (2-3h):**
- Implementera hygien-task #12 (§2.8) CI schema-drift
- Snappar avvikelser innan de blir kris

Totalt: 6-11h utredning + reparation.

## §3.2a-status

Filen `supabase/migrations/20260423_f3_2a_matching_v2_core.sql` (commit 6bbd1a4) är:

- Syntaktiskt verifierad (manuell genomgång mot prod-schema.sql)
- INTE applicerad i prod (verifierat 2026-04-23 via Studio SQL: `SELECT version FROM supabase_migrations.schema_migrations LIMIT 1` visar bara 20260401000001)
- INTE heller registrerad i schema_migrations

För att fortsätta Fas 3-arbetet utan att blockera på denna audit: kör §3.2a manuellt via Studio SQL Editor. Se manuell-deploy-instruktion nedan.

## Manuell deploy-instruktion för §3.2a (tills migrations-system är repairad)

1. Öppna Supabase Studio → SQL Editor → ny query
2. PowerShell: `Get-Content supabase\migrations\20260423_f3_2a_matching_v2_core.sql | Set-Clipboard`
3. Ctrl+V i Studio SQL Editor
4. Kör (RUN-knappen eller Ctrl+Enter)
5. Om fel uppstår — stanna, rapportera felmeddelandet
6. Om OK — kör verifieringsqueries:

```sql
-- Verifiera funktionen
SELECT proname, pronargs, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc WHERE proname = 'find_nearby_cleaners';
-- Förväntat: 2 rader (2-param + 9-param) eller 1 rad (9-param som ersatt)

-- Testa v1 bakåtkompat (Stockholm-koord)
SELECT id, full_name, match_score, distance_score
FROM find_nearby_cleaners(59.3293::double precision, 18.0686::double precision)
LIMIT 3;

-- Verifiera audit-kolumner
SELECT column_name FROM information_schema.columns
WHERE table_name = 'bookings'
  AND column_name IN ('chosen_cleaner_match_score', 'matching_algorithm_version');

-- Verifiera platform_settings
SELECT key, value FROM platform_settings WHERE key = 'matching_algorithm_version';
```

7. Om alla verifieringar OK — rapportera till chatten
8. OBS: Eftersom den manuella körningen INTE uppdaterar schema_migrations, kommer §3.2a också saknas där. Detta hanteras i migration-repair-arbetet (Fas 2 ovan).

## Referens

- Workflow-fil: `.github/workflows/run-migrations.yml`
- Senaste commit som försökte deploy: `6bbd1a4` (23 apr)
- Relaterad hygien-task: #12 (§2.8 CI schema-drift-check)
- Session där upptäckten gjordes: 2026-04-23 kvällssession
