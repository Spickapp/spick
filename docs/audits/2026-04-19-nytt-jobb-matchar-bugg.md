# "Nytt jobb matchar dig"-bugg — 2026-04-19 (v2)

**Symptom:** Räknaren visar "1 nytt jobb matchar dig" för Zivar i view_as, trots:
- `v_available_jobs_with_match` (prod-view, inte i migrations): 0 rader
- `jobs` (prod-tabell, inte i migrations): 37 rader, alla completed
- `bookings` med `status != 'completed'`: 0 rader

**Metod:** Regel #26 + #27 + #28 — alla påståenden citerar fil:rad + primärkälla.
**Tidigare rapport vid samma sökväg skrivs över** — v2 tar hänsyn till användarens nya prod-data.

---

## 🚨 TL;DR — Exakt rotorsak

**Räknaren läser från EXAKT en källa:** `bookings` via `R.select('bookings', ...)` på [stadare-dashboard.html:3107](stadare-dashboard.html:3107). Den läser INTE från `v_available_jobs_with_match`, `jobs`-tabellen, `job_matches`, eller `notifications` (grep-verifierat).

**För att räknaren ska visa 1 krävs att SQL-queryn returnerar exakt 1 rad.** Queryn är:
```
cleaner_id IS NULL AND payment_status = 'paid'
```

**Användarens verifikation uteslöt inte denna kombination.** "bookings med status != completed: 0" fångar inte rader med:
- `status = 'completed'` (passerar filtret `status != 'completed'`)  
- `cleaner_id IS NULL` (ovanligt men inte otillåtet)
- `payment_status = 'paid'`

**Hypotes:** Det finns 1 rad i `bookings` med **status='completed' AND cleaner_id IS NULL AND payment_status='paid'**. Detta är semantiskt märkligt (en "klar" bokning utan cleaner) men kan uppstå vid: refund-flöde som nollställer cleaner_id, manuell admin-ändring, eller gammal testdata.

**Verifieras omedelbart** med SQL nedan.

---

## Uppgift 1 — Rendering (± kod)

### Enda renderings-stället
[stadare-dashboard.html:4031-4041](stadare-dashboard.html:4031):
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

**HTML-initialtillstånd:**
[stadare-dashboard.html:988-992](stadare-dashboard.html:988):
```html
<div class="jobs-teaser" id="jobs-teaser" style="display:none" onclick="switchTab('jobb')">
  <span class="count" id="teaser-count">0</span>
  <span id="teaser-text">nya jobb matchar dig</span>
</div>
```

Initialvärde **display:none**. För att bli synlig MÅSTE `renderJobsTeaser()` köras med `open.length > 0`.

### Verifikation att INGET annat sätter räknaren
Grep `teaser-count|teaser-text` i hela repo:
- [990](stadare-dashboard.html:990), [991](stadare-dashboard.html:991) — HTML-markup
- [4036-4037](stadare-dashboard.html:4036) — **enda JS-skrivaren**

**0 andra skrivpunkter.** Ingen realtime-callback, ingen innerHTML-injection, ingen hardcoded värdesättning.

### Trigger-kedja för renderJobsTeaser
[stadare-dashboard.html:3132](stadare-dashboard.html:3132) `renderHome() → renderJobsTeaser()`
[stadare-dashboard.html:3119](stadare-dashboard.html:3119) `loadJobs() → renderHome()`
[stadare-dashboard.html:5089-5092](stadare-dashboard.html:5089) realtime-callback på `postgres_changes` för `bookings` → `loadJobs()`

Alla vägar går genom `loadJobs()`.

---

## Uppgift 2 — Datakälla

### Enda datakällan
[stadare-dashboard.html:3104-3117](stadare-dashboard.html:3104):
```js
async function loadJobs() {
  const [myJobs, cityJobs] = await Promise.all([
    R.select('bookings', `select=*&cleaner_id=eq.${cleaner.id}&payment_status=in.(paid,pending)&order=booking_date.asc`),
    R.select('bookings', `select=*&payment_status=eq.paid&cleaner_id=is.null&order=booking_date.asc&limit=15`)
  ]);

  let openJobs = cityJobs.data || [];
  if (!openJobs.length) {
    const { data: allOpen } = await R.select('bookings', `select=*&payment_status=eq.paid&cleaner_id=is.null&order=booking_date.asc&limit=10`);
    openJobs = allOpen || [];
  }

  const mySet = new Set((myJobs.data || []).map(j => j.id));
  jobs = [...(myJobs.data || []), ...openJobs.filter(j => !mySet.has(j.id))];
```

**Tabell:** `bookings` (REST-endpoint `/rest/v1/bookings`)

**Filter för "öppna jobb" (cityJobs + allOpen-fallback):**
- `payment_status = 'paid'`
- `cleaner_id IS NULL`
- **INGET filter på status** — completed, bekräftad, pending, avbokad allt passerar
- **INGET filter på stad/service/avstånd** trots variabelnamnet "cityJobs"

