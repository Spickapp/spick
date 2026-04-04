-- ═══════════════════════════════════════════════════════════
-- SPICK — Godkänn-kedja + Accept/Reject bokningar
-- Kör i Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- 1. cleaner_applications: status-kolumner
ALTER TABLE cleaner_applications
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- 2. bookings: bekräftelse-kolumner
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
