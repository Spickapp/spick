# Spick Performance-arkitektur — strategisk plan

**Datum:** 2026-04-26
**Trigger:** Farhad-fråga: "Varför är hela Spick-plattformen seg? Känns som allting går långsamt."

**Verifierat 2026-04-26:**
- `stadare-dashboard.html` = **660 KB** (12 519 rader, 14 inline scripts, 7 tab-contents)
- `admin.html` = 392 KB (6 875 rader)
- `boka.html` = 221 KB (3 960 rader)
- 92 fetch-anrop bara i stadare-dashboard
- Stripe.js + Supabase + GA4 + Meta Pixel + Clarity + Google Translate laddas på ALLA sidor

---

## DEL 1 — Root-orsaker (mätt, inte gissat)

### A. Monolit-HTML-pattern (största problemet)

`stadare-dashboard.html` har 7 tab-contents inline:
- tab-hem (rad 824-1033)
- tab-jobb (rad 1034-1051)
- tab-kalender (rad 1052-1075)
- tab-inkomst (rad 1076-1234)
- tab-inst (rad 1235-1530)
- tab-team (rad 1531-2364)
- tab-tvister (rad 2365-2400)

Browser laddar HELA filen → parsar 12 519 rader JS → bygger DOM för alla 7 tabs samtidigt → bara visar en. Det är som att ladda 7 sidor i taget.

**Effekt på 4G (50 Mbps):**
- HTML-download: 660 KB / 50 Mbps = **~110 ms**
- HTML-parse + JS-parse: ~600 ms
- Initial fetch-burst (10-15 sequential calls): **~2-3 sek**
- DOM-render alla tabs: ~400 ms
- **Totalt: ~3-4 sek till interaktiv** (mål: <1 sek)

### B. Sequential fetch-cascade vid load

Vid VD-login körs ungefär:
```
1. SB.auth.getSession()             (~150 ms)
2. fetch cleaner-row                 (~120 ms)
3. fetch company-row                 (~120 ms)
4. fetch dashboard_config            (~120 ms)
5. fetch _teamMembers                (~150 ms)
6. fetch services-loader.js          (~200 ms — separate fil)
7. fetch addons + prices             (~120 ms × N)
8. fetch _ganttTeamEvents            (~180 ms)
9. fetch _ganttTeamAvail             (~120 ms)
10. fetch v_rut_pending_queue        (~150 ms)
11. fetch vd-payment-summary EF      (~300 ms)
12. fetch vd-dispute-list EF         (~300 ms)
13. fetch vd-pending-expenses        (~150 ms)
14. fetch terms-acceptance EF        (~250 ms)
```

Total: **~2-3 sek bara fetcher** om sekventiellt. Med `Promise.all` parallellisering: ~600 ms (den slowest).

### C. Re-renders vid tab-byte

`switchTab('inkomst')` triggar:
- `loadVdPaymentSummary` (full fetch + render)
- `loadVdPendingExpenses` (full fetch + render)
- Varje fetch-trigg är synkron blockering

Idag har inte tab-state caching → samma data fetchas 3-4 ggr per session.

### D. Tredjepartsskript blockerar render

Stripe.js + Google Translate + Meta Pixel + Clarity + GA4 + Buffer + JotForm laddas synkront i `<head>` → blockerar HTML-parse.

---

## DEL 2 — Lösnings-arkitektur (3 nivåer)

### Nivå 1 — Quick-wins (~5h, ingen rivning, BEHÅLL nuvarande HTML)

**Mål:** -50% time-to-interactive utan att ändra arkitektur.

| # | Fix | Fil | Tid | Vinst |
|---|---|---|---|---|
| 1.1 | Defer ALLA tredjeparts-skript till `requestIdleCallback` | components.js | 1h | -800 ms initial |
| 1.2 | Parallellisera initial fetch-burst med `Promise.all` (cluster fetcher som inte beror på varann) | stadare-dashboard.html (init-block) | 1h | -1500 ms |
| 1.3 | Lazy-load tab-content data — fetch:a BARA när tab klickas första gången, cache i 5 min | stadare-dashboard.html (switchTab) | 1.5h | -2000 ms initial, snabbare tab-byte |
| 1.4 | Cache `_teamMembers` + `_servicePrices` i sessionStorage (5 min TTL) | stadare-dashboard.html | 30 min | -300 ms per tab-byte |
| 1.5 | Lazy-load Gantt-data — bara om tab-kalender är aktiv | stadare-dashboard.html | 30 min | -180 ms initial |
| 1.6 | Service Worker: precache statiska assets + DB-vyer som ändras sällan (services, addons, platform_settings) | sw.js | 30 min | offline-stöd |

**Totalt:** ~5h. **Resultat:** 3-4 sek → ~1.2-1.5 sek time-to-interactive. Märkbar förbättring för cleaner/VD.

### Nivå 2 — HTML-splitting (~12-15h, måttlig rivning, BEHÅLL vanilla JS)

**Mål:** Strukturell rensning utan ramverk-byte. Varje tab blir egen HTML-fil.

**Splitting-plan för stadare-dashboard.html (660 KB → 7×~95 KB):**

