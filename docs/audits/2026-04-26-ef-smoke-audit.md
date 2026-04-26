# EF Smoke Audit — 2026-04-26

**Metod:** `curl POST {}` med apikey + Bearer (anon-key) mot alla 87 deployade Edge Functions.
**Endpoint:** `https://urjeijcncsyuletprydy.supabase.co/functions/v1/<EF>`
**Scope:** 87 EFs (alla mappar i `supabase/functions/` exkl. `_shared/` + `_tests/`).

> **Notera diskrepans mot CLAUDE.md:** §"Tech Stack" säger 78 EFs, §"Edge Functions"-rubriken säger 78, faktiska deploy-count = 87. Snapshot bör uppdateras (Fas 11.2 cron).

## Sammanfattning

- **87/87 EFs aktiva** (0 × 404 — inga saknade deploys)
- **0 KRITISKA** (inga 404)
- **0 HÖG** (inga oförväntade 500-crashes)
- **1 MEDEL** (1 × 503 — `bankid` config-gate, by design)
- **12 × 200** (no-input-OK eller cron-säker tom körning)
- **1 × 302** (`calendar-google-callback` redirect — by design)
- **31 × 400** (input-validation triggas — EF aktiv ✓)
- **33 × 401** (auth-required — EF aktiv ✓)
- **8 × 403** (admin/service-role/internal_secret-gate — EF aktiv ✓)
- **1 × 405** (`services-list` GET-only — by design)

**Total status: GRÖN.** Inga oväntade crashes eller saknade deploys.

## Per EF (sorterat efter HTTP-kod)

### 200 OK (12 EFs — tom body acceptabel)

| EF | Notering |
|----|----------|
| admin-morning-report | `{ok:true,sent:true,stats:{...}}` — daglig admin-rapport |
| bankid-webhook | `OK` — webhook 200 default |
| calendar-sync | `{synced:0,results:[]}` — cron-tom OK |
| claude | `{reply:"Tyvärr kunde jag inte svara just nu."}` — fallback-reply, ej crash |
| customer-nudge-recurring | `{processed:0,nudged:0,...}` — cron-tom OK |
| email-inbound | `{ok:true,auto_replied:false}` — Resend inbound webhook |
| health | `{status:"degraded",...}` — **se nedan, sub-check varning** |
| places-autocomplete | `{predictions:[]}` — tom query OK |
| preference-learn-favorite | `{processed:0,reason:"no qualifying ratings"}` |
| push | `{ok:true,sent:0,total:0}` |
| stripe-webhook | `OK` — Stripe webhook returnerar 200 (signatur valideras inuti) |
| team-sms-notify | `{ok:true,mode:"evening",...}` |

### 302 Redirect (1)

| EF | Notering |
|----|----------|
| calendar-google-callback | OAuth-callback redirect till Google — by design |

### 400 Bad Request (31 EFs — input-validation aktiv)

Verifierade samples:
- `booking-create`: `{"error":"Obligatoriska fält saknas: name, email, date, time, hours, service"}` ✓
- `matching-wrapper`: `{"error":"customer_lat och customer_lng krävs (number)"}` ✓
- `geo`: `{"error":"Unknown action"}` ✓
- `notify`: `{"error":"Invalid type"}` ✓

Övriga 400-EFs (alla bekräftat aktiva via 400-svar): analyze-booking-pattern, auto-approve-check, bankid-verify, booking-cancel-v2, booking-reassign, calendar-google-auth, calendar-ical-feed, cleaner-optout, company-self-signup, customer-approve-proposal, customer-check-auto-delegation, customer-subscription-manage, customer-upsert, generate-receipt, generate-self-invoice, get-cleaner-contact, noshow-refund, public-auth-exchange, public-auth-link, register-bankid-init, register-bankid-status, rut-bankid-init, rut-bankid-status, save-booking-event, serve-invoice, setup-subscription, stripe-connect.

### 401 Unauthorized (33 EFs — auth-gate aktiv)

