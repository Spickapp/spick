-- =============================================================
-- SPICK ADMIN PORTAL – Full migration
-- Tables: admin_roles, admin_permissions, role_permissions,
--         admin_users, admin_audit_log, support_tickets,
--         ticket_notes, admin_settings, temp_role_elevations
-- =============================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. ADMIN ROLES
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 100),
  description TEXT,
  is_system_role BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO admin_roles (name, level, description, is_system_role) VALUES
  ('superadmin', 100, 'Full tillgång utan begränsningar', true),
  ('admin', 90, 'Full tillgång utom säkerhetspolicys', true),
  ('operations', 70, 'Bokningar, städare, områden', true),
  ('finance', 70, 'Ekonomi, transaktioner, priser', true),
  ('support', 60, 'Supportärenden, kundkontakt', true),
  ('qa_manager', 60, 'Kvalitet, betyg, klagomål', true),
  ('cleaner_manager', 50, 'Städarhantering', true),
  ('customer_manager', 50, 'Kundhantering', true),
  ('analyst', 30, 'Läsbehörighet, aggregerade rapporter', true)
ON CONFLICT (name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 2. ADMIN PERMISSIONS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS admin_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  scope TEXT DEFAULT 'all',
  description TEXT,
  UNIQUE(resource, action, scope)
);

-- Insert base permissions
INSERT INTO admin_permissions (resource, action, description) VALUES
  -- Bookings
  ('bookings', 'read', 'Se alla bokningar'),
  ('bookings', 'write', 'Skapa/redigera bokningar'),
  ('bookings', 'delete', 'Avboka/ta bort bokningar'),
  ('bookings', 'assign', 'Tilldela/omtilldela städare'),
  ('bookings', 'export', 'Exportera bokningsdata'),
  -- Cleaners
  ('cleaners', 'read', 'Se alla städare'),
  ('cleaners', 'write', 'Redigera städarprofiler'),
  ('cleaners', 'approve', 'Godkänna nya städare'),
  ('cleaners', 'suspend', 'Pausa/blockera städare'),
  ('cleaners', 'export', 'Exportera städardata'),
  -- Customers
  ('customers', 'read', 'Se alla kunder'),
  ('customers', 'write', 'Redigera kundprofiler'),
  ('customers', 'flag', 'Flagga/blockera kunder'),
  ('customers', 'export', 'Exportera kunddata'),
  -- Finance
  ('finance', 'read', 'Se transaktioner och ersättningar'),
  ('finance', 'refund', 'Hantera återbetalningar'),
  ('finance', 'adjust', 'Manuella justeringar'),
  ('finance', 'lock_period', 'Låsa ekonomiska perioder'),
  ('finance', 'export', 'Exportera ekonomidata'),
  ('finance', 'pricing', 'Ändra prisregler och provisioner'),
  -- Support
  ('support', 'read', 'Se supportärenden'),
  ('support', 'write', 'Hantera supportärenden'),
  ('support', 'resolve', 'Stänga/lösa ärenden'),
  ('support', 'escalate', 'Eskalera ärenden'),
  -- Quality
  ('quality', 'read', 'Se kvalitetsdata'),
  ('quality', 'write', 'Hantera kvalitetsärenden'),
  ('quality', 'flag', 'Flagga städare för kvalitet'),
  -- Settings
  ('settings', 'read', 'Se plattformsinställningar'),
  ('settings', 'write', 'Ändra plattformsinställningar'),
  ('settings', 'security', 'Ändra säkerhetsinställningar'),
  -- Roles
  ('roles', 'read', 'Se roller och behörigheter'),
  ('roles', 'write', 'Ändra roller'),
  ('roles', 'assign', 'Tilldela roller till användare'),
  -- Audit
  ('audit', 'read', 'Se ändringsloggar'),
  -- System
  ('system', 'status', 'Se systemstatus'),
  ('system', 'manage', 'Hantera systemkonfiguration')
ON CONFLICT (resource, action, scope) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 3. ROLE → PERMISSION MAPPING
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES admin_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Superadmin gets ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.name = 'superadmin'
ON CONFLICT DO NOTHING;

-- Admin gets all except security settings and role management at superadmin level
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.name = 'admin'
  AND NOT (p.resource = 'settings' AND p.action = 'security')
  AND NOT (p.resource = 'finance' AND p.action = 'lock_period')
ON CONFLICT DO NOTHING;

-- Operations: bookings + cleaners
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.name = 'operations'
  AND (p.resource IN ('bookings', 'cleaners', 'system') 
       OR (p.resource = 'customers' AND p.action = 'read')
       OR (p.resource = 'audit' AND p.action = 'read'))
