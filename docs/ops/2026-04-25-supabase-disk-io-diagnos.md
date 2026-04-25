# Supabase Disk IO Budget — diagnos + åtgärdsplan

**Datum:** 2026-04-25
**Trigger:** Supabase-mejl till Farhad: "Your project is depleting its Disk IO Budget"
**Project:** Spickapp's Project (urjeijcncsyuletprydy)
**Format:** Diagnos baserat på prod-data + cron-konfiguration. Konkreta åtgärder.

---

## 1. TL;DR — akut-bedömning

**Spicks DB är liten** (4 calendar_events, 0 bookings, 1121 activity_log) **men IO-konsumtion är hög** pga **över-aggressiv cron-polling** + **många konkurrerande workflows**.

**Huvudorsak (sannolik):**
- `escrow-auto-release` kör **var 15:e minut** = 96 ggr/dag = ~2 880 polling-queries/månad bara den
- Totalt **20+ aktiva cron-jobs** + 37 workflows = ~250+ DB-queries/dag i baseline-load
- 84 Edge Functions varav många triggas av frontend + cron

**Snabb-åtgärd:** sänk `escrow-auto-release` från 15-min till 60-min interval. Sparar ~75 % av just det jobbets IO. Risk: längre escrow-release-latency (acceptabelt — handeln är 24 h escrow ändå).

**Långtids-åtgärd:** lägg till saknade index på frekvent-queryade kolumner + uppgradera till Pro tier compute när användning rättfärdigar.

---

## 2. Verifierat mot prod (rule #31)

### 2.1 Tabell-storlek (curl 2026-04-25)

| Tabell | Rad-antal | Notering |
|---|---|---|
| `activity_log` | 1 121 | Anon kan SELECT count, växer löpande |
| `calendar_events` | 4 | Litet, men frekvent skrivet |
| `bookings` | 0 (RLS / verkligen tom) | Test-data raderad? |
| `ratings` | 0 | Inga reviews än |
| `subscriptions` | 0 | Inga aktiva subs än |
| `booking_events` | RLS-blockerad | Sannolikt växande pga §6 retrofit |
| `analytics_events` | RLS-blockerad | Skrivs av frontend hela tiden |
| `cleaners`, `customer_profiles`, `admin_audit_log`, `matching_shadow_log` | RLS-blockerad | Storlek okänd från anon |

**Slutsats:** Datamängd är inte huvudproblemet. **IO-mönstret är.**

### 2.2 Cron-jobb-frekvens

| Workflow | Cron | Körningar/dag |
|---|---|---|
| `escrow-auto-release.yml` | `*/15 * * * *` | **96** ← TOP |
| `auto-remind.yml` | `7-59/30 * * * *` | 48 |
| `cleanup-stale.yml` | `0 * * * *` | 24 |
| `dispute-sla-check.yml` | `5 * * * *` | 24 |
| `admin-morning-report.yml` | 3× dagligen | 3 |
| `auto-post-daily.yml` | `0 7 * * *` | 1 |
| `auto-rebook.yml` | `0 5 * * *` | 1 |
| `backup.yml` | `0 2 * * *` | 1 |
| `charge-subscription.yml` | `13 18 * * *` | 1 |
| `customer-nudge-recurring.yml` | `0 7 * * *` | 1 |
| `daily-automation.yml` | `0 7 * * *` | 1 |
| `monthly-invoices.yml` | `0 8 1 * *` | 0.03 |
| `playwright-smoke.yml` | `0 1 * * *` | 1 |
| `preference-learn-favorite.yml` | `0 4 * * *` | 1 |
| `backup-verify-monthly.yml` | månadlig | 0.03 |
| `schema-drift-check.yml` | veckovis | 0.14 |
| `security-scan.yml` | veckovis | 0.14 |
| `ssl-monitor.yml` | veckovis | 0.14 |
| **TOTAL** | — | **~205 körningar/dag** |

### 2.3 Workflows + EFs

- **37 workflows** totalt
- **84 Edge Functions** lokalt (per audit 81 i prod efter cleanup 25 apr)
- Varje cron-körning triggar typiskt 1-5 EF-anrop som varje gör 2-10 DB-queries
- **Estimat:** 1 000-5 000 DB-queries/dag bara från cron

