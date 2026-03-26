-- Stripe betalningskolumner på bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','cancelled','refunded')),
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Index för snabba uppslag på Stripe session
CREATE INDEX IF NOT EXISTS idx_bookings_stripe_session ON bookings(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);

-- Kommentar
COMMENT ON COLUMN bookings.payment_status IS 'pending=ej betalt, paid=betalt via Stripe, cancelled=avbröt, refunded=återbetalt';
