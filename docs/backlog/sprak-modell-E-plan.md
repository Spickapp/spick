# Modell E: Språk-picker — Komplett plan

**Status:** Backlog — implementation planerad vecka 17 (efter Solid Service-pilot)
**Prioritet:** P2 (inte blocker för Zivar-demo lördag 19 april)
**Tidsestimat:** 4-6h total (audit + bygga + test)
**Författare:** Farhad + Claude, 18 april 2026

---

## Executive summary

Språk lagras på TVÅ nivåer:
- `cleaners.languages` — individens faktiska språk (sanning)
- `companies.languages` — företagets marknadsförda språk (pitch, satt av VD)

Visning på företagsprofil beror på `allow_customer_choice`:
- `true` → visa både företagets pitch OCH team-tabell med individuella språk
- `false` → visa bara företagets pitch

Matchning sker alltid på `cleaners.languages` eftersom det är individen som kommer.

---

## Datamodell

### cleaners.languages (jsonb array)

Format: ISO 639-1-koder
```json
["sv", "ar", "ru"]
```

Exempel:
```sql
UPDATE cleaners SET languages = '["sv", "ar", "ru"]'::jsonb
WHERE id = '<zivar-id>';
```

### companies.languages (jsonb array)

Samma format. Sätts manuellt av VD, ingen trigger.

```json
["sv", "ar", "ru", "uz"]
```

### RLS

- `cleaners.languages`: städaren själv kan uppdatera sina egna + admin
- `companies.languages`: VD (is_company_owner) kan uppdatera sitt bolag + admin

### Index

Inget B-tree-index (jsonb stöder inte det bra). För filtrering vid bokning används jsonb-operator `?|`:

```sql
-- Kund vill ha städare som talar arabiska ELLER persiska
SELECT * FROM cleaners
WHERE is_active = true 
  AND languages ?| array['ar', 'fa'];
```

GIN-index rekommenderat för snabb lookup:
```sql
CREATE INDEX idx_cleaners_languages_gin ON cleaners USING GIN (languages);
CREATE INDEX idx_companies_languages_gin ON companies USING GIN (languages);
```

---

## Språklista (central JS-fil)

**Fil:** `/js/languages.js` (NY)

