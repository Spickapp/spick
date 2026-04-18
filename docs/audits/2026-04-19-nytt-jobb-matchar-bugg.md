# "Nytt jobb matchar dig"-bugg — 2026-04-19

**Symptom:** Räknaren visar "1 nytt jobb matchar dig" för Zivar i view_as, trots att prod har 4 bokningar (alla completed/paid, alla tilldelade Farhad). Ingen öppen bokning existerar.
**Metod:** Regel #26 + #27 — alla påståenden citerar fil:rad.
**Uppföljning till:** [2026-04-19-nytt-jobb-matchar-notis.md](docs/audits/2026-04-19-nytt-jobb-matchar-notis.md)

---

## 🚨 TL;DR

Räknaren beräknas **exakt på en plats** ([stadare-dashboard.html:4032-4037](stadare-dashboard.html:4032)) med **data från en plats** ([stadare-dashboard.html:3107/3112](stadare-dashboard.html:3107)). Inget hardcoded.

**Sannolik rotorsak** till att räknaren visar 1 trots 0 synliga unassigned bokningar: **det finns en 5:e bokning i prod som inte syntes när du räknade** — troligen med `email='hello@spick.se'` eller `farrehagge@gmail.com`, `cleaner_id=NULL`, `payment_status='paid'`. RLS släpper igenom den för admin (via `email = jwt.email`-policyn), men skulle inte visas för Zivar i en riktig session.

Den är inte Farhads eller Zivars bokning som cleaner — den är en bokning där Farhad står som **kund**.

---

## Uppgift 1 — Rendering

### Räknaren skrivs till DOM på EXAKT en plats
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

**Verifikation att detta är enda renderingsstället:**
```
grep -n "teaser-count|teaser-text|jobs-teaser" stadare-dashboard.html
```
Träffar:
- [990](stadare-dashboard.html:990): HTML-placeholder `<span class="count" id="teaser-count">0</span>`
- [991](stadare-dashboard.html:991): HTML-placeholder `<span ... id="teaser-text">nya jobb matchar dig</span>`
- [4033](stadare-dashboard.html:4033): `document.getElementById('jobs-teaser')` i renderJobsTeaser
- [4036-4037](stadare-dashboard.html:4036): **enda set-punkten för textContent**

**Regel #28-status:** Ingen fragmentering. Källa och konsumtion är central.

### Räknarens trigger-kedja
[stadare-dashboard.html:3132](stadare-dashboard.html:3132) `renderHome()` anropar `renderJobsTeaser()`.
`renderHome` anropas från:
- [stadare-dashboard.html:3119](stadare-dashboard.html:3119) `loadJobs() → renderHome()`
- flera actions efter `acceptJob`/`declineJob` som kör `loadJobs()` igen

---

## Uppgift 2 — Datakälla

### Data hämtas på EXAKT en plats
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

### Bryter ner filtren

**myJobs ([3106](stadare-dashboard.html:3106)):** `cleaner_id=eq.${cleaner.id}` garanterar att alla rader har cleaner_id=cleaner.id (icke-null). Dessa uteslutas av `!j.cleaner_id`-filtret i renderJobsTeaser.

**cityJobs ([3107](stadare-dashboard.html:3107)):** `cleaner_id=is.null & payment_status=eq.paid` — PostgREST översätter till SQL `cleaner_id IS NULL AND payment_status = 'paid'`.

**allOpen-fallback ([3112](stadare-dashboard.html:3112)):** Samma filter som cityJobs men limit 10 istället för 15. Körs bara om `cityJobs.data` är tomt.

**Dock** — båda queriar samma filter, så om cityJobs returnerade [] gör allOpen det också. Fallbacken är **meningslös duplikat** och gör ingen skillnad. Regel #28-brott.

### Tabell
`bookings` (inte `job_matches`, inte `job_queue`, inte `notifications`).

### Används view_as korrekt?
`cleaner.id` på [3106](stadare-dashboard.html:3106) = Zivars id (eftersom [2805-2807](stadare-dashboard.html:2805) sätter `cleaner = _adminPreloadedCleaner`).

MEN — queryn körs med **admin's JWT** via [_authHeaders:2234-2238](stadare-dashboard.html:2234). RLS applicerar på admin's identitet, inte Zivars.

---

## Uppgift 3 — Bugg-identifiering

### Uteslutna hypoteser

| Hypotes | Verifierad? | Bevis |
|---------|------------|-------|
| Hardcoded värde | ❌ NEJ | HTML default = "0" ([990](stadare-dashboard.html:990)). Enda JS-skriv vid [4036](stadare-dashboard.html:4036) |
| Fel filter (räknar completed) | ❌ NEJ | Filter är `cleaner_id=is.null & payment_status=paid`, inte status-baserat |
| Annan tabell än bookings | ❌ NEJ | Bara `bookings` queryas i loadJobs |
| Räknar admin-sessionens cleaner_id (Farhad) | ❌ NEJ | `cleaner.id` är Zivars efter view_as-branch på [2805](stadare-dashboard.html:2805) |
| Annan variabel sätter `jobs`-arrayen | ❌ NEJ | Grep: `jobs\s*=` → bara [2288](stadare-dashboard.html:2288), [2797](stadare-dashboard.html:2797), [3117](stadare-dashboard.html:3117) |

### Kvarvarande hypotes: RLS + Farhad-kund-bokning

**För att räknaren ska vara 1 krävs:** `R.select('bookings', 'cleaner_id=is.null&payment_status=eq.paid')` returnerar exakt 1 rad med admin's JWT.

