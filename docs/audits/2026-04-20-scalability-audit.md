# Skalbarhetsaudit — 20 april 2026

**Syfte:** Identifiera exakt vad i Spick-kodbasen som kräver manuell intervention, är hårdkodat, eller skulle kollapsa vid 10x trafik. Primärkälla för arkitekturplan v3.

**Metod:** Regel #26 + #27 + #29 — grep + fil:rad-citat, ingen kod ändrad. Primärkälla är koden i repo, inte memory eller CLAUDE.md.

**Scope-not:** `.claude/worktrees/wonderful-euler/` är en Claude-worktree som duplicerar hela repot och ingår **inte** i tal/rader nedan (exkluderats manuellt från grep-resultat).

---

## Executive Summary

Spick har byggt produktmognad (66 Edge Functions, 89 migrations, 34 GitHub Actions workflows) men **tre kritiska skalningsflaskhalsar**:

1. **Utbetalningsflödet är fake + provision-fragmentering.** [admin.html:4478-4502](admin.html:4478) `markPaid()` PATCH:ar bara `payout_status='paid'` utan att anropa Stripe. [stripe-checkout/index.ts:88](supabase/functions/stripe-checkout/index.ts:88) hardcodar `0.12`/`0.17` istället för att läsa `platform_settings.commission_standard`. [stripe-connect/index.ts:172](supabase/functions/stripe-connect/index.ts:172) hardcodar `0.83`. [js/commission.js:15-18](js/commission.js:15) definierar en Smart Trappstege (17→12%) som **ingenstans** påverkar faktiska payouts.
2. **Ingen dispute/escrow-infrastruktur.** 0 Edge Functions för komplaint. 0 tabeller för escrow/attested work. Alla refund-beslut är ad-hoc i [admin.html](admin.html) + manuella e-post till `hello@spick.se`.
3. **Matchning saknar ranking.** [sql/radius-model.sql:68](sql/radius-model.sql:68) sorterar bara på `distance_km ASC, avg_rating DESC NULLS LAST`. Ingen viktning, inget match_score, ingen hänsyn till `completed_jobs`, `pet_pref`, `elevator_pref`, historisk acceptans-rate eller pris. Vid 100 städare i radius blir kundens val nästan slumpartat bland topp-10.

**Skalningstak utan fix: ~50 aktiva städare.** Över det blir manuell payout-markering, hardcoded service-listor i 50 filer, och saknad dispute-process kritiska blockerare.

---

## Sektion 1 — Hardcoded Service-Listor

### Fynd

Grep på `Hemstädning|Storstädning|Flyttstädning|Fönsterputs|Kontorsstädning|Trappstädning|Byggstädning` i `*.html,*.ts,*.js` (worktree exkluderad):

**Totalt: ~420 träffar i ~100 unika filer.**

Topp 10 filer efter antal träffar:
| Fil | Träffar | Typ |
|---|---|---|
| [boka.html](boka.html) | 40 | Bokningsflöde |
| [stadare-dashboard.html](stadare-dashboard.html) | 34 | Städar-dashboard |
| [fix-b2b-services.js](fix-b2b-services.js) | 26 | Engångsscript (död kod?) |
| [admin.html](admin.html) | 15 | Admin-panel |
| [tjanster.html](tjanster.html) | 14 | Tjänstesidan |
| [foretag.html](foretag.html) | 12 | B2B-landing |
| [fix-multiservice.js](fix-multiservice.js) | 12 | Engångsscript |
| [index.html](index.html) | 12 | Hemsida |
| [js/i18n-bli-stadare.js](js/i18n-bli-stadare.js) | 12 | i18n |
| [priser.html](priser.html) | 11 | Prislista |
| [blogg/rut-avdrag-guide.html](blogg/rut-avdrag-guide.html) | 10 | SEO-artikel |

Plus ~20 stads-landningssidor (stockholm, goteborg, malmo, uppsala, linkoping, lund, orebro, helsingborg, norrkoping, jonkoping, vasteras, umea, gavle, huddinge, nacka, taby, solna, sundbyberg, sodertälje, eskilstuna, karlstad, sundsvall, halmstad, ostersund, boras) med 2-4 träffar var.

### Vad som ÄR centraliserat

- [services-table](supabase/migrations/20260419_f1_dag2c1_service_ui_config.sql) — DB-tabell `services` + `service_addons` finns (Fas 1 Dag 2C).
- [services-list](supabase/functions/services-list/index.ts) — Edge Function läser från DB.
- [js/services-loader.js](js/services-loader.js) — renderer (Fas 1 Dag 2B).
- [boka.html](boka.html) använder `services-loader.js` redan (commit `69571aa`).

### Risk-bedömning