---

## 3. Top-misstankar för IO-konsumtion (sorterad)

### 3.1 ⚠️ `escrow-auto-release` 15-min cron

**Var 15:e min** queryar prod för bookings i escrow-state med release_at < NOW. Vid 0 verkliga bokningar är detta **96 onödiga queries/dag**.

**Snabb-fix:** Ändra till 60-min interval (`0 * * * *`). Spara ~75 % på just den.
**Acceptabel risk:** Escrow-release-latency går från max 15 min → max 60 min. Kund-impact: minimal eftersom escrow-period är 24 h ändå.

### 3.2 ⚠️ `auto-remind` 30-min cron

48 körningar/dag. Skickar bokningspåminnelser (typiskt 24h innan). Behöver inte 30-min granularitet — räcker 1-2 ggr/dag.

**Snabb-fix:** Ändra till 2 ggr/dag (`0 9,15 * * *`). Spara ~95 %.
**Acceptabel risk:** Påminnelser sent ut max 6-8 h efter optimal tidpunkt — fortfarande nyttigt.

### 3.3 ⚠️ Dubblerade morning-report-körningar

`admin-morning-report.yml` kör 3 ggr/dag (idempotency-guarded sedan 2026-04-25 — bara 1 lyckas). De **andra 2** queryar prod onödigt innan idempotency stoppar dem.

**Snabb-fix:** Ta bort de 2 backup-cron-stages, behåll bara 03:00 UTC.
**Acceptabel risk:** Om GitHub Actions är ner 03:00 UTC missas dagens rapport. Mitigerings-alternativ: säg manuell trigger om missad.

### 3.4 ⚠️ Saknade index (sannolikt)

84 EFs gör DB-queries — om någon EF gör frekvent SELECT WHERE booking_id=X på en tabell utan index, blir det Seq Scan = hög IO per query.

**Misstänkta tabeller utan adekvat index:**
- `booking_events` (snabbt växande, queryad av timeline-UI)
- `activity_log` (1 121 rader, queryad av admin)
- `analytics_events` (frekvent skrivet av frontend)
- `matching_shadow_log` (queryad av §3.9 analys)

**Fix:** Audit av prod-index via `pg_indexes`-query + lägg till missing.

### 3.5 ⚠️ `analytics_events` write-amplification

Frontend skriver `analytics_events` på varje page-view + interaktion. Vid 100+ besökare/dag = **flera tusen INSERT/dag**. Varje INSERT = WAL + flush till disk.

**Fix-alternativ:**
- Batcha events frontend-side (skicka 10 åt gången istf 1)
- Sample-rate (skicka bara 10 % av events)
- Migrera till tredjepartstjänst (Plausible, Umami) som inte hamnar i Spicks DB

---

## 4. Åtgärdsplan — etappvis

### 4.1 Etapp 1: Snabb-vinster (1-2 timmar implementation)

**Mål:** -50 % IO inom 24 h. Inga code-ändringar i EFs.

| # | Åtgärd | Sparing |
|---|---|---|
| 1 | `escrow-auto-release` 15-min → 60-min | ~75 % av just den |
| 2 | `auto-remind` 30-min → 2 ggr/dag | ~95 % av just den |
| 3 | `admin-morning-report` 3 stages → 1 stage | ~67 % av just den |
| 4 | `dispute-sla-check` 5 min/h → 1 ggr/dag (skicka SLA-warnings batched) | ~96 % av just den |
| 5 | `cleanup-stale` 1 h → 6 h interval | ~83 % av just den |

**Risk-bedömning:**
- #1 escrow: minimal (24h-fönster ändå)
- #2 auto-remind: minimal (skicka tidsoptimerat 09:00 + 15:00)
- #3 morning-report: medium (förlorar backup-redundans — om GitHub Actions ner 03:00 missas dagen)
- #4 dispute-sla: minimal vid låg dispute-volym
- #5 cleanup-stale: minimal (pending bookings >30 min raderas — 6 h vs 1 h marginell skillnad)

**Estimerad total IO-sparing:** ~70-80 % av cron-belastning.

