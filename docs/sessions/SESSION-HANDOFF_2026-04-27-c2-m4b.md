# Session handoff — 2026-04-27 (Sprint C-2 + Model-4b + Fas 6.2 + Team-aktivering + Model-4c LIVE)

**Föregående handoff:** `SESSION-HANDOFF_2026-04-26-modell-b-c.md`
**Denna session:** 2026-04-23 (morgon + dag + kväll, git-datum; filnamn 04-27 för glob-sort-kontinuitet)
**Status vid avslut:** 4 sprints shippade till main + **TEAM-AKTIVERING + MODEL-4c FLIPP körda i prod 2026-04-23 08:34 UTC** — marknaden är nu aktiv för multi-cleaner-bokningar. Prof-5 + rating-flöde verifierade. Inga blockerande buggar.

## 🎯 MAJOR MILESTONE — Marketplace aktiverad 2026-04-23

Team-aktivering + Model-4c flipp exekverade av Farhad i Studio SQL. Verifierat live via matching-wrapper EF:

```
{"algorithm_version":"providers", "cleaners":[
  {"provider_type":"solo", "display_name":"Farhad Haghighi", "team_size":1, "min_hourly_rate":100},
  {"provider_type":"company", "display_name":"Solid Service", "team_size":4, "min_hourly_rate":390,
   "representative_cleaner_id":"e43c819f... (Odilov Firdavsiy)"}
]}
```

**Effekter LIVE för riktiga kunder:**
- Solid Service visas första gången någonsin på boka.html steg 2
- Model-4b `👥 Team med 4 städare`-badge triggar
- C-2 deep-link profil→boka fungerar end-to-end med företagskontext
- Shadow-mode fortsätter logga (kontinuerlig A/B)

**Övervakning:** 48h post-flipp (sql-queries i [docs/deploy/2026-04-27-team-activation-and-model-4c-flip.md](../deploy/2026-04-27-team-activation-and-model-4c-flip.md) §Övervakning).

**Cleanup-rest:** Test-probe `DELETE FROM booking_events WHERE booking_id='00000000-...' AND event_type='test_probe_ignore';`.

---

## 1. Snabb-sammanfattning (läs först)

Fem leveranser:

1. **Sprint C-2** (`16dd23d` → rebased i `409163e`-push-serien): `stadare-profil.html` propagerar `company_id` till boka.html när team-medlem-profil ger boka-klick. Profil → Boka-funnel komplett med företagskontext (pricing/filter/banner).

2. **Sprint Model-4b** (`9ce9161`): `boka.html renderCleaners()` har nu team-size-badge-rendering. Aktiveras automatiskt när Model-4c flippar `matching_algorithm_version='providers'`. Vilande i v2-data idag.

3. **Fas 6.2 foundation** (`2d79871`): `_shared/events.ts` helper + 8 tester + `docs/architecture/event-schema.md`. 27 canonical BookingEventType-värden, 5 ActorType, best-effort `logBookingEvent()`-wrapper. Rent additivt — 0 production-code-change, unblockar Fas 8 Dispute + Escrow (EU-deadline 2 dec 2026).

4. **Fas 6.3 retrofit 62.5%** (`650270a` + `71468dc` + `f9a47d1`): 5/8 EFs retrofittade att använda `logBookingEvent()`-helpern:
   - `booking-create` → booking_created (migrerad)
   - `auto-delegate` → cleaner_assigned (ny capture)
   - `cleaner-booking-response` → cleaner_declined (ny)
   - `booking-cancel-v2` → cancelled_by_customer (ny)
   - `noshow-refund` → noshow_reported + refund_issued (ny, 2 events)
   
   Återstående 3/8 har specifika risker/scope-problem dokumenterade i §5.6. Se även §6.5 design-fråga för frontend-retrofit.

5. **Verifierat + audit'at utan kod-change:**
   - `foretag.html` per-team-member CTAs redan korrekt (`?company=X&cleaner_id=Y`) — audit §3.2-spec levereras utan extra arbete där
   - Prof-5 JSON-LD + VD-redirect + sitemap-EF fungerar (preview mot prod-data)
   - Rating-flöde robust: betyg.html + notify EF + auto-remind EF. 0 ratings = inga real-completed bookings, inte broken

**Totalt: 9 commits (8 pushade av Claude + 1 bot-sitemap).**

