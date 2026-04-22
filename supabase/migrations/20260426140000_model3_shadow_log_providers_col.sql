-- ============================================================
-- Sprint Model-3 (2026-04-26): matching_shadow_log.providers_ranking
-- ============================================================
-- Syfte: Ny jsonb-kolumn för att logga output från find_nearby_providers
-- (Model-2a) bredvid v1_ranking + v2_ranking. Behövs för shadow-mode
-- 'providers-shadow' där v2 + providers körs parallellt och diff
-- analyseras.
--
-- Formatskillnad:
--   v1_ranking / v2_ranking = [{ cleaner_id, rank, ...scores }]
--   providers_ranking       = [{ provider_type, provider_id, rank,
--                               representative_cleaner_id, team_size }]
--
-- Separat kolumn undviker format-kollision med existerande
-- §3.9a-analys-VIEWs som förväntar specifikt schema.
--
-- Regler:
--   #26 — grep-före-edit: matching_shadow_log-schema verifierat
--         (Dag 1-migration 20260424231000)
--   #27 — scope: endast ALTER TABLE ADD, inga befintliga kolumner
--         ändrade
--   #28 — providers_ranking = single source of truth för
--         provider-format i shadow-analys
--   #31 — primärkälla: Dag 1-migration + matching-wrapper EF
-- ============================================================

BEGIN;

ALTER TABLE public.matching_shadow_log
  ADD COLUMN IF NOT EXISTS providers_ranking jsonb;

COMMENT ON COLUMN public.matching_shadow_log.providers_ranking IS
  'Sprint Model-3 (2026-04-26): ranking-output från find_nearby_providers '
  '(Model-2a). Array av {provider_type, provider_id, rank, '
  'representative_cleaner_id, team_size}. NULL när shadow-mode inte är '
  'providers-shadow.';

-- Index för framtida §3.9-pilot-analys som frågar på provider-diff
CREATE INDEX IF NOT EXISTS matching_shadow_log_providers_idx
  ON public.matching_shadow_log ((providers_ranking IS NOT NULL))
  WHERE providers_ranking IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'matching_shadow_log'
      AND column_name  = 'providers_ranking'
  ) THEN
    RAISE EXCEPTION 'Sprint Model-3: providers_ranking saknas efter ALTER';
  END IF;

  RAISE NOTICE 'OK: matching_shadow_log.providers_ranking tillagd (jsonb, partial idx).';
END $$;

COMMIT;
