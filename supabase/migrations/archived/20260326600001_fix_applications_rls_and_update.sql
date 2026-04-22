-- Fix 1: Lägg till UPDATE-policy för authenticated (admin)
CREATE POLICY IF NOT EXISTS "Autentiserad kan uppdatera ansökningar" 
  ON cleaner_applications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Fix 2: Lägg till UPDATE-policy för anon också (admin använder anon-nyckel)
CREATE POLICY IF NOT EXISTS "Anon kan uppdatera ansökningar"
  ON cleaner_applications FOR UPDATE TO anon USING (true) WITH CHECK (true);

SELECT 'RLS fix klar ✅' AS status;