---

## 2. Commits (kronologiskt)

| # | Sha | Rubrik |
|---|---|---|
| 1 | `16dd23d` | feat(profile): Sprint C-2 - stadare-profil skickar company_id till boka.html |
| 2 | `536a4ae` | Auto-update sitemap.xml [skip ci] *(bot)* |
| 3 | `9ce9161` | feat(matching): Sprint Model-4b - boka.html team-size-badge rendering |
| 4 | `2d79871` | feat(events): Fas 6.2 foundation - _shared/events.ts helper + schema-doc |
| 5 | `0ffc682` | docs(session): uppdatera handoff 2026-04-27 med Fas 6.2-addition |
| 6 | `650270a` | feat(events): Fas 6.3 partial - retrofit booking-create + auto-delegate |
| 7 | `71468dc` | feat(events): Fas 6.3 - retrofit cleaner-booking-response + booking-cancel-v2 |
| 8 | `f9a47d1` | feat(events): Fas 6.3 - retrofit noshow-refund (noshow_reported + refund_issued) |

**Obs:** Min första push (C-2) landade direkt. Andra push (Model-4b) blockerades av bot-commit `536a4ae`, rebasade rent, pushade som `409163e`. Tredje push (Fas 6.2) landade direkt. Efterföljande retrofit-commits landade direkt utan rebase.

---

## 3. Prod-state vid avslut

### 3.1 Matching (oförändrat från 04-26)

| Parameter | Värde |
|---|---|
| `matching_algorithm_version` | `'providers-shadow'` |
| `matching_shadow_log_enabled` | `'true'` |
| Klient får | v2-data (bakåtkompat) |

### 3.2 Funnel-status per entity-typ

| Entry-URL | CTA-utfall | Status |
|---|---|---|
| `/s/<solo-slug>` | `boka.html?id=X&name=Y&rate=Z` | ✓ Unchanged, solo-funnel |
| `/s/<team-member-slug>` | `boka.html?id=X&name=Y&rate=Z&company=C` | ✓ **NY (C-2)** — företagskontext bevarad |
| `/s/<vd-slug>` | 301 → `/f/<company-slug>` (Prof-5) | ✓ Canonical-redirect |
| `/f/<company-slug>` hero CTA | `boka.html?company=X` | ✓ Unchanged |
| `/f/<company-slug>` team-card "Boka X" | `boka.html?company=X&cleaner_id=Y` | ✓ Already correct (verifierat) |

### 3.3 Data-tillstånd (oförändrat)

| Tabell | Rader | Kommentar |
|---|---|---|
| `cleaners` (approved+active) | 11 (4 VD + 6 team + 1 solo) | Team = onboarding, 1 solo aktiv |
| `bookings` | 46 | - |
| `ratings` | 0 | Flöde verifierat robust, väntar på completed real-bookings |
| `matching_shadow_log` | ~3+ | Växer vid varje sökning |

---

## 4. Sprint C-2 detaljer

**Fil:** `stadare-profil.html`
**Rader:** 455 (bokaHref) + 677 (QR-URL)
**Förändring:** Conditional append `+ (c.company_id ? '&company=' + c.company_id : '')`
**Logik:** Prof-5:s VD-redirect (rad 372) säkerställer att vid rad 455 är städaren antingen solo (company_id=null → ingen &company) eller team-medlem (company_id=X → &company=X).

**End-to-end verifierat i preview:**
- Team-member `nasiba-kenjaeva` → `book-btn` href = `boka.html?id=...&name=Nasiba+Kenjaeva&rate=390&company=1b969ed7...`
- Solo `farhad-haghighi` → `book-btn` href = `boka.html?id=...&name=Farhad+Haghighi&rate=100` (NO &company)
- Boka.html öppnas med team-member-URL: `state.cleanerId=Nasiba`, `window.preCompanyId=Solid`, `window.companyData` hämtad, H1="Boka via Solid Service", title="Boka städning via Solid Service | Spick"
- 0 console-errors

---

## 5. Sprint Model-4b detaljer

**Fil:** `boka.html`
**Rader:** ~2318-2325 (cleaner-meta i `renderCleaners()`)
**Förändring:** Conditional team-badge (+4 rader) med 4 branches.

**Branches verifierade via preview_eval + mock V2Cleaners:**

