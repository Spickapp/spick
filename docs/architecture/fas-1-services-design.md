# F1 — Services-tabell (Design)
**Fas:** F1 i arkitekturplan v3
**Skriven:** 2026-04-19
**Primärkälla för F1-arbetet**
**Tidsestimat:** 14–18h över 6 dagar

---

## 1. Mål

Centralisera alla service-referenser i Spick till en DB-tabell. Möjliggör:
- Nya tjänster utan kod-deploy (Rafaels Premiumstädning, Mattrengöring, framtida)
- Per-firma tjänsteval (F7 VD-autonomi bygger på detta)
- Per-tjänst RUT-eligibility (idag hårdkodad array på 2 ställen)
- Per-tjänst prismodell via multiplier (idag spritt i boka.html)

**Gate:** ID-1.1 klar (commit e137fd3). v_cleaners_public-basen är ren. Inga kvarvarande blockerare för F1-start.

---

## 2. Scope

### I scope
- `services`-tabell + seed (9 existerande + Premium + Mattrengöring)
- `service_addons`-tabell + seed (från boka.html rad 1017–1019)
- `services-list` Edge Function (public read, cache 5 min)
- Migration av boka.html, admin.html, foretag.html, tjanster.html, stadare-dashboard.html
- Blogg (5 filer) via build-steg, inte runtime-fetch
- Stad-sidor (huddinge/nacka/solna/stockholm/sundbyberg/taby) via samma build-steg
- Admin-UI för CRUD (enklast: befintligt admin.html-mönster)

### Ej i scope (separata faser)
- Pricing (F3) — services får `default_hourly_price` som platshållare, men faktisk pris-resolver är F3
- Språk (F2) — services får `label_sv` + `label_en` redan nu, men picker-UI är F2
- Tjänsteval per firma (F7) — DB-schemat förbereds, men UI är F7
- Prisvariation per tid/dag (F3)

### Uttryckligen utanför
- Dispute-UI, escrow (F4)
- Eventing (F5)

---

## 3. DB-schema

```sql
-- services: huvudtabell, en rad per tjänst
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,                 -- 'hemstadning' (slug, URL-säker, lookup-nyckel)
  label_sv TEXT NOT NULL,
  label_en TEXT,                             -- reserverat för F2
  description_sv TEXT,
  rut_eligible BOOLEAN NOT NULL DEFAULT false,
  is_b2b BOOLEAN NOT NULL DEFAULT false,
  is_b2c BOOLEAN NOT NULL DEFAULT true,
  hour_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.00,  -- 1.70 för Storstädning, 2.20 för Flyttstädning
  default_hourly_price INTEGER,              -- fallback innan F3 resolver finns
  display_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  icon_key TEXT,                             -- för frontend-ikonval ('home', 'window', 'office')
  ui_config JSONB NOT NULL DEFAULT '{}'::jsonb,  -- service-specifika UI-kvirkar (besiktningsdatum etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX services_active_order_idx ON services (active, display_order) WHERE active = true;
CREATE INDEX services_key_idx ON services (key);

-- service_addons: många-till-en (t.ex. Ugnsrengöring hör till Hemstädning)
CREATE TABLE service_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  key TEXT NOT NULL,                         -- 'ugnsrengoring'
  label_sv TEXT NOT NULL,
  label_en TEXT,
  price_sek INTEGER NOT NULL,                -- flyttas till F3:s pricing_rules senare
  display_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, key)
);

CREATE INDEX service_addons_service_idx ON service_addons (service_id, active, display_order);

-- Auto-update updated_at
CREATE TRIGGER services_updated_at BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## 4. RLS

```sql
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_addons ENABLE ROW LEVEL SECURITY;

-- Public read (anon + authenticated): bara aktiva tjänster
CREATE POLICY services_public_read ON services
  FOR SELECT USING (active = true);

CREATE POLICY service_addons_public_read ON service_addons
  FOR SELECT USING (active = true);

-- Admin write (via platform_admin-roll, befintlig pattern)
CREATE POLICY services_admin_write ON services
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE POLICY service_addons_admin_write ON service_addons
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

