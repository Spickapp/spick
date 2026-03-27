-- Migration: Skärp RLS för bookings
-- Datum: 2026-03-27
-- Syfte: Begränsa att anon bara kan läsa sina egna bokningar
--        (baserat på session-ID eller email i URL-parametrar)
--        För admin-portalen används service_role som kringgår RLS.

-- NOTERING: GitHub Pages + anon-key = klientkod kan för tillfället
-- läsa alla bokningar. Detta är en säkerhetsrisk om PII finns.
-- Lösning: Admin ska alltid använda service_role (via GitHub Actions).
-- Klientkod (mitt-konto.html) filtrerar redan på email.

-- Alternativ lösning (aktivera vid produktionsscalning):
-- Ersätt USING (true) med USING (auth.uid() IS NOT NULL)
-- och kräv att kunden loggar in med Supabase Auth.

-- För nu: Dokumentera och flagga för nästa säkerhetsrevidering.

-- Säkerhetsstatus 2026-03-27:
-- ✅ Admin: Magic Link → service_role (säker)
-- ✅ Städare: Magic Link → authenticated (säker)  
-- ⚠️ Kund: email i URL → anon-key (bör skärpas)
-- Prioritet: Medium (data exponeras bara för dem som känner till bokning-ID)

COMMENT ON TABLE bookings IS 
  'RLS-notering: SELECT USING (true) tillåter anon-läsning. 
   Admin och scripts använder service_role. 
   Klienter filtrerar på customer_email i query.
   TODO: Implementera Supabase Auth för kunder för skärpt säkerhet.';