För att lägga till "Premiumstädning" med full täckning idag behövs:
- **~50 unika HTML-filer** måste editeras (tjanster.html, priser.html, boka.html delvis redan DB-driven men har fallback-strings, 20+ stads-sidor, 8-10 blogg-artiklar, B2B-sidor).
- **~10 JS-filer** (i18n-bli-stadare.js, services-loader.js, fix-*-scripts om de ska uppdateras).
- **~5-10 Edge Functions** (auto-remind, generate-receipt, notify etc. har service-type-refererande strings för e-postmallar och prisberäkningar).
- **Estimat:** 8-16h för fullständig utrullning.

### Skalningspåverkan

Vid 100 företag med unika tjänster (B2B-vertikaler: kliniker, äldreboenden, byggstädning, fordonsstädning etc.):
- `services`-tabellen är redan JSONB-utformad (`ui_config`-kolumn för emoji/beskrivning) → DB-nivå skalar.
- **Men:** hardcoded strings i 50+ HTML-filer betyder att **varje ny tjänst kräver tiotals fil-editor** för SEO-texter, stads-sidor, blogg-länkar.
- **Brytpunkt:** ~5 nya tjänster — efter det blir manuell koordinering mellan DB + statiska sidor ohållbar.

---

## Sektion 2 — Pricing-fragmentering

### Fynd

**Primärkälla enligt [_shared/pricing-resolver.ts:1-13](supabase/functions/_shared/pricing-resolver.ts:1):**
> Commission läses ALLTID från `platform_settings.commission_standard`. Pris löses i 5-stegs hierarki: company_service_prices → cleaner_service_prices → company fallback → hourly_rate → platform_settings.base_price_per_hour (default 399).

**Verklighet:** 6 konkurrerande sanningar.

| Plats | Vad står där | Fil:rad |
|---|---|---|
| `platform_settings.commission_standard` | 12% (single source per memory) | DB |
| [_shared/pricing-resolver.ts:52](supabase/functions/_shared/pricing-resolver.ts:52) | Läser platform_settings, fallback 12% | ✅ korrekt |
| [stripe-checkout/index.ts:88](supabase/functions/stripe-checkout/index.ts:88) | **Hardcoded: `company_id ? 0.12 : (customer_type==="foretag" ? 0.12 : 0.17)`** | 🔴 läser INTE platform_settings |
| [stripe-checkout/index.ts:115](supabase/functions/stripe-checkout/index.ts:115) | `let basePrice = 349;` (fallback) | 🟡 hardcoded hourly |
| [stripe-connect/index.ts:172](supabase/functions/stripe-connect/index.ts:172) | `Math.round(totalKr * 0.83)` (cleaner share) | 🔴 hardcoded 17% |
| [js/commission.js:15-18](js/commission.js:15) | Smart Trappstege: 17/15/13/12% baserat på completed_jobs | 🔴 display-only, påverkar INTE payout |
| [bli-stadare.html:511](bli-stadare.html:511) | `const commission = 0.17;` | 🔴 hardcoded |
| [faktura.html:121,205](faktura.html:121) | `b.commission_pct \|\| 17` (fallback) | 🟡 17 som fallback |
| [admin.html:1118](admin.html:1118) | UI default `value="12"` | 🟡 12 |
| [admin.html:3762](admin.html:3762) | UI fallback `17` | 🔴 17 |
| [admin.html:2808](admin.html:2808) | Beräkning fallback `(b.commission_pct\|\|17)/100` | 🟡 17 |
| [admin.html:3749](admin.html:3749) | Mapping `new:17%, established:15%, professional:13%, elite:12%` | 🔴 Trappstege igen |
| [marknadsanalys.html:969-970](marknadsanalys.html:969) | `* 0.83` och `* 0.17` | 🟡 simulering |
| [admin.html:2861,2879,2908](admin.html:2861) | Hardcoded hourly `349` | 🔴 |
| [admin.html:3700,3948](admin.html:3700) | Hardcoded hourly `350` | 🔴 |
| [join-team.html:127](join-team.html:127) | Hardcoded hourly `350` | 🔴 |
| [cleaners.commission_rate](supabase/migrations) | Per-städare kolumn (mixed format: 0.12 eller 12) | 🟡 ignoreras per memory |

I [supabase/functions](supabase/functions): **123 träffar på `hourly_rate\|service_price\|commission_\|rut_\|price_per\|hourlyRate` i 21 filer** (ej _shared).

### Risk-bedömning

**Om RUT-procenten ändras (50%→60%):**
Grep `rut_|rut_percent|RUT.*50|0\.5.*rut` ger träffar i:
- [rut-claim/index.ts](supabase/functions/rut-claim/index.ts) — 11 träffar
- [generate-self-invoice/index.ts](supabase/functions/generate-self-invoice/index.ts) — 10 träffar
- [booking-create/index.ts](supabase/functions/booking-create/index.ts) — 15 träffar (service_type-relaterat)
- [stripe-checkout/index.ts](supabase/functions/stripe-checkout/index.ts) — 10 träffar
- [notify/index.ts](supabase/functions/notify/index.ts) — 5 träffar
- Frontend: faktura.html, min-bokning.html, tack.html, admin.html