| Mock | `provider_type` | `team_size` | `hasRatings` | Render |
|---|---|---|---|---|
| V2 Solo Cleaner | undefined | undefined | true | inget badge (v2 bakåtkompat) |
| Solid Service | `'company'` | 5 | false | **"👥 Team med 5 städare"** (ersätter "Ny på Spick") |
| Rafa Cleaning | `'company'` | 3 | true | stars + **"👥 3"** (kompakt) |
| Solo via providers | `'solo'` | 1 | true | inget badge (solo oförändrat) |

**Bevarat:**
- `mapProvidersToV2Cleaners` i `supabase/functions/_shared/matching-diff.ts` mappar redan `min_hourly_rate → hourly_rate`, `aggregate_rating → avg_rating`, `aggregate_review_count → review_count` på serversidan. Klient läser `cl.hourly_rate/avg_rating` oförändrat.
- Pricing-logik orörd (rad 2289 rate-fallback identisk).
- `compCard`-path (rad 2225-2281, `preCompanyId && !allow_customer_choice`) orörd — har redan egen `👥 N städare`.

**Prod-påverkan nu:** Ingen. `providers-shadow` ger v2-data → conditional branches träffar inte providers-grenar. Koden väntar på Model-4c flipp.

---

## 5.5 Fas 6.2 foundation detaljer

**Filer (3 nya, rent additivt):**
- `supabase/functions/_shared/events.ts` — helper + typ-union (214 rader)
- `supabase/functions/_tests/events/events.test.ts` — 8 tester (139 rader)
- `docs/architecture/event-schema.md` — canonical event-taxonomy (198 rader)

