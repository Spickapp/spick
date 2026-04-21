# Session snapshot 2026-04-22

**Session-typ:** Heldag. Fas 1 100% klar + Fas 2 stängd inom v3-scope.
**HEAD vid snapshot:** `d80e591` (efter session-stängning: nästa commit)
**Test-status:** 121 pass / 0 failed / 4 ignored (alla ignored = §1.6b Väg C)

---

## Status per fas

| Fas | Status | Not |
|---|---|---|
| Fas 0 | ✓ KLAR | Pre-session |
| **Fas 1** | ✓ **100% KLAR** (9/10 + §1.2 SUPERSEDED verkställd) | Slutfört idag §1.6a/b + §1.8. |
| **Fas 2** | ✓ **STÄNGD inom v3-scope** (7 klara + 2 deferred) | §2.3 → Fas 3, §2.8 → Fas 2-utökning. |
| Fas 3 | ◯ Ej påbörjad | **Nästa naturliga steg.** v3:199, vecka 7-9, 16-24h. |
| Fas 4-13 | ◯ Ej påbörjade | Enligt v3-ordning |
| Fas 14 | ◯ Valfri | v3:589, systemic robustness polish |

---

## Idag: 17 commits (exkl. auto-backup + auto-sitemap)

I kronologisk ordning (tidigast först):