```js
// Central språklista — används av ALLA UI-ställen
// Alfabetisk ordning på svenska
// Uppdatera HÄR om nytt språk behövs

export const LANGUAGES = [
  { code: 'sq', sv: 'Albanska', native: 'Shqip' },
  { code: 'en', sv: 'Engelska', native: 'English' },
  { code: 'ar', sv: 'Arabiska', native: 'العربية' },
  { code: 'bs', sv: 'Bosniska', native: 'Bosanski' },
  { code: 'bg', sv: 'Bulgariska', native: 'Български' },
  { code: 'prs', sv: 'Dari', native: 'دری' },
  { code: 'et', sv: 'Estniska', native: 'Eesti' },
  { code: 'fi', sv: 'Finska', native: 'Suomi' },
  { code: 'fr', sv: 'Franska', native: 'Français' },
  { code: 'el', sv: 'Grekiska', native: 'Ελληνικά' },
  { code: 'hr', sv: 'Kroatiska', native: 'Hrvatski' },
  { code: 'it', sv: 'Italienska', native: 'Italiano' },
  { code: 'ku', sv: 'Kurdiska', native: 'Kurdî' },
  { code: 'lv', sv: 'Lettiska', native: 'Latviešu' },
  { code: 'lt', sv: 'Litauiska', native: 'Lietuvių' },
  { code: 'nl', sv: 'Nederländska', native: 'Nederlands' },
  { code: 'no', sv: 'Norska', native: 'Norsk' },
  { code: 'fa', sv: 'Persiska', native: 'فارسی' },
  { code: 'pl', sv: 'Polska', native: 'Polski' },
  { code: 'pt', sv: 'Portugisiska', native: 'Português' },
  { code: 'ro', sv: 'Rumänska', native: 'Română' },
  { code: 'ru', sv: 'Ryska', native: 'Русский' },
  { code: 'sr', sv: 'Serbiska', native: 'Srpski' },
  { code: 'so', sv: 'Somaliska', native: 'Soomaali' },
  { code: 'es', sv: 'Spanska', native: 'Español' },
  { code: 'sv', sv: 'Svenska', native: 'Svenska' },
  { code: 'tl', sv: 'Tagalog', native: 'Tagalog' },
  { code: 'th', sv: 'Thai', native: 'ไทย' },
  { code: 'ti', sv: 'Tigrinja', native: 'ትግርኛ' },
  { code: 'cs', sv: 'Tjeckiska', native: 'Čeština' },
  { code: 'tr', sv: 'Turkiska', native: 'Türkçe' },
  { code: 'de', sv: 'Tyska', native: 'Deutsch' },
  { code: 'uk', sv: 'Ukrainska', native: 'Українська' },
  { code: 'hu', sv: 'Ungerska', native: 'Magyar' },
  { code: 'ur', sv: 'Urdu', native: 'اردو' },
  { code: 'uz', sv: 'Uzbekiska', native: "O'zbekcha" },
  { code: 'vi', sv: 'Vietnamesiska', native: 'Tiếng Việt' },
  { code: 'zh', sv: 'Kinesiska (mandarin)', native: '中文' },
];

// Hjälpfunktioner
export function getLanguageName(code) {
  return LANGUAGES.find(l => l.code === code)?.sv || code;
}

export function formatLanguageList(codes) {
  if (!codes || !codes.length) return '';
  return codes.map(getLanguageName).join(', ');
}

export function searchLanguages(query) {
  if (!query) return LANGUAGES;
  const q = query.toLowerCase();
  return LANGUAGES.filter(l =>
    l.sv.toLowerCase().includes(q) ||
    l.native.toLowerCase().includes(q) ||
    l.code.includes(q)
  );
}
```

**37 språk ovan täcker:** Sveriges top-30 invandrarspråk + stora världsspråk + grannländer. Lägg till fler vid behov.

---

## UI-komponent: Sökbar multi-select

**Plats:** `/components/language-picker.html` (NY)

Kan inkluderas i alla sidor som behöver språkväljare.

### Beteende

1. Klick på fältet → dropdown öppnas
2. Visar alla språk alfabetiskt på svenska
3. Användaren skriver → filtreras på svenskt namn OCH native-namn OCH ISO-kod
4. Checkbox framför varje språk
5. Valda språk visas som chip/tags ovanför sökfältet med "x" för att ta bort
6. Mobile-optimerat: fält är minst 48px höga, touch-friendly

### Exempel DOM-struktur

```html
<div class="lang-picker" data-field="languages">
  <label>Språk du talar *</label>
  
  <!-- Valda språk som chips -->
  <div class="lang-picker__chips">
    <span class="chip">Svenska <button aria-label="Ta bort">×</button></span>
    <span class="chip">Arabiska <button aria-label="Ta bort">×</button></span>
  </div>
  
  <!-- Sökfält + dropdown -->
  <div class="lang-picker__search">
    <input type="text" placeholder="Sök språk..." autocomplete="off">
  </div>
  
  <!-- Dropdown med resultat -->
  <ul class="lang-picker__dropdown" hidden>
    <li data-code="ar">
      <input type="checkbox" id="lang-ar"> 
      <label for="lang-ar">Arabiska <small>العربية</small></label>
    </li>
    <!-- ... -->
  </ul>
  
  <!-- Hidden input för form submission -->
  <input type="hidden" name="languages" value='["sv","ar"]'>
</div>
```

### Ingen extern dependency

Byggs med vanilla JS (ingen React, ingen tagify, ingen choices.js). Matchar Spicks nuvarande stack.

---

## Platser där komponenten används

