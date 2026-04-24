# Missing Migrations Audit (H19)

**Genererad:** 2026-04-24
**Källa:** `scripts/audit-missing-migrations.ts`
**Primärkälla (rule #31):** `supabase_migrations.schema_migrations` i prod

## Sammanfattning

- **Repo-migrations:** 123 filer
- **Prod-versions:** 100 körda
- **Missing (GAP!):** 43
- **Orphaned:** 20

## Missing i prod (KRÄVER åtgärd)

Dessa migrations-filer finns i repo men är **EJ körda** i prod. EF-kod som förutsätter dem kan fail:a (t.ex. A04 bookings.rut som triggade denna audit).

| Version | Fil | Åtgärd |
|---|---|---|
| 20260419220414 | `supabase/migrations/20260419220414_f1_dag2a_feature_flag.sql` | Kör i Studio eller via supabase CLI |
| 20260419221724 | `supabase/migrations/20260419221724_f1_dag2a_fix_platform_settings_grants.sql` | Kör i Studio eller via supabase CLI |
| 20260419223708 | `supabase/migrations/20260419223708_f1_dag2c1_service_ui_config.sql` | Kör i Studio eller via supabase CLI |
| 20260419231108 | `supabase/migrations/20260419231108_f1_dag2c3_soft_delete_premium.sql` | Kör i Studio eller via supabase CLI |
| 20260419235240 | `supabase/migrations/20260419235240_fas_1_1_cleaners_pii_lockdown.sql` | Kör i Studio eller via supabase CLI |
| 20260420112820 | `supabase/migrations/20260420112820_g5_admin_select_missing_tables.sql` | Kör i Studio eller via supabase CLI |
| 20260420121007 | `supabase/migrations/20260420121007_f1_2_seed_platform_settings.sql` | Kör i Studio eller via supabase CLI |
| 20260420134202 | `supabase/migrations/20260420134202_f1_6_payout_attempts.sql` | Kör i Studio eller via supabase CLI |
| 20260420134219 | `supabase/migrations/20260420134219_f1_6_payout_audit_log.sql` | Kör i Studio eller via supabase CLI |
| 20260420142027 | `supabase/migrations/20260420142027_f1_6_1_stripe_mode_isolation.sql` | Kör i Studio eller via supabase CLI |
| 20260420181848 | `supabase/migrations/20260420181848_f1_9_reconcile_cron_and_metrics.sql` | Kör i Studio eller via supabase CLI |
| 20260420194228 | `supabase/migrations/20260420194228_f1_9_grant_payout_tables.sql` | Kör i Studio eller via supabase CLI |
| 20260422113608 | `supabase/migrations/20260422113608_f2_2_find_nearby_cleaners.sql` | Kör i Studio eller via supabase CLI |
| 20260422130000 | `supabase/migrations/20260422130000_fas_2_1_1_all_policies.sql` | Kör i Studio eller via supabase CLI |
| 20260422131000 | `supabase/migrations/20260422131000_fas_2_1_1_reviews_view_conversion.sql` | Kör i Studio eller via supabase CLI |
| 20260423142550 | `supabase/migrations/20260423142550_f2_5_R2_company_settings.sql` | Kör i Studio eller via supabase CLI |
| 20260423150245 | `supabase/migrations/20260423150245_f2_5_R2_grants.sql` | Kör i Studio eller via supabase CLI |
| 20260423155052 | `supabase/migrations/20260423155052_f2_7_1_b2b_schema.sql` | Kör i Studio eller via supabase CLI |
| 20260423202501 | `supabase/migrations/20260423202501_f3_2a_matching_v2_core.sql` | Kör i Studio eller via supabase CLI |
| 20260424000001 | `supabase/migrations/20260424000001_fas5_subscription_slot_holds.sql` | Kör i Studio eller via supabase CLI |
| 20260424000002 | `supabase/migrations/20260424000002_fas5_recurring_nudge_column.sql` | Kör i Studio eller via supabase CLI |
| 20260424000003 | `supabase/migrations/20260424000003_fas5_swedish_holidays.sql` | Kör i Studio eller via supabase CLI |
| 20260424230000 | `supabase/migrations/20260424230000_sprint1d2_min_hourly_rate_seed.sql` | Kör i Studio eller via supabase CLI |
| 20260424230500 | `supabase/migrations/20260424230500_sprint1d3_cleaners_email_unique.sql` | Kör i Studio eller via supabase CLI |
| 20260424231000 | `supabase/migrations/20260424231000_sprint2d1_matching_shadow_log.sql` | Kör i Studio eller via supabase CLI |
| 20260425120000 | `supabase/migrations/20260425120000_sprint2d2_find_nearby_cleaners_v1.sql` | Kör i Studio eller via supabase CLI |
| 20260425130000 | `supabase/migrations/20260425130000_sprint2d3_shadow_analysis_views.sql` | Kör i Studio eller via supabase CLI |
| 20260425140000 | `supabase/migrations/20260425140000_sprint2d3_profile_shared_at.sql` | Kör i Studio eller via supabase CLI |
| 20260426120000 | `supabase/migrations/20260426120000_model1_active_cleaner.sql` | Kör i Studio eller via supabase CLI |
| 20260426120500 | `supabase/migrations/20260426120500_model1_rollback_active_cleaner.sql` | Kör i Studio eller via supabase CLI |
| 20260426130000 | `supabase/migrations/20260426130000_model2a_find_nearby_providers.sql` | Kör i Studio eller via supabase CLI |
| 20260426140000 | `supabase/migrations/20260426140000_model3_shadow_log_providers_col.sql` | Kör i Studio eller via supabase CLI |
| 20260427000001 | `supabase/migrations/20260427000001_stripe_test_mode_flag.sql` | Kör i Studio eller via supabase CLI |
| 20260427000002 | `supabase/migrations/20260427000002_fas5_recurring_retention_schema.sql` | Kör i Studio eller via supabase CLI |
| 20260427000003 | `supabase/migrations/20260427000003_fas6_log_booking_event_returns_uuid.sql` | Kör i Studio eller via supabase CLI |
| 20260427000004 | `supabase/migrations/20260427000004_fas6_rate_limits_minimal.sql` | Kör i Studio eller via supabase CLI |
| 20260427000005 | `supabase/migrations/20260427000005_p1_vd_team_block_dates.sql` | Kör i Studio eller via supabase CLI |
| 20260427000006 | `supabase/migrations/20260427000006_fas9_get_company_kpis.sql` | Kör i Studio eller via supabase CLI |
| 20260427000007 | `supabase/migrations/20260427000007_fas8_escrow_dispute_schema.sql` | Kör i Studio eller via supabase CLI |
| 20260427000008 | `supabase/migrations/20260427000008_fas8_escrow_mode_flag.sql` | Kör i Studio eller via supabase CLI |
| 20260427000009 | `supabase/migrations/20260427000009_fas8_rls_policies.sql` | Kör i Studio eller via supabase CLI |
| 20260427000010 | `supabase/migrations/20260427000010_fas8_add_escrow_state_to_customer_view.sql` | Kör i Studio eller via supabase CLI |
| 20260427000011 | `supabase/migrations/20260427000011_fas8_log_escrow_event_rpc.sql` | Kör i Studio eller via supabase CLI |

### Rekommenderad åtgärd

**Option A (säkert):** En migration åt gången via Studio SQL Editor.
1. Öppna migration-fil, granska innehåll.
2. Copy-paste SQL i Studio, kör.
3. Insert i schema_migrations-tabellen:
   `INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('<version>');`

**Option B (snabbt):** Supabase CLI push av alla pending.
   `supabase db push --linked`
   Kräver Farhads CLI + auth.

## Orphaned i prod (informativt)

Dessa versions körs i prod men saknar fil i repo:

- `007`
- `20260325000002`
- `20260325000003`
- `20260326000002`
- `20260326000003`
- `20260326000005`
- `20260326100001`
- `20260326400001`
- `20260326500003`
- `20260326600001`
- `20260326800001`
- `20260327200001`
- `20260327400001`
- `20260327700001`
- `20260328100001`
- `20260330000001`
- `20260330000002`
- `20260331000001`
- `20260402000001`
- `20260418163304`

Troligen: manuella Studio-ändringar eller migration-filer flyttade till archive. Verifiera.
