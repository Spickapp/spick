# Fas 1.2 — Unified Identity Architecture (v2)

**Status:** Design-dokument (uppdaterad efter grep-verifiering)
**Datum:** 19 april 2026 08:45
**Författare:** Farhad + Claude (projektchef)

---

## Vad ändrades från v1

Efter Claude Code-grep upptäcktes:
1. `customers`-tabellen har **0 kodkonsumenter** → säker att droppa
2. `customer_profiles` skapas via **anon-INSERT från 9 filer** (fragmenterat)
3. **Ingen** EF skapar auth.users för kunder idag
4. `data-dashboard.html:298` läcker customer_profiles PII publikt
5. De 26 bookings → 3 auth-users är kunder som **aktivt loggat in** via mitt-konto

Det betyder arkitekturen utökas till att inkludera:
- **Deprecate `customers`-tabellen**
- **Konsolidera `customer_profiles`-skapande** till en enda pipeline
- **Auto-skapa auth.user** i booking-flödet (ny flow)
- **Fas 1.1-liknande lockdown** för `customer_profiles` (ny PII-fix)

---

## Nuläge (uppdaterat 19 april 2026)

### Data
- 26 bookings, 3 unika kund-emails
- 27 auth.users (3 kunder + cleaners + admin)
- `customer_profiles`: 1 rad (misstänkt fler — verifiera), 0 auth_user_id-länkade
- `customers`: okänt antal rader, **0 kodkonsumenter**

### customer_profiles-skapande-källor (9 ställen)
| Fil:rad | Operation | Via |
|---|---|---|
| betyg.html:26 | INSERT | anon |
| huddinge.html:21 | INSERT | anon |
| nacka.html:21 | INSERT | anon |
| solna.html:21 | INSERT | anon |
| stockholm.html:21 | INSERT | anon |
| sundbyberg.html:21 | INSERT | anon |
| taby.html:21 | INSERT | anon |
| mitt-konto.html:577,805 | upsert/select | auth |
| admin.html:2056,4938,4948 | select/count | auth (admin) |

### customer_profiles-läsande-källor
| Fil:rad | Operation | Risk |
|---|---|---|
| boka.html:2790 | select `auto_delegation_enabled&email=eq.` | Anon-SELECT — potentiell PII-läcka |
| **data-dashboard.html:298** | **select=*** | **PUBLIK PII-LÄCKA** |
| admin.html | select=* | OK (auth) |
| auto-remind/index.ts:448 | select | OK (service_role) |
| auto-delegate/index.ts:64 | select | OK (service_role) |

### customers-status
**0 kodkonsumenter.** Stripe-referenser i EF är `api.stripe.com/v1/customers` (externt), inte Supabase-tabellen.

---

## Uppdaterad arkitekturprincip

### Princip 6 (NY): Kund-skapande är EN flow, inte 9

