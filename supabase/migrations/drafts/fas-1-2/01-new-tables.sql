-- Fas 1.2 Dag 2 Migration: Unified Identity Architecture - Tables
-- Förberedd 19 april 2026. KÖRS INTE IDAG. Verifieras mot staging först imorgon.
--
-- Skapar två nya tabeller:
-- 1. magic_link_shortcodes — kortade URL:er för SMS-länkar
-- 2. auth_audit_log — EU-direktiv-krav: log av all auth-aktivitet

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- TABELL 1: magic_link_shortcodes
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.magic_link_shortcodes (
  code TEXT PRIMARY KEY,
  full_redirect_url TEXT NOT NULL,
  email TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('booking', 'subscription', 'dashboard', 'team_job', 'team_onboarding', 'other')),
  resource_id UUID,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  
  ip_address TEXT,
  user_agent TEXT,
  
  single_use BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_shortcodes_expires 
  ON public.magic_link_shortcodes(expires_at) 
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shortcodes_email 
  ON public.magic_link_shortcodes(email);

CREATE INDEX IF NOT EXISTS idx_shortcodes_resource 
  ON public.magic_link_shortcodes(resource_id) 
  WHERE resource_id IS NOT NULL;

COMMENT ON TABLE public.magic_link_shortcodes IS 
  'Short-URL codes for SMS magic-links. Built for Fas 1.2 Unified Identity Architecture.';

-- Grants: service_role only (EF:er hanterar allt, inga user-facing queries)
ALTER TABLE public.magic_link_shortcodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages magic_link_shortcodes"
  ON public.magic_link_shortcodes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.magic_link_shortcodes TO service_role;
-- anon och authenticated får INTE access. EF:er hanterar allt.

-- ══════════════════════════════════════════════════════════════
-- TABELL 2: auth_audit_log
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.auth_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'magic_link_generated',
    'magic_link_used',
    'magic_link_expired',
    'magic_link_reuse_attempt',
    'auth_user_created',
    'auth_session_created',
    'auth_session_expired',
    'gdpr_export_requested',
    'gdpr_deletion_requested'
  )),
  user_email TEXT,
  user_id UUID,
  resource_type TEXT,
  resource_id UUID,
  
  ip_address TEXT,
  user_agent TEXT,
  
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  
  metadata JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_email 
  ON public.auth_audit_log(user_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_type 
  ON public.auth_audit_log(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_user 
  ON public.auth_audit_log(user_id, created_at DESC) 
  WHERE user_id IS NOT NULL;

COMMENT ON TABLE public.auth_audit_log IS 
  'Audit log of all authentication events. Required for EU Platform Directive (2 dec 2026) compliance.';

-- RLS: service_role writes, admin reads
ALTER TABLE public.auth_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role writes auth_audit_log"
  ON public.auth_audit_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Admin reads auth_audit_log"
  ON public.auth_audit_log FOR SELECT TO authenticated
  USING (is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_audit_log TO service_role;
GRANT SELECT ON public.auth_audit_log TO authenticated;
-- Auth-users kan via RLS bara läsa sina egna rader (gate via policy)

-- ══════════════════════════════════════════════════════════════
-- POST-CHECK: Verifiera att allt är på plats
-- ══════════════════════════════════════════════════════════════

-- Test 1: Båda tabellerna finns
SELECT table_name 
  FROM information_schema.tables 
 WHERE table_schema='public' 
   AND table_name IN ('magic_link_shortcodes', 'auth_audit_log')
 ORDER BY table_name;
-- Förväntat: 2 rader

-- Test 2: RLS aktivt på båda
SELECT c.relname AS tabell, c.relrowsecurity AS rls_aktiv
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('magic_link_shortcodes', 'auth_audit_log');
-- Förväntat: 2 rader, båda rls_aktiv=true

-- Test 3: Policies finns
SELECT tablename, policyname, cmd, roles::text
  FROM pg_policies
 WHERE tablename IN ('magic_link_shortcodes', 'auth_audit_log')
 ORDER BY tablename, policyname;
-- Förväntat: 3 policies (1 + 2)

-- Test 4: Anon har INGA grants
SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_name IN ('magic_link_shortcodes', 'auth_audit_log')
   AND grantee = 'anon';
-- Förväntat: 0 rader

COMMIT;