ON CONFLICT DO NOTHING;

-- Finance: finance + read bookings/customers
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.name = 'finance'
  AND (p.resource = 'finance'
       OR (p.resource IN ('bookings', 'customers', 'cleaners') AND p.action = 'read')
       OR (p.resource = 'audit' AND p.action = 'read'))
ON CONFLICT DO NOTHING;

-- Support: support + read bookings/customers/cleaners
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.name = 'support'
  AND (p.resource = 'support'
       OR (p.resource IN ('bookings', 'customers', 'cleaners', 'quality') AND p.action = 'read')
       OR (p.resource = 'finance' AND p.action IN ('read', 'refund'))
       OR (p.resource = 'audit' AND p.action = 'read'))
ON CONFLICT DO NOTHING;

-- QA Manager: quality + read cleaners/bookings
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.name = 'qa_manager'
  AND (p.resource = 'quality'
       OR (p.resource IN ('cleaners', 'bookings', 'customers') AND p.action = 'read')
       OR (p.resource = 'cleaners' AND p.action IN ('suspend'))
       OR (p.resource = 'audit' AND p.action = 'read'))
ON CONFLICT DO NOTHING;

-- Analyst: read everything, export aggregates
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.name = 'analyst'
  AND p.action = 'read'
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 4. ADMIN USERS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid UUID UNIQUE,  -- links to auth.users(id)
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role_id UUID REFERENCES admin_roles(id) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  login_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES admin_users(id),
  notes TEXT
);

-- Seed initial superadmin
INSERT INTO admin_users (email, display_name, role_id)
SELECT 'hello@spick.se', 'Farhad (Superadmin)', r.id
FROM admin_roles r WHERE r.name = 'superadmin'
ON CONFLICT (email) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 5. SUPERADMIN PROTECTION TRIGGER
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION protect_last_superadmin()
RETURNS TRIGGER AS $$
DECLARE
  sa_role_id UUID;
  remaining INTEGER;
BEGIN
  SELECT id INTO sa_role_id FROM admin_roles WHERE name = 'superadmin';
  
  -- Only act if the OLD row IS a superadmin
  IF OLD.role_id = sa_role_id THEN
    IF TG_OP = 'DELETE' THEN
      SELECT COUNT(*) INTO remaining FROM admin_users
        WHERE role_id = sa_role_id AND is_active = true AND id != OLD.id;
      IF remaining < 1 THEN
        RAISE EXCEPTION 'Kan inte ta bort sista aktiva superadmin';
      END IF;
    END IF;
    
    IF TG_OP = 'UPDATE' THEN
      IF (NEW.role_id != sa_role_id OR NEW.is_active = false) THEN
        SELECT COUNT(*) INTO remaining FROM admin_users
          WHERE role_id = sa_role_id AND is_active = true AND id != OLD.id;
        IF remaining < 1 THEN
          RAISE EXCEPTION 'Kan inte nedgradera eller inaktivera sista superadmin';
        END IF;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_superadmin ON admin_users;
CREATE TRIGGER trg_protect_superadmin
BEFORE UPDATE OR DELETE ON admin_users
FOR EACH ROW EXECUTE FUNCTION protect_last_superadmin();

-- ═══════════════════════════════════════════════════════════════
-- 6. AUDIT LOG (append-only)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  admin_role TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_resource ON admin_audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_log(admin_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at DESC);

-- RLS: append-only (no update/delete possible)
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_insert ON admin_audit_log;
CREATE POLICY audit_insert ON admin_audit_log FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS audit_select ON admin_audit_log;
CREATE POLICY audit_select ON admin_audit_log FOR SELECT TO authenticated USING (true);
-- No UPDATE or DELETE policy = impossible to modify logs

-- ═══════════════════════════════════════════════════════════════
-- 7. SUPPORT TICKETS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  sla_deadline TIMESTAMPTZ,
  customer_email TEXT,
  cleaner_id UUID,
  booking_id UUID,
  assigned_to TEXT,
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  resolution TEXT,
  resolution_type TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status, priority);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON support_tickets(customer_email);
CREATE INDEX IF NOT EXISTS idx_tickets_booking ON support_tickets(booking_id);

