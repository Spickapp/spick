-- RUT-spårning på bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS rut_claim_id     TEXT,
  ADD COLUMN IF NOT EXISTS rut_claim_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rut_claim_error  TEXT,
  ADD COLUMN IF NOT EXISTS rut_submitted_at TIMESTAMPTZ;

-- Separat tabell för alla RUT-ärenden (logg + historik)
CREATE TABLE IF NOT EXISTS rut_claims (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
  claim_id    TEXT,                        -- Skatteverkets ärendenummer
  status      TEXT DEFAULT 'pending',      -- pending, submitted, approved, rejected
  amount      INTEGER,                     -- Belopp i kr
  xml_sent    TEXT,                        -- XML skickat till SKV
  response    TEXT,                        -- Svar från SKV
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_rut_claims_booking  ON rut_claims(booking_id);
CREATE INDEX IF NOT EXISTS idx_rut_claims_status   ON rut_claims(status);
CREATE INDEX IF NOT EXISTS idx_rut_claims_claim_id ON rut_claims(claim_id);

-- RLS: bara service role kan läsa/skriva
ALTER TABLE rut_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Service role full access" ON rut_claims
  USING (auth.role() = 'service_role');

COMMENT ON TABLE rut_claims IS 'Logg över alla RUT-ansökningar till Skatteverket';
