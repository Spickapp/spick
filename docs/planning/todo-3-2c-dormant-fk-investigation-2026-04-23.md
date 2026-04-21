# TODO: §3.2c DORMANT-FK-utredning

**Upptäckt:** 2026-04-23 kväll
**Trigger:** Primärkälla-verifiering i Supabase Studio under §3.2c-deploy
**Status:** §3.2c BLOCKERAD, kräver egen sprint innan DROP kan köras

## Datat som blockerar

| FK-kolumn | Non-null rader | Intervall |
|---|---|---|
| `bookings.portal_job_id` | 22 | 2026-04-03 → 2026-04-19 |
| `notifications.job_id` | 39 | 2026-04-03 → 2026-04-19 |
| `ratings.job_id` | 0 | — |
| `customer_selections.job_id` | 0 | — |

Rowcounts DORMANT-tabeller:

| Tabell | Rader |
|---|---|
| `jobs` | 39 |
| `job_matches` | 39 |
| `cleaner_job_types` | 0 |
| `customer_selections` | 0 |

## Varför designdokumentets antagande var fel

Designdokumentet `docs/architecture/matching-algorithm.md` §12 sa "0 kod-callers efter full grep". Grep fångade applikationskod, men missade:

1. **Database triggers** som skriver till `jobs` från `bookings` INSERT
2. **Edge Functions** som potentiellt skapar jobs-rader som sidoeffekt av booking-create
3. **Historisk migration-logik** som kan skrivas från `bookings.portal_job_id`

Samtidighet mellan bookings-datum och notifications-datum (båda 3 april - 19 april) är stark indikation på att automatik skapar parallella rader.

## Hypoteser att verifiera

**H1 — Trigger på bookings:** `bookings` INSERT → trigger → INSERT INTO jobs + INSERT INTO notifications. Troligast.
**H2 — Booking-create EF:** `supabase/functions/booking-create/index.ts` skriver till jobs som sidoeffekt.
**H3 — Auto-delegation-skapar jobs:** När auto-delegation aktiveras (16 apr live, ger "nyaste 19 apr" ±) skapas jobs-rad.
**H4 — Legacy "portal"-koncept:** `portal_job_id` indikerar en tidigare arkitektur med separat portal-system som fortfarande aktiv.

## Utredningsfrågor

1. Vilken kod skriver till `jobs`-tabellen? Grep `INSERT INTO jobs` + trigger-definitioner.
2. Varför har alla bokningar efter 3 april (22 st) portal_job_id medan äldre (flera hundra) inte har det? Är det ett cutoff-datum som korrelerar med någon deploy?
3. Är `jobs` faktiskt dormant, eller är den dold produktionsdata som vi missuppfattat?
4. Vilken kod använder `bookings.portal_job_id` eller `notifications.job_id` för read-operationer? Om 0 kod läser — kolumnen är write-only "skuggdata".

## Rekommenderad sprint-uppdelning

**Fas 1 — Utredning (1-2h):**
- `grep INSERT INTO jobs` i hela repot
- Lista alla triggers via `SELECT * FROM information_schema.triggers` i Studio
- Identifiera vad som faktiskt skapar jobs-rader
- Dokumentera om portal_job_id och notifications.job_id har LÄS-callers

**Fas 2 — Beslut (0.5h):**
- Om automatik skapar dessa rader utan att läsa dem → stoppa automatiken först, sedan drop
- Om någon läser dem → reingenjör läsaren mot bookings direkt, sedan drop
- Om legacy portal-system → migrationsplan + deprecation-datum

**Fas 3 — Exekvering (1-2h):**
- Stäng av automatik som skriver till jobs
- Migrera befintlig data (om nödvändigt) till bookings eller annan tabell
- DROP TABLE med DROP CONSTRAINT först eller CASCADE

**Totalt estimat:** 2.5-4.5h, betydligt mer än designdokumentets antagande om "tillägg i §3.2a-migration".

## Koppling till hygien-task #48 (migrations-deploy-audit)

Båda upptäckterna avslöjar att vi har blinda fläckar i vår infrastructure-förståelse:

- Hygien #48: vi vet inte hur migrations faktiskt applicerats (schema_migrations-registret är tomt)
- Denna utredning: vi vet inte vilken kod som skriver till jobs (grep hittar inte automatiken)

Dessa bör utredas tillsammans i en dedicerad "infrastructure audit"-sprint.

## Status just nu

- `§3.2c är BLOCKERAD.`
- `§3.2a` ✓ klart (commit 6bbd1a4, manuell deploy verifierad)
- `§3.2b` ✓ klart (commit afdcfa4, verifierat i prod Network-flik)
- `§3.2d` ✓ klart (commit 9281d4c, EF undeployad)

§3.2 är **partiellt stängd**. Fas 3 kan fortsätta med §3.3-3.9 utan att §3.2c är löst, eftersom DORMANT-tabellerna inte blockerar ny utveckling.

## Referenser

- Designdokument: `docs/architecture/matching-algorithm.md` §12
- Commit där §3.2c var planerad: Skulle vara separat från §3.2a (6bbd1a4)
- Session där upptäckten gjordes: 2026-04-23 kvällssession (denna commit)
- Relaterad hygien-task: #48 migrations-deploy-audit
