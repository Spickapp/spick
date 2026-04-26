-- §8.24-25 — Klarna/Stripe chargeback audit-trail
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   stripe-webhook hanterar redan charge.dispute.created + closed events
--   (rad 910-1000+ i index.ts). Skriver dispute-status till bookings-tabellen.
--   Klarna är payment-method på Stripe, så Klarna chargebacks går via samma flow.
--
--   §8.24-25 saknade dedikerad chargeback_events-tabell för:
--   - Audit-trail per chargeback-event (created → updated → closed)
--   - Aggregat-vy för admin (frekvens, vinst-rate, trend per cleaner/method)
--
-- Verifiering (rule #31, 2026-04-26):
--   chargeback_events → 404 (ej existerande)
--   bookings.dispute_status finns (uppdateras av webhook)
--   bookings.dispute_amount_sek finns
--
-- Idempotens: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. chargeback_events — per-event audit-trail ──
CREATE TABLE IF NOT EXISTS public.chargeback_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  -- Stripe-data
  stripe_dispute_id text,
  stripe_charge_id  text,
  stripe_payment_intent_id text,
  -- Event-typ + data
  event_type      text NOT NULL,            -- 'created', 'updated', 'won', 'lost', 'warning_closed'
  payment_method  text,                     -- 'card', 'klarna', 'sepa_debit', etc
  amount_ore      bigint NOT NULL,
  reason          text,                     -- 'fraudulent', 'duplicate', 'product_not_received', etc
  status          text,                     -- 'warning_needs_response', 'needs_response', 'under_review', 'won', 'lost'
  evidence_due_by timestamptz,              -- Stripe deadline för svar
  -- Audit
  raw_event_jsonb jsonb,                    -- full Stripe-event för debugging
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chargeback_events_event_type_check CHECK (event_type IN
    ('created', 'updated', 'won', 'lost', 'warning_closed', 'reversed'))
);

CREATE INDEX IF NOT EXISTS idx_chargeback_events_booking
  ON public.chargeback_events(booking_id, created_at DESC) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chargeback_events_stripe_dispute
  ON public.chargeback_events(stripe_dispute_id) WHERE stripe_dispute_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chargeback_events_recent
  ON public.chargeback_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chargeback_events_active
  ON public.chargeback_events(status) WHERE status IN ('warning_needs_response', 'needs_response', 'under_review');

COMMENT ON TABLE public.chargeback_events IS
  '§8.24-25 (2026-04-26): per-event audit-trail för Stripe + Klarna chargebacks. Webhook-EF skriver hit vid varje dispute-event. Admin-vy aggregerar.';

-- ── 2. RLS — admin only ──
ALTER TABLE public.chargeback_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chargeback_events_admin_read ON public.chargeback_events;
CREATE POLICY chargeback_events_admin_read ON public.chargeback_events
  FOR SELECT TO authenticated USING (public.is_admin());

-- ── 3. Admin-vy: chargeback-aggregat per booking ──
CREATE OR REPLACE VIEW public.v_admin_chargebacks AS
SELECT
  b.id AS booking_id,
  b.customer_name,
  b.customer_email,
  b.booking_date,
  b.total_price,
  b.dispute_status,
  b.dispute_amount_sek,
  b.dispute_reason,
  b.dispute_opened_at,
  c.full_name AS cleaner_name,
  co.name AS company_name,
  -- Senaste event-info från chargeback_events
  (SELECT event_type FROM public.chargeback_events ce
    WHERE ce.booking_id = b.id ORDER BY ce.created_at DESC LIMIT 1) AS latest_event,
  (SELECT created_at FROM public.chargeback_events ce
    WHERE ce.booking_id = b.id ORDER BY ce.created_at DESC LIMIT 1) AS latest_event_at,
  (SELECT payment_method FROM public.chargeback_events ce
    WHERE ce.booking_id = b.id AND ce.event_type = 'created' LIMIT 1) AS payment_method,
  (SELECT evidence_due_by FROM public.chargeback_events ce
    WHERE ce.booking_id = b.id AND ce.event_type IN ('created', 'updated')
    ORDER BY ce.created_at DESC LIMIT 1) AS evidence_due_by,
  (SELECT COUNT(*) FROM public.chargeback_events ce WHERE ce.booking_id = b.id) AS total_events
FROM public.bookings b
LEFT JOIN public.cleaners c ON c.id = b.cleaner_id
LEFT JOIN public.companies co ON co.id = c.company_id
WHERE b.dispute_status IS NOT NULL
ORDER BY b.dispute_opened_at DESC NULLS LAST;

COMMENT ON VIEW public.v_admin_chargebacks IS
  '§8.24-25: admin-vy för dispute/chargeback-historik med senaste event från chargeback_events.';

-- ── 4. Aggregat-vy: chargeback-rate per cleaner/method ──
CREATE OR REPLACE VIEW public.v_admin_chargeback_aggregate AS
SELECT
  COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::uuid) AS cleaner_id,
  COALESCE(c.full_name, '–') AS cleaner_name,
  COALESCE(co.name, '–') AS company_name,
  COUNT(*) AS total_disputes_30d,
  COUNT(*) FILTER (WHERE b.dispute_status = 'won') AS won_count,
  COUNT(*) FILTER (WHERE b.dispute_status = 'lost') AS lost_count,
  COUNT(*) FILTER (WHERE b.dispute_status = 'pending') AS pending_count,
  ROUND(SUM(b.dispute_amount_sek)::numeric, 0) AS total_amount_sek,
  ROUND(AVG(b.dispute_amount_sek)::numeric, 0) AS avg_amount_sek
FROM public.bookings b
LEFT JOIN public.cleaners c ON c.id = b.cleaner_id
LEFT JOIN public.companies co ON co.id = c.company_id
WHERE b.dispute_status IS NOT NULL
  AND b.dispute_opened_at >= NOW() - INTERVAL '30 days'
GROUP BY c.id, c.full_name, co.name
ORDER BY total_disputes_30d DESC;

COMMENT ON VIEW public.v_admin_chargeback_aggregate IS
  '§8.24-25: chargeback-rate per cleaner senaste 30d. Mönster-detektor för cleaners med många tvister.';

GRANT SELECT ON public.v_admin_chargebacks TO authenticated;
GRANT SELECT ON public.v_admin_chargeback_aggregate TO authenticated;
