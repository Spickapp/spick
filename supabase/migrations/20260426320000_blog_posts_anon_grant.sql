-- ═══════════════════════════════════════════════════════════════
-- SPICK – Sprint 6 hotfix: GRANT SELECT på blog_posts till anon
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Migration 20260426310000 skapade blog_posts + RLS-policy
-- "anon read published blog posts", men glömde GRANT SELECT på
-- table-level. PostgREST kräver BÅDE RLS-policy OCH table GRANT
-- för att anon ska kunna läsa. Curl mot prod 2026-04-26 returnerade
-- 42501 permission denied → denna hotfix fixar det.
--
-- REGLER:
-- - #28 SSOT: GRANT-mönster matchar övriga publika tabeller
--   (services, platform_settings publika nycklar etc)
-- - #31 schema curl-verifierat: blog_posts existerar (skapad av
--   20260426310000), bara GRANT saknas
-- ═══════════════════════════════════════════════════════════════

GRANT SELECT ON public.blog_posts TO anon, authenticated;

-- Bekräftelse
DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 20260426320000 COMPLETE — blog_posts GRANT SELECT TO anon, authenticated';
END $$;
