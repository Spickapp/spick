# DB-index static audit (Fas 13 §13.2)

**Genererad:** 2026-04-24 via `deno run scripts/audit-db-indexes.ts`
**Källor:** `supabase/migrations/*.sql` (indexes) + `supabase/functions/**/*.ts` + `js/*.js` (query-patterns)
**Status:** ✓ KLAR vid aktuell data-volym (se §0 nedan)

## 0. Prod-verifierade fynd 2026-04-24 (rule #31)

Farhad körde row-counts + ett EXPLAIN-sample i Supabase Studio. Resultat:

| Tabell | Rader | EXPLAIN-sample |
|---|---|---|
| payout_audit_log | 84 | (ej körd — liten) |
| bookings | 52 | (ej körd — liten) |
| platform_settings | 28 | (ej körd — liten) |
| cleaner_applications | 23 | (ej körd — liten) |
| cleaners | 18 | Seq Scan 0.055 ms (optimal) |
| customer_profiles | 7 | (ej körd — liten) |
| admin_users | 1 | — |
| subscriptions | 1 | — |
| customer_credits | 0 | — |
| reviews | 0 | — |

**Slutsats:** Vid aktuell data-volym väljer Postgres **Seq Scan korrekt** för alla queries. Att lägga till indexes nu skulle göra queries **långsammare** (index-traversal overhead > full-scan vid <1000 rader). Alla query-plans förväntas visa:

- Seq Scan (korrekt val)
- Execution Time < 1 ms
- Planning Time ≥ Execution Time (index ger negativ ROI)

**§13.2-status: ✓ OK-för-nu.** Ingen migration behövs.

## 0.1 Re-audit-trigger (automatiserad)

**Trigger-thresholds (hardcodade i `admin-morning-report/index.ts`):**
- `bookings` ≥ 1000 rader
- `cleaners` ≥ 500 rader
- `payout_audit_log` ≥ 10 000 rader

När någon uppnås:
1. Morning-report visar **⚠️ §13.2 DB-index re-audit behövs**-varning dagligen tills hanterat.
2. Kör lokalt: `deno run --allow-read --allow-write scripts/audit-db-indexes.ts` för ny static-rapport.
3. Kör `docs/audits/2026-04-24-db-indexes-explain-queries.sql` i Supabase Studio mot prod.
4. Bygg migration för de queries som nu visar Seq Scan + långsam Execution Time.
5. Stäng trigger genom att lösa grundorsak eller justera thresholds i EF (om false alarm).

**Kompletterande manuell-trigger** (sätter morgon-alert om data-volym-check missas):
- Någon EXPLAIN-query visar > 100 ms execution time
- `pg_stat_user_tables.seq_tup_read` för bookings eller cleaners växer > 1M/dag
- Customer rapporterar latens-problem

## Sammanfattning (original static-scan)

- Totalt **126** CREATE INDEX i migrations
- Totalt **571** distinct-query-patterns (tabell+kolumn+operation) i kod
- **75** tabeller involverade
- **110** potentiella gap (queryas utan index)
- **97** potentiellt oanvända indexes (kolumn queryas aldrig i kod)

**Not:** Dessa siffror speglar teoretisk static analys. Vid nuvarande prod-volym (max 84 rader per tabell, se §0) är "gap"-listan inte actionable — Postgres-planner väljer redan optimalt. Listan blir actionable först vid skalning (se §0.1).

## Begränsningar

- Static analys, inte runtime-EXPLAIN. Faktisk performance beror på data-volym, distribution och Postgres-planner-beslut.
- Query-parser fångar `.eq/.lt/.gte/.in/.order/...` men missar råa SQL-strängar (`sb.rpc(...)`, raw SQL).
- Index-täckning räknas när en kolumn matchar första eller senare kolumn i composite-index. Btree-prefix-regler inte simulerade.
- RPC-funktioner och VIEWs inte inkluderade i denna audit.

## Gap-analys (högst prioritet)

Queryas-kolumner utan synligt index, sorterat efter antal query-ställen:

