-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 8: Lägg till escrow_state i v_customer_bookings
-- ═══════════════════════════════════════════════════════════════
--
-- Kund-facing UI (min-bokning.html) behöver läsa escrow_state för
-- att villkorligt visa dispute-button (bara om escrow_state =
-- 'awaiting_attest'). Vyn uppdateras additivt — lägger till EN
-- kolumn, befintliga konsumenter påverkas ej.
--
-- REGLER: #26 grep-before-change verifierade befintlig vy,
-- #27 scope (bara 1 kolumn tillagd), #28 SSOT = bookings-tabellen,
-- #31 prod-schema v_customer_bookings-struktur verifierad.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_customer_bookings AS
SELECT
  id,
  booking_id,
  customer_name,
  customer_email,
  customer_phone,
  service_type,
  booking_date,
  booking_time,
  booking_hours,
  total_price,
  status,
  payment_status,
  customer_address,
  square_meters,
  cleaner_id,
  cleaner_name,
  key_type,
  key_info,
  frequency,
  rut_amount,
  notes,
  created_at,
  updated_at,
  customer_type,
  business_name,
  business_org_number,
  business_reference,
  admin_notes,
  reassignment_proposed_cleaner_id,
  reassignment_proposed_at,
  reassignment_proposed_by,
  reassignment_attempts,
  auto_delegation_enabled,
  rejected_at,
  rejection_reason,
  reminders_sent,
  -- Fas 8: escrow_state för dispute-UI på min-bokning.html
  escrow_state
FROM public.bookings;

-- Grants bör vara oförändrade (existing GRANT SELECT ... TO anon
-- gäller fortfarande efter CREATE OR REPLACE).
-- Verifiera med:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'v_customer_bookings';
