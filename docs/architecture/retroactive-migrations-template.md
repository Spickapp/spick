# Retroaktiva CREATE TABLE-migrations — Template

**Kontext:** Fas 2 §2.1.1 — dokumentera 15 KRITISKA tabeller som saknar CREATE TABLE i repot men finns i prod.

**Primärkälla:** `prod-schema.sql` (pg_dump --schema-only).

**Idempotens-regler för PG 17:**

| Objekt | Idempotent-mönster |
|---|---|
| CREATE TABLE | `CREATE TABLE IF NOT EXISTS` |
| ALTER TABLE OWNER | Alltid köra (oförändrat) |
| COMMENT ON COLUMN | Alltid köra (overskriver) |
| ADD CONSTRAINT | `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...) THEN ALTER TABLE ... END IF; END $$;` |
| CREATE INDEX | `CREATE INDEX IF NOT EXISTS` |
| ENABLE ROW LEVEL SECURITY | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (idempotent) |
| CREATE POLICY | `DROP POLICY IF EXISTS ... CREATE POLICY` (PG 17 stödjer ej IF NOT EXISTS på policy) |
| GRANT | `GRANT ... ON TABLE ... TO ...` (idempotent) |

**Extraktionsrutin:**

1. Från `prod-schema.sql`: `Select-String 'CREATE TABLE IF NOT EXISTS "public"\."<tabell>"' -Context 0,N` för CREATE TABLE
2. `Select-String '"public"\."<tabell>"' -AllMatches` för alla referenser (constraints, indexes, policies, RLS, grants)
3. Gruppera: PK/UNIQUE/FK, INDEX, POLICY, RLS, GRANT
4. Policies är ofta multi-line — hämta tills närmaste `;`

**Filnamn-konvention:** `YYYYMMDDHHMMSS_fas_2_1_<tabell>.sql`

**Post-commit:** Studio-INSERT till `supabase_migrations.schema_migrations`:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('YYYYMMDDHHMMSS', 'fas_2_1_<tabell>')
ON CONFLICT DO NOTHING;
```

## Policies separat från CREATE TABLE

**Lärdom 2026-04-22:** CREATE POLICY validerar tabell-refs INLINE vid CREATE.
Om policy refererar annan tabell i USING-klausul/subquery, måste den tabellen
redan existera när policy-migrationen körs.

**Konsekvens:** Policies kan INTE definieras i samma migration som CREATE TABLE
om policies refererar andra tabeller.

**Mönster:**

1. Tabell-migration: CREATE TABLE + constraints + indexes + RLS ENABLE + grants
2. Separat policies-migration (kör EFTER alla tabeller): DROP POLICY IF EXISTS + CREATE POLICY

**Exempel:** Se `20260422130000_fas_2_1_1_all_policies.sql` som konsoliderar
79 policies för 16 §2.1.1-tabeller.

## Functions med forward-refs: använd plpgsql

**Lärdom 2026-04-22:** `CREATE FUNCTION ... LANGUAGE sql` parsar body INLINE vid
CREATE. Forward-refs till ännu-ej-existerande tabeller/functions failar.

**LANGUAGE plpgsql** har sen binding — body parsas vid första körning.

**Mönster:**

För functions som refererar framtida tabeller i samma migration-batch:

```sql
-- AVVIKELSE från prod: LANGUAGE plpgsql istället för sql
-- Skäl: forward-ref-tolerans för migrations-replay
CREATE OR REPLACE FUNCTION "public"."some_func"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM future_table WHERE ...);
END;
$$;
```

Dokumentera avvikelsen från prod i migrationens kommentar. Accepterar
drift-check false positive tills prod uppgraderas eller accepteras.
