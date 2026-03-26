# 🚀 Spick – Komplett Setup-guide

## 1. Kör direkt (inget konto behövs)
Plattformen är live på https://spick.se och fungerar med demo-läge.

## 2. Supabase Secrets att sätta
Gå till: https://supabase.com/dashboard/project/urjeijcncsyuletprydy/settings/vault

| Secret | Värde | Status |
|--------|-------|--------|
| `STRIPE_SECRET_KEY` | `sk_live_51TEsG3FQ...` | ✅ Satt |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_51TEsG3FQ...` | ✅ Satt |
| `STRIPE_WEBHOOK_SECRET` | `whsec_MWbvuu...` | ✅ Satt |
| `RESEND_API_KEY` | Din nyckel | ✅ Satt |
| `ANTHROPIC_API_KEY` | Din nyckel | ✅ Satt |
| `GRANDID_API_KEY` | Skaffa på grandid.com | ⏳ Demo |
| `SPAR_API_KEY` | Ansök via Bolagsverket | ⏳ Demo |
| `SWISH_CERT_PEM` | Från din bank | ⏳ Demo |
| `SWISH_KEY_PEM` | Från din bank | ⏳ Demo |
| `SWISH_MERCHANT_NUMBER` | Ditt Swish-nummer | ⏳ Demo |
| `SKV_API_KEY` | Ansök via SKV | ⏳ Demo |

## 3. Stripe Dashboard – manuella steg

### Skapa VALKOMMEN10 kupong
1. Gå till https://dashboard.stripe.com/coupons
2. Klicka "+ Create coupon"
3. ID: `VALKOMMEN10`
4. Typ: Percentage, 10%
5. Duration: Once

### Aktivera Stripe Connect (Express)
1. Gå till https://dashboard.stripe.com/connect/accounts/overview
2. Klicka "Get started"
3. Välj "Express"
4. Fyll i bolagsuppgifter

### Sätt webhook-endpoint
1. Gå till https://dashboard.stripe.com/webhooks
2. Lägg till: `https://urjeijcncsyuletprydy.supabase.co/functions/v1/stripe-webhook`
3. Events: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`

## 4. Externa avtal

### BankID via GrandID
- Webbplats: https://www.grandid.com
- Kostnad: ~1-2 kr/verifiering
- Tid: 1-3 dagar
- Efter avtal: sätt `GRANDID_API_KEY`

### Swish Handel
- Kontakta: Handelsbanken, SEB, Swedbank eller Nordea
- Kostnad: ~2-3 kr/transaktion
- Tid: 1-2 veckor
- Du får: certifikat (PEM) + merchant number

### SPAR (personnummer → adress)
- Ansök: https://www.bolagsverket.se/spar
- Kostnad: ~0.50 kr/uppslag
- Tid: 2-4 veckor
- Behövs för: autofyll adress vid BankID-login

### Skatteverkets RUT-API
- Ansök: https://www.skatteverket.se/
- Sök: "ROT och RUT digitala tjänster"
- Tid: 1-2 veckor
- Behövs för: automatiska RUT-ansökningar

## 5. Google Maps API (valfritt, ger bättre adress-autocomplete)
1. Gå till https://console.cloud.google.com
2. Aktivera "Places API" och "Maps JavaScript API"
3. Skapa API-nyckel (begränsa till spick.se)
4. Lägg till i boka.html och stadare.html

## 6. Buffer (social media automation)
1. Skapa konto på https://buffer.com
2. Koppla Instagram och Facebook
3. Skapa personal access token
4. Lägg till `BUFFER_ACCESS_TOKEN` i GitHub Secrets
5. Kör workflow "Hämta Buffer Profile IDs" för att få profil-IDs

## 7. Lägg till din första städare
1. Gå till https://spick.se/registrera-stadare.html
2. Fyll i uppgifter
3. Öppna https://spick.se/admin.html
4. Under "Ansökningar" – klicka "✅ Godkänn"

## 8. Verifiera att allt fungerar
1. Boka en testcitädning på https://spick.se/boka.html
2. Använd Stripe test-kortet: `4242 4242 4242 4242`
3. Kontrollera att bekräftelsemail skickas
4. Logga in på admin.html och se bokningen