**Estimat:** 3-4h för RUT-procent-ändring via platform_settings (om fragmentering fixas först) eller **15-25h ad-hoc** idag.

**Om provisionen ändras (t.ex. flytta till 15% flat):**
- Kräver ändring i ~10 filer (frontend + payout EF + UI labels).
- Platform_settings-värdet skulle tyst överskridas i payout-flödet (stripe-connect:172) utan att någon märker det.

### Skalningspåverkan

**Brytpunkt idag:** Varje pricing-policy-ändring kräver manuell koordinering mellan 14+ filer. Detta blir ohållbart vid:
- 10+ företag med `use_company_pricing=true` (olika priser per företag per tjänst)
- Införande av Smart Trappstege i payout-logiken (redan definierad i js/commission.js men inte aktiv)
- Regionalt differentierad prissättning (Stockholm vs Kiruna)

**Kritiskt:** `stripe-checkout:88` hardcoded commission är en regression — när Smart Trappstege eller per-cleaner commission ska aktiveras kommer checkout tyst fel-beräkna tills någon upptäcker det. **Regel #28-brott i produktionsnivå.**

---

## Sektion 3 — Manuell Stripe Connect-onboarding

### Fynd

**Onboarding-flödet ÄR auto (motsäger initial hypotes):**
| Steg | Komponent | Auto/Manuell |
|---|---|---|
| 1. Skapa Stripe Express-konto | [stripe-connect/index.ts:98](supabase/functions/stripe-connect/index.ts:98) action `onboard_cleaner` | ✅ Auto |
| 2. Städaren fyller i Stripe-formulär | Extern (Stripe-hostad) | ✅ Auto (via Stripe) |
| 3. Status sätts till `complete` vid `account.updated` | [stripe-connect-webhook/index.ts:52](supabase/functions/stripe-connect-webhook/index.ts:52) | ✅ Auto |
| 4. Safety-net om webhook missas | [poll-stripe-onboarding-status/index.ts](supabase/functions/poll-stripe-onboarding-status/index.ts) — cron var 30 min | ✅ Auto |
| 5. Refresh-länk om onboarding inte slutförs | [stripe-connect/index.ts:235](supabase/functions/stripe-connect/index.ts:235) `refresh_account_link` | ✅ Auto |
| 6. Company-synk vid VD-onboarding-complete | [poll-stripe-onboarding-status/index.ts:151-160](supabase/functions/poll-stripe-onboarding-status/index.ts:151) | ✅ Auto |

**Slutsats Fas 1-vis:** Onboarding-flödet är **redan skalbart** för 1000+ städare. Hypotesen i v3 "manuell Stripe Connect-onboarding" stämmer INTE.

### Faktisk flaskhals: Payout-flödet

**Kritiskt fynd:** [admin.html:4478-4502](admin.html:4478) `markPaid()` är den enda aktiva payout-vägen:

```js
// admin.html:4485-4493
var res = await fetch(SPICK.SUPA_URL + '/rest/v1/bookings?cleaner_id=eq.' + cleanerId + '&payment_status=eq.paid&payout_status=is.null&booking_date=gte.' + monthStart, {
  method: 'PATCH',
  headers: { ... },
  body: JSON.stringify({ payout_status: 'paid', payout_date: now })
});
```

**Den rör INTE Stripe.** Admin klickar en knapp → PATCH direkt mot `bookings.payout_status`. Ingen transfer, ingen verifiering, ingen idempotency.

Grep `payout_cleaner\|action.*payout` i hela repot → **1 träff** (definitionen i stripe-connect/index.ts:142). INGEN kallar den. Ingen cron. Ingen webhook. Ingen frontend.

### Hur pengarna faktiskt rör sig

[stripe-checkout/index.ts:100-105](supabase/functions/stripe-checkout/index.ts:100) sätter `destinationAccountId` på Checkout-sessionen → Stripe gör **direct transfer** vid kund-betalning (Stripe Connect direct charges). Pengarna går direkt till städarens Stripe-konto, minus `application_fee` (Spicks provision).

**Då funkar det utan `payout_cleaner`?** Ja — men:
- `admin.html:markPaid` är då bara bokförings-markering (manuell)
- Ingen idempotency-check: admin kan av misstag markera 2x
- Ingen reconciliation mellan Stripe Transfer events och `bookings.payout_status`
- `stripe-connect/payout_cleaner` är **död kod** (men ser verklig ut → risk: någon använder den fel → dubbel-transfer)
- `commission_rate` i stripe-checkout (0.12/0.17) måste stämma med Stripe Connect fees — en drift upptäcks bara manuellt

### Skalningspåverkan

