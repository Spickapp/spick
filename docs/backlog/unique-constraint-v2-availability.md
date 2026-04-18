# UNIQUE(cleaner_id, day_of_week) saknas på cleaner_availability_v2

**Prioritet:** P2 (inget akut bug idag, men sänker risken)
**Estimat:** 15 min + övervakningsperiod

---

## Problem

`cleaner_availability_v2` definierades i [20260414000001_calendar_events.sql:103-115](../../supabase/migrations/20260414000001_calendar_events.sql:103) utan UNIQUE-constraint på `(cleaner_id, day_of_week)`. Istället används en trigger `validate_avail_v2_no_overlap` (rad 119-138) som bara validerar tid-overlap — inte att det finns max en aktiv rad per (cleaner, dag).

Det gör att dubletter kan uppstå via race-conditions eller buggar, och tvingar läsande kod (boka.html, cleaner-job-match) att hantera eventuella dubletter defensivt.

Fas 0.4a ([commit e2e073a](../../)) använder DELETE + INSERT-pattern i `adminSaveSchedule` för att undvika behovet av upsert med onConflict. Med en UNIQUE-constraint skulle en ren `ON CONFLICT (cleaner_id, day_of_week) DO UPDATE` bli möjlig i framtiden.

---

## Åtgärd

När övervakning har bekräftat att inga dubletter uppstår i normal drift (t.ex. 1-2 veckor efter 0.4a-deploy), lägg till UNIQUE-index.

**Förkontroll innan migration körs:**

```sql
-- Bekräfta 0 dubletter just innan:
SELECT cleaner_id, day_of_week, COUNT(*)
  FROM cleaner_availability_v2
 GROUP BY cleaner_id, day_of_week
HAVING COUNT(*) > 1;
-- Förväntat: 0 rader.
```

**Migration:**

```sql
CREATE UNIQUE INDEX CONCURRENTLY uniq_avail_v2_cleaner_day
  ON cleaner_availability_v2 (cleaner_id, day_of_week);
```

`CONCURRENTLY` undviker tabell-lås under skapandet. Kan köras live i prod utan downtime.

---

## Empirisk baseline per 2026-04-18

Under Fas 0.4a-verifiering ([docs/incidents/2026-04-18-v2-missing-grants.md](../incidents/2026-04-18-v2-missing-grants.md)) kördes:

```sql
SELECT cleaner_id, day_of_week, COUNT(*)
  FROM cleaner_availability_v2
 GROUP BY cleaner_id, day_of_week
HAVING COUNT(*) > 1;
-- Resultat: 0 rader.
```

Tabellen är ren idag. Därmed är constraint-tillägg säkert — bara en övervakningsperiod behövs för att bekräfta att adminSaveSchedule + Wizard + stadare-dashboard-skrivningar inte skapar dubletter i praktiken.
