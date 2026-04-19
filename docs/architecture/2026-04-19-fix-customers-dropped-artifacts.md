# Fix: Customers-tabell dropad — följdartefakter (2026-04-19)

## Symptom
booking-create returnerade 500 "relation customers does not exist" efter
Fas 1.2 Dag 4 RLS-lockdown. Kunder kunde inte boka städningar.

## Rot-orsak
Customers-tabellen dropades i Fas 1.2 Dag 4 migration, men två 
DB-artefakter refererade fortfarande till tabellen:

1. Trigger `trg_sync_booking` på bookings (INSERT) — kallade
   funktionen `sync_booking_to_portal()` som INSERT:ade till customers.
   Rollbacka hela bookings-INSERT när customers saknades.

2. Två cron-jobb (jobid 2, 9) körde funktionen `send_job_reminders()`
   varje timme. Funktionen SELECTade JOIN mot customers. Failade tyst
   varje timme.

## Atgard
I Supabase SQL Editor kordes:

```sql
BEGIN;

-- Droppa trigger
DROP TRIGGER IF EXISTS trg_sync_booking ON public.bookings;

-- Droppa funktioner
DROP FUNCTION IF EXISTS public.sync_booking_to_portal() CASCADE;
DROP FUNCTION IF EXISTS public.send_job_reminders() CASCADE;

-- Avschemalagg cron-jobb
PERFORM cron.unschedule(2);
PERFORM cron.unschedule(9);

COMMIT;
```

## Verifiering
- Inga funktioner i public-schema refererar langre till customers-tabellen
- Inga cron-jobb kor send_job_reminders
- booking-create EF returnerar 200 for test-bokningar
- Ny notifikationsvag via notify + auto-remind EFs redan aktiv
  (ingen regression i cleaner-notifieringar)

## Larande
Innan DROP TABLE i framtiden:
- Grep alla EFs for tabellnamn
- Grep alla DB-funktioner for tabellnamn
- Kontrollera cron-jobb och triggers som refererar tabellen
- Regel #26 utvidgad: grep dackar inte alla referenser som SQL-defined

## Teknisk skuld flaggad for cleanup-sprint
- jobs-tabell (0 kod-referenser, 39 rader data)
- job_matches (39 rader, inte lasta av nagon EF/HTML)
- notifications-tabell (39 rader, oklart anvandande)
- booking_slots (383 rader, AKTIVT — behalls)
- bookings.portal_customer_id + portal_job_id kolumner
- customer_profiles.portal_customer_id
- bankid-klar.html skrapfil i repo-rot (EF-kod med .html extension)
