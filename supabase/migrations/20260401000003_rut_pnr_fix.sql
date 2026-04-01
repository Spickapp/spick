-- FAS: RUT PNR-fix
-- Lägger till customer_pnr för krypterad lagring av personnummer
-- under pågående RUT-ansökan. Raderas av rut-claim efter lyckad
-- ansökan. customer_pnr_hash behålls men används inte för RUT.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS customer_pnr TEXT DEFAULT NULL;

COMMENT ON COLUMN bookings.customer_pnr IS
  'Krypterat personnummer, används av rut-claim EF för Skatteverket-ansökan.
   Raderas automatiskt efter lyckad/misslyckad ansökan. Aldrig i klartext.';
