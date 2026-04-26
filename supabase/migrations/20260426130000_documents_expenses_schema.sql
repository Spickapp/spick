-- Dokumenthantering + cleaner-utlägg — schema (Sprint A)
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   1. Spick saknar central dokument-arkivering (BokfL 7-års retention)
--   2. Cleaners betalar ~200 kr/jobb i utrustning ur egen ficka — ingen
--      återbetalning, ingen spårning
--
--   Sprint A: skema + helpers, FLAG-OFF (ingen money-flow-impact).
--   Sprint C: cleaner-utlägg-flow + VD-godkännande.
--   Sprint D: settlement-integration kräver jurist-OK på moms.
--
-- Design-källa: docs/design/2026-04-26-dokumenthantering-utlagg-analys.md
--
-- Verifiering (rule #31, 2026-04-26):
--   curl documents → 404 (ej existerande)
--   curl cleaner_expenses → 404 (ej existerande)
--   cleaners-tabell finns (verifierat indirekt via _isCompanyOwner-flow)
--   bookings + companies + payout_audit_log finns
--
-- Idempotens: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. documents — universal dokument-arkiv ──
CREATE TABLE IF NOT EXISTS public.documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type   text NOT NULL,
  -- Ägar-FK (minst en måste vara satt — XOR via CHECK)
  customer_email  text,
  cleaner_id      uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  company_id      uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  booking_id      uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  -- Storage (Supabase storage-bucket 'documents')
  storage_path    text NOT NULL,
  file_size_bytes integer,
  mime_type       text,
  -- Metadata
  title           text NOT NULL,
  description     text,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  retention_until timestamptz,
  -- Generering-spår
  generated_by    text NOT NULL DEFAULT 'auto',
  source_ef       text,
  -- Status
  status          text NOT NULL DEFAULT 'active',
  -- Audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_type_check CHECK (document_type IN (
    'receipt',
    'invoice_to_company',
    'invoice_from_subleverantor',
    'contract',
    'insurance',
    'tax_xml',
    'training_cert',
    'dispute_evidence',
    'other'
  )),
  CONSTRAINT documents_owner_present CHECK (
    customer_email IS NOT NULL OR
    cleaner_id IS NOT NULL OR
    company_id IS NOT NULL OR
    booking_id IS NOT NULL
  ),
  CONSTRAINT documents_status_check CHECK (status IN ('active', 'archived', 'deleted')),
  CONSTRAINT documents_generated_by_check CHECK (generated_by IN ('auto', 'admin', 'user_upload', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_documents_customer
  ON public.documents(customer_email, issued_at DESC) WHERE customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_company
  ON public.documents(company_id, issued_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_cleaner
  ON public.documents(cleaner_id, issued_at DESC) WHERE cleaner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_booking
  ON public.documents(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_type_active
  ON public.documents(document_type, issued_at DESC) WHERE status = 'active';

COMMENT ON TABLE public.documents IS
  'Sprint A (2026-04-26): universal dokument-arkiv. retention=BokfL 7 år (jurist-bedömning krävs för exakta tidsregler).';

-- ── 2. cleaner_expenses — utläggs-spårning per cleaner ──
CREATE TABLE IF NOT EXISTS public.cleaner_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id      uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  company_id      uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  booking_id      uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  -- Belopp i öre
  amount_ore      integer NOT NULL,
  vat_amount_ore  integer NOT NULL DEFAULT 0,
  category        text NOT NULL,
  description     text NOT NULL,
  -- Receipt (foto av kvitto)
  receipt_storage_path text,
  receipt_mime_type    text,
  -- Datum
  expense_date    date NOT NULL,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  -- Approval
  status          text NOT NULL DEFAULT 'pending',
  approved_by_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  rejected_reason text,
  -- Settlement (kopplas till payout_audit_log vid Sprint D)
  paid_in_payout_id uuid,
  paid_at         timestamptz,
  -- Audit
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaner_expenses_amount_pos CHECK (amount_ore > 0),
  CONSTRAINT cleaner_expenses_vat_nonneg CHECK (vat_amount_ore >= 0),
  CONSTRAINT cleaner_expenses_category_check CHECK (category IN
    ('chemicals', 'tools', 'transport', 'parking', 'other')),
  CONSTRAINT cleaner_expenses_status_check CHECK (status IN
    ('pending', 'approved', 'rejected', 'paid'))
);

CREATE INDEX IF NOT EXISTS idx_cleaner_expenses_cleaner_date
  ON public.cleaner_expenses(cleaner_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_cleaner_expenses_company_pending
  ON public.cleaner_expenses(company_id, submitted_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cleaner_expenses_booking
  ON public.cleaner_expenses(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cleaner_expenses_unpaid
  ON public.cleaner_expenses(cleaner_id, status) WHERE status IN ('pending', 'approved');

COMMENT ON TABLE public.cleaner_expenses IS
  'Sprint A (2026-04-26): cleaner-utlägg-spårning. Sprint C tillför UI. Sprint D integrerar settlement (kräver jurist-OK på moms).';

-- ── 3. RLS-policies ──
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaner_expenses ENABLE ROW LEVEL SECURITY;

-- Documents: kund ser egna kvitton (matchar email på JWT)
DROP POLICY IF EXISTS documents_customer_read ON public.documents;
CREATE POLICY documents_customer_read ON public.documents
  FOR SELECT TO authenticated
  USING (
    customer_email IS NOT NULL
    AND customer_email = lower((auth.jwt() ->> 'email'))
  );

-- Documents: cleaner ser egna dokument (training_cert + expense-receipts)
DROP POLICY IF EXISTS documents_cleaner_read ON public.documents;
CREATE POLICY documents_cleaner_read ON public.documents
  FOR SELECT TO authenticated
  USING (
    cleaner_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.auth_user_id = auth.uid() AND c.id = documents.cleaner_id
    )
  );

-- Documents: VD ser sitt företags dokument + team-cleaners certifikat
DROP POLICY IF EXISTS documents_vd_read ON public.documents;
CREATE POLICY documents_vd_read ON public.documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.auth_user_id = auth.uid()
        AND c.is_company_owner = true
        AND (
          c.company_id = documents.company_id
          OR EXISTS (
            SELECT 1 FROM public.cleaners team
            WHERE team.company_id = c.company_id
              AND team.id = documents.cleaner_id
          )
        )
    )
  );

-- Cleaner_expenses: cleaner ser egna utlägg
DROP POLICY IF EXISTS cleaner_expenses_self_read ON public.cleaner_expenses;
CREATE POLICY cleaner_expenses_self_read ON public.cleaner_expenses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.auth_user_id = auth.uid() AND c.id = cleaner_expenses.cleaner_id
    )
  );

-- Cleaner_expenses: cleaner skapar egna utlägg
DROP POLICY IF EXISTS cleaner_expenses_self_insert ON public.cleaner_expenses;
CREATE POLICY cleaner_expenses_self_insert ON public.cleaner_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.auth_user_id = auth.uid() AND c.id = cleaner_expenses.cleaner_id
    )
  );