**Innehåll (events.ts):**
- **`BookingEventType`** (27 värden) grupperat i livscykel (8) / betalning (5) / avbrott (4) / dispute (3) / kvalitet (1) / recurring (5) / ändring (1)
- **`ActorType`** (5 värden): `system | customer | cleaner | admin | company_owner`
- **`EVENT_METADATA`** const: metadata-nyckel-lista per event-type (single source of truth per regel #28)
- **`logBookingEvent(supabase, bookingId, eventType, options)`** → best-effort wrapper runt `log_booking_event` RPC. Returnerar `true` vid success, `false` vid error/exception. Kastar ALDRIG (event-logging är audit, inte kritisk path).
- **`buildEventMetadata<T>(eventType, fields)`** → compile-time-hjälp för retrofit call-sites

**Test-resultat (`deno test _tests/events/events.test.ts --allow-env`):**
```
ok | 8 passed | 0 failed (21ms)
```

Tester täcker: happy-path, default values, RPC-error → false, exception → false, ogiltigt booking_id → 0 RPC-anrop, EVENT_METADATA-coverage för alla 27 event-types.

**Verifierat (regel #31):**
- `booking_events`-tabellen existerar i prod (REST 401 = RLS-block, inte 404)
- Migration `20260401181153_sprint1_missing_tables.sql:92-123` definierar schema + RPC-signatur
- `booking-create:528` är ENDA call-site idag (`event_type='booking_created'`)

**Scope-gränser (regel #27):**
- Ingen retrofit av befintliga EFs (§6.3 separat sprint, 4-6h, prio-lista i event-schema.md §6)
- Ingen migration (tabellen räcker som den är)
- Ingen frontend-integration (§6.4-6.6 kommer senare med event-timeline-UI)

**Prod-påverkan nu:** Ingen. Ren infrastruktur som konsumeras av framtida retrofit + Fas 8 dispute/escrow + Fas 5 recurring.

---

## 5.6 Fas 6.3 retrofit detaljer (5/8 EFs klara, 62.5%)

**Commits:** `650270a` + `71468dc` + `f9a47d1`

Tre batch-commits av EF-retrofit per `docs/architecture/event-schema.md §6` prio-lista.

| # | EF | Event(s) | Typ | Commit |
|---|---|---|---|---|
| 1 | `booking-create` | `booking_created` | Migrerad (från direct RPC → helper) | `650270a` |
| 2 | `auto-delegate` | `cleaner_assigned` | Ny event-capture | `650270a` |
| 3 | `cleaner-booking-response` | `cleaner_declined` | Ny event-capture | `71468dc` |
| 4 | `booking-cancel-v2` | `cancelled_by_customer` | Ny event-capture | `71468dc` |
| 5 | `noshow-refund` | `noshow_reported` + `refund_issued` | Två nya events | `f9a47d1` |

**Infrastructure-fix i `_shared/events.ts`:** `SupabaseClient`-typ-import bytt till minimal `SupabaseRpcClient`-interface (decouplar från supabase-js-versioner). Samma kategori som pre-existing H5.

**Verifiering per commit:**
- `deno check` på varje retrofittad EF: **PASS**
- `deno test _tests/events/events.test.ts`: **8/8 PASS** (genomsnitt 20ms, 0 regression)
- Enda kvarstående `deno check`-error i hela kedjan: pre-existing H5 i `booking-create:239` (orelaterat mina ändringar)

**Återstående §6.3 retrofit (3/8 = 37.5%):**

| EF | Event(s) | Varför inte denna session |
|---|---|---|
| `stripe-webhook` | `payment_received`, `refund_issued` | Money-critical file. Höjd riskprofil — behöver egen session med extra `deno check` + integration-test. |
| `auto-remind` | Multiple (VD-timeout, customer-approval-timeout, admin-approve, reassignment-timeout-revert) | Komplex multi-path. 4-5 separata conditional flows. Behöver scope-split över flera commits. |
| `betyg.html` (frontend) | `review_submitted` | **DESIGN-FRÅGA för Farhad**. RPC `log_booking_event` är callable från anon role (verifierat via curl HTTP 204). Men arkitektur-val: ska events logga:as via anon-frontend direkt, eller via server-side EF? Skillnad i säkerhetsprofil (anon kan logga valfritt event_type → noisy audit; EF = server-kontrollerat). |

**Side-effect från verifiering:** En test-probe-rad inserterades i `booking_events` under anon-RPC-verifiering med `booking_id=00000000-0000-0000-0000-000000000000` + `event_type='test_probe_ignore'`. Harmlös (ingen FK till real booking), men kan städas bort via SQL:
```sql
DELETE FROM booking_events 
WHERE booking_id = '00000000-0000-0000-0000-000000000000' 
  AND event_type = 'test_probe_ignore';
```

**EF-deployment:** Inte auto på git push. Farhad ska deploya följande EFs manuellt via Supabase CLI efter verifiering:
- booking-create
- auto-delegate
- cleaner-booking-response
- booking-cancel-v2
- noshow-refund

Rollback per EF = revert commit + re-deploy tidigare version.

**Prod-påverkan efter deploy:** Varje relevant state-transition skriver rad i `booking_events`. Ingen funktionell skillnad för användare. Admin kan börja bygga event-timeline (Fas 6.4) mot real data inom dagar.

---

## 6. Öppna strategiska beslut (Farhad äger)

### 6.1 Team-aktivering (Modell B §9 #2)

Solid Service 4 team-medlemmar (Nasiba, Nilufar, Dildora, Odilov) är `status='onboarding'`. Boka.html:2036 filtrerar bort dessa även med perfekt URL från C-2.

**SQL om ja:**
```sql
UPDATE cleaners SET status='aktiv' 
WHERE id IN ('3f16c9d1-b365-4baf-8d72-5f02af911fca',  -- Nasiba
             'd6e3281a-0c70-4b3f-a1e6-9a98d40860a8',  -- Nilufar
             'a86ec998-1ac5-48f6-b7bd-24f6aeed887e',  -- Dildora
             'e43c819f-6442-48af-8ce5-f3b306c6c805'); -- Odilov
```

**Verifiera sen:**
```sql
SELECT * FROM find_nearby_providers(59.3293, 18.0686);  -- Solid Service ska nu dyka upp
```

### 6.2 Model-4c flipp

Efter (1) shadow-data verifierad via `SELECT * FROM v_shadow_mode_stats` + (2) team-aktivering:

```sql
UPDATE platform_settings SET value='providers' 
WHERE key='matching_algorithm_version';
```

Då aktiveras:
- C-2 deep-links hela vägen (team-medlemmar bokbara)
- Model-4b team-badge syns
- Aggregerade ratings per företag visas

### 6.3 Sitemap-inkludering av team-medlemmar (strategiskt beslut)

Prof-5 `sitemap-profiles` EF rad 50-55 filtrerar `company_id IS NULL` → **team-medlemmar saknas i sitemap trots Prof-5 JSON-LD + C-2 deep-links på deras /s/-URLer.**

Prof-5-commit (`88a7c90`) valde company-canonical medvetet. Att inkludera team-medlemmar = ompröva det valet.

**För-argument:** Fler indexerade sidor = mer SEO-yta. Team-medlem /s/-URLer har Prof-5 rich-snippets + fungerar.

**Mot-argument:** Risk för duplicate-content vs /f/<company> team-cards. Team onboarding ej bokbart idag — SEO-landning → frustration.

**Implementation om ja (3-rads change):**
```ts
.from("v_cleaners_public")
.select("slug,is_company_owner")
.eq("is_approved", true)
.not("slug", "is", null)
.or("company_id.is.null,is_company_owner.eq.false");
// Solo (company_id=null) OR team-medlem (is_company_owner=false)
// VD exkluderade — de 301:ar till /f/
```

### 6.4 H7 Farhad-solo rate=100 cleanup

Solo-rad `de4bec9b` kvarstår med `hourly_rate=100` (testdata). Sitemap-EF exkluderar även den eftersom slug saknas. Cleanup-beslut.

### 6.5 Event-logging arkitektur för anon-frontends (Fas 6.3 forts.)

**Kontext:** `log_booking_event` RPC är callable från anon role (verifierat). Gör att `betyg.html` (frontend, kör som anon) kan logga `review_submitted` direkt via fetch.

**Designfråga:** Ska anon-frontends logga events direkt, eller gå via EF?

| Modell | För | Mot |
|---|---|---|
| **Direkt (anon → RPC)** | Enkelt, låg latens, frontend äger eventet | Anon kan logga valfritt event_type för valfritt booking_id → noisy audit, potentiella fake events |
| **Via EF** | Server-validerar booking_id, event_type, ownership | Mer kod, en EF-hop extra |

Affekter `betyg.html` (Fas 6.3 §7), framtida recurring-pause/resume-UI (Fas 5.4), framtida dispute-open-UI (Fas 8.15), framtida attest-UI (Fas 8.14). Ett beslut lägger konvention för alla.

**Rekommendation:** Via EF för customer-initiated state-changes. Direkt för pure "read-happened"-events. Men du äger valet.

---

## 7. Öppna hygien-flags (från 04-26 handoff, fortfarande aktuella)

| # | Beskrivning | Status |
|---|---|---|
| H1 | Unit-tester för `mapProvidersToV2Cleaners` | Öppen |
| H2 | Company-branch end-to-end-test kräver team-aktivering | Öppen (blockerat av 6.1) |
| H3 | Fas 2.X Replayability Sprint (30-50h) — registret ur sync | Öppen |
| H4 | localhost-CORS för preview-testing (alla EFs) | Öppen |
| H5 | `booking-create:238` pre-existing supabase-js v-mismatch | Öppen |
| H6 | PAT i git remote saknar `workflow`-scope | Öppen |
| H7 | Farhad-solo-rad (`de4bec9b`) 100 kr/h kvarstår | Öppen (flaggad §6.4) |
| H8 | `companies.logo_url` saknar onboarding-krok | Öppen |
| H9 | `cleaner.bio` inte onboarding-krav trots visibility | Öppen |
| H10 | Model-2b: ärva v2-scoring till providers-RPC | Öppen |
| H11 | 3 PNR-rader konverterades 23→24 apr → Fas 7.5 Åtgärd 2 | Öppen |
| H12 | GitHub PAT i git-remote-URL ska roteras | Öppen |

---

## 8. Primärkällor för denna session

- [docs/audits/2026-04-26-modell-c-flexibel-matching.md](../audits/2026-04-26-modell-c-flexibel-matching.md) — Sprint C-2 §3.2 spec + §6.1 ordning
- [docs/audits/2026-04-26-foretag-vs-stadare-modell.md](../audits/2026-04-26-foretag-vs-stadare-modell.md) — Modell B-kontext (team + company schema)
- `supabase/functions/_shared/matching-diff.ts` — V2Cleaner interface + `mapProvidersToV2Cleaners` (primärkälla för Model-4b fält-mapping)
- `stadare-profil.html` rad 358-488 — Prof-5 redirect-logik + bokaHref-konstruktion
- `boka.html` rad 820-926, 2000-2100, 2283-2372 — URL-params + cleaner-rendering
- `foretag.html` rad 440-615, 831-1036 — company-profil + B2B-landing scope-separation
- Prof-5 commit `88a7c90` — sitemap + JSON-LD + VD-redirect design-val

---

## 9. Regel-efterlevnad

| Regel | Noteringar |
|---|---|
| **#26** grep-före-edit | Efterlevt. Grepade `bokaHref`, `preCleanerId`, `renderCleaners`, V2Cleaner interface innan edits. Verifierade exakt text i Read innan str_replace. |
| **#27** scope-respekt | Efterlevt strikt. C-2 = 2 rader. Model-4b = 4 rader. Sitemap-fix flaggad EJ ändrad (strategiskt beslut). H7 flaggad EJ ändrad. Foretag.html verifierades korrekt, inga edits. |
| **#28** single source of truth | Efterlevt. Pricing orörd, `mapProvidersToV2Cleaners` förblir auktoritativ för company-aggregat-mapping, klient renderar bara. |
| **#29** audit-först | Efterlevt. Modell C-audit läst i sin helhet innan C-2. Modell B-referens + `matching-diff.ts` läst innan Model-4b. Prof-5-commit läst innan sitemap-utvärdering. |
| **#30** regulator-gissning | N/A — ingen RUT/PNR/Stripe/Skatteverket berörd. |
| **#31** primärkälla över memory | Efterlevt. DB-queries (v_cleaners_public, ratings COUNT) + preview mot prod-data för verifiering. Inga memory-antaganden utan verifiering. |

---

## 10. Rekommenderad nästa session

1. **Farhad verifierar i prod:** /s/nasiba-kenjaeva → klick "Boka Nasiba" → boka.html ska visa "Boka via Solid Service" i H1.
2. **Strategiskt beslut:** team-aktivering §6.1 + Model-4c flipp §6.2 (paras ihop).
3. **Om team-aktiverad:** Model-4b team-badge blir live automatiskt. Ingen kod-ändring behövs.
4. **EF-deployment (Farhad):** Deploya 5 retrofittade EFs via Supabase CLI:
   ```
   booking-create, auto-delegate, cleaner-booking-response,
   booking-cancel-v2, noshow-refund
   ```
   Clean up test-probe i booking_events (SQL i §5.6).
5. **§6.3 forts. (3/8 retrofits kvar):**
   - `stripe-webhook` — egen session (money-critical, extra testning)
   - `auto-remind` — egen session (multi-path split-scope)
   - `betyg.html` — väntar §6.5-beslut (anon direkt vs EF)
6. **Efteråt:** Sprint C-1 team-drawer på boka.html (3-4h, audit §3.1), Sprint C-4 addon-matching (4-5h, audit §4), eller Fas 5 Retention-kickoff (10-15h, plan §5).

**Strategisk positionering (efter 8 commits):** 
- Sprint C-2 + Model-4b = Fas 3 konvergens-steg (profile → booking funnel komplett, team-badge-prep)
- Fas 6.2 foundation + 6.3 62.5% = Fas 6 gates Fas 8 Dispute/Escrow EU-deadline 2 dec 2026
- Plan-framsteg: Fas 3 ◑ → ◕, Fas 6 ◯ → ◑

Sessionen levererade både konsumentvärde (C-2 funnel) OCH infrastruktur-värde (event-grunden för EU-compliance). Arkitekturplanens kritiska vägar är nu flera steg närmare.

**Farhad vid paus:** Bad mig fortsätta enligt rekommenderat flöde med arkitekturplanen i åtanke. Denna handoff är stängningen. Väntar på strategiska beslut §6 (inkl nya §6.5 anon-event-arkitektur) + EF-deployment innan nästa kod-sprint.

---

## 11. För ny Claude-session

**Start-procedur (standard från START_HERE.md):**
1. Paste session-start-prompten
2. Läs `START_HERE.md` → `docs/sanning/*` → `CLAUDE.md` → `docs/v3-phase1-progress.md` → **denna handoff (senaste)**
3. Svara i SETUP-format + vänta på Farhads fråga

**Denna handoff är den senaste** (namngiven 04-27 för glob-sort-kontinuitet efter 04-26-modell-b-c; faktiska git-commits 04-23).