| Plats | Fil | Entitet | Kommentar |
|-------|-----|---------|-----------|
| Städare-registrering | `registrera-stadare.html` steg 2 | `cleaners.languages` | Både solo och team-medlem vid self-register |
| Admin skapar cleaner | `admin.html` (modal) | `cleaners.languages` | Farhad registrerar Zivar + team på lördag |
| Städare-dashboard (redigera profil) | `stadare-dashboard.html` | `cleaners.languages` | Städare kan själv uppdatera |
| VD-dashboard (redigera företag) | `stadare-dashboard.html` (VD-vy) eller separat | `companies.languages` | VD sätter företagets pitch |
| Admin skapar company | `admin.html` (modal) | `companies.languages` | Farhad sätter på lördag om Zivar vill |
| Bokningsflöde (filter) | `boka.html` | READ `cleaners.languages` | Kund filtrerar: "jag vill ha svenska-talande" |

---

## Visningslogik på profiler

### Individuell städarprofil (`/s/slug`)

```html
<div class="profile-section">
  <h3>Språk</h3>
  <p>Talar: <strong>svenska, arabiska, ryska</strong></p>
</div>
```

Läser från `cleaners.languages`, renderar med `formatLanguageList()`.

### Företagsprofil (`/f/slug`)

**Fall 1: `allow_customer_choice = true`** (kunden väljer städare)

```html
<div class="profile-section">
  <h3>Språk i teamet</h3>
  <p class="company-langs">
    Solid Service talar: <strong>svenska, arabiska, ryska, uzbekiska</strong>
  </p>
  
  <table class="team-langs">
    <thead>
      <tr><th>Städare</th><th>Språk</th></tr>
    </thead>
    <tbody>
      <tr><td>Zivar Majid (VD)</td><td>svenska, arabiska, ryska</td></tr>
      <tr><td>Nasiba Kenjaeva</td><td>uzbekiska, ryska</td></tr>
      <tr><td>Dildora Kenjaeva</td><td>uzbekiska, ryska</td></tr>
      <tr><td>Nilufar Kholdorova</td><td>uzbekiska</td></tr>
      <tr><td>Odilov Firdavsiy</td><td>uzbekiska, ryska</td></tr>
    </tbody>
  </table>
</div>
```

**Fall 2: `allow_customer_choice = false`** (företaget tilldelar)

```html
<div class="profile-section">
  <h3>Språk</h3>
  <p>Solid Service talar: <strong>svenska, arabiska, ryska, uzbekiska</strong></p>
  <small>Företaget tilldelar städare baserat på tillgänglighet och närhet.</small>
</div>
```

Bara `companies.languages`, ingen team-tabell.

### Bokningsflöde (`boka.html`)

Dropdown (eller chips): "Vilka språk vill du kunna prata med städaren?"

Filtrerar `find_nearby_cleaners()` RPC:
```sql
AND (p_languages IS NULL OR languages ?| p_languages)
```

---

## VD-dashboard — företagsspråk-widget

```
┌──────────────────────────────────────────────────────────────┐
│ Språk på företagsprofilen                                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Ditt team talar sammanlagt: svenska, arabiska, ryska,        │
│ uzbekiska                                                    │
│                                                              │
│ [Kopiera ovan till företagsprofil]                          │
│                                                              │
│ ─── ELLER välj manuellt vilka språk ni marknadsför: ───      │
│                                                              │
│ [Språk-pickern här]                                          │
│ Valda: [svenska] [arabiska] [ryska] [uzbekiska]             │
│                                                              │
│ [Spara]                                                      │
└──────────────────────────────────────────────────────────────┘
```

Hjälper VD att starta med team-unionen men behålla kontroll.

---

## SQL-migrations

