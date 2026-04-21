-- ============================================================
-- Post-hoc dokumentation: GRANT INSERT/UPDATE/DELETE på v2 till authenticated
-- ============================================================
-- Körd mot prod (urjeijcncsyuletprydy) 2026-04-18 sen kväll under
-- empirisk verifiering av Fas 0.4a (commit e2e073a).
--
-- Symptom: adminSaveSchedule kastade PostgREST-fel 42501 "permission
-- denied for table cleaner_availability_v2" på DELETE-steget.
--
-- Rotorsak: cleaner_availability_v2 skapades i 20260414000001_calendar_events.sql
-- med RLS enabled + policies men ingen explicit GRANT till authenticated.
-- RLS policy "Authenticated users manage own availability_v2" gav FOR ALL
-- USING-klausul, men utan tabell-level GRANT tog RLS aldrig effekt för
-- skrivningar — bara läsningar (via separat SELECT-policy USING(true)).
--
-- Service role-EF:er (admin-create-company, admin-approve-cleaner,
-- cleaner-job-match) påverkades INTE eftersom service_role bypass:ar både
-- GRANT och RLS.
--
-- Fix (denna migration) har redan körts i prod. Filen finns för att
-- staging/nya miljöer ska få samma grants vid supabase db push.
-- ============================================================

GRANT INSERT, UPDATE, DELETE ON cleaner_availability_v2 TO authenticated;

-- Idempotent: PostgreSQL GRANT är idempotent (ingen OR REPLACE behövs).
-- Redan-beviljade privilegier ger ingen feltext vid re-körning.

-- Se docs/incidents/2026-04-18-v2-missing-grants.md för full kontext.
