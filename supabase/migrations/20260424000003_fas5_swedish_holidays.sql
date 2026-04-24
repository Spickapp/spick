-- ============================================================
-- Fas 5 §5.11 — swedish_holidays-tabell + data 2026-2028
-- ============================================================
-- Statisk lista över svenska allmänna helgdagar (röda dagar).
-- Används av auto-rebook för att skippa/flytta bokningar som landar
-- på helgdag, baserat på subscriptions.holiday_mode.
--
-- Datakälla: officiella svenska allmänna helgdagar per kalenderlagen
-- (1989:253). Listan täcker 2026-2028. Ny batch behöver läggas till
-- innan 2029 (automatiserat beräknings-script kan tillkomma senare).
--
-- Rörliga helgdagar (påsk-derivat) beräknade manuellt per år.
-- Fasta helgdagar direkt i datum.
--
-- Primärkälla: docs/planning/spick-arkitekturplan-v3.md §5.11
-- Rule #30: helgdagar är statiska fakta (kalenderlagen), inte
--   regulator-tolkning. Fastställd lista.
-- ============================================================

CREATE TABLE IF NOT EXISTS swedish_holidays (
  holiday_date date PRIMARY KEY,
  name         text NOT NULL,
  is_red_day   boolean NOT NULL DEFAULT true,  -- true = allmän helgdag enligt lagen
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Primary key på holiday_date räcker för range-scans (YEAR-filter använder BETWEEN)

-- RLS: public read (används bland annat på frontend för att visualisera)
ALTER TABLE swedish_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read holidays" ON swedish_holidays;
CREATE POLICY "Anyone can read holidays"
  ON swedish_holidays FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages holidays" ON swedish_holidays;
CREATE POLICY "Service role manages holidays"
  ON swedish_holidays FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT ON swedish_holidays TO anon, authenticated;
GRANT ALL    ON swedish_holidays TO service_role;

-- ============================================================
-- Data: 2026 (13 helgdagar)
-- ============================================================
INSERT INTO swedish_holidays (holiday_date, name) VALUES
  ('2026-01-01', 'Nyårsdagen'),
  ('2026-01-06', 'Trettondedag jul'),
  ('2026-04-03', 'Långfredagen'),
  ('2026-04-05', 'Påskdagen'),
  ('2026-04-06', 'Annandag påsk'),
  ('2026-05-01', 'Första maj'),
  ('2026-05-14', 'Kristi himmelsfärdsdag'),
  ('2026-05-24', 'Pingstdagen'),
  ('2026-06-06', 'Sveriges nationaldag'),
  ('2026-06-20', 'Midsommardagen'),
  ('2026-10-31', 'Alla helgons dag'),
  ('2026-12-25', 'Juldagen'),
  ('2026-12-26', 'Annandag jul')
ON CONFLICT (holiday_date) DO NOTHING;

-- ============================================================
-- Data: 2027
-- ============================================================
INSERT INTO swedish_holidays (holiday_date, name) VALUES
  ('2027-01-01', 'Nyårsdagen'),
  ('2027-01-06', 'Trettondedag jul'),
  ('2027-03-26', 'Långfredagen'),
  ('2027-03-28', 'Påskdagen'),
  ('2027-03-29', 'Annandag påsk'),
  ('2027-05-01', 'Första maj'),
  ('2027-05-06', 'Kristi himmelsfärdsdag'),
  ('2027-05-16', 'Pingstdagen'),
  ('2027-06-06', 'Sveriges nationaldag'),
  ('2027-06-26', 'Midsommardagen'),
  ('2027-11-06', 'Alla helgons dag'),
  ('2027-12-25', 'Juldagen'),
  ('2027-12-26', 'Annandag jul')
ON CONFLICT (holiday_date) DO NOTHING;

-- ============================================================
-- Data: 2028
-- ============================================================
INSERT INTO swedish_holidays (holiday_date, name) VALUES
  ('2028-01-01', 'Nyårsdagen'),
  ('2028-01-06', 'Trettondedag jul'),
  ('2028-04-14', 'Långfredagen'),
  ('2028-04-16', 'Påskdagen'),
  ('2028-04-17', 'Annandag påsk'),
  ('2028-05-01', 'Första maj'),
  ('2028-05-25', 'Kristi himmelsfärdsdag'),
  ('2028-06-04', 'Pingstdagen'),
  ('2028-06-06', 'Sveriges nationaldag'),
  ('2028-06-24', 'Midsommardagen'),
  ('2028-11-04', 'Alla helgons dag'),
  ('2028-12-25', 'Juldagen'),
  ('2028-12-26', 'Annandag jul')
ON CONFLICT (holiday_date) DO NOTHING;

-- Verifiering:
-- SELECT COUNT(*) FROM swedish_holidays GROUP BY EXTRACT(YEAR FROM holiday_date);
-- → 3 rader, 13 per år