**View_as-status:**
- `cleaner.id` på [3106](stadare-dashboard.html:3106) = Zivars id (efter view_as-branch [2805-2807](stadare-dashboard.html:2805) satt cleaner = target)
- RLS-filtret appliceras dock på **admin's JWT** (via [_authHeaders:2234-2238](stadare-dashboard.html:2234) som läser `sb-...-auth-token`)
- cityJobs-queryn har inget cleaner-filter alls — returnerar vad RLS släpper igenom

---

## Uppgift 3 — Hardcoded-check

**Är värdet 1 hardcoded?** **NEJ.**

Grep efter `teaser-count|teaser-text`:
- 2 HTML-placeholders: båda säger "0" / "nya jobb matchar dig"
- 1 JS-write: från `open.length` (dynamiskt)

Grep efter `'1'` nära teaser-element: inga relevanta träffar.

**Finns test-data eller mock-rader i koden?** **NEJ.**

Grep `mock|fake|dummy|test.*job` i stadare-dashboard.html:
- Inga job-mock-data
- Alla rendering-anrop använder `jobs` JS-variabeln som kommer från `bookings`-queryn

---

## Uppgift 4 — Real-time subscription

### Enda subscription för bookings
[stadare-dashboard.html:5088-5097 `setupRealtime()`](stadare-dashboard.html:5088):
```js
function setupRealtime() {
  realtimeCh = SB.channel('bookings-rt')
    .on('postgres_changes', {event:'*',schema:'public',table:'bookings'}, () => {
      loadJobs();
      showToast('🔄 Uppdateringar mottagna');
    })
    .subscribe(status => {
      document.getElementById('rt-status').style.display = status === 'SUBSCRIBED' ? 'inline-flex' : 'none';
    });
}
```

**Beteende:**
- Lyssnar på ALLA postgres_changes på bookings
- Vid event → kör `loadJobs()` igen (färsk query)
- Ingen direkt mutation av `jobs`-arrayen

**Stängs subscription?**
[stadare-dashboard.html:2795](stadare-dashboard.html:2795): `if (realtimeCh) SB.removeChannel(realtimeCh);` — i logout-flödet. I view_as körs inget explicit logout, så subscriptionen kan leva vidare om man navigerar bort.

**Stale state-risk:**
Eftersom realtime BARA triggar `loadJobs()` (som gör en färsk query) finns ingen stale-state-risk från subscription själv. `jobs`-arrayen ersätts vid varje `loadJobs()`.

**Dock:** `subscribeCalendarRealtime()` på [4676](stadare-dashboard.html:4676) är en separat subscription för calendar_events — inte relevant för teaser-räknaren.

---

## Uppgift 5 — Fragmentering-check (Regel #28)

### Grep per tabellkälla i stadare-dashboard.html

| Tabell/view | Referenser | Skrivare av `jobs`-arrayen? |
|-------------|-----------|-----------------------------|
| `bookings` | ✅ [3106-3107](stadare-dashboard.html:3106), [3112](stadare-dashboard.html:3112), + många andra | Ja, enda källan |
| `v_available_jobs_with_match` | ❌ 0 träffar (grep) | Nej |
| `jobs` (som DB-tabell) | ❌ 0 träffar som DB-referens | Nej (bara JS-variabeln heter `jobs`) |
| `job_matches` | ❌ 0 träffar | Nej |
| `notifications` | ⚠️ ~10 träffar, ingen för job-teaser | Nej |

### 🟢 Ingen fragmentering på renderings-nivå

Grep `^\s*jobs\s*=|jobs\s*=\s*\[` i stadare-dashboard.html ger exakt 3 träffar:
- [2288](stadare-dashboard.html:2288): `let cleaner = null, jobs = [], realtimeCh = null, countdownTimer = null;` — init
- [2797](stadare-dashboard.html:2797): `cleaner = null; jobs = [];` — reset vid logout
- [3117](stadare-dashboard.html:3117): `jobs = [...(myJobs.data || []), ...openJobs.filter(j => !mySet.has(j.id))];` — enda datasättning

**Inget annat ställe skriver till `jobs`-variabeln.** Ingen `jobs.push`, `jobs.unshift`, `jobs.concat`, `jobs.splice`. Grep verifierat.

### 🔴 Fragmentering på prod-arkitektur-nivå

**Prod har flera källor som INTE används av frontend:**
- `v_available_jobs_with_match` — 0 rader (finns, men stadare-dashboard ignorerar)
- `jobs`-tabell — 37 rader (finns, men stadare-dashboard ignorerar)
- `cleaner-job-match` EF — finns ([supabase/functions/cleaner-job-match](supabase/functions/cleaner-job-match)), **grep efter "cleaner-job-match" i stadare-dashboard.html → 0 träffar**