-- Auto-generate ticket number
CREATE OR REPLACE FUNCTION gen_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := 'SPK-' || to_char(now(), 'YYYY') || '-' || 
      LPAD(COALESCE(
        (SELECT COUNT(*)+1 FROM support_tickets WHERE created_at >= date_trunc('year', now())),
        1
      )::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_number ON support_tickets;
CREATE TRIGGER trg_ticket_number
BEFORE INSERT ON support_tickets
FOR EACH ROW EXECUTE FUNCTION gen_ticket_number();

-- ═══════════════════════════════════════════════════════════════
-- 8. TICKET NOTES (internal comments)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ticket_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE,
  admin_email TEXT NOT NULL,
  note TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 9. ADMIN SETTINGS (key-value platform config)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  category TEXT NOT NULL,
  label TEXT,
  description TEXT,
  requires_role_level INTEGER DEFAULT 90,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO admin_settings (key, value, category, label, description, requires_role_level) VALUES
  ('booking.min_lead_hours', '4', 'booking', 'Min framförhållning (h)', 'Minsta antal timmar innan bokning', 70),
  ('booking.max_advance_days', '60', 'booking', 'Max dagar framåt', 'Hur långt fram man kan boka', 70),
  ('booking.cancel_free_hours', '24', 'booking', 'Gratis avbokning (h)', 'Timmar före bokning som kund kan avboka gratis', 90),
  ('booking.cancel_fee_pct', '50', 'booking', 'Avbokningsavgift (%)', 'Avgift vid sen avbokning', 90),
  ('commission.base_pct', '17', 'finance', 'Basprovision (%)', 'Grundprovision för nya städare', 90),
  ('commission.silver_pct', '15', 'finance', 'Silver-provision (%)', 'Provision för Silver-städare', 90),
  ('commission.gold_pct', '13', 'finance', 'Gold-provision (%)', 'Provision för Gold-städare', 90),
  ('commission.platinum_pct', '12', 'finance', 'Platinum-provision (%)', 'Provision för Platinum-städare', 90),
  ('quality.flag_yellow_complaints', '3', 'quality', 'Gul flagga (klagomål/30d)', 'Antal klagomål för gul flagga', 60),
  ('quality.flag_red_complaints', '5', 'quality', 'Röd flagga (klagomål/30d)', 'Antal klagomål för röd flagga + paus', 60),
  ('quality.min_rating', '3.0', 'quality', 'Lägsta betyg', 'Betyg under detta triggar flagga', 60),
  ('matching.max_distance_km', '15', 'matching', 'Max avstånd (km)', 'Max avstånd mellan kund och städare', 70),
  ('support.sla_critical_min', '30', 'support', 'SLA Kritisk (min)', 'Max svarstid kritiska ärenden', 60),
  ('support.sla_high_hours', '2', 'support', 'SLA Hög (h)', 'Max svarstid hög prioritet', 60),
  ('support.sla_medium_hours', '8', 'support', 'SLA Medium (h)', 'Max svarstid medium prioritet', 60),
  ('rut.enabled', 'true', 'finance', 'RUT-avdrag aktivt', 'Aktivera/inaktivera RUT-avdrag', 90),
  ('rut.percentage', '50', 'finance', 'RUT-avdrag (%)', 'Procentsats för RUT', 90),
  ('rut.max_per_year', '75000', 'finance', 'RUT max/år (kr)', 'Maxbelopp per person per år', 90)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 10. TEMP ROLE ELEVATIONS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS temp_role_elevations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  elevated_role TEXT NOT NULL,
  reason TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at <= granted_at + INTERVAL '72 hours')
);

-- ═══════════════════════════════════════════════════════════════
-- 11. ADD admin-relevant columns to existing tables
-- ═══════════════════════════════════════════════════════════════

-- Cleaners: admin flags
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS admin_flag TEXT DEFAULT NULL;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS admin_flag_reason TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS admin_flag_at TIMESTAMPTZ;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS complaint_count_30d INTEGER DEFAULT 0;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS noshow_count_30d INTEGER DEFAULT 0;

-- Customer profiles: admin flags
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS admin_flag TEXT DEFAULT NULL;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS vip BOOLEAN DEFAULT false;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS cancel_count_30d INTEGER DEFAULT 0;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0;

-- Bookings: admin tracking
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_by TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reassigned_from UUID;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_priority BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS support_ticket_id UUID;

-- ═══════════════════════════════════════════════════════════════
-- 12. RLS for new tables
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_roles_read ON admin_roles FOR SELECT TO authenticated USING (true);

ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_perms_read ON admin_permissions FOR SELECT TO authenticated USING (true);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_perms_read ON role_permissions FOR SELECT TO authenticated USING (true);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_users_all ON admin_users FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tickets_all ON support_tickets FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE ticket_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_all ON ticket_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_all ON admin_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE temp_role_elevations ENABLE ROW LEVEL SECURITY;
CREATE POLICY elevations_all ON temp_role_elevations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- DONE. Deploy with: Run in Supabase SQL Editor
-- Then push admin.html v2
-- ═══════════════════════════════════════════════════════════════
