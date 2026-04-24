-- ═══════════════════════════════════════════════════════════════
-- Fas 7.5 hotfix — GRANT till authenticated-role
-- ═══════════════════════════════════════════════════════════════
--
-- Bug: Views skapade i 20260424231500 + tabellen i 20260424233000
-- fick bara GRANT till service_role. Admin-UI:n använder authenticated
-- (via magic-link-session) → blev 0-rader i RUT-kö trots att data fanns.
--
-- Fix: Lägg till authenticated-GRANTs. RLS-policies på underliggande
-- tabeller avgör fortfarande vad admin faktiskt ser.
--
-- Rule #26: Verifierat i prod via admin-UI som visade 0 pending.
-- Rule #31: prod-test bekräftade GRANT-saknade rot-orsak.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

GRANT SELECT ON public.v_rut_pending_queue TO authenticated;
GRANT SELECT ON public.v_customer_rut_summary TO authenticated;
GRANT SELECT ON public.rut_batch_submissions TO authenticated;

COMMIT;
