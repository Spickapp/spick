# Incidentrapport: `cleaner_availability_v2` saknade INSERT/UPDATE/DELETE-grants för `authenticated`

**Datum:** 2026-04-18 (sen kväll)
**Upptäckt:** Empirisk verifiering av Fas 0.4a ([commit e2e073a](../../))
**Allvarlighet:** P1 — admin-flöde trasigt, rotorsak dold bakom RLS-policyer
**Status:** ✅ Åtgärdad + post-hoc migration skriven

---

## Sammanfattning

Efter push av Fas 0.4a testade Farhad empiriskt att spara ett schema för testcleaner `19f74217-5175-4b94-a727-487ac438fcc0` via `spick.se/admin`. v1-delen (PATCH mot `cleaner_availability`) fungerade, men v2-delen kastade `42501 permission denied for table cleaner_availability_v2` på DELETE. Rotorsak: tabellen hade RLS-policies men saknade helt tabell-level GRANTs för INSERT/UPDATE/DELETE till `authenticated`-rollen. RLS tog därmed aldrig effekt för skrivningar — GRANT är det första lagret, RLS det andra. Service role-flöden (Wizard, admin-approve, cleaner-job-match) påverkades inte eftersom `service_role` bypass:ar både GRANT och RLS. Fixen (`GRANT INSERT, UPDATE, DELETE ON cleaner_availability_v2 TO authenticated`) kördes i prod under verifieringen.

---

## Symptom

- Första försöket att trycka "Spara" i schema-editorn efter deploy av e2e073a.
- Network-flik visade:
  - `PATCH /rest/v1/cleaner_availability?cleaner_id=eq.19f74217…` → **204** ✅
  - `DELETE /rest/v1/cleaner_availability_v2?cleaner_id=eq.19f74217…` → **403** med body:
    ```json
    {"code":"42501","message":"permission denied for table cleaner_availability_v2"}
    ```
  - POST uteblev (try/catch fångade DELETE-felet).
- UI-toast: `"Schema sparat (v2-sync misslyckades, kontakta support)"` — precis som felhanteringen i 0.4a-koden avsåg.

---

## Rotorsak

Migrationen [20260414000001_calendar_events.sql:103-195](../../supabase/migrations/20260414000001_calendar_events.sql:103) skapade `cleaner_availability_v2`:

1. `CREATE TABLE IF NOT EXISTS cleaner_availability_v2 (...)` — ingen explicit GRANT.
2. `ALTER TABLE cleaner_availability_v2 ENABLE ROW LEVEL SECURITY;`
3. Policies skapade:
   - `"Anon can read availability_v2"` FOR SELECT USING (true)
   - `"Service role manages availability_v2"` FOR ALL USING (auth.role() = 'service_role')
   - `"Authenticated users manage own availability_v2"` FOR ALL USING (cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()))

Default PostgreSQL-beteende: nyskapade tabeller får ingen GRANT till `authenticated` eller `anon`. Dessa roller måste uttryckligen tilldelas. RLS-policies är det andra lagret — om GRANT saknas kommer PostgreSQL att returnera 42501 innan RLS ens utvärderas för skrivningar.

Jämförelse med v1 (`cleaner_availability` från [20260326200001](../../supabase/migrations/20260326200001_availability.sql)) där GRANTs skapades separat eller via arvs från en DB-roll-setup.

### Varför påverkades inte service_role-flöden?

`service_role` är en superuser-liknande Supabase-roll som bypass:ar både GRANT och RLS. Det innebär att:
- Wizard via admin-create-company ([rad 146](../../supabase/functions/admin-create-company/index.ts:146)) ✅ fungerade
- admin-approve-cleaner ([rad 219](../../supabase/functions/admin-approve-cleaner/index.ts:219)) ✅ fungerade
- cleaner-job-match läsning ([rad 311](../../supabase/functions/cleaner-job-match/index.ts:311)) ✅ fungerade

Den nya skriv-sökvägen i 0.4a var den första `authenticated`-skrivningen mot tabellen. Därför upptäcktes buggen först nu, trots att tabellen funnits sedan 14 april.

### Varför fungerade SELECT från `authenticated`?

