# Admin.html — Funktioner för Solid Service-demo (2026-04-19)

**Syfte:** Kartlägga vilka demo-kritiska funktioner som FINNS/SAKNAS i admin.html inför Rafaels pilot-möte.
**Metod:** Regel #26 + #27 — alla påståenden citerar [admin.html](admin.html):rad eller [index.ts](supabase/functions/admin-create-company/index.ts):rad.
**Filstorlek:** admin.html = 5952 rader (fullt läst via grep + sektions-läsningar, ej full sekventiell läsning).

---

## TL;DR — Kan vi köra demo imorgon?

**Ja, med reservationer.** Den stora positiva överraskningen: en färdig **Company Wizard** (5 steg) i `showPage('company-wizard')` skapar företag + VD + cleaners + priser + team i EN knapp-tryckning via EF [admin-create-company](supabase/functions/admin-create-company/index.ts).

**Men 3 Kategori A-funktioner saknas helt i admin.html:**

| # | Funktion | Status |
|---|----------|--------|
| 1 | Bjud in teammedlem via SMS-länk | ❌ **SAKNAS** |
| 2 | Stripe Connect onboarding-länk från admin | ❌ **SAKNAS** (bara status-visning) |
| 3 | Underleverantörsavtal-accept | ❌ **SAKNAS** (bara `employment_model`-dropdown) |

Detaljer, fil:rad-citat och work-arounds nedan.

---

## 1. Huvudstruktur i admin.html

### Sido-navigation (alla sidor)
[admin.html:301-336](admin.html) — 20 nav-items:

| Nav | fil:rad | showPage('X') |
|-----|---------|---------------|
| Dashboard | [admin.html:301](admin.html) | `dashboard` |
| Alla bokningar | [admin.html:304](admin.html) | `bookings` |
| Väntande | [admin.html:305](admin.html) | `pending` |
| Prenumerationer | [admin.html:306](admin.html) | `subscriptions` |
| Städare | [admin.html:309](admin.html) | `cleaners` |
| Ansökningar | [admin.html:310](admin.html) | `applications` |
| Onboarding | [admin.html:311](admin.html) | `onboarding` |
| **Nytt företag** 🏢 | [admin.html:312](admin.html) | `company-wizard` |
| Kunder | [admin.html:315](admin.html) | `customers` |
| Recensioner | [admin.html:316](admin.html) | `reviews` |
| Utbetalningar | [admin.html:319](admin.html) | `payouts` |
| Självfakturor | [admin.html:320](admin.html) | `self-invoices` |
| Supportärenden | [admin.html:324](admin.html) | `support` |
| Ersättarärenden | [admin.html:325](admin.html) | `reassignments` |
| Kvalitet & Risk | [admin.html:326](admin.html) | `quality` |
| Team & Roller | [admin.html:329](admin.html) | `team` |
| Plattformsinställningar | [admin.html:330](admin.html) | `platform-settings` |
| Aktivitetsflöde | [admin.html:331](admin.html) | `activity` |
| Ändringslogg | [admin.html:332](admin.html) | `audit` |
| Systemstatus | [admin.html:333](admin.html) | `system-status` |
| E-post | [admin.html:335](admin.html) | `inbox` |
| Inställningar | [admin.html:336](admin.html) | `settings` |

---

## 2. KATEGORI A — Demo-kritiska funktioner

### A1. Skapa företag (INSERT companies) — ✅ FINNS

**UI:** Company Wizard Steg 1 "Företagsinfo"
- Markup: [admin.html:1051-1068](admin.html)
- Fält: `cw-name`, `cw-org`, `cw-email`, `cw-phone`, `cw-city`, `cw-bio`, `cw-employment` (employed/contractor)

**Trigger:** Knappen "Skapa allt ✨" på steg 5 → `cwSubmit()` [admin.html:5159](admin.html)

**Backend:** POST `/functions/v1/admin-create-company`, payload byggs av `cwCollectData()` [admin.html:5450-5497](admin.html) och skickas [admin.html:5507-5511](admin.html).

**INSERT:** [supabase/functions/admin-create-company/index.ts:54-63](supabase/functions/admin-create-company/index.ts) (companies)

