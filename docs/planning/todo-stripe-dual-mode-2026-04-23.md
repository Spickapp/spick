# TODO — Stripe dual-mode ofullständig i prod

**Öppnat:** 2026-04-23 kväll (efter commit 4400245-kedjan)
**Prio:** MEDIUM — blockerar end-to-end-testning med 4242-kort
**Status:** Dokumenterat, ej åtgärdat
**Relaterade dokument:** docs/deploy/2026-04-27-stripe-dual-key-setup.md

## Upptäckt 2026-04-23 kväll

Efter migration 20260427000001_stripe_test_mode_flag.sql körts i prod och flaggan togglats till true, skapade booking-create fortfarande en live-checkout-session (cs_live_... i URL:en) istället för test-session (cs_test_...).

## Vad som är verifierat

- platform_settings.stripe_test_mode finns i prod med värden togglingsbart
- Alla 6 Stripe-secrets existerar i Supabase Edge Functions secrets:
  - STRIPE_SECRET_KEY
  - STRIPE_SECRET_KEY_TEST
  - STRIPE_WEBHOOK_SECRET
  - STRIPE_WEBHOOK_SECRET_TEST
  - STRIPE_PUBLISHABLE_KEY
  - STRIPE_WEBHOOK_SECRET_CONNECT
- booking-create:42-62 läser platform_settings.stripe_test_mode och har fallback-logik till live
- 09b0c89 (stripe-webhook Fas 6.3 retrofit) deployad till prod denna session
- Test utfört: stripe_test_mode togglat till true, bokning gjord via inkognito på spick.se/boka.html
- Resultat: Stripe-URL började med cs_live_ trots att flaggan var true
- Flaggan återställd till false efter test. Ingen betalning skedde. Ingen live-transaktion påverkad.

## Hypoteser att verifiera (i denna ordning)

### Hypotes 1: STRIPE_SECRET_KEY_TEST är tom eller felaktig
booking-create:62 loggar warning "stripe_test_mode=true but STRIPE_SECRET_KEY_TEST not set — falling back to live" om värdet är tomt. Kolla Supabase Edge Function logs vid tidpunkten för testet (2026-04-23 ca 22:30-23:00 lokal tid) efter denna warning. Om den finns: hypotes bekräftad, fix = sätta rätt sk_test_-värde.

### Hypotes 2: STRIPE_SECRET_KEY_TEST innehåller live-nyckel av misstag
Om nyckeln börjar med "sk_live_" istället för "sk_test_" använder booking-create ändå live-mode (Stripe själv avgör mode av prefixet). Kolla värdet i Supabase Dashboard → Edge Functions → Secrets → STRIPE_SECRET_KEY_TEST → visa värde. Om prefixet är "sk_live_": fix = ersätt med rätt sk_test_-nyckel från Stripe Dashboard testmode.

### Hypotes 3: EF cold-start cache
Om booking-create-EF:n startades före STRIPE_SECRET_KEY_TEST sattes, kan den cacha gamla env-värden. Osannolikt (Deno/Supabase läser env per request), men kan testas genom att re-deploya booking-create och testa igen.

### Hypotes 4: Bugg i dual-key-logiken
booking-create:42-68 kan ha en logisk bugg. Läs igenom koden, spåra flödet: SELECT från platform_settings → null check → tom sträng check → returnera KEY_LIVE eller KEY_TEST. Sannolikt ej orsak baserat på kod-granskning, men verifiera.

## Åtgärd

1. Kolla Supabase EF logs för booking-create under testtiden (se hypotes 1)
2. Om warning syns → verifiera STRIPE_SECRET_KEY_TEST-värdet (hypotes 2)
3. Om värdet är sk_test_* men det ändå failade → re-deploy booking-create (hypotes 3)
4. Om fortfarande fail → läs booking-create-koden rad för rad (hypotes 4)
5. Testa igen med samma protokoll: toggla true → inkognito boka → kontrollera cs_test_ i URL → toggla false

## Samband med övriga öppna trådar

- Fas 6.3 stripe-webhook-retrofit (09b0c89) är deployad men otestad i prod pga dual-mode-problemet. Webhook fungerar för live-betalningar (ingen bugg rapporterad), men end-to-end-tester kräver dual-mode.
- Fas 1.6 integration-tests (4 ignored-tester) kan fortfarande inte aktiveras pga beroende på verified Connect-account.
- Ingen ekonomisk risk just nu. Live-betalningar fungerar som vanligt.

## Status för nästa session

Stripe dual-mode är DELVIS byggt (flagga + secrets + kod) men fungerar inte i prod. Undersök i ordning enligt hypoteserna ovan. Rör inte ytterligare kod innan hypotes 1-2 är verifierade.