| Tabell | Kolumn | Query-ställen | Exempel | Rekommendation |
|---|---|---|---|---|
| platform_settings | key | 18 (eq, in) | `supabase/functions/admin-approve-cleaner/index.ts:118` | Överväg CREATE INDEX om query är hot-path |
| bookings | booking_date | 14 (eq, gte, lte, order) | `supabase/functions/admin-morning-report/index.ts:65` | Överväg CREATE INDEX om query är hot-path |
| customer_profiles | email | 8 (eq) | `supabase/functions/auto-delegate/index.ts:66` | Överväg CREATE INDEX om query är hot-path |
| cleaners | auth_user_id | 8 (eq) | `supabase/functions/cleaner-booking-response/index.ts:33` | Överväg CREATE INDEX om query är hot-path |
| admin_users | email | 7 (eq) | `supabase/functions/admin-approve-cleaner/index.ts:32` | Överväg CREATE INDEX om query är hot-path |
| cleaners | is_company_owner | 7 (eq) | `supabase/functions/booking-cancel-v2/index.ts:60` | Överväg CREATE INDEX om query är hot-path |
| cleaners | company_id | 6 (eq, in) | `supabase/functions/auto-delegate/index.ts:97` | Överväg CREATE INDEX om query är hot-path |
| calendar_events | start_at | 6 (gte, lte, order) | `supabase/functions/calendar-ical-feed/index.ts:79` | Överväg CREATE INDEX om query är hot-path |
| cleaners | email | 5 (eq) | `supabase/functions/admin-approve-cleaner/index.ts:189` | Överväg CREATE INDEX om query är hot-path |
| cleaners | status | 5 (eq) | `supabase/functions/admin-morning-report/index.ts:81` | Överväg CREATE INDEX om query är hot-path |
| cleaner_applications | status | 4 (eq, in) | `supabase/functions/admin-morning-report/index.ts:71` | Överväg CREATE INDEX om query är hot-path |
| bookings | customer_email | 4 (eq) | `supabase/functions/analyze-booking-pattern/index.ts:74` | Överväg CREATE INDEX om query är hot-path |
| payout_audit_log | action | 4 (eq) | `supabase/functions/reconcile-payouts/index.ts:114` | Överväg CREATE INDEX om query är hot-path |
| payout_audit_log | created_at | 4 (gte, order) | `supabase/functions/reconcile-payouts/index.ts:114` | Överväg CREATE INDEX om query är hot-path |
| subscriptions | customer_email | 3 (eq) | `supabase/functions/analyze-booking-pattern/index.ts:60` | Överväg CREATE INDEX om query är hot-path |
| subscriptions | status | 3 (in, eq) | `supabase/functions/analyze-booking-pattern/index.ts:60` | Överväg CREATE INDEX om query är hot-path |
| cleaners | is_active | 3 (eq) | `supabase/functions/auto-delegate/index.ts:97` | Överväg CREATE INDEX om query är hot-path |
| cleaners | avg_rating | 3 (order) | `supabase/functions/auto-delegate/index.ts:97` | Överväg CREATE INDEX om query är hot-path |
| customer_credits | expires_at | 3 (gte, order) | `supabase/functions/booking-create/index.ts:559` | Överväg CREATE INDEX om query är hot-path |
| payout_audit_log | booking_id | 3 (eq) | `supabase/functions/_shared/money.ts:808` | Överväg CREATE INDEX om query är hot-path |
| admin_users | is_active | 2 (eq) | `supabase/functions/admin-approve-company/index.ts:39` | Överväg CREATE INDEX om query är hot-path |
| cleaners | payment_status | 2 (eq) | `supabase/functions/admin-morning-report/index.ts:81` | Överväg CREATE INDEX om query är hot-path |
| booking_events | created_at | 2 (gte, order) | `supabase/functions/admin-morning-report/index.ts:111` | Överväg CREATE INDEX om query är hot-path |
| bookings | review_requested_at | 2 (is) | `supabase/functions/auto-remind/index.ts:828` | Överväg CREATE INDEX om query är hot-path |
| bookings | rating | 2 (gte) | `supabase/functions/auto-remind/index.ts:882` | Överväg CREATE INDEX om query är hot-path |
| reviews | rating | 2 (gte) | `supabase/functions/auto-remind/index.ts:888` | Överväg CREATE INDEX om query är hot-path |
| bookings | completed_at | 2 (lt) | `supabase/functions/auto-remind/index.ts:1021` | Överväg CREATE INDEX om query är hot-path |
| bookings | booking_time | 2 (eq) | `supabase/functions/booking-create/index.ts:350` | Överväg CREATE INDEX om query är hot-path |
| customer_credits | customer_email | 2 (eq) | `supabase/functions/booking-create/index.ts:559` | Överväg CREATE INDEX om query är hot-path |
| customer_credits | remaining_sek | 2 (gt) | `supabase/functions/booking-create/index.ts:559` | Överväg CREATE INDEX om query är hot-path |
| bookings | is_approved | 2 (eq) | `supabase/functions/booking-reassign/index.ts:79` | Överväg CREATE INDEX om query är hot-path |
| disputes | resolved_at | 2 (is) | `supabase/functions/dispute-admin-decide/index.ts:195` | Överväg CREATE INDEX om query är hot-path |
| escrow_events | to_state | 2 (eq) | `supabase/functions/dispute-open/index.ts:183` | Överväg CREATE INDEX om query är hot-path |
| escrow_events | created_at | 2 (order, lte) | `supabase/functions/dispute-open/index.ts:183` | Överväg CREATE INDEX om query är hot-path |
| bookings | escrow_state | 2 (eq) | `supabase/functions/escrow-auto-release/index.ts:108` | Överväg CREATE INDEX om query är hot-path |
| cleaner_applications | created_at | 2 (lt) | `supabase/functions/expire-team-invitations/index.ts:46` | Överväg CREATE INDEX om query är hot-path |
| cleaners | created_at | 2 (lt, gte) | `supabase/functions/health/index.ts:32` | Överväg CREATE INDEX om query är hot-path |
| cleaner_applications | onboarding_phase | 2 (eq) | `supabase/functions/onboarding-reminders/index.ts:45` | Överväg CREATE INDEX om query är hot-path |
| cleaners | stripe_account_id | 2 (eq) | `supabase/functions/stripe-connect-webhook/index.ts:58` | Överväg CREATE INDEX om query är hot-path |
| bookings | payment_intent_id | 2 (eq) | `supabase/functions/stripe-webhook/index.ts:657` | Överväg CREATE INDEX om query är hot-path |
| bookings | stripe_payment_intent_id | 2 (eq) | `supabase/functions/stripe-webhook/index.ts:866` | Överväg CREATE INDEX om query är hot-path |
| payout_attempts | booking_id | 2 (eq) | `supabase/functions/_shared/money.ts:861` | Överväg CREATE INDEX om query är hot-path |
| payout_attempts | attempt_count | 2 (order) | `supabase/functions/_shared/money.ts:861` | Överväg CREATE INDEX om query är hot-path |
| payout_audit_log | stripe_transfer_id | 2 (eq) | `supabase/functions/_shared/money.ts:871` | Överväg CREATE INDEX om query är hot-path |
| payout_attempts | created_at | 2 (gte, lt) | `supabase/functions/_shared/money.ts:1463` | Överväg CREATE INDEX om query är hot-path |
| company_service_prices | company_id | 2 (eq) | `supabase/functions/_shared/pricing-resolver.ts:112` | Överväg CREATE INDEX om query är hot-path |
| company_service_prices | service_type | 2 (eq) | `supabase/functions/_shared/pricing-resolver.ts:112` | Överväg CREATE INDEX om query är hot-path |
| subscription_slot_holds | weekday | 2 (eq, order) | `supabase/functions/_shared/slot-holds.ts:130` | Överväg CREATE INDEX om query är hot-path |
| subscription_slot_holds | active | 2 (eq) | `supabase/functions/_shared/slot-holds.ts:130` | Överväg CREATE INDEX om query är hot-path |
| cleaners | booking_date | 1 (eq) | `supabase/functions/admin-morning-report/index.ts:81` | Överväg CREATE INDEX om query är hot-path |