`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + SELECT-policy med `USING (true)` ger implicit läsrätt till alla roller som har grund-SELECT-GRANT. Supabase's default `anon` + `authenticated` roles har `USAGE` på public-schemat men inte automatiskt SELECT. Men [20260414000001_calendar_events.sql:172-173](../../supabase/migrations/20260414000001_calendar_events.sql:172) har en explicit SELECT-policy. Det tillsammans med en implicit SELECT-grant (från Supabase's default setup) räckte för läsningar. Skrivningar kräver separata GRANTs.

---

## Åtgärd

### SQL körd i prod 2026-04-18 sen kväll

```sql
GRANT INSERT, UPDATE, DELETE ON cleaner_availability_v2 TO authenticated;
```

### Post-hoc migration (committad separat)

[`supabase/migrations/20260418_grant_v2_writes_to_authenticated.sql`](../../supabase/migrations/20260418_grant_v2_writes_to_authenticated.sql) — dokumenterar GRANT för staging/nya miljöer. Idempotent (PostgreSQL GRANT ger inget fel vid re-körning).

### Verifiering post-fix

Farhad körde om testet omedelbart efter GRANT:

- Network: `GET 200` → `PATCH 204` → `DELETE 204` → `POST 201` ✅
- SQL: 5 rader (dow 1-5, 08-17) med **nya IDs** (5808efd2, cb12805e, 19a54f4a, 9798a56b, f7d507bf) — bevisar att DELETE + INSERT utfördes, inte bara no-op UPDATE
- Snapshot-IDs före (383470af, 13304a0e, d7501396, c35f6fe6, 1660c3d2) finns inte längre → DELETE utfördes
- Dubletter: `SELECT cleaner_id, day_of_week, COUNT(*) FROM cleaner_availability_v2 GROUP BY 1,2 HAVING COUNT(*) > 1` → **0 rader**

---

## Lärdom

### 1. GRANT-lagret är lätt att glömma när man designar med RLS

RLS-policies är synliga och framträdande i migration-filer. GRANTs är enkla att glömma eftersom de inte visas i Supabase Studio's RLS-vy. När en tabell skapas med RLS aktiverat och policies definierade kan det se "komplett" ut — tills en ny skriv-sökväg (från `authenticated` istället för service_role) testas.

### 2. Service_role-bias i edge-function-design

Spick-systemet har mestadels service_role-flöden (14 EF:er). Detta gör att GRANT-buggar för `anon`/`authenticated` förblir osynliga tills en frontend-skriv-sökväg introduceras. Fas 0.4a var den första skriv-sökvägen från frontend till v2.

### 3. Framtida tabeller bör få standard-GRANTs automatiskt

Förslag för Fas 1/6 (RLS + grants-konsolidering): en template-funktion eller migration-helper som paras med varje `CREATE TABLE` + `ENABLE ROW LEVEL SECURITY`:

```sql
-- template_secure_table.sql (koncept)
GRANT SELECT ON <table> TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON <table> TO authenticated;
GRANT ALL ON <table> TO service_role;
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
-- policies kommer sedan
```

### 4. Regel #27 bekräftad igen

E2E Moment 2-rapporten ([c496517](../../), tidigare idag) antog att v2-skrivningar fungerade utan att ha testat dem från frontend. Bara service_role-skrivningar hade empirisk täckning. "Koden ser rätt ut" ≠ "behörigheterna räcker i runtime". Om empirisk verifiering av 0.4a skulle ha hoppats över hade GRANT-buggen stannat dold tills första städare försökte spara ett schema via admin-panelen efter produktionsdeploy.

---

## Öppna frågor flaggade för 0.2

Under rotorsak-analysen jämfördes v1 (`cleaner_availability`) och v2-grants. Första titten antyder att v1 har **för öppna grants** — `anon` verkar ha full CRUD på tabellen, vilket är oönskat. Detta hör inte till 0.4a-scope men flaggas för RLS-audit i Fas 0.2 (dokumentera resterande prod-policies).

---

## Uppföljning

- [x] GRANT körd i prod
- [x] Post-hoc migration skriven ([20260418_grant_v2_writes_to_authenticated.sql](../../supabase/migrations/20260418_grant_v2_writes_to_authenticated.sql))
- [x] Incident-rapport publicerad (denna fil)
- [x] Empirisk verifiering klar (IDs bytte, 0 dubletter)
- [ ] Fas 0.2: granska anon-grants på v1 + inventera andra tabeller med potentiellt missande auth-grants
- [ ] Fas 1/6: konsolidera GRANT-template för nya tabeller
