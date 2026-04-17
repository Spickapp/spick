BEGIN;

-- Rulla tillbaka actual_start_at / actual_end_at
-- Systemet använder checkin_time/checkout_time + completed_at istället
-- actual_hours BEHÅLLS (används av team-jobb.html:562, stadare-dashboard.html:9242)

DROP INDEX IF EXISTS idx_bookings_actual_times;
ALTER TABLE bookings DROP COLUMN IF EXISTS actual_start_at;
ALTER TABLE bookings DROP COLUMN IF EXISTS actual_end_at;

COMMIT;