_(60 fler gaps ej visade — se kör-output)_

## Alla indexes per tabell

### ONLY  (2 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| ONLY_pkey | id | ✓ | — | 00000_fas_2_1_1_bootstrap_dependencies.sql (ALTER PK) |
| ONLY_pkey | code | ✓ | — | 00018_fas_2_1_magic_link_shortcodes.sql (ALTER PK) |

### admin_audit_log  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| admin_audit_log_pkey | id | ✓ | — | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |

### admin_permissions  (2 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| admin_permissions_pkey | id | ✓ | — | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |
| admin_permissions_unique_0 | resource, action, scope | ✓ | — | 20260331000001_admin_portal.sql (UNIQUE) |

### admin_roles  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| admin_roles_pkey | id | ✓ | — | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |

### admin_settings  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| admin_settings_pkey | key | ✓ | — | 20260331000001_admin_portal.sql (PK inline) |

### admin_users  (1 indexes, 2 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| admin_users_pkey | id | ✓ | — | 00000_fas_2_1_1_bootstrap_dependencies.sql (ALTER PK) |

### attested_jobs  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| attested_jobs_pkey | booking_id | ✓ | — | 20260427000007_fas8_escrow_dispute_schema.sql (PK inline) |

### auth_audit_log  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| auth_audit_log_pkey | id | ✓ | — | 01-new-tables.sql (PK inline) |

