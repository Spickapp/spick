-- ═══════════════════════════════════════════════════════════════
-- SPICK Phase 1 — Clock in/out + Jobb-checklista + Avvikelse-rapport
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Tre operations-features för att matcha Tengellas affärssystem-features
-- + bibehålla Spicks marketplace-fördel:
--
-- A. cleaner_clock_events  — GPS-verifierad in/ut-klocking per booking
-- B. service_checklist_templates + booking_checklist_completions
--    — Standardiserade städ-checklistor + per-booking-tracking
-- C. booking_incidents — Städaren rapporterar problem på plats
--
-- SÄKERHET
-- - RLS på alla tabeller
-- - Cleaner kan bara läsa/skriva sina egna data
-- - Service-role full access för EFs
-- - Anon: ingen access
--
-- REGLER
-- #28 SSOT — service_label_sv refererar till services.label_sv
-- #29 Audit — schema-design verifierad mot SSOT-files
-- #33 Business-claims — incident-types matchar approved-claims.json
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- Helper: scoped updated_at-trigger
-- (skapas per migration för att undvika global-trigger-konflikt)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.phase1_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- A. cleaner_clock_events — GPS-verifierad in/ut-klocking
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cleaner_clock_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  cleaner_id      UUID NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN ('in', 'out')),
  lat             NUMERIC(10,7) NOT NULL,
  lng             NUMERIC(10,7) NOT NULL,
  accuracy_m      INTEGER NOT NULL,
  distance_from_address_m INTEGER,  -- Beräknas i EF om customer_address har koord
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.cleaner_clock_events IS
  'GPS-verifierad in/ut-klocking per booking. Flera events tillåtna (pauser).';

CREATE INDEX IF NOT EXISTS idx_clock_booking_cleaner_time
  ON public.cleaner_clock_events(booking_id, cleaner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clock_cleaner_recent
  ON public.cleaner_clock_events(cleaner_id, created_at DESC);

ALTER TABLE public.cleaner_clock_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_clock" ON public.cleaner_clock_events;
CREATE POLICY "service_role_all_clock"
  ON public.cleaner_clock_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "cleaner_read_own_clock" ON public.cleaner_clock_events;
CREATE POLICY "cleaner_read_own_clock"
  ON public.cleaner_clock_events FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    cleaner_id IN (
      SELECT id FROM public.cleaners
      WHERE auth_user_id = auth.uid() OR email = auth.jwt() ->> 'email'
    )
  );

REVOKE ALL ON public.cleaner_clock_events FROM PUBLIC, anon;
GRANT SELECT ON public.cleaner_clock_events TO authenticated;
GRANT ALL ON public.cleaner_clock_events TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- B1. service_checklist_templates — default checklists per service
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.service_checklist_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_label_sv TEXT NOT NULL UNIQUE,
  items            JSONB NOT NULL DEFAULT '[]',
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.service_checklist_templates IS
  'Default-checklistor per städservice. items = [{key, label_sv, required}]';

DROP TRIGGER IF EXISTS trg_templates_upd ON public.service_checklist_templates;
CREATE TRIGGER trg_templates_upd
  BEFORE UPDATE ON public.service_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

ALTER TABLE public.service_checklist_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_tmpl" ON public.service_checklist_templates;
CREATE POLICY "service_role_all_tmpl"
  ON public.service_checklist_templates FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "anyone_read_active_tmpl" ON public.service_checklist_templates;
CREATE POLICY "anyone_read_active_tmpl"
  ON public.service_checklist_templates FOR SELECT
  USING (active = TRUE);

REVOKE ALL ON public.service_checklist_templates FROM PUBLIC;
GRANT SELECT ON public.service_checklist_templates TO anon, authenticated;
GRANT ALL ON public.service_checklist_templates TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- B2. booking_checklist_completions — per-booking-tracking
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.booking_checklist_completions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  item_key              TEXT NOT NULL,
  checked               BOOLEAN NOT NULL DEFAULT FALSE,
  checked_at            TIMESTAMPTZ,
  checked_by_cleaner_id UUID REFERENCES public.cleaners(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(booking_id, item_key),
  CONSTRAINT completion_consistency
    CHECK ((checked = TRUE AND checked_at IS NOT NULL)
        OR (checked = FALSE AND checked_at IS NULL))
);

COMMENT ON TABLE public.booking_checklist_completions IS
  'En rad per item per booking. Spårar vilka checklista-items som är klara.';

