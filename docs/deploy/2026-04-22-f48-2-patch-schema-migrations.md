# Manuell Deploy: §48 Fas 48.2 Patch — fixa 8-siffriga prefix

**Datum:** 2026-04-22
**Bakgrund:** Workflow #134 (från commit 0bf4d3b) FAILED med "Remote migration versions not found in local migrations directory". Orsak: 3 versioner i schema_migrations har 8-siffriga prefix som inte matchar filer med 14-siffriga prefix.

**Fix:** Rename 2 filer + DELETE 1 version i schema_migrations + UPDATE 2 versions.

## Pre-flight

```sql
-- Verifiera att de 3 versionerna finns
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version IN ('20260327', '20260422', '20260424')
ORDER BY version;
-- Förväntat: 3 rader
```

## Deploy-SQL

```sql
BEGIN;

-- 1. DELETE 20260327 (security_notes-filen raderad i git)
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260327';

-- 2. UPDATE 20260422 → 20260422113608 (find_nearby_cleaners rename)
UPDATE supabase_migrations.schema_migrations
SET version = '20260422113608'
WHERE version = '20260422' AND name = 'f2_2_find_nearby_cleaners';

-- 3. UPDATE 20260424 → 20260424223318 (drop_dormant_tables rename)
UPDATE supabase_migrations.schema_migrations
SET version = '20260424223318'
WHERE version = '20260424' AND name = 'f3_2c_drop_dormant_tables';

COMMIT;
```

## Post-deploy

```sql
-- 1. Total antal rader
SELECT COUNT(*) FROM supabase_migrations.schema_migrations;
-- Förväntat: 99 (var 100, -1 för security_notes-radering)

-- 2. Inga 8-siffriga prefix kvar
SELECT version FROM supabase_migrations.schema_migrations
WHERE LENGTH(version) = 8;
-- Förväntat: 0 rader

-- 3. Nya 14-siffriga versioner registrerade
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version IN ('20260422113608', '20260424223318');
-- Förväntat: 2 rader
```

## Deploy-historik

**Körd:** 2026-04-22 morgon via Studio SQL Editor

**Pre-state:**
- 3 rader med 8-siffriga prefix (20260327, 20260422, 20260424) ✓

**Post-state:**
- 99 rader totalt ✓
- 0 rader med 8-siffrig prefix ✓
- 20260422113608 + 20260424223318 registrerade ✓

**Workflow-verifiering:** Workflow #136 triggad manuellt efter Studio-deploy. Gick Success på 6m 53s.

Rollback inte utlöst.

## Rollback

```sql
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260327', 'security_notes');
UPDATE supabase_migrations.schema_migrations SET version = '20260422' WHERE version = '20260422113608';
UPDATE supabase_migrations.schema_migrations SET version = '20260424' WHERE version = '20260424223318';
COMMIT;
```
