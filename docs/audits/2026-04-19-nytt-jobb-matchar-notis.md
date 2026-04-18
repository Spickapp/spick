# "Nytt jobb matchar dig"-notis — 2026-04-19

**Symptom:** Zivar har 0 egna jobb men ser "1 nytt jobb matchar dig" i stadare-dashboard.html (via view_as).
**Metod:** Regel #26 + #27 — alla påståenden citerar fil:rad.

---

## 🚨 TL;DR

**Två buggar — en UX, en allvarligare:**

1. **🟡 Texten "matchar dig" är vilseledande.** Räknaren filtrerar bara `cleaner_id=NULL + payment_status=paid` — INGEN stad/service/avstånd/availability-match. Vilken som helst oassignerad bokning räknas för alla cleaners.

2. **🔴 I view_as-läget visar räknaren inte målets verklighet.** RLS-policyn filtrerar bookings på **admin's** JWT-email, inte målets. Admin ser sina egna testbokningar som "öppna jobb åt Zivar". Zivar skulle i verkligheten se ett annat antal.

---

## Uppgift 1 — Notis-logiken

### Räknarens render
[stadare-dashboard.html:4031-4041 `renderJobsTeaser()`](stadare-dashboard.html:4031):
```js
function renderJobsTeaser() {
  const open = jobs.filter(j => !j.cleaner_id);
  const teaser = document.getElementById('jobs-teaser');
  if (open.length > 0) {
    teaser.style.display = 'flex';
    document.getElementById('teaser-count').textContent = open.length;
    document.getElementById('teaser-text').textContent = open.length === 1 ? 'nytt jobb matchar dig' : 'nya jobb matchar dig';
  } else {
    teaser.style.display = 'none';
  }
}
```

**Filter: `!j.cleaner_id`** — allt i `jobs`-arrayen som saknar tilldelad cleaner.

### Text-källa (statisk HTML)
[stadare-dashboard.html:991](stadare-dashboard.html:991) — placeholder-text som överskrivs av [4037](stadare-dashboard.html:4037).

### Triggers som uppdaterar räknaren
- [stadare-dashboard.html:3132 `renderHome() → renderJobsTeaser()`](stadare-dashboard.html:3132) — körs efter `loadJobs()`
- [stadare-dashboard.html:3120 `renderAvailableJobs()` inte teaser](stadare-dashboard.html:3120) — men `renderHome` kallar båda

### Badge (separat indikator)
[stadare-dashboard.html:4069-4087 `updateBadge()`](stadare-dashboard.html:4069) — räknar likadant:
```js
var open = jobs.filter(function(j) { return !j.cleaner_id; });
var pendingConfirm = jobs.filter(function(j) { return j.cleaner_id === cleaner.id && j.status === 'pending_confirmation'; });
count = open.length + pendingConfirm.length;
```

---

## Uppgift 2 — Datakälla

### loadJobs() — där data hämtas
[stadare-dashboard.html:3104-3108](stadare-dashboard.html:3104):
```js
async function loadJobs() {
  const [myJobs, cityJobs] = await Promise.all([
    R.select('bookings', `select=*&cleaner_id=eq.${cleaner.id}&payment_status=in.(paid,pending)&order=booking_date.asc`),
    R.select('bookings', `select=*&payment_status=eq.paid&cleaner_id=is.null&order=booking_date.asc&limit=15`)
  ]);
```

**Tabell:** `bookings` (inte `job_matches`, inte `notifications`, ingen dedikerad jobb-kö-tabell).

**Filter för "cityJobs":**
- `payment_status=eq.paid`
- `cleaner_id=is.null`
- `order=booking_date.asc`
- `limit=15`

### 🚨 Viktigt: filtret har INTE det namnet antyder

Variabeln heter `cityJobs` men det finns:
- ❌ Inget stadsfilter (`city=eq.<cleaner.city>`)
- ❌ Inget servicefilter (`service=in.<cleaner.services>`)
- ❌ Inget avståndsfilter (find_nearby_cleaners RPC används INTE här)
- ❌ Inget availability-filter
- ❌ Inget radius-filter

**Detta är alltså alla globala oassignerade betalda bokningar, inte matchade.**

### jobs-arrayen
[stadare-dashboard.html:3116-3117](stadare-dashboard.html:3116):
```js
const mySet = new Set((myJobs.data || []).map(j => j.id));
jobs = [...(myJobs.data || []), ...openJobs.filter(j => !mySet.has(j.id))];
```

`jobs` = mina jobb + öppna (dedup på ID). `renderJobsTeaser` filtrerar sedan på `!j.cleaner_id` → bara öppna räknas för teaser.