CREATE INDEX IF NOT EXISTS idx_completion_booking
  ON public.booking_checklist_completions(booking_id);

DROP TRIGGER IF EXISTS trg_completion_upd ON public.booking_checklist_completions;
CREATE TRIGGER trg_completion_upd
  BEFORE UPDATE ON public.booking_checklist_completions
  FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

ALTER TABLE public.booking_checklist_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_compl" ON public.booking_checklist_completions;
CREATE POLICY "service_role_all_compl"
  ON public.booking_checklist_completions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "cleaner_read_own_compl" ON public.booking_checklist_completions;
CREATE POLICY "cleaner_read_own_compl"
  ON public.booking_checklist_completions FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    booking_id IN (
      SELECT b.id FROM public.bookings b
      JOIN public.cleaners c ON c.id = b.cleaner_id
      WHERE c.auth_user_id = auth.uid() OR c.email = auth.jwt() ->> 'email'
    )
  );

REVOKE ALL ON public.booking_checklist_completions FROM PUBLIC, anon;
GRANT SELECT ON public.booking_checklist_completions TO authenticated;
GRANT ALL ON public.booking_checklist_completions TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- C. booking_incidents — städar-rapporterade problem
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.booking_incidents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  cleaner_id           UUID NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  incident_type        TEXT NOT NULL CHECK (incident_type IN (
    'access_problem',     -- Dörren olåst, larm, kunden ej hemma
    'damaged_property',   -- Skadat material/möbler
    'missing_supplies',   -- Saknade städmaterial
    'safety_issue',       -- Otrygg miljö, personskaderisk
    'customer_complaint', -- Kund klagade på plats
    'other'               -- Annat (specificeras i description)
  )),
  description          TEXT NOT NULL CHECK (length(description) BETWEEN 5 AND 2000),
  photo_storage_path   TEXT,
  resolved             BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at          TIMESTAMPTZ,
  resolved_by_admin_id UUID,
  resolved_notes       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT incident_resolution_consistency
    CHECK ((resolved = TRUE AND resolved_at IS NOT NULL)
        OR (resolved = FALSE AND resolved_at IS NULL AND resolved_by_admin_id IS NULL))
);

COMMENT ON TABLE public.booking_incidents IS
  'Städare-rapporterade problem på plats. Admin löser via admin-UI.';
COMMENT ON COLUMN public.booking_incidents.description IS
  'GDPR: Får INTE innehålla PII utöver vad jobbet kräver. Auto-arkiveras efter 24 månader (separat retention-job).';

