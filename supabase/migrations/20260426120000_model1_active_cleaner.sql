-- ============================================================
-- Sprint Model-1 (2026-04-26): cleaners.active_cleaner
-- ============================================================
-- Syfte: Infrastruktur för Modell B (företag-vs-städare-refaktor).
-- Markerar om en cleaner-rad faktiskt utför städjobb själv, eller om
-- personen endast är administratör (VD utan städarbete, pausad osv).
--
-- Default TRUE = bakåtkompatibilitet. Alla befintliga rader fortsätter
-- fungera exakt som idag i matching (find_nearby_cleaners-filter är
-- ännu INTE uppdaterat till att läsa active_cleaner — det sker i
-- Sprint Model-2).
--
-- Farhad markerar manuellt via admin.html (Sprint Model-1 Step 3) eller
-- VD-dashboard (Sprint Model-1 Step 4) vilka VD:er som inte städar
-- själva. Detta styr framtida matching-aggregering.
--
-- Primärkälla:
--   docs/audits/2026-04-26-foretag-vs-stadare-modell.md §5.2
--
-- Regler:
--   #26 — grep-före-edit: verifierat att ingen befintlig kolumn heter
--         active_cleaner eller motsvarande (via information_schema-query
--         2026-04-26)
--   #27 — scope: endast kolumn + default, ingen backfill-logik, ingen
--         trigger, ingen matching-ändring
--   #28 — ingen pricing/commission-påverkan
--   #31 — primärkälla: DB-schema + audit-dokument. Inte memory.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Lägg till kolumn (idempotent)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS active_cleaner boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.cleaners.active_cleaner IS
  'Sprint Model-1 (2026-04-26): true = personen utför städjobb själv '
  'och inkluderas i matching-aggregat. false = endast administratör '
  '(VD utan städarbete, onboarding-pausad). Solo-cleaners: alltid true. '
  'Markeras via admin-panel (per-cleaner) eller VD-dashboard (self-flagg). '
  'Läses av find_nearby_providers i Sprint Model-2. Default TRUE för '
  'bakåtkompatibilitet.';

-- ────────────────────────────────────────────────────────────
-- 2. Verifiering
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_col_exists  boolean;
  v_default     text;
  v_nullable    text;
BEGIN
  SELECT
    (c.column_default IS NOT NULL),
    c.column_default,
    c.is_nullable
  INTO v_col_exists, v_default, v_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name   = 'cleaners'
    AND c.column_name  = 'active_cleaner';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sprint Model-1: active_cleaner saknas efter ALTER TABLE';
  END IF;

  IF v_nullable <> 'NO' THEN
    RAISE EXCEPTION 'Sprint Model-1: active_cleaner måste vara NOT NULL (fick %)', v_nullable;
  END IF;

  IF v_default NOT LIKE '%true%' THEN
    RAISE EXCEPTION 'Sprint Model-1: active_cleaner saknar default true (fick %)', v_default;
  END IF;

  RAISE NOTICE 'OK: active_cleaner tillagd (boolean NOT NULL DEFAULT true)';
END $$;

COMMIT;

-- ============================================================
-- Nästa steg (Sprint Model-1 Step 3+4):
--   Admin-panel: toggle "Aktiv städare" per cleaner-rad
--   VD-dashboard: toggle "Städar du själv?" för is_company_owner=true
--
-- Framtida (Sprint Model-2):
--   find_nearby_providers RPC läser active_cleaner som hard filter
-- ============================================================
