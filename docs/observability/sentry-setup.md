# Sentry Observability — Setup-runbook (Fas 10)

**Status:** ✅ Kod 100% klar — väntar på Farhads externa konto-skapande (5 min)
**Skapad:** 2026-04-26
**Ägare:** Farhad

---

## Översikt

Spick har full Sentry-integration i kod, men DSN är `null` tills du skapat
Sentry-projekt och kopierat in DSN-sträng. När det är klart fångas:

- **Frontend:** Alla `window.error` + `unhandledrejection` + manuella `spickCaptureException(err, ctx)`-anrop
- **Backend EFs:** Alla `log("error", ...)` + `log("warn", ...)` + manuella `captureError(err)` + `withSentry(efName, handler)`-wrap

PII-saneras automatiskt:
- PNR (10/12-siffror) → `[PNR-MASKED]`
- Auth-headers (apikey, authorization, x-api-key, password, token) → `[REDACTED]`
- Internal secrets (stripe_secret, service_role_key, tic_api_key, m.fl.) → `[REDACTED]`

---

## 5-minuters aktiveringsguide (Farhad)

### Steg 1 — Skapa Sentry-konto + projekt (3 min)

1. Gå till https://sentry.io/signup/
2. Välj plan: **Developer (free)** räcker upp till 5 000 errors/månad — bra start för Spick
3. Skapa organisation: `spick`
4. Skapa projekt:
   - Namn: `spick-web`
   - Plattform: **Browser JavaScript**
   - Alert frequency: "Alert me on every new issue" (default)
5. Kopiera DSN-strängen som visas. Format:
   ```
   https://abc123def456@o123456.ingest.sentry.io/7890123
   ```

### Steg 2 — Konfigurera frontend (1 min)

Öppna `js/config.js`. Hitta raden:
```js
SENTRY_DSN: null,
```

Ersätt `null` med din DSN i citationstecken:
```js
SENTRY_DSN: 'https://abc123def456@o123456.ingest.sentry.io/7890123',
```

Commit + push. GitHub Pages auto-deploy → frontend Sentry aktivt inom 30s.

### Steg 3 — Skapa Sentry-projekt #2 för backend (2 min)

Tillbaka i Sentry, skapa nytt projekt:
- Namn: `spick-ef`
- Plattform: **Node.js** (fungerar för Deno också — samma envelope-API)
- Kopiera DSN

### Steg 4 — Konfigurera backend secret (1 min)

```powershell
supabase secrets set SENTRY_DSN=https://xyz789@o123456.ingest.sentry.io/7890124
supabase secrets set SENTRY_ENVIRONMENT=production
```

Eller via Supabase Dashboard → Project Settings → Edge Functions → Manage secrets.

EFs kommer automatiskt börja skicka error/warn-events till Sentry vid nästa
cold-start (≤ 5 min).

### Steg 5 — Verifiera (1 min)

**Frontend:**
```js
// I browser-console på spick.se:
window.spickCaptureException(new Error('test-from-farhad'), { test: true });
```
→ Kontrollera att event dyker upp i Sentry-projektet `spick-web` inom 10s.

**Backend:**
```bash
curl -X POST https://urjeijcncsyuletprydy.supabase.co/functions/v1/health -d '{"trigger_test_error":true}'
```
→ Om health-EF har test-error-mode: event dyker upp i `spick-ef`. Annars
trigga ett verkligt fel (t.ex. anropa rut-bankid-init utan TIC_API_KEY).

---

## Alert-rules-rekommendation

I Sentry → Alerts → Create alert rule. Mina föreslag:

### Critical alerts (mail till hello@spick.se direkt)

| Alert | Trigger | Why |
|---|---|---|
| **Stripe-webhook fails** | `tag:ef = stripe-webhook` AND error count > 3 in 5 min | Betalningar tappas → revenue-läckage |
| **Auth/RLS denied flood** | `level:error` AND message contains "permission denied" AND count > 50 in 10 min | Möjligt attack-mönster |
| **EF cold-start spike** | `transaction.duration > 5000ms` AND count > 20 in 5 min | Supabase-degradation eller kod-regression |

### High alerts (mail dagligen sammanfattning)

| Alert | Trigger |
|---|---|
| **Booking-create failures** | `tag:ef = booking-create` AND error count > 10/dygn |
| **RUT BankID failures** | `tag:ef = rut-bankid-status` AND error count > 5/dygn |
| **PNR-encryption errors** | message contains "encryption" AND level:error |

