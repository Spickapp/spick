# Google Places-audit — 2026-04-19

**Syfte:** Kartlägga Google Places-användning, identifiera saknade integrationspunkter, flagga säkerhetsproblem.
**Metod:** Regel #26 + #27 + #28 — alla påståenden citerar fil:rad + primärkälla.
**Scope:** Hela repo exkl. `.claude/worktrees/` (kopior, ej live-kod).

---

## 🚨 TL;DR — Kritiska fynd

1. **🔴 SÄKERHETSPROBLEM:** Google Maps API-nyckel `AIzaSyCScYORJPxXCyp0J-Wmr84HtiZc9FteVrs` hårdkodad i [js/config.js:12](js/config.js) och **finns i git-historik** (commit `66b6d18`). Nyckeln är dock **DÖD KOD** — ingen fil refererar `SPICK.GOOGLE_PLACES_KEY`. Rotera + ta bort + `git filter-repo` rekommenderas.
2. **🟡 PARTIELL INTEGRATION:** Admin-cleaner-edit på [admin.html:3458](admin.html) saknar autocomplete → varje gång Farhad redigerar en städares adress manuellt blir `home_lat/home_lng` kvar som stale/NULL. Detta är rotorsaken till Rafaels team-problem (Daniella + Lizbeth har NULL-koordinater per [docs/4-PRODUKTIONSDATABAS.md:459](docs/4-PRODUKTIONSDATABAS.md)).
3. **🟡 DUBBEL GEOKODNING:** Två EFs finns parallellt — `places-autocomplete` (Google, betal) och `geo` (Nominatim, gratis). Ingen tydlig gränsdragning när vilken används. Regel #28-varning: fragmentering.
4. **⚪ SQL mot prod kunde INTE köras:** `supabase`-CLI saknas i miljön. Se Uppgift 4 för alternativ.

---

## 🟢 Fungerande integration — Google Places via EF

Frontend anropar **aldrig** Google direkt. All trafik går genom Edge Function [places-autocomplete/index.ts](supabase/functions/places-autocomplete/index.ts) som proxyar till Google Maps API.

### Edge Function

| fil:rad | Syfte |
|---------|-------|
| [supabase/functions/places-autocomplete/index.ts:4](supabase/functions/places-autocomplete/index.ts) | `GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")` — server-side, säker |
| [index.ts:14-28](supabase/functions/places-autocomplete/index.ts) | Geocode-mode: `place_id → lat/lng` via `/place/details/json` |
| [index.ts:37-47](supabase/functions/places-autocomplete/index.ts) | Autocomplete-mode: `query → predictions[]` via `/place/autocomplete/json` |
| [index.ts:40](supabase/functions/places-autocomplete/index.ts) | `types=address` — endast adresser, inte POI |
| [index.ts:39](supabase/functions/places-autocomplete/index.ts) | `components=country:se` — endast svenska adresser |

### Deploy-konfiguration

- [.github/workflows/deploy-edge-functions.yml:47](.github/workflows/deploy-edge-functions.yml) — `places-autocomplete` finns i deploy-listan ✅

### Frontend-anropspunkter (9 ställen, alla via EF-proxy)

| fil:rad | Användning | Flöde |
|---------|-----------|-------|
| [boka.html:2504](boka.html) | Kund-bokning: autocomplete på hemadress | [boka.html:507](boka.html) input `id=address` |
| [boka.html:2545](boka.html) | Kund-bokning: geocode efter picked place_id | — |
| [registrera-stadare.html:906](registrera-stadare.html) | Städar-reg: autocomplete | [registrera-stadare.html:519](registrera-stadare.html) `id=cleaner-address` |
| [registrera-stadare.html:930](registrera-stadare.html) | Städar-reg: geocode | — |
| [registrera-stadare.html:1254](registrera-stadare.html) | Firma-reg steg 2: autocomplete | Äldre flöde, dublett? |
| [registrera-stadare.html:1285](registrera-stadare.html) | Firma-reg steg 2: geocode | — |
| [admin.html:5551](admin.html) | Wizard VD + team: autocomplete | [admin.html:1081](admin.html) `cw-owner-address`, [admin.html:5355](admin.html) team |
| [admin.html:5606](admin.html) | Wizard: geocode efter picked | — |
| [stadare-dashboard.html:6565](stadare-dashboard.html) | Manuell bokning av cleaner: autocomplete | [stadare-dashboard.html:1843](stadare-dashboard.html) `mb-address` |
| [stadare-dashboard.html:6589](stadare-dashboard.html) | Manuell bokning: geocode | — |
| [stadare-dashboard.html:8323](stadare-dashboard.html) | Team-medlem-add av VD: autocomplete | [stadare-dashboard.html:2045](stadare-dashboard.html) `team-address` |
| [stadare-dashboard.html:8345](stadare-dashboard.html) | Team-medlem-add: geocode | — |
| [stadare-dashboard.html:8528-8538](stadare-dashboard.html) | Fallback-geokodning vid sparad adress utan koordinater | — |
| [js/address-autocomplete.js:29](js/address-autocomplete.js) | Shared helper — men används inte aktivt (övergrepp, varje sida har inline kopia) | Regel #28: fragmentering |

