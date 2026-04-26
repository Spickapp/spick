# DB Schema Audit — 2026-04-26

**Scope:** Read-only verification av Spick prod-Supabase. RLS-status, anon-läckage, RPC-existens, vyer, kritiska constraints.
**Metod:** curl mot `https://urjeijcncsyuletprydy.supabase.co/rest/v1/*` med ANON-key.
**Auditor:** Claude (delegated DB-audit).
**Time-box:** 12 min, faktisk: ~10 min.

---

## 1. Tabell-existens + RLS-status (34 testade)

| Tabell | HTTP | Tolkning |
|---|---|---|
| bookings | 200 (tomt) | RLS filtrerar (anon ser inget) |
| cleaners | 401 | RLS-skyddad |
| companies | **200 + DATA** | **PUBLIK — innehåller PII (se §3)** |
| reviews | 200 (tomt) | RLS filtrerar |
| customer_profiles | 401 | RLS-skyddad |
| calendar_events | 401 | RLS-skyddad |
| subscriptions | 200 (tomt) | RLS filtrerar |
| payouts | **404** | **SAKNAS / fel namn (kanske `payout_attempts` är ersättare)** |
| payout_attempts | 401 | RLS-skyddad |
| disputes | 401 | RLS-skyddad |
| chargeback_events | 401 | RLS-skyddad |
| rut_consents | 401 | RLS-skyddad |
| rut_batch_submissions | 200 (tomt) | RLS filtrerar |
| customer_preferences | 401 | RLS-skyddad |
| notifications | 401 | RLS-skyddad |
| sms_log | 401 | RLS-skyddad |
| documents | 401 | RLS-skyddad |
| cleaner_expenses | 401 | RLS-skyddad |
| analytics_events | 401 | RLS-skyddad |
| gift_cards | **404** | **SAKNAS** (Innovation Sprint-migrationer ej körda — bekräftar CLAUDE.md kända problem) |
| coupons | 401 | RLS-skyddad |
| magic_link_shortcodes | 401 | RLS-skyddad |
| processed_webhook_events | 401 | RLS-skyddad |
| platform_settings | **200 + DATA (56 rader)** | **PUBLIK — by design (se §3)** |
| services | 200 + data | Publik (by design — services-loader.js) |
| service_addons | 200 + data | Publik (by design) |
| cleaner_service_prices | **200 + DATA** | **PUBLIK — exponerar individuella priser** |
| company_service_prices | **200 + DATA** | **PUBLIK — exponerar bolagspriser** |
| cleaner_availability | **200 + DATA** | **PUBLIK — exponerar arbetstider** |
| cleaner_availability_v2 | **200 + DATA** | **PUBLIK — duplicerad data, dual-write?** |
| blocked_dates | **404** | **SAKNAS** (eventuellt ersatt av calendar_events) |
| booking_status_log | 200 (tomt) | RLS filtrerar |
| terms_acceptance | **404** | **SAKNAS** (men `terms_signing_required=true` i platform_settings — gap?) |
| avtal_versioner | 200 + data | Publik (versionshantering, OK) |

**Skrivbarhet:** Alla testade publika tabeller (companies, platform_settings, services, service_addons, avtal_versioner) returnerar `401` på POST → **ingen anon-write**. OPTIONS visar `Allow: GET, HEAD, POST, OPTIONS` men POST blockeras av RLS.

---

## 2. RPC-test

| RPC | Faktisk signatur i prod | Resultat |
|---|---|---|
| get_booking_by_id | `(_id uuid)` (NOT `p_booking_id`) | OK — returnerar `[]` för fake UUID |
| get_booking_by_session | `(_session_id text)` (NOT `p_session_id`) | OK — returnerar `[]` |
| check_rate_limit | `(p_key, p_max, p_window_minutes)` (NOT `p_identifier/p_action/p_max_requests/p_window_seconds`) | OK — returnerar `true` |
| find_nearby_providers | **EJ FUNNEN** i schema cache | 404 — ingen sådan RPC finns |