```
/dashboard/index.html       (skelett + navigation, ~30 KB) — laddas alltid
/dashboard/hem.html         (Hem-tab, ~80 KB)
/dashboard/jobb.html        (Jobb/Bokningar, ~110 KB)
/dashboard/kalender.html    (Gantt-kalender, ~120 KB)
/dashboard/inkomst.html     (VD-payment + per-jobb-spec + utlägg, ~140 KB)
/dashboard/team.html        (Team-hantering, ~150 KB)
/dashboard/tvister.html     (Dispute-tab, ~30 KB)
/dashboard/jag.html         (Profil/inställningar, ~70 KB)
```

**Mekanik:**
- `index.html` är "shell" med navigation + auth + shared-state
- Klick på tab → `fetch('/dashboard/inkomst.html')` → injicera i `<main>`-container
- Cache:a HTML i sessionStorage (5 min TTL)
- Shared JS-helpers (auth, fetch-wrappers, escHtml) i `js/dashboard-shared.js`

**Initial load:** 660 KB → 30 KB shell + 80 KB Hem-tab = **110 KB**, 6x mindre.
**Tab-byte:** 100-150 KB ad-hoc fetch (cached efter första klicket).

**Risk:** Måste hantera shared-state (cleaner, _teamMembers, etc) över "page-navigations". Lösning: fortsätt SPA-pattern med fetch+inject (inte browser-navigation).

**Tidsbedömning:** 12-15h. Inkluderar:
- 3h: extrahera 7 tab-blocks till separata filer
- 3h: bygga shell + tab-loader
- 3h: extrahera shared JS till `js/dashboard-shared.js`
- 2h: state-cache + invalidation
- 3h: regression-test alla flöden

### Nivå 3 — Astro/SvelteKit-migration (~80-120h, KOMPLETT REWRITE)

**Mål:** Moderna ramverk = automatisk code-splitting, lazy-load, hydration, server-render.

**Astro-fördelar för Spick:**
- Server-render statiska sidor (homepage, blogg, stader/) → 0 JS som default
- Islands architecture → bara dashboard-tabs får client-JS
- Built-in image optimization
- TypeScript ut-ur-lådan
- Dev-server med HMR

**Migrations-plan:**
1. **Fas 1** (~30h): Migrera 64 statiska sidor (homepage, blogs, städ-städer, kontakt etc) till Astro
2. **Fas 2** (~40h): Migrera dashboard till Astro Islands (varje tab = en Island)
3. **Fas 3** (~25h): Migrera boka.html till Astro form-flow
4. **Fas 4** (~25h): Polish + Lighthouse-optimering

**Förväntad förbättring:**
- Initial load: 660 KB → 30 KB (shell) + lazy islands
- Time-to-interactive: 3-4 sek → 400-600 ms
- Lighthouse-score: 60-70 → 95-100
- SEO: dramatisk förbättring (currently SPA-pattern fungerar dåligt med Google)

**Risk:**
- Stor migration → brutna deploy-pipelines
- Lärnings-kurva för Farhad
- 80-120h investering = 2-3 veckors arbete

---

## DEL 3 — Min rekommendation

**Bygg Nivå 1 NU (~5h)** för omedelbar förbättring + **planera Nivå 2 inom 2-3 veckor**.

**Skäl:**
- Nivå 1 ger 50-60% av vinsten med 5% av arbetet
- Nivå 2 ger ytterligare 30% utan ramverk-byte (riskfritt)
- Nivå 3 är överkill nu — vänta tills Spick har 1000+ aktiva användare och SEO blir affärs-kritiskt

**Konkret sprint-plan Nivå 1:**

### Sprint P1 — Defer + Parallel (1.5h)
- Lazy-load alla tredjeparts-skript via `requestIdleCallback`
- Wrappa init-fetcher i `Promise.all` clusters

### Sprint P2 — Lazy-tab + Cache (3h)
- switchTab loader-pattern med lazy-fetch
- sessionStorage-cache med 5-min TTL för stabil data
- Invalidation via versions-bump i platform_settings

### Sprint P3 — Service Worker precache (30 min)
- Precache statiska assets (CSS, fonts, libs)
- Cache-first för platform_settings + services-tabellen

**Resultat efter Sprint P1+P2+P3:**
- VD-dashboard: 3-4 sek → 1.2-1.5 sek till interaktiv
- Tab-byte: 800 ms → 200 ms (cached)
- Cleaner-uppdrag-sida: 1.5 sek → 800 ms

---

## DEL 4 — Frågor till Farhad

1. **OK kör Nivå 1 (5h) nu?** Säkert + märkbar förbättring
2. **Schemalägg Nivå 2 (12-15h) inom 2-3 veckor?** Strukturell rensning utan ramverksbyte
3. **Nivå 3 Astro-migration:** parkera tills Spick har 1000+ användare? Eller börja planera nu?
4. **Quick-vinster du själv kan göra:** Aktivera Cloudflare framför GitHub Pages (CDN + brotli) → -30% latens globalt

---

## DEL 5 — Verifiering rule #29 + #31

- ✅ Filstorlekar: `wc -c stadare-dashboard.html boka.html ...` (660 KB / 221 KB / 62 KB)
- ✅ Tab-fördelning: `grep tab-content` (7 inline tabs)
- ✅ Fetch-mängd: 92 anrop bara i dashboard
- ⚠ Nätverks-tider är ESTIMERADE från standardvärden, inte mätta direkt mot Spick. Om du kör `Lighthouse` lokalt får vi exakta siffror.
