-- ═══════════════════════════════════════════════════════════════
-- SPICK EMERGENCY CLEANUP — Kör DIREKT i Supabase SQL Editor
-- Datum: 2026-03-30
-- 
-- 1. Rensa hackad data ("PENTEST_HACKED" i bio)
-- 2. Inaktivera demo/seed-städare (skapade under utveckling)
-- 3. Rensa test-bokningar
-- ═══════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════╗
-- ║  1. RENSA HACKAD/INJICERAD DATA                  ║
-- ╚══════════════════════════════════════════════════╝

-- Sätt hackad bio till säker standardtext
UPDATE cleaners
SET bio = '[Demo-profil — ej riktig städare]'
WHERE bio ILIKE '%PENTEST%' 
   OR bio ILIKE '%HACKED%' 
   OR bio ILIKE '%<script%'
   OR bio ILIKE '%javascript:%'
   OR bio ILIKE '%onerror%';

-- Visa alla ändrade
SELECT id, full_name, bio, updated_at 
FROM cleaners 
WHERE bio = '[Demo-profil — ej riktig städare]'
ORDER BY full_name;


-- ╔══════════════════════════════════════════════════╗
-- ║  2. INAKTIVERA ALLA DEMO/SEED-STÄDARE            ║
-- ║  Dessa 9 profiler skapades under utveckling       ║
-- ║  och ska INTE vara bokbara av riktiga kunder      ║
-- ╚══════════════════════════════════════════════════╝

UPDATE cleaners
SET status = 'inaktiv',
    is_approved = false,
    identity_verified = false,
    bio = '[Demo-profil — ej riktig städare]'
WHERE email IN (
  'olena.k@gmail.com',
  'ahmed.h@gmail.com',
  'maria.a@gmail.com',
  'fatima.r@gmail.com',
  'sara.l@gmail.com',
  'kofi.m@gmail.com',
  'natasha.p@gmail.com',
  'mohammed.f@gmail.com',
  'annalena.b@gmail.com'
);

-- Verifiera: Visa kvarvarande AKTIVA städare (ska bara vara riktiga)
SELECT id, full_name, email, status, is_approved, identity_verified, city
FROM cleaners 
WHERE is_approved = true AND status = 'godkänd'
ORDER BY full_name;


-- ╔══════════════════════════════════════════════════╗
-- ║  3. RENSA TEST-BOKNINGAR                          ║
-- ╚══════════════════════════════════════════════════╝

DELETE FROM bookings
WHERE (email LIKE '%test%' OR email LIKE '%spick-test%' OR name LIKE 'Test %')
  AND payment_status != 'paid';

-- Visa kvarvarande bokningar
SELECT id, COALESCE(customer_name, name) as kund,
  payment_status, status, date, cleaner_name
FROM bookings 
ORDER BY created_at DESC
LIMIT 20;


-- ╔══════════════════════════════════════════════════╗
-- ║  4. KONTROLLERA RLS-POLICIES                      ║
-- ║  Verifiera att cleaners-tabellens UPDATE          ║
-- ║  inte är öppen för anon                           ║
-- ╚══════════════════════════════════════════════════╝

SELECT tablename, policyname, roles::text, cmd,
  CASE WHEN qual::text = 'true' THEN '⚠️ ÖPPEN — FIXA OMEDELBART' 
       ELSE '✅ Filtrerad' END as status
FROM pg_policies 
WHERE schemaname = 'public' 
  AND cmd IN ('UPDATE', 'DELETE')
  AND '{anon}' = ANY(roles)
ORDER BY tablename;

-- Om ovan visar ⚠️ ÖPPEN för cleaners UPDATE → kör:
-- DROP POLICY IF EXISTS "anon_update_cleaners" ON cleaners;
-- DROP POLICY IF EXISTS "Anon update cleaners" ON cleaners;


-- ╔══════════════════════════════════════════════════╗
-- ║  5. STÄNG ÖPPNA UPDATE-POLICIES                   ║
-- ║  Dessa tillåter VILKEN anon som helst ändra data  ║
-- ╚══════════════════════════════════════════════════╝

-- Bookings: USING(true) låter vem som helst uppdatera bokningar!
DROP POLICY IF EXISTS "Cleaner update booking status" ON bookings;

-- Ersätt med restriktiv policy: bara authenticated städare kan uppdatera
-- (och bara sina egna bokningar — se 20260329000002_rls_lockdown.sql)
-- Admin uppdaterar via service_role Edge Functions

-- Cleaners: Ingen anon ska kunna uppdatera städarprofiler
DROP POLICY IF EXISTS "anon_update_cleaners" ON cleaners;
DROP POLICY IF EXISTS "Anon update cleaners" ON cleaners;
DROP POLICY IF EXISTS "Public update cleaners" ON cleaners;

-- Verifiera: Inga öppna UPDATE-policies kvar
SELECT tablename, policyname, roles::text, cmd,
  CASE WHEN qual::text = 'true' THEN '⚠️ FORTFARANDE ÖPPEN' 
       ELSE '✅ OK' END as status
FROM pg_policies 
WHERE schemaname = 'public' 
  AND cmd = 'UPDATE'
ORDER BY tablename;

-- Force reload
NOTIFY pgrst, 'reload schema';