**Förväntat resultat:** Ny rad i `companies` med `name`, `org_number`, `slug`, `commission_rate`, `employment_model`. Returnerar `company_id` + `public_url` (`https://spick.se/f/<slug>`).

---

### A2. Skapa cleaner + koppla till company — ✅ FINNS

**UI:** Samma wizard, steg 2 (VD) + steg 4 (team)
- Steg 2 "VD": [admin.html:1071-1087](admin.html)
- Steg 4 "Team" med `+ Lägg till teammedlem`: [admin.html:1101-1107](admin.html), onclick `cwAddMember()` [admin.html:5236](admin.html)

**Backend flow:**
- VD cleaner-rad (is_company_owner=true, company_id=X): [index.ts:87-113](supabase/functions/admin-create-company/index.ts)
- Team-medlemmar (is_company_owner=false, company_id=X): [index.ts:184-211](supabase/functions/admin-create-company/index.ts)
- Rollback vid fel: tar bort auth + companies om cleaner misslyckas [index.ts:117-118](supabase/functions/admin-create-company/index.ts)

**Förväntat resultat:** 1 VD + N teammedlemmar i `cleaners`. Auth-konton skapas för alla med e-post [index.ts:67-75, 157-168](supabase/functions/admin-create-company/index.ts). Default availability mån-fre 08-17 skapas [index.ts:141-149, 234-242](supabase/functions/admin-create-company/index.ts).

---

### A3. Sätta company_service_prices / cleaner_service_prices — ✅ FINNS

**UI:** Wizard Steg 3 "Tjänster & priser"
- Markup: [admin.html:1089-1099](admin.html)
- Tjänster renderas av `cwRenderServices()` [admin.html:5094](admin.html)
- Provision-input: [admin.html:1094-1097](admin.html) (default 12%)
- Per-medlem pris-overrides i steg 4 via `cwRenderMemberBody()` [admin.html:5336](admin.html)

**Backend upsert:**
- **company_service_prices** (företagets standardpris per tjänst): [index.ts:127-138](supabase/functions/admin-create-company/index.ts)
- **cleaner_service_prices** (per-person overrides, bara om `overridden`=true): [index.ts:220-231](supabase/functions/admin-create-company/index.ts)

**Förväntat resultat:** Prissättning centraliserad per företag, overrideable per cleaner. Upsert med `onConflict` så man kan köra wizarden igen utan duplicate.

---

### A4. Bjud in teammedlem (SMS-länk) — ❌ **SAKNAS**

**Grep-resultat:** Inget matchande i admin.html för `invite`, `SMS`, `magic.*link`, `send.*sms`, `team.*invite`.
- [admin.html grep för invite/SMS](admin.html): 0 träffar på relevanta mönster.

**Vad finns istället:**
- Wizard skapar auth-konton (`sb.auth.admin.createUser` + `email_confirm: true`) men skickar **ingen magic-link eller SMS**. [index.ts:157-168](supabase/functions/admin-create-company/index.ts)
- Bara VD får ett välkomstmejl via Resend [index.ts:250-264](supabase/functions/admin-create-company/index.ts). Teammedlemmar får **intet meddelande alls**.
- EF `team-sms-notify` finns ([supabase/functions/team-sms-notify/](supabase/functions/team-sms-notify)) men används INTE för invites — bara för notiser om nya team-jobb.

**Vad behövs för demo-redo:**
1. **Minimi-variant (30 min):** Lägg till i `admin-create-company` EF ett `sb.auth.admin.generateLink({ type: 'magiclink', email })` + skicka via Resend till varje team-medlem. Ingen admin-UI-ändring krävs.
2. **Alt:** Skicka vanligt välkomstmejl till team-medlemmar (som VD) med instruktion att logga in via engångskod på `/stadare-dashboard.html` — ingen magic-link alls, bara OTP som redan fungerar.
3. **SMS-invite:** Kräver ny EF + nytt admin-UI. Rekommendation: **skip för demo**, gör via e-post.

---

### A5. Stripe Connect onboarding-länk — ❌ **SAKNAS I ADMIN**