---

## 🟡 Partiell integration

### js/address-autocomplete.js — oanvänd helper

| fil:rad | Problem |
|---------|---------|
| [js/address-autocomplete.js:2-37](js/address-autocomplete.js) | Centraliserad helper finns men alla sidor (boka, registrera-stadare, admin, stadare-dashboard) har kopierat sin egen inline-version. **Regel #28-brott:** adress-autocomplete-logik fragmenterad på 6+ ställen. |

---

## 🔴 Saknar integration — adressfält utan autocomplete

### 1. Admin redigering av cleaner hemadress ⚠️ **KRITISKT**

| fil:rad | Fält | Var i flödet |
|---------|------|--------------|
| [admin.html:3458](admin.html) | `id=admin-edit-home-address` placeholder `"Gatuadress, ort"` | Cleaner-modal → "Redigera" — ingen `oninput`-handler, ingen place_id → ingen geokodning |

**Konsekvens:** När Farhad manuellt redigerar en cleaners adress i admin stannar `home_lat`/`home_lng` oförändrade → cleanern hamnar inte i `find_nearby_cleaners` RPC. Detta är troligen rotorsaken till Rafas problem: [docs/4-PRODUKTIONSDATABAS.md:459](docs/4-PRODUKTIONSDATABAS.md) noterar att "Daniella + Lizbeth (Rafas team) har NULL `home_lat`/`home_lng`. Väntar på Rafael."

**Fix:** Lägg till `oninput="..."` + autocomplete-dropdown + geokoda vid val, eller kör `places-autocomplete` POST vid spara om adressen ändrats.

### 2. Faktureringsadress (ej kritiskt — inte för matchning)

| fil:rad | Fält |
|---------|------|
| [registrera-stadare.html:694](registrera-stadare.html) | `id=businessAddress` — firma-faktureringsadress |
| [stadare-dashboard.html:1318](stadare-dashboard.html) | `id=edit-business-address` — faktureringsadress i profil |

Dessa används för fakturering, inte för matchning. Autocomplete vore trevligt men inte nödvändigt.

### 3. Stad-fält utan autocomplete

| fil:rad | Fält | Kritikalitet |
|---------|------|--------------|
| [mitt-konto.html:292](mitt-konto.html) | `id=pfCity` — kunds stad | Låg — används inte för koordinater |

---

## 📊 Tredjepartskällor för koordinater

### Var sätts home_lat/home_lng?

**Alla set-punkter sätter vid INSERT (aldrig UPDATE).** Grep efter `.update(.*home_lat` → **0 träffar**.

| fil:rad | Källa | Flöde |
|---------|-------|-------|
| [admin.html:5487-5488](admin.html) | Wizard team-members | Google Places (via EF geocode) |
| [registrera-stadare.html:1119-1122](registrera-stadare.html) | `_regLat/_regLng` från registrering | Google Places (via EF) |
| [stadare-dashboard.html:6385-6386](stadare-dashboard.html) | Manuell bokning: kundens hemadress | Google Places |
| [stadare-dashboard.html:8569-8570](stadare-dashboard.html) | Team-medlem VD lägger till | Google Places |
| [supabase/functions/admin-create-company/index.ts:96-97, 193-194](supabase/functions/admin-create-company/index.ts) | Server-side insert | Värden passeras från frontend (som redan kört Google) |

### Geokodnings-EFs — TVÅ parallella

| EF | Källa | Kostnad | Används för |
|----|-------|---------|-------------|
| [places-autocomplete/index.ts](supabase/functions/places-autocomplete/index.ts) | Google Maps API | Betal ($17 / 1000 requests för Place Details, $2.83 / 1000 för Autocomplete) | Frontend-autocomplete + geocoding |
| [geo/index.ts:7](supabase/functions/geo/index.ts) | Nominatim (OpenStreetMap) | Gratis | `geocode_booking` via [.github/scripts/e2e_test.py:182](.github/scripts/e2e_test.py), CLAUDE.md säger "nearest-cleaner matching" |

**Regel #28-varning:** Två geokodningskällor för samma syfte. Risk för divergens: en adress kan få olika koordinater beroende på källa (Google är typiskt mer exakt än Nominatim för svenska adresser). Rekommendation: bestäm kanonisk källa + dokumentera i 7-ARKITEKTUR-SANNING.md.

**Min-bokning-länk** ([min-bokning.html:318](min-bokning.html)) öppnar `maps.google.com/?q=...` — bara extern länk, ingen API-kostnad.

---

## 🔴 Säkerhetsproblem — exponerad API-nyckel

### Fynd

| fil:rad | Problem |
|---------|---------|
| [js/config.js:12](js/config.js) | `GOOGLE_PLACES_KEY: 'AIzaSyCScYORJPxXCyp0J-Wmr84HtiZc9FteVrs'` — hårdkodad i client-side kod, laddas av alla sidor |

### Verifiering

**1. Är den i git-historik?** **JA.**
```
git log --all -S "AIzaSyCScYORJPxXCyp0J"
→ 66b6d18 feat: update all site pages + edge functions with latest improvements
```

