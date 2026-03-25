-- SPICK – Admin read policies
-- Tillåter anon key att läsa data för admin-panelen
-- Säkerheten ligger i frontend-lösenordet (Sp!ck#Adm1n$2026)

DO $$ BEGIN

-- Bokningar
IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='bookings' AND policyname='Anon read bookings') THEN
  CREATE POLICY "Anon read bookings" ON bookings FOR SELECT USING (true);
END IF;

-- Ansökningar
IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='cleaner_applications' AND policyname='Anon read applications') THEN
  CREATE POLICY "Anon read applications" ON cleaner_applications FOR SELECT USING (true);
END IF;

-- Kundprofiler
IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='customer_profiles' AND policyname='Anon read customer profiles') THEN
  CREATE POLICY "Anon read customer profiles" ON customer_profiles FOR SELECT USING (true);
END IF;

-- Analytics
IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='analytics_events' AND policyname='Anon read analytics') THEN
  CREATE POLICY "Anon read analytics" ON analytics_events FOR SELECT USING (true);
END IF;

-- Messages
IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='messages' AND policyname='Anon read messages') THEN
  CREATE POLICY "Anon read messages" ON messages FOR SELECT USING (true);
END IF;

-- Notifications
IF EXISTS (SELECT FROM pg_tables WHERE tablename='notifications') THEN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='notifications' AND policyname='Anon read notifications') THEN
    CREATE POLICY "Anon read notifications" ON notifications FOR SELECT USING (true);
  END IF;
END IF;

-- Guarantee requests
IF EXISTS (SELECT FROM pg_tables WHERE tablename='guarantee_requests') THEN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='guarantee_requests' AND policyname='Anon read guarantee requests') THEN
    ALTER TABLE guarantee_requests ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Anon read guarantee requests" ON guarantee_requests FOR SELECT USING (true);
    CREATE POLICY "Public insert guarantee requests" ON guarantee_requests FOR INSERT WITH CHECK (true);
  END IF;
END IF;

-- Invoices
IF EXISTS (SELECT FROM pg_tables WHERE tablename='invoices') THEN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='invoices' AND policyname='Anon read invoices') THEN
    ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Anon read invoices" ON invoices FOR SELECT USING (true);
    CREATE POLICY "Service role manage invoices" ON invoices FOR ALL USING (auth.role()='service_role');
  END IF;
END IF;

END $$;
