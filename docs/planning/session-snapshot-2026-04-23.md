# Session snapshot 2026-04-23

**Session-typ:** Heldagspass (~13h aktiv tid, 10:00-23:45).
**HEAD vid snapshot:** (denna commit)
**Tema:** Avtalsportfölj-revidering + Fas 3 §3.2-sviten (partiellt).

---

## Dagens leveranser (10 commits)

| Tid | Commit | Scope |
|---|---|---|
| 10-14 | `bea634b` | docs(legal): juristunderlag avtalsrevidering v2026.04.23 |
| 14-16 | (plattformsdirektiv-supplement) | docs(legal): SOU 2026:3-analys |
| 16 | `ad338f4` | docs(legal): arkivera tidigare juristunderlag |
| 17-19 | `2ea4511` | legal: avtalsrevidering v2026.04.23 LIVE i prod (3 HTML-filer) |
| 20-21 | `6bbd1a4` | §3.2a find_nearby_cleaners v2 multivariat ranking (deploy via Studio) |
| 21 | `da7bf74` | docs: migrations-deploy-audit TODO + §3.2a BLOCKERAD-not |
| 22 | `afdcfa4` | §3.2b boka.html skickar utökade params (verifierat i prod Network-flik) |
| 22 | `9281d4c` | §3.2d cleaner-job-match EF-radering (+ undeploy via CLI) |
| 23:45 | `b1c869b` | §3.2c BLOCKERAD + TODO-fil + dags-snapshot |
| sent kväll | `f8b91b8` | §3.7 partial — chosen_cleaner_match_score audit-writing (verifierat 0.707 i prod) |
| 01 | `d1744ca` | docs: timezone-audit-TODO + §3.7-partial-verifierad (match_score 0.707) |
| 24 apr morgon | `9be12ba` | docs: §3.5 STÄNGD + progress-fil status-sync |
| 24 apr | `13640c3` | §49 Fas 1: auto-remind timezone-fix (rad 90 + 299) |
| 24 apr | `d252586` | §49 Fas 2: formatDate × 4 EFs konsoliderade |
| 24 apr | `0da7ca9` | §49 Fas 3: auto-rebook midnatts-edge-case |
| 24 apr | `1df1398` | §49 Fas 4: timezone-convention + §49 STÄNGD |
| 24 apr | `67254d7` | §48 Fas 1 infrastructure audit DIAGNOS klar (3h) |
| 24 apr | `aa3b282` | §48 Fas 48.3: migration för DORMANT DROP + deploy-doc |
| 24 apr | `8b3e786` | §3.2c STÄNGD + §48 Fas 48.3 DEPLOY verifierad |
| 24 apr | `b98aaee` | §48 Fas 48.1-KORRIGERING: diagnos uppdaterad med verifierad primärkälla |
| 24 apr | `7f0b7a6` | §48 Fas 48.2 Del 1: rename 35 migrations-filer + uppdatera levande referenser |
| 24 apr | `ab96d3f` | §48 Fas 48.2 Del 3: Studio-INSERT-script för schema_migrations-synk (55 rader) |
| 24 apr | (denna) | §48 Fas 48.2 Del 3 DEPLOY verifierad (schema_migrations: 46 → 100 rader) |

## Status per spår

### Avtalsportfölj v2026.04.23 ✓ LIVE

`uppdragsavtal.html`, `kundvillkor.html`, `integritetspolicy.html` uppdaterade i prod med pro-Spick hållbara villkor (12% flat, RUT-avslag, försäkringsregress, fotolicens, kringgåendeklausul, force majeure, GDPR-hänvisning).

Jurist-underlag + plattformsdirektiv-supplement committade som separata MD-filer. Redo att skicka till jurist för granskning när det passar.

### Fas 3 Matching-algoritm

- §3.1 ✓ designdokument (committad 21 apr)
- §3.2a ✓ migration live i prod (Studio-deploy, verifierad)
- §3.2b ✓ boka.html skickar 9-params payload (verifierat i DevTools Network)
- §3.2c **BLOCKERAD** (se TODO)
- §3.2d ✓ cleaner-job-match EF raderad + undeployad

Fas 3 kan fortsätta med §3.3-3.9 utan att §3.2c är löst.

## Öppna infrastructure-upptäckter (kräver utredning)

**Hygien #48 — konsoliderad infrastructure audit:**

1. **schema_migrations ur sync** (upptäckt under §3.2a-deploy): prod har 1 rad, repo har 52 filer
2. **"DORMANT" jobs är aktiv data** (upptäckt under §3.2c-försök): 22 bookings + 39 notifications refererar aktivt

Båda kräver samma typ av gräv: förstå vad vår automatik faktiskt gör bakom grep-ranges. Estimat 8-15h tillsammans.

**Hygien #49 — timezone-audit:** ✓ STÄNGD 2026-04-24 (4 commits, 4h total).

- auto-remind kritisk prod-bugg fixad (rad 90 + 299 via parseStockholmTime)
- auto-rebook midnatts-edge-case fixad (4 call-sites via getStockholmDateString)
- 4 EFs med formatDate-duplikering konsoliderade (formatStockholmDate + formatStockholmDateLong, 33 call-sites)
- Konvention dokumenterad i docs/architecture/timezone-convention.md

**Hygien #48 — infrastructure audit:** Fas 48.1 DIAGNOS ✓ + Fas 48.3 DEPLOY ✓ klara 2026-04-24. Återstår Fas 48.2 (schema_migrations-repair), 48.4 (CI-härdning), 48.5 (drift-check), 48.6 (retrospektiv) — 5-10h kvar. §3.2c formellt STÄNGD (DORMANT-tabeller borta i prod).

## Start-instruktion för nästa session

Läs i ordning:
1. `docs/planning/session-snapshot-2026-04-23.md` (denna fil)
2. `docs/v3-phase1-progress.md` (full status)
3. TODO-filer för infrastructure-audit om utredning ska köras

Naturliga nästa steg:
- **§3.3** vikter till platform_settings (2-3h, feature-arbete) — fortsatt Fas 3-sprint
- **Hygien #48** infrastructure-audit (8-15h, skuld-arbete) — parallellt spår
- **Rafa-pilot go-live-checklista** — pre-pilot verifiering

Regler aktiva: #26 (fil:rad + user-flows), #27 (primärkälla-verifiering), #28 (ingen business-data-fragmentering), #29 (memory är hypoteser), #30 (verifiera regulator-ändringar), #31 (schema vinner över kod-antaganden).
