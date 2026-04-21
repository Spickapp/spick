# Manuell Deploy: §48 Fas 48.2 Del 3 — schema_migrations-synk

**Datum:** 2026-04-24
**Sprint:** §48 Fas 48.2 Del 3
**Deploy-metod:** Studio SQL Editor
**Pre-state:** 46 rader i schema_migrations
**Post-state:** 100 rader i schema_migrations

## Pre-flight

```sql
-- 1. Bekräfta nuvarande antal (46)
SELECT COUNT(*) FROM supabase_migrations.schema_migrations;

-- 2. Bekräfta att gamla 20260401000001 fortfarande finns
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version = '20260401000001';
-- Förväntat: 1 rad, name='sprint1_missing_tables'
```

## Deploy-SQL

```sql
BEGIN;

-- DELETE gamla 20260401000001 (filen omdöpt till 20260401181153)
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260401000001';

-- INSERT 55 nya rader (alla oregistrerade filer)
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
('20260327', 'security_notes'),
('20260401000002', 'loyalty_points'),
('20260401000003', 'rut_pnr_fix'),
('20260401181153', 'sprint1_missing_tables'),
('20260401194505', 'create_missing_views'),
('20260402000001', 'fix_rls_security'),
('20260402100001', 'slug_languages'),
('20260402100002', 'referral_sync'),
('20260402100003', 'coupons'),
('20260402100004', 'subscriptions_spark'),
('20260402200001', 'availability_schedule'),
('20260402200002', 'admin_users_read_policy'),
('20260402200003', 'cleaners_email'),
('20260414000001', 'calendar_events'),
('20260414000002', 'calendar_connections'),
('20260414000003', 'company_slug_backfill'),
('20260414100000', 'company_employment_model'),
('20260416120000', 'auto_delegation_phase1'),
('20260418123425', 'admin_cleaner_update'),
('20260418123434', 'company_owner_reads_team_bookings'),
('20260418123505', 'admin_reads_all_customer_profiles'),
('20260418134500', 'tid_tracking'),
('20260418160000', 'revert_tid_tracking'),
('20260418163304', 'customer_reads_own_row'),
('20260418163314', 'self_invoices_service_role_correct'),
('20260418180345', 'fix_booking_calendar_trigger_and_cleaner_contact'),
('20260418200543', 'grant_v2_writes_to_authenticated'),
('20260418205601', 'close_anon_write_leaks_phase_0_2a'),
('20260418214203', 'phase_0_2b_paket_2_cleaner_availability_rls'),
('20260418215118', 'phase_0_2b_paket_3_cleaner_availability_v2_rls'),
('20260418221406', 'phase_0_2b_paket_4_checklists_grants_and_rls'),
('20260418222603', 'phase_0_2b_paket_5b_intentional_anon_select_policies'),
('20260418224617', 'phase_0_2b_paket_6_duplicate_consolidation'),
('20260418230425', 'phase_0_2b_paket_7_enable_rls_three_tables'),
('20260418231827', 'phase_0_2b_paket_8_final_audit_and_cleanup'),
('20260419211134', 'id_1_1_extend_v_cleaners_public'),
('20260419214133', 'f1_dag1_services_tables'),
('20260419220414', 'f1_dag2a_feature_flag'),
('20260419221724', 'f1_dag2a_fix_platform_settings_grants'),
('20260419223708', 'f1_dag2c1_service_ui_config'),
('20260419231108', 'f1_dag2c3_soft_delete_premium'),
('20260419235240', 'fas_1_1_cleaners_pii_lockdown'),
('20260420112820', 'g5_admin_select_missing_tables'),
('20260420121007', 'f1_2_seed_platform_settings'),
('20260420134202', 'f1_6_payout_attempts'),
('20260420134219', 'f1_6_payout_audit_log'),
('20260420142027', 'f1_6_1_stripe_mode_isolation'),
('20260420181848', 'f1_9_reconcile_cron_and_metrics'),
('20260420194228', 'f1_9_grant_payout_tables'),
('20260422', 'f2_2_find_nearby_cleaners'),
('20260423142550', 'f2_5_R2_company_settings'),
('20260423150245', 'f2_5_R2_grants'),
('20260423155052', 'f2_7_1_b2b_schema'),
('20260423202501', 'f3_2a_matching_v2_core'),
('20260424', 'f3_2c_drop_dormant_tables')
ON CONFLICT (version) DO NOTHING;

COMMIT;
```

## Post-deploy

```sql
-- 1. Totalt (förväntat 100)
SELECT COUNT(*) FROM supabase_migrations.schema_migrations;

-- 2. Inga dubletter
SELECT version, COUNT(*)
FROM supabase_migrations.schema_migrations
GROUP BY version HAVING COUNT(*) > 1;

-- 3. Gamla 20260401000001 borta
SELECT version FROM supabase_migrations.schema_migrations
WHERE version = '20260401000001';
-- Förväntat: 0 rader

-- 4. Nya sprint1_missing_tables finns
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version = '20260401181153';
-- Förväntat: 1 rad
```

Om post-deploy visar rätt tal → Del 3 klar, gå till Del 4 workflow-refaktor.

## Rollback

Om post-deploy avviker:

```sql
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260401000001', 'sprint1_missing_tables')
ON CONFLICT (version) DO NOTHING;

DELETE FROM supabase_migrations.schema_migrations
WHERE version IN (
  '20260327', '20260401000002', '20260401000003', '20260401181153',
  '20260401194505', '20260402000001', '20260402100001', '20260402100002',
  '20260402100003', '20260402100004', '20260402200001', '20260402200002',
  '20260402200003', '20260414000001', '20260414000002', '20260414000003',
  '20260414100000', '20260416120000', '20260418123425', '20260418123434',
  '20260418123505', '20260418134500', '20260418160000', '20260418163304',
  '20260418163314', '20260418180345', '20260418200543', '20260418205601',
  '20260418214203', '20260418215118', '20260418221406', '20260418222603',
  '20260418224617', '20260418230425', '20260418231827', '20260419211134',
  '20260419214133', '20260419220414', '20260419221724', '20260419223708',
  '20260419231108', '20260419235240', '20260420112820', '20260420121007',
  '20260420134202', '20260420134219', '20260420142027', '20260420181848',
  '20260420194228', '20260422', '20260423142550', '20260423150245',
  '20260423155052', '20260423202501', '20260424'
);
COMMIT;
```