**Skalar till:** ~200 städare. Därefter:
- Admin hinner inte klicka markPaid manuellt varje vecka
- Reconciliation-fel blir svåra att hitta retroaktivt
- Commission-drift (admin har satt 15% på cleaner men stripe-checkout hardcodar 17%) upptäcks först vid klagomål

---

## Sektion 4 — Dispute / Escrow-hantering

### Fynd

**Edge Functions med dispute/escrow/complaint/attest i namn:** 0.

**Refund-relaterade EFs:**
- [noshow-refund](supabase/functions/noshow-refund) — automatisk återbetalning vid no-show
- [stripe-refund](supabase/functions/stripe-refund) — manuell Stripe refund

**Dispute-referenser i kod:**
- [stripe-webhook/index.ts](supabase/functions/stripe-webhook/index.ts) — 22 träffar på `dispute` (hanterar Stripe chargeback-events)
- [stadare-dashboard.html](stadare-dashboard.html) — 25 träffar (mest "kontakta hello@spick.se vid tvist")
- [admin.html](admin.html) — 8 träffar
- [20260331000001_admin_portal.sql](supabase/migrations/20260331000001_admin_portal.sql) — 3 träffar
- [20260326000004_security_tables.sql](supabase/migrations/20260326000004_security_tables.sql) — 1 träff

**Inga tabeller:** `disputes`, `complaints`, `escrow_holds`, `attested_jobs`, `job_attestations` finns inte i några migrations (grep `CREATE TABLE.*dispute\|complaint\|escrow\|attest` → 0 träffar).

### Hur hanteras kund-klagomål idag

**Grep `hello@spick\.se` i kund-möte-flöde:**
- [auto-remind/index.ts:669,738,764](supabase/functions/auto-remind/index.ts:669) — efter-städning-mail: "Inte nöjd? Skriv till hello@spick.se inom 24h"
- [garanti.html](garanti.html) — 5 träffar (nöjdhetsgaranti-text)
- [noshow-refund.html](noshow-refund.html), [nojdhetsgaranti.html](nojdhetsgaranti.html) — refund-flöden

**Process:** Kund mejlar hello@spick.se → Farhad läser → manuell bedömning → [stripe-refund](supabase/functions/stripe-refund) eller manuell Stripe-dashboard-refund → ingen strukturerad audit-trail.

### Skalningspåverkan

**Skalar till:** ~50 bokningar/dag med rimlig svarstid. Därefter:
- Farhads inkorg blir flaskhals
- Ingen SLA-mätning (hur länge väntade kunden?)
- Ingen separation mellan "kvalitet-klagomål" (kräver städare-svar) och "betalning-klagomål" (kräver admin-beslut)
- Escrow/attested-modell saknas helt → konflikt "städning hölls inte" blir ord-mot-ord utan evidence
- Ingen återkoppling till städar-rating vid upphållda klagomål

**Brytpunkt:** 20 klagomål/vecka. Idag hanterbart, vid 1000+ städare ohållbart.

---

## Sektion 5 — Matchning och ranking

### Fynd

**Matchnings-RPC:** [sql/radius-model.sql:9-69](sql/radius-model.sql:9) definierar `find_nearby_cleaners(customer_lat, customer_lng)`.

**Filtrering (WHERE):**
```sql
WHERE c.is_active = true
  AND c.is_approved = true
  AND c.home_coords IS NOT NULL
  AND ST_DWithin(c.home_coords::geography, point, COALESCE(c.service_radius_km, 10) * 1000)
```

**Sortering (ORDER BY):**
```sql
ORDER BY distance_km ASC, c.avg_rating DESC NULLS LAST
```

**Det är hela "ranking-algoritmen".** Ingen vikt, ingen score, ingen hänsyn till:
- `completed_jobs` (erfarenhet)
- `pet_pref` / `elevator_pref` (kund-preferens match)
- `cleaner_service_prices` vs budget (prisrange)
- Historisk acceptans-rate (svarar snabbt = rankas högre?)
- Senaste aktivitet (städare som inte loggat in på 30 dagar bör sjunka)
- Tids-tillgänglighet för just bokningens slot
- `has_fskatt`, `identity_verified` (bör premieras men filtreras inte på)

**Frontend-sortering i [boka.html:1858-1869](boka.html:1858):**
- Om `state.lat && state.lng` → kalla RPC med distance-sort.
- Else → hämta ALLA godkända städare utan ORDER BY → slumpmässig DB-ordning.

Grep `match_score\|ranking\|weight` i kod:
- [boka.html](boka.html): 5 träffar (ord som "rank" i variabelnamn, ingen score-algoritm)
- [sql/radius-model.sql](sql/radius-model.sql), [sql/fix-nearby-part*.sql](sql/fix-nearby-part1.sql): 4 träffar (alla ORDER BY, ingen viktning)
- [docs/](docs): 20+ planerings-dokument nämner ranking som framtida feature

