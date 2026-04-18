# view_as impersonate-analys — 2026-04-19

**Syfte:** Verifiera korrekthet + säkerhet för view_as-flödet. Förklara varför admin.html får 401 på vissa tabeller.
**Metod:** Regel #26 + #27 — citera fil:rad + SQL-migrationer som primärkälla.
**Felaktigt i tidigare audit:** Jag rapporterade "ingen impersonate-funktion existerar" — det var fel. Grep efter "impersonate" gav 0 träffar men `view_as` fanns. Ursäkt för det missade fyndet.

---

## 🚨 TL;DR

1. **🟢 view_as är korrekt säkrat via RLS-policy.** Admin-check på [stadare-dashboard.html:2543-2547](stadare-dashboard.html:2543) queryar `admin_users?email=<admin_email>` med admin's egen JWT. Policy `"Authenticated read own admin_users"` ([20260402200002:10-12](supabase/migrations/20260402200002_admin_users_read_policy.sql:10)) kräver `auth.jwt() ->> 'email' = email` → användaren kan BARA läsa sin egen rad. Icke-admin får tom array → fallback till login-flödet. **Ej impersonate-bar av extern.**

2. **🟡 Admin's JWT lagras kortvarigt i localStorage** på stadare-dashboard.html ([admin.html:3349-3350](admin.html:3349)) tills den tas bort vid framgång ([stadare-dashboard.html:2557-2558](stadare-dashboard.html:2557)). XSS-fönster under några sekunder.

3. **🟡 Ingen audit-log över impersonation.** Grep efter `auditLog.*view_as` eller `auditLog.*impersonate` → 0 träffar. Plus — audit_log är ändå trasigt (se [2026-04-19-admin-impersonation-vs-editing.md](docs/audits/2026-04-19-admin-impersonation-vs-editing.md)).

4. **🔴 401-svaren är förväntade — inga admin-specifika RLS-policies finns.** Admin går som `authenticated`-roll. RLS-policies tillåter bara `service_role` eller specifika cleaner/VD/kund. Admin har **ingen explicit SELECT-policy** på companies, customer_profiles, admin_audit_log, cleaner_service_prices, cleaner_availability.

5. **🔴 Jag hittade INGEN "hello@spick.se-policy"** i SQL-filerna. Grep `hello@spick.se` i migrations → bara seedningen av admin_users ([20260331000001:181](supabase/migrations/20260331000001_admin_portal.sql:181)). Om UPDATE på cleaners funkar finns policyn troligen i prod-DB utan motsvarande migration. **Måste verifieras med pg_policies-query.**

---

## Uppgift 1 — view_as-logiken

### Triggerkedja

**Admin-sida** ([admin.html:3302-3355 `openCleanerDashboard(id)`](admin.html:3302)):
1. Loopar localStorage för Supabase-auth-nyckel ([admin.html:3309, 3320-3333](admin.html:3309))
2. Extraherar `access_token` + `user.email` från Supabase-session-JSON
3. Skriver till **oberoende** localStorage-nycklar: `spick_admin_token`, `spick_admin_email` ([admin.html:3349-3350](admin.html:3349))
4. Öppnar `stadare-dashboard.html?view_as=<cleaner_id>` i ny flik ([admin.html:3351](admin.html:3351))

