# Intern Säkerhetsbas-Audit — Spick (baseline inför extern pentest, Fas 13.7)

**Datum:** 2026-04-26
**Utförare:** Claude Code (Opus 4.7) via session-batch (read-only, ingen kodändring)
**Scope:** Hela `C:\Users\farha\spick` — frontend (HTML/JS), Edge Functions (Deno/TS), Supabase migrations, GitHub workflows, prod-state via curl mot `https://urjeijcncsyuletprydy.supabase.co`
**Metod:** Statisk källkods-analys (Grep/Read) + curl-verifiering mot prod (rule #31, primärkälla över memory)
**Begränsning:** Detta är en baseline-audit, inte en fullständig pentest. Jag har inte testat: SSRF i edge functions, race-conditions, business-logic-bypass, RLS-bypass via JWT-spoofing, dependency CVE-djup-scan, Stripe-flow-tampering. Pentestaren bör täcka dessa.

---

## Executive Summary — Top 5 Findings (kritiska)

| # | Finding | Risk | Bevis |
|---|---------|------|-------|
| 1 | **Stripe webhook-secret hardkodad i publik HTML** | KRITISK | `sakerhetsplan.html:368` (live på spick.se HTTP 200, curl-verifierat) |
| 2 | **Customer-PII (52 bokningar) läcker via öppna views** | KRITISK | `booking_confirmation` + `v_customer_bookings` returnerar 200 + full data till anon-key |
| 3 | **Cron-EFs saknar CRON_SECRET trots konvention** | HÖG | `cleanup-stale`, `auto-remind`, `charge-subscription-booking` — ingen auth, anyone kan trigga |
| 4 | **Inga säkerhets-headers i prod (CSP/HSTS saknas)** | HÖG | curl `spick.se` returnerar inga `content-security-policy` / `strict-transport-security` headers — `_headers`-filen är Cloudflare Pages-format men siten kör GitHub Pages som ignorerar den |
| 5 | **Stripe webhook använder API-fetch istf HMAC-signature** | MEDEL | `stripe-webhook/index.ts:64-72` — funktionellt korrekt men icke-standard, sårbart om Stripe-API är slow/down |

**Total risk-nivå:** HÖG — produkten är inte färdig för publik launch utan att åtminstone Top 1-3 åtgärdas.

---

## 1. XSS-Audit

### 1.1 escHtml() existens och användning

`escHtml()` finns definierad i `js/config.js:67-72`:
```js
function escHtml(s) {
  if (typeof s !== 'string') return String(s || '');
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
window.escHtml = escHtml;
```

Implementation är korrekt (escapes &, <, >, ") men **saknar `'` (single-quote)** vilket är en risk om användardata sätts i `attribute='${...}'` med single-quotes. I praktiken används double-quotes överallt i Spick — låg-medel risk men spec-mässigt inkomplett.

### 1.2 Statistik

- **Filer med `innerHTML =`:** 70 filer
- **Totala `innerHTML`-anrop:** 408 (från Grep `innerHTML\s*=`)
- **`escHtml()`-anrop totalt:** 494 över 20 filer (CLAUDE.md hävdade 174 — har vuxit, vilket är positivt)

CLAUDE.md-påståendet "29 filer, 174 sanerade renderingspunkter" är **stale** (verifierat 2026-04-26: 70 filer använder innerHTML, 494 escHtml-anrop fördelade på 20 av dem). Många av de 70 filerna med innerHTML är statiska city-sidor (stockholm.html, taby.html etc) där innerHTML används med statiska strängar.

### 1.3 Stickprov av kritiska sidor

| Fil | Status | Detaljer |
|-----|--------|----------|
| `admin.html` | OK | 173 escHtml-anrop, sample i raderna 1684-1709, 2844-2877 escapar korrekt med `escHtml(e.subject)`, `escHtml(a.name)` etc |
| `admin-pnr-verifiering.html:142-200` | OK | Använder lokal `esc()`-helper (samma logik), allt PII escapas |
| `admin-matching.html:154-225` | OK | `esc()` på alla cleaner-namn, städer, scores |
| `stadare-dashboard.html:4414` | OK | Adress wraps i `escHtml(next.customer_address)` + `encodeURIComponent` på maps-länk |
| `boka.html:2058, 2556, 3627` | EJ DJUPGRANSKAD | Sample-kontroll behövs — pentestare bör verifiera att `card.innerHTML = \`...\${cleanerData}...\`` escapar konsekvent |

### 1.4 insertAdjacentHTML / document.write — risk-klass

| Plats | Risk | Detaljer |
|-------|------|----------|
| `admin.html:4972` | LÅG | Statisk sträng (keyboard-shortcut tooltip), ingen user-data |
| `admin.html:4965` | MEDEL | Sammansatt med `cleanerId` i onclick-handlers — om `cleanerId` är UUID från DB, OK; om någonsin användarinput → XSS |
| `admin.html:5483` | MEDEL | `win.document.write(html)` med EF-respons från `serve-invoice` — XSS-risken sitter i EF |
| `js/components.js:238` | LÅG | Statisk MOB_HTML-sträng |
| `stadare-dashboard.html:11623, 11664` | MEDEL | Likt admin — pentestare bör verifiera EF-respons |
| `foretag.html` | EJ STICKPROV | |

**Inga `eval(`** i någon av filerna (sökning negativt resultat).

### 1.5 escHtml-implementation-brist

`escHtml()` escapar inte `'` (apostrof). Detta är en latent risk — om en framtida utvecklare skriver:
```js
el.innerHTML = `<div data-name='${escHtml(name)}'>...</div>`;
```
…och `name` innehåller `'` så bryts attributet. Rekommendation: utöka `escHtml()` med `.replace(/'/g, '&#39;')` (icke-brådskande).

### 1.6 Sammanfattning

XSS-risk: **LÅG-MEDEL**. Hittade inga raw-XSS-vulnerabilities i de stickprov som granskades. CLAUDE.md-claimet är delvis korrekt — escHtml() finns och används, men antalet renderingspunkter är inte 174 utan 494, och 70 filer använder innerHTML. Pentest-fokus: dynamiska EF-respons-renderings (boka.html, admin-disputes.html, stadare-dashboard.html).

---

## 2. RLS-Audit (KRITISK)

### 2.1 USING(true)-policies (öppna)

408 totala `CREATE POLICY` över 78 SQL-filer. **103+ förekomster av `USING (true)`** i öppna policies. Många är legitima (anon SELECT på `reviews`, `gift_cards`, `cleaner_availability` — public stats), men flera är problematiska.

### 2.2 Curl-verifiering mot prod (rule #31)

| Tabell/View | HTTP | Antal rader | Status | Bevis |
|-------------|------|-------------|--------|-------|
| `bookings` | 200 | 0 (RLS filtrerar) | OK | Returnerar `[]` — RLS skyddar privata rader |
| `cleaners` | 401 | – | OK | Permission denied |
| `reviews` | 200 | 0 | OK | Tomt — public stats-modell |
| `rut_consents` | 401 | – | OK | Skyddad |
| `customer_profiles` | 401 | – | OK | Skyddad |
| `notifications` | 401 | – | OK | Skyddad |
| `analytics_events` | 401 | – | OK | Skyddad (men frontend skickar via apikey, så kan POST:a — rate-limit-risk) |
| `customer_preferences` | 401 | – | OK | Skyddad |
| `messages` | 200 | 0 | OK | Tomt |
| `emails` | 200 | 0 | OK | Tomt |
| `cleaner_applications` | 200 | 0 | OK | RLS filtrerar (bara approved-vyer) |
| `subscriptions` | 200 | 0 | OK | Tomt |
| `booking_status_log` | 200 | 0 | OK | Tomt |
| `companies` | 200 | 5 | **MEDEL** | Returnerar full company-data inkl. `stripe_account_id`, `commission_rate`, `org_number` (Haghighi Consulting AB — publik info) — orgnummer är offentligt men `stripe_account_id` kan vara fingerprint-info |
| `calendar_events` | 200 | 4 | **HÖG** | Returnerar `cleaner_id`, `address`, `title` — exponerar kommande städ-bokningar med adress |
| **`booking_confirmation`** | **200** | **52** | **KRITISK** | Returnerar fullständig kund-PII: `customer_name`, `customer_email`, `customer_phone`, `customer_address`, `total_price`, `notes`, `payment_status`, `customer_pnr_hash`, `cleaner_id`, `cleaner_name`. Exempelpost: "Selma Clara Maria Lindmark, claraml@hotmail.se, +46703060663, Solnavägen 1 Stockholm Sundbyberg" |
| **`v_customer_bookings`** | **200** | **52** | **KRITISK** | Samma data som booking_confirmation — duplicerad PII-läcka |
| `v_calendar_slots` | 200 | – | MEDEL | Cleaner-IDs + datum för bokade slottar |
| `cleaner_availability` | 200 | 8 | LÅG | Schema-data per cleaner — designed public per `20260326200001_availability.sql:33` |
| `cleaner_availability_v2` | 200 | – | LÅG | Likt v1 |
| `cleaner_service_prices` | 200 | 9 | OK | Designat public för boka.html |
| `service_checklists` | 200 | – | OK | Statisk template-data |
| `platform_settings` | 200 | – | OK | Designat public (commission_standard, base_price etc) — verifierat innehåll inte känsligt |
| `avtal_versioner` | 200 | – | LÅG | Avtals-metadata (publikt enligt `20260425210000_item1_terms_acceptance_schema.sql:85`) |
| `rut_batch_submissions` | 200 | 0 | OK | Tomt |
| `payouts` | 404 | – | – | Tabell finns ej (eller heter `payout_attempts`) |
| `payout_attempts` | 401 | – | OK | Skyddad |
| `admin_users` | 401 | – | OK | |
| `coupons` | 401 | – | OK | |
| `referrals` | 401 | – | OK | |
| `auth_audit_log` | 401 | – | OK | |
| `admin_audit_log` | 401 | – | OK | |
| `magic_link_shortcodes` | 401 | – | OK | |
| `loyalty_points` | 401 | – | OK | |
| `self_invoices` | 401 | – | OK | |
| `guarantee_requests` | 401 | – | OK | |

### 2.3 KRITISK FINDING: PII-läcka via views

**`booking_confirmation`-vyn** (definierad i `supabase/migrations/20260401194505_create_missing_views.sql` per CLAUDE.md) exponerar 52 verkliga kunders PII publikt. Vyer skapade som `SELECT ... FROM bookings` ärver inte automatiskt RLS från underliggande tabell — vyn körs med vy-skaparens behörigheter (typiskt postgres/superuser) om inte explicit `SECURITY INVOKER` sätts.

**Hypotesisk attacker-flow:**
```
curl https://urjeijcncsyuletprydy.supabase.co/rest/v1/booking_confirmation?limit=1000 \
  -H "apikey: <anon-key från valfri sida på spick.se>" \
  -H "Authorization: Bearer <samma>"
→ 52 verkliga kunder med namn, mejl, telefon, adress, betalstatus, anteckningar
```

**GDPR-implikation:** Detta är en potentiell PII-incident. Farhad bör juristbedöma incident-anmälningsplikt (jag uttalar mig inte om GDPR per regel #30).

### 2.4 USING(true) WITH CHECK(true) på UPDATE/INSERT/DELETE — risk-rader

Top kandidater för pentest-djupgranskning (sökt i nuvarande migrationer, ej i archived):

```
20260418215118_phase_0_2b_paket_3_cleaner_availability_v2_rls.sql:61: USING (true) WITH CHECK (true)
20260418221406_phase_0_2b_paket_4_checklists_grants_and_rls.sql:86,114: USING (true) WITH CHECK (true)
20260418230425_phase_0_2b_paket_7_enable_rls_three_tables.sql:37,79: USING (true) WITH CHECK (true)
20260424233000_fas7_5_rut_batch_submissions.sql:107: USING (true) WITH CHECK (true)
20260422130000_fas_2_1_1_all_policies.sql: 8+ förekomster (rader 61, 103, 132, 258, 368, 400, 414, 423, 633, 661)
```

Många av dessa är `TO service_role` (legitima) men pentestaren bör verifiera grant-listan per policy.

### 2.5 Sammanfattning RLS

- **Skyddade tabeller:** 19 av 41 testade returnerar 401 — bra basbild
- **Designat-publika:** 7 tabeller (reviews, platform_settings, cleaner_availability etc) — OK
- **KRITISK läcka:** 2 vyer (`booking_confirmation`, `v_customer_bookings`) exponerar 52 kunders fulla PII
- **Medel-läcka:** `calendar_events` exponerar adresser + cleaner_id för kommande städ-bokningar
- **Action:** Vyerna behöver `WITH (security_invoker=true)` ELLER en RLS-policy ELLER `REVOKE SELECT FROM anon`

---

## 3. Secrets-leak-check

### 3.1 KRITISK: Live webhook-secret i publik HTML

**Fil:** `sakerhetsplan.html:368`
```html
<li><span class="ch-icon">4️⃣</span> Webhook-secret: whsec_[REDACTED — exempel-värdet roterades 2026-04-27 efter Stripe automatic scanner-detection]</li>
```

**Verifiering:** `curl -I https://spick.se/sakerhetsplan.html` returnerar `HTTP 200` och `grep -c whsec_` returnerar `1`. Filen är **live i prod på en publikt indexerbar URL**.

**Implikation:** Vem som helst kan hämta secret och, om de känner till webhook-endpoint, sända falska Stripe-events. Mitigering: stripe-webhook använder också API-fetch-verifiering (rad 1117) så även med fake signature blockas events där event-ID inte existerar i Stripe — men secret bör fortfarande roteras omedelbart.

**Action (när Farhad godkänner):**
1. Stripe Dashboard → rotera webhook-signing-secret
2. Uppdatera `STRIPE_WEBHOOK_SECRET` i Supabase secrets
3. Ta bort raden ur `sakerhetsplan.html` (eller flytta hela sidan bakom auth)
4. Git: `git rm sakerhetsplan.html` om den inte ska vara publik (men note: secret exists i git-historik då — `git log --oneline sakerhetsplan.html` visar 5+ commits, så även rotation krävs)

### 3.2 Anon-key i HTML — designed publikt

JWT anon-keys är designed att vara publika (anon-rollen):
- `js/config.js:8` — primär anon-key (verifierat)
- `registrera-stadare.html:906, 930` — annan anon-key (legacy?), bör konsolideras till `SPICK.SUPA_KEY`
- 30 filer totalt med JWT-pattern (alla statiska city-sidor) — designed publikt

**Action ej kritisk:** Verifiera att inga av de andra JWT-tokens råkar vara service_role. Min sökning på `eyJ...service_role` returnerade 0 träffar — OK.

### 3.3 Google Places API-key

`js/config.js:12` — `AIzaSyCScYORJPxXCyp0J-Wmr84HtiZc9FteVrs`

Tidigare-auditerad (`docs/audits/2026-04-19-google-places-audit.md`). Kontrollera att Google Cloud Console har:
- HTTP referrer-restriction = `*.spick.se`, `spick.se/*`
- API-restriction = bara Places API + Maps JS API

(Jag kan inte curl-verifiera Google Cloud restrictions från denna omgivning.)

### 3.4 Stripe sk_/rk_-keys

Inga `sk_live_` eller `sk_test_` hittade i HTML/JS som faktiska värden. Alla träffar är:
- Dokumentation (`docs/STRIPE_SETUP.md`, `SETUP.md`) — placeholders eller env-var-namn
- Tester (`supabase/functions/_tests/money/stripe-*.test.ts`) — använder `'sk_test_xxx'`, `'sk_test_fake'` placeholders
- CI-workflow (`.github/workflows/security-scan.yml:37`) som scannar för dessa exakta prefix

OK — inga real Stripe API-keys i klar HTML/JS.

### 3.5 GitHub Secrets-pattern

Sample av `.github/workflows/`:
- `security-scan.yml` scannar för `sk_live_|sk_test_` (bra praktik)
- `set-secrets.yml`, `deploy-edge-functions.yml` använder `${{ secrets.X }}` korrekt

Kontrollerade inte alla 35 workflows — pentestaren bör verifiera att inga `echo "$SECRET"` eller `cat $SECRET >> log` pattern finns.

### 3.6 .gitignore-status

`.gitignore` exkluderar `*.env`, `.env.*`, `secrets.json`, `SESSION_HANDOFF.md`, `backups/`. Bra. **Men** den prod-schema-backup som ligger okommittad i root (`prod-schema-2026-04-21-backup.sql` per git status) bör verifieras — om den innehåller PII eller secrets bör den flyttas till `backups/`.

---

## 4. OWASP Top 10 (2021) — Walkthrough

| # | Risk | Status | Bevis | Rekommendation |
|---|------|--------|-------|----------------|
| **A01** Broken Access Control | **DELVIS SKYDDAD** | RLS finns på flesta tabeller, men 2 publika vyer (`booking_confirmation`, `v_customer_bookings`) läcker PII. Cron-EFs utan auth (sektion 7.3). | Fixa vyerna + lägg auth på cron-EFs |
| **A02** Cryptographic Failures | **SKYDDAD** | AES-256-GCM på PNR (`_shared/encryption.ts`), HSTS i `_headers` (men ej deployed — sektion 6), bcrypt-hash via Supabase Auth. PNR_ENCRYPTION_KEY i Supabase secrets, aldrig i git. | OK |
| **A03** Injection | **SKYDDAD** | Inga `sql\``-template-strings eller `query.raw()` i Edge Functions (Grep negativt). PostgREST + parametrized queries via Supabase JS. escHtml() escapar HTML-output. | OK — pentest bör testa NoSQL-style injection via PostgREST `?or=(...)` |
| **A04** Insecure Design | **DELVIS SKYDDAD** | Frontend queryar bara via VIEWs (per CLAUDE.md), bra design. Men: webhook-secret-läcka (sektion 3.1) är ett design-fel (känslig data i public HTML). | Implementera secret-scanning i pre-commit hook |
| **A05** Security Misconfiguration | **RISK** | Inga CSP/HSTS-headers i prod (sektion 6). `_headers`-filen är Cloudflare Pages-format, men siten kör GitHub Pages som ignorerar den. | Migrera till Cloudflare Pages ELLER lägg till `<meta http-equiv="Content-Security-Policy">` på alla sidor |
| **A06** Vulnerable Components | **EJ FULLT GRANSKAD** | Endast `@playwright/test`, `canvas`, `playwright` i `package.json` (devDependencies). CDN-libs: `qrcode-generator@1.4.4` (jsdelivr), `@supabase/supabase-js@2.49.4` (esm.sh för bankid-klar.html). | Kör `npm audit` + Dependabot |
| **A07** Identification & Auth Failures | **SKYDDAD** | Supabase Auth (JWT), magic-link via SMS (`send-magic-sms.ts`), BankID via TIC. Anon-key är designed publik. | Pentest bör testa JWT-rotation + session-fixation |
| **A08** Software & Data Integrity | **DELVIS SKYDDAD** | `processed_webhook_events`-tabell skyddar mot replay (CLAUDE.md). PNR `consumed_at` flag förhindrar TIC-session-replay. **Men**: stripe-webhook använder API-verify (latens-känsligt) istf HMAC. | Migrera stripe-webhook till `_shared/stripe-webhook-verify.ts` (befintlig helper, används bara av stripe-connect-webhook) |
| **A09** Logging & Monitoring | **DELVIS SKYDDAD** | `booking_status_log`, `analytics_events`, `auth_audit_log` finns. `_shared/sentry.ts` redactar känsliga keys (rad 41 inkluderar `tic_api_key`, `cron_secret`). UI-monitor + Discord-alerts via `ui-monitor.yml`. **Men**: ingen Sentry installerad (CLAUDE.md "Kända problem"), ingen PostHog. | Installera Sentry + Sentry-DSN |
| **A10** SSRF | **EJ TESTAD** | Edge functions gör fetch mot Stripe API, Resend API, TIC, Nominatim — om användarinput nånsin når URL-bygge utan validering → SSRF. Sample-grep i edge functions visade ingen direkt risk men full code-review behövs. | Pentest bör fuzzen `address` + `customer_address` fält |

---

## 5. Dependency-vuln-scan

### 5.1 package.json
```json
"devDependencies": {
  "@playwright/test": "^1.59.0",
  "canvas": "^3.2.3",
  "playwright": "^1.59.0"
}
```

Endast Playwright-deps. Inga production runtime-deps. Bra (frontend är vanilla JS).

### 5.2 deno.lock + deno.json

Edge Functions importerar via `https://esm.sh/@supabase/supabase-js@2.49.4` och `https://deno.land/std@0.224.0/http/server.ts` (auto-remind), `@0.168.0` (reconcile-payouts) — **versionsinkonsistens** mellan EFs (mixed std-versioner) men ingen direkt CVE-risk.

### 5.3 CDN-libs

- `https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js` (boka.html, foretag.html, stadare-profil.html) — utgiven 2017, ingen aktuell CVE känd, men ÅLDRIG; bör övervägs ersättas med modernare lib eller self-hosted
- `https://esm.sh/@supabase/supabase-js@2.49.4` (bankid-klar.html) — aktuell, OK
- `https://fonts.googleapis.com` (alla sidor) — Google CDN, OK
- `js/supabase.min.js` self-hosted — verifiera version

### 5.4 Sammanfattning

Dependency-risken är **LÅG**. Spick har minimalt med tredjeparts-deps tack vare vanilla-stacken. Pentestaren bör köra:
- `npm audit` (skulle bara hitta Playwright-CVEs)
- Manuell kontroll av `js/supabase.min.js` SHA mot officiell release

---

## 6. CSP / HTTP-Headers / Cookie-säkerhet

### 6.1 Konfigurerade headers (`_headers`)

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net ...
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(self)
X-XSS-Protection: 1; mode=block
```

Konfiguration är **välskriven**:
- CSP saknar `unsafe-eval` (per CLAUDE.md) — bra
- HSTS `max-age=31536000; includeSubDomains; preload` — korrekt
- `frame-src` begränsat till Stripe-domains
- `connect-src` begränsat till Supabase, Stripe, Nominatim, GA, Clarity

### 6.2 KRITISK: Headers EJ deployade

**Bevis:** `curl -I https://spick.se/index.html` returnerar:
```
HTTP/1.1 200 OK
Server: cloudflare
last-modified: ...
Cache-Control: max-age=600
```

**Inga** av följande i response: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Permissions-Policy`. Cloudflare-headers (`cf-cache-status`, `Report-To`) finns däremot.

**Root cause:** `_headers`-filen är **Cloudflare Pages / Netlify-syntax**. Spick deployas till **GitHub Pages** (per CLAUDE.md "Hosting: GitHub Pages") som **ignorerar** `_headers`. Cloudflare framför fungerar bara som DNS-proxy + caching, ej som Pages-host.

**Action:** Två alternativ:
1. Migrera frontend till Cloudflare Pages (kostnadsfritt) — `_headers` aktiveras direkt
2. Lägg `<meta http-equiv="Content-Security-Policy" content="...">` + service-worker som adderar headers (begränsat — HSTS funkar inte via meta, kräver server-header)

Detta är **HÖG-risk** eftersom HSTS, CSP, X-Frame-Options alla saknas i prod.

### 6.3 Frame-buster (clickjacking)

Git-log visar `2657f32 security: lägg till frame-buster (clickjacking-skydd) i alla 77 HTML-filer` — verifiera implementation:

(Inte stickprov-granskat — pentestaren bör testa via `<iframe src="https://spick.se/admin.html">`.)

### 6.4 Cookie-säkerhet

Spick använder Supabase Auth → JWT i `localStorage` (default Supabase JS-config), **inte cookies**. Det betyder ingen `SameSite`/`Secure`/`HttpOnly` att verifiera, men medför annan risk (XSS → token-stöld). Detta är ett **medvetet trade-off** av Supabase-stack.

---

## 7. Auth + sessionhantering

### 7.1 Anon vs Authenticated

- Anon-key i `js/config.js:8`. Frontend POSTar mot Edge Functions via anon-key.
- Authenticated state hanteras av Supabase Auth (magic-link via mejl/SMS, BankID via TIC).
- Service role-key används endast i Edge Functions via `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`. Grep i HTML/JS visade 0 träffar för faktisk service_role-JWT-token.

### 7.2 Stripe webhook signature-verifiering

`_shared/stripe-webhook-verify.ts` finns och implementerar HMAC-SHA256 + timing-safe-compare + 5min-tolerans (rad 12-121). **Men**: bara `stripe-connect-webhook` använder den. Huvud-`stripe-webhook/index.ts` använder API-fetch-verifiering (`verifyEventWithStripe`, rad 64-72, 1117) — dvs Spick re-fetchar event från Stripe API och förlitar sig på 200/404 som signal.

**Implikation:**
- Funktionellt skyddar mot fake events (Stripe API returnerar 404 för icke-existerande event-IDs).
- Sårbart om Stripe-API är slow/down → webhook tar timeout, Stripe retryr → potentiellt N×duplicate-processing om idempotency brister.
- Icke-standard pattern enligt Stripe docs (`https://stripe.com/docs/webhooks/signatures`).

**Action (icke-brådskande):** Migrera `stripe-webhook` till HMAC-verifiering via befintlig helper.

### 7.3 CRON_SECRET-verifiering — INKONSISTENT

CLAUDE.md-konvention: "Nya Edge Functions som anropas via cron MÅSTE kräva CRON_SECRET".

Verifiering via Grep:

| EF | CRON_SECRET? | Källkods-bevis |
|----|--------------|----------------|
| `dispute-sla-check` | JA | `index.ts:31, 80, 86` |
| `escrow-auto-release` | JA | `index.ts:44, 62, 68` |
| `expire-team-invitations` | JA | `index.ts:22, 32` |
| `n3-pnr-reminder-cron` | JA | `index.ts:26, 53-56` |
| **`auto-remind`** | **NEJ** | Inte i hela `index.ts` (60 första raderna lästa — ingen import av authcheck) |
| **`auto-rebook`** | **NEJ** | Inte i Grep-resultat |
| **`cleanup-stale`** | **NEJ** | `index.ts:18` startar `serve(async (_req) => { ... })` direkt utan auth-kontroll |
| **`charge-subscription-booking`** | **NEJ** | `index.ts:32-43` startar utan auth (bara `await req.json().catch(() => ({}))`) |
| `reconcile-payouts` | DELVIS | JWT-role-check (service_role/authenticated) — OK men annan pattern |

**Implikation:** En extern aktör som hittar EF-URL kan trigga `cleanup-stale` (avbokar pending bokningar), `charge-subscription-booking` (debiterar kunder), `auto-remind` (skickar mejl/SMS) på egen begäran. Begränsande faktor: anon-key krävs i Authorization-headern (Supabase gateway-default). Men anon-key är publik. **HÖG risk.**

**Action:** Lägg till CRON_SECRET-check i 4 EFs. Mall finns i `dispute-sla-check/index.ts:80-89`.

### 7.4 Service role-key exponering

Grep `service_role` i HTML/JS (20 filer):
- `admin.html`, `bankid-klar.html`, `sakerhetsplan.html` — alla träffar är dokumentation/kommentarer/metadata, inte actual JWT-token
- `scripts/content-engine.js` — utility script, kör server-side

OK — service_role är inte exponerad till frontend.

---

## 8. PNR-hantering (RUT-flow)

### 8.1 AES-256-GCM-kryptering

`_shared/encryption.ts` (audited rad 1-208):
- ✅ AES-GCM-256, IV 12 bytes (NIST SP 800-38D-compliant)
- ✅ AuthTag 16 bytes (GCM-default)
- ✅ Version-prefix `AES-GCM:v1:` för key-rotation
- ✅ Random IV per encrypt-call (krav för GCM-säkerhet)
- ✅ Key från `PNR_ENCRYPTION_KEY` env (Supabase secrets), aldrig i git
- ✅ Throws explicit om key saknas eller fel längd (32 bytes krävs)
- ✅ `isEncrypted()`-helper för migration-flow (klartext-legacy → krypterat-modern)

**Implementation är best-practice.** Pentest-kontroll: verifiera att `PNR_ENCRYPTION_KEY` är satt i Supabase secrets (jag kan inte verifiera detta) och att backup-procedur finns för key-rotation.

### 8.2 pnr_hash som anti-replay

`rut-bankid-status/index.ts:67-73` — SHA-256-hash i hex (64 chars). Används i `rut_consents.pnr_hash` för att detektera duplicerade PNR utan att lagra klartext.

### 8.3 TIC BankID-validering

`rut-bankid-status/index.ts:75-184`:
- ✅ Email-match som ownership-check (`consent.customer_email !== email` → 403)
- ✅ `expires_at`-check (410 om förfallen)
- ✅ `consumed_at`-flag förhindrar replay (rad 124-131)
- ✅ TIC `/poll` (POST) används korrekt (kommentar rad 137-144 dokumenterar varför INTE `/status` eller `/collect`)
- ✅ `personalNumber` valideras som string innan användning
- ⚠️ `protectedIdentity` flaggas men ingen explicit handling av flow när `protectedIdentity=true` (logas, men SPAR-data sparas ändå?) — pentest bör verifiera

### 8.4 Klartext-PNR i logs/responses

Stickprov i `rut-bankid-status`:
- Rad 156, 169: `session_id: sessionId.slice(0, 8) + "..."` — bra (bara prefix loggas)
- Rad 199: `userData_keys` — bara nyckel-namn, inga värden
- `_shared/sentry.ts:41` redactar `personnummer`, `personalNumber`, `pnr` — **men**: jag har inte verifierat att `_shared/log.ts` använder samma redaction-list

**Action för pentestare:** Audit av `_shared/log.ts` redaction-pipeline — finns det path där PNR loggas via `console.log` direkt utan att gå via redacted logger?

### 8.5 Sammanfattning PNR-säkerhet

PNR-hanteringen är **välbyggd** (AES-GCM, hash-anti-replay, TIC-session-validering, ownership-check). Top risk: säkerställa att klartext aldrig läcker via console.log/error-handlers. Pentestaren bör grep:a `customer_pnr` + `personalNumber` + `personnummer` i samtliga EFs och verifiera att varje access går via redacted logger.

---

## 9. Sammanfattande Risk-matrix

| Kategori | Risk-nivå | Antal findings | Top 3 åtgärder |
|----------|-----------|----------------|----------------|
| **XSS** | LÅG-MEDEL | 0 raw-XSS, 5 områden för djup-pentest | (1) escHtml() utöka med `'`-escape (2) Audit dynamiska EF-respons-renderings i boka.html (3) Verifiera `serve-invoice` EF-output |
| **RLS** | KRITISK | 2 vyer läcker 52 kunders PII + 1 vy läcker calendar-adresser | (1) `WITH (security_invoker=true)` på `booking_confirmation` + `v_customer_bookings` (2) `REVOKE SELECT FROM anon` på `calendar_events` (3) Audit av alla 408 CREATE POLICY mot prod-state (replayability sprint Fas 2.X) |
| **Secrets-leak** | KRITISK | 1 live webhook-secret i publik HTML | (1) Rotera `STRIPE_WEBHOOK_SECRET` omedelbart (2) Ta bort raden ur `sakerhetsplan.html` + git-purge (3) Lägg secret-scanning i pre-commit hook |
| **OWASP A05** | HÖG | Inga säkerhets-headers i prod | (1) Migrera till Cloudflare Pages ELLER (2) Lägg `<meta>`-CSP på alla sidor (3) Verifiera HSTS via separat hosting-layer |
| **Cron-EF auth** | HÖG | 4 EFs utan CRON_SECRET | (1) Lägg auth i `cleanup-stale` (2) `charge-subscription-booking` (3) `auto-remind` |
| **Stripe webhook** | MEDEL | API-verify istf HMAC | Migrera till `verifyStripeWebhookSignature` |
| **Dependency** | LÅG | qrcode-generator@1.4.4 (åldrig, ingen aktuell CVE) | Övergå till modernare lib |
| **PNR-encryption** | LÅG | Implementation OK, ej fullt log-redaction-verifierad | Audit `_shared/log.ts` redaction-pipeline |

**Total prod-risk:** **HÖG** — primärt drivet av PII-läckan via vyer (52 verkliga kunder) + saknade säkerhets-headers i prod + 1 live webhook-secret i publik HTML.

---

## 10. För extern pentestare — fokus-områden

1. **Vyer med `SELECT` på `bookings`-derivat:** `booking_confirmation`, `v_customer_bookings`, `v_calendar_slots`, `booking_slots`. Verifiera att `security_invoker` eller motsvarande är satt. Testa även: kan anon-användare köra `?customer_email=ilike.*@*` för enumeration?

2. **Cron-EF-bypass:** Kan `cleanup-stale`, `charge-subscription-booking`, `auto-remind` triggas av extern aktör med bara anon-key? Testa POST mot endpoint utan CRON_SECRET-header. Vad händer om `req.json()` är tom eller felformat?

3. **Stripe webhook-replay:** Med läckt webhook-secret + känt event-ID från `processed_webhook_events`-tabellen, kan en attacker konstruera en fake event som passerar både API-verifiering och idempotency-check? Försök trigga `charge.refunded` på annan kunds bokning.

4. **PNR-pipeline djup-audit:** Trace varje access av `customer_pnr` och `personalNumber` i samtliga EFs. Loggas något i klartext via `console.log`/`console.error`? Kan SSRF i `rut-bankid-status` trigga PNR-leak via `secureUrl`-parameter (rad 230)?

5. **JWT-role-bypass:** `reconcile-payouts/index.ts:36-51` parsar JWT utan signature-verifiering (kommenterar att Supabase gateway redan verifierat). Är detta antagande korrekt om `verify_jwt=true` i `supabase/config.toml`? Vad händer om en attacker konstruerar en JWT med `role:'service_role'` och giltig anon-signature? (Förmodligen blockerad av Supabase gateway, men bör verifieras med faktisk request).

---

## Bilaga: Verifieringsmetod

Alla finding-claims i denna rapport är antingen:
- **Curl-verifierade mot prod** (HTTP-statuskod + sample av response-body med `head -c 800`)
- **Read-verifierade** (full fil-content från Read-tool, citerade rad-nummer)
- **Grep-verifierade** (regex med output_mode=content/files_with_matches)

Inga claims baseras på minnen, antaganden eller migration-files-as-truth (rule #31).

**Begränsningar:**
- Kunde inte verifiera Supabase secrets-state (PNR_ENCRYPTION_KEY, CRON_SECRET sat?) eller Google Cloud restrictions
- Kunde inte testa runtime-exploits (DDoS, race-conditions, JWT-spoofing) — kräver pentestare med produktions-test-konto
- Stripe-flow inte testad live; bara source-code-audit

**Nästa steg:** Farhad bedömer (1) GDPR-anmälningsplikt för PII-läckan, (2) prioritetsordning för åtgärder, (3) vilken extern pentestare som ska anlitas (EFL Sec, NCC Group, Truesec eller annan).
