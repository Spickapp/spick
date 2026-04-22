# Schema Drift Check — CI-workflow

**Skapad:** 2026-04-22 (Fas 48.5 Del B)
**Workflow:** `.github/workflows/schema-drift-check.yml`

## Syfte

Veckovis automatisk verifiering att prod-databasens schema matchar `prod-schema.sql` i repot. Detta är hygien-kontroll #12 från v3-planens §2.8.

## När körs den

- **Automatiskt:** varje måndag 06:00 UTC (08:00 lokal tid)
- **Manuellt:** via Actions-fliken → "Schema Drift Check" → Run workflow

## Vad workflow gör

1. **Checkout** av repot
2. **Setup Supabase CLI** (v1)
3. **Link** till prod-projektet
4. **Dump** aktuell prod-schema via `supabase db dump --schema public`
5. **Normalisera** båda filer: ta bort kommentarer + tomma rader + normalisera whitespace
6. **Sortera** rader för att hantera objekt-ordning
7. **Diff** sorterade normaliserade filer
8. **Vid drift:** skapa GitHub Issue med label `schema-drift`
9. **Vid no-drift:** logga OK-status

## Hantera drift-issue

När workflow skapar ett drift-issue:

### Steg 1 — Förstå driften

```powershell
supabase db dump --schema public -f prod-schema-new.sql
git diff prod-schema.sql prod-schema-new.sql
```

### Steg 2 — Klassificera

**Förväntad drift** (migration applicerad via `supabase db push`):
- Uppdatera `prod-schema.sql` med ny dump
- Commit: `chore: uppdatera prod-schema.sql (drift-check YYYY-MM-DD)`

**Oförväntad drift** (Studio-ändring utan migration):
- Identifiera den specifika ändringen
- Skapa retroaktiv migration enligt mönstret från §2.1.1
- Template: `docs/architecture/retroactive-migrations-template.md`
- Uppdatera `prod-schema.sql` efter att retroaktiv migration är commiterad

### Steg 3 — Stäng issue

Efter att driften är hanterad, stäng issue:n manuellt med kommentar om vad som gjordes.

## Known false positives

Normaliseringen är enkel och kan missa vissa formatterings-skillnader:
- Olika ordning av `OWNER TO` vs `COMMENT ON` vs andra ALTER-statements
- Subtila whitespace-skillnader i multi-line CHECK-constraints

Om workflow skapar issue men diffen visar bara formatterings-skillnader:
- Verifiera manuellt att ingen faktisk schema-ändring skett
- Uppdatera `prod-schema.sql` med ny dump
- Förbättra eventuellt normalization-logiken i workflow

## Secrets som krävs

- `SUPABASE_ACCESS_TOKEN` — redan satt för run-migrations.yml

## Relaterat

- v3-plan §2.8 (ursprungsspec)
- §2.1.1 retroaktiva migrations (27d5db5 + 7 tidigare)
- `docs/architecture/retroactive-migrations-template.md`
