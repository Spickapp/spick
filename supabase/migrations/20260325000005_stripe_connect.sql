-- Stripe Connect: utbetalningskolumner på bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payout_status     TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payout_amount     INTEGER,
  ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_out_at       TIMESTAMPTZ;

-- Stripe Connect-kolumner på cleaners
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS stripe_account_id       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_onboarding_status TEXT DEFAULT 'pending';

-- Index
CREATE INDEX IF NOT EXISTS idx_bookings_payout_status ON bookings(payout_status);
CREATE INDEX IF NOT EXISTS idx_cleaners_stripe_account ON cleaners(stripe_account_id);
