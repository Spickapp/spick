# Sätt upp e-postnotiser för Spick

## Steg 1 – Skapa Resend-konto (gratis)
1. Gå till resend.com
2. Klicka "Sign up" – logga in med GitHub (Spickapp)
3. Gå till "API Keys" → "Create API Key"
4. Namnge den "spick-notifications"
5. Kopiera API-nyckeln (börjar med re_...)

## Steg 2 – Verifiera domänen spick.se i Resend
1. I Resend → "Domains" → "Add Domain"
2. Skriv in spick.se
3. Lägg till de DNS-poster Resend visar i Loopias DNS-editor
4. Klicka "Verify"

## Steg 3 – Lägg till API-nyckeln i Supabase
1. Gå till Supabase → Settings → Edge Functions → Secrets
2. Klicka "Add new secret"
3. Name: RESEND_API_KEY
4. Value: din Resend API-nyckel
5. Spara

## Steg 4 – Deploya Edge Function
Kör i terminalen:
```
npx supabase functions deploy notify --project-ref urjeijcncsyuletprydy
```

## Steg 5 – Skapa database webhook i Supabase
1. Supabase → Database → Webhooks → "Create webhook"
2. Name: notify-on-booking
3. Table: bookings
4. Events: INSERT
5. URL: https://urjeijcncsyuletprydy.supabase.co/functions/v1/notify
6. Upprepa för cleaner_applications

Klart! Du får nu e-post på hello@spick.se vid varje ny bokning och ansökan.
