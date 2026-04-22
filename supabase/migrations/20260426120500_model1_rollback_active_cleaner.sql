-- ============================================================
-- Sprint Model-1 ROLLBACK (2026-04-26): DROP cleaners.active_cleaner
-- ============================================================
-- Motivation: Föregående migration (20260426120000) lade till kolumn
-- active_cleaner med semantik "true = utför städjobb själv". Efter
-- deployment upptäcktes att cleaners.owner_only redan existerar med
-- IDENTISK semantik (omvänd värde: owner_only=true betyder "utför
-- INTE städjobb, bara hanterar team").
--
-- Källa för owner_only: supabase/migrations/00004_fas_2_1_cleaners.sql
-- rad 89, docs/4-PRODUKTIONSDATABAS.md rad 51.
--
-- UI-toggles existerar redan:
--   - stadare-dashboard.html:1169 ("Jag städar inte själv" → toggleOwnerOnly)
--   - admin.html:3774 (cd-owner-only checkbox)
--
-- Klient-side filter boka.html:2010 (cleaners.filter(c => !c.owner_only))
-- fungerar. Sprint Model-2 kommer flytta filtret till RPC hard-filter
-- (NOT owner_only) istället för att läsa active_cleaner.
--
-- LÄRDOM (regel #26): Audit 2026-04-26-foretag-vs-stadare-modell.md
-- missade att grep efter "owner_only" som nyckelord. Regel brast vid
-- "kartlägg alla call-sites av is_company_owner" — skulle även ha
-- inkluderat "kolla om det finns andra relevanta boolean-kolumner".
-- Nästa audit-mall: expandera grep till alla cleaners-boolean-fält.
--
-- Regler:
--   #26 — grep-före-edit (bekräftad brist som denna commit åtgärdar)
--   #27 — scope: endast rollback + audit-update, inget nytt
--   #28 — single source of truth: owner_only är SAMMA information,
--         ska inte dupliceras med active_cleaner
--   #31 — primärkälla: owner_only är i DB + migration + docs
-- ============================================================

BEGIN;

ALTER TABLE public.cleaners DROP COLUMN IF EXISTS active_cleaner;

-- Verifiering
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'cleaners'
      AND column_name  = 'active_cleaner'
  ) THEN
    RAISE EXCEPTION 'Model-1 rollback: active_cleaner finns fortfarande efter DROP';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'cleaners'
      AND column_name  = 'owner_only'
  ) THEN
    RAISE EXCEPTION 'Model-1 rollback: owner_only saknas — rollback ska inte ske utan alternativ';
  END IF;

  RAISE NOTICE 'OK: active_cleaner raderad. owner_only är single source of truth (boolean, default false).';
END $$;

COMMIT;

-- ============================================================
-- Efter denna rollback:
--   Sprint Model-1 UI-toggles: INGA NYA NÖDVÄNDIGA (existerar redan)
--   Sprint Model-2 RPC: använd "NOT cleaners.owner_only" som hard-filter
--   Audit 2026-04-26-foretag-vs-stadare-modell.md §5.2 uppdaterad
-- ============================================================