**Slutsats:** 0 implementerad ranking. Bara 1-dimensionell sortering.

### Skalningspåverkan

**Vid 100 städare i 10km radie:**
- Kunden ser dem i distans-ordning (närmast först). Städare i samma kvarter med 4.5 stjärnor rankas över städare 500m bort med 4.9 stjärnor om `avg_rating` är null på den närmare.
- Ingen diversifiering: 10 städare med exakt samma `avg_rating` sorteras på insert-ordning i DB.
- Ingen "exploration": nya städare (0 reviews) sorteras med NULLS LAST → sjunker alltid.
- **Cold-start-problem:** Nya städare får aldrig bokningar → aldrig reviews → sjunker permanent.

**Brytpunkt:** 20-30 städare i samma stad. Därefter blir sorteringen meningslös utan multivariat ranking.

---

## Sektion 6 — Observability och auto-alerts

### Fynd

**Auto-alerts från system till admin:**
- [admin-morning-report/index.ts](supabase/functions/admin-morning-report/index.ts) — daglig e-post kl 08:07 till hello@spick.se ([workflow](.github/workflows/admin-morning-report.yml))
- [cleanup-stale/index.ts:73](supabase/functions/cleanup-stale/index.ts:73) — e-post vid stora rensningar
- [health/index.ts](supabase/functions/health/index.ts) — endpoint för externt monitoring (DB + Resend + Stripe checks)

**Inga proaktiva alerts för:**
- Städare som inte loggat in på 14+ dagar
- Städare som fått 3 dåliga betyg i rad
- Bokningar med > 48h pending payout-markering
- Stripe webhook-signaturfel
- Edge Function error-rate-spike
- commission_rate-drift mellan platform_settings och hardcoded values

**Cron-jobb (GitHub Actions workflows, 34 st totalt):**
| Jobb | Schedule | Syfte |
|---|---|---|
| admin-morning-report | `7 6 * * *` | Daglig sammanfattning |
| auto-remind | `7-59/30 * * * *` | Bokningspåminnelser |
| cleanup-stale | `0 * * * *` | Rensa stale bookings |
| daily-automation | `0 7 * * *` | Python-script med divers |
| auto-rebook | (schemalagt) | Återkommande bokningar |
| auto-post-daily | (schemalagt) | Social media posts |
| charge-subscription | (schemalagt) | Prenumerations-bokningar |
| monthly-invoices | (månadsvis) | Fakturering |
| content-engine | (schemalagt) | Blogg-generering |
| e2e-test | (schemalagt) | End-to-end-tester |

**pg_cron-jobb:** 0 i migrations (grep `cron\.schedule\|pg_cron` i supabase/migrations → 0 träffar). All scheduling körs via GitHub Actions.

### Skalningspåverkan

**Skalar till:** Nuvarande volym. Men vid 100+ städare:
- Morning-report kommer överväldiga admin-inboxen med rad-för-rad-data
- Inget way att filtrera "intressanta events" från "brus"
- Om en städares Stripe Connect deauthoriseras via webhook finns logg men ingen alert
- `health`-endpoint är passiv — krävs externt uptime-verktyg (finns ej konfigurerat enligt [health/index.ts:4](supabase/functions/health/index.ts:4) kommentar "Anropas av: uptime-monitor, externa monitoring-verktyg")

**Brytpunkt:** 100 städare. Behöver event-stream + Slack/Discord-alert + dashboard (Grafana eller liknande).

---

## Sektion 7 — DB-schema drift

### Fynd

**Migrations-filer:** 89 st i [supabase/migrations/](supabase/migrations/).

| Kategori | Antal | Not |
|---|---|---|
| Numrerade migrations | 89 | Från `001_push.sql` till `20260419_id_1_1_extend_v_cleaners_public.sql` |
| Drafts | 1 mapp (`fas-1-2/`) | Ej körda |
| Stubs | 3 filer (`20260420_g3_is_admin_function.sql`, `20260420_g4_admin_audit_log_insert.sql`, `20260420_g5_admin_select_missing_tables.sql`) | G-paket, osäkert om kört |

**Latest migration:** `20260419_id_1_1_extend_v_cleaners_public.sql` (i går).

### Regel #27-brott (SQL utanför migrations)

**[sql/](sql/) innehåller 8 SQL-filer som INTE är migrations:**
- [sql/radius-model.sql](sql/radius-model.sql) — `CREATE OR REPLACE FUNCTION find_nearby_cleaners` → **i prod men inte spårbar via migration-ordning**
- [sql/fix-nearby-part1.sql](sql/fix-nearby-part1.sql), [sql/fix-nearby-part2.sql](sql/fix-nearby-part2.sql) — varianter av samma RPC
- [sql/fix-find-nearby-for-teams.sql](sql/fix-find-nearby-for-teams.sql) — team-variant
- [sql/companies-and-teams.sql](sql/companies-and-teams.sql) — CREATE TABLE/VIEW (osäkert om körd separat)
- [sql/p0-waitlist.sql](sql/p0-waitlist.sql) — CREATE TABLE
- [sql/approval-and-booking-response.sql](sql/approval-and-booking-response.sql) — funktioner + triggers
- [sql/cleaner-applications-geo.sql](sql/cleaner-applications-geo.sql) — ändringar till cleaner_applications

