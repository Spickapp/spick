-- ═══════════════════════════════════════════════════════════
-- Spick: Komplett bokningsarkitektur — 5 framtidssäkra tabeller
-- Skapar BARA tabeller + RLS. Ändrar INGET befintligt.
-- ═══════════════════════════════════════════════════════════

-- 1. BOOKING_STAFF — extra personal per bokning
-- Använd: VD tilldelar teammedlemmar till ett jobb
CREATE TABLE IF NOT EXISTS booking_staff (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'assistant' CHECK (role IN ('primary', 'assistant')),
  hours_worked numeric(5,2),
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'confirmed', 'completed', 'cancelled')),
  assigned_by uuid REFERENCES cleaners(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(booking_id, cleaner_id)
);

ALTER TABLE booking_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_booking_staff" ON booking_staff FOR SELECT USING (true);
CREATE POLICY "authenticated_manage_own" ON booking_staff FOR ALL USING (
  cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid())
  OR booking_id IN (SELECT id FROM bookings WHERE cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()))
);
CREATE POLICY "company_owner_manage_team_staff" ON booking_staff FOR ALL USING (
  cleaner_id IN (
    SELECT c.id FROM cleaners c WHERE c.company_id IN (
      SELECT c2.company_id FROM cleaners c2 WHERE c2.auth_user_id = auth.uid() AND c2.is_company_owner = true
    )
  )
);
CREATE POLICY "admin_manage_staff" ON booking_staff FOR ALL USING (is_admin());

-- 2. BOOKING_ADJUSTMENTS — prisändringar efter bokning
CREATE TABLE IF NOT EXISTS booking_adjustments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  requested_by text NOT NULL CHECK (requested_by IN ('cleaner', 'customer', 'admin')),
  reason text,
  original_amount integer NOT NULL,
  new_amount integer NOT NULL,
  difference integer NOT NULL,
  rut_eligible boolean DEFAULT false,
  rut_amount integer DEFAULT 0,
  stripe_payment_intent_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'refunded')),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE booking_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_adjustments" ON booking_adjustments FOR SELECT USING (true);
CREATE POLICY "admin_manage_adjustments" ON booking_adjustments FOR ALL USING (is_admin());

-- 3. BOOKING_MESSAGES — kommunikation kund ↔ städare
CREATE TABLE IF NOT EXISTS booking_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('customer', 'cleaner', 'system')),
  sender_name text,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE booking_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_messages" ON booking_messages FOR SELECT USING (true);
CREATE POLICY "authenticated_insert_messages" ON booking_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_manage_messages" ON booking_messages FOR ALL USING (is_admin());

-- 4. BOOKING_PHOTOS — foton före/efter städning
CREATE TABLE IF NOT EXISTS booking_photos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  cleaner_id uuid REFERENCES cleaners(id),
  photo_url text NOT NULL,
  photo_type text NOT NULL DEFAULT 'before' CHECK (photo_type IN ('before', 'after', 'issue')),
  caption text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE booking_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_photos" ON booking_photos FOR SELECT USING (true);
CREATE POLICY "authenticated_insert_photos" ON booking_photos FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_manage_photos" ON booking_photos FOR ALL USING (is_admin());

-- 5. BOOKING_MODIFICATIONS — datum/tid-ändringar
CREATE TABLE IF NOT EXISTS booking_modifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  requested_by text NOT NULL CHECK (requested_by IN ('customer', 'cleaner', 'admin')),
  old_date date,
  new_date date,
  old_time time,
  new_time time,
  old_hours numeric(4,1),
  new_hours numeric(4,1),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE booking_modifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_modifications" ON booking_modifications FOR SELECT USING (true);
CREATE POLICY "admin_manage_modifications" ON booking_modifications FOR ALL USING (is_admin());

-- ═══ VERIFIERA ═══
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('booking_staff', 'booking_adjustments', 'booking_messages', 'booking_photos', 'booking_modifications')
ORDER BY table_name;
-- Ska returnera 5 rader