| # | Hash | § | Beskrivning |
|---:|---|---|---|
| 1 | `cf4c7f8` | plan-beslut #4 | Ta bort per_window från admin-UI |
| 2 | `1d41099` | §2.7 | Radera 19 fix-skript (plan-beslut #2) |
| 3 | `1ea3422` | §1.10 | money-layer.md sync mot nuvarande arkitektur |
| 4 | `17cc4c6` | §1.8 | default_hourly_rate centralisering + bli-stadare commission-läckage-fix |
| 5 | `07fcc70` | §1.6a | Enhetstester med Stripe-mocks (+21 tester) |
| 6 | `9c21bd6` | §1.6b | Integration-tests + GitHub Actions CI (advisory-integration-job) |
| 7 | `fbc28be` | chore | Trigger CI för STRIPE_SECRET_KEY_TEST-rotation |
| 8 | `5fcb807` | fix(ci) | Uppgradera CI till Deno 2.x |
| 9 | `837dc6a` | §2.9 | Sync ARKITEKTUR-SANNING + PRODUKTIONSDATABAS |
| 10 | `837b8c4` | §2.6 | Radera abandonerad branch `claude/wonderful-euler` |
| 11 | `93ed2de` | §2.2 | Migrera find_nearby_cleaners (prod-verifierad källa) |
| 12 | `538ad1f` | §2.3 | Deferred till Fas 3 (DORMANT-infrastruktur) |
| 13 | `da16e43` | §2.5 | Rensa sql/-mapp (6 radera, 2 arkivera) |
| 14 | `66cd053` | chore | Ignore prod-schema.sql + Claude Code local config |
| 15 | `945674f` | §2.1 | Schema drift-inventering + klassificering |
| 16 | `d80e591` | §2.4 | Fixa 3 RLS-policies-migrations mot prod-sanning |
| 17 | (denna) | close | Fas 2 stängd + session-snapshot |

Plus 2 auto-commits: `cc834cc` (Backup), `979de0a` (Auto-update sitemap).

---

## Nästa naturliga steg (v3-ordning)

### Fas 3 — Matchning med multivariat ranking

- **v3.md:199**, vecka 7-9, 16-24h
- **Startpunkt:** §3.1 design-dokument `docs/architecture/matching-algorithm.md`
- **Beroenden:** inga (Fas 1 + 2 klara)
- **9 sub-faser:** §3.1 design, §3.2 match_score-kolumn i find_nearby_cleaners, §3.3 vikter, §3.4 kund-historik-boost, §3.5 boka.html läser från ny VIEW, §3.6 materialized view om >200ms, §3.7 A/B-test-ramverk, §3.8 admin dashboard, §3.9 30d-pilot-analys

### Intressant överlapp med Fas 2-utökning

Fas 3 §3.1 design ska bestämma om DORMANT-tabellerna `jobs`, `job_matches`, `cleaner_job_types` integreras eller raderas. Om integreras naturligt under Fas 3-arbete, kan §2.1.3 (DORMANT) stängas automatiskt.

### Varför Fas 3, inte Fas 2-utökning?

Fas 2-utökning är skuld-roadmap (se nedan). Skuld ska hanteras strukturerat i GA-kandidat-fönster (Fas 13) snarare än som sidospår mellan feature-faser. **v3-disciplin: följ fas-ordning.**

---

## Fas 2-utökning (skuld-roadmap)

Skuld identifierad i §2.1-rapport (`docs/audits/2026-04-22-schema-drift-analysis.md`). Totalt 16-24h över 5-6 sub-faser:

| Sub-fas | Scope | Estimat |
|---|---|---:|
| §2.1.1 | 15 KRITISK-tabeller → CREATE TABLE migrations | 5-8h |
| §2.1.2 | 15 LEGACY → Studio COUNT + DROP-beslut | 3-5h |
| §2.1.3 | 10 DORMANT → Fas 3-integration eller DROP | 2-3h (kan falla under Fas 3) |
| §2.1.4 | 217 policies-diff | 4-6h |
| §2.1.5 | 11 views + 3 types migrations | 2h |
| §2.8 | CI schema-drift-check (efter §2.1.1 minst) | 2-3h |
| **Total** | | **16-24h** |

**Rekommendation:** hantera som Fas 7.5 eller samla under Fas 13 "GA-readiness + skalningstest" (v3:558, vecka 29, 5-10h). Fas 13 har redan relevant scope (§13.9 "GA-checklista signoff") där drift-status är naturligt krav.

---

## Öppna hygien-tasks (12 st)

Från `docs/v3-phase1-progress.md`:

1. **reconcile-payouts auto-governing** — auto-activation + auto-rollback finns i kod men inte i v3.md. Plan-sync behövs.
2. **Commit-meddelandens "Fas X.Y" vs §X.Y** — inkonsekvens. Ny konvention från 2026-04-20: använd §X.Y i framtida commits.
3. **platform_settings konsolidering** — `base_price_per_hour=399` (pricing-resolver fallback) vs `default_hourly_rate=350` (UI-default) har olika värden men semantiskt liknande. Verifiera konsolidering.
4. **admin.html commission-hardcodes** — `admin.html:1119` `value="12"` + `admin.html:3763` `: 17`. Scope-läckage från §1.9. Kan samlas i framtida §1.9c.
5. **mock-duplicering** — `createMockSb`-pattern i 7 test-filer. Överväg delad `_tests/_shared/mock-sb.ts`.
6. **cleaner_job_types odokumenterad** — tabell i prod (4 kolumner) saknar i `docs/4-PRODUKTIONSDATABAS.md`. Lägg till vid Fas 3-integration eller §2.9b.
7. **jobs-tabell saknar migration** — 27 kolumner, 39 rader i prod. Ingen CREATE TABLE. Fas 3 eller DROP.
8. **job_matches-tabell saknar migration** — 21 kolumner, 39 rader. Fas 3 kandidat (7 match-kriterier matchar §3.3-design).
9. **Admin-policies TO-uppgradering** — flera admin/owner-policies saknar `TO authenticated` (implicit `TO public`). Defense-in-depth.
10. **Duplikat-policy customer_profiles** — rad 4473 + rad 5385 har identisk logik. Konsolidera.
11. **destination-transfer-coverage** — test 4 i stripe-transfer-integration.test.ts stay-ignored tills verified Connect-konto.
12. **§2.8 CI schema-drift** — deferred till Fas 2-utökning.

---

## Öppna plan-beslut (1)

### #4 per_window-prissättning (öppnat 2026-04-22)

Fönsterputs kan prissättas per fönster. Admin-UI tillät tidigare `per_window` men pricing-resolver + boka.html hanterar inte detta — skulle gett felaktigt pris. Option borttagen i admin.html som tillfällig fix. **Beslut behövs:** bygga full per_window end-to-end (5-7 h: DB-schema + pricing-resolver + booking-create + boka.html + stadare-dashboard), eller permanent dokumentera att fönsterputs bara stöder per_hour + per_sqm?

**Väntar:** Farhad.

---

## Stängda plan-beslut (3 idag)

- **#1** boka.html scope (alt D, SAFETY_FALLBACK_RATE) — 2026-04-21
- **#3** stripe-checkout radering (alt 1) — 2026-04-21
- **#2** fix-skript-utvidgning §2.7 (Väg A, 19 radera) — 2026-04-22

---

## Kritiska session-lärdomar

### 1. v3.md driftar förbi verkligheten

v3.md har visat sig feltkonfigurerad/föråldrad **5 gånger** denna session:

| Plats | Drift |
|---|---|
| §1.2 | pekade på stripe-checkout som ska uppgraderas → **EF var dödkod, raderad istället** |
| §1.3 | pekade på stripe-connect:172 → **0 callers + bruten DB-schema, raderad** |
| §2.2 | pekade på `sql/radius-model.sql` som källa → **filen obsolet (home_coords), prod har annan version** |
| §2.3 | antog 1 view + 1 tabell → **verklighet: 0 view + 3 DORMANT-tabeller** |
| §2.4 Policy 1 | `customers`-tabell → **existerar inte, tabellen heter customer_profiles** |

**Lärdom:** Regel #27 (primärkälla-verifiering) är inte optional. Alltid grep + prod-verifiering innan bygg. Flera av dessa drifter upptäcktes först när migration-bygget kraschade eller när grep returnerade 0 träffar.

### 2. Grep-truncering har orsakat scope-läckage 5 gånger

- §1.7: stadare-dashboard.html:9182 hardcode missad pga grep-truncering
- plan-beslut #1: boka.html:2415 missad pga truncering (14 listade + 1 = 15 total)
- §1.9b: bli-stadare.html:511 commission-läckage missad, stängd §1.8
- §2.9 (docs/7): 19 🔍-flaggor kvar pga konservativ markering
- Potentiellt §2.1 med policies (217 st, bara tabeller fullt greppade)

**Regel:** ALLTID `| Measure-Object -Line` innan head_limit. Om output > 100 rader: flagga explicit + visa topp + botten. Stoppa och fråga om count inte matchar förväntat.

### 3. Prod-state-verifiering via Studio räcker för sub-fas-specifik research

Exempel: §2.2 fick prod-verifierad `find_nearby_cleaners`-definition via Studio SQL (1 query, 30 sek). Detta räckte för migration-bygge utan full pg_dump.

Men för §2.1-scope (hela schemat) krävdes full `pg_dump --schema-only` (200 KB). Det gav 41 saknade tabeller, 17 saknade functions, 17 migrations utan prod.

**Regel:** matcha verktyget till scopet. Studio SQL för specifikt objekt. pg_dump för bred inventering.

### 4. Session-notes utanför git driver åt fel håll

Tidigare session använde ad-hoc "session X.Y.Z"-numrering utanför versionshantering. Denna session har progress-fil (`docs/v3-phase1-progress.md`) som strukturell lösning — varje commit kan mappas direkt till §-nummer och status.

**Regel:** progress-fil i repo är sanningen. Nästa session ska starta med att läsa den, inte fråga Farhad "var är vi?".

---

## Infrastruktur-tillgång (verifierad 2026-04-22)

- ✓ **Docker Desktop** installerad + körs (behövs bara för lokal Supabase; inte för tester)
- ✓ **Supabase CLI** (v2.90.0) länkad mot projekt `urjeijcncsyuletprydy`
- ✓ **Deno** 2.7.12 lokalt (matchar CI efter §1.6b fix(ci))
- ✓ **prod-schema.sql** lokalt (gitignored, 200KB, 72 tables, dumped 22 apr)
- ✓ **Studio SQL Editor** tillgänglig via Supabase Dashboard för ad-hoc queries
- ✓ **GitHub Actions CI** aktiverad (`test-money.yml` 2-job-struktur)
- ✓ **GitHub Secrets** konfigurerade (`STRIPE_SECRET_KEY_TEST`, `STRIPE_WEBHOOK_SECRET_TEST`)
- ❌ **`STRIPE_TEST_CONNECT_ACCOUNT_ID`** saknas (Väg C, test 4 stay-ignored)

---

## Start-instruktion för nästa session

```
Läs i ordning:
  1. docs/v3-phase1-progress.md (full status + hygien-tasks + plan-beslut)
  2. docs/planning/session-snapshot-2026-04-22.md (denna fil)
  3. docs/audits/2026-04-22-schema-drift-analysis.md (Fas 2-skuld-karta)

Bekräfta status innan förslag. Fas 1 + 2 klara.
Förvänta Fas 3 §3.1 matching-algorithm design-dokument som nästa steg.

Om Farhad föreslår Fas 2-utökning istället:
  - Verifiera prioritet mot affärsvärde (Fas 3 blockerar Rafa-pilot-skalning)
  - Stämma av med rekommendation i session-snapshot
  - Inget fel att gå Fas 2-utökning om Farhad vill det

Om Farhad föreslår något utanför v3-ordningen:
  - Fråga kort "varför nu, inte i v3-ordning?" innan bygg
  - Session-lärdom: v3 driftar förbi verkligheten, men disciplinen håller 
    oss i spår mot GA-kandidat 1 nov 2026
```

---

## Sammanfattning session

- **17 Claude-commits** (+ 2 auto: backup, sitemap)
- **Fas 1:** 100% klar (§1.1-§1.10 + §2.7 relaterat)
- **Fas 2:** 7 klara + 2 deferred = stängd inom v3-scope
- **Fas 2-utökning:** schedulerad (16-24h skuld-roadmap)
- **12 öppna hygien-tasks** (5 nya idag)
- **1 öppet plan-beslut** (#4 per_window)
- **Ny audit:** `docs/audits/2026-04-22-schema-drift-analysis.md` (347 rader)
- **Ny arkiv:** `docs/archive/sql-legacy/` (README + 2 SQL-filer)
- **sql/** mappen: **borta** (auto-raderad av git efter §2.5)
- **Tester:** 121 pass (oförändrat, alla ändringar i docs + config)