**Grep `CREATE OR REPLACE FUNCTION find_nearby_cleaners` i supabase/migrations → 0 träffar.** Den mest kritiska matchnings-RPC:n finns alltså inte i migrations-kedjan.

Detta är det exakta Regel #27-mönster som [docs/audits/2026-04-19-nytt-jobb-matchar-bugg.md:192](docs/audits/2026-04-19-nytt-jobb-matchar-bugg.md:192) flaggade: `v_available_jobs_with_match` och `jobs`-tabellen finns i prod men saknar migration-fil.

### Tidigare identifierad drift (från historiska audits)

- [2026-04-19-view-as-impersonate-analys.md](docs/audits/2026-04-19-view-as-impersonate-analys.md) — "hello@spick.se-policy" i prod utan migration-fil
- [2026-04-19-nytt-jobb-matchar-notis.md:164](docs/audits/2026-04-19-nytt-jobb-matchar-notis.md:164) — odokumenterad policy i prod
- [2026-04-19-nytt-jobb-matchar-bugg.md](docs/audits/2026-04-19-nytt-jobb-matchar-bugg.md) — `v_available_jobs_with_match` VIEW + `jobs` TABLE saknar migrations

### Skalningspåverkan

**Brytpunkt:** Redan nådd. Varje ny utvecklare måste läsa docs/7-ARKITEKTUR-SANNING.md + kolla prod-DB för att förstå vad som faktiskt existerar. CI/CD kan inte rekreera utvecklingsmiljö från migrations ensamt.

**Blockerare för:**
- Disaster recovery (backup-restore-verifiering finns workflow men migrations stämmer inte med prod → restore ≠ current state)
- Lokal utveckling (docker-compose med supabase reset → får inte find_nearby_cleaners)
- Schema-genererade types (Supabase Gen-types från migrations missar prod-RPC:er)

---

## Sektion 8 — Oavslutade trådar

### Git-state

```
On branch main
Your branch is up to date with 'origin/main'.

Untracked files:
  .claude/settings.local.json        (Claude Code config)
  .claude/worktrees/                 (duplikat-repo, se nedan)
  supabase/.temp/linked-project.json (Supabase CLI)
```

Inga otaggade kod-ändringar. Senaste 10 commits visar kontinuerlig progression (F1 Dag 2A → 2C → v3 directional updates).

### .claude/worktrees/wonderful-euler/ — ostädat worktree

**Problem:** Hela repot dupliceras i `.claude/worktrees/wonderful-euler/`. Alla grep-körningar ger dubbla träffar → noise. Ostyret bekräftat av att auditens grep-counts ca 2x:ar med worktree inkluderat.

**Åtgärd:** Kör `git worktree remove .claude/worktrees/wonderful-euler` (om branchen är mergad) eller lista aktuella worktrees med `git worktree list`.

### Migrations-drafts

- `supabase/migrations/drafts/fas-1-2/` — Fas 1-2 identity-arbete, enligt [docs/architecture/fas-1-2-unified-identity-architecture.md](docs/architecture/fas-1-2-unified-identity-architecture.md). Status: designdokument + EFs deployade (customer-upsert, magic-sms, public-auth-link, public-auth-exchange) men migrations-drafts inte körda.
- `supabase/migrations/stubs/` — 3 G-paket-migrations för admin-funktionalitet (2026-04-20). Status osäkert.

### Fragment-filer (engångsscripts?)

I repo-rot: `fix-b2b-foretag.js`, `fix-b2b-services.js`, `fix-leak.js`, `fix-leak2.js`, `fix-multi3.js`, `fix-multi4.js`, `fix-multiflow.js`, `fix-multiservice.js`.

Total: **8 fix-skript** med service-referenser (26 träffar i fix-b2b-services.js ensam). Okänt om de är död kod eller aktiva. Inga README-förklaringar.

### Tidigare audits som inte stängts

- [2026-04-19-nytt-jobb-matchar-bugg.md](docs/audits/2026-04-19-nytt-jobb-matchar-bugg.md) — rekommendation: skapa migration-fil för `v_available_jobs_with_match` + `jobs`. Status okänt.
- [2026-04-19-google-places-audit.md](docs/audits/2026-04-19-google-places-audit.md) — rekommendation: konsolidera `places-autocomplete` vs `geo`. Status: båda EFs finns fortfarande ([places-autocomplete](supabase/functions/places-autocomplete), [geo](supabase/functions/geo)).
- [2026-04-19-boka-cleaner-filter-bugg.md](docs/audits/2026-04-19-boka-cleaner-filter-bugg.md) — rekommendation: utöka `find_nearby_cleaners` RETURNS TABLE. Status: RPC-definition fortfarande i sql/ (utanför migrations).