```sql
-- 2026-04-XX_add_languages_columns.sql
BEGIN;

-- Lägg till kolumner (idempotent)
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS languages jsonb DEFAULT '[]'::jsonb;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS languages jsonb DEFAULT '[]'::jsonb;

-- Index för snabb matchning
CREATE INDEX IF NOT EXISTS idx_cleaners_languages_gin 
  ON cleaners USING GIN (languages);

CREATE INDEX IF NOT EXISTS idx_companies_languages_gin 
  ON companies USING GIN (languages);

-- Validering: kontrollera att det ALLTID är en array
ALTER TABLE cleaners
  ADD CONSTRAINT cleaners_languages_is_array 
  CHECK (jsonb_typeof(languages) = 'array');

ALTER TABLE companies
  ADD CONSTRAINT companies_languages_is_array 
  CHECK (jsonb_typeof(languages) = 'array');

-- Kommentarer
COMMENT ON COLUMN cleaners.languages IS 
  'jsonb array med ISO 639-1-koder. Individens faktiska språk.';
COMMENT ON COLUMN companies.languages IS 
  'jsonb array med ISO 639-1-koder. Manuellt satt av VD. Företagets marknadsförda språk.';

COMMIT;
```

---

## RPC-uppdatering: `find_nearby_cleaners`

```sql
CREATE OR REPLACE FUNCTION find_nearby_cleaners(
  p_lat numeric,
  p_lng numeric,
  p_radius_km integer DEFAULT 30,
  p_service_type text DEFAULT NULL,
  p_languages text[] DEFAULT NULL  -- NYA PARAMETERN
)
RETURNS TABLE (...) AS $$
  SELECT ...
  FROM cleaners c
  WHERE c.is_active = true
    AND ST_DWithin(
      ST_MakePoint(c.home_lng, c.home_lat)::geography,
      ST_MakePoint(p_lng, p_lat)::geography,
      (c.service_radius_km * 1000)
    )
    AND (p_languages IS NULL OR c.languages ?| p_languages)
    -- ... resten av filtren
$$ LANGUAGE SQL SECURITY DEFINER;
```

---

## Testplan (innan produktion)

### Unit-tester (språk-JS)

- `formatLanguageList(['sv', 'ar'])` → `"svenska, arabiska"`
- `formatLanguageList([])` → `""`
- `formatLanguageList(['xxx'])` → `"xxx"` (graceful fallback)
- `searchLanguages('arab')` → träffar på "Arabiska"
- `searchLanguages('العر')` → träffar på native-skript
- `searchLanguages('')` → alla språk

### E2E-tester

1. Registrera ny cleaner, välj 3 språk via picker → spara → verifiera i DB
2. Öppna cleaner-profil → verifiera att språk visas som svenska
3. VD uppdaterar company.languages → verifiera på företagsprofil
4. Boka med språkfilter 'arabiska' → bara arabisktalande städare visas
5. Testa sökning med både svenska, native och ISO-kod
6. Mobile: testa på 375px bredd

### Edge cases

- Cleaner med `languages = []` (tom) → visas som "Språk ej angivet" i UI
- Cleaner med `languages = NULL` → samma som tom (fallback till DEFAULT '[]')
- Duplicerade koder `['sv', 'sv']` → deduplicera vid save (frontend)
- Ogiltig kod som bytts: `'ca'` (katalanska) tas bort från LANGUAGES → cleaner visar kod istället för namn tills hen uppdaterar

---

## Implementation-fas (Claude Code-prompt)

**KÖR INTE IDAG. Spara för vecka 17.**

