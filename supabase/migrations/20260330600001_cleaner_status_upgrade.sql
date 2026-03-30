-- ═══════════════════════════════════════════════════════════════
-- SPICK – Cleaner status upgrade (pausad/aktiv/avstängd)
-- Körs: 2026-03-30
-- ═══════════════════════════════════════════════════════════════

-- Steg 1: Normalisera befintliga statusar
UPDATE cleaners SET status = 'aktiv' WHERE status = 'godkänd' AND is_approved = true;

-- Steg 2: Säkerställ att admin_notes finns
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- Steg 3: Index för snabb filtrering
CREATE INDEX IF NOT EXISTS idx_cleaners_status_approved ON cleaners(status, is_approved);

-- Steg 4: Kommentera giltiga statusar
COMMENT ON COLUMN cleaners.status IS 'aktiv | pausad | avstängd | godkänd (legacy)';

-- Steg 5: Uppdatera vyn för publika profiler (exkludera pausade/avstängda)
CREATE OR REPLACE VIEW public_cleaner_profiles AS 
SELECT 
  id, alias, emoji, city, bio, avg_rating, review_count, 
  bonus_level, service_radius_km, identity_verified, 
  status, created_at::DATE as member_since 
FROM cleaners 
WHERE is_approved = true 
  AND status = 'aktiv' 
  AND (profile_public IS NULL OR profile_public = true);
