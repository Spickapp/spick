-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 8 §8.3 + §8.4: Escrow + Dispute schema-foundation
-- ═══════════════════════════════════════════════════════════════
--
-- EU Platform Work Directive (PWD) compliance — deadline 2 dec 2026.
-- Full-escrow-arkitektur via separate-charges-and-transfers (Stripe).
-- Primärkälla: docs/architecture/dispute-escrow-system.md §1-§3
--
-- ADDITIVE DDL ONLY — inga logic-changes i EFs eller booking-flow.
-- Stripe-architecture-shift (§8.2) + EF-retrofit (§8.6-§8.10) kommer
-- i separata commits när denna schema är LIVE.
--
-- BACKWARD COMPAT (§1.4):
--   Befintliga bookings får escrow_state = 'released_legacy'.
--   Gamla destination-charges-flödet fortsätter fungera tills §8.2-
--   aktivering. Endast NYA bookings (efter §8.2-deploy) går genom
--   escrow-state-machine.
--
-- REGLER: #26 grep prod-schema (ingen av de 5 tabellerna/kolumnerna
-- fanns), #27 scope (bara schema, 0 logic), #28 SSOT = state-machine
-- definierad här, #29 arkitektur-doc §1-§3 läst i sin helhet,
-- #30 EU PWD-compliance kräver structured audit-trail → escrow_events,
-- #31 prod-schema pg_dump bekräftade avsaknad.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. bookings.escrow_state (§8.3 state-machine-kolumn)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS escrow_state text NOT NULL DEFAULT 'released_legacy';