### Info alerts (veckomail)

| Alert | Trigger |
|---|---|
| **Top 10 errors** | Veckosammanfattning av alla projects |
| **Performance regression** | P95 transaction duration ökat > 50% mot förra veckan |

---

## Daily-driver dashboards

Skapa två dashboards i Sentry:

### Dashboard 1: "Spick Health"
- Widget: Error count last 24h (per EF)
- Widget: Top 5 errors last 7d
- Widget: Affected users last 24h
- Widget: P50/P95 EF response-time

### Dashboard 2: "Spick Business-Critical"
- Widget: Stripe-webhook errors
- Widget: Booking-create errors
- Widget: RUT BankID failures
- Widget: Chargeback-events

---

## PII-säkerhet — vad Sentry SER och SER INTE

### Sentry SER (anonymiserat):
- Felmeddelande + stacktrace
- EF-namn
- HTTP method + URL (apikey/token strippade)
- Booking-id, cleaner-id (uuids — pseudonymer)
- Timestamp
- User-agent + IP (Sentry's egen feature, inte vår)

### Sentry SER ALDRIG (auto-saneras):
- `customer_pnr`, `personalNumber`, alla PNR-siffror
- `stripe_secret_key`, `service_role_key`, `tic_api_key`, alla secrets
- `password`, `token`, `authorization`-headers
- E-postadresser (om de hamnar i error-context som "user_email"-key)

### Manuell sanering (ditt ansvar):
Om du anropar `spickCaptureException(err, ctx)` direkt — sätt INTE
PNR/email/raw-cards i `ctx`-objektet. Använd hashade IDs eller pseudonymer.

---

## Kostnadskontroll

**Free tier:** 5 000 errors/månad + 50 transaktioner/timme
- Räcker för ~150 errors/dag
- Spick i prod-startup-fas: troligen <50 errors/dag

**När free tier räcker inte:**
- **Team plan:** $26/månad → 50 000 errors/månad
- **Optimera:** sänk `tracesSampleRate` från 0.1 → 0.01 i `js/config.js`
  (10x mindre performance-data, error-events oförändrade)

---

## Felsökning

### "Sentry-events syns inte"

1. Kolla browser-Network-tab efter requests till `*.ingest.sentry.io` — om 401 = fel DSN
2. Kolla Console efter `[sentry]` warnings
3. Verifiera DSN-format: `https://<key>@<host>/<project_id>` (inte hela settings-URL)
4. För backend: `supabase secrets list` → kolla att `SENTRY_DSN` är satt

### "Få spam av samma error 10 gånger/sek"

→ Sentry har inbyggt rate-limit per "issue" (samma fingerprint) — ska auto-throttla.
Om inte, kolla `beforeSend`-hook i config.js eller skapa rate-limit-rule i Sentry UI.

### "Vill stänga av Sentry tillfälligt"

- **Frontend:** Sätt `SENTRY_DSN: null` i js/config.js + push
- **Backend:** `supabase secrets unset SENTRY_DSN`

---

## Status-tracking

| Komponent | Status | Aktiveras genom |
|---|---|---|
| `_shared/sentry.ts` EF-wrapper | ✅ Live i kod | Auto-laddas via dynamic import i log.ts |
| `js/config.js` frontend Sentry | ✅ Live i kod (no-op) | Sätt SENTRY_DSN i config.js |
| `_shared/log.ts` auto-capture | ✅ Live i kod | Triggar vid log("error"/"warn") |
| Migration platform_settings | ✅ Live (3 nycklar) | Manuell flagga: sentry_enabled='true' efter setup |
| Alert rules | ⏳ Manuell setup | Skapa i Sentry UI (Steg ovan) |
| Dashboards | ⏳ Manuell setup | Skapa i Sentry UI (Steg ovan) |

---

## Disclaimer (regel #30)

Sentry är teknisk APM, ingen GDPR-bedömning. Per Sentry's [GDPR-vägledning](https://sentry.io/trust/privacy/):
- Sentry är registrerad processor enligt Art 28 GDPR
- Datacentrer i EU (Frankfurt) tillgängligt via region-config
- DPA tillgänglig via sentry.io/legal/dpa

**Farhad bedömer själv** om DPA krävs och om EU-datacenter ska aktiveras
(rekommenderat för svenska kund-data).

---

## Senast uppdaterad

2026-04-26 — Fas 10 Observability komplett kod-bas. Aktivering blockas
endast på Farhads externa Sentry-konto-skapande (5 min).