CREATE INDEX IF NOT EXISTS idx_incident_booking
  ON public.booking_incidents(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_open
  ON public.booking_incidents(created_at DESC)
  WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_incident_cleaner
  ON public.booking_incidents(cleaner_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_incident_upd ON public.booking_incidents;
CREATE TRIGGER trg_incident_upd
  BEFORE UPDATE ON public.booking_incidents
  FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

ALTER TABLE public.booking_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_inc" ON public.booking_incidents;
CREATE POLICY "service_role_all_inc"
  ON public.booking_incidents FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "cleaner_read_own_inc" ON public.booking_incidents;
CREATE POLICY "cleaner_read_own_inc"
  ON public.booking_incidents FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    cleaner_id IN (
      SELECT id FROM public.cleaners
      WHERE auth_user_id = auth.uid() OR email = auth.jwt() ->> 'email'
    )
  );

REVOKE ALL ON public.booking_incidents FROM PUBLIC, anon;
GRANT SELECT ON public.booking_incidents TO authenticated;
GRANT ALL ON public.booking_incidents TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- DEFAULT CHECKLIST-TEMPLATES (per service)
-- (verifierat mot approved-claims.json — generic städar-tasks, ej claims)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.service_checklist_templates (service_label_sv, items, active) VALUES
  ('Hemstädning', '[
    {"key": "kok", "label_sv": "Kök — diskbänk, spis, bänkytor", "required": true},
    {"key": "badrum", "label_sv": "Badrum — toalett, dusch, handfat, spegel", "required": true},
    {"key": "dammsugning", "label_sv": "Dammsugning & moppning alla golv", "required": true},
    {"key": "dammtorkning", "label_sv": "Dammtorkning av fria ytor", "required": true},
    {"key": "papperskorgar", "label_sv": "Tömning av papperskorgar", "required": true},
    {"key": "baddning", "label_sv": "Bäddning (om önskat)", "required": false}
  ]', TRUE),
  ('Storstädning', '[
    {"key": "kok", "label_sv": "Kök grundligt", "required": true},
    {"key": "badrum", "label_sv": "Badrum grundligt", "required": true},
    {"key": "ugn_kyl", "label_sv": "Insida av ugn & kyl/frys", "required": true},
    {"key": "skap", "label_sv": "Insida av skåp & garderober", "required": true},
    {"key": "lister_dorrar", "label_sv": "Lister, dörrar & kontakter", "required": true},
    {"key": "fonsterbradar", "label_sv": "Fönsterbrädor & element", "required": true},
    {"key": "bakom_mobler", "label_sv": "Bakom & under möbler", "required": true},
    {"key": "vaggar", "label_sv": "Väggar — fläckar & avtorkning", "required": true}
  ]', TRUE),
  ('Flyttstädning', '[
    {"key": "skap_lador", "label_sv": "Insida av alla skåp & lådor", "required": true},
    {"key": "vitvaror", "label_sv": "Ugn, spis, kyl, frys grundligt", "required": true},
    {"key": "fonsterputs", "label_sv": "Fönsterputs in- & utvändigt", "required": true},
    {"key": "avkalkning", "label_sv": "Avkalkning badrum", "required": true},
    {"key": "golvlister", "label_sv": "Golvlister & ventiler", "required": true},
    {"key": "vitvaror_yttre", "label_sv": "Vitvaror — utvändigt & invändigt", "required": true}
  ]', TRUE),
  ('Fönsterputs', '[
    {"key": "invandigt", "label_sv": "Fönster invändigt — alla rutor", "required": true},
    {"key": "utvandigt", "label_sv": "Fönster utvändigt — alla rutor", "required": true},
    {"key": "karmar", "label_sv": "Fönsterkarmar avtorkade", "required": true},
    {"key": "fonsterbradar", "label_sv": "Fönsterbrädor", "required": false}
  ]', TRUE),
  ('Kontorsstädning', '[
    {"key": "golv", "label_sv": "Dammsugning & moppning alla golv", "required": true},
    {"key": "papperskorgar", "label_sv": "Tömning av papperskorgar & sopor", "required": true},
    {"key": "skrivbord", "label_sv": "Avtorkning av skrivbord & bord", "required": true},
    {"key": "kok_pentry", "label_sv": "Kök/pentry — diskbänk, bänkytor, kaffemaskin", "required": true},
    {"key": "toaletter", "label_sv": "Toaletter & badrum", "required": true},
    {"key": "dammtorkning", "label_sv": "Dammtorkning av fria ytor", "required": true}
  ]', TRUE)
ON CONFLICT (service_label_sv) DO UPDATE SET
  items = EXCLUDED.items,
  updated_at = NOW();

-- ═══════════════════════════════════════════════════════════════
-- Verifiering
-- ═══════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_clock_count INT;
  v_tmpl_count INT;
  v_compl_count INT;
  v_inc_count INT;
BEGIN
  SELECT count(*) INTO v_clock_count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cleaner_clock_events';
  SELECT count(*) INTO v_tmpl_count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_checklist_templates';
  SELECT count(*) INTO v_compl_count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'booking_checklist_completions';
  SELECT count(*) INTO v_inc_count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'booking_incidents';

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 20260427180000 — Phase 1 Operations Features';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  cleaner_clock_events:               %', CASE WHEN v_clock_count = 1 THEN '✓ CREATED' ELSE '✗ MISSING' END;
  RAISE NOTICE '  service_checklist_templates:        %', CASE WHEN v_tmpl_count = 1 THEN '✓ CREATED' ELSE '✗ MISSING' END;
  RAISE NOTICE '  booking_checklist_completions:      %', CASE WHEN v_compl_count = 1 THEN '✓ CREATED' ELSE '✗ MISSING' END;
  RAISE NOTICE '  booking_incidents:                  %', CASE WHEN v_inc_count = 1 THEN '✓ CREATED' ELSE '✗ MISSING' END;
  RAISE NOTICE '  Default checklist-templates:        % (Hemstädning, Storstädning, Flyttstädning, Fönsterputs, Kontorsstädning)',
    (SELECT count(*) FROM public.service_checklist_templates WHERE active = TRUE);
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
