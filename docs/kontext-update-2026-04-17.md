# Kontext-update — 2026-04-17

**Sessionstyp:** Ren dokumentations-session efter Dag 1-audit.  
**Ingen kod ändrad. Ingen SQL körd mot prod.**

---

## Vad uppdaterades

### `1-MASTERKONTEXT.md` (NY)

Skapades från grunden baserat på CLAUDE.md + Dag 1-audit. Ersätter den föråldrade `SPICK_KONTEXT.md` (2026-03-23 — Netlify-referenser mm).

Viktigaste sektioner:
- **Arkitektur → Pricing-arkitektur:** 14 paths, hänvisning till `7-ARKITEKTUR-SANNING.md`, varning om duplicerad logik.
- **Edge Functions Catalog:** `booking-create` markerad som "ENDA aktiva Stripe-integrerade EF för engångsbokningar". `stripe-checkout` markerad som "⚠️ DÖD KOD (verifierat 2026-04-17)". `setup-subscription` separerad som "kortregistrering för prenumerationer".
- **Provision och priser:** Explicit format-regel "PROCENT (17)". Tabell med verifieringsstatus per kodställe (inkl. 4 buggar från audit).
- **Kritiska DB-regler:** `use_company_pricing`-flaggans status (booking-create LÄSER EJ, stripe-checkout LÄSER men dödkod).

### `4-PRODUKTIONSDATABAS.md` (NY)

Skapades från grunden. Innehåller:
- **cleaners-tabell:** Korrekta fältnamn `home_lat`/`home_lng` (INTE `lat`/`lng`). 4 status-fält (`status`, `is_active`, `is_approved`, `is_blocked`) med syfte och användning. Anmärkning att `commission_rate` lagras som procent (17) trots schema-default 0.17.
- **companies-tabell:** `commission_rate` (INTE `commission_override`), `use_company_pricing`, `employment_model`. Fält som INTE existerar klargjorda (ingen `city`, `lat`, `lng`, `is_active`). Compliance-fält (`underleverantor_agreement_accepted_at` m.fl.) flaggade ⚠️ EJ VERIFIERADE — kräver SQL-audit.
- **bookings-tabell:** `commission_pct` dokumenterat som procent. Anteckning om `total_price` + latent bug-risk.
- **v_cleaners_for_booking:** Full SQL-definition inkluderad (från migration 20260401000001). Säkerhetsnotering om `is_approved AND status='aktiv'` filter.
- **find_nearby_cleaners RPC:** Exakt signatur från `sql/fix-find-nearby-for-teams.sql`. Obs att `home_lat`/`home_lng` används (inte `lat`/`lng`).
- **Kända datakvalitetsissues:** 5 poster (customer_profiles skev, avbokad+paid booking, commission schema-inkonsistens, pricing-path-divergens, Rafa-team koordinater saknas).
- **SQL-verifieringar:** 7 queries att köra vid Dag 2-förberedelse.

### `3-TODOLIST-v2.md` (NY)

Skapades från grunden. Prioriterad P0 → P3.

**Nya P0:**
- P0-1 Pricing-sync-fix (Väg B, 8h) — blockerare för Rafa.
- P0-2 Commission BUG 1 + BUG 3 (samma PR som P0-1).
- P0-3 SQL-audit (3 queries) inför Dag 2.
- P0-4 Underleverantörsavtal-UI.
- P0-E1/E2/E3 Externa blockerare (Stripe Connect, koordinater, försäkring).

**Nya P2:**
- P2-1 UGC-translation (user-generated content — DeepL/OpenAI/hybrid).
- P2-2 Uzbekiska (uz) i Google Translate-widget (2 min manuell).

**Uppdaterade statusnoter:**
- V1.0-verifiering: Commission-audit + pricing-arkitektur-audit ✅ UTFÖRT.
- Rafa-pilot: 6 blockerare identifierade. Uppskattat live-datum 2026-04-19/20.
- Avklarat senaste 7 dagar: 5 commits (bokning-cancel-v2 bypass, VD-kalender, race condition, bokningar-tab fix, SEO sitemap).

### `7-ARKITEKTUR-SANNING.md` (NY)

Permanent register över fragmenterad logik. Framtida Claude-sessioner läser denna FÖRST vid ändringar i pricing/commission/auth/status/översättning.

Innehåll:
- **Pricing-logik:** Tabell med alla 14 ställen (4 authoritative + 10 display). `stripe-checkout` markerad som DÖD KOD.
- **Stripe-integration:** Verifierad flödesbild med exakt fil:rad-hänvisningar.
- **Commission:** Tabell med alla 32 träffar och status per ställe. Referensimplementation (charge-subscription-booking:188-190).
- **i18n-arkitektur:** 6 områden med status per.
- **Autentisering:** 4 roller, skillnad via `is_company_owner` + `company_id`.
- **Status-fält cleaners:** 4 överlappande fält med primär användning.
- **Checklista för framtida ändringar:** 5-punkts pre-change check.

### userMemories

4 nya project-memories tillagda i `C:\Users\farha\.claude\projects\C--Users-farha-spick\memory\`:

1. `project_pricing_fragmented.md` — Pricing-logik på 14 ställen. Referens till 7-ARKITEKTUR-SANNING.md.
2. `project_commission_format.md` — Procent-format (17), inte decimal. Referensimpl: charge-subscription-booking.
3. `project_booking_create_use_company_pricing.md` — Rafas flagga får inte sättas till true pre-Dag 2.
4. `project_rafa_pilot.md` — 6 blockerare för Rafa-live.

Ingen befintlig memory motsade audit-fynd (inga felaktigheter att rätta). Inget borttaget. `MEMORY.md` index uppdaterad med 4 nya rader.

---

## Hur framtida sessioner drar nytta

Nästa session som öppnar dessa dokument kommer:
- Se korrekta kolumnnamn (`home_lat` vs `lat`) → slippa re-verifiera från migrations.
- Se commission-format (procent 17, inte decimal 0.17) → slippa grep-verifiera igen.
- Se pricing-arkitektur (14 ställen, risk vid ändring) → slippa den 45-min grep-audit som Dag 1 krävde.
- Se `stripe-checkout` är DÖD KOD → slippa fel-läsa det som aktiv path.
- Se alla 4 commission-buggar med exakt fil:rad → direkt kunna hoppa till fix utan re-audit.
- Se `charge-subscription-booking:188-190` som referensimplementation → kunna kopiera mönster direkt.

**Tid sparad:** Uppskattad **45-60 minuter** verifieringar som inte längre behövs per session som rör pricing/commission/DB-schema.

---

## Förändringar inte gjorda (medvetet)

- ❌ Inga kodfil-ändringar.
- ❌ Ingen SQL-körning mot prod.
- ❌ `SPICK_KONTEXT.md` (föråldrad, 2026-03-23) INTE raderad — behålls som historik. Refererad i `1-MASTERKONTEXT.md` med ⚠️-markering.
- ❌ Inga removals från userMemories (inget att ta bort — current memory hade bara 1 entry och den är fortfarande giltig).
- ❌ Dag 2-kodarbetet INTE påbörjat — väntar på beslut (Väg A/B/C).

---

## Commit

4 nya dokument + 4 nya memory-filer + MEMORY.md-update.