-- Cleaner_expenses: VD läser team-utlägg
DROP POLICY IF EXISTS cleaner_expenses_vd_read ON public.cleaner_expenses;
CREATE POLICY cleaner_expenses_vd_read ON public.cleaner_expenses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.auth_user_id = auth.uid()
        AND c.is_company_owner = true
        AND c.company_id = cleaner_expenses.company_id
    )
  );

-- Cleaner_expenses: VD uppdaterar (godkänn/avslå) team-utlägg
DROP POLICY IF EXISTS cleaner_expenses_vd_update ON public.cleaner_expenses;
CREATE POLICY cleaner_expenses_vd_update ON public.cleaner_expenses
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.auth_user_id = auth.uid()
        AND c.is_company_owner = true
        AND c.company_id = cleaner_expenses.company_id
    )
  );

-- ── 4. platform_settings för utlägg-flow ──
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('expense_max_per_booking_ore', '50000', NOW())  -- 500 kr
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('expense_auto_approve_under_ore', '10000', NOW())  -- 100 kr
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('expense_categories_enabled', 'chemicals,tools,transport,parking,other', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('transport_default_ore_per_km', '250', NOW())  -- 2,50 kr/km (branschpraxis)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES ('expense_settlement_enabled', 'false', NOW())  -- Sprint D-flagga (kräver jurist)
ON CONFLICT (key) DO NOTHING;

-- ── 5. Trigger: auto-godkänn utlägg under tröskel ──
CREATE OR REPLACE FUNCTION public.auto_approve_small_expense()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold integer;
BEGIN
  SELECT (value)::integer INTO v_threshold
  FROM public.platform_settings
  WHERE key = 'expense_auto_approve_under_ore';

  IF v_threshold IS NOT NULL AND NEW.amount_ore <= v_threshold AND NEW.status = 'pending' THEN
    NEW.status := 'approved';
    NEW.approved_at := NOW();
    NEW.notes := COALESCE(NEW.notes, '') || ' [Auto-godkänt: belopp <= ' || (v_threshold / 100) || ' kr]';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_approve_small_expense ON public.cleaner_expenses;
CREATE TRIGGER trg_auto_approve_small_expense
  BEFORE INSERT ON public.cleaner_expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_approve_small_expense();
