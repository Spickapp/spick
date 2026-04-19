# Fas 1.2 Migration Drafts

Dessa filer är FÖRBEREDDA men EJ KÖRDA.

Körning-ordning (dag 2-4):
1. 01-new-tables.sql (dag 2) — efter test mot staging
2. 02-backfill-customer-profiles.sql (dag 2) — efter 01
3. 03-rls-hardening.sql (dag 4) — efter SMS-callsites migrerade
4. 04-drop-customers.sql (dag 4) — efter 03

Verifierade mot prod 19 april 2026 kl 08:00-09:15 (V1-V14).

När migrationen körts mot prod, flyttas till:
supabase/migrations/20260420_fas_1_2_<namn>.sql
