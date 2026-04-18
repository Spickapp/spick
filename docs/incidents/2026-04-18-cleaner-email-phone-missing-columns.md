# Incidentrapport: `bookings.cleaner_email` + `cleaner_phone` saknades i prod-schema

**Datum:** 2026-04-18 (upptäckt + löst sen kväll)
**Allvarlighet:** P1 — tyst dataförlust (kodläsningar returnerade alltid NULL)
**Status:** ✅ Åtgärdad
**Relaterad migration:** [`20260418_fix_booking_calendar_trigger_and_cleaner_contact.sql`](../../supabase/migrations/20260418_fix_booking_calendar_trigger_and_cleaner_contact.sql)

---

## Sammanfattning

`bookings.cleaner_email` och `bookings.cleaner_phone` refererades av ~24 kodställen (admin-UI, städar-dashboard, notify-EF, auto-remind-EF, stripe-webhook m.fl.) men fanns inte i prod-schema. Kolumnerna hade aldrig lagts till — varje referens returnerade NULL utan fel. Commit `fb9f4e9` tolkades i [E2E Moment 2-rapporten](../audits/2026-04-19-e2e-moment-2-tilldelning.md) som en lösning, men bara ändrade skrivlogiken i `cleaner-booking-response` — inte schema. Parallellt saknade trigger-funktionen `sync_booking_to_calendar()` en guard-clause, vilket gjorde att planerad `ALTER TABLE ... ADD COLUMN + UPDATE backfill` kraschade mot `no_booking_overlap`-constraint pga historisk dubbelbokning 4 april. Alla tre buggar åtgärdades i samma session: ALTER TABLE + guard-clause + backfill av 25/26 rader.

---

## Tidslinje

| Tidpunkt | Händelse |
|----------|----------|
| Okänt dag 1 | Kod skrivs som refererar `bookings.cleaner_email`/`cleaner_phone` utan att kolumnerna finns i schema |
| 2026-04-04 | Historisk dubbelbokning skapas mot Farhad (2 rader överlappande tidsfönster, båda `completed`) |
| 2026-04-14 | Migration `20260414000001_calendar_events.sql` introducerar `sync_booking_to_calendar()`-trigger + `no_booking_overlap`-EXCLUDE-constraint. Triggern har ingen guard-clause. |
| 2026-04-17 (fb9f4e9) | `cleaner-booking-response` fixas att skriva rätt email/phone vid team-accept. Koden antar att kolumnerna finns. |
| 2026-04-19 (c496517) | E2E Moment 2-rapport påstår att fb9f4e9 löste buggen — ingen schema-check gjord. |
| 2026-04-18 sen kväll | Incident upptäckt under prod-verifiering. Schema-check avslöjar att kolumnerna inte finns. |
| 2026-04-18 sen kväll | ALTER TABLE + backfill testas — kraschar pga sync-trigger + dubbelbokning |
| 2026-04-18 sen kväll | Trigger-guard implementerad, ALTER + UPDATE körs, 25/26 rader backfillade (1 cancelled-rad utan cleaner_id lämnas NULL) |

---

## Root cause

Tre kedjade buggar:

### 1. Saknade kolumner i `bookings`

`cleaner_email` + `cleaner_phone` hänvisades av kod men fanns aldrig i prod-schema. Postgrest returnerar `null` för icke-existerande kolumner i vissa query-former, vilket gjorde buggen tyst. Affected reader-paths (från kortikuleringsrapport):

- [admin.html](../../admin.html) — 3 ställen
- [mitt-konto.html](../../mitt-konto.html)
- [stadare-dashboard.html](../../stadare-dashboard.html) — 5 ställen
- [stadare-uppdrag.html](../../stadare-uppdrag.html)
- [auto-remind/index.ts](../../supabase/functions/auto-remind/index.ts) — 7 ställen
- [notify/index.ts](../../supabase/functions/notify/index.ts) — 2 ställen
- [booking-reassign/index.ts](../../supabase/functions/booking-reassign/index.ts) — 2 ställen
- [cleaner-booking-response/index.ts](../../supabase/functions/cleaner-booking-response/index.ts)
- [stripe-webhook/index.ts](../../supabase/functions/stripe-webhook/index.ts)

### 2. `sync_booking_to_calendar`-trigger saknade guard

[20260414000001_calendar_events.sql:215](../../supabase/migrations/20260414000001_calendar_events.sql:215) körde INSERT/UPSERT på varje `AFTER UPDATE` oavsett vilka kolumner som ändrats. Det betyder:
- `UPDATE bookings SET cleaner_email = ...` triggade en calendar_events-operation som inte hade något med email att göra
- `no_booking_overlap`-constraint (rad 66-71) kraschade när den stötte på historisk dubbelbokning

### 3. Historisk dubbelbokning 4 april

Två `completed` bookings för Farhad med överlappande `start_at`/`end_at`. Inträffade före `no_booking_overlap`-constraint infördes 14 april. Existerar kvar i `bookings` men calendar_events-raderna krockar med EXCLUDE-constraint när triggern försöker UPSERT:a. Data lämnas som historik — inte data-rensad.

