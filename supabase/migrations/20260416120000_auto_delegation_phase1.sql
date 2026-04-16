-- ═══════════════════════════════════════════════════════
-- FAS 1: Datamodell för auto-delegation
-- ═══════════════════════════════════════════════════════
-- Sprint: Företagsintern ersättarhantering + auto-delegation
-- Datum: 16 april 2026
-- OBS: Denna fil kördes MANUELLT i Supabase SQL Editor.
-- Migrationsfilen finns här som dokumentation för git-historik.
-- Idempotent via IF NOT EXISTS — säker att köra igen.
-- ═══════════════════════════════════════════════════════

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reassignment_proposed_cleaner_id uuid REFERENCES cleaners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassignment_proposed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS reassignment_proposed_by uuid REFERENCES cleaners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassignment_attempts integer DEFAULT 0;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS auto_delegation_enabled boolean;

ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS auto_delegation_enabled boolean DEFAULT false;

COMMENT ON COLUMN bookings.reassignment_proposed_cleaner_id IS
  'VD:ns föreslagna ersättare. NULL om ingen proposal aktiv eller om kunden valt själv.';
COMMENT ON COLUMN bookings.reassignment_proposed_at IS
  'När VD föreslog ersättare. Används för SLA-timer (1h för kund att godkänna).';
COMMENT ON COLUMN bookings.reassignment_proposed_by IS
  'Vilken VD föreslog ersättaren. Revisionsspår.';
COMMENT ON COLUMN bookings.reassignment_attempts IS
  'Antal reassignment-försök för denna bokning. Eskalera till awaiting_reassignment om > 3.';
COMMENT ON COLUMN bookings.auto_delegation_enabled IS
  'Per-booking override. NULL = använd customer_profile.auto_delegation_enabled.
   TRUE = företaget får auto-tilldela ersättare. FALSE = kund måste godkänna.';
COMMENT ON COLUMN customer_profiles.auto_delegation_enabled IS
  'Kundens default för nya bokningar. Om TRUE kryssas rutan i förväg på boka.html.';

CREATE INDEX IF NOT EXISTS idx_bookings_reassignment_state
  ON bookings (status, reassignment_proposed_at)
  WHERE status IN ('awaiting_company_proposal', 'awaiting_customer_approval', 'awaiting_reassignment');

CREATE INDEX IF NOT EXISTS idx_bookings_proposed_cleaner
  ON bookings (reassignment_proposed_cleaner_id)
  WHERE reassignment_proposed_cleaner_id IS NOT NULL;

COMMENT ON COLUMN bookings.status IS
  'Bokningsstatus. Värden används av application-layer:
   PENDING/CONFIRMED-flöde: pending, pending_confirmation, confirmed, bekräftad, paid
   REASSIGNMENT-flöde: awaiting_company_proposal (NY), awaiting_customer_approval (NY),
                        auto_reassigning (NY), awaiting_reassignment (befintlig)
   SLUT-status: completed, avbokad, cancelled, timed_out, refunded';
