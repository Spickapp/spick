# Admin-flow djuptest — 2026-04-26

**Metod:** Kod-läsning (admin*.html + supabase/functions/admin-*) + curl-verifiering mot prod (https://urjeijcncsyuletprydy.supabase.co + https://spick.se).
**Scope:** Read-only audit av admin-användarens hela upplevelse — auth, moderation, dispute, PNR, chargebacks, matching, säkerhet, audit-loggar, edge cases.
**Tid:** ~30 min, helt enligt time-box.
**Inga ändringar gjorda i kod, DB eller prod.**

---

## Sammanfattning per steg (PASS/FAIL/WARN)

| # | Steg | Status | Anteckning |
|---|------|--------|-----------|
| 1 | Auth + access-control (admin.html) | **WARN** | OTP-flow finns, dual-path auth (`onAuthStateChange` + load-fallback), legacy "superadmin"-fallback öppen om `loadAdminUser` failar |
| 2 | Admin-dashboard översikt | PASS | KPI-grid, realtime-subscription via `setupRealtime`, retry-logik 2s+5s om data tom |
| 3 | Cleaner-moderation | PASS | `admin-approve-cleaner` EF korrekt — auth-gate, idempotent (status-check), commission läses från `platform_settings` (regel #28) |
| 4 | Company-moderation | PASS | `admin-approve-company` + `admin-reject-company` EFs deployade (HTTP 401/403 till anon = auth fungerar) |
| 5 | Booking-management | **FAIL** | `cancelBooking()` skriver direkt mot `bookings`-tabellen via `AR.update` istället för EF — bypassar server-side validering (rad 3625-3630 i admin.html) |
| 6 | Dispute-resolution (admin-disputes.html) | PASS | Auth-guard via `is_admin()` RPC (verifierat: anon → `false`), SLA-färgning korrekt (48h/72h/168h), `admin-dispute-decide` wrapper EF deployad |
| 7 | PNR-verifiering | **WARN** | 6 tabbar fungerar, men `markVerifiedManual()` + `markUnverified()` skriver DIREKT mot `bookings`-tabellen utan EF-wrapper → behöver RLS-policy som tillåter admin men inte anon |
| 8 | Chargebacks | PASS | `v_admin_chargebacks` + `v_admin_chargeback_aggregate` views deployade (HTTP 401 till anon = `permission denied for view` = korrekt skyddat) |
| 9 | Matching-monitoring | PASS | Alla 6 views (`v_shadow_mode_*`, `v_matching_*`) returnerar 401 till anon → endast admin via JWT |
| 10 | Säkerhetsplan | PASS | Auth-guard överst — kollar localStorage-token + auth/v1/user innan render |
| 11 | Edge cases | **WARN** | Idempotency OK i admin-approve-cleaner. `globalSearch()` finns men ej testad. `exportCSV()` är client-side (ingen EF) — fungerar men ger kunddata-läcka om sessionen kapas |
| 12 | Audit-loggar | **WARN** | `auditLog()` skriver till `admin_audit_log` (verifierat: anon=401), men try/catch sväljer fel tyst — failed audits syns ej för admin |

---

## Top 10 findings (sorterade efter severity)

### 1. **FAIL** — `cancelBooking()` bypassar EF + server-side validering
**Fil:** `admin.html:3614-3648`
```js
await AR.update('bookings', {
  payment_status: 'cancelled', status: 'avbokad', cleaner_id: null, cleaner_name: null
}, 'id=eq.' + currentBookingId);
```
**Problem:** Direkt PATCH mot `bookings`-tabellen via PostgREST. Ingen webhook-trigger för betalningsåterbetalning, ingen idempotency, ingen booking_status_log-rad (om triggern inte skapar den automatiskt på UPDATE). Saknad refund — kunden får statusen "cancelled" men pengarna ligger kvar. Refund-flödet är separerat i `refundBooking()` (anropar `stripe-refund`-EF).
**Fix-rek:** Skapa `admin-cancel-booking`-EF som kombinerar UPDATE + Stripe refund + notify + audit-log atomiskt.

### 2. **FAIL** — `loadAdminUser()` legacy-fallback ger superadmin vid fel
**Fil:** `admin.html:5001-5006, 5010`
```js
} else {
  adminUser = { email: user.email, ..., role_name: 'superadmin', role_level: 100 };
}
// catch:
adminUser = { email: ADMIN_EMAIL, ..., role_name: 'superadmin', role_level: 100 };
```
**Problem:** Om `admin_users`-raden saknar `admin_roles`-koppling ELLER om RPC failar → defaultas till `role_level: 100` = superadmin. Användaren har redan passerat `admin_users`-existence-check (rad 1443), så det är admin. MEN `hasPerm()` rad 5016 kortsluter `role_level >= 100` → alla permissions ges utan kontroll. Om role_id saknas eller permissions inte är seedade → effektiv RBAC-bypass.
**Fix-rek:** Default till `role_level: 0` + visa varningsbanner; logga incident till audit_log.

### 3. **WARN** — Direkta `bookings`-skrivningar i admin-pnr-verifiering.html
**Fil:** `admin-pnr-verifiering.html:204-221`
**Problem:** `markVerifiedManual()` + `markUnverified()` skriver `pnr_verification_method` direkt via PostgREST. Förlitar sig 100% på RLS — om RLS-policyn försvinner i en migration → vem som helst med anon-key kan ändra PNR-status (RUT-bedrägeri).
**Verifiering:** `bookings` returnerar `[]` med `Content-Range: */0` till anon (RLS skyddar nu), men `cleaner_applications` returnerar också `[]` — antagligen samma RLS-mönster. Om någon trigger eller `is_admin()`-policy-villkor bryts → exposure.
**Fix-rek:** Wrappa i `admin-pnr-update`-EF med JWT-verifiering, eller åtminstone skriv RLS-test som `SELECT pg_get_policy_def(polid) FROM pg_policy WHERE polrelid = 'bookings'::regclass` i CI.

### 4. **WARN** — `admin_settings`-tabellen finns INTE i prod, men admin.html refererar den
**Fil:** `admin.html:5415`
```js
var tables = ['bookings', ..., 'admin_users','admin_audit_log','admin_settings','admin_roles'];
```
**Curl-bevis:** `GET /rest/v1/admin_settings → 404 PGRST205 "table not found, perhaps you meant 'public.platform_settings'"`.
**Problem:** Funktionen `loadAdminTables()` (eller liknande som itererar tables) kommer rendera tom/fel-state. Inte breaking, men UI-glitch.
**Fix-rek:** Ändra till `platform_settings` eller ta bort `admin_settings` från listan.

### 5. **WARN** — `companies`-tabellen är publikt läsbar (anon)
**Curl-bevis:** `GET /rest/v1/companies?select=id,name,owner_cleaner_id&limit=2` returnerar verklig data inkl. `[TEST] Test VD AB` + `Haghighi Consulting AB` med `owner_cleaner_id` (kopplar till cleaner-id).
**Problem:** Publik info OK för marknadsplats-sökning, men `owner_cleaner_id` läcker en intern relation. Inte kritiskt eftersom `cleaners.id` också är pseudo-publik via `/f/`-sidor, men exponerar struktur för injection-attacker.
**Fix-rek:** Skapa `v_companies_public`-view utan `owner_cleaner_id`, ge anon access bara till den.

### 6. **WARN** — `auditLog()` sväljer fel tyst → admin tror auditen lyckades
**Fil:** `admin.html:5021-5032`
```js
} catch(e) { console.warn('Audit log failed:', e.message); }
```
**Problem:** Om `admin_audit_log` INSERT failar (RLS-fel, schema-drift, network) → admin ser ingen indikation. Kompliansrisk: GDPR Art 30 kräver behandlingsregister; om audits saknas kan ni inte bevisa vem som tittade på vilken kund-PNR.
**Fix-rek:** Returnera Promise från `auditLog()`, blockera UI med toast om INSERT misslyckas, alarmera Discord (likt `admin_alert_webhook_url`-mönstret).

### 7. **WARN** — `exportCSV()` + `exportBookingsCSV()` är ren client-side rendering
**Fil:** `admin.html:3502, 4683`
**Problem:** All booking-data läses redan via `data.bookings` i klienten. Om sessionen kapas (XSS, malicious browser-extension) → 1000+ kunders email/PNR/totalpris kan exfiltreras med en klickad knapp utan server-side audit. Ingen `export`-rad i `admin_audit_log`.
**Fix-rek:** Skapa `admin-export-bookings`-EF som loggar export + admin_email + IP innan den returnerar CSV. Lägg till permission-gate `hasPerm('finance','export')`.

### 8. **WARN** — Stripe Connect Webhook-EF kräver inte CRON_SECRET men admin-mark-payouts-paid kräver inte heller JWT
**Curl-bevis:**
- `admin-mark-payouts-paid` (anon) → `403 {"error":"Insufficient privileges","role":"anon"}` ← bra!
- `admin-morning-report` (anon) → `200` med stats-data ← **DÅLIGT om kallas externt**

**Problem:** `admin-morning-report` kan triggas av vem som helst — exponerar `pending_apps`, `onboarding`, `yesterday_revenue`-stats publikt. Inte hemlig data men låter en angripare polla för att veta när Spick har många nya applikationer (timing-attack inför social-engineering).
**Fix-rek:** Lägg till `CRON_SECRET`-check i `admin-morning-report` (som de andra cron-EFs).

### 9. **PASS+observation** — `is_admin()` RPC fungerar korrekt
**Curl-bevis:** `POST /rest/v1/rpc/is_admin` med anon-key → `false` (HTTP 200).
**Bra:** Servern vet att anon ej är admin → all admin-only logik blockas korrekt.
**Observation:** Funktionen är `SECURITY DEFINER` (verifierat i `dispute-admin-decide`-EF kommentar §8.11). Ingen JWT-injection-risk.

### 10. **WARN** — OTP-flow har 15s timeout-fallback som kan ge race-condition
**Fil:** `admin.html:1546-1581`
**Problem:** Om `verifyOtp` timeout (15s), försöker koden hämta session manuellt + checka admin_users + visa app. Ren `try/catch` kring timeout → om detta lyckas men sessionen är från en attackers refresh (ovanligt men möjligt vid tabbed sessions) → admin loggas in i fel kontext.
**Fix-rek:** Verifiera att `sess.data.session.user.email === _adminOtpEmail` innan rendering.

---

## Verifierat fungerande (PASS, ingen action)

- ✅ Alla 5 admin-HTML-sidor laddar HTTP 200 från spick.se
- ✅ `admin.html` page-load ~300ms (snabbt)
- ✅ `is_admin()` RPC deployad och korrekt (anon = `false`)
- ✅ `admin_users` + `admin_roles` + `role_permissions` + `admin_audit_log` + `disputes` returnerar `42501 permission denied` till anon (RLS skyddar)
- ✅ Alla `v_admin_*` + `v_matching_*` + `v_shadow_mode_*` views skyddade (anon → 401)
- ✅ `admin-approve-cleaner` korrekt auth-gate (anon → `Invalid token`)
- ✅ `admin-dispute-decide` wrapper EF korrekt (anon → `invalid_auth`)
- ✅ `admin-approve-company` + `admin-reject-company` korrekt auth-gate (anon → `not_admin`)
- ✅ `admin-mark-payouts-paid` korrekt JWT-gate (anon → `Insufficient privileges`)
- ✅ Sakerhetsplan har JS-guard med token + auth/v1/user verifiering
- ✅ Commission läses från `platform_settings` i `admin-approve-cleaner` (regel #28 efterlevd)
- ✅ Cleaner-approval idempotent (`if app.status !== 'pending' → 409`)
- ✅ Dispute-modulen visar SLA-status med EU PWD 7d-breach-varning
- ✅ PNR-modulen har 6 tabbar (alla/needs review/pending/verified/rut_lost/per cleaner)
- ✅ Chargebacks-modulen aggregerar per cleaner med won/lost/pending-count

---

## Tabeller som behöver bekräftas (ej curl-testade pga RLS-skydd):

- `admin_audit_log` schema — har den `admin_email`, `admin_role`, `action`, `resource_type`, `resource_id`, `old_value`, `new_value`, `reason`, `created_at`?
- `admin_users.last_login` + `login_count` kolumner finns?
- `dispute_admin_decide`-EF har full business-logic (refund, escrow-release, notify) — read EF källa nästa session
- `customer_pnr_reminder_count` + `pnr_verification_method` finns på bookings (regel #31 — kontrollera via `information_schema`)

---

## Fix-rekommendation prioritetsordning

**P0 (gör direkt):**
1. Wrapp `cancelBooking()` i ny `admin-cancel-booking`-EF (atomicity)
2. Fixa legacy-fallback i `loadAdminUser()` — default `role_level: 0`
3. Lägg till `CRON_SECRET` i `admin-morning-report`

**P1 (denna sprint):**
4. Wrapp `markVerifiedManual()`/`markUnverified()` i `admin-pnr-update`-EF
5. Skapa `admin-export-bookings`-EF med audit-log
6. Hårda `auditLog()` — alarma vid INSERT-failure

**P2 (technical debt):**
7. Ta bort `admin_settings` från admin.html-listan eller skapa tabellen
8. Skapa `v_companies_public`-view som filtrerar bort `owner_cleaner_id`
9. Verifiera OTP-email-match i `verifyOtp()`-fallback

---

## Anteckning från tidigare audit (samma område)

`docs/audits/2026-04-19-admin-impersonation-vs-editing.md` — finns sedan tidigare. `view_as`-mönstret nämns i admin.html rad 3748 (`stadare-dashboard.html?view_as=`). Inte testat i denna audit.