**Grep-resultat i admin.html:** Bara status-visning, ingen trigger.
- [admin.html:3538](admin.html) — visar `✅ Anslutet / ⏳ Påbörjad / ❌ Ej anslutet` baserat på `c.stripe_account_id` och `c.stripe_onboarding_status`
- [admin.html:3628](admin.html) — samma fält på cleaner-kort
- [admin.html:4492](admin.html) — aktivitetslogg-ikon för `stripe_connect_start`
- [admin.html:1993](admin.html) — knappen "Skicka Stripe-länk" i pipeline gör bara `showPage('onboarding')` — **navigerar, skickar INGET**

**EF finns men används ej från admin:**
- [supabase/functions/stripe-connect/index.ts](supabase/functions/stripe-connect/index.ts) 236 rader. `action: "onboard_cleaner"` skapar Express-konto [index.ts:51-80](supabase/functions/stripe-connect/index.ts).
- Anropas ENDAST från [stadare-dashboard.html:5747, 5776](stadare-dashboard.html) — cleanern triggar själv.

**Vad behövs för demo-redo:**
1. **För ägare (VD):** Rafael loggar in som VD på stadare-dashboard.html och klickar "Anslut Stripe" där. Funkar idag — ingen kod krävs.
2. **För team-medlemmar:** Om `employment_model='employed'` → utbetalning till företaget, team-medlemmar behöver INTE eget Stripe-konto (se [admin.html:1901](admin.html): `isTeamMember → stripeNeeded=false`). Solid Service är anställda-modellen → **ingen blocker**.
3. **Om Rafael kör contractors:** Varje underleverantör måste onboarda själv på sin dashboard. Work-around: visa demo med anställda-modellen.

**Slutsats:** Inte blocker om Solid Service går på `employment_model='employed'` (som är default i wizard [admin.html:1062](admin.html)).

---

### A6. Underleverantörsavtal-accept — ❌ **SAKNAS**

**Vad finns:**
- Dropdown `cw-employment` på wizard steg 1 [admin.html:1061-1066](admin.html): `employed` vs `contractor`.
- F-skatt-flagga `has_fskatt` kan toggleas i cleaner-redigering [admin.html:3508-3510, 3935-3937](admin.html).
- I EF: anställda → `has_fskatt: true` (via företaget) [index.ts:109, 207](supabase/functions/admin-create-company/index.ts).

**Vad finns INTE:**
- Ingen digital avtalsmall
- Ingen "accept"-knapp för villkor
- Ingen `contractor_agreement`-tabell (grep: 0 träffar)
- Ingen signeringsfunktionalitet (BankID för avtal saknas)

**Vad behövs för demo-redo:**
1. **Pappersvariant (0 min):** Skriv ut standardavtalsmall, låt Rafael signera fysiskt på mötet. Ingen kod krävs.
2. **PDF-variant (2h):** Generera PDF via [generate-receipt](supabase/functions/generate-receipt) mönstret, skicka via e-post, Rafael returnerar signerad.
3. **BankID-signering (1-2 dagar):** Integrera med befintlig [bankid EF](supabase/functions/bankid) för digital signering. Inte demo-redo.

**Rekommendation:** Skip digital accept — Farhad och Rafael signerar papper på mötet.

---

## 3. KATEGORI B — Bra att ha (finns, demo-användbart)

### B1. Visa bokningar per företag — ✅ FINNS
- Bokningssida: [admin.html:487-517](admin.html) med filter + sortering
- Företagsbokningar hämtas via `AR.select('bookings', ...)` [admin.html:2019-2020](admin.html)
- Filtrering per företag: manuellt via kolumn "Cleaner" — ingen dedikerad company-filter-chip

### B2. Finansiell översikt — ✅ FINNS
- Utbetalningar: `showPage('payouts')` [admin.html:319](admin.html)
- Självfakturor: `showPage('self-invoices')` [admin.html:320](admin.html), generera-knapp `adminGenerateInvoices()` [admin.html:692](admin.html)
- Dashboard-KPIs: [admin.html:1020-1021](admin.html) (total customers, DB-size)

### B3. Betyg/statistik — ✅ FINNS
- Recensioner: `showPage('reviews')` [admin.html:316](admin.html)
- Avg rating per cleaner: `c.avg_rating` används i sortering [admin.html:2021](admin.html) + cleaner-kort [admin.html:4690](admin.html)
- Flaggade cleaners (lågt betyg): [admin.html:4684-4711](admin.html)

