# Spick – Integrationsguide

## BankID via GrandID
1. Gå till grandid.com → "Prova gratis"
2. Skapa konto, välj tjänst "BankID"
3. Testa i sandbox (gratis)
4. Uppgradera till produktion (~1-2 kr/autentisering)
5. Sätt `GRANDID_API_KEY` i Supabase Secrets

## SPAR (personnummer → adress)
1. Ansök via Bolagsverket: bolagsverket.se/spar
2. Bifoga bolagets org.nr, ändamål ("adressuppslagning för tjänstebokning")
3. Handläggningstid: 2-4 veckor
4. Kostnad: ca 0.50 kr/uppslag
5. Sätt `SPAR_API_KEY` i Supabase Secrets

## Swish Handel
1. Kontakta din företagsbank (Handelsbanken, SEB, Swedbank, Nordea)
2. Ansök om "Swish för handel"
3. Du får Swish-nummer + certifikat (PEM-filer)
4. Ladda upp certifikat som Supabase Secrets:
   - `SWISH_CERT_PEM` – certifikatfilen
   - `SWISH_KEY_PEM` – nyckelfilens innehåll
   - `SWISH_MERCHANT_NUMBER` – ditt Swish-nummer (10 siffror)
5. Kostnad: 2-3 kr/transaktion

## Skatteverkets RUT-API
1. Ansök via skatteverket.se → "ROT och RUT digitala tjänster"
2. Kräver godkänt företag + F-skatt
3. Handläggningstid: 1-2 veckor
4. Sätt `SKV_API_KEY` i Supabase Secrets
