# Fas 1.1: Cleaners PII Lockdown

**Datum:** 2026-04-19 tidig morgon
**Status:** Empiriskt verifierat mot prod
**Commits:**
- `e0a1298` (Steg 1: kod-fix i 3 filer)
- `96036f6` (Steg 2: frontend-migration till `v_cleaners_public` i 6 filer)
- `<denna commit>` (Steg 3: DB-lockdown)

---

## Problem

Paket 6-audit (Fas 0.2b) identifierade två publika sidor som läckte PII:
1. [data-dashboard.html:295](../../data-dashboard.html:295) gjorde `select=*` på alla godkända cleaners
2. [stadare-profil.html:311](../../stadare-profil.html:311) exponerade `home_lat, home_lng` publikt

Plus [faktura.html:82](../../faktura.html:82) lämnade ute `email, phone` från cleaners-tabellen publikt via anon-headers.

Angripare med anon-key kunde curla `/rest/v1/cleaners` och få:
- `email, phone` (kontaktinfo)
- `home_address, home_lat, home_lng` (boendeadress)
- `stripe_account_id` (betalnings-ID)
- Plus andra icke-kritiska men onödigt exponerade kolumner

---

## Lösning

Tre-stegs fix:

### Steg 1: Kod-fix (commit `e0a1298`)

- [faktura.html](../../faktura.html): byt `email`/`phone`-källa från live cleaners-lookup till `bookings.cleaner_email`/`cleaner_phone` snapshot (Fas 0.3-kolumner, 25/25 rader fyllda)
- [stadare-profil.html](../../stadare-profil.html): ta bort `home_lat, home_lng` från SELECT-listan. JSON-LD-fallback var redan ternär-kodad.
- [data-dashboard.html](../../data-dashboard.html): byt `select=*` till explicit 4-kolumn-set (`full_name, city, avg_rating, review_count`)

### Steg 2: `v_cleaners_public` view (commit `96036f6`)

- Skapa view med 25 safe-kolumner: `id, slug, full_name, first_name, city, bio, avatar_url, hourly_rate, avg_rating, review_count, total_ratings, completed_jobs, services, languages, identity_verified, member_since, service_radius_km, pet_pref, elevator_pref, is_approved, status, owner_only, is_company_owner, company_id, stripe_onboarding_status`
- `WHERE is_approved=true` inbakad i view
- GRANT SELECT till `anon` + `authenticated`
- Migrera 8 publika SELECT-anrop i 6 filer till viewn:
  - [boka.html:1925](../../boka.html:1925)
  - [foretag.html:355](../../foretag.html:355)
  - [priser.html:330](../../priser.html:330)
  - [stadare-profil.html:311, 336, 608](../../stadare-profil.html:311) (3 anrop)
  - [data-dashboard.html:295](../../data-dashboard.html:295)
  - [faktura.html:82](../../faktura.html:82)

### Steg 3: DB-lockdown (denna incident)

- `REVOKE SELECT ON cleaners FROM anon`
- DROP 3 publika policies (meningslösa utan grant):
  - `"Anon can read cleaners"`
  - `"Anyone can read cleaner slug"`
  - `"Public read active cleaners"`
- Auth-scoped policies bevaras för cleaner-own, VD-team, admin, service-role

Post-hoc migration: [`20260419_fas_1_1_cleaners_pii_lockdown.sql`](../../supabase/migrations/20260419_fas_1_1_cleaners_pii_lockdown.sql).

---

## Empirisk verifiering

**V1:** `SET ROLE anon; SELECT FROM cleaners` → **`42501 permission denied`** ✅ (SKA kasta fel — beviset på att PII är låst)

**V2:** `SET ROLE anon; SELECT FROM v_cleaners_public` → **12 rader** ✅ (publik katalog fungerar)

**V3:** `SELECT policyname, cmd FROM pg_policies WHERE tablename='cleaners'` → **9 policies**, alla auth-scoped ✅

**Publika sidor testade post-deploy:**
- [priser.html](../../priser.html): tre pris-paket renderade korrekt
- [stadare-profil.html](../../stadare-profil.html): list-view med query-param-fallback fungerar som designat

---

## Exponerade PII efter lockdown

### `cleaners`-tabellen (auth-endast)
- `email, phone, home_address, home_lat, home_lng`: inte längre anon-access
- `auth_user_id, stripe_account_id, personal_number_hash`: aldrig exponerade

### `v_cleaners_public` (anon + auth)
- Inga PII-kolumner inkluderade
- Bara affärs-relevant publik data (namn, stad, rating, services)

---

## Fas 1 återstående arbete

Enligt slutaudit-backlog:
- **HÖG:** SMS-token-auth-flöde för publika sidor (`min-bokning`, `stadare-uppdrag`, `prenumeration-tack`) — separat uppgift
- **MED:** Schema-capture-migrationer för 16 tabeller utan migration-fil
- **LÅG:** Admin-policies på `{public}` → `{authenticated}` (kosmetisk)
