-- =============================================================================
-- P1 VD-team-block-dates: Tillåt VD att manage blocked_times för team-medlem
-- =============================================================================
--
-- Källa: docs/planning/todo-foretag-dashboard-vd-workflows-2026-04-23.md §P1
-- Session: 2026-04-23 (commit-sekvens 1d1a12c → denna)
--
-- Problem idag:
--   RLS "Auth inserts blocked_times" WITH CHECK kräver cleaner_id IN
--   (SELECT cleaners.id WHERE auth_user_id = auth.uid()) — VD:s auth_user_id
--   matchar endast hans egen cleaner-rad. Om VD försöker INSERT för team-
--   medlems cleaner_id → RLS-deny. Resultat: ingen operationell väg att
--   spärra datum för sjuk/på-semester team-medlem utan att admin/Farhad
--   manipulerar DB direkt.
--
-- Lösning:
--   Utvidga "Cleaner sees own blocked"-policyn från FOR ALL (egen cleaner)
--   till att även tillåta VD på samma company. VD = cleaner-rad med
--   is_company_owner=true + company_id satt. Team-medlem = cleaner-rad
--   med samma company_id + is_company_owner=false.
--
-- Regel-efterlevnad:
--   #27: Endast blocked_times RLS rörs. Ingen annan tabell påverkas.
--   #28: WITH CHECK-clause är symmetrisk med USING så INSERT och SELECT
--        har samma behörighet (single source of truth för policy).
--   #30: Ingen regulator-gissning — kolumn-referenser är verifierade i
--        prod-schema.sql (is_company_owner + company_id finns på cleaners).
--   #31: Verifierat mot prod-schema.sql 2026-04-22 dump att:
--        - blocked_times.cleaner_id FK till cleaners.id finns
--        - cleaners.is_company_owner + company_id finns
--        - "Cleaner sees own blocked"-policy finns (rad 4730)
--        - "Auth inserts blocked_times"-policy finns (rad 4602)
--
-- Applicering: körs manuellt i Supabase Studio SQL Editor av Farhad
-- efter review. Ej auto-deployad via CI ännu (schema-drift-track pågår
-- per Fas 2.X Replayability Sprint).
-- =============================================================================

-- Drop existing policies that we're replacing/expanding
DROP POLICY IF EXISTS "Cleaner sees own blocked"            ON public.blocked_times;
DROP POLICY IF EXISTS "Auth inserts blocked_times"          ON public.blocked_times;
DROP POLICY IF EXISTS "Cleaner or VD manages blocked_times" ON public.blocked_times;

-- ──────────────────────────────────────────────────────────────────────────────
-- New policy: cleaner OR VD-for-same-company kan manage blocked_times
-- ──────────────────────────────────────────────────────────────────────────────
-- FOR ALL täcker SELECT/INSERT/UPDATE/DELETE. USING gäller existing rows
-- (SELECT/UPDATE/DELETE). WITH CHECK gäller nya/uppdaterade rows (INSERT/UPDATE).
-- Symmetriska clauses = ingen väg att smuggla in en row för annan cleaner.

CREATE POLICY "Cleaner or VD manages blocked_times"
  ON public.blocked_times
  FOR ALL
  USING (
    cleaner_id IN (
      SELECT c.id FROM public.cleaners c
      WHERE c.auth_user_id = auth.uid()
         OR c.company_id = (
           SELECT vd.company_id
           FROM public.cleaners vd
           WHERE vd.auth_user_id = auth.uid()
             AND vd.is_company_owner = true
             AND vd.company_id IS NOT NULL
           LIMIT 1
         )
    )
  )
  WITH CHECK (
    cleaner_id IN (
      SELECT c.id FROM public.cleaners c
      WHERE c.auth_user_id = auth.uid()
         OR c.company_id = (
           SELECT vd.company_id
           FROM public.cleaners vd
           WHERE vd.auth_user_id = auth.uid()
             AND vd.is_company_owner = true
             AND vd.company_id IS NOT NULL
           LIMIT 1
         )
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- GRANT DELETE: authenticated saknade DELETE på blocked_times i prod
-- ──────────────────────────────────────────────────────────────────────────────
-- Tidigare: GRANT SELECT,INSERT TO authenticated (prod-schema.sql rad 5688).
-- UPDATE + DELETE saknades → även om policy tillät, kunde authenticated inte
-- köra DELETE pga GRANT-brist. För både cleaner (egen spärr) och VD (team-spärr)
-- måste DELETE fungera.

GRANT UPDATE, DELETE ON public.blocked_times TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- Verifiering (köras efter apply)
-- ──────────────────────────────────────────────────────────────────────────────
-- Test 1 — Cleaner spärrar egen dag (ska fungera oförändrat):
--   INSERT INTO blocked_times (cleaner_id, blocked_date, all_day)
--   VALUES ('<egen-cleaner-id>', '2099-01-01', true);
--
-- Test 2 — VD spärrar team-medlems dag (NYTT — ska nu fungera):
--   Logga in som VD. INSERT mot blocked_times med team-medlems cleaner_id.
--   Förväntat: row skapad.
--
-- Test 3 — VD försöker spärra OUTSIDE-cleaner (ska dena):
--   Logga in som VD. INSERT mot blocked_times med cleaner_id från annat
--   företag. Förväntat: permission denied.
--
-- Rollback:
--   DROP POLICY "Cleaner or VD manages blocked_times" ON public.blocked_times;
--   CREATE POLICY "Cleaner sees own blocked" ON public.blocked_times
--     USING (cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()));
--   CREATE POLICY "Auth inserts blocked_times" ON public.blocked_times
--     FOR INSERT WITH CHECK (cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()));
--   REVOKE UPDATE, DELETE ON public.blocked_times FROM authenticated;
