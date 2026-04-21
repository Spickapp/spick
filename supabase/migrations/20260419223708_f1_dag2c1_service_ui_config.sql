-- ============================================================
-- F1 Dag 2C.1: Add ui_config per service for boka.html rendering
-- ============================================================
-- Written: 2026-04-19
-- Fas: F1 Dag 2C i arkitekturplan v3
-- Design: docs/architecture/fas-1-services-design.md Section 7
--
-- CONTEXT
-- boka.html service-buttons have emoji + description + popular-badge
-- + B2B-button-id hardcoded in HTML. Migrating to DB-driven render
-- requires these values in DB. Stored in services.ui_config (JSONB)
-- to avoid new column sprawl. Regel #28: no further fragmentation.
--
-- Schema (ui_config per service):
--   emoji       TEXT  -- rendered as svc-icon
--   desc_sv     TEXT  -- rendered as svc-desc
--   is_popular  BOOL  -- shows POPULARAST badge
--   b2b_id      TEXT  -- DOM id for existing B2B toggle logic
--
-- Values extracted verbatim from boka.html rad 291-378.
-- ============================================================

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '🏠',
  'desc_sv', 'Löpande städning · 2–4h',
  'is_popular', true
) WHERE key = 'hemstadning';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '⭐',
  'desc_sv', 'Premium-tjänst',
  'is_popular', false
) WHERE key = 'premiumstadning';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '✨',
  'desc_sv', 'Grundlig, hela hemmet · 4–8h',
  'is_popular', false
) WHERE key = 'storstadning';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '📦',
  'desc_sv', 'Godkänd vid besiktning · 4–10h',
  'is_popular', false
) WHERE key = 'flyttstadning';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '🪟',
  'desc_sv', 'In- & utvändigt · från 1h',
  'is_popular', false
) WHERE key = 'fonsterputs';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '🧺',
  'desc_sv', 'Offert på plats',
  'is_popular', false
) WHERE key = 'mattrengoring';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '🏢',
  'desc_sv', 'Daglig/veckovis · 2–6h',
  'is_popular', false,
  'b2b_id', 'svc-kontor'
) WHERE key = 'kontorsstadning';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '🪜',
  'desc_sv', 'BRF & fastigheter · 2-4h',
  'is_popular', false,
  'b2b_id', 'svc-trapp'
) WHERE key = 'trappstadning';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '🏫',
  'desc_sv', 'Skolor & förskolor · 3-6h',
  'is_popular', false,
  'b2b_id', 'svc-skola'
) WHERE key = 'skolstadning';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '🏥',
  'desc_sv', 'Vårdlokaler & kliniker · 3-6h',
  'is_popular', false,
  'b2b_id', 'svc-vard'
) WHERE key = 'vardstadning';

UPDATE services SET ui_config = jsonb_build_object(
  'emoji', '🏨',
  'desc_sv', 'Hotell & restauranger · 2-6h',
  'is_popular', false,
  'b2b_id', 'svc-hotell'
) WHERE key = 'hotell_restaurang';

-- Post-check (run in Supabase Studio):
--   SELECT key, label_sv, ui_config FROM services ORDER BY display_order;
--   -- Expected: all 11 rows with non-empty ui_config
--
--   SELECT key, ui_config->>'emoji' AS emoji,
--          ui_config->>'desc_sv' AS desc,
--          ui_config->>'is_popular' AS popular,
--          ui_config->>'b2b_id' AS b2b
--   FROM services ORDER BY display_order;
-- ============================================================
