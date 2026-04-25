-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas A: Manual-bokning schema
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Vision (Farhad 2026-04-25): admin/VD ska kunna skapa bokningar
-- manuellt på kundens vägnar. För B2B är BankID inte krävt — email
-- + Stripe Checkout-länk räcker.
--
-- DESIGN-DOC: docs/planning/manual-booking-bankid-rut-flow.md
--
-- FAS-AVGRÄNSNING (Fas A — denna migration):
-- - Bara B2B-bokningar tillåtna (RUT BLOCKAS i EF)
-- - Email-flow (ingen BankID-signering)
-- - Auth: admin OR VD med company.allow_member_manual_booking-flag
--
-- BLOCKAD AV (Fas B+C+D):
-- - BankID-integration (TIC) — Fas B
-- - PNR + RUT-aktivering — Fas C (kräver Fas 7.5 jurist-OK)
-- - Auto-RUT-submission till SKV — Fas D (kräver SKV API-spec verify)
--
-- KOLUMNER:
-- - bookings.created_by_admin (bool, default false)
--   true om bokning skapad via admin-UI (inte boka.html)
-- - bookings.created_by_user_id (uuid)
--   Pekar på auth.uid för admin/VD som skapade bokningen
-- - bookings.checkout_link_expires_at (timestamptz)
--   Stripe Checkout-länk-livslängd, satt vid manual-booking-create
-- - bookings.signing_method (text)
--   'email' (Fas A) | 'click_confirm' (Fas B) | 'bankid' (Fas C)
-- - companies.allow_member_manual_booking (bool, default false)
--   VD-flagga: tillåter member-cleaners att skapa bokningar för
--   company. Default false (säkraste — bara VD/admin).
--
-- REGLER (#26-#31):
-- - #26 grep-före-edit: prod-schema verifierat via curl 42703 för alla 5
-- - #27 scope-respekt: bara Fas A-relevanta kolumner. signing_method
--   redan inkluderad för framtida Fas B/C utan refactor
-- - #28 SSOT: ingen duplikat-kolumn, namn matchar planning-doc
-- - #30 ingen regulator-antagande: BankID/RUT-flöden är blockerade i EF-kod
-- - #31 primärkälla: schema-verifiering via curl INNAN denna migration
-- ═══════════════════════════════════════════════════════════════

-- ── 1. bookings: 4 nya kolumner ─────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS created_by_admin BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checkout_link_expires_at TIMESTAMPTZ;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS signing_method TEXT
  CHECK (signing_method IS NULL OR signing_method IN ('email', 'click_confirm', 'bankid'));

-- Index för admin-list-vy: filter på admin-skapade bokningar
CREATE INDEX IF NOT EXISTS idx_bookings_created_by_admin
  ON public.bookings (created_by_admin)
  WHERE created_by_admin = true;

-- ── 2. companies: VD-flagga för member-permission ─────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS allow_member_manual_booking BOOLEAN DEFAULT false NOT NULL;

-- ── 3. Kommentarer för dokumentation ──────────────────────────
COMMENT ON COLUMN public.bookings.created_by_admin
  IS 'Fas A: true om bokning skapad via admin-UI (manual-booking-create EF)';
COMMENT ON COLUMN public.bookings.created_by_user_id
  IS 'Fas A: auth.uid för admin/VD som skapade bokningen via admin-UI';
COMMENT ON COLUMN public.bookings.checkout_link_expires_at
  IS 'Fas A: Stripe Checkout-länk-livslängd. Default 48h vid manual-booking-create';
COMMENT ON COLUMN public.bookings.signing_method
  IS 'Signing-flow: email (Fas A) | click_confirm (Fas B) | bankid (Fas C)';
COMMENT ON COLUMN public.companies.allow_member_manual_booking
  IS 'Fas A: VD-flagga som tillåter member-cleaners att skapa manual-bokningar för companys räkning. Default false.';

-- ── VERIFIERING (kör efter migration) ─────────────────────────
-- 1. Alla 5 kolumner finns:
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_schema='public' AND (
--      (table_name='bookings' AND column_name IN
--        ('created_by_admin','created_by_user_id','checkout_link_expires_at','signing_method'))
--      OR (table_name='companies' AND column_name='allow_member_manual_booking')
--    )
--    ORDER BY table_name, column_name;
--
-- 2. CHECK-constraint på signing_method:
--    SELECT conname FROM pg_constraint
--    WHERE conrelid='public.bookings'::regclass
--    AND conname LIKE '%signing_method%';
--
-- 3. Index finns:
--    SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND indexname='idx_bookings_created_by_admin';
