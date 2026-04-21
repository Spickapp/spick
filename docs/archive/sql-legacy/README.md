# sql-legacy — arkiverade SQL-filer pre-2026-04-22

Historiska SQL-filer som bodde i `sql/`-mappen innan §2.5 (Fas 2 Migrations-sanering) flyttade allt till `supabase/migrations/` eller arkiverade här.

**Cut-off: 2026-04-22.** Inga nya filer ska läggas till här. All ny SQL går till `supabase/migrations/` med format `YYYYMMDD_fX_Y_xxx.sql`.

## Filer i arkivet

### `companies-and-teams.sql`
Skapar: `companies`-tabell + ALTER cleaners (company_id, is_company_owner) + ALTER cleaner_applications + RLS-policies för `Company owner reads team members`.
Status: **ALREADY_APPLIED** i prod. Kritisk infrastruktur för VD-modell (Rafa-pilot). Arkiverad för historik — schemat är redan på plats i prod, men dokumentation av designbeslut och RLS-policy-formuleringar är värdefullt att behålla.
Notera: `commission_rate NUMERIC DEFAULT 0.17` (rad 14) är historisk default — droppas i §1.10 framtida migration per [docs/architecture/money-layer.md §2.1 rad 14](../../architecture/money-layer.md).

### `p0-waitlist.sql`
Skapar: `waitlist`-tabell (city + email UNIQUE) + RLS + anon-insert-policy + admin-read-policy + city-index. Innehåller också en engångs-`DELETE FROM bookings`-statement för testdata-cleanup (`claraml@hotmail.se`).
Status: **ALREADY_APPLIED** i prod. Tabellen är aktiv — 33 HTML-landningssidor för städer har waitlist-formulär. Arkiverad istället för raderad eftersom DELETE-statementen är engångs-åtgärd som inte ska re-köras vid deploy, och hela filens designkontext är värd att bevara.

## Hitta raderade filer

Filer som raderades (inte arkiverades) i §2.5-commit kan återfinnas via:

```powershell
git log --all --diff-filter=D -- 'sql/<filnamn>'
git show <commit-hash>:sql/<filnamn>
```

Raderade i §2.5 (commit 2026-04-22):
- `sql/radius-model.sql` — obsolet `find_nearby_cleaners` (home_coords-version), superseded av `supabase/migrations/20260422_f2_2_find_nearby_cleaners.sql`
- `sql/fix-find-nearby-for-teams.sql` — `find_nearby_cleaners` (text[]-version), superseded
- `sql/fix-nearby-part1.sql` — ALTER+DROP förberedelse, superseded
- `sql/fix-nearby-part2.sql` — `find_nearby_cleaners` (jsonb-version), superseded
- `sql/approval-and-booking-response.sql` — triviala ALTER cleaner_applications + bookings, ALREADY_APPLIED via 010_bookings_columns.sql + 20260326500003
- `sql/cleaner-applications-geo.sql` — triviala ALTER cleaner_applications, ALREADY_APPLIED via 20260326500001_cleaner_applications_columns.sql
