# Runbook: Fas 8 Escrow + Dispute Rollback

**Skapad:** 2026-04-25
**Status:** Aktiv
**Ansvarig:** Farhad Haghighi
**Primärkälla:** [dispute-escrow-system.md §10](../architecture/dispute-escrow-system.md)

## Översikt

Fas 8 escrow_v2-flag aktiverades 2026-04-23 21:14 UTC i prod (Stripe LIVE-mode). Detta runbook beskriver per-steg rollback om kritiska problem uppstår.

**Röd linje:** Rollback av Stripe Connect-mode efter 30+ dagars produktionskörning är RISKFYLLT. Använd legacy-mode för befintliga bookings (via escrow_state='released_legacy') så rollback inte rör existerande betalningar.

## Triggers för rollback

Avbryt escrow_v2-flow och flip till legacy om:

1. **Stripe-transfer-fail-rate > 5%** över 1h i `escrow-release` EF (admin-alerts visar > 5 critical/h)
2. **>10 stuck awaiting_attest >25h** i prod (escrow-auto-release-cron-fail)
3. **§8.11 refund-flow state-drift** triggar > 3 admin-alerts/h
4. **Kund-klagomål** om utebliven utbetalning till städare > 3st/dag

## Rollback-steg (per nivå)

### Nivå 1: Mjuk rollback (flag-flip, <1 min)

Återgår nya bokningar till legacy-flödet. Befintliga escrow_v2-bokningar fortsätter sin state-machine — INGEN data-loss.

```sql
-- Kör i Supabase Studio SQL-editor.
UPDATE platform_settings
SET value = 'legacy', updated_at = NOW()
WHERE key = 'escrow_mode';

-- Verifiera
SELECT key, value, updated_at FROM platform_settings WHERE key = 'escrow_mode';
-- Förväntat: value='legacy'
```

**Effekt:** Nya bokningar via `booking-create` går till destination-charges (legacy-path). escrow_state='released_legacy' sätts på dem.

**Reaktiverings-time:** Sätt tillbaka `value='escrow_v2'` när underliggande problem är löst.

### Nivå 2: Pausa cronner (5 min)

Om escrow-auto-release eller dispute-sla-check beter sig fel, pausa via GitHub Actions.

```bash
# Disable workflows tillfälligt
gh workflow disable "Escrow auto-release (var 15:e minut)"
gh workflow disable "Dispute SLA-check (varje timme)"

# Re-enable när fixed
gh workflow enable "Escrow auto-release (var 15:e minut)"
gh workflow enable "Dispute SLA-check (varje timme)"
```

**Effekt:** Stuck-state-bokningar blockerar inte fler transitions. Manuell admin-action krävs för pausad-period.

### Nivå 3: EF-rollback (15 min)

Om en specifik EF (refund-booking, dispute-admin-decide) introducerar en bug, rolla tillbaka till föregående version.

```bash
# Identifiera senaste fungerande version
git log --oneline supabase/functions/refund-booking/index.ts | head -5

# Revert specifik commit (skapar ny commit med rollback)
git revert <SHA>

# Eller ännu säkrare: edit + push tillbaka till föregående state
git show <SHA>:supabase/functions/refund-booking/index.ts > supabase/functions/refund-booking/index.ts
git add . && git commit -m "rollback(fas8): revert refund-booking till <SHA>"
git push
```

**Auto-deploy:** Push till main → H18 deployar EF inom 2 min.

### Nivå 4: Schema-rollback (60 min)

ALLVARLIGT. Bara om escrow_state-kolumn eller tabeller är skadade. Detta tar bort dispute-data.

```sql
-- KRÄVER backup först!
-- 1. Backup escrow_events + disputes + dispute_evidence + attested_jobs
\copy escrow_events TO '/tmp/escrow_events_backup.csv' CSV HEADER;
\copy disputes TO '/tmp/disputes_backup.csv' CSV HEADER;
\copy dispute_evidence TO '/tmp/dispute_evidence_backup.csv' CSV HEADER;
\copy attested_jobs TO '/tmp/attested_jobs_backup.csv' CSV HEADER;

-- 2. Drop constraints + tabeller
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_escrow_state_check;
DROP TABLE IF EXISTS attested_jobs CASCADE;
DROP TABLE IF EXISTS dispute_evidence CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS escrow_events CASCADE;

-- 3. Drop escrow_state-kolumn
ALTER TABLE bookings DROP COLUMN IF EXISTS escrow_state;

-- 4. Disable flag (om inte redan gjort i Nivå 1)
UPDATE platform_settings SET value = 'legacy' WHERE key = 'escrow_mode';
```