**Problem:** 9 anon-INSERT-ställen skapar customer_profiles ad-hoc. Det är fragmentering (Regel #28).

**Lösning:** Alla kund-skapande flöden går via ny EF `customer-upsert`:

```typescript
// supabase/functions/customer-upsert/index.ts
export async function customerUpsert({
  email: string,
  name?: string,
  phone?: string,
  address?: string,
  city?: string,
  source: 'booking' | 'lead-capture' | 'rating' | 'landing-page',
  sourcePageSlug?: string,  // t.ex. "huddinge"
  autoDelegationEnabled?: boolean,
}): Promise<{ customer_profile_id, auth_user_id, is_new_customer }>
```

**Intern flöde:**
1. Hitta eller skapa `auth.users`-rad för email
2. Hitta eller skapa `customer_profiles`-rad länkad till auth_user_id
3. Merge inkommande data (senaste vinner för name/phone/address)
4. Logga i `auth_audit_log` (event_type=`auth_user_created` eller `customer_profile_updated`)
5. Returnera IDs

**Frontend-ändringar:**
- 6 stad-landingssidor: byter `fetch('/rest/v1/customer_profiles', {INSERT})` mot `fetch('/functions/v1/customer-upsert', {POST})`
- betyg.html: samma
- mitt-konto.html: samma men i auth-kontext
- admin.html: behåller (admin kan direktskriva)

### Princip 7 (NY): PII-lockdown av customer_profiles (Fas 1.1-pattern)

Samma mönster som cleaners fick:

1. **Skapa `v_customer_profiles_public` view** med safe-kolumner (för anon-stat):
   ```sql
   CREATE VIEW v_customer_profiles_public AS
   SELECT 
     id, city, auto_delegation_enabled, total_bookings, created_at
     -- INTE: email, phone, name, address, pnr_hash, stripe_customer_id
   FROM customer_profiles;
   ```

2. **boka.html auto_delegation-check:** behåll enkel lookup, men byt till en EF som returnerar bool (inte rå tabellaccess):
   ```typescript
   // /functions/v1/customer-check-auto-delegation?email=xxx
   // Returnerar: { auto_delegation_enabled: bool }
   ```

3. **data-dashboard.html:298 fix:** byt `select=*` till `v_customer_profiles_public` (publik stat utan PII)

4. **REVOKE anon SELECT** på customer_profiles-tabellen

---

## Uppdaterade DB-migrationer

### Migration 1: `magic_link_shortcodes` + `auth_audit_log` (oförändrad från v1)

### Migration 2: Backfill customer_profiles (förenklad)
- Nu när vi vet att 3 unika kunder har auth.users + 0 har profil-länk
- Skapa 3 customer_profiles med auth_user_id

### Migration 3 (NY): Drop customers-tabellen
```sql
BEGIN;
-- Backup-check
SELECT COUNT(*) AS rows_in_customers FROM customers;
SELECT pg_size_pretty(pg_total_relation_size('customers'::regclass)) AS size;

-- Drop alla policies på customers (CASCADE städar)
DROP TABLE IF EXISTS customers CASCADE;

-- Verify
SELECT * FROM information_schema.tables 
 WHERE table_schema='public' AND table_name='customers';
-- Förväntat: 0 rader
COMMIT;
```

### Migration 4 (NY): customer_profiles PII-lockdown
Se Princip 7 ovan — speglar Fas 1.1-arbetet.

### Migration 5: RLS-skärpning booking_status_log/messages/subscriptions (oförändrad)

---

## Uppdaterade EF-komponenter

### EF 1: `public-auth-link` (oförändrad från v1)

### EF 2: `public-auth-exchange` (oförändrad från v1)

### EF 3 (NY): `customer-upsert`
Ansvar: centraliserad kund-skapande-pipeline. Ersätter 9 anon-INSERT-ställen.

### EF 4 (NY): `customer-check-auto-delegation`
Ansvar: enkel bool-endpoint för boka.html istället för rå tabellaccess. Tar email, returnerar `{auto_delegation_enabled: bool}`. Skyddar PII.

### Gemensam hjälpare: `_shared/send-magic-sms.ts` (oförändrad)

---

## Uppdaterad booking-skapande-flow

**Före:**
1. Kund fyller boka.html
2. Frontend INSERT till `bookings` med anon-key
3. Frontend INSERT (ibland) till `customer_profiles` med anon-key
4. **Ingen auth.user skapas**

**Efter:**
1. Kund fyller boka.html
2. Frontend POSTar till `booking-create` EF (befintlig)
3. `booking-create` anropar internt `customer-upsert` → auth.user + customer_profile skapas
4. `booking-create` skickar SMS via `sendMagicSms()` → magic-link till kunden
5. Kund klickar SMS → landar inloggad på `min-bokning.html`

---

## Uppdaterad tidsestimat

| Dag | Aktivitet | Tid |
|---|---|---|
| **Dag 1 (idag)** | Design-dokument + migrations-utkast | 3-4h (KLART) |
| **Dag 2** | DB-migrationer + 4 EF:er (public-auth-link, public-auth-exchange, customer-upsert, customer-check-auto-delegation) | 8-10h |
| **Dag 3** | SMS-callsites migrering + frontend `/m/:code` + 9 frontend-ställen till customer-upsert | 6-8h |
| **Dag 4** | RLS-skärpning (3 tabeller + customer_profiles) + mitt-konto rebuild + customers DROP | 6-8h |
| **Totalt** | **23-30h över 4 dagar** | |

**Ökning från v1:** +4h för kund-upsert-konsolidering och customer_profiles PII-fix.

**Rationale:** Vi gör rätt en gång. Regel #28 — centralisera kund-skapande innan det blir fler fragmenterade ställen.

---

## Fas 1.2 framgångskriterier (uppdaterade)

- [ ] 0 qual=true-policies på SELECT till anon för booking_status_log, messages, subscriptions, **customer_profiles**
- [ ] 0 anon-grants för SELECT/INSERT/UPDATE på de 4 tabellerna
- [ ] Alla 12+ SMS-callsites använder `sendMagicSms()`
- [ ] Alla 9 frontend-ställen använder `customer-upsert` EF
- [ ] `customers`-tabell droppad
- [ ] `v_customer_profiles_public` view skapad + frontend migrerat
- [ ] Empirisk test: ny kund bokar → auth.user skapas → customer_profile länkad → SMS med magic-link → klick → inloggad
- [ ] Empirisk test: anon kan inte läsa customer_profiles-tabellen direkt
- [ ] `mitt-konto.html` fungerar fullt för inloggad kund
- [ ] auth_audit_log loggar alla events
- [ ] Dokumentation + incidentrapport + commits pushade

---

*Uppdaterad 19 april 2026 kl 08:45 efter grep-verifiering*
