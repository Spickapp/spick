# Runbook: Fas 1.9 Money Layer Activation

**Skapad:** 2026-04-20  
**Status:** Aktiv  
**Ansvarig:** Farhad Haghighi

## Oversikt

Aktivera money-layer infrastruktur i prod via self-governing mekanism:

- **pg_cron** triggar `reconcile-payouts` EF hourly (5 min efter varje hel timme)
- **Dry-run-mode** forst: `money_layer_enabled='false'` → reconciliation kors utan writes till bookings
- **Auto-activation:** 20 clean dry-runs inom 24h → auto-flip till `'true'`
- **Auto-rollback:** critical mismatches → auto-flip till `'false'`

Ingen manuell flip-mekanism behovs for normal drift. Admin granskar 
audit-log vid avvikelser.

## Pre-conditions checklist

Fore aktivering ska alla dessa vara sanna:

- [ ] Commit 945b9f8 + Fas 1.9-commit pushade till main
- [ ] EF `reconcile-payouts` deployad via `supabase functions deploy`
- [ ] Migration `20260420_f1_9_reconcile_cron_and_metrics.sql` kord i prod
- [ ] `SUPABASE_SERVICE_ROLE_KEY` finns i `vault.decrypted_secrets` (brukar finnas default i Supabase)
- [ ] `STRIPE_SECRET_KEY` finns i Edge Function secrets (live)
- [ ] `STRIPE_SECRET_KEY_TEST` finns i EF secrets (for test-cleaners)
- [ ] 100+ Deno-tester pass lokalt (deno test supabase/functions/_tests/money/)
- [ ] Integration-tester mot Stripe test mode utforda (minst 1 happy path)

## Aktivering-steg

### Fas 1.9a: Deploy (manuell, engangs)

**1. Deploy Edge Function:**

```bash
cd C:\Users\farha\spick
supabase functions deploy reconcile-payouts
```

Forvantat output: "Deployed Function reconcile-payouts".

**2. Kor migration i Supabase SQL Editor:**

Oppna filen:
`supabase/migrations/20260420_f1_9_reconcile_cron_and_metrics.sql`

Klistra in innehallet i SQL Editor och kor.

Forvantat NOTICE-output:
````
OK: Fas 1.9 migration klar
  - pg_cron + pg_net aktiverade
  - Cron job reconcile-payouts-hourly schemalagd (5 * * * *)
  - payout_metrics_hourly-vy skapad

Forsta reconciliation-run: nasta hela timme + 5 min
Sjalvgaende activation efter 20 clean dry-runs (24h)
````

**3. Verifiera i SQL Editor:**

```sql
SELECT jobname, schedule, active 
  FROM cron.job 
 WHERE jobname = 'reconcile-payouts-hourly';
```
Forvantat: 1 rad, `active=true`.

```sql
SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');
```
Forvantat: 2 rader.

**4. Verifiera secrets i Supabase Dashboard:**

- Project Settings → Edge Functions → Secrets
- Verifiera att `STRIPE_SECRET_KEY` finns
- Verifiera att `STRIPE_SECRET_KEY_TEST` finns (for test-cleaners)
- Verifiera att `SUPABASE_SERVICE_ROLE_KEY` finns

### Fas 1.9b: Dry-run-period (automatisk)

**Start:** Omedelbart efter migration-koring.

**Beteende:** pg_cron kor reconcile-payouts hourly. EF detekterar 
`money_layer_enabled='false'` → kor i dry_run-mode (inga bookings-writes, 
bara audit-log).

**Forsta run:** Nasta hela timme + 5 min efter migration.
  - Exempel: migration kord 14:23 → forsta run 15:05

### Fas 1.9c: Auto-activation (automatisk)

**Trigger:** Efter 20 clean dry-runs inom 24h (minst 20 timmar utan 
en enda mismatch).

**Beteende:** EF uppdaterar `platform_settings.money_layer_enabled='true'` 
+ skapar audit-entry `auto_activation_triggered`.

**Om forsenad:** Varje mismatch resetar 24h-rakningen. Om systemet har 
drift fortsatter dry_run tills drift lost.

## Monitoring under dry-run + post-activation

### Minutvis (via SQL Editor eller admin.html)

**Cron-status:**
```sql
SELECT start_time, status, return_message 
  FROM cron.job_run_details
 WHERE jobname = 'reconcile-payouts-hourly'
 ORDER BY start_time DESC 
 LIMIT 10;
```

**Senaste reconciliation-runs:**
```sql
SELECT created_at, action, severity, 
       details->>'run_id' AS run_id,
       details->>'mismatches_count' AS mismatches,
       details->>'transfers_checked' AS transfers
  FROM payout_audit_log
 WHERE action LIKE 'reconciliation%'
 ORDER BY created_at DESC 
 LIMIT 24;
```

**Timvis overview (admin-dashboard):**
```sql
SELECT * FROM payout_metrics_hourly LIMIT 48;
```

### Dagvis (checklistor)

**Under dry-run (forsta 24h):**
- [ ] Kontrollera att cron triggar hourly (24 runs/dag)
- [ ] Inga `reconciliation_error` i audit-log
- [ ] 0 critical mismatches
- [ ] Total transfers matchar Stripe Dashboard

**Post-activation (forsta veckan):**
- [ ] 1 auto_activation_triggered audit finns
- [ ] money_layer_enabled='true' i platform_settings
- [ ] Nya bokningar har commission_pct=12 (fran getCommission)
- [ ] Inga auto_rollback_triggered events
- [ ] payout_metrics_hourly visar forvantat monster

## Rollback-procedurer

### Automatisk rollback (self-governing)

**Trigger:** Critical mismatches detekterade av reconcilePayouts
- `stripe_reversed_db_paid`
- `db_paid_stripe_missing`
- `amount_mismatch`

**Beteende:** EF sater `money_layer_enabled='false'` + skapar audit 
`auto_rollback_triggered`. Cron fortsatter kora i dry_run-mode.

**Post-rollback (manuell):**
1. Granska audit-log for vilka critical mismatches triggade rollback
2. Undersok rot-orsak (DB-korruption? Stripe API-fel? Koks-bug?)
3. Fixa underliggande problem
4. Manuell re-activation (se nasta sektion)

### Manuell rollback (force)

Om admin behover tvinga rollback (e.g. incident detekteras utanfor 
reconciliation):

```sql
UPDATE platform_settings 
   SET value = 'false', 
       updated_at = NOW()
 WHERE key = 'money_layer_enabled';

INSERT INTO payout_audit_log (action, severity, details, created_at)
VALUES (
  'manual_rollback', 
  'alert',
  jsonb_build_object(
    'reason', 'INSERT_REASON_HERE',
    'admin_user', 'INSERT_ADMIN_EMAIL',
    'rollback_type', 'manual'
  ),
  NOW()
);
```

### Manuell re-activation (efter rollback)

Efter att root cause atgardats:

```sql
UPDATE platform_settings 
   SET value = 'true', 
       updated_at = NOW()
 WHERE key = 'money_layer_enabled';

INSERT INTO payout_audit_log (action, severity, details, created_at)
VALUES (
  'manual_activation', 
  'info',
  jsonb_build_object(
    'reason', 'INSERT_REASON_HERE',
    'admin_user', 'INSERT_ADMIN_EMAIL',
    'preceded_by_rollback', true
  ),
  NOW()
);
```

### Total noduppstopp (disable cron)

Om pg_cron sjalvt behover stoppas (e.g. DDoS-risk mot EF):

```sql
SELECT cron.unschedule('reconcile-payouts-hourly');
```

Re-enable senare:
```sql
SELECT cron.schedule(
  'reconcile-payouts-hourly',
  '5 * * * *',
  $$ SELECT net.http_post(...) $$  -- samma body som i migration
);
```

## Skalbarhets-considerations

### Nuvarande kapacitet (designad for)

