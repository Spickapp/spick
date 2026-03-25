-- SPICK -- Alias+system & GDPR
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS alias TEXT,
  ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '🥉',
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS identity_hash TEXT,
  ADD COLUMN IF NOT EXISTS bankid_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bonus_level TEXT DEFAULT 'Brons',
  ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gdpr_consent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gdpr_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_public BOOLEAN DEFAULT true;
CREATE OR REPLACE VIEW public_cleaner_profiles AS SELECT id,alias,emoji,city,bio,avg_rating,review_count,bonus_level,service_radius_km,identity_verified,status,created_at::DATE as member_since FROM cleaners WHERE status='godkänd' AND profile_public=true;
CREATE INDEX IF NOT EXISTS idx_cleaners_email ON cleaners(email);
CREATE INDEX IF NOT EXISTS idx_cleaners_alias ON cleaners(alias);
CREATE INDEX IF NOT EXISTS idx_cleaners_status ON cleaners(status);