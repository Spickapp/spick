-- SPICK – Faktura-tabell
CREATE TABLE IF NOT EXISTS invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_email TEXT NOT NULL,
  cleaner_name TEXT,
  period TEXT NOT NULL,
  num_bookings INTEGER DEFAULT 0,
  gross_revenue DECIMAL(12,2) DEFAULT 0,
  provision_amount DECIMAL(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_cleaner ON invoices(cleaner_email);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(period);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Anon read invoices"
  ON invoices FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Anon insert invoices"
  ON invoices FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Service role manage invoices"
  ON invoices FOR ALL USING (auth.role() = 'service_role');

-- Lägg till RLS på bookings_status_log om den finns
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'booking_status_log') THEN
    ALTER TABLE booking_status_log ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='booking_status_log' AND policyname='Public insert log') THEN
      CREATE POLICY "Public insert log" ON booking_status_log FOR INSERT WITH CHECK (true);
      CREATE POLICY "Anon read log" ON booking_status_log FOR SELECT USING (true);
    END IF;
  END IF;
END $$;
