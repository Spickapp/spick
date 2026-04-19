-- Fas 1.2: Drop customers-tabellen (legacy)
-- Förberedd 19 april 2026. KÖRS EFTER backfill av customer_profiles (dag 2).
--
-- Bekräftat (V7-V14):
-- - customers-tabell: 19 rader
--   - 14 uppenbart testdata (test@*, lindgren/erik.j/sara.n/johan.ek/karin.s@test.se, c1000000-* IDs)
--   - 5 riktiga emails (farrehagge, claraml, derin) - duplikerade, alla har auth.user + bookings
-- - 0 frontend-konsumenter (grep 2026-04-19)
-- - 0 EF-konsumenter (grep 2026-04-19, Stripe-refs är externa api.stripe.com)
-- - Alla 3 riktiga kunder har customer_profiles-rad efter backfill
--
-- Ingen data-förlust.

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- PRE-CHECK
-- ══════════════════════════════════════════════════════════════
SELECT COUNT(*) AS rows_in_customers FROM customers;
-- Förväntat: 19

SELECT pg_size_pretty(pg_total_relation_size('customers'::regclass)) AS size;
-- Förväntat: ~32 kB

-- Policies som kommer droppas med CASCADE
SELECT policyname FROM pg_policies WHERE tablename = 'customers';
-- Visar: admin reads all customers, customer reads own row, customers read own data, service role full access

-- ══════════════════════════════════════════════════════════════
-- DROP
-- ══════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS public.customers CASCADE;

-- ══════════════════════════════════════════════════════════════
-- POST-CHECK
-- ══════════════════════════════════════════════════════════════
SELECT * FROM information_schema.tables 
 WHERE table_schema = 'public' AND table_name = 'customers';
-- Förväntat: 0 rader

SELECT * FROM pg_policies WHERE tablename = 'customers';
-- Förväntat: 0 rader

COMMIT;
