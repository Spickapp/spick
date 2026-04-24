-- ============================================================
-- Fas 5 §5.9 — recurring_nudge_sent_at på customer_profiles
-- ============================================================
-- Spårar om kunden fått 7d-nudge-email om att starta återkommande städning.
-- Sätts av customer-nudge-recurring EF efter email-dispatch.
-- NULL = har ej fått nudge än (eller nudge-kandidat).
--
-- Primärkälla: docs/planning/spick-arkitekturplan-v3.md §5.9
-- Skapad: 2026-04-24
-- ============================================================

ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS recurring_nudge_sent_at timestamptz;

-- Index för snabb filtering av kandidater (bara NULL-rader scannas)
CREATE INDEX IF NOT EXISTS idx_customer_profiles_nudge_pending
  ON customer_profiles (created_at)
  WHERE recurring_nudge_sent_at IS NULL;

-- Verifiering:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='customer_profiles' AND column_name='recurring_nudge_sent_at';
