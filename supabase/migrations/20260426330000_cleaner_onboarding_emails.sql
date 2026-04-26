-- ═══════════════════════════════════════════════════════════════
-- SPICK – Sprint 1D: cleaner onboarding email-drip schema
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- 4-mail onboarding-drip för nya cleaners (templates i
-- docs/marketing/cleaner-onboarding-email-drip.md, Farhad-godkänd
-- 2026-04-26):
--   day_1   — välkomst + 3-stegs aktivering (1h efter approval)
--   day_3   — optimera profil (3 tips)
--   week_1  — marketing-kit + profil-länk (Sprint 1E retention-loop)
--   month_1 — recensions-strategi
--
-- DESIGN
-- - cleaners.onboarding_emails_sent jsonb håller send-historik:
--     { "day_1": "2026-04-26T10:00:00Z", "day_3": null, ... }
-- - Cron-EF cleaner-onboarding-emails (1x/dag) loopar
--   is_approved=true cleaners, plockar nästa-mail-i-sekvens,
--   skickar via Resend, uppdaterar timestamp.
-- - Vi använder day_1-timestamp som ankarpunkt för alla efterföljande
--   mail (day_3, week_1, month_1) istället för cleaners.approved_at.
--   Anledning: curl-verifiering 2026-04-26 visade att approved_at är
--   opålitligt (anon-grant saknas, möjlig schema-drift). Att använda
--   day_1-stämpeln som ankare gör pipelinen robust mot schema-drift
--   och self-contained.
--
-- REGLER (#26-#31):
-- - #28 SSOT: en jsonb-kolumn, ingen separat sent-mails-tabell
-- - #31 schema curl-verifierat 2026-04-26: cleaners.is_approved finns,
--   approved_at osynlig för anon (eventuell drift) → vi förlitar oss
--   inte på den.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Kolumn ────────────────────────────────────────────────
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS onboarding_emails_sent JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.cleaners.onboarding_emails_sent IS
  'Sprint 1D: send-historik för 4-mail onboarding-drip. Format: { "day_1": ts, "day_3": ts, "week_1": ts, "month_1": ts }. Endast set:as av cleaner-onboarding-emails-cron-EF.';

-- ── 2. Index för cron-query ──────────────────────────────────
-- Plockar bara approved cleaners. EF:n filtrerar sen via JSON-state
-- in-memory eftersom JSON-key-kombinationerna gör BTREE-index
-- ineffektiva.
CREATE INDEX IF NOT EXISTS idx_cleaners_onboarding_drip
  ON public.cleaners (is_approved, id)
  WHERE is_approved = true;

DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 20260426330000 COMPLETE — Sprint 1D cleaner onboarding-emails schema';
END $$;
