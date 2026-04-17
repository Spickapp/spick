-- Tid-tracking för RUT-compliance (Skatteverket kräver faktiska timmar)
-- Verifierat 18 april 2026: actual_hours finns redan (0 rader),
-- actual_start_at + actual_end_at läggs till

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS actual_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_end_at TIMESTAMPTZ;

-- actual_hours finns redan, ingen ändring behövs

-- Index för RUT-rapport-generering
CREATE INDEX IF NOT EXISTS idx_bookings_actual_times
  ON bookings(actual_start_at, actual_end_at)
  WHERE actual_start_at IS NOT NULL;

-- Kommentarer
COMMENT ON COLUMN bookings.actual_start_at IS
  'När cleaner klickade "Start" — krävs av Skatteverket för RUT-ansökan';
COMMENT ON COLUMN bookings.actual_end_at IS
  'När cleaner klickade "Klar" — krävs av Skatteverket för RUT-ansökan';
COMMENT ON COLUMN bookings.actual_hours IS
  'Beräknas automatiskt vid "end" som (actual_end_at - actual_start_at) i timmar';

COMMIT;