### CLAUDE.md-drift

CLAUDE.md säger:
- "15 Edge Functions" → faktiskt **66** (4.4x mer)
- "27 GitHub Actions workflows" → faktiskt **34**
- "sw.js v2026-03-30-v1" → osäkert om ändrad efter F1-arbetet
- "3 VIEWs" (booking_slots, booking_confirmation, public_stats) → under-räkning, det finns fler (v_cleaners_for_booking, v_cleaners_public, v_available_jobs_with_match)

### Skalningspåverkan

**Konsekvens:** Varje ny sprint börjar med osäkerhet om vad som faktiskt är aktuellt i kodbasen. Memory + CLAUDE.md pekar åt olika håll än koden. Regel #29 införd för att hantera detta — men dokumentations-drift är en pågående skuld.

---

## Sammanfattande skalnings-tak

| Komponent | Skalbar till | Brytpunkt | Fix-estimat | Prio |
|---|---|---|---|---|
| Stripe Connect onboarding | 1000+ städare | — (redan skalbart) | 0h | — |
| Matchning & ranking | 20-30 städare/stad | 30+ städare i samma stad | 16-24h | 🔴 1 |
| Payout-flöde | ~200 städare | Admin hinner inte markPaid | 20-30h | 🔴 2 |
| Pricing-fragmentering | 5-10 företag med unika priser | 10+ företag eller commission-ändring | 12-20h | 🔴 3 |
| Dispute/Escrow | ~50 bokningar/dag | 20+ klagomål/vecka | 40-60h (ny infrastruktur) | 🟡 4 |
| Hardcoded service-listor | ~7 tjänster (nuvarande) | Ny tjänst kräver 50-fil-edit | 8-16h per tjänst idag → 2h efter Fas 1 | 🟡 5 |
| Observability | Nuvarande volym | 100+ städare | 20-40h | 🟡 6 |
| DB-schema drift | Redan flaskhals | CI/CD + lokal utveckling | 8-12h (återskapa migrations för prod-artefakter) | 🟠 7 |
| Oavslutade trådar / worktree / fix-skript | Pågående skuld | Varje session börjar med brus | 2-4h (städ-sprint) | 🟠 8 |

---

## Prioritering för v3-planen

**Rangordning 1-8 baserat på: (a) var brister först vid skalning, (b) vad blockerar andra faser, (c) fix-kostnad / skalnings-impact:**

### 🔴 1. Payout + Pricing centraliserat (kombinerad fas)
**Rationale:** Utbetalningar är kritisk infrastruktur. Hardcoded `0.12`/`0.17`/`0.83` på 4+ ställen betyder silent drift när platform_settings eller Smart Trappstege aktiveras. [admin.html:markPaid](admin.html:4478) utan idempotency är en tickande bomb.  
**Omfattning:** Konsolidera pricing-resolver.ts som ENDA sanning. Aktivera Smart Trappstege i payout. Lägg idempotency-check på payout-markering. Skapa reconciliation-cron som matchar Stripe Transfer events mot `bookings.payout_status`.  
**Fix-estimat:** 30-50h  
**Impact:** Låser upp prissättnings-flexibilitet + skyddar Spick från bokförings-fel

### 🔴 2. Matchning med multivariat ranking
**Rationale:** Cold-start-problemet (nya städare får aldrig jobb) är dödligt för väsentlig skala. Distance + rating är inte en algoritm. Blockerar alla tillväxt-metrics.  
**Omfattning:** match_score-kolumn på `find_nearby_cleaners`. Vikter: distance (40%), rating (20%), completed_jobs (15%), pref-match (10%), fskatt/verified (10%), exploration-bonus (5%). Flytta RPC till migration.  
**Fix-estimat:** 16-24h  
**Impact:** Gör Spick faktiskt skalbart till 100+ städare per stad

### 🔴 3. Migrations-återskapande (Regel #27-sanering)
**Rationale:** Blockerar lokal utveckling, CI/CD, disaster recovery. Varje ny utvecklare blöder tid på att förstå drift. Fix-kostnad låg relativt impact.  
**Omfattning:** Inventera prod via `pg_dump --schema-only` → jämför med migrations → skapa saknade migration-filer för `find_nearby_cleaners`, `v_available_jobs_with_match`, `jobs`, `hello@spick.se-policy`, och eventuella andra.  
**Fix-estimat:** 8-12h  
**Impact:** Möjliggör alla framtida refaktoreringar säkert

