-- Referral-tabell för tipsa-en-vän
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_email TEXT NOT NULL,
  referred_email TEXT NOT NULL,
  ref_code TEXT NOT NULL,
  status TEXT DEFAULT 'skickad',
  converted_at TIMESTAMPTZ,
  reward_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_ref_code ON referrals(ref_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_email ON referrals(referred_email);

-- RLS
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon kan insertera referral" ON referrals FOR INSERT TO anon WITH CHECK (true);

SELECT 'Migration 20260326000003 klar ✅' AS status;
