-- ═══════════════════════════════════════════════════════════════════
-- §13.2 DB-index EXPLAIN ANALYZE queries
-- Topp-10 gap från static audit → faktiska query-plans mot prod
-- ═══════════════════════════════════════════════════════════════════
--
-- Syfte: Verifiera om saknade indexes (från docs/audits/2026-04-24-db-
-- indexes-static.md) faktiskt orsakar Seq Scan vid aktuell data-volym.
-- Om Seq Scan dominerar → migration behövs.
--
-- Kör: Copy/paste var och en i Supabase Studio SQL Editor.
--      Kopiera QUERY PLAN-output för analys.
--      Notera: "Seq Scan" = fullscan (dåligt vid skala),
--              "Index Scan" = bra (index används),
--              "Bitmap Index Scan" = bra.
--
-- Primärkälla för gap: docs/audits/2026-04-24-db-indexes-static.md §3
-- ═══════════════════════════════════════════════════════════════════

-- Först: kolla row-counts för context
SELECT
  'bookings' AS table_name, COUNT(*) AS rows FROM bookings
UNION ALL SELECT 'cleaners', COUNT(*) FROM cleaners
UNION ALL SELECT 'customer_profiles', COUNT(*) FROM customer_profiles
UNION ALL SELECT 'platform_settings', COUNT(*) FROM platform_settings
UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions
UNION ALL SELECT 'admin_users', COUNT(*) FROM admin_users
UNION ALL SELECT 'cleaner_applications', COUNT(*) FROM cleaner_applications
UNION ALL SELECT 'payout_audit_log', COUNT(*) FROM payout_audit_log
UNION ALL SELECT 'customer_credits', COUNT(*) FROM customer_credits
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
ORDER BY rows DESC;

-- ───────────────────────────────────────────────────────────────────
-- Gap #1: platform_settings.key (18 query-ställen)
-- ───────────────────────────────────────────────────────────────────
-- Mest-använda hot-path (frontend läser commission vid varje pricing-beräkning)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM platform_settings WHERE key = 'commission_standard';

-- Expected: platform_settings är liten (<50 rader), så Seq Scan är OK.
-- Om Seq Scan + many buffers → overhead, lägg btree-index på key.

-- ───────────────────────────────────────────────────────────────────
-- Gap #2: bookings.booking_date (14 query-ställen, inkl ORDER BY)
-- ───────────────────────────────────────────────────────────────────
-- Kritisk för kalender-queries och morning-report
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM bookings
WHERE booking_date >= CURRENT_DATE
ORDER BY booking_date
LIMIT 100;

-- Med WHERE på cleaner_id också (typical pattern för cleaner-dashboard)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM bookings
WHERE cleaner_id = (SELECT id FROM cleaners LIMIT 1)
  AND booking_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY booking_date DESC;

-- Expected: Om bookings har 1000+ rader, Seq Scan = problem.
-- Composite index (cleaner_id, booking_date) rekommenderat.

-- ───────────────────────────────────────────────────────────────────
-- Gap #3: customer_profiles.email (8 query-ställen)
-- ───────────────────────────────────────────────────────────────────
-- Hot-path för customer-auth och mitt-konto.html
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM customer_profiles
WHERE email = 'test@example.com';

-- Expected: email borde vara UNIQUE → auto-index. Om Seq Scan → fix.

-- ───────────────────────────────────────────────────────────────────
-- Gap #4: cleaners.auth_user_id (8 query-ställen)
-- ───────────────────────────────────────────────────────────────────
-- Hot-path för cleaner-auth (JWT → cleaner-match)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM cleaners
WHERE auth_user_id = '00000000-0000-0000-0000-000000000000';

-- Expected: Borde vara UNIQUE. Om Seq Scan → unique btree-index.

-- ───────────────────────────────────────────────────────────────────
-- Gap #5: admin_users.email (7 query-ställen)
-- ───────────────────────────────────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM admin_users
WHERE email = 'hello@spick.se';

-- Expected: Små tabell. Seq Scan kan vara OK.

-- ───────────────────────────────────────────────────────────────────
-- Gap #6: cleaners.is_company_owner (7 query-ställen)
-- ───────────────────────────────────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, first_name, company_id FROM cleaners
WHERE is_company_owner = true AND company_id IS NOT NULL;

-- Expected: Partial index WHERE is_company_owner=true kan hjälpa
-- om det bara är en delmängd.

-- ───────────────────────────────────────────────────────────────────
-- Gap #7: bookings.payment_status (10 query-ställen)
-- ───────────────────────────────────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM bookings
WHERE payment_status = 'pending'
  AND created_at < NOW() - INTERVAL '30 minutes';

-- Expected: cleanup-stale-pattern. Composite (payment_status, created_at) rekommenderat
-- (idx_bookings_stale_cleanup finns redan — kolla om den används här).

-- ───────────────────────────────────────────────────────────────────
-- Gap #8: cleaners.avg_rating (3 ORDER BY-användningar)
-- ───────────────────────────────────────────────────────────────────
-- Auto-delegate och matching använder ranking
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, first_name, avg_rating FROM cleaners
WHERE status = 'active'
ORDER BY avg_rating DESC NULLS LAST
LIMIT 50;

-- Expected: Composite (status, avg_rating DESC) för ranking.

-- ───────────────────────────────────────────────────────────────────
-- Gap #9: payout_audit_log.booking_id + created_at
-- ───────────────────────────────────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM payout_audit_log
WHERE booking_id = (SELECT id FROM bookings LIMIT 1)
ORDER BY created_at DESC;

-- ───────────────────────────────────────────────────────────────────
-- Gap #10: customer_credits.expires_at (3 queries)
-- ───────────────────────────────────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM customer_credits
WHERE customer_email = 'test@example.com'
  AND expires_at >= NOW()
  AND remaining_sek > 0;

-- ═══════════════════════════════════════════════════════════════════
-- Verifiering: listor alla indexes per tabell (från pg_indexes)
-- ═══════════════════════════════════════════════════════════════════

SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'bookings', 'cleaners', 'customer_profiles',
    'platform_settings', 'subscriptions', 'admin_users',
    'cleaner_applications', 'payout_audit_log',
    'customer_credits', 'reviews'
  )
ORDER BY tablename, indexname;

-- ═══════════════════════════════════════════════════════════════════
-- Index-användning (pg_stat_user_indexes) — senaste 30 dgr
-- ═══════════════════════════════════════════════════════════════════

SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  idx_scan AS times_scanned,
  idx_tup_read AS rows_read,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND relname IN (
    'bookings', 'cleaners', 'customer_profiles',
    'platform_settings', 'subscriptions'
  )
ORDER BY idx_scan ASC;  -- lägst = potentiellt oanvända

-- ═══════════════════════════════════════════════════════════════════
-- Nästa steg efter copy/paste-resultat
-- ═══════════════════════════════════════════════════════════════════
--
-- 1. För varje query ovan: notera "Planning Time" + "Execution Time"
--    + om "Seq Scan" eller "Index Scan" används.
--
-- 2. Kopiera resultat-tabellerna (pg_indexes + pg_stat_user_indexes).
--
-- 3. Ge till Claude. Claude skriver migration för de queries som
--    faktiskt visar Seq Scan vid din data-volym (inte i teori).
--
-- 4. Uppdatera docs/audits/2026-04-24-db-indexes-static.md med
--    runtime-verifierade fynd. Stäng §13.2 som ✓ KLART.
