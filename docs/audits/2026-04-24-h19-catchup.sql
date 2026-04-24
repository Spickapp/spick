-- ═══════════════════════════════════════════════════════════════
-- H19 CATCHUP — registry-sync + bookings.rut (Fas 13 §13.2.b)
-- ═══════════════════════════════════════════════════════════════
--
-- Rule #31 prod-verified 2026-04-24:
--   Diagnos-SQL körd mot information_schema visar att ALLA tabeller +
--   RPCs från 43 missing migrations redan finns i prod. Endast EN
--   fysisk kolumn saknas: bookings.rut (BOOLEAN).
--
--   Migrations kördes mestadels — men registrerades inte i
--   supabase_migrations.schema_migrations. Detta script:
--     1. Lägger till den enda saknade kolumnen
--     2. Registrerar alla 43 missing versions (kanoniserar state)
--
-- SÄKERHET:
--   - IF NOT EXISTS på ALTER TABLE = idempotent, safe på re-run
--   - ON CONFLICT DO NOTHING på INSERT = idempotent
--   - BEGIN/COMMIT = atomär — rollback om något failar
--
-- Efter körning:
--   - Nästa drift-check visar 0 diff
--   - A04-EF fungerar (redan fixad, men kolumn finns nu också)
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Lägg till bookings.rut (endast saknade fysisk kolumn)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS rut BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.bookings.rut IS
  'Legacy boolean-flagga för RUT-berättigad bokning. Se även rut_amount (integer) för belopp.';

-- Backfill från rut_amount: alla bokningar med rut_amount > 0 markeras rut=true
UPDATE public.bookings
SET rut = true
WHERE rut_amount > 0 AND rut IS DISTINCT FROM true;

-- ─────────────────────────────────────────────────────────────
-- 2. Registrera 43 missing migrations som "körda"
-- ─────────────────────────────────────────────────────────────
-- Verifiering 2026-04-24 visade att effekterna av dessa migrations
-- ALREADY FINNS i prod (tabeller, kolumner, RPCs). Vi registrerar dem
-- som körda så future drift-check inte flaggar dem igen.

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES
  ('20260419220414'),
  ('20260419221724'),
  ('20260419223708'),
  ('20260419231108'),
  ('20260419235240'),
  ('20260420112820'),
  ('20260420121007'),
  ('20260420134202'),
  ('20260420134219'),
  ('20260420142027'),
  ('20260420181848'),
  ('20260420194228'),
  ('20260422113608'),
  ('20260422130000'),
  ('20260422131000'),
  ('20260423142550'),
  ('20260423150245'),
  ('20260423155052'),
  ('20260423202501'),
  ('20260424000001'),
  ('20260424000002'),
  ('20260424000003'),
  ('20260424230000'),
  ('20260424230500'),
  ('20260424231000'),
  ('20260425120000'),
  ('20260425130000'),
  ('20260425140000'),
  ('20260426120000'),
  ('20260426120500'),
  ('20260426130000'),
  ('20260426140000'),
  ('20260427000001'),
  ('20260427000002'),
  ('20260427000003'),
  ('20260427000004'),
  ('20260427000005'),
  ('20260427000006'),
  ('20260427000007'),
  ('20260427000008'),
  ('20260427000009'),
  ('20260427000010'),
  ('20260427000011')
ON CONFLICT (version) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 3. Verifiering
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  rut_col_exists boolean;
  missing_count integer;
BEGIN
  -- Kolumn-check
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='bookings' AND column_name='rut'
  ) INTO rut_col_exists;
  IF NOT rut_col_exists THEN
    RAISE EXCEPTION 'H19 catchup failed: bookings.rut saknas fortfarande';
  END IF;
  RAISE NOTICE 'OK: bookings.rut finns';

  -- Registry-check
  SELECT COUNT(*) INTO missing_count
  FROM (VALUES
    ('20260419220414'), ('20260419221724'), ('20260419223708'),
    ('20260419231108'), ('20260419235240'), ('20260420112820'),
    ('20260420121007'), ('20260420134202'), ('20260420134219'),
    ('20260420142027'), ('20260420181848'), ('20260420194228'),
    ('20260422113608'), ('20260422130000'), ('20260422131000'),
    ('20260423142550'), ('20260423150245'), ('20260423155052'),
    ('20260423202501'), ('20260424000001'), ('20260424000002'),
    ('20260424000003'), ('20260424230000'), ('20260424230500'),
    ('20260424231000'), ('20260425120000'), ('20260425130000'),
    ('20260425140000'), ('20260426120000'), ('20260426120500'),
    ('20260426130000'), ('20260426140000'), ('20260427000001'),
    ('20260427000002'), ('20260427000003'), ('20260427000004'),
    ('20260427000005'), ('20260427000006'), ('20260427000007'),
    ('20260427000008'), ('20260427000009'), ('20260427000010'),
    ('20260427000011')
  ) AS expected(v)
  WHERE v NOT IN (SELECT version FROM supabase_migrations.schema_migrations);

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'H19 catchup failed: % migrations fortfarande oregistrerade', missing_count;
  END IF;
  RAISE NOTICE 'OK: alla 43 migrations registrerade';

  RAISE NOTICE '═══════════════════════════════════════';
  RAISE NOTICE ' H19 CATCHUP KOMPLETT';
  RAISE NOTICE '═══════════════════════════════════════';
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- Post-check (valfritt — verifiera från SELECT):
-- ═══════════════════════════════════════════════════════════════
-- SELECT COUNT(*) AS total_registered FROM supabase_migrations.schema_migrations;
-- Förväntat: 100 + 43 = 143 (eller mer om fler registrerats sen)
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='bookings' AND column_name='rut';
-- Förväntat: 1 rad