---

## Varför det missades tidigare (Regel #27-brott)

[E2E Moment 2-rapporten (c496517)](../audits/2026-04-19-e2e-moment-2-tilldelning.md) rapporterade att `cleaner_email`/`cleaner_phone`-buggen var löst av commit `fb9f4e9`. Rapporten verifierade bara kodändringen — inte att målkolumnerna faktiskt existerade i schema.

Rätt process enligt Regel #27 skulle varit:
1. Kontrollera kolumner i `information_schema.columns` eller via en SELECT
2. Bekräfta att en backfilling UPDATE ens skulle ha något att skriva till

Istället tolkades framgångsrik deploy av EF-fixen som att hela problemet var löst. Det är teater — fix:en skrev till icke-existerande kolumner som tyst ignorerades av PostgREST.

---

## Åtgärder genomförda

Alla körda mot prod `urjeijcncsyuletprydy` 2026-04-18. Sammanfattade i migration [`20260418_fix_booking_calendar_trigger_and_cleaner_contact.sql`](../../supabase/migrations/20260418_fix_booking_calendar_trigger_and_cleaner_contact.sql).

### 1. ALTER TABLE (idempotent)

```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_email text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaner_phone text;
```

### 2. Trigger-guard

```sql
CREATE OR REPLACE FUNCTION sync_booking_to_calendar()
-- ... DECLARE ...
BEGIN
  IF TG_OP = 'DELETE' THEN ...

  -- GUARD: skippa UPDATE när inget schema-relevant fält ändrats.
  IF TG_OP = 'UPDATE' AND
     NEW.cleaner_id       IS NOT DISTINCT FROM OLD.cleaner_id AND
     NEW.booking_date     IS NOT DISTINCT FROM OLD.booking_date AND
     NEW.booking_time     IS NOT DISTINCT FROM OLD.booking_time AND
     NEW.booking_hours    IS NOT DISTINCT FROM OLD.booking_hours AND
     NEW.service_type     IS NOT DISTINCT FROM OLD.service_type AND
     NEW.customer_address IS NOT DISTINCT FROM OLD.customer_address AND
     NEW.status           IS NOT DISTINCT FROM OLD.status AND
     NEW.payment_status   IS NOT DISTINCT FROM OLD.payment_status AND
     NEW.checkin_lat      IS NOT DISTINCT FROM OLD.checkin_lat AND
     NEW.checkin_lng      IS NOT DISTINCT FROM OLD.checkin_lng THEN
    RETURN NEW;
  END IF;
  -- ... övrig logik oförändrad ...
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 3. Backfill (idempotent via `IS NULL`)

```sql
UPDATE bookings b
   SET cleaner_email = c.email,
       cleaner_phone = c.phone
  FROM cleaners c
 WHERE b.cleaner_id = c.id
   AND b.cleaner_email IS NULL;
```

**Resultat:** 25/26 bokningar backfillade. 1 rad utan `cleaner_id` (cancelled testbokning farrehagge@gmail.com från 11 april) lämnades med NULL — OK.

---

## Kvarvarande teknisk skuld

`bookings.cleaner_email` och `bookings.cleaner_phone` är **denormaliserade snapshot-fält**. Om cleaner ändrar sin email/phone i `cleaners`-tabellen uppdateras INTE tidigare bokningar — de blir stale.

**Rätt långsiktig fix:** JOIN mot `cleaners` via `cleaner_id` vid läsning, droppa kolumnerna. Redigering av 12 filer (se lista ovan). Flaggad för Fas 3 i [`docs/backlog/tech-debt-fas3.md`](../backlog/tech-debt-fas3.md). Estimat 3-5h inkl tester.

---

## Lärdomar

1. **Regel #27 förstärkt:** "Kodändring kommit" ≠ "bugg fixad". Schema, index, triggers, constraints måste verifieras mot primärkälla (SELECT mot `information_schema`) — inte antas.
2. **PostgREST tyst-NULL:** Saknade kolumner returnerar null i vissa kontexter, vilket gör schema-fel nästan osynliga från klient-kod. E2E-rapporter måste ha en schema-verifieringssteg.
3. **Triggers behöver guard-clauses:** En trigger som förutsätter att "varje UPDATE är schema-relevant" kommer att krascha på tillfällen som backfill, column-adds, migration-patches. `IS NOT DISTINCT FROM`-pattern är billig och tydlig.
4. **Historisk data får inte blockera nya constraints:** `no_booking_overlap` infördes utan att rensa historiska överlapp. Framtida EXCLUDE-constraints bör paras med antingen en initial DELETE av brottsrader eller en `DEFERRABLE`-konfiguration.

---

## Uppföljning

- [x] Migration skriven idempotent (staging-safe)
- [x] Incident-rapport publicerad (denna fil)
- [x] Teknisk skuld flaggad för Fas 3
- [ ] E2E Moment 2-rapporten (c496517) bör uppdateras med not om att `fb9f4e9` inte löste hela buggen
- [ ] Framtida audit: grep efter andra "columns-in-code-that-may-not-exist-in-schema" kandidater