**Mottagarsida** ([stadare-dashboard.html:2515-2589](stadare-dashboard.html:2515)):
1. Läser `?view_as=` ([stadare-dashboard.html:2515](stadare-dashboard.html:2515))
2. Flaggar `_cleanerLoadStarted = true` för att blockera auth-listener ([stadare-dashboard.html:2519](stadare-dashboard.html:2519))
3. Utökar session-timeout till 10s ([stadare-dashboard.html:2531](stadare-dashboard.html:2531))
4. Läser `spick_admin_token` + `spick_admin_email` från localStorage ([stadare-dashboard.html:2539-2540](stadare-dashboard.html:2539))
5. Admin-check (se Uppgift 2)
6. Hämtar target-cleaner-row med admin's token ([stadare-dashboard.html:2549-2551](stadare-dashboard.html:2549))
7. Tar BORT token från localStorage ([stadare-dashboard.html:2557-2558](stadare-dashboard.html:2557))
8. Injicerar `admin-view-banner` ([stadare-dashboard.html:2563-2572](stadare-dashboard.html:2563))
9. Kör `loadCleanerByEmail(adminEmail, '')` ([stadare-dashboard.html:2577](stadare-dashboard.html:2577))
10. `loadCleanerByEmail` branchar på `_isAdminView + _adminPreloadedCleaner` ([stadare-dashboard.html:2805-2807](stadare-dashboard.html:2805)) — **skippar** auth-lookup, använder preload-datan

### Vad händer med ?view_as=<uuid>?

- Med admin-token i localStorage → admin-check + render av target-cleaner's data
- Utan admin-token → fallback till normalt login-flöde ([stadare-dashboard.html:2584-2592](stadare-dashboard.html:2584))
- Med ogiltig/fel admin-token → admin_users returnerar tom → fallback ([stadare-dashboard.html:2583](stadare-dashboard.html:2583))

---

## Uppgift 2 — Admin-kontroll

### Finns kontroll INNAN view_as appliceras? **JA.**

[stadare-dashboard.html:2543-2547](stadare-dashboard.html:2543):
```js
var adminCheck = await fetch(SUPA_URL + '/rest/v1/admin_users?email=eq.' + encodeURIComponent(adminEmail) + '&select=id', {
  headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + adminToken }
});
var adminRows = await adminCheck.json();
if (Array.isArray(adminRows) && adminRows.length > 0) {
  _isAdminView = true;
  // ...
}
```

Kollar:
- Hämtar JWT från URL-skickad token (via localStorage)
- Anropar PostgREST `admin_users?email=eq.<adminEmail>` som `authenticated`-roll
- RLS-policy `"Authenticated read own admin_users"` ([20260402200002:10-12](supabase/migrations/20260402200002_admin_users_read_policy.sql:10)):
  ```sql
  CREATE POLICY "Authenticated read own admin_users"
    ON admin_users FOR SELECT
    USING (auth.jwt() ->> 'email' = email);
  ```
- Om JWT:s email finns i admin_users → returnerar rad
- Om inte → tom array, admin-view avaktiveras

**`is_admin()`-funktion används INTE** i stadare-dashboard.html (grep 0 träffar i dashboard). Andra migrations använder den (booking_staff m.fl.) men inte här.