---

## Uppgift 3 — view_as-läget

### cleaner.id i view_as = målets ID
[stadare-dashboard.html:2805-2807 `loadCleanerByEmail`](stadare-dashboard.html:2805):
```js
if (_isAdminView && _adminPreloadedCleaner) {
  data = _adminPreloadedCleaner;  // target cleaner's row
}
```

Efter detta sätts `cleaner = data` (target). Så [loadJobs:3106](stadare-dashboard.html:3106) queryar `cleaner_id=eq.<target_id>` — rätt tanke.

### MEN — JWT är admin's, inte målets

[stadare-dashboard.html:2234-2238 `_authHeaders()`](stadare-dashboard.html:2234):
```js
function _authHeaders() {
  const raw = localStorage.getItem('sb-urjeijcncsyuletprydy-auth-token');
  const token = raw ? (JSON.parse(raw).access_token || ANON_KEY) : ANON_KEY;
  return { 'apikey':ANON_KEY, 'Authorization':'Bearer '+token };
}
```

Läser admin's Supabase-session-token (den som ligger i `sb-...-auth-token` är admin's, för admin-fliken satte ju den). `view_as`-tokenen (`spick_admin_token`) städas bort på [stadare-dashboard.html:2557-2558](stadare-dashboard.html:2557), men den var en KOPIA av samma admin-token, så admin-sessionen i `sb-...-auth-token` används permanent.

### RLS på bookings
[20260402000001_fix_rls_security.sql:20-26](supabase/migrations/20260402000001_fix_rls_security.sql:20):
```sql
CREATE POLICY "Auth read own bookings"
  ON bookings FOR SELECT TO authenticated
  USING (
    email = (current_setting('request.jwt.claims', true)::json->>'email')
    OR cleaner_id = auth.uid()
  );
```

Föregående policy "Anon read bookings USING (true)" DROPPADES i [20260402000001:15](supabase/migrations/20260402000001_fix_rls_security.sql:15).

### Konsekvens för view_as

Admin's JWT:
- `email` = `hello@spick.se` / `farrehagge@gmail.com`
- `auth.uid()` = admin's auth.users-ID (ej cleaner-ID)

För `R.select('bookings', 'cleaner_id=is.null&payment_status=paid&...')`:
- RLS-filter: `email='hello@spick.se' OR cleaner_id=<admin.auth.uid>`
- **Matchar:** Bara bokningar där kundens email är admin's egen (testbokningar Farhad gjort)
- **Matchar inte:** Zivars faktiska öppna jobb-pool

### Varför Zivar "ser 1 nytt jobb"

Troligt scenario:
1. Farhad har en egen testbokning (email=hello@spick.se) som är paid + cleaner_id=NULL
2. RLS släpper igenom den för admin's JWT
3. Räknaren visar "1 nytt jobb matchar dig"
4. Det har **ingenting** med Zivar att göra — admin ser sin egen öppna testbokning

Om Zivar loggar in på riktigt:
- Hans JWT: email=zivar@..., auth.uid=zivar.auth_user_id
- RLS: `email='zivar@...' OR cleaner_id=<zivar.id>`
- Visar: Zivars egna bokningar där HAN är kund (troligen 0) + inga öppna jobb (cleaner_id=NULL matchar inte hans auth.uid)
- **Zivar skulle faktiskt se 0 öppna jobb** för att han inte har SELECT-rättighet på oassignerade bokningar!

### Ytterligare bugg: cleaners ser ALDRIG öppna jobb i prod

Detta är en bredare bugg: den nuvarande RLS tillåter inte cleaners att läsa bokningar de INTE redan är tilldelade. "Öppen jobb-pool"-funktionen i stadare-dashboard ([3107](stadare-dashboard.html:3107)) fungerar bara om det finns en ytterligare policy som tillåter cleaners att läsa `cleaner_id=NULL`-bokningar.

Grep efter sådan policy → 0 träffar. Om funktionen fungerar i prod finns en odokumenterad policy → **Regel #27-brott: migrations saknar det som finns i prod**.

---

## Uppgift 4 — Fallgrop-analys