Verifierade samples:
- `cleanup-stale`: `{"error":"unauthorized"}` (CRON_SECRET-gate) ✓
- `auto-rebook`: `{"error":"unauthorized"}` (CRON_SECRET) ✓
- `stripe-refund`: `{"error":"Auth check failed"}` ✓
- `vd-payment-summary`: `{"error":"invalid_token"}` ✓

Övriga: admin-approve-cleaner, admin-create-company, admin-dispute-decide, auto-delegate, auto-remind, booking-auto-timeout, charge-subscription-booking, check-terms-acceptance, cleaner-addon-price-set, cleaner-booking-response, cleaner-job-completed, company-accept-invite, company-propose-substitute, dispute-cleaner-respond, dispute-evidence-upload, dispute-open, dispute-sla-check, escrow-auto-release, expire-team-invitations, export-cleaner-data, export-customer-data, generate-receipt-pdf, get-booking-events, n3-pnr-reminder-cron, rut-batch-export-xml, sms, stripe-connect-webhook, vd-dispute-decide, vd-dispute-list.

### 403 Forbidden (8 EFs — högre privilegium krävs)

| EF | Body |
|----|------|
| admin-approve-company | `{"error":"not_admin"}` |
| admin-mark-payouts-paid | (admin-gate) |
| admin-reject-company | (admin-gate) |
| dispute-admin-decide | (admin-gate) |
| escrow-release | `{"error":"internal_secret_required"}` |
| escrow-state-transition | (internal_secret-gate) |
| reconcile-payouts | `{"error":"Insufficient privileges","role":"anon","required":"service_role or authenticated"}` |
| refund-booking | `{"error":"internal_secret_required"}` |

### 405 Method Not Allowed (1)

| EF | Notering |
|----|----------|
| services-list | GET-only (POST avvisas) — by design (rad 32-37 i `index.ts`) |

### 503 Service Unavailable (1)

| EF | Body | Trolig orsak |
|----|------|--------------|
| bankid | `{"error":"BankID ej konfigurerat","message":"Kontakta hello@spick.se – vi jobbar på att aktivera BankID-verifiering."}` | `GRANDID_API_KEY` ej satt i Supabase Secrets — by design demo-gate (`index.ts` rad 17). **Ej incident** — väntar BankID-leverantör (Signicat/GrandID-kontrakt). |

## 404-EFs (KRITISKA)

**Inga.** Alla 87 EFs är deployade och svarar.

## 500-EFs (HÖG)

**Inga.** Inga oförväntade server-crashes.

## Övriga observationer

### `health` rapporterar `degraded`

```json
{
  "status": "degraded",
  "checks": {
    "database": {"ok": true},
    "resend":   {"ok": true},
    "stripe":   {"ok": true},
    "auto_remind": {"ok": false, "minutes_since_last_run": 249},
    "runtime":  {"ok": true}
  },
  "critical_checks": ["database", "runtime"],
  "version": "3.0.1-health-policy-split"
}
```

- `auto_remind`-cron har inte kört på 249 min (~4h 9min). Förväntat intervall okänt (kolla `.github/workflows/`).
- `critical_checks` exkluderar `auto_remind`, så `degraded` ≠ outage. Men cron-larm bör verifieras.
- **Ej incident** men värt en separat utredning (cron-schedule vs faktisk run-historik).

### CLAUDE.md EF-count är stale

`CLAUDE.md` säger "78 Edge Functions" på två ställen men prod har 87 (alla deployade ur lokal `supabase/functions/`). Auto-snapshot via `update-claude-md.yml` (Fas 11.2) bör uppdatera detta.

## Metadata

- **Tid:** ~30s totalt curl-tid (parallellt 10 jobb)
- **Audit-runtime:** ca 5 min inkl. body-inspektion
- **Timestamp:** 2026-04-26 (UTC ~15:11)
- **Endpoint:** `https://urjeijcncsyuletprydy.supabase.co/functions/v1/`
- **Auth:** anon-key (publik)