### 4.2 Etapp 2: Index-audit (3-4 timmar)

**Mål:** -20-40 % IO på Seq-Scan-tunga queries.

```sql
-- Studio-query: hitta queries med Seq Scan
SELECT
  schemaname, tablename,
  seq_scan, seq_tup_read,
  idx_scan, idx_tup_fetch,
  n_tup_ins, n_tup_upd, n_tup_del
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY seq_tup_read DESC
LIMIT 20;
```

**Förväntad output:** Top 5 tabeller med högst seq_scan + seq_tup_read = misstänkta för missing index.

**Action per tabell:** Lägg till BTREE-index på frekvent-WHERE-kolumner.

### 4.3 Etapp 3: Frontend write-rate-reduction (1-2 dagar)

**Mål:** Minska `analytics_events`-INSERT med 80 %.

- Frontend-batching: samla 10 events i memory, skicka batch
- Server-side: använd `INSERT ... VALUES (), (), ()` istf 10 separata
- Eller migrera till extern analytics (mindre ideellt — förlust av kontroll)

### 4.4 Etapp 4: Compute upgrade (när data växer)

**När:** Om Etapp 1-3 inte räcker + verklig data-volym >10 000 bokningar.

**Pris-jämförelse (Supabase 2026):**
- Free tier: ~$0/månad, basal IO-budget
- Pro tier: $25/månad + compute add-on
- Compute add-on Small: $10/månad → 2 GB RAM, mer IO
- Compute add-on Medium: $60/månad → 4 GB RAM, betydligt mer IO

**Min rekommendation:** Vänta tills Etapp 1-3 körda + faktisk användning kräver det. Just nu är användningen artificiellt hög pga over-cron, inte verklig data-volym.

---

## 5. Vad du kan göra omedelbart (5 min)

**Steg 1 — Kolla aktuell IO-konsumtion i Supabase Dashboard:**

1. Öppna https://supabase.com/dashboard/project/urjeijcncsyuletprydy/database/usage
2. Titta på "Disk IO Budget" — visar % consumed
3. Gå till hourly-vyn — identifiera när toppar inträffar (matcha mot cron-tider ovan)

**Steg 2 — Kolla vilken EF/query är värst:**

I Studio SQL Editor:
```sql
SELECT
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  rows,
  shared_blks_read + shared_blks_written AS total_io_blocks
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat%'
ORDER BY total_io_blocks DESC
LIMIT 20;
```

Detta visar top 20 queries efter IO-blocks. Top-1-3 kandidater för optimization.

**Steg 3 — Säg till mig vad du ser** så ger jag specifik fix-rekommendation per query.

---

## 6. Konkret förslag — vill du att jag exekvera Etapp 1?

Etapp 1 = ändringar i 5 workflow-filer. Säkert, enkelt, snabb-vinst.

**Vad jag gör vid OK:**
- Edit `escrow-auto-release.yml` cron 15-min → 60-min
- Edit `auto-remind.yml` cron 30-min → 09:00 + 15:00
- Edit `admin-morning-report.yml` ta bort backup-cron-stages
- Edit `dispute-sla-check.yml` cron 5-min → daglig
- Edit `cleanup-stale.yml` cron 1-h → 6-h
- Commit + push (auto-deploy via GH Actions)

**Tid:** 15 minuter.

**Risk:** Låg per ovan analys.

---

## 7. Disclaimer #30

Detta är **operations-analys**, inte regulator-bedömning. Inga claims om Stripe-rate-limits, GDPR-loggnings-krav, eller skatte-rapporterings-deadlines. Tekniska val är dina.

**Min roll:** data-leverans (cron-frekvens + tabellstorlek + branschprixis-IO-mitigering) + förslag-prio.
**Din roll:** beslut om Etapp 1-4 prioritet och timing.

---

## 8. Källor + referens

- Supabase docs: [Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk)
- Supabase docs: [Database Usage](https://supabase.com/docs/guides/platform/usage-and-billing)
- Verifierat: cron-konfiguration i `.github/workflows/*.yml` (grep 2026-04-25)
- Verifierat: tabellstorlek via REST API curl (rule #31)