### blocked_times  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| blocked_times_pkey | id | ✓ | — | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |

### booking_checklists  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| booking_checklists_pkey | id | ✓ | — | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |

### booking_confirmation  (0 indexes, 1 query-kolumner)

_(Inga indexes definierade i migrations)_

### booking_events  (1 indexes, 2 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| booking_events_pkey | DEFAULT | ✓ | — | 20260401181153_sprint1_missing_tables.sql (PK inline) |

### booking_slots  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| booking_slots_pkey | id | ✓ | — | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |

### booking_status_log  (3 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_status_log_booking | booking_id |  | — | 20260402100004_subscriptions_spark.sql |
| idx_bsl_cleaner_email | cleaner_email |  | `cleaner_email IS NOT NULL` | 20260402100004_subscriptions_spark.sql |
| booking_status_log_pkey | DEFAULT | ✓ | — | 20260402100004_subscriptions_spark.sql (PK inline) |

### bookings  (6 indexes, 22 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_bookings_reassignment_state | status, reassignment_proposed_at |  | `status IN ('awaiting_company_proposal', 'awaiting_customer_approval', 'awaiting_reassignment')` | 20260416120000_auto_delegation_phase1.sql |
| idx_bookings_proposed_cleaner | reassignment_proposed_cleaner_id |  | `reassignment_proposed_cleaner_id IS NOT NULL` | 20260416120000_auto_delegation_phase1.sql |
| idx_unique_booking_slot | cleaner_id, date, time | ✓ | `payment_status = 'paid' AND status != 'avbokad'` | 20260328100001_booking_integrity.sql |
| idx_bookings_cleaner_date | cleaner_id, date |  | `payment_status = 'paid' AND status != 'avbokad'` | 20260328100001_booking_integrity.sql |
| idx_bookings_pending_cleanup | created_at |  | `payment_status = 'pending' AND status = 'pending'` | 20260328100001_booking_integrity.sql |
| idx_bookings_stale_cleanup | payment_status, created_at |  | `payment_status = 'pending' AND status = 'pending'` | 20260330000001_security_hardening.sql |

### calendar_connections  (4 indexes, 4 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_cal_conn_cleaner | cleaner_id |  | — | 20260414000002_calendar_connections.sql |
| idx_cal_conn_active | is_active |  | `is_active = true` | 20260414000002_calendar_connections.sql |
| calendar_connections_pkey | DEFAULT | ✓ | — | 20260414000002_calendar_connections.sql (PK inline) |
| calendar_connections_unique_0 | cleaner_id, provider | ✓ | — | 20260414000002_calendar_connections.sql (UNIQUE) |

### calendar_events  (7 indexes, 6 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_cal_cleaner_range | cleaner_id, start_at, end_at |  | — | 20260414000001_calendar_events.sql |
| idx_cal_booking_id | booking_id |  | `booking_id IS NOT NULL` | 20260414000001_calendar_events.sql |
| idx_cal_event_type | event_type |  | — | 20260414000001_calendar_events.sql |
| idx_cal_external_id | external_id |  | `external_id IS NOT NULL` | 20260414000001_calendar_events.sql |
| idx_cal_booking_unique | booking_id | ✓ | `booking_id IS NOT NULL` | 20260414000001_calendar_events.sql |
| calendar_events_pkey | DEFAULT | ✓ | — | 20260414000001_calendar_events.sql (PK inline) |
| idx_cal_external_unique | cleaner_id, external_id | ✓ | `external_id IS NOT NULL` | 20260414000002_calendar_connections.sql |

### cancellations  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| cancellations_pkey | id | ✓ | — | 20260326700001_system_automation.sql (PK inline) |

### cleaner_applications  (1 indexes, 7 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| cleaner_applications_pkey | id | ✓ | — | 20260325000001_production_ready.sql (PK inline) |

### cleaner_availability  (2 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| cleaner_availability_pkey | DEFAULT | ✓ | — | 20260326200001_availability.sql (PK inline) |
| cleaner_availability_unique_0 | cleaner_id, day_of_week | ✓ | — | 20260326200001_availability.sql (UNIQUE) |

