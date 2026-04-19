# Sprint B — Självgående onboarding: Slutrapport

**Status:** ✅ Komplett (19 april 2026)  
**Commits:** c23dde1 → [Dag 6 final]  
**Total estimat:** 24-30 timmar  
**Faktisk tid:** 1 dag

---

## Mål

Möjliggöra att städföretag registrerar sig på Spick själva utan manuell admin-interaktion, plus komplett team-management för VDs.

---

## Leverabler

### Dag 1: Stripe Connect webhook + refresh_account_link
- ✅ Ny EF `stripe-connect-webhook` lyssnar på `account.updated` + `account.application.deauthorized`
- ✅ Shared helper `_shared/stripe-webhook-verify.ts` (HMAC-SHA256, timing-safe)
- ✅ Ny action `refresh_account_link` i stripe-connect (ersätter duplicerade accounts)
- ✅ companies.stripe_account_id synkas när VD:s Stripe blir complete

### Dag 2: DB-migration + commission-centralisering
- ✅ 4 nya kolumner till companies: `self_signup`, `onboarding_status`, `logo_url`, `onboarding_completed_at`, `updated_at`
- ✅ 4 nya kolumner till cleaner_applications: `invited_via_magic_code`, `invited_phone`, `bankid_verified_at`, `bankid_personnummer_hash`
- ✅ Ny RPC `get_company_onboarding_status(uuid)` för dashboard-aggregering
- ✅ commission hardcoding (17, 12) borttagen överallt → läses nu från `platform_settings.commission_standard` (Regel #28)

### Dag 3: Self-service företagsregistrering
- ✅ `bli-foretag.html` — marketing-landing (hero, 6 fördelar, 4 steg, 8 FAQ)
- ✅ `registrera-foretag.html` — 4-stegs formulär
- ✅ `company-self-signup` EF (publik, service-role-baserad)
- ✅ Slug-conflict retry-loop (upp till 10 försök med -2, -3, ... suffix)
- ✅ Cirkulär FK-hantering i rollback-logik
- ✅ Feature flag `REQUIRE_BANKID_SIGNUP` (default false, redo för TIC produktion)
- ✅ "Bli partner"-länk i desktop + mobile nav

### Dag 4: Team-invitations
- ✅ `company-invite-member` EF (VD skickar SMS-invite)
- ✅ `company-accept-invite` EF (teammedlem accepterar + skapar cleaner)
- ✅ `join-team.html` — landing efter magic-link
- ✅ `foretag-dashboard.html` — NY sida med VD-checklist + team-UI
- ✅ "Företagsdashboard"-länk i mobile nav

### Dag 5: Admin pending-queue
- ✅ `admin-approve-company` EF (approval + email + SMS)
- ✅ `admin-reject-company` EF (rejection med reason)
- ✅ Ny sektion "Företagsansökningar" i admin.html
- ✅ Real-time subscription på companies-INSERT/UPDATE
- ✅ Stripe-länk-generering från admin-UI

### Dag 6: Cron + docs
- ✅ `poll-stripe-onboarding-status` EF (var 30 min — safety-net)
- ✅ `expire-team-invitations` EF (dagligen 00:00)
- ✅ Partial index `idx_cleaner_applications_invited_created`
- ✅ Rollback-plan
- ✅ E2E test-checklist
- ✅ Sprint B summary (detta dokument)

---

## Arkitekturella beslut

### Rollbaserad auth
- **VD-auth:** Bearer-token (Supabase session) validerad mot `cleaners.is_company_owner = true`
- **Admin-auth:** Bearer-token validerad mot `admin_users`-tabellen
- **Cron-auth:** `CRON_SECRET` eller `SUPABASE_SERVICE_ROLE_KEY`

### Data-flöde: Self-signup → Approve → Active
```
[Publik formulär] → company-self-signup EF
    ↓
companies.onboarding_status = 'pending_stripe'
cleaners (VD).is_approved = false
    ↓
[VD slutför Stripe] → stripe-connect-webhook → handleAccountUpdated
    ↓
companies.stripe_account_id = acct_...
companies.onboarding_status = 'pending_team' (implicit: 'ready for admin review')
    ↓
[Admin granskar i admin.html] → admin-approve-company EF
    ↓
companies.onboarding_status = 'active'
cleaners (VD).is_approved = true, status = 'aktiv'
    ↓
[Företaget synligt publikt, kan ta bokningar]
```

### Team-invite-flöde
```
[VD: foretag-dashboard.html] → company-invite-member EF
    ↓
cleaner_applications (status='invited') + magic-link genereras
SMS skickas till member_phone
    ↓
[Member klickar SMS-länk] → magic-link etablerar session → join-team.html
    ↓
[Member fyller formulär] → company-accept-invite EF
    ↓
cleaners-rad (is_approved=true, company_id=VD:s company)
stripe-connect onboard_cleaner triggas → Stripe URL returneras
    ↓
[Member slutför Stripe] → stripe-connect-webhook
    ↓
Team-lista i VD-dashboard uppdaterad automatiskt
```

---

## Ändrade filer — referens

### Nya EFs (7)
- `supabase/functions/stripe-connect-webhook/`
- `supabase/functions/company-self-signup/`
- `supabase/functions/company-invite-member/`
- `supabase/functions/company-accept-invite/`
- `supabase/functions/admin-approve-company/`
- `supabase/functions/admin-reject-company/`
- `supabase/functions/poll-stripe-onboarding-status/`
- `supabase/functions/expire-team-invitations/`

### Ändrade EFs (3)
- `supabase/functions/stripe-connect/` (refresh_account_link action + companies-sync)
- `supabase/functions/admin-create-company/` (commission från platform_settings)
- `supabase/functions/admin-approve-cleaner/` (commission från platform_settings)

### Nya HTML-sidor (4)
- `bli-foretag.html`
- `registrera-foretag.html`
- `foretag-dashboard.html`
- `join-team.html`

### Ändrade HTML/JS (2)
- `admin.html` (ny sektion Företagsansökningar, 200+ rader JS)
- `js/components.js` (2 nav-länkar tillagda)

### Shared code (1)
- `supabase/functions/_shared/stripe-webhook-verify.ts`

### DB-migrations (2)
- `migration-sprint-b-dag-2-v2.sql` (kolumner + RPC)
- `migration-sprint-b-dag-6-cron.sql` (cron-scheduling + index)

---

## Kända begränsningar + framtida arbete

### Inte inkluderat i Sprint B (planerat för senare)
- **BankID-verifiering av VDs** — feature flag finns men är inaktiv till TIC produktion godkänt
- **Bolagsverket API-lookup** — idag validerar vi bara org.nr-format, inte att företaget existerar
- **Escrow + dispute-flöde** → Sprint A
- **Recurring bookings matrix** → Sprint D
- **Automatisk admin-granskning** (KYC-check via Stripe) → framtida sprint

### Säkerhetsskuld flaggad
- `stripe-webhook` (gamla, icke-Connect) använder fortfarande `verifyEventWithStripe` API-callback istället för HMAC → **replay-sårbar**. Byt till HMAC nästa sprint.
- `cleaner_applications` consent-kolumner bör vara på cleaners-tabellen också för aktiv GDPR-state — nu finns det bara i applications

### UX-förbättringar som kan göras
- VD-dashboard visar inte bokningar — "Dashboard"-knappen leder till stadare-dashboard.html. Separat VD-bokningsvy kan byggas.
- Admin pending-companies saknar detaljvy (bara kort). Om granskning kräver mer info (logo, bransch-kategori) → expand-on-click.
- Team-invite-formuläret i foretag-dashboard.html tar bara namn+telefon. Kunde acceptera email också.

---

## Nästa steg

### Pilot-kunder att onboarda med Sprint B
- **Rafael Arellano (Rafa Allservice AB):** Redan onboardad via admin-create-company pre-Sprint-B. Slutför Stripe + admin godkänn via nya queue.
- **Zivar/Fazli (Solid Service Sverige AB):** Samma — redan i DB, Stripe pending. Skicka URL imorgon.

### Admin-tester
- [ ] Testa pending-queue real med existerande pending företag
- [ ] Verifiera att approvals skickar email till VD:er

### Följ-upp inom 1 vecka
- Kolla `SELECT * FROM cron.job_run_details WHERE jobname LIKE 'poll-stripe%' OR jobname LIKE 'expire-team%' LIMIT 20` — verifiera att cron-jobb faktiskt körs
- Verifiera Supabase EF logs för errors
