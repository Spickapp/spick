-- ═══════════════════════════════════════════════════════════════
-- SPICK Sprint B Dag 6 — Cron-scheduling + index
-- 
-- Kör i Supabase SQL Editor.
-- Dessa scheman triggar de nya EFs poll-stripe-onboarding-status 
-- och expire-team-invitations.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Partial index för effektiv expire-polling ──
-- Utan denna gör cron full table scan på cleaner_applications (blir 
-- problem när invites-volymen växer).
CREATE INDEX IF NOT EXISTS idx_cleaner_applications_invited_created
  ON cleaner_applications (created_at)
  WHERE status = 'invited';

-- ── 2. Schedulera poll-stripe-onboarding-status ──
-- Körs var 30:e minut (*/30 * * * *). Safety-net om Stripe webhook missar event.
SELECT cron.schedule(
  'poll-stripe-onboarding-status',
  '*/30 * * * *',
  $$SELECT net.http_post(
    'https://urjeijcncsyuletprydy.supabase.co/functions/v1/poll-stripe-onboarding-status',
    '{}',
    'application/json',
    ARRAY[net.http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))]
  )$$
);

-- ── 3. Schedulera expire-team-invitations ──
-- Dagligen 00:00. Markera invites äldre än 7d som expired + notifiera VD.
SELECT cron.schedule(
  'expire-team-invitations',
  '0 0 * * *',
  $$SELECT net.http_post(
    'https://urjeijcncsyuletprydy.supabase.co/functions/v1/expire-team-invitations',
    '{}',
    'application/json',
    ARRAY[net.http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))]
  )$$
);

-- ── 4. Verifiera ──
-- SELECT jobid, jobname, schedule, active FROM cron.job 
--  WHERE jobname IN ('poll-stripe-onboarding-status','expire-team-invitations')
--  ORDER BY jobid DESC;

-- ── Manuell unschedule (om behov att rulla tillbaka): ──
-- SELECT cron.unschedule('poll-stripe-onboarding-status');
-- SELECT cron.unschedule('expire-team-invitations');