| Hypotes | Bekräftat? | Fil:rad |
|---------|-----------|---------|
| Läser `bookings.status='ny'/'pending'/'open'` | **Nej** — status-fältet används inte alls i filtret | [3107](stadare-dashboard.html:3107) |
| Har `job_queue`/`job_matches`-tabell | **Nej** — bara `bookings` läses | [3106-3108](stadare-dashboard.html:3106) |
| Hardcoded mockdata | **Nej** — äkta query | — |
| Real-time subscription som ignorerar view_as | Delvis — se [subscribeCalendarRealtime](stadare-dashboard.html:3123) men teaser räknas från `jobs`-arrayen, uppdateras bara vid `loadJobs()`-omstart | — |
| Hämtar globalt (ingen cleaner-filtrering) | **JA** — `cityJobs`-queryn har inget cleaner-relaterat filter alls | [3107](stadare-dashboard.html:3107) |
| RLS filtrerar på fel JWT i view_as | **JA** — admin's JWT används, filtrerar på admin's email, visar admin's testbokningar | [2234-2238](stadare-dashboard.html:2234) + RLS |

---

## Uppgift 5 — SQL mot prod

`supabase`-CLI finns inte i miljön. Kör i Supabase SQL Editor:

```sql
-- 1. Hitta jobb/match-relaterade tabeller
SELECT 
  table_name, column_name 
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND (table_name ILIKE '%job%' OR table_name ILIKE '%match%' 
       OR column_name ILIKE '%match%')
ORDER BY table_name;

-- 2. Hur många "öppna" bokningar finns
SELECT COUNT(*) AS open_count
FROM bookings
WHERE cleaner_id IS NULL AND payment_status = 'paid';

-- 3. Hur många av dem är Farhads egna testbokningar
SELECT COUNT(*) AS admin_test_count,
       string_agg(DISTINCT email, ', ') AS emails
FROM bookings
WHERE cleaner_id IS NULL
  AND payment_status = 'paid'
  AND email IN ('hello@spick.se', 'farrehagge@gmail.com');

-- 4. Vilka RLS-policies finns på bookings
SELECT policyname, cmd, permissive, roles, qual
FROM pg_policies
WHERE tablename = 'bookings'
ORDER BY policyname;
```

**Förväntat utfall om min analys stämmer:**
- Query 2 returnerar N > 0 (öppna jobb finns)
- Query 3 returnerar minst 1 (Farhad har testbokning)
- Query 4 visar bara "Auth read own bookings" (authenticated) + "Anon read booking by uuid header" (anon) + service_role — **ingen policy för att cleaners ska läsa öppna jobb**

Om Zivar i riktig session ser 0 men admin i view_as ser 1 → **bekräftar fallgrop-hypotesen**.

Om Zivar i riktig session ser N > 0 → **finns undocumented policy** i prod. Hitta den och skapa migration-fil.

---

## 🔧 Åtgärder

| # | Åtgärd | Effort | Prio |
|---|--------|--------|------|
| 1 | **Byt texten** från "matchar dig" till "Öppna jobb" eller "Tillgängliga jobb" tills faktisk matchning implementeras | 5 min | Snabb UX-fix |
| 2 | **Lägg till faktisk matchning:** filtrera `cityJobs` på cleaner.city + cleaner.services (eller använd `cleaner-job-match` EF som redan finns) | 1-2h | Medel |
| 3 | **Fixa view_as:** `loadJobs()` bör använda target-cleanerns perspektiv. Två alternativ: (a) backend-EF som returnerar jobs för given cleaner_id via service_role, (b) temporär impersonation-token från EF | 3-4h | Viktigt för demon |
| 4 | **Verifiera RLS:** kör pg_policies-query ovan. Om cleaners faktiskt kan läsa öppna jobb — dokumentera policyn i migration | 5 min | Först |
| 5 | **Städa döda kodvariabler:** `cityJobs` → `unassignedJobs` (den har inget stadsfilter) | 2 min | Regel #28 |

---

## Demo-impact (imorgon)

- Zivar's "nytt jobb matchar dig"-notis är **vilseledande i view_as**. Visa det inte på mötet som "så ser Zivars dashboard ut".
- Säg istället: "När Zivar loggar in själv ser han faktiska matchningar baserat på stad+service" — vilket också är en framtidsbild tills åtgärd 2 implementeras.
- Dialog med Rafael: klargör att matchning är "alla öppna jobb" idag, inte geografi- eller service-specifikt.

---

## Referenser

- [2026-04-19-view-as-impersonate-analys.md](docs/audits/2026-04-19-view-as-impersonate-analys.md) — view_as-flödet och RLS-situation
- [2026-04-19-boka-cleaner-filter-bugg.md](docs/audits/2026-04-19-boka-cleaner-filter-bugg.md) — find_nearby_cleaners RPC finns och används på kundsidan, men inte här
- `cleaner-job-match` EF (supabase/functions/cleaner-job-match) — matchningslogik finns men används inte i loadJobs
