-- Spick: Tillåt VD (company owner) att hantera priser för teammedlemmar
-- Säkerhet: Kontrollerar att inloggad användare är is_company_owner=true
-- och att cleaner_id tillhör samma company_id som VD:n

CREATE POLICY "company_owner_manage_team_prices" ON cleaner_service_prices
FOR ALL
USING (
  cleaner_id IN (
    SELECT c.id FROM cleaners c
    WHERE c.company_id IN (
      SELECT c2.company_id FROM cleaners c2
      WHERE c2.auth_user_id = auth.uid() AND c2.is_company_owner = true
    )
  )
)
WITH CHECK (
  cleaner_id IN (
    SELECT c.id FROM cleaners c
    WHERE c.company_id IN (
      SELECT c2.company_id FROM cleaners c2
      WHERE c2.auth_user_id = auth.uid() AND c2.is_company_owner = true
    )
  )
);

-- Verifiera: ska visa 4 policies nu
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'cleaner_service_prices' ORDER BY policyname;