**Finding:** Memory/handoff-instruktioner använde fel parameter-namn för 3 av 4 RPCs. **Rule #31-bekräftelse: PostgREST-felmeddelandet `Perhaps you meant to call...` är guld för signatur-discovery.**

---

## 3. Anon-läckage — DETALJERAD

### 3a. companies (5 rader exponerade)
**Exponerade kolumner inkluderar:**
- `org_number` (publik info, OK)
- `firmatecknare_personnr_hash` (NULL nu, men kolumnen är **läs-publik** — om någon row får värde läcker hashen)
- `firmatecknare_full_name` (NULL nu — samma risk)
- `firmatecknare_tic_session_id` (NULL nu — samma risk)
- `stripe_account_id` (NULL nu — Stripe Connect ID är känslig om värde finns)
- `commission_rate` (mixed: `0.17`, `12`, `12`, NULL — bekräftar memory `project_commission_format.md` att kolumnen har drift; LIVE-värde i `platform_settings.commission_standard=12`)
- `payment_trust_level`, `total_overdue_count`, `last_overdue_at` (intern risk-data — exponerar fraud-signaler)
- `dpa_accepted_at`, `underleverantor_agreement_*` (compliance-data)

**Risk:** MEDEL — inga personnummer/namn finns i prod nu, men schemat tillåter publik exponering. När firmatecknare-flödet aktiveras kommer hashes/namn läcka.

### 3b. platform_settings (56 rader, KOMPLETT exponerad)
Alla key/value-par läs-publika. Inga API-keys, men följande är affärs-känsligt:
- `chargeback_buffer_*`, `escrow_*`, `payout_trigger_mode` (intern finansiell strategi)
- `auto_remind_last_run` (drift-signal — externa kan se cron-status)
- `matching_algorithm_version=providers` (intern arkitektur)
- `stripe_mode=live` + `stripe_test_mode=false` (mode-info)
- `pnr_verification_required=hard` (compliance-strategi)

**Risk:** LÅG-MEDEL — by design publik (frontend behöver), men hela tabellen är overshared. Bör ha en separat publik vy.

### 3c. cleaner_service_prices + company_service_prices (publika)
Visar individuell prissättning per cleaner/company — `380, 450, 25/sqm, 45/sqm`. Konkurrenter kan scrape:a hela prisstrukturen.
**Risk:** LÅG (affärs-info), men oavsiktligt konkurrentintel.

### 3d. cleaner_availability + cleaner_availability_v2 (BÅDA publika)
- v1 har 11 kolumner inkl. `max_jobs_per_day`, `min_lead_time_hours`, `preferred_start_time`
- v2 har förenklat schema (`day_of_week`, `start_time`, `end_time`)
- **Båda existerar och returnerar data** → dual-table drift; oklart vilken är canonical

**Risk:** LÅG (operativ), men exponerar arbetsmönster + skapar query-confusion.

### 3e. avtal_versioner (publik)
Innehåller draft-URL:er + version + `andringssammanfattning`. Inga personnummer, men exponerar interna processer ("Claude AI-sprint 2026-04-25"). **Risk:** LÅG.

---

## 4. Vyer

| Vy | HTTP | Anteckning |
|---|---|---|
| v_cleaners_for_booking | 200 (12 rader) | Exponerar `home_lat/lng` (koordinater per cleaner) |
| v_cleaners_public | 200 (13 rader) | OK — kuraterad publik vy |
| v_cleaner_booking_mode | 200 (9 rader) | OK — Modell C-vy (NY 2026-04-26 verifierad) |
| v_calendar_busy_slots | 200 (1 rad) | OK — anonymiserad (cleaner_id + tider, ingen kund) |
| booking_confirmation | 401 | RLS-skyddad (kräver session-token) |
| v_customer_bookings | 401 | RLS-skyddad |
| v_admin_pnr_verification | 401 | RLS-skyddad |
| v_admin_chargebacks | 401 | RLS-skyddad |
| public_stats | 200 | OK |

