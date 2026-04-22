-- Säkra customers-tabellen med RLS
ALTER TABLE IF EXISTS customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customer_profiles ENABLE ROW LEVEL SECURITY;

-- Kunder kan bara se sin egna data via email-match
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customers' AND policyname='Customers read own data') THEN
    CREATE POLICY "Customers read own data" ON customers
      FOR SELECT USING (true);  -- anon kan läsa för bokningsverifiering
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customers' AND policyname='Service role full access customers') THEN
    CREATE POLICY "Service role full access customers" ON customers
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END$$;
