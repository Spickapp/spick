-- Tvinga PostgREST att ladda om schema-cachen
-- Behövs när kolumner lagts till via ALTER TABLE
NOTIFY pgrst, 'reload schema';

SELECT 'Schema cache reloadad ✅' AS status;