### cleaner_availability_v2  (3 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_avail_v2_cleaner | cleaner_id, day_of_week |  | — | 20260414000001_calendar_events.sql |
| cleaner_availability_v2_pkey | DEFAULT | ✓ | — | 20260414000001_calendar_events.sql (PK inline) |
| idx_availability_v2_lookup | cleaner_id, day_of_week, is_active |  | `is_active = true` | 20260423202501_f3_2a_matching_v2_core.sql |

### cleaner_blocked_dates  (2 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| cleaner_blocked_dates_pkey | DEFAULT | ✓ | — | 20260326200001_availability.sql (PK inline) |
| cleaner_blocked_dates_unique_0 | cleaner_id, blocked_date | ✓ | — | 20260326200001_availability.sql (UNIQUE) |

### cleaner_referrals  (5 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_cr_cleaner_id | cleaner_id |  | — | 20260402100002_referral_sync.sql |
| idx_cr_referred_email | referred_email |  | — | 20260402100002_referral_sync.sql |
| idx_cr_status | status |  | — | 20260402100002_referral_sync.sql |
| idx_cr_booking_id | booking_id |  | `booking_id IS NOT NULL` | 20260402100002_referral_sync.sql |
| cleaner_referrals_pkey | id | ✓ | — | 20260402100002_referral_sync.sql (PK inline) |

### cleaner_service_prices  (0 indexes, 2 query-kolumner)

_(Inga indexes definierade i migrations)_