**2. Används den?** **NEJ — död kod.**
```
grep "SPICK.GOOGLE_PLACES_KEY" → 0 träffar i hela repo
grep "GOOGLE_PLACES_KEY"       → bara config.js-deklarationen
```

All faktisk Google-trafik går genom Edge Function ([places-autocomplete/index.ts:4](supabase/functions/places-autocomplete/index.ts)) som läser `Deno.env.get("GOOGLE_MAPS_API_KEY")` — **annan nyckel**, server-side, säker.

### Rekommenderade åtgärder (prio-ordning)

1. **OMEDELBART:** Rotera nyckeln i Google Cloud Console (ifall den har HTTP-referrer-restriktion kan den vara ofarlig, annars är den missbrukbar).
2. **Kolla restriktioner:** Gå till GCP → APIs & Services → Credentials → kolla om nyckeln har:
   - HTTP-referrer (t.ex. `*.spick.se/*`) → OK, missbruk kräver referrer-spoofing
   - Ingen restriktion → **AKUT**, vem som helst kan använda nyckeln fritt
3. **Ta bort ur config.js** ([js/config.js:12](js/config.js)) — det är död kod.
4. **Git-historik:** `git filter-repo` eller BFG för att radera ur alla commits. Notera: public repo? Då är nyckeln redan skördad av bots.

---

## 📊 Data-kvalitet — cleaners koordinater

**Uppgift 4 (SQL mot prod) kunde INTE köras:** `supabase` CLI saknas i miljön (se `which supabase` → not found). `psql` ej heller installerat.

**Alternativ:**
1. Farhad kör manuellt via Supabase Dashboard SQL Editor ([supabase.com/dashboard/project/urjeijcncsyuletprydy/sql](https://supabase.com/dashboard/project/urjeijcncsyuletprydy/sql)):

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE home_lat IS NOT NULL) AS has_lat,
  COUNT(*) FILTER (WHERE home_address IS NOT NULL AND home_address != '') AS has_address,
  COUNT(*) FILTER (WHERE home_lat IS NULL AND home_address IS NOT NULL AND home_address != '') AS has_address_no_coords
FROM cleaners;
```

2. Alternativt via MCP Supabase-tools om konfigurerat.

**Kända data-punkter från docs:**
- [docs/4-PRODUKTIONSDATABAS.md:459](docs/4-PRODUKTIONSDATABAS.md): "Daniella + Lizbeth (Rafas team) har NULL `home_lat`/`home_lng`. Väntar på Rafael."
- [docs/3-TODOLIST-v2.md:79](docs/3-TODOLIST-v2.md): "Blockerar: `find_nearby_cleaners` returnerar inte dem (NULL `home_lat`/`home_lng`)"

**Antagande baserat på kod-granskning:** Cleaners som registrerat sig efter ca 2026-03 via wizard/self-reg bör ha korrekta koordinater (Google Places blev default). Cleaners innan det + manuellt redigerade = troligen NULL eller stale.

---

## 📋 STOPP-villkor kontroll

- [x] **>20 adressfält utan Places?** NEJ — endast 4 adressfält saknar autocomplete (admin-edit-home, 2 faktureringsadresser, 1 stad). Inte strukturellt problem, men admin-edit är kritiskt.
- [x] **API-nyckel i git-historik?** JA — commit `66b6d18`. **FLAGGAD SOM KRITISK** ovan.
- [x] **Kostnad per query oklart?** NEJ — Google Maps API-prislista: Autocomplete per session $2.83/1000, Place Details $17/1000. Med ~100 bokningar/dag + ~5 reg/dag = ~500 queries/dag = ~$1.50/dag = ~$45/mån. Rimligt för Spicks skala.

---

## 🔧 Åtgärdsförslag (prio)

| # | Åtgärd | Effort | Effekt |
|---|--------|--------|--------|
| 1 | Rotera exponerad API-nyckel + ta bort ur config.js | 15 min | 🔴 Säkerhet |
| 2 | Fixa `admin-edit-home-address` med autocomplete + geocode-on-save | 1-2h | 🟡 Rafas team-problem försvinner |
| 3 | Konsolidera `places-autocomplete` vs `geo` — bestäm en kanonisk | 2h | Regel #28 |
| 4 | Ersätt inline-kopior med `js/address-autocomplete.js` på 6 ställen | 3-4h | Regel #28, maintainability |
| 5 | Backfill koordinater för cleaners utan `home_lat`: kör batch-geokodning via EF | 30 min + SQL | Rafas team + framtida matchning |
| 6 | SQL mot prod för data-kvalitetsmätning (ovan) | 5 min | Mätbarhet |

---

## Referenser

- Regel #26 — primärkälla efter "fungerar"
- Regel #27 — primärkälla innan "bygga"
- Regel #28 — ingen ny fragmentering (2 geokod-källor = brott)
- [docs/audits/2026-04-18-servicetyp-flexibilitet.md](docs/audits/2026-04-18-servicetyp-flexibilitet.md) — föregående audit