**Är säkerhetsrisken att vem som helst kan impersonera via URL-change?** NEJ. Icke-admin som:
- Ändrar URL till `?view_as=<någon_uuid>` → ingen admin-token i localStorage → fallback
- Sätter egen token + egen email i localStorage → admin_users returnerar tom (icke-admin's email finns inte i admin_users) → fallback
- Sätter någon annans token → måste kunna extrahera den → inte URL-attack

Attack kräver att man redan har en admins JWT (stöld eller XSS), vilket är en djupare attack än URL-pilleri.

**MEN:** Om någon lyckas XSS:a stadare-dashboard.html under tidsfönstret mellan [admin.html:3349](admin.html:3349) `setItem` och [stadare-dashboard.html:2557](stadare-dashboard.html:2557) `removeItem` — kan admin-token stjälas. Millisekunder-fönster.

---

## Uppgift 3 — Session-flöde

### Inget session-byte — admin's session behålls genomgående

[stadare-dashboard.html:2577](stadare-dashboard.html:2577) anropar `loadCleanerByEmail(adminEmail, '')` med **admin's e-post**, inte target-cleaner's. Men [stadare-dashboard.html:2805-2807](stadare-dashboard.html:2805) branchar till preload-datan när `_isAdminView`:

```js
if (_isAdminView && _adminPreloadedCleaner) {
  data = _adminPreloadedCleaner;  // target cleaner's row
}
```

**Konsekvens:**
- UI renderas med target-cleaner's profil-data (namn, bio, avatar, ID, etc.)
- MEN alla efterföljande API-anrop går med **admin's JWT**
- RLS på andra tabeller (bookings, availability, calendar_events) matchar admin's `auth.uid`, inte target's

**Detta betyder att view_as kan visa:**
- Target cleaner's statiska profil-data ✅ (förhämtad)
- Target cleaner's bokningar ❓ (beror på RLS — om bokningar hämtas via `cleaner_id=eq.<target>` OCH RLS tillåter anon/authenticated att läsa alla bokningar, ja. Annars nej.)
- Target cleaner's team-medlemmar ❓ (RLS `company_owner_manage` kräver `auth.uid()` är VD)

Det är **frontend-override med admin-JWT** — inte en äkta impersonation. Admin ser "skalet" av target-cleaner's dashboard men läser data med admin-rättigheter. För tabeller utan admin-policy → 401.

### Körs ny Supabase Auth-session?

**Nej.** `SB.auth.getSession()` anropas inte i view_as-flödet. Admin's session behålls. Target-cleanerns auth-token används aldrig.

---

## Uppgift 4 — Varför 401 på vissa tabeller

### Admin använder `authenticated`-rollen, inte `service_role`

[admin.html:1226-1238 `_adminHeaders()`](admin.html:1226):
```js
async function _adminHeaders() {
  let token = _sessionToken || ANON_KEY;
  // ... hämtar access_token från Supabase-session ...
  return { 'apikey':ANON_KEY, 'Authorization':'Bearer '+token };
}
```

`access_token` är admin's JWT med role=`authenticated`. Anon-key-fallback skulle ge `anon`-roll. **Aldrig `service_role`.**

### RLS per tabell (från SQL-filerna)

| Tabell | Admin-SELECT tillåten? | Källa |
|--------|-----------------------|-------|
| **customer_profiles** | ❌ Bara egen email | [20260402000001:59-63](supabase/migrations/20260402000001_fix_rls_security.sql:59) `auth.jwt() ->> 'email' = email` |
| **companies** | ❌ Bara ägare eller service_role | [companies-and-teams.sql:36-52](sql/companies-and-teams.sql:36) |
| **admin_audit_log** | ❌ Service_role only | [20260402000001:154-156](supabase/migrations/20260402000001_fix_rls_security.sql:154) |
| **cleaner_service_prices** | ❌ Bara VD för eget team | [add-team-pricing-rls.sql:5-24](supabase/add-team-pricing-rls.sql:5) |
| **cleaner_availability** | ❌ Publik SELECT USING(true) men… | [20260326300002:43](supabase/migrations/20260326300002_seed_availability_fix_rls.sql:43) — märkligt, borde tillåta. Om 401 så finns en nyare migration som stängt. |

**Förklaring av 401:**
- admin-user går som `authenticated`
- Ingen av dessa tabeller har `FOR SELECT TO authenticated USING (true)` eller motsvarande för admin-email
- → Alla dessa SELECT-anrop returnerar 401 (eller tom array utan error)

**För cleaner_availability specifikt:** [20260326300002:43](supabase/migrations/20260326300002_seed_availability_fix_rls.sql:43) har `FOR SELECT USING (true)` — ska funka. 401 tyder på att en senare migration omnämnt den, eller att prod inte synkar med migration-filerna.

---

## Uppgift 5 — "hello@spick.se-policy" för UPDATE på cleaners

### Grep-resultat: INGEN sådan policy finns i SQL-filerna

```
rg "hello@spick\.se" supabase/**/*.sql
→ 20260331000001_admin_portal.sql:181 — bara seedning av admin_users
```

**Inga andra träffar.** Om UPDATE på cleaners fungerar från admin.html trots att:
- [007_rls.sql:19-21](supabase/migrations/007_rls.sql:19) kräver service_role
- [20260402100001:70-73](supabase/migrations/20260402100001_slug_languages.sql:70) kräver `auth.uid() = id`

…då finns en policy direkt i Supabase-prod som inte motsvaras av någon migration i repo. **Regel #27-brott: koden i migrations stämmer inte med prod.**

### Verifieringskommando

Kör i Supabase SQL Editor:
```sql
SELECT schemaname, tablename, policyname, cmd, permissive, roles, qual 
FROM pg_policies 
WHERE tablename IN (
  'cleaners', 'customer_profiles', 'companies', 'admin_audit_log',
  'cleaner_service_prices', 'cleaner_availability', 'cleaner_availability_v2',
  'company_service_prices'
)
ORDER BY tablename, policyname;
```

Rapportera policyn som tillåter `farrehagge@gmail.com` eller `hello@spick.se` UPDATE på `cleaners`. Om den saknar motsvarande migration-fil:
1. Skapa migration-fil som återskapar den exakt → Regel #27 kvitteras
2. Eller migrera UPDATE-logiken till en EF med service_role för att slippa policy-fragmentering

---

## Sammanfattning: Faktisk impersonate-säkerhet

**Hinder mot icke-admin impersonation:**
1. RLS på `admin_users` kräver `auth.jwt()->>'email' = email` → bara din egen rad
2. Icke-admin: egen rad finns inte → tom array → fallback till login
3. Token i localStorage är på samma origin — cross-origin attacker blockeras av browser

**Kvarvarande risker:**
1. **Token leak via XSS** på stadare-dashboard.html under tidsfönstret ~0-500ms mellan setItem + removeItem
2. **Ingen audit** — vem impersonerade vem, när, från vilken IP
3. **Admin kan impersonera godtycklig cleaner** utan bekräftelse ("är du säker?")
4. **view_as är ofullständigt** — data som kräver target-cleanerns auth (bookings, availability, team) läses med admin's JWT → RLS-filtrerar, admin ser färre bokningar än target-cleanerns faktiska
5. **Ingen tidsgräns** — om admin glömmer stänga fliken fortsätter admin-banner visa "hanterar X's dashboard" hur länge som helst

**Inget kritiskt säkerhetsproblem, men UX-ofullständighet och audit-brist.**

---

## 🔧 Åtgärder

| # | Åtgärd | Effort | Prio |
|---|--------|--------|------|
| 1 | Verifiera RLS med `pg_policies`-query ovan | 5 min | Först |
| 2 | Lägg till `auditLog('view_as_start', 'cleaner', target_id, ...)` när `_isAdminView=true` (kräver audit_log-fix först) | 20 min | Hög |
| 3 | Lägg till confirm-prompt i `openCleanerDashboard`: "Du kommer impersonera X. Detta loggas. Fortsätt?" | 10 min | Medel |
| 4 | Backend-impersonate via EF: admin skickar `{target_cleaner_id}` → EF returnerar tillfällig JWT för target (max 30 min) | 3-4h | Låg (current är säker) |
| 5 | Återskapa "hello@spick.se-policy" i migration-fil om den finns i prod → Regel #27 | 15 min | Hög |

---

## Rättelse till tidigare audit

I [2026-04-19-admin-impersonation-vs-editing.md](docs/audits/2026-04-19-admin-impersonation-vs-editing.md) skrev jag:

> **🔴 INGEN impersonate-funktion finns.** Grep efter `impersonate|masquerade|assume_role|login_as|switch_user|become_user|actAs` → **0 träffar**.

Det var tekniskt korrekt (de söktermerna gav 0), men **jag missade `view_as`/`viewAs`-varianten**. Borde ha grepat bredare med `view.?as|_as.?|actingAs|switchTo`. Rapporten uppdateras inte retroaktivt — denna fil är korrektionen.

Läxa för framtida audits: grep efter **semantik**, inte bara kända namnkonventioner. "Impersonate" är engelska jargong; svenskt/egensnickrat kan heta vad som helst.