### cleaners  (8 indexes, 19 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_cleaners_slug | slug | ✓ | `slug IS NOT NULL` | 20260402100001_slug_languages.sql |
| idx_cleaners_languages | languages |  | `languages IS NOT NULL` | 20260402100001_slug_languages.sql |
| idx_cleaners_specialties | specialties |  | `specialties IS NOT NULL` | 20260402100001_slug_languages.sql |
| idx_cleaners_spark | spark_points |  | — | 20260402100004_subscriptions_spark.sql |
| idx_cleaners_availability_schedule | availability_schedule |  | `availability_schedule IS NOT NULL` | 20260402200001_availability_schedule.sql |
| idx_cleaners_approval_active | is_approved, is_active, status |  | `is_approved = true AND is_active = true AND status = 'aktiv'` | 20260423202501_f3_2a_matching_v2_core.sql |
| idx_cleaners_home_geo | (ST_MakePoint(home_lng::double, home_lat::double |  | `home_lat IS NOT NULL AND home_lng IS NOT NULL` | 20260423202501_f3_2a_matching_v2_core.sql |
| cleaners_email_company_unique_idx | lower(email | ✓ | `email IS NOT NULL` | 20260424230500_sprint1d3_cleaners_email_unique.sql |

### commission_levels  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| commission_levels_pkey | id | ✓ | — | 20260402100004_subscriptions_spark.sql (PK inline) |

### commission_log  (4 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_cl_cleaner | cleaner_id |  | — | 20260402100004_subscriptions_spark.sql |
| idx_cl_booking | booking_id |  | — | 20260402100004_subscriptions_spark.sql |
| idx_cl_created | created_at |  | — | 20260402100004_subscriptions_spark.sql |
| commission_log_pkey | id | ✓ | — | 20260402100004_subscriptions_spark.sql (PK inline) |

### companies  (0 indexes, 4 query-kolumner)

_(Inga indexes definierade i migrations)_

### company_service_prices  (0 indexes, 2 query-kolumner)

_(Inga indexes definierade i migrations)_

### content_performance  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| content_performance_pkey | DEFAULT | ✓ | — | 20260327600001_content_engine_tables.sql (PK inline) |

### content_queue  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| content_queue_pkey | DEFAULT | ✓ | — | 20260327600001_content_engine_tables.sql (PK inline) |

### coupon_usages  (3 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_cu_coupon_id | coupon_id |  | — | 20260402100003_coupons.sql |
| idx_cu_customer | customer_email |  | — | 20260402100003_coupons.sql |
| coupon_usages_pkey | id | ✓ | — | 20260402100003_coupons.sql (PK inline) |

### coupons  (4 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_coupons_code | code |  | — | 20260402100003_coupons.sql |
| idx_coupons_active | active |  | `active = true` | 20260402100003_coupons.sql |
| idx_coupons_expires | expires_at |  | — | 20260402100003_coupons.sql |
| coupons_pkey | id | ✓ | — | 20260402100003_coupons.sql (PK inline) |

### customer_credits  (1 indexes, 4 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| customer_credits_pkey | DEFAULT | ✓ | — | 20260401181153_sprint1_missing_tables.sql (PK inline) |

### customer_preferences  (1 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| customer_preferences_pkey | id | ✓ | — | 20260427000002_fas5_recurring_retention_schema.sql (PK inline) |

### customer_profiles  (1 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_customer_profiles_nudge_pending | created_at |  | `recurring_nudge_sent_at IS NULL` | 20260424000002_fas5_recurring_nudge_column.sql |

### customer_reports  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| customer_reports_pkey | id | ✓ | — | 20260326000004_security_tables.sql (PK inline) |

### discount_usage  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| discount_usage_pkey | DEFAULT | ✓ | — | 20260401181153_sprint1_missing_tables.sql (PK inline) |

### discounts  (1 indexes, 8 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| discounts_pkey | DEFAULT | ✓ | — | 20260401181153_sprint1_missing_tables.sql (PK inline) |

### dispute_evidence  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| dispute_evidence_pkey | id | ✓ | — | 20260427000007_fas8_escrow_dispute_schema.sql (PK inline) |

### disputes  (1 indexes, 4 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| disputes_pkey | id | ✓ | — | 20260427000007_fas8_escrow_dispute_schema.sql (PK inline) |

### email_queue  (1 indexes, 5 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| email_queue_pkey | DEFAULT | ✓ | — | 20260327300001_rate_limiting_email_queue.sql (PK inline) |

### emails  (1 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| emails_pkey | DEFAULT | ✓ | — | 20260327000001_emails_inbox.sql (PK inline) |

### escrow_events  (1 indexes, 3 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| escrow_events_pkey | id | ✓ | — | 20260427000007_fas8_escrow_dispute_schema.sql (PK inline) |

### gift_cards  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| gift_cards_pkey | DEFAULT | ✓ | — | 003_subs.sql (PK inline) |

### invoices  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| invoices_pkey | DEFAULT | ✓ | — | 009_invoices.sql (PK inline) |

### key_methods  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| key_methods_pkey | DEFAULT | ✓ | — | 006_keys.sql (PK inline) |

### loyalty_points  (3 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_loyalty_email | customer_email |  | — | 20260401000002_loyalty_points.sql |
| loyalty_points_pkey | id | ✓ | — | 20260401000002_loyalty_points.sql (PK inline) |
| loyalty_points_unique_0 | customer_email | ✓ | — | 20260401000002_loyalty_points.sql (UNIQUE) |

### magic_link_shortcodes  (1 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| magic_link_shortcodes_pkey | code | ✓ | — | 01-new-tables.sql (PK inline) |

### matching_shadow_log  (4 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| matching_shadow_log_booking_idx | booking_id |  | — | 20260424231000_sprint2d1_matching_shadow_log.sql |
| matching_shadow_log_created_idx | created_at |  | — | 20260424231000_sprint2d1_matching_shadow_log.sql |
| matching_shadow_log_pkey | DEFAULT | ✓ | — | 20260424231000_sprint2d1_matching_shadow_log.sql (PK inline) |
| matching_shadow_log_providers_idx | (providers_ranking |  | `providers_ranking IS NOT NULL` | 20260426140000_model3_shadow_log_providers_col.sql |

### messages  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| messages_pkey | DEFAULT | ✓ | — | 006_keys.sql (PK inline) |

### payout_attempts  (1 indexes, 5 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| payout_attempts_pkey | id | ✓ | — | 20260420134202_f1_6_payout_attempts.sql (PK inline) |

### payout_audit_log  (1 indexes, 4 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| payout_audit_log_pkey | id | ✓ | — | 20260420134219_f1_6_payout_audit_log.sql (PK inline) |

### photos  (0 indexes, 1 query-kolumner)

_(Inga indexes definierade i migrations)_

### platform_settings  (1 indexes, 8 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| platform_settings_pkey | DEFAULT | ✓ | — | 20260401181153_sprint1_missing_tables.sql (PK inline) |

### processed_webhook_events  (2 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_webhook_events_date | processed_at |  | — | 20260330000001_security_hardening.sql |
| processed_webhook_events_pkey | event_id | ✓ | — | 20260330000001_security_hardening.sql (PK inline) |

### push_subscriptions  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| push_subscriptions_pkey | DEFAULT | ✓ | — | 001_push.sql (PK inline) |

### rate_limits  (2 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| rate_limits_pkey | key, window_start | ✓ | — | 20260327300001_rate_limiting_email_queue.sql (PK constraint) |
| idx_rate_limits_window | window_start |  | — | 20260330000001_security_hardening.sql |

### ratings  (0 indexes, 2 query-kolumner)

_(Inga indexes definierade i migrations)_

### referrals  (2 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| referrals_pkey | DEFAULT | ✓ | — | 003_subs.sql (PK inline) |
| referrals_pkey | id | ✓ | — | 20260326000003_referrals_table.sql (PK inline) |

### reviews  (2 indexes, 6 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| reviews_pkey | DEFAULT | ✓ | — | 003_subs.sql (PK inline) |
| reviews_pkey | id | ✓ | — | 20260325000001_production_ready.sql (PK inline) |

### role_permissions  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| role_permissions_pkey | role_id, permission_id | ✓ | — | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |

### rut_claims  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| rut_claims_pkey | DEFAULT | ✓ | — | 20260325000003_rut_claims.sql (PK inline) |

### self_invoices  (0 indexes, 1 query-kolumner)

_(Inga indexes definierade i migrations)_

### service_addons  (3 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| service_addons_pkey | id | ✓ | — | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |
| service_addons_service_idx | service_id, active, display_order |  | — | 20260419214133_f1_dag1_services_tables.sql |
| service_addons_unique_0 | service_id, key | ✓ | — | 20260419214133_f1_dag1_services_tables.sql (UNIQUE) |

### services  (3 indexes, 2 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| services_pkey | id | ✓ | — | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |
| services_active_order_idx | active, display_order |  | `active = true` | 20260419214133_f1_dag1_services_tables.sql |
| services_key_idx | key |  | — | 20260419214133_f1_dag1_services_tables.sql |

### social_posts  (1 indexes, 1 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| social_posts_pkey | DEFAULT | ✓ | — | 20260325000004_social_posts.sql (PK inline) |

### spark_levels  (2 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_spark_levels_points | min_points |  | — | 20260402100004_subscriptions_spark.sql |
| spark_levels_pkey | id | ✓ | — | 20260402100004_subscriptions_spark.sql (PK inline) |

### subscription_slot_holds  (4 indexes, 5 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| idx_slot_holds_cleaner_day_active | cleaner_id, weekday |  | `active = true` | 20260424000001_fas5_subscription_slot_holds.sql |
| idx_slot_holds_subscription | subscription_id |  | — | 20260424000001_fas5_subscription_slot_holds.sql |
| subscription_slot_holds_pkey | id | ✓ | — | 20260424000001_fas5_subscription_slot_holds.sql (PK inline) |
| subscription_slot_holds_unique_0 | subscription_id | ✓ | — | 20260424000001_fas5_subscription_slot_holds.sql (UNIQUE) |

### subscriptions  (2 indexes, 4 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| subscriptions_pkey | id | ✓ | — | 00000_fas_2_1_1_bootstrap_dependencies.sql (ALTER PK) |
| subscriptions_pkey | DEFAULT | ✓ | — | 003_subs.sql (PK inline) |

### support_tickets  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| support_tickets_pkey | id | ✓ | — | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |

### swedish_holidays  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| swedish_holidays_pkey | holiday_date | ✓ | — | 20260424000003_fas5_swedish_holidays.sql (PK inline) |

### temp_role_elevations  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| temp_role_elevations_pkey | id | ✓ | — | 20260331000001_admin_portal.sql (PK inline) |

### ticket_notes  (1 indexes, 0 query-kolumner)

| Index | Kolumner | Unik | WHERE | Källa |
|---|---|---|---|---|
| ticket_notes_pkey | id | ✓ | — | 20260331000001_admin_portal.sql (PK inline) |

### v_cleaners_public  (0 indexes, 2 query-kolumner)

_(Inga indexes definierade i migrations)_


## Potentiellt oanvända indexes (review)

Dessa indexes har kolumner som aldrig queryas explicit i EF-kod. Kan vara:

- **Legitima:** används av RPC-funktioner, VIEWs, raw SQL eller Postgres-planner för joins/sorts.
- **Dead:** lämnad efter refaktor. Ta bort om confirmed via `pg_stat_user_indexes.idx_scan = 0` över 30 dagar.

| Index | Tabell | Kolumner | Källa |
|---|---|---|---|
| admin_users_pkey | admin_users | id | 00000_fas_2_1_1_bootstrap_dependencies.sql (ALTER PK) |
| ONLY_pkey | ONLY | id | 00000_fas_2_1_1_bootstrap_dependencies.sql (ALTER PK) |
| admin_roles_pkey | admin_roles | id | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |
| admin_permissions_pkey | admin_permissions | id | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |
| role_permissions_pkey | role_permissions | role_id, permission_id | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |
| admin_audit_log_pkey | admin_audit_log | id | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |
| support_tickets_pkey | support_tickets | id | 00006_fas_2_1_1_admin_bootstrap.sql (ALTER PK) |
| booking_slots_pkey | booking_slots | id | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |
| booking_checklists_pkey | booking_checklists | id | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |
| blocked_times_pkey | blocked_times | id | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |
| services_pkey | services | id | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |
| service_addons_pkey | service_addons | id | 00007_fas_2_1_1_missing_tables.sql (ALTER PK) |
| ONLY_pkey | ONLY | code | 00018_fas_2_1_magic_link_shortcodes.sql (ALTER PK) |
| push_subscriptions_pkey | push_subscriptions | DEFAULT | 001_push.sql (PK inline) |
| subscriptions_pkey | subscriptions | DEFAULT | 003_subs.sql (PK inline) |
| reviews_pkey | reviews | DEFAULT | 003_subs.sql (PK inline) |
| referrals_pkey | referrals | DEFAULT | 003_subs.sql (PK inline) |
| gift_cards_pkey | gift_cards | DEFAULT | 003_subs.sql (PK inline) |
| key_methods_pkey | key_methods | DEFAULT | 006_keys.sql (PK inline) |
| messages_pkey | messages | DEFAULT | 006_keys.sql (PK inline) |
| invoices_pkey | invoices | DEFAULT | 009_invoices.sql (PK inline) |
| social_posts_pkey | social_posts | DEFAULT | 20260325000004_social_posts.sql (PK inline) |
| customer_reports_pkey | customer_reports | id | 20260326000004_security_tables.sql (PK inline) |
| cleaner_availability_pkey | cleaner_availability | DEFAULT | 20260326200001_availability.sql (PK inline) |
| cleaner_availability_unique_0 | cleaner_availability | cleaner_id, day_of_week | 20260326200001_availability.sql (UNIQUE) |
| cleaner_blocked_dates_pkey | cleaner_blocked_dates | DEFAULT | 20260326200001_availability.sql (PK inline) |
| cleaner_blocked_dates_unique_0 | cleaner_blocked_dates | cleaner_id, blocked_date | 20260326200001_availability.sql (UNIQUE) |
| cancellations_pkey | cancellations | id | 20260326700001_system_automation.sql (PK inline) |
| emails_pkey | emails | DEFAULT | 20260327000001_emails_inbox.sql (PK inline) |
| rate_limits_pkey | rate_limits | key, window_start | 20260327300001_rate_limiting_email_queue.sql (PK constraint) |
| email_queue_pkey | email_queue | DEFAULT | 20260327300001_rate_limiting_email_queue.sql (PK inline) |
| content_queue_pkey | content_queue | DEFAULT | 20260327600001_content_engine_tables.sql (PK inline) |
| content_performance_pkey | content_performance | DEFAULT | 20260327600001_content_engine_tables.sql (PK inline) |
| idx_loyalty_email | loyalty_points | customer_email | 20260401000002_loyalty_points.sql |
| loyalty_points_pkey | loyalty_points | id | 20260401000002_loyalty_points.sql (PK inline) |
| loyalty_points_unique_0 | loyalty_points | customer_email | 20260401000002_loyalty_points.sql (UNIQUE) |
| platform_settings_pkey | platform_settings | DEFAULT | 20260401181153_sprint1_missing_tables.sql (PK inline) |
| discounts_pkey | discounts | DEFAULT | 20260401181153_sprint1_missing_tables.sql (PK inline) |
| discount_usage_pkey | discount_usage | DEFAULT | 20260401181153_sprint1_missing_tables.sql (PK inline) |
| customer_credits_pkey | customer_credits | DEFAULT | 20260401181153_sprint1_missing_tables.sql (PK inline) |

_(57 fler ej visade)_

## Nästa steg

1. Kör `EXPLAIN ANALYZE` mot prod för top-10 gap-queries i tabellen ovan.
2. Beroende på data-volym: lägg till CREATE INDEX via migration om Seq Scan dominerar.
3. För unused-kandidaterna: kör `SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE indexrelname = '...';` och verifiera över 30 dgr.
4. Uppdatera `docs/ga-readiness-checklist.md` §13.2-status när audit är faktisk EXPLAIN-baserad.

---

_Regenerera denna rapport: `deno run --allow-read --allow-write scripts/audit-db-indexes.ts`_
