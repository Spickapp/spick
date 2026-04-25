# Migrations Convention

**Status:** Gällande konvention sedan 2026-04-25 (Hygien #48.6)
**Primärkälla:** `.github/workflows/run-migrations.yml` + `supabase/migrations/*.sql`
**Relaterade audits:**
- `docs/audits/2026-04-22-schema-drift-analysis.md` (drift-inventering: ~41 KRITISKA tabeller saknar migrations)
- `docs/audits/2026-04-22-replayability-audit.md` (replayability-block diagnos)
- `docs/audits/2026-04-24-infrastructure-audit-diagnos.md` (#48 Infrastructure Audit)

## Problem

Schema-drift mellan repo-migrations och prod-DB pga historisk Studio-SQL-deploy som inte uppdaterar `supabase_migrations.schema_migrations`-registret. Konsekvenser:

- `supabase db push` failar på "redan-existerande objekt" eller "saknade beroenden"
- Repo-migrations är inte replay-bara på en fresh clone (Fas 2.X Replayability Sprint, 30-50h)
- `schema_migrations` är permanent ur sync (1 prod-rad vs 134+ filer per 2026-04-25)
- Fas 2.X-arbete kräver retroaktiv CREATE TABLE-migrations för 15 KRITISKA tabeller (Fas 48.5 Del A klar)

Lärdom (Hygien #25, 2026-04-23): tre rule #31-brott i samma session pga antagande om DB-kolumner. Migration-filer i repo är **ej tillförlitliga** pga drift.

## Konvention

**Ingen Studio SQL Editor för strukturella ändringar utan motsvarande migration-fil i `supabase/migrations/`.**

"Strukturella ändringar" = `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `CREATE FUNCTION`, `CREATE POLICY`, `CREATE TYPE`, `CREATE VIEW`, `DROP *`, `GRANT/REVOKE`, sequence-skapelse.

"Inte strukturellt" (OK i Studio direkt) = `INSERT`/`UPDATE`/`DELETE` på data-rader, `SELECT`-queries, ad-hoc audit-queries.

### Konkreta regler

1. **Skapa migration-fil FÖRST** (i `supabase/migrations/YYYYMMDDHHMMSS_<beskrivning>.sql`)
2. **Idempotens krävs** för alla strukturella statements:
   - `DROP TABLE IF EXISTS`, `DROP FUNCTION IF EXISTS`, `DROP POLICY IF EXISTS`
   - `CREATE TABLE IF NOT EXISTS`
   - `CREATE OR REPLACE FUNCTION`, `CREATE OR REPLACE VIEW`
   - `ON CONFLICT DO NOTHING` för seed-INSERT
   - `DO $$ ... $$` med verifieringsblock vid komplex logik
3. **Workflow `run-migrations.yml`** plockar upp ny fil via `git diff --diff-filter=A` och kör via Management API. Auto-deploy vid push till main (paths: `supabase/migrations/**`).
4. **Vid migration-fel** skapas GitHub issue automatiskt (Fas 48.4 punkt 3, label `migration-failed`).
5. **Kompenserande migration vid manuell Studio-fix:** om en hot-fix MÅSTE göras i Studio (t.ex. för att låsa upp prod), skapa kompenserande migration-fil i samma commit/PR. Ingen "Studio-only-fix" ska gå utan att repo-state matchar.

### Verifiering före edit (rule #31)

Innan kod refererar tabell/kolumn/RPC, verifiera mot prod:

```bash
# Kolumn-existens (anon-roll):
curl -s -X GET "$SUPA_URL/rest/v1/<tabell>?select=<kolumn>&limit=1" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY"
# 42703 = kolumn saknas. 42501 = finns + RLS-skyddad.

# RPC-existens:
curl -s -X POST "$SUPA_URL/rest/v1/rpc/<rpc_name>" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -d '{}'
# 200/204/400 = RPC finns. PGRST202 = saknas.

# Storage bucket (kräver service_role för privata):
curl -s -X GET "$SUPA_URL/storage/v1/bucket/<name>" \
  -H "apikey: $SUPA_KEY"
# OBS: privata buckets returnerar 404 till anon ÄVEN OM de finns.
# För privat-bucket-existens: använd Studio eller service_role-key.
```

### För DROP / signature-ändring av RPC

Hämta nuvarande funktions-body via Studio (rule #31):

```sql
SELECT pg_get_functiondef('public.<funktion>'::regproc);
-- För overload med specifik signatur:
SELECT pg_get_functiondef('public.<funktion>(<arg_types>)'::regprocedure);
```

Använd den exakta strängen som källa för migration-filen. **Antag aldrig** funktion-bodyn från en gammal migration-fil eller dokumentation — den kan vara stale.

## Exempel — säker migration-flow

**Steg 1.** Verifiera state via curl/SQL.

**Steg 2.** Skapa fil `supabase/migrations/20260425170000_fas_X_Y_namn.sql`:

```sql
-- Fas X.Y — kort beskrivning
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund: varför denna ändring
-- Verifiering (rule #31): vad du curl/SQL-verifierat 2026-04-25
-- Idempotens: hur denna fil är re-run safe
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.foo(text, integer);

CREATE OR REPLACE FUNCTION public.foo(p_name text, p_count integer DEFAULT 0)
 RETURNS TABLE(...)
 LANGUAGE sql
AS $function$
  -- body
$function$;

GRANT EXECUTE ON FUNCTION public.foo(text, integer) TO anon, authenticated;
```

**Steg 3.** Commit + push. Workflow `run-migrations.yml` kör filen via Management API.

**Steg 4.** Vid fel: GitHub issue auto-skapas (label `migration-failed`). Åtgärda + skapa NY migration-fil (inte redigera den failade).

## Anti-pattern

❌ **Manuell Studio SQL för CREATE TABLE / ALTER TABLE utan motsvarande migration-fil.** Skapar permanent drift mellan repo och prod.

❌ **Redigera existerande migration-fil i repo.** Workflow plockar bara `--diff-filter=A` (added) — modifierade filer ignoreras. Skapa ny fil istället.

❌ **Antagande om RPC/kolumn baserat på migration-fil.** Migration kan ha failat tyst i prod (pga gammal `|| exit 0`-bug, åtgärdad i Fas 48.4). Verifiera mot prod alltid.

❌ **Ignorera idempotens.** En migration som failar på re-run blockerar workflow för alla framtida commits.

## Status — vad är klart, vad återstår

| Sub-fas | Status |
|---|---|
| Fas 48.1 DIAGNOS | ✅ KLAR |
| Fas 48.2 (schema_migrations-repair) | ⊘ DEFERRED till Fas 2.X Replayability (30-50h) |
| Fas 48.3 DORMANT DROP | ✅ KLAR |
| Fas 48.4 punkt 1 (`|| exit 0` borttagen) | ✅ KLAR (Sprint 2 Dag 2) |
| Fas 48.4 punkt 2 (schema_migrations COUNT-mismatch) | ⊘ SUPERSEDED (workflow kringgår registret medvetet) |
| Fas 48.4 punkt 3 (notification vid drift) | ✅ KLAR (denna konvention) |
| Fas 48.5 Del A (15 KRITISKA tabeller) | ✅ KLAR |
| Fas 48.5 Del B (CI-drift-check) | ◑ DELVIS (workflow finns, blockerad på Fas 2.X) |
| Fas 48.6 retrospektiv | ✅ KLAR (denna fil) |
| **Fas 2.X Replayability Sprint** | ◯ NÄSTA STORA HYGIEN-INVESTERING (30-50h) |

## Referenser

- `.github/workflows/run-migrations.yml` — Auto-deploy via Management API + GitHub issue vid fel
- `docs/architecture/retroactive-migrations-template.md` — Mall för retroaktiv CREATE TABLE
- `CLAUDE.md` regel #31 — Primärkälla över memory
- `CLAUDE.md` regel #32 — Hook-baserad enforcement vid commit
