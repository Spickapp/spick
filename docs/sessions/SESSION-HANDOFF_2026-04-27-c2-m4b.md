# Session handoff — 2026-04-27 (Sprint C-2 + Model-4b + Fas 6.2 foundation)

**Föregående handoff:** `SESSION-HANDOFF_2026-04-26-modell-b-c.md`
**Denna session:** 2026-04-23 (morgon, git-datum; filnamn 04-27 för glob-sort-kontinuitet)
**Status vid avslut:** 3 sprints shippade till main (C-2, Model-4b, Fas 6.2). Prof-5 + rating-flöde verifierade. Inga blockerande buggar.

---

## 1. Snabb-sammanfattning (läs först)

Fyra leveranser:

1. **Sprint C-2** (`16dd23d` → rebased i `409163e`-push-serien): `stadare-profil.html` propagerar `company_id` till boka.html när team-medlem-profil ger boka-klick. Profil → Boka-funnel komplett med företagskontext (pricing/filter/banner).

2. **Sprint Model-4b** (`9ce9161`): `boka.html renderCleaners()` har nu team-size-badge-rendering. Aktiveras automatiskt när Model-4c flippar `matching_algorithm_version='providers'`. Vilande i v2-data idag.

3. **Fas 6.2 foundation** (`2d79871`): `_shared/events.ts` helper + 8 tester + `docs/architecture/event-schema.md`. 27 canonical BookingEventType-värden, 5 ActorType, best-effort `logBookingEvent()`-wrapper. Rent additivt — 0 production-code-change, unblockar Fas 8 Dispute + Escrow (EU-deadline 2 dec 2026).

4. **Verifierat + audit'at utan kod-change:**
   - `foretag.html` per-team-member CTAs redan korrekt (`?company=X&cleaner_id=Y`) — audit §3.2-spec levereras utan extra arbete där
   - Prof-5 JSON-LD + VD-redirect + sitemap-EF fungerar (preview mot prod-data)
   - Rating-flöde robust: betyg.html + notify EF + auto-remind EF. 0 ratings = inga real-completed bookings, inte broken

**Totalt: 4 commits (3 pushade av Claude + 1 bot-sitemap).**

---

## 2. Commits (kronologiskt)

| # | Sha | Rubrik |
|---|---|---|
| 1 | `16dd23d` | feat(profile): Sprint C-2 - stadare-profil skickar company_id till boka.html |
| 2 | `536a4ae` | Auto-update sitemap.xml [skip ci] *(bot)* |
| 3 | `9ce9161` | feat(matching): Sprint Model-4b - boka.html team-size-badge rendering |
| 4 | `2d79871` | feat(events): Fas 6.2 foundation - _shared/events.ts helper + schema-doc |

**Obs:** Min första push (C-2) landade direkt. Andra push (Model-4b) blockerades av bot-commit `536a4ae`, rebasade rent, pushade som `409163e`. Tredje push (Fas 6.2) landade direkt.

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
4. **Fas 6.3 retrofit** (4-6h): migrera 8 prio-EFs att använda `logBookingEvent()` (prio-lista i `docs/architecture/event-schema.md` §6). Låg risk, bygger event-data för Fas 8.
5. **Efteråt:** Sprint C-1 team-drawer på boka.html (3-4h, audit §3.1), Sprint C-4 addon-matching (4-5h, audit §4), eller Fas 5 Retention-kickoff (10-15h, plan §5).

**Strategisk positionering:** Sessionen la foundation för Fas 6 (Event-system) som gates Fas 8 (Dispute + Escrow) som har icke-förhandlingsbar EU-deadline 2 dec 2026. Arkitekturplanens beroendegraf är nu en steg närmare EU-compliance.

**Farhad vid paus:** Bad mig fortsätta enligt rekommenderat flöde med arkitekturplanen i åtanke. Denna handoff är stängningen. Väntar på strategiska beslut §6 innan nästa kod-sprint.

---

## 11. För ny Claude-session

**Start-procedur (standard från START_HERE.md):**
1. Paste session-start-prompten
2. Läs `START_HERE.md` → `docs/sanning/*` → `CLAUDE.md` → `docs/v3-phase1-progress.md` → **denna handoff (senaste)**
3. Svara i SETUP-format + vänta på Farhads fråga

**Denna handoff är den senaste** (namngiven 04-27 för glob-sort-kontinuitet efter 04-26-modell-b-c; faktiska git-commits 04-23).
