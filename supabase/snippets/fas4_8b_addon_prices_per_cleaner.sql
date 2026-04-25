-- ═══════════════════════════════════════════════════════════════
-- SPICK – §4.8b "Eget städmaterial" — per-service default + cleaner-overrides
-- ═══════════════════════════════════════════════════════════════
--
-- Farhad-direktiv 2026-04-25:
--   1. Default-priser per service (Hemstadning 99, Storstadning 199, etc)
--   2. Städaren/städföretaget kan välja egen pris eller "ingår gratis"
--   3. Annars default
--
-- Arkitektur:
--   - service_addons.price_sek = default
--   - cleaner_addon_prices = override per cleaner (custom price OR included_free)
--   - booking-create läser override först, fallback till default
--
-- KÖRS i Supabase Studio. Block-by-block.
--
-- REGLER: #26 service_addons + cleaner_service_prices-pattern verifierat,
-- #27 scope (default-update + ny tabell, ingen broader change),
-- #28 SSOT (cleaner_addon_prices för overrides, service_addons för default),
-- #29 booking-create rad 343-377 reviewat — addon-flow förstått,
-- #30 ej regulator (rena priser, inte RUT-tolkning),
-- #31 service_addons-IDs hämtas via JOIN i UPDATE — primärkälla DB.
-- ═══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- BLOCK 1: Uppdatera default-priser per service
-- ──────────────────────────────────────────────────────────────
-- Farhads förslag: 99/199/299/79/199 (lågt psykologiskt → minimal friction)

UPDATE service_addons SET price_sek = 99
WHERE key = 'eget_stadmaterial'
  AND service_id = (SELECT id FROM services WHERE key = 'hemstadning');

UPDATE service_addons SET price_sek = 199
WHERE key = 'eget_stadmaterial'
  AND service_id = (SELECT id FROM services WHERE key = 'storstadning');

UPDATE service_addons SET price_sek = 299
WHERE key = 'eget_stadmaterial'
  AND service_id = (SELECT id FROM services WHERE key = 'flyttstadning');

UPDATE service_addons SET price_sek = 79
WHERE key = 'eget_stadmaterial'
  AND service_id = (SELECT id FROM services WHERE key = 'fonsterputs');

UPDATE service_addons SET price_sek = 199
WHERE key = 'eget_stadmaterial'
  AND service_id = (SELECT id FROM services WHERE key = 'mattrengoring');


-- ──────────────────────────────────────────────────────────────
-- BLOCK 2: Verifiera defaults
-- ──────────────────────────────────────────────────────────────
SELECT
  s.label_sv AS service,
  a.price_sek,
  a.active
FROM service_addons a
JOIN services s ON s.id = a.service_id
WHERE a.key = 'eget_stadmaterial'
ORDER BY s.display_order;


-- ──────────────────────────────────────────────────────────────
-- BLOCK 3: Skapa cleaner_addon_prices-tabell (override per cleaner)
-- ──────────────────────────────────────────────────────────────
-- Per cleaner kan välja:
--   - custom_price_sek = annat pris än default
--   - included_free = TRUE → addon ingår gratis (price=0 vid bokning)
--   - inget = använd default från service_addons.price_sek

CREATE TABLE IF NOT EXISTS public.cleaner_addon_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  addon_id uuid NOT NULL REFERENCES public.service_addons(id) ON DELETE CASCADE,
  custom_price_sek integer,
  included_free boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaner_addon_prices_unique UNIQUE (cleaner_id, addon_id),
  CONSTRAINT cleaner_addon_prices_price_check CHECK (
    custom_price_sek IS NULL OR custom_price_sek >= 0
  ),
  CONSTRAINT cleaner_addon_prices_logic_check CHECK (
    NOT (included_free = true AND custom_price_sek IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cleaner_addon_prices_cleaner
  ON public.cleaner_addon_prices(cleaner_id);

CREATE INDEX IF NOT EXISTS idx_cleaner_addon_prices_addon
  ON public.cleaner_addon_prices(addon_id);

COMMENT ON TABLE public.cleaner_addon_prices IS
  'Per-cleaner addon-prissättning. Override för service_addons.price_sek. included_free=TRUE → addon gratis vid denna cleaner.';


-- ──────────────────────────────────────────────────────────────
-- BLOCK 4: RLS — anon kan SELECT (för boka.html), bara cleaner själv
--          + admin kan UPDATE (via RLS på cleaner_id-match)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.cleaner_addon_prices ENABLE ROW LEVEL SECURITY;

-- Public SELECT (boka.html använder för att visa cleaner-pris)
DROP POLICY IF EXISTS "cleaner_addon_prices_select_anon" ON public.cleaner_addon_prices;
CREATE POLICY "cleaner_addon_prices_select_anon"
  ON public.cleaner_addon_prices
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- INSERT/UPDATE: bara via service_role (EF) eller cleaner själv via JWT
-- (cleaner-EF kommer i §4.8c). För nu: service_role-only.
-- (Inga policies för INSERT/UPDATE — RLS-default = deny för anon)


-- ──────────────────────────────────────────────────────────────
-- BLOCK 5: Verifiera tabell + index
-- ──────────────────────────────────────────────────────────────
SELECT
  c.relname AS table_name,
  c.reltuples AS estimated_rows,
  array_agg(i.indexname) AS indexes
FROM pg_class c
LEFT JOIN pg_indexes i ON i.tablename = c.relname AND i.schemaname = 'public'
WHERE c.relname = 'cleaner_addon_prices'
  AND c.relkind = 'r'
GROUP BY c.relname, c.reltuples;
