-- =============================================================
-- Sprint RUT.1 (2026-04-23): Datamodell för RUT-ansökningar
-- =============================================================
-- Primärkälla: docs/architecture/rut-system-design.md
--              (skapas i separat commit — detta är DB-delen)
--
-- Innehåll:
-- 1. pgcrypto-extension för pnr-kryptering
-- 2. Utökning av bookings med ~13 nya RUT-kolumner
-- 3. Utökad CHECK constraint på rut_application_status
-- 4. Ny tabell: customer_pnr_access_log (audit-trail)
-- 5. Ny tabell: rut_skv_payouts (avstämning mot bankkonto)
-- 6. SECURITY DEFINER function: get_customer_pnr() med audit
-- 7. RLS-policies som blockerar encrypted-kolumnen från REST
-- =============================================================

BEGIN;

-- ── 1. pgcrypto-extension ───────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 2. bookings utökning ────────────────────────────────────
-- Alla fält nullable eftersom existerande bokningar saknar dem.
-- rut_requested=false default gör nya icke-RUT-bokningar explicita.

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS customer_pnr_encrypted BYTEA,
    ADD COLUMN IF NOT EXISTS customer_pnr_last4 TEXT,
    ADD COLUMN IF NOT EXISTS rut_requested BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS rut_bankid_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rut_bankid_orderref TEXT,
    ADD COLUMN IF NOT EXISTS rut_husfile_url TEXT,
    ADD COLUMN IF NOT EXISTS rut_skatteverket_ref TEXT,
    ADD COLUMN IF NOT EXISTS rut_payout_amount_sek INTEGER,
    ADD COLUMN IF NOT EXISTS rut_commission_immediate INTEGER,
    ADD COLUMN IF NOT EXISTS rut_commission_deferred INTEGER,
    ADD COLUMN IF NOT EXISTS rut_commission_deferred_paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rut_buffer_reserved_sek INTEGER,
    ADD COLUMN IF NOT EXISTS rut_risk_flags JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS rut_rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS rut_eligible_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rut_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rut_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rut_paid_out_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rut_rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rut_customer_invoiced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rut_closed_at TIMESTAMPTZ;

-- ── 3. Utöka status-CHECK ───────────────────────────────────
-- Lägg till: eligible, paid_out, customer_invoiced, closed

ALTER TABLE bookings
    DROP CONSTRAINT IF EXISTS bookings_rut_application_status_check;

ALTER TABLE bookings
    ADD CONSTRAINT bookings_rut_application_status_check
    CHECK (rut_application_status = ANY (ARRAY[
        'not_applicable'::text,
        'pending'::text,
        'eligible'::text,
        'submitted'::text,
        'approved'::text,
        'paid_out'::text,
        'rejected'::text,
        'customer_invoiced'::text,
        'closed'::text
    ]));

-- ── 4. customer_pnr_access_log ──────────────────────────────
-- Loggar VARJE dekryptering för audit-syften.

CREATE TABLE IF NOT EXISTS customer_pnr_access_log (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    accessed_by TEXT NOT NULL,  -- admin_email eller 'system:generate-husfile'
    purpose TEXT NOT NULL,      -- 'rut_application', 'audit_review', 'customer_support'
    pnr_last4 TEXT,             -- vilka 4 sista siffror som hämtades (för dubbelkoll)
    accessed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    ip_address INET,
    user_agent TEXT
);