Dvs någon byggde backend-matchnings-infrastruktur (view + table + EF) som stadare-dashboard aldrig anropar. Det är Regel #28-brott på infrastruktur-nivå — plus Regel #27: `v_available_jobs_with_match` och `jobs`-tabellen finns i prod men saknar migration-fil i repo (grep `CREATE VIEW.*v_available|CREATE TABLE.*\bjobs\b` → 0 träffar).

---

## Slutsats — Varför räknaren visar 1

Logisk härledning:
1. Räknaren skrivs vid [4036](stadare-dashboard.html:4036) med `open.length`
2. `open = jobs.filter(j => !j.cleaner_id)` (rad [4032](stadare-dashboard.html:4032))
3. `jobs` sätts endast vid [3117](stadare-dashboard.html:3117) från `myJobs` + `openJobs`
4. `myJobs` har filter `cleaner_id=eq.X` (alla rader har cleaner_id satt → uteslutna av `!j.cleaner_id`)
5. `openJobs` har filter `cleaner_id=is.null` (alla rader har cleaner_id=NULL → inkluderade)
6. **`open.length === openJobs.length`**
7. För `open.length = 1` krävs exakt 1 rad från bookings med `cleaner_id IS NULL AND payment_status='paid'`

**Det som utesluter andra förklaringar:**
- Ej hardcoded (Uppgift 3)
- Ej annan tabell (Uppgift 2, 5)
- Ej annan JS-source för `jobs` (Uppgift 5)
- Ej stale subscription (Uppgift 4 — subscriptions re-triggar full query)
- HTML-default är 0+display:none, så teaser MÅSTE ha fått en körning med open.length≥1

**Kvarvarande rotorsak:** `bookings`-tabellen innehåller 1 rad med:
- `cleaner_id IS NULL`
- `payment_status = 'paid'`
- `status` kan vara vad som helst (completed, bekräftad, etc — filtret bryr sig inte)

Detta matchar INTE användarens verifikation "bookings med status != completed: 0 rader" — den verifikationen fångade inte rader med `status='completed' AND cleaner_id IS NULL`.

---

## SQL-verifikation (kör detta nu)

```sql
-- 1. Exakt samma query som frontend kör
SELECT id, email, cleaner_id, status, payment_status, booking_date, total_price, customer_address
FROM bookings
WHERE cleaner_id IS NULL
  AND payment_status = 'paid'
ORDER BY booking_date ASC
LIMIT 15;
-- Förväntat: exakt 1 rad (den som räknaren visar)

-- 2. Om query 1 ger 0 rader, kolla om det är 37 rader i "jobs"-tabellen som man pekat på fel
SELECT COUNT(*) FROM jobs WHERE cleaner_id IS NULL;

-- 3. Kontrollera att v_available_jobs_with_match faktiskt är 0
SELECT COUNT(*) FROM v_available_jobs_with_match;
```

**Om query 1 returnerar 1 rad:**
- Notera `id`, `status`, `email`
- Antingen radera (om test) eller tilldela cleaner_id → räknaren går till 0
- Skapa migration-fil för `v_available_jobs_with_match` + `jobs`-tabell (Regel #27-fix)

**Om query 1 returnerar 0 rader:**
- Då har jag fel och vi måste gräva vidare
- Nästa steg: kolla Service Worker-cache ([sw.js](sw.js)) och Supabase REST-endpoint-svar i Network-fliken direkt

---

## 🔧 Åtgärder

### Omedelbart (imorgon demo)
1. Kör query 1 ovan. Om 1 rad — åtgärda enligt ovan.
2. Hardrefresh (Ctrl+Shift+R) i view_as-fliken för att utesluta SW-cache.

### Kort sikt (regel #28)
| # | Åtgärd | Fil |
|---|--------|-----|
| 1 | Ta bort fallback-duplikat på [stadare-dashboard.html:3111-3114](stadare-dashboard.html:3111) (samma filter, bara `limit` skiljer) | 2 min |
| 2 | Byt text "matchar dig" → "öppna jobb" tills matchningen är riktig | 5 min |
| 3 | Lägg till status-filter: `&status=in.(pending,bekräftad,ny)` för att utesluta "klara" oassignerade | 5 min |
| 4 | Integrera `cleaner-job-match` EF för faktisk geografisk/service-matchning | 1-2h |

### Lång sikt (regel #27)
- Skapa migration-fil för `v_available_jobs_with_match` och `jobs`-tabellen om de ska stanna
- Eller ta bort dem om de är död prod-kod (matchar stadare-dashboard:s ignorering)

---

## Frågor till användaren

1. **Kör query 1.** Vad returneras?
2. **Hardrefresh-test:** räknaren ändras?
3. **Vad innehåller `jobs`-tabellens 37 rader?** (är den en kopia av bookings, en audit-log, eller en helt separat struktur?)
