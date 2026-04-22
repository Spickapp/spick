# Archived Migrations

Denna mapp innehåller migrations som har körts historiskt mot prod men
som INTE ska köras vid `supabase db reset` eller `supabase db push`
pga deras innehåll är obsolete mot nuvarande prod-schema.

Supabase CLI ignorerar underkataloger av `supabase/migrations/`,
så filerna stannar för audit-trail men påverkar inte replay.

## Arkiverade filer

### 007_rls.sql (arkiverad 2026-04-22)

**Varför:** 007_rls.sql var en tidig RLS-setup-migration. Alla dess 23
policies + 2 triggers + 2 functions har sedan dess ersatts av nyare
migrations eller Studio-operationer. Verifierat via grep mot
prod-schema.sql (2026-04-22): 0 av 23 policies existerar i prod.

**Dessutom:** Filen innehöll felaktig SQL (`CREATE POLICY IF NOT EXISTS`
är inte PG-syntax) och refererade `bookings.email` som inte existerar
i nuvarande prod.

**Fas 2.X Replayability:** Filen blockerade db reset på rad 35 med
"column email does not exist". Arkiverad för att låta replay fortsätta.

**Om du behöver återställa någon policy:** Titta i
`20260422130000_fas_2_1_1_all_policies.sql` — det är nuvarande
bookings/customer_profiles-policies konsoliderade.