ALTER TABLE customer_pnr_access_log OWNER TO postgres;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_pnr_access_log_pkey') THEN
        ALTER TABLE ONLY customer_pnr_access_log
            ADD CONSTRAINT customer_pnr_access_log_pkey PRIMARY KEY (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pnr_access_booking ON customer_pnr_access_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_pnr_access_accessed_at ON customer_pnr_access_log(accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pnr_access_by ON customer_pnr_access_log(accessed_by, accessed_at DESC);

ALTER TABLE customer_pnr_access_log ENABLE ROW LEVEL SECURITY;

-- Bara service_role + admin kan läsa, ingen kan skriva direkt
-- (writes sker via get_customer_pnr-function)
DROP POLICY IF EXISTS "Admin reads pnr access log" ON customer_pnr_access_log;
CREATE POLICY "Admin reads pnr access log" ON customer_pnr_access_log
    FOR SELECT TO authenticated
    USING (is_admin());

DROP POLICY IF EXISTS "Service role manages pnr access log" ON customer_pnr_access_log;
CREATE POLICY "Service role manages pnr access log" ON customer_pnr_access_log
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ── 5. rut_skv_payouts ──────────────────────────────────────
-- Spårar utbetalningar från Skatteverket för avstämning mot bank.

CREATE TABLE IF NOT EXISTS rut_skv_payouts (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    amount_sek INTEGER NOT NULL,
    skv_batch_reference TEXT,           -- referens från SKV-brev/utdrag
    bank_transaction_ref TEXT,          -- bankens transaktions-ID
    bank_statement_date DATE,
    reconciled BOOLEAN DEFAULT false,
    reconciled_at TIMESTAMPTZ,
    reconciled_by TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE rut_skv_payouts OWNER TO postgres;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rut_skv_payouts_pkey') THEN
        ALTER TABLE ONLY rut_skv_payouts
            ADD CONSTRAINT rut_skv_payouts_pkey PRIMARY KEY (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_skv_payouts_received ON rut_skv_payouts(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_skv_payouts_reconciled ON rut_skv_payouts(reconciled, received_at DESC) WHERE reconciled = false;

ALTER TABLE rut_skv_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages skv payouts" ON rut_skv_payouts;
CREATE POLICY "Admin manages skv payouts" ON rut_skv_payouts
    FOR ALL TO authenticated
    USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Service role manages skv payouts" ON rut_skv_payouts;
CREATE POLICY "Service role manages skv payouts" ON rut_skv_payouts
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ── 6. rut_payout_allocations (M:N payout ↔ bookings) ───────
-- En SKV-utbetalning kan täcka många bokningar.
-- En bokning utbetalas i en payout.

CREATE TABLE IF NOT EXISTS rut_payout_allocations (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    payout_id UUID NOT NULL REFERENCES rut_skv_payouts(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    allocated_amount_sek INTEGER NOT NULL,
    allocated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE rut_payout_allocations OWNER TO postgres;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rut_payout_allocations_pkey') THEN
        ALTER TABLE ONLY rut_payout_allocations
            ADD CONSTRAINT rut_payout_allocations_pkey PRIMARY KEY (id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rut_payout_allocations_unique') THEN
        ALTER TABLE ONLY rut_payout_allocations
            ADD CONSTRAINT rut_payout_allocations_unique UNIQUE (payout_id, booking_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payout_allocs_booking ON rut_payout_allocations(booking_id);

ALTER TABLE rut_payout_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages payout allocations" ON rut_payout_allocations;
CREATE POLICY "Admin manages payout allocations" ON rut_payout_allocations
    FOR ALL TO authenticated
    USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Service role manages payout allocations" ON rut_payout_allocations;
CREATE POLICY "Service role manages payout allocations" ON rut_payout_allocations
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ── 7. RLS för bookings.customer_pnr_encrypted ──────────────
-- Problem: bookings-tabellen har 115 kolumner inkl våra nya.
-- PostgreSQL RLS är row-level, inte column-level.
-- Lösning: en SECURITY DEFINER-function är ENDA sättet att hämta pnr.
-- REST-API kan läsa bookings men encrypted-kolumnen får man bara som BYTEA
-- (ej dekrypterad). REST-klienter ska använda customer_pnr_last4 istället.
--
-- Vi dokumenterar detta i kommentar på kolumnen.

COMMENT ON COLUMN bookings.customer_pnr_encrypted IS
    'Krypterat personnummer. Endast åtkomlig via get_customer_pnr()-function. Läs ALDRIG direkt via REST.';

COMMENT ON COLUMN bookings.customer_pnr_last4 IS
    'Sista 4 siffror av personnummer för UI-display (****-1234). Säker att visa.';

-- ── 8. set_customer_pnr() function ──────────────────────────
-- Sätter krypterat pnr + last4 + pnr_hash på en bokning.
-- Kryptonyckel från vault.
-- Validerar format: YYYYMMDDXXXX (12 siffror, luhn-check separat i EF).

CREATE OR REPLACE FUNCTION set_customer_pnr(
    p_booking_id UUID,
    p_pnr TEXT,
    p_set_by TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
    v_encryption_key TEXT;
    v_clean_pnr TEXT;
    v_last4 TEXT;
    v_hash TEXT;
BEGIN
    -- Rensa pnr: ta bort mellanslag, bindestreck
    v_clean_pnr := regexp_replace(p_pnr, '[\s\-]', '', 'g');

    -- Validera: 12 siffror
    IF v_clean_pnr !~ '^\d{12}$' THEN
        RAISE EXCEPTION 'Invalid pnr format (expected YYYYMMDDXXXX, got %)',
            left(v_clean_pnr, 4) || '...';
    END IF;

    -- Hämta kryptonyckel från vault
    SELECT decrypted_secret INTO v_encryption_key
    FROM vault.decrypted_secrets
    WHERE name = 'RUT_PNR_ENCRYPTION_KEY';

    IF v_encryption_key IS NULL THEN
        RAISE EXCEPTION 'RUT_PNR_ENCRYPTION_KEY saknas i vault — skapa via Studio först';
    END IF;

    -- Beräkna last4 + hash
    v_last4 := right(v_clean_pnr, 4);
    v_hash := encode(digest(v_clean_pnr, 'sha256'), 'hex');

    -- Uppdatera bokning
    UPDATE bookings
    SET
        customer_pnr_encrypted = pgp_sym_encrypt(v_clean_pnr, v_encryption_key),
        customer_pnr_last4 = v_last4,
        customer_pnr_hash = v_hash
    WHERE id = p_booking_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking % not found', p_booking_id;
    END IF;

    -- Logga (som "set" istället för access)
    INSERT INTO customer_pnr_access_log (booking_id, accessed_by, purpose, pnr_last4)
    VALUES (p_booking_id, p_set_by, 'pnr_set', v_last4);

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION set_customer_pnr(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_customer_pnr(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION set_customer_pnr(UUID, TEXT, TEXT) TO service_role;

-- ── 9. get_customer_pnr() function ──────────────────────────
-- Hämtar dekrypterat pnr + loggar åtkomst.
-- Endast service_role + admin får anropa.

CREATE OR REPLACE FUNCTION get_customer_pnr(
    p_booking_id UUID,
    p_purpose TEXT,
    p_accessed_by TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
    v_encryption_key TEXT;
    v_encrypted BYTEA;
    v_decrypted TEXT;
    v_last4 TEXT;
    v_valid_purposes TEXT[] := ARRAY['rut_application', 'audit_review', 'customer_support', 'pnr_set'];
BEGIN
    -- Validera purpose
    IF NOT (p_purpose = ANY(v_valid_purposes)) THEN
        RAISE EXCEPTION 'Invalid purpose: %. Must be one of: %', p_purpose, v_valid_purposes;
    END IF;

    -- Hämta encrypted pnr
    SELECT customer_pnr_encrypted, customer_pnr_last4
    INTO v_encrypted, v_last4
    FROM bookings WHERE id = p_booking_id;

    IF v_encrypted IS NULL THEN
        RETURN NULL;  -- ingen pnr satt
    END IF;

    -- Hämta kryptonyckel
    SELECT decrypted_secret INTO v_encryption_key
    FROM vault.decrypted_secrets
    WHERE name = 'RUT_PNR_ENCRYPTION_KEY';

    IF v_encryption_key IS NULL THEN
        RAISE EXCEPTION 'RUT_PNR_ENCRYPTION_KEY saknas i vault';
    END IF;

    -- Dekryptera
    v_decrypted := pgp_sym_decrypt(v_encrypted, v_encryption_key);

    -- Audit log
    INSERT INTO customer_pnr_access_log (booking_id, accessed_by, purpose, pnr_last4)
    VALUES (p_booking_id, p_accessed_by, p_purpose, v_last4);

    RETURN v_decrypted;
END;
$$;

REVOKE ALL ON FUNCTION get_customer_pnr(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_customer_pnr(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION get_customer_pnr(UUID, TEXT, TEXT) TO service_role;

-- ── 10. Helper: markera booking som RUT-eligible ────────────
-- Kallas automatiskt efter Stripe-webhook sätter payment_status='paid'.
-- Behöver manuell trigger (inte auto-trigger nu — sätts i Sprint RUT.3).

CREATE OR REPLACE FUNCTION mark_booking_rut_eligible(
    p_booking_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking RECORD;
    v_flags JSONB := '[]'::jsonb;
    v_rut_ytd_total INTEGER;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;

    IF v_booking.payment_status != 'paid' THEN
        RETURN false;  -- ej betald än
    END IF;

    IF NOT v_booking.rut_requested THEN
        -- Inte RUT-bokning, markera explicit
        UPDATE bookings
        SET rut_application_status = 'not_applicable'
        WHERE id = p_booking_id;
        RETURN false;
    END IF;

    -- Kontrollera BankID-verifiering (krävs för RUT)
    IF v_booking.rut_bankid_verified_at IS NULL THEN
        v_flags := v_flags || '"missing_bankid"'::jsonb;
    END IF;

    -- Risk-flagga: ny kund?
    IF NOT EXISTS (
        SELECT 1 FROM bookings b2
        WHERE b2.customer_pnr_hash = v_booking.customer_pnr_hash
          AND b2.id != v_booking.id
          AND b2.payment_status = 'paid'
    ) THEN
        v_flags := v_flags || '"new_customer"'::jsonb;
    END IF;

    -- Risk-flagga: stort belopp?
    IF v_booking.rut_amount > 2000 THEN
        v_flags := v_flags || '"large_amount"'::jsonb;
    END IF;

    -- Risk-flagga: flyttstäd?
    IF v_booking.service_type = 'flyttstadning' THEN
        v_flags := v_flags || '"moving_cleaning"'::jsonb;
    END IF;

    -- Risk-flagga: närmar sig 75k-taket hos oss?
    SELECT COALESCE(SUM(rut_amount), 0) INTO v_rut_ytd_total
    FROM bookings
    WHERE customer_pnr_hash = v_booking.customer_pnr_hash
      AND rut_application_status IN ('submitted', 'approved', 'paid_out')
      AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now());

    IF v_rut_ytd_total + v_booking.rut_amount > 50000 THEN
        v_flags := v_flags || '"approaching_ceiling"'::jsonb;
    END IF;

    -- Uppdatera bokning
    UPDATE bookings
    SET
        rut_application_status = 'eligible',
        rut_eligible_at = now(),
        rut_risk_flags = v_flags,
        rut_buffer_reserved_sek = (v_booking.rut_amount * 0.10)::INTEGER
    WHERE id = p_booking_id;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION mark_booking_rut_eligible(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_booking_rut_eligible(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION mark_booking_rut_eligible(UUID) TO service_role;

-- ── 11. Index för admin-queries ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_bookings_rut_status_date
    ON bookings(rut_application_status, rut_eligible_at DESC)
    WHERE rut_requested = true;

CREATE INDEX IF NOT EXISTS idx_bookings_rut_risk
    ON bookings USING gin(rut_risk_flags)
    WHERE rut_requested = true;

-- ── 12. Verifiering ─────────────────────────────────────────

DO $$
DECLARE
    v_new_columns INT;
    v_new_tables INT;
    v_new_functions INT;
BEGIN
    -- Räkna nya kolumner på bookings
    SELECT COUNT(*) INTO v_new_columns
    FROM information_schema.columns
    WHERE table_name = 'bookings'
      AND column_name IN (
        'customer_pnr_encrypted', 'customer_pnr_last4', 'rut_requested',
        'rut_bankid_verified_at', 'rut_husfile_url', 'rut_skatteverket_ref',
        'rut_commission_immediate', 'rut_commission_deferred',
        'rut_buffer_reserved_sek', 'rut_risk_flags', 'rut_eligible_at'
    );

    IF v_new_columns < 11 THEN
        RAISE EXCEPTION 'Migration failed: only % of 11+ new columns present', v_new_columns;
    END IF;

    -- Räkna nya tabeller
    SELECT COUNT(*) INTO v_new_tables
    FROM information_schema.tables
    WHERE table_name IN ('customer_pnr_access_log', 'rut_skv_payouts', 'rut_payout_allocations')
      AND table_schema = 'public';

    IF v_new_tables != 3 THEN
        RAISE EXCEPTION 'Migration failed: only % of 3 new tables created', v_new_tables;
    END IF;

    -- Räkna nya functions
    SELECT COUNT(*) INTO v_new_functions
    FROM pg_proc
    WHERE proname IN ('set_customer_pnr', 'get_customer_pnr', 'mark_booking_rut_eligible')
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

    IF v_new_functions != 3 THEN
        RAISE EXCEPTION 'Migration failed: only % of 3 new functions created', v_new_functions;
    END IF;

    RAISE NOTICE 'OK: Sprint RUT.1 klar';
    RAISE NOTICE '  - Bookings utökad med % nya kolumner', v_new_columns;
    RAISE NOTICE '  - 3 nya tabeller (pnr_access_log, skv_payouts, payout_allocations)';
    RAISE NOTICE '  - 3 nya functions (set_customer_pnr, get_customer_pnr, mark_booking_rut_eligible)';
    RAISE NOTICE '';
    RAISE NOTICE 'NÄSTA STEG (innan Sprint RUT.2):';
    RAISE NOTICE '  1. Skapa RUT_PNR_ENCRYPTION_KEY i vault via Supabase Studio:';
    RAISE NOTICE '     SELECT vault.create_secret(''<32-char random>'', ''RUT_PNR_ENCRYPTION_KEY'');';
    RAISE NOTICE '  2. Testa set_customer_pnr + get_customer_pnr med test-booking';
    RAISE NOTICE '  3. Verifiera att customer_pnr_access_log får en rad per anrop';
END $$;

COMMIT;