-- Giltiga states per architecture-doc §1.1 + 'released_legacy' för pre-Fas-8.
-- Varje ny state måste läggas till här + i escrow-state-transition EF.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_escrow_state_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_escrow_state_check
      CHECK (escrow_state IN (
        'pending_payment',
        'paid_held',
        'awaiting_attest',
        'released',
        'disputed',
        'resolved_full_refund',
        'resolved_partial_refund',
        'resolved_dismissed',
        'refunded',
        'cancelled',
        'released_legacy'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_escrow_state
  ON public.bookings(escrow_state)
  WHERE escrow_state NOT IN ('released_legacy', 'released', 'refunded', 'cancelled');
-- Partial index: bara aktiva escrow-states är intressanta för cron-polling.

COMMENT ON COLUMN public.bookings.escrow_state IS
  'Fas 8 state-machine. Terminal-states: released, refunded, cancelled, released_legacy.';

-- ─────────────────────────────────────────────────────────────
-- 2. escrow_events — strikt state-transition-audit (§8.4.1)
-- ─────────────────────────────────────────────────────────────
-- Kompletterar booking_events (Fas 6). booking_events loggar
-- business-events (booking_created, cleaner_assigned). escrow_events
-- loggar bara state-transitioner — mer snäv, mer strukturerad.
-- Timeline-UI (§6.4) unionerar båda.

CREATE TABLE IF NOT EXISTS public.escrow_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL,
  from_state      text,                           -- NULL vid initial state
  to_state        text NOT NULL,
  triggered_by    text NOT NULL,                  -- customer | cleaner | admin | system_timer | system_webhook
  triggered_by_id uuid,                           -- auth_user_id eller NULL för system
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT escrow_events_triggered_by_check
    CHECK (triggered_by IN ('customer', 'cleaner', 'admin', 'system_timer', 'system_webhook'))
);

CREATE INDEX IF NOT EXISTS idx_escrow_events_booking
  ON public.escrow_events(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_escrow_events_created_at
  ON public.escrow_events(created_at DESC);

COMMENT ON TABLE public.escrow_events IS
  'Fas 8 §8.4: Audit-trail för bookings.escrow_state-transitioner. EU PWD-krav.';

-- ─────────────────────────────────────────────────────────────
-- 3. disputes — formell dispute-process (§8.4.2)
-- ─────────────────────────────────────────────────────────────
-- 1 dispute per booking (UNIQUE constraint på booking_id).
-- Skapas när customer öppnar dispute-flow via min-bokning.html.

CREATE TABLE IF NOT EXISTS public.disputes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid NOT NULL UNIQUE,
  opened_by             uuid,                      -- customer auth_user_id
  reason                text NOT NULL,
  customer_description  text,
  cleaner_response      text,
  admin_notes           text,
  admin_decision        text,                      -- NULL tills admin beslutat
  refund_amount_sek     integer,                   -- set vid partial_refund/full_refund
  opened_at             timestamptz NOT NULL DEFAULT now(),
  cleaner_responded_at  timestamptz,
  admin_decided_at      timestamptz,
  resolved_at           timestamptz,
  CONSTRAINT disputes_admin_decision_check
    CHECK (admin_decision IS NULL OR admin_decision IN ('full_refund', 'partial_refund', 'dismissed')),
  CONSTRAINT disputes_refund_amount_check
    CHECK (refund_amount_sek IS NULL OR refund_amount_sek >= 0)
);

CREATE INDEX IF NOT EXISTS idx_disputes_booking ON public.disputes(booking_id);
CREATE INDEX IF NOT EXISTS idx_disputes_opened_at ON public.disputes(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_open
  ON public.disputes(opened_at DESC)
  WHERE resolved_at IS NULL;
-- Partial index: admin-kön = disputes utan resolved_at.

COMMENT ON TABLE public.disputes IS
  'Fas 8 §8.4.2: Formell dispute-record per bokning. EU PWD audit-trail.';

-- ─────────────────────────────────────────────────────────────
-- 4. dispute_evidence — uppladdade filer (§8.4.3)
-- ─────────────────────────────────────────────────────────────
-- Pekare till Supabase storage-bucket 'dispute-evidence'.
-- Bucket + RLS-policies skapas i separat steg (§8.5) via admin-UI
-- pga Supabase storage-buckets inte kan skapas via migration.

CREATE TABLE IF NOT EXISTS public.dispute_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id      uuid NOT NULL,
  uploaded_by     text NOT NULL,
  storage_path    text NOT NULL,
  file_size_bytes integer,
  mime_type       text,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispute_evidence_uploaded_by_check
    CHECK (uploaded_by IN ('customer', 'cleaner')),
  CONSTRAINT dispute_evidence_mime_check
    CHECK (mime_type IS NULL OR mime_type IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')),
  CONSTRAINT dispute_evidence_size_check
    CHECK (file_size_bytes IS NULL OR file_size_bytes <= 5242880)  -- 5 MB
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute
  ON public.dispute_evidence(dispute_id);

COMMENT ON TABLE public.dispute_evidence IS
  'Fas 8 §8.4.3: Foto-bevis per dispute (kund + städare). Max 5 MB, 5 foton/part/dispute.';

-- ─────────────────────────────────────────────────────────────
-- 5. attested_jobs — kund-attestering (§8.4.4)
-- ─────────────────────────────────────────────────────────────
-- Separate tabell (inte bokning-kolumn) för audit-klarhet:
-- "bokningen attesterades när + hur + av vem".

CREATE TABLE IF NOT EXISTS public.attested_jobs (
  booking_id     uuid PRIMARY KEY,
  attested_at    timestamptz NOT NULL DEFAULT now(),
  attest_method  text NOT NULL,
  customer_note  text,
  CONSTRAINT attested_jobs_method_check
    CHECK (attest_method IN ('customer_manual', 'auto_24h_timer'))
);

CREATE INDEX IF NOT EXISTS idx_attested_jobs_attested_at
  ON public.attested_jobs(attested_at DESC);

COMMENT ON TABLE public.attested_jobs IS
  'Fas 8 §8.4.4: Attestering som triggar escrow-release. customer_manual eller auto_24h_timer.';

-- ─────────────────────────────────────────────────────────────
-- 6. RLS-skelett (permissiv för nu, skärps i §8.11)
-- ─────────────────────────────────────────────────────────────
-- Aktivera RLS men utan policies → bara service_role kan läsa/skriva.
-- Customer/cleaner/admin-specifika policies byggs i §8.11.

ALTER TABLE public.escrow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attested_jobs ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- Migration-verifiering
-- ─────────────────────────────────────────────────────────────
-- Efter körning ska dessa queries returnera resultat:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='bookings' AND column_name='escrow_state';
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('escrow_events','disputes','dispute_evidence','attested_jobs');
--
-- Backfill-verifiering (alla befintliga bookings ska ha 'released_legacy'):
--   SELECT escrow_state, COUNT(*) FROM bookings GROUP BY escrow_state;
--   Förväntat: 'released_legacy' = antal befintliga bookings (~46)
