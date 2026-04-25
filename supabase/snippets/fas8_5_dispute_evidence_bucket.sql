-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 8 §8.5: dispute-evidence storage-bucket
-- ═══════════════════════════════════════════════════════════════
--
-- Skapar privat bucket för dispute-bilder/dokument. Per
-- docs/architecture/dispute-escrow-system.md §4.
--
-- Detta är INTE en migration — Supabase storage-buckets skapas via
-- INSERT INTO storage.buckets (samma pattern som rut-batches gjorde
-- 2026-04-24, ej via migration-fil). Kör i Supabase Studio SQL-editor.
--
-- SCOPE för §8.5 (minimal):
--   1. Skapa bucket (private, file-size 5 MB, MIME-whitelist)
--   2. Default Supabase RLS = service_role only
--   Per-user policies (kund/städare/admin) skärps i §8.11.
--
-- VERIFIERING (efter körning):
--   SELECT id, name, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'dispute-evidence';
--
-- ROLLBACK:
--   DELETE FROM storage.buckets WHERE id = 'dispute-evidence';
--   (kräver att bucket är tom — först ta bort alla objects)
--
-- REGLER: #26 grep-verifierat (ingen befintlig bucket via curl
-- /storage/v1/bucket/dispute-evidence → 404), #27 scope (bara bucket-
-- skapande, RLS-skärpning i §8.11), #28 SSOT = arkitektur-doc §4,
-- #29 design-doc §4 läst i sin helhet, #30 Supabase storage-API
-- standard-pattern, ingen gissning, #31 prod-state primärkälla
-- verifierad (bucket saknas, escrow-tabeller live).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. Skapa bucket
-- ─────────────────────────────────────────────────────────────
-- public=false: ingen anon-access via public URL
-- file_size_limit: 5 MB (5 * 1024 * 1024 = 5242880 bytes)
-- allowed_mime_types: foto-evidens + PDF (kvitton, korrespondens)

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'dispute-evidence',
  'dispute-evidence',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/heic','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. RLS-skelett (default service_role-only)
-- ─────────────────────────────────────────────────────────────
-- storage.objects har RLS aktivt by default på Supabase.
-- Utan policies → bara service_role kan läsa/skriva.
-- Edge Functions med SERVICE_ROLE_KEY kommer åt direkt.
--
-- §8.11 lägger till:
--   - INSERT-policy: customer/cleaner uppladdar till egen prefix-path
--   - SELECT-policy: båda parter + admin läser sin dispute
--   - DELETE-policy: bara admin

-- (Inga policies skapas i §8.5 — service_role-default är säker default.)

-- ─────────────────────────────────────────────────────────────
-- 3. Verifiering
-- ─────────────────────────────────────────────────────────────

SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at
FROM storage.buckets
WHERE id = 'dispute-evidence';

-- Förväntat resultat: 1 rad med public=false, size_limit=5242880,
-- mime_types=['image/jpeg','image/png','image/heic','application/pdf']