```
Spick — Implementera Modell E språk-picker (P2, vecka 17)

Regel #26: Verifiera allt med fil:rad-citat. Ingen deploy utan test.

Förutsättning: Läs /docs/backlog/sprak-modell-E-plan.md (denna fil) först.

FAS 1 — AUDIT (innan kod)
1. grep git ls-files för "language", "sprak", "idiom" — identifiera alla existerande implementations
2. SQL mot prod: `SELECT column_name FROM information_schema.columns 
   WHERE table_name IN ('cleaners','companies') AND column_name LIKE '%lang%'`
3. Läs nuvarande språk-UI i registrera-stadare.html + stadare-dashboard + admin.html
4. Dokumentera i /docs/audits/2026-04-XX-sprak-audit.md

Om audit avslöjar existerande implementation som skiljer från planen → STOPP,
flagga till Farhad. Bygg inte ovanpå utan att han godkänner refaktorn.

FAS 2 — DATA
5. Kör migration (SQL i spec)
6. Verifiera kolumner + index finns i prod

FAS 3 — JS
7. Skapa /js/languages.js enligt spec
8. Skapa /components/language-picker.html enligt spec
9. Unit-testa helper-funktioner (formatLanguageList, searchLanguages, getLanguageName)

FAS 4 — UI-integration
10. Ersätt nuvarande språk-UI i registrera-stadare.html steg 2
11. Samma i stadare-dashboard (städarens egen redigering)
12. Samma i admin.html (cleaner-create + company-create modaler)
13. Ny widget i VD-vy: "Språk på företagsprofilen" enligt spec

FAS 5 — VISNING
14. Uppdatera stadare-profil.html (/s/slug) — läs cleaners.languages, visa som svenska
15. Uppdatera företagsprofil (/f/slug) — logik enligt allow_customer_choice
16. Uppdatera boka.html med språkfilter (valfritt)

FAS 6 — MATCHNING
17. Uppdatera find_nearby_cleaners RPC med p_languages-parameter
18. Uppdatera boka.html att skicka valda språk till RPC

FAS 7 — TEST + DEPLOY
19. Kör testplanen (unit + E2E + edge cases)
20. Migrera existerande cleaners med default-språk 'sv' om de saknar language-val
21. Commit + push med meddelande: "feat(sprak): Modell E — språk per cleaner + per company"

Total tidsestimat: 4-6h
Priority: P2 (inte blocker för något aktivt pilot)
```

---

## Beslut som är låsta

1. **Modell E** vald över A/B/C/D efter granskning av 8 arkitekturhål
2. **ISO 639-1-koder** i DB (inte svenska strängar — låsning mot framtida språkval)
3. **Jsonb array** (inte kommaseparerad text, inte separat tabell)
4. **Visning beror på allow_customer_choice** (inte alltid samma)
5. **Matchning alltid på cleaners.languages** (inte companies.languages)
6. **Central JS-fil för språklista** (inte duplicerat i varje HTML-fil)
7. **Vanilla JS** (ingen ny frontend-dependency)
8. **VD-UI visar team-union som förslag** men tvingar inte synkning

---

## Öppna frågor (besvaras vid implementation)

1. Ska städare kunna ange "flyt"-nivå per språk? (svenska C1, arabiska A2)
   - Rekommendation: NEJ i fas 1. Komplicerar UI. Kan läggas till senare.
2. Ska kund kunna spara sitt språkfilter som preferens?
   - Rekommendation: JA i fas 2 (efter initial launch)
3. Ska admin kunna massuppdatera språk för alla cleaners i en company?
   - Rekommendation: NEJ. Individen ansvarar för sina egna språk.
4. Automatisk språkdetektering från Google Translate i UI?
   - Rekommendation: NEJ. Manuellt val är mer exakt.

---

## Risker

| Risk | Sannolikhet | Mitigation |
|------|-------------|-----------|
| Existerande language-data i annat format | Låg | Audit-fas 1 fångar det |
| GIN-index blir långsam vid >10000 cleaners | Låg | Cleaner-tabellen kommer inte vara så stor på länge |
| Kund filtrerar på språk, inga städare matchar | Medel | UI: "Inga städare inom radius talar X. Vidga radius eller ändra filter." |
| ISO-kod ändras (t.ex. 'prs' för Dari) | Låg | Migration-script kan uppdatera vid behov |

---

**Bekräftat klart:** Detta är en spec, inte kod. Implementation sker vecka 17, EFTER Solid Service-piloten är etablerad och Farhad har tid att fokusera.
