-- calendar_events RLS — utöka DELETE/UPDATE för VD + admin
-- ════════════════════════════════════════════════════════════════════
-- Bug 2026-04-26 (Farhad live-test):
--   VD i admin-view-as-mode klickade 'Ta bort blockering' → ingen feedback,
--   blockering kvar. Root: RLS-policy bara tillåter cleaner SJÄLV att
--   DELETE/UPDATE sina calendar_events.
--
--   VD i admin-mode har auth.uid() = admin-cleaner, INTE team-cleaner.
--   → policy matchade ej → DELETE returnerade 0 rader (no-op).
--
-- Fix: utöka FOR ALL-policy så VD (is_company_owner=true) får manage
--      team-medlemmars events, plus admin via is_admin() får manage allt.
--
-- Verifiering (rule #31):
--   calendar_events finns + är RLS-aktiv (verifierat via curl 401)
--   cleaners.is_company_owner finns (verifierat tidigare)
--   is_admin() RPC finns (används i andra policies)
-- ════════════════════════════════════════════════════════════════════

-- Drop original-policy + ersätt med utvidgad version
DROP POLICY IF EXISTS "Authenticated users manage own calendar_events" ON calendar_events;

CREATE POLICY "Authenticated users manage own calendar_events"
  ON calendar_events FOR ALL USING (
    -- (1) Cleanern själv (original-pattern)
    cleaner_id IN (
      SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
    )
    OR
    -- (2) VD (is_company_owner=true) får manage team-medlemmars events
    cleaner_id IN (
      SELECT t.id FROM cleaners t
      JOIN cleaners vd ON vd.company_id = t.company_id
      WHERE vd.auth_user_id = auth.uid()
        AND vd.is_company_owner = true
    )
    OR
    -- (3) Admin får manage allt (för admin-view-as + support)
    public.is_admin()
  );

COMMENT ON POLICY "Authenticated users manage own calendar_events" ON calendar_events IS
  'Utökad 2026-04-26: cleaner SJÄLV + VD (team-medlemmar) + admin (alla). Tidigare bara cleaner-själv → blockerade VD-Ta-bort.';