- **Reconciliation:** 100 transfers/run, 50 API-calls/run
- **Frekvens:** 24 runs/dygn
- **Bandbredd:** 2400 transfers/dygn
- **Stripe rate limit:** 100 req/sek (live) — vi anvander < 50 req/h

**Tillracklig for:** 10 000+ bokningar/manad (300+/dygn).

### Vid skala (1000+ bokningar/dygn)

**Steg 1 — Oka bandbredd:**
```sql
-- Oka max_transfers + api_calls via EF-parameter
-- Kraver EF-update: opts.max_transfers=500, max_api_calls=200
```

**Steg 2 — Minska cron-intervall:**
```sql
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'reconcile-payouts-hourly'),
  schedule := '*/15 * * * *'  -- Var 15:e minut istallet for hourly
);
```

**Steg 3 — Paginering via `starting_after`:**
- Kraver kod-update i `reconcilePayouts()` (money.ts)
- Implementera loop som hamtar fler transfers tills alla inom tidsfonstret
- Fas for detta: nar volym naer 10 000 transfers/dygn

### Metrics som triggar skalnings-beslut

Monitera via payout_metrics_hourly:

| Metric | Threshold | Action |
|--------|-----------|--------|
| `api_calls_used > 40/run` | Under 50 max | Normal — ingen action |
| `api_calls_used > 45/run` | 90% av max | Oka max_api_calls till 100 |
| `transfers_checked > 90/run` | Under 100 max | Normal |
| `transfers_checked = 100/run` | Vid max | Oka max_transfers till 200 |
| `mismatches_critical > 0` | Incident | Auto-rollback, manual review |

## Troubleshooting

### Problem: Cron kor inte

**Diagnos:**
```sql
SELECT * FROM cron.job WHERE jobname = 'reconcile-payouts-hourly';
-- Active ska vara true

SELECT * FROM cron.job_run_details 
 WHERE jobname = 'reconcile-payouts-hourly'
 ORDER BY start_time DESC LIMIT 5;
-- status ska vara 'succeeded' eller 'running'
```

**Losning:** Om active=false, kor:
```sql
UPDATE cron.job SET active = true 
 WHERE jobname = 'reconcile-payouts-hourly';
```

### Problem: EF returnerar 401

**Diagnos:** Bearer-token auth failar. SUPABASE_SERVICE_ROLE_KEY 
i vault matchar ej den EF vantar.

**Losning:** Verifiera secret i Supabase Dashboard och i vault:
```sql
SELECT name FROM vault.decrypted_secrets 
 WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';
```

### Problem: Mismatches okar over tid

**Diagnos:** Data-drift mellan lokal DB och Stripe. Mojliga orsaker:
- Webhook-failures (vi anvander ej webhooks an)
- Race conditions i triggerStripeTransfer
- Stripe-side cancellations som vi missade

**Losning:**
1. Granska varje mismatch-typ individuellt
2. Fixa rot-orsak
3. Manuell reconciliation av drift (UPDATE bookings + INSERT audit)

### Problem: Auto-activation triggar inte efter 24h clean

**Diagnos:** Mindre an 20 runs loggade i fonstret. Mojliga orsaker:
- Cron failade vid nagra runs (kolla cron.job_run_details)
- EF returnerade error (kolla payout_audit_log 'reconciliation_error')
- System restart/downtime raknade ner fonstret

**Losning:** Vanta 24h till, eller manuell activation (se ovan).

## Relaterade dokument

- Design: `docs/architecture/money-layer.md`
- Fas 1.6 design: `docs/architecture/fas-1-6-stripe-transfer-design.md`
- Fas 1.8 design: `docs/architecture/fas-1-8-reconciliation-design.md`
- Arkitektur v3.1: `docs/planning/spick-arkitekturplan-v3.md`
- Audit: `docs/audits/2026-04-20-scalability-audit.md`

## Revisionshistorik

| Datum | Version | Andring |
|-------|---------|---------|
| 2026-04-20 | 1.0 | Initial version — Fas 1.9 aktivering |