GRANT SELECT ON services, service_addons TO anon, authenticated;
GRANT ALL ON services, service_addons TO service_role;
```

---

## 5. Seed

```sql
INSERT INTO services (key, label_sv, rut_eligible, is_b2b, is_b2c, hour_multiplier, display_order, icon_key, default_hourly_price) VALUES
  ('hemstadning',      'Hemstädning',        true,  false, true,  1.00, 10,  'home',    349),
  ('premiumstadning',  'Premiumstädning',    true,  false, true,  1.30, 15,  'premium', 449),
  ('storstadning',     'Storstädning',       true,  false, true,  1.70, 20,  'sparkle', 349),
  ('flyttstadning',    'Flyttstädning',      true,  false, true,  2.20, 30,  'box',     349),
  ('fonsterputs',      'Fönsterputs',        true,  false, true,  1.00, 40,  'window',  349),
  ('mattrengoring',    'Mattrengöring',      true,  false, true,  1.00, 50,  'rug',     NULL),
  ('kontorsstadning',  'Kontorsstädning',    false, true,  false, 1.00, 100, 'office',  449),
  ('trappstadning',    'Trappstädning',      false, true,  false, 1.00, 110, 'stairs',  449),
  ('skolstadning',     'Skolstädning',       false, true,  false, 1.00, 120, 'school',  449),
  ('vardstadning',     'Vårdstädning',       false, true,  false, 1.00, 130, 'care',    499),
  ('hotell_restaurang','Hotell & restaurang',false, true,  false, 1.00, 140, 'hotel',   499);

-- Addons (från boka.html rad 1017–1019 — exakt lista läses dag 2)
INSERT INTO service_addons (service_id, key, label_sv, price_sek, display_order)
SELECT id, 'ugnsrengoring', 'Ugnsrengöring', 295, 10 FROM services WHERE key = 'hemstadning';
```

**Not:** `default_hourly_price` är provisoriskt — ersätts av F3:s pricing-resolver. `mattrengoring` har `NULL` eftersom den är offertbaserad.

---

## 6. Edge Function: `services-list`

```
GET /functions/v1/services-list

Response:
{
  "services": [
    { "key": "hemstadning", "label_sv": "Hemstädning", "rut_eligible": true, ... },
    ...
  ],
  "addons": {
    "hemstadning": [ { "key": "ugnsrengoring", "label_sv": "...", "price_sek": 295 } ],
    ...
  }
}

Cache-Control: max-age=300, s-maxage=300
```

Filtrerar på `active = true`. Sorterar på `display_order`. Publikt läsbar (no auth).

---

## 7. Migrationsordning i koden

### Frontend-konsumtion via shared helper
Ny fil: `js/services-loader.js`
```js
export async function loadServices() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/services-list`);
  return await res.json(); // { services, addons }
}
```
Alla filer som idag hårdkodar service-listor ersätter sin array med `await loadServices()`.

### Feature flag
`window.F1_USE_DB_SERVICES = true|false` i page-init. Tillåter instant rollback om något brister.

### Specifika migreringar
1. **boka.html** (37 träffar):
   - Rad 291–314 (buttons): render från `services.filter(s => s.is_b2c || s.is_b2b)`
   - Rad 723 (`RUT_SERVICES`): ersätt med `services.filter(s => s.rut_eligible).map(s => s.label_sv)`
   - Rad 1017–1019 (addons): ersätt med `addons[currentService.key]`
   - Rad 1225–1240 (hour-multiplier): ersätt med `currentService.hour_multiplier`
   - Rad 1142 (B2B-lista): ersätt med `services.filter(s => s.is_b2b)`
   - Rad 3036 + 562 (UI-kvirkar): flytta till `services.ui_config` JSONB

