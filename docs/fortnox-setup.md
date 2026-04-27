# Fortnox-integration — setup-guide

**Status:** Backend-MVP klart 2026-04-27. UI i stadare-dashboard kommer i nästa sprint.
**Värde:** Cleaners kan koppla sitt Fortnox-konto till Spick → fakturor + bokföring auto.

## ETT-GÅNGS-SETUP (du gör)

### 1. Skapa Fortnox Developer-konto
1. Gå till https://www.fortnox.se/developer
2. Skapa konto (gratis)
3. Klicka **Create Integration** / **Skapa integration**
4. Fyll i:
   - **Name:** `Spick`
   - **Description:** `Digital städplattform — push fakturor från genomförda städningar`
   - **Redirect URI:** `https://urjeijcncsyuletprydy.supabase.co/functions/v1/fortnox-oauth-callback`
   - **Scopes:** `companyinformation`, `invoice`, `bookkeeping`

### 2. Kopiera Client ID + Secret
Du får 2 strängar:
- `Client ID` (ser ut som `xxxxxxx-xxxx-xxxx`)
- `Client Secret` (lång hex-sträng)

### 3. Sätt Supabase secrets
```bash
supabase secrets set FORTNOX_CLIENT_ID="<din client_id>"
supabase secrets set FORTNOX_CLIENT_SECRET="<din client_secret>"
```

### 4. Apply migration + deploy EFs
```powershell
# Apply migration via SQL Editor
Get-Content supabase/migrations/20260427140000_fortnox_credentials.sql | Set-Clipboard
# → klistra in i SQL Editor → Run

# Deploy EFs
supabase functions deploy fortnox-oauth-init fortnox-oauth-callback fortnox-push-invoice
```

(Vid EF-cap → ta bort orphan EF — säg till så hjälper jag identifiera.)

## TEST-FLÖDE (manuellt, innan UI är på plats)

### Steg 1: Generera auth-URL för en cleaner
```bash
# Cleaner måste vara inloggad och ha en JWT
curl -X POST https://urjeijcncsyuletprydy.supabase.co/functions/v1/fortnox-oauth-init \
  -H "Authorization: Bearer <CLEANER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{}'
# Response: { "ok": true, "auth_url": "https://apps.fortnox.se/oauth-v1/auth?...", "state": "..." }
```

### Steg 2: Cleaner öppnar auth_url
- Loggar in på Fortnox
- Godkänner att Spick får tillgång
- Fortnox redirect:ar till `fortnox-oauth-callback` med `?code=X&state=Y`
- HTML-sida visas: "✅ Klart!" eller felsida

### Steg 3: Push en faktura manuellt
```bash
curl -X POST https://urjeijcncsyuletprydy.supabase.co/functions/v1/fortnox-push-invoice \
  -H "Authorization: Bearer <CLEANER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"booking_id":"<uuid-of-paid-booking>"}'
# Response: { "ok": true, "fortnox_invoice_number": "1", "fortnox_customer_number": "1" }
```

### Steg 4: Verifiera i Fortnox
- Logga in på cleaner's Fortnox-konto
- Faktureringssektionen ska visa nya fakturan
- Bokföringen ska kunna importera den

## NÄSTA STEG (Phase 2)

1. **UI i stadare-dashboard.html** — "Koppla Fortnox"-knapp + "Push fakturor automatiskt?"-toggle
2. **Auto-push från stripe-webhook** — vid `checkout.session.completed` + cleaner har Fortnox-koppling → trigger push-invoice
3. **Cron token-refresh** — refreshar tokens 5 min innan utgång (idag triggas vid varje push, inte schemalagt)
4. **Fortnox Lön-koppling** — push månads-arbetstid till Fortnox Lön (om cleaner har anställda)
5. **Audit-log per push** — vilken faktura skickad, när, status

## SÄKERHET

- Tokens lagras i `cleaner_fortnox_credentials` (RLS-skyddad)
- Phase 1 MVP: plaintext tokens — Phase 2 lägger AES-256
- CSRF-skydd via state-token (10 min TTL i platform_settings)
- Cleaner kan bara se SIN egen koppling, inte andras
- service-role har full access för EFs
- anon har INGEN access

## KOSTNAD

- Fortnox Developer-konto: gratis
- Per cleaner som kopplar: kräver eget Fortnox-abonnemang (ingår i deras eget — Spicks integration är gratis)
- Spick betalar ingenting för API-anrop

## DIFFERENTIATOR vs AddHub

AddHub har Fortnox-koppling som inkluderad feature (~500 kr/mån prenumeration).
Spick har Fortnox-koppling **GRATIS** (du betalar bara 12% provision per genomförd städning).

Marketing-pitch:
> "Koppla Fortnox till Spick — fakturor från städningar pushas automatiskt
> till din bokföring. Ingen extra kostnad."
