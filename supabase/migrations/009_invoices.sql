-- SPICK – Faktura-tabell (idempotent fix)

-- Skapa tabellen om den inte finns
CREATE TABLE IF NOT EXISTS invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lägg till kolumner om de saknas
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cleaner_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS period TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS num_bookings INTEGER DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gross_revenue DECIMAL(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS provision_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Index (IF NOT EXISTS är säkert)
CREATE INDEX IF NOT EXISTS idx_invoices_cleaner ON invoices(cleaner_email);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(period);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='invoices' AND policyname='Anon read invoices') THEN
    CREATE POLICY "Anon read invoices" ON invoices FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='invoices' AND policyname='Anon insert invoices') THEN
    CREATE POLICY "Anon insert invoices" ON invoices FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='invoices' AND policyname='Service role manage invoices') THEN
    CREATE POLICY "Service role manage invoices" ON invoices FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- booking_status_log om den finns
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'booking_status_log') THEN
    ALTER TABLE booking_status_log ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='booking_status_log' AND policyname='Public insert log') THEN
      CREATE POLICY "Public insert log" ON booking_status_log FOR INSERT WITH CHECK (true);
      CREATE POLICY "Anon read log" ON booking_status_log FOR SELECT USING (true);
    END IF;
  END IF;
END $$;