2. **admin.html** — CRUD-UI + migrering av 14 hardkodade strängar
3. **tjanster.html** — ren listvy, direkt-fetch
4. **stadare-dashboard.html** (32 träffar) — profil-editor: vilka tjänster städaren erbjuder, filter från services
5. **foretag.html** — publik sida, direkt-fetch
6. **blogg/** (5 filer) + stad-sidor (6 filer) — SSR build-steg (Dag 4)

### Rensning
- `fix-b2b-services.js` — verifiera om det är engångsskript (namn antyder det), flytta till `scripts/archive/` eller ta bort
- `fix-multiservice.js`, `fix-multi4.js`, `fix-multiflow.js`, `fix-leak2.js` — samma check

---

## 8. Dag-för-dag

| Dag | Leverans | Timmar |
|---|---|---|
| **Dag 1** | DB-migration + seed + EF `services-list` + feature flag-mekanik | 3–4h |
| **Dag 2** | `js/services-loader.js` + migrera boka.html (alla 4 fragmenterade strukturer) bakom flag | 4–5h |
| **Dag 3** | Migrera admin.html + tjanster.html + stadare-dashboard.html + foretag.html | 3–4h |
| **Dag 4** | Blogg (5) + stad-sidor (6) via build-steg | 2–3h |
| **Dag 5** | E2E-verifiering: solo/VD/teammedlem/kund-flöden, RUT-toggle, B2B/B2C-filter | 1–2h |
| **Dag 6** | Feature flag → 100%, rensning fix-*.js, admin-CRUD-UI, F2-input (`label_en`) | 1–2h |

**Total:** 14–20h.

---

## 9. Rollback

Feature flag `F1_USE_DB_SERVICES` i `window`-scope. Sätt till `false` → alla filer faller tillbaka till hårdkodade listor. DB-tabellen lämnas orörd. Ingen deploy krävs.

Migrationen är **additiv** — inga DROP, inga ALTER på existerande tabeller. Kan rullas tillbaka genom att sätta `active = false` på alla rader (visar inget i EF-response) utan att frontend kraschar.

---

## 10. Verifiering (Regel #26)

Före Dag 6-gate (flag → 100%):

- **(A) Grep:** `grep -rn "Hemstadning\|Storstadning\|Flyttstadning\|Fonsterputs\|Kontorsstadning"` — förväntade 0 träffar i JS-logik, kvar endast i SEO-copy (meta, title, H1)
- **(B) Flöde:** boka.html → välj varje service → se korrekt RUT-toggle, korrekt pris, korrekt addons
- **(C) Alla användartyper:** solo-städare, VD, teammedlem, kund, admin — alla flöden
- **(D) Ingen hardkodning:** sök `RUT_SERVICES`, `hour_multiplier`, `service: '` i JS — 0 träffar
- **(E) Data-audit:** kör mot prod-dump: `SELECT service_type, COUNT(*) FROM bookings GROUP BY service_type` — alla värden matchar `services.label_sv` eller `services.key`

---

## 11. Blockerare & öppna trådar

1. **`is_platform_admin()` helper:** antas finnas (brukas i RLS). Verifiera med `\df is_platform_admin` i psql innan Dag 1.
2. **`set_updated_at()` trigger-funktion:** antas finnas. Verifiera med `\df set_updated_at`. Om saknas, inkludera i Dag 1-migration.
3. **Service-type-kolumn i bookings:** existerande bokningar har `service_type TEXT`. F1 lämnar kolumnen oförändrad — ingen FK till `services(id)`. Kopplingen görs via `key` eller `label_sv`-match vid rapportering. Tightare FK kan göras i F3 eller F13.

---

## 12. Success-kriterier

- ✅ Ny tjänst (t.ex. "Strykservice") kan läggas till av admin via DB/UI utan frontend-deploy
- ✅ Rafaels Premiumstädning är synlig i boka.html-flödet utan kodändring
- ✅ Mattrengöring visas med offert-flagga (no default_hourly_price → "Begär offert"-knapp)
- ✅ RUT-toggle visas/döljs korrekt per service utan arrayuppdatering
- ✅ B2B/B2C-filter i boka.html använder DB-flagor, inte hårdkodad lista
- ✅ Grep-audit under v3 §12:s audit-pipeline (F12) kommer att hitta 0 service-strängar i JS-logik

---

## 13. Beroenden mot F2–F4

- **F2 (languages):** `services.label_en` redan definierat, F2 lägger till `services_translations` om fler språk behövs
- **F3 (pricing):** `services.default_hourly_price` är stubb. F3-resolver läser `services` + `pricing_rules` för faktisk pris
- **F4 (escrow):** oberoende. Services är inte i escrow-flödet

---

**Nästa steg efter att denna fil är committad:**
1. Claude Code kör Dag 1: DB-migration + seed + EF + feature flag