**Effekt:** Återgår till pre-Fas-8-state. ALL dispute-historik går förlorad om backup-CSV inte används.

## Reconciliation efter rollback

Efter Nivå 1 (flag-flip), bookings i intermediate states är "frozen". Manuell reconciliation:

```sql
-- Alla escrow_v2-bookings i intermediate states
SELECT id, customer_email, escrow_state, total_price, created_at
FROM bookings
WHERE escrow_state IN ('paid_held', 'awaiting_attest', 'disputed', 'resolved_full_refund', 'resolved_partial_refund', 'resolved_dismissed')
ORDER BY created_at;

-- Per booking: bestäm åtgärd
-- paid_held → cancel + refund eller proceed manuell
-- awaiting_attest → manuell escrow-release (curl mot EF) eller refund
-- disputed → admin-beslut via admin-disputes.html (om EFs fungerar)
-- resolved_full_refund → kör refund-booking EF manuellt
-- resolved_dismissed → kör escrow-release EF manuellt med trigger='admin_dismiss_transfer'
```

## Verifiering efter rollback (lvl 1)

Efter flag-flip till legacy, verifiera:

```sql
-- 1. Flag är legacy
SELECT key, value FROM platform_settings WHERE key = 'escrow_mode';

-- 2. Nya bokningar (efter rollback) får 'released_legacy'
SELECT escrow_state, COUNT(*)
FROM bookings
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY escrow_state;
-- Förväntat efter 1 ny bokning: 'released_legacy' = 1
```

```bash
# 3. booking-create retar inte
curl -X POST https://urjeijcncsyuletprydy.supabase.co/functions/v1/health \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY"
# database.ok: true expected
```

## Kontaktlista vid kritisk incident

- **Farhad** (primärt): farrehagge@gmail.com / +46760505153
- **Stripe Support**: stripe.com/support (kan reverse transfers vid akut behov)
- **Supabase Support**: supabase.com/dashboard/support

## Test-procedurer (förebyggande, kör kvartalsvis)

### Test 1: Flag-flip dry-run

1. I dev-prod: kör `UPDATE platform_settings SET value='legacy' WHERE key='escrow_mode';`
2. Skapa testbokning via boka.html
3. Verifiera escrow_state='released_legacy' (inte 'pending_payment')
4. Återställ flag till 'escrow_v2'

### Test 2: Stuck-state-detection

1. Manuellt skapa stuck booking: `INSERT INTO bookings (...) VALUES (..., 'awaiting_attest')` med created_at = 26h ago
2. Vänta 15 min för escrow-auto-release-cron
3. Verifiera state transitionerade till 'released'
4. Cleanup test-rad

### Test 3: Refund-flow end-to-end

1. Skapa test-bokning i Stripe test-mode
2. Trigga charge.succeeded webhook
3. Verifiera escrow_state='paid_held' → 'awaiting_attest'
4. Trigga dispute via min-bokning.html
5. Admin: full_refund-beslut via admin-disputes.html
6. Verifiera Stripe-refund klar + escrow_state='refunded'

## Audit-trail efter incident

Efter varje incident, dokumentera:
- Tidpunkt + trigger (vilken alarm/observation)
- Vilken nivå rollback användes
- Antal påverkade bookings + total SEK
- Orsak (root cause)
- Förebyggande åtgärd (kod-fix, monitoring-tillägg)

Lägg i `docs/incidents/YYYY-MM-DD-fas8-rollback.md`.

## Rule check (denna runbook)

- **#26**: Alla SQL-kommandon är exakt-läst från arkitektur-doc + state-machine
- **#27**: Bara rollback-instruktioner, ingen ny logik
- **#28**: SSOT är platform_settings.escrow_mode + bookings.escrow_state — alla rollback-vägar respekterar det
- **#29**: Arkitektur-doc §10 "Rollback Plan" läst i sin helhet
- **#30**: Inga lag-/Stripe-spec-tolkningar — bara teknisk rollback-procedur
- **#31**: Alla SQL-queries verifierade mot prod-schema (escrow_state, escrow_events, disputes etc)