---

## 4. KATEGORI C — Finns men används inte på mötet

- **Pending-bokningar:** [admin.html:305](admin.html)
- **Prenumerationer:** [admin.html:306, 720](admin.html)
- **Kunder:** [admin.html:315](admin.html)
- **Ansökningar (cleaner_applications):** [admin.html:310, 636](admin.html)
- **Onboarding pipeline:** [admin.html:311, 1620](admin.html) — för individuella cleaner-ansökningar, inte företag
- **Support/Ersättarärenden:** [admin.html:324-325](admin.html)
- **Kvalitet & Risk:** [admin.html:326](admin.html)
- **Team & Roller (admin-användare):** [admin.html:329, 929](admin.html)
- **Plattformsinställningar:** [admin.html:330](admin.html)
- **Aktivitet/Ändringslogg/Systemstatus:** [admin.html:331-333](admin.html)
- **Inbox (e-post):** [admin.html:335, 784](admin.html)
- **Bulk-actions på cleaners (godkänn/pausa/stäng av):** [admin.html:608-611](admin.html)
- **Auto-assign-alla:** [admin.html:488](admin.html) `autoAssignAll()`
- **Export CSV:** [admin.html:489, 497, 693, 1003](admin.html)
- **Bokningsmodal (reassign/cancel/refund):** [admin.html:1177-1189](admin.html)

---

## 5. Demo-checklista inför 2026-04-19

### Gör innan mötet (idag kväll)
- [ ] Verifiera att EF `admin-create-company` är deployad. Kommando: `supabase functions list`.
- [ ] Testkör wizarden i prod med riktiga Solid Service-data (eller testdata med "Solid Service Test AB").
- [ ] Rensa test-raden efter: `DELETE FROM companies WHERE name LIKE 'Solid%Test%'` + cascade cleaners + auth.users.
- [ ] Skriv ut pappersavtal (underleverantörsavtal) för signering på mötet.
- [ ] Bestäm: anställda eller underleverantörer? **Rekommendation: anställda** (slipper per-person Stripe Connect).

### På mötet
1. Logga in på admin.html
2. Navigera till **🏢 Nytt företag**
3. Kör wizarden live med Rafa:
   - Steg 1: Solid Service Sverige AB, org-nr 559537-7523, Stockholm, **employment=employed**
   - Steg 2: Rafaels info som VD (owner_only=true om han inte städar själv)
   - Steg 3: Markera tjänster + priser
   - Steg 4: Lägg till team-medlemmar (namn + e-post + telefon + adress)
   - Steg 5: Granska + "Skapa allt ✨"
4. Visa Rafael hans företagsprofil: `https://spick.se/f/solid-service-sverige`
5. VD loggar in på [stadare-dashboard.html](stadare-dashboard.html) med engångskod → startar Stripe Connect där
6. Signera pappersavtal

### Kritiska varningar
- **Team-medlemmar får INGEN välkomstmejl** från wizard. Farhad måste informera Rafael: "Dina teammedlemmar får logga in via engångskod på deras mejl — jag skickar info separat."
- **Stripe Connect startar INTE från admin** — Rafael måste göra det själv från cleaners-dashboard. Säg det tydligt.
- **Rollback vid fel:** Om wizarden crashar efter companies-INSERT rullar EF tillbaka [index.ts:72-74, 116-118](supabase/functions/admin-create-company/index.ts). Men om team-loop crashar fortsätter den till nästa medlem — dvs partiella resultat är möjliga. Kolla loggen efter körning.

---

## 6. Blockerare som bör fixas EFTER mötet

1. **Skicka magic-link till team-medlemmar** från wizard (30 min fix i `admin-create-company` EF).
2. **Admin-triggered Stripe Connect-länk** — knapp på cleaner-kortet som genererar + mejlar Stripe-onboarding-URL (1-2h).
3. **PDF-avtal med digital signering** via BankID (1-2 dagar).
4. **Bulk-importera team-medlemmar via CSV** — nu max ~10-15 via wizard-UI manuellt.
