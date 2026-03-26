# Stripe Aktivering – Gör detta nu (45 min)

> När detta är klart kan Spick ta emot betalningar.

---

## Steg 1: Skapa Stripe-konto (10 min)

1. Gå till **stripe.com** → "Start now"
2. Fyll i e-post: **hello@spick.se**
3. Välj land: **Sverige**
4. Aktivera kontot via e-post
5. Fyll i företagsinfo:
   - Företagsnamn: **Haghighi Consulting AB**
   - Org.nr: **559402-4522**
   - Bransch: **Cleaning services**
   - Bankuppgifter: lägg till ditt företagskonto

---

## Steg 2: Hämta API-nycklar (2 min)

1. I Stripe Dashboard → **Developers → API keys**
2. Kopiera **Secret key** (börjar med `sk_live_...`)
   - Under uppstart: använd `sk_test_...` (testmiljö)

---

## Steg 3: Sätt nyckeln i Supabase (5 min)

1. Gå till: **supabase.com/dashboard/project/urjeijcncsyuletprydy/settings/functions**
2. Klicka **"Edit secrets"**
3. Lägg till:
   ```
   STRIPE_SECRET_KEY = sk_live_XXXXXXXXXXXX
   ```
4. Spara

---

## Steg 4: Sätt nyckeln i GitHub Secrets (2 min)

1. Gå till: **github.com/Spickapp/spick/settings/secrets/actions**
2. Klicka **"New repository secret"**
3. Name: `STRIPE_SECRET_KEY`
4. Value: `sk_live_XXXXXXXXXXXX`
5. Spara

---

## Steg 5: Aktivera Stripe Webhook (10 min)

1. I Stripe Dashboard → **Developers → Webhooks**
2. Klicka **"Add endpoint"**
3. URL:
   ```
   https://urjeijcncsyuletprydy.supabase.co/functions/v1/stripe-webhook
   ```
4. Events att lyssna på:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
5. Kopiera **Signing secret** (börjar med `whsec_...`)
6. Lägg till i Supabase Secrets:
   ```
   STRIPE_WEBHOOK_SECRET = whsec_XXXXXXXXXXXX
   ```

---

## Steg 6: Testa (15 min)

1. Gå till **spick.se/boka.html**
2. Boka en testbokning med testkortet:
   - Kortnummer: **4242 4242 4242 4242**
   - Datum: valfritt framtida
   - CVC: **123**
3. Verifiera:
   - ✅ Kunden vidarebefordras till Stripe Checkout
   - ✅ Klarna visas som betalningsalternativ
   - ✅ Redirect till tack.html efter betalning
   - ✅ Bokningsbekräftelse skickas till kunden
   - ✅ Admin-notis skickas till hello@spick.se
   - ✅ Bokning i admin.html får status "betald"

---

## Checklista

- [ ] Stripe-konto skapat och aktiverat
- [ ] `STRIPE_SECRET_KEY` i Supabase Secrets
- [ ] `STRIPE_SECRET_KEY` i GitHub Secrets
- [ ] `STRIPE_WEBHOOK_SECRET` i Supabase Secrets
- [ ] Webhook-endpoint skapad i Stripe Dashboard
- [ ] Testbokning genomförd utan fel

---

*Har du problem? Fela i Stripe Dashboard → Developers → Logs*