### 🟡 4. Dispute/Escrow-infrastruktur
**Rationale:** Saknad infrastruktur. Skalningsbrott vid 20 klagomål/vecka. Kräver design innan bygg.  
**Omfattning:** `disputes`-tabell, `dispute_evidence`-relation, `attested_jobs` (städare markerar utfört), SLA-timer-cron, admin-panel för dispute-queue, kund-mall för formell klagomålsanmälan.  
**Fix-estimat:** 40-60h  
**Impact:** Nödvändig för B2B-kundrelation och försäkringskrav

### 🟡 5. Service-listor DB-driven överallt
**Rationale:** Fas 1 redan påbörjad (boka.html klart). Resterande filer är volumarbete men inte teknisk skuld. Skalnings-impact låg innan man lägger till fler tjänster.  
**Omfattning:** Slå igenom services-loader.js på tjanster.html, priser.html, foretag.html, stads-sidor, blogg-artiklar. Flytta service-strings från i18n till DB.  
**Fix-estimat:** 8-16h  
**Impact:** Gör "lägg till ny tjänst" till en DB-operation istället för 50-fil-edit

### 🟡 6. Observability + proaktiva alerts
**Rationale:** Viktigt men inte blockerande. Kan byggas inkrementellt.  
**Omfattning:** Event-stream till Slack/Discord för: inaktiva städare, 3-dåliga-betyg-rad, payout-pending >48h, webhook-fel, Edge Function error-spike. Grafana-dashboard med business metrics från `health`-endpoint.  
**Fix-estimat:** 20-40h  
**Impact:** Reducerar admin-belastning vid 100+ städare

### 🟠 7. CLAUDE.md + memory-sanering
**Rationale:** Meta-skuld. Varje AI-session börjar med felaktig information. Regel #29 hanterar symptomet, inte grunden.  
**Omfattning:** Uppdatera CLAUDE.md till faktiska tal (66 EFs, 34 workflows). Lägg till kolumn "Senast verifierad" med datum på alla claims. Cron-jobb som påpekar när CLAUDE.md:s siffror driftar från repo-state.  
**Fix-estimat:** 2-4h  
**Impact:** Reducerar friktion i alla framtida sessioner

### 🟠 8. Städ-sprint (worktree, fix-skript, dead code)
**Rationale:** Lågimpact men billig. Tar bort brus.  
**Omfattning:** Ta bort `.claude/worktrees/wonderful-euler/` om mergad. Utvärdera fix-*.js-skripten (arkivera eller radera). Stäng öppna audit-rekommendationer (places/geo-konsolidering).  
**Fix-estimat:** 2-4h  
**Impact:** Rena grep-resultat + tydlig repo-struktur

---

## Särskilda rekommendationer

### R1. Slå ihop pricing-resolver + commission-enforcement som "money-layer"

Konsolidera till en enda EF `_shared/money.ts` som **alla** money-operationer måste gå igenom: beräkning, commission-lookup, payout-amount, RUT-beräkning. Ingen annan kod får kalla stripe direkt för transfer eller application_fee. Detta låser Regel #28 för pricing-domänen.

### R2. Inför integration-tester för money-path innan refaktor

Nuvarande test-sviten (grep `tests/`) testar inte checkout → transfer → payout-chain. Skapa en integration-test som kör en full booking med Stripe test mode och verifierar att commission landar i rätt size i både Spick och cleaner Stripe-konto. Utan detta blir R1 riskabelt.

### R3. Flytta ranking-logik till DB (SECURITY DEFINER function)

Motverka frestelsen att bygga ranking i frontend. Om match_score beräknas i DB går det att optimera med materialized view (refresh cron) när 1000+ städare + 1000+ bokningar skapar lat-query-problem. Frontend ska bara konsumera `v_matched_cleaners_for_booking`.

### R4. Escrow-design-dokument innan implementation

Dispute/escrow är inte "en tabell" utan en process: när attesteras ett jobb, när släpps pengarna, vad händer vid tvist, hur interagerar det med Stripe Connect direct-transfer (där pengarna redan är i städarens konto)? Skriv design-dokument FÖRST. Mönster: [docs/architecture/fas-1-2-unified-identity-architecture.md](docs/architecture/fas-1-2-unified-identity-architecture.md).

### R5. Gör `CLAUDE.md` genererad, inte handmatad

Sekt "Edge Functions (15 st)" borde genereras från `ls supabase/functions/` + filkommentarer. Cron workflow → PR varje vecka som uppdaterar CLAUDE.md och flaggar diffs. Eliminerar drift-problemet för topp-raden av Regel #29.

---

**Audit slutförd:** 2026-04-20  
**Författare:** Claude (Opus 4.7)  
**Metod:** Grep + fil:rad-citat, 0 kod ändrad, worktree exkluderad  
**Primärkälla för:** arkitekturplan v3-revidering
