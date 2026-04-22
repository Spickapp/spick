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
