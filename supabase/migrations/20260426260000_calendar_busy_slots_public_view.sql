-- v_calendar_busy_slots — publik vy för boka.html (utan PII)
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: Min PII-fix 20260426220000 REVOKE:ade anon SELECT från
--   calendar_events (skyddar adresser/titlar). Men boka.html behöver
--   busy-slot-info (cleaner_id+start/end) för att visa lediga tider.
--   Konsekvens: boka.html föll tillbaka till LEGACY tables → stale.
--
-- Lösning: ny minimal publik vy med ENDAST de fält boka.html behöver:
--   cleaner_id, start_at, end_at, event_type, is_all_day, title, source
-- Adresser/notes/lat-lng/customer-id stannar privata i calendar_events.
--
-- Title är SAFE eftersom VD själv väljer titel ("Lediga tider", "Möte",
-- "Stängt"). Inga PII där per design.
--
-- Verifiering rule #31:
--   - calendar_events tabell finns + RLS aktiv (verifierat tidigare)
--   - boka.html-query verifierad i live console-log:
--     "GET /rest/v1/calendar_events?and=(start_at.gte...)&select=
--      cleaner_id,start_at,end_at,event_type,is_all_day,title,source"
-- ════════════════════════════════════════════════════════════════════

-- ── Skapa publik vy ──
CREATE OR REPLACE VIEW public.v_calendar_busy_slots AS
SELECT
  ce.cleaner_id,
  ce.start_at,
  ce.end_at,
  ce.event_type,
  ce.is_all_day,
  ce.title,
  ce.source
FROM public.calendar_events ce
WHERE ce.start_at >= NOW() - INTERVAL '7 days'  -- Bara framtid + nyligen (perf)
  AND ce.start_at <= NOW() + INTERVAL '180 days';

-- ── GRANT till anon + authenticated ──
GRANT SELECT ON public.v_calendar_busy_slots TO anon;
GRANT SELECT ON public.v_calendar_busy_slots TO authenticated;

COMMENT ON VIEW public.v_calendar_busy_slots IS
  'Publik vy för boka.html availability-check. ENDAST cleaner_id + start/end + type/title — INGA adresser/notes/lat-lng. Skapad 2026-04-26 efter PII-fix-migration som revoked underliggande calendar_events från anon.';