**Finding `v_cleaners_for_booking`:** Exponerar `home_lat=59.3693, home_lng=17.8401` (hemkoordinater). Om dessa är riktiga hemadresser → **PII-läckage**. Om de är arbetsbas-koordinater (city center) → OK. **Verifiera med Farhad.**

---

## 5. Kritiska constraints

| Constraint | Status |
|---|---|
| `bookings.commission_pct CHECK` | EJ direkt verifierbar via anon (POST blockeras av not-null på customer_name innan CHECK). Kolumn finns (SELECT returnerar `[]`). |
| `cleaners.allow_individual_booking default` | Verifierad via `v_cleaner_booking_mode`: alla 9 cleaners har `true`. Default verkar `true` (eller backfill körd). |
| `companies.hero_bg_color CHECK (hex)` | Kolumn finns (SELECT OK), CHECK ej verifierbar via anon (RLS blockerar POST innan CHECK körs). |

**Begränsning:** För djup constraint-verifiering krävs service_role + `information_schema.check_constraints`-query. Anon-curl räcker inte.

---

## TOP 5 FINDINGS (prioriterade)

1. **CRITICAL — `companies` exponerar känsliga kolumner publikt.** Schemat tillåter framtida läckage av `firmatecknare_personnr_hash`, `firmatecknare_full_name`, `stripe_account_id`, `payment_trust_level`. Värden är NULL idag, men när firmatecknare-flödet aktiveras → automatiskt PII-läck. **Åtgärd:** Skapa kuraterad `v_companies_public` (id, name, slug, display_name, logo_url, description) + RLS-strikt på companies.

2. **HIGH — `terms_acceptance` saknas (404) trots `platform_settings.terms_signing_required=true`.** Compliance-gap: krav är på men ingen tabell att lagra accept-records i. **Åtgärd:** Fas 11/12 — verifiera om logik istället sparar i `bookings.terms_accepted_at` eller `companies.terms_accepted_at`, eller om migration saknas.

3. **HIGH — `find_nearby_providers` RPC saknas.** matching/EF-flöden som anropar denna kommer få PGRST202. Audit-trail visar att RPC inte finns i schema cache. **Åtgärd:** Verifiera om matching-wrapper/geo-EF använder andra namn (kanske `match_cleaners_geo` eller liknande), eller om RPC blivit ersatt av Edge Function.

4. **MEDIUM — `platform_settings` exponerar 56 rader publikt inkl. interna drift- och strategi-signaler** (`chargeback_buffer_*`, `auto_remind_last_run`, `matching_algorithm_version`). **Åtgärd:** Skapa `v_platform_settings_public` med whitelist (commission_standard, base_price_per_hour, rut_pct, default_hourly_rate, etc.) — frontend läser från vyn.

5. **MEDIUM — Schema-drift: `cleaner_availability` + `cleaner_availability_v2` BÅDA aktiva och publika.** Dual-write risk; oklart vilken är canonical. Plus `payouts` (404) vs `payout_attempts` (401), `blocked_dates` (404) vs `calendar_events` — flera duplicate/legacy-tabeller. **Åtgärd:** Fas 2.X Replayability Sprint kan rensa upp; under tiden dokumentera canonical-source per domän.

---

## Övriga noteringar (out of scope, flaggade)

- `companies.commission_rate` har mixed format (`0.17` vs `12`) — bekräftar memory `project_commission_format.md`. Ignoreras till förmån för `platform_settings.commission_standard=12`.
- `v_cleaners_for_booking` exponerar `home_lat/lng` — verifiera om detta är cleaner-hemadress (PII) eller bas-koordinater.
- 9 av 9 cleaners har `allow_individual_booking=true` — bekräftar Modell C-default (NY 2026-04-26).
- RPC-signaturer i memory/handoff-docs är fel — `_id` istället för `p_booking_id`. Lärdom för framtida instruktioner.

---

**Audit-status:** OK (read-only, inga skrivningar).
**Nästa steg:** Farhad bedömer prioritering på Top 5; service_role-audit krävs för full constraint-verifiering.