RLS-policy på bookings ([20260402000001:20-26](supabase/migrations/20260402000001_fix_rls_security.sql:20)):
```sql
CREATE POLICY "Auth read own bookings"
  ON bookings FOR SELECT TO authenticated
  USING (
    email = (current_setting('request.jwt.claims', true)::json->>'email')
    OR cleaner_id = auth.uid()
  );
```

Admin's JWT:
- `email` = hello@spick.se (eller farrehagge@gmail.com)
- `auth.uid()` = admin's auth.users-id

För admin returnerar RLS: rader där **kundens** email matchar admin's email. Detta är **bokningar Farhad har gjort som kund** (testbokningar).

**Om en sådan bokning har:** `cleaner_id=NULL` + `payment_status='paid'` → räknas.

Detta förklarar varför räknaren visar 1 trots att du säger att inga öppna bokningar finns. Du har troligen räknat bokningar som är TILLDELADE (till Farhad som cleaner), men missade en bokning där Farhad är KUND.

---

## Uppgift 4 — Verifiera via Zivars riktiga session

### Om Zivar loggar in själv
- Zivars JWT: `email = zivar@...`, `auth.uid() = zivar.auth_user_id`
- RLS-filter: rader där `email = 'zivar@...' OR cleaner_id = zivar.auth_user_id`
- `cleaner_id` lagrar cleaners.id, inte cleaners.auth_user_id → policy matchar aldrig
- Endast rader där kund-email matchar Zivars email visas

**Zivar skulle se 0 öppna jobb** (han har inte gjort några bokningar som kund).

### Hypotesen bekräftas av utfallet
Om räknaren visar 1 för admin i view_as men 0 för Zivar i riktig session → **bekräftar att det är admin's testbokning som räknas**.

---

## Uppgift 5 — SQL-verifikation

Kör i Supabase SQL Editor:

```sql
-- 1. Finns bokning med admin som kund + öppen + betald?
SELECT id, email, cleaner_id, payment_status, status, booking_date, total_price
FROM bookings
WHERE email IN ('hello@spick.se', 'farrehagge@gmail.com')
  AND cleaner_id IS NULL
  AND payment_status = 'paid';
-- Förväntat utfall: 1 rad (den som räknaren visar)

-- 2. Alla unassigned paid bookings (admin's perspektiv via RLS)
SELECT id, email, cleaner_id, payment_status, status
FROM bookings
WHERE cleaner_id IS NULL AND payment_status = 'paid';
-- Förväntat: samma 1 rad om hypotesen stämmer, eller fler om andra kunder har öppna

-- 3. Verifiera att Zivar skulle se 0
SELECT COUNT(*)
FROM bookings
WHERE (email = '<Zivars email>' OR cleaner_id = '<Zivars id>')
  AND cleaner_id IS NULL
  AND payment_status = 'paid';
-- Förväntat: 0

-- 4. RLS-policies på bookings — verifiera vad som faktiskt finns
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'bookings'
ORDER BY policyname;
```

**Om query 1 returnerar 1 rad** → hypotes bekräftad. Ta bort raden (om testbokning) eller tilldela cleaner_id → räknaren går till 0.

**Om query 1 returnerar 0 rader men räknaren ändå visar 1** → hypotes fel. Då finns en annan källa (cache, undocumented policy) och vi behöver gräva vidare.

---

## 🔧 Åtgärder

### Demo-tillfällig (imorgon)
1. Ta bort eventuell testbokning där `email=hello@spick.se AND cleaner_id IS NULL`.
2. Hårdrefresh i view_as (Ctrl+Shift+R) för att säkerställa ingen SW-cache.
3. Kontrollera att räknaren försvinner.

### Permanenta fixar
| # | Åtgärd | Effort | Fil |
|---|--------|--------|-----|
| 1 | Ta bort fallback-duplikatet på [stadare-dashboard.html:3111-3114](stadare-dashboard.html:3111) (samma query som [3107](stadare-dashboard.html:3107)) | 2 min | Regel #28 |
| 2 | Byt text "matchar dig" → "öppna jobb i systemet" tills faktisk matchning implementeras | 5 min | UX-honesty |
| 3 | Fixa view_as: loadJobs bör använda target-cleanerns perspektiv via EF med service_role | 3-4h | Se [2026-04-19-view-as-impersonate-analys.md](docs/audits/2026-04-19-view-as-impersonate-analys.md) |
| 4 | Implementera faktisk matchning (stad + service + avstånd) via `cleaner-job-match` EF (finns redan) | 1-2h | UX-sanning |

---

## Rättelse: fragmentering finns INTE

Jag förväntade mig hitta fragmentering (flera ställen som uppdaterar teaser-count). Det stämmer inte — rendering och datakälla är centrala. Däremot finns:

- **Duplikat-query** på [3107](stadare-dashboard.html:3107) och [3112](stadare-dashboard.html:3112) med identiskt filter (bara limit skiljer).
- **Misvisande variabelnamn** `cityJobs` som inte har stadsfilter alls.
- **Ingen koppling till cleaner-job-match EF** trots att matchningslogik existerar i backend.

Regel #28-brotten finns på **semantisk nivå** (matching-funktionalitet fragmenterad mellan frontend-filter och backend-EF som inte kommunicerar), inte på tekniskt renderings-nivå.

---

## Kvarvarande frågor till användaren

1. **Har du testat att logga in som Zivar på riktigt** och se vad räknaren visar då? Om den är 0 — hypotes bekräftad.
2. **Kör SQL query 1 ovan** — returnerar den 1 rad? Vad är email?
3. **Hardrefresh-test**: i view_as-fliken, tryck Ctrl+Shift+R. Om räknaren ändras → SW-cache. Om inte → data-fråga.
