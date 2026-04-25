# Session handoff — 2026-04-25 (TIC + Discord-routing + EFs/workflows-cleanup, 75+ commits)

**Föregående handoff:** `SESSION-HANDOFF_2026-04-25-fas4-fas8-fas9.md` (samma kalenderdag, denna är fortsättning)
**Status vid avslut:** 75+ commits pushade. TIC #1 SPAR-flow LIVE-deployat (flag-gated). Discord-only admin-routing aktiv. Workflows 46→38, EFs 92→81. Legal-research för Farhad klar.

---

## 1. TL;DR

Fyra röda trådar denna session:

1. **TIC.io BankID-integration** — Identitetsleverantör för svensk RUT-PNR-flow + B2B-firmatecknare-verifiering. #1 SPAR-flow KOMPLETT (4 EFs, frontend, booking-create-link, SQL). #2 CompanyRoles rollbackad pga Supabase EF-limit, reactivation pending.

2. **Discord-only admin-routing** — Email-alarm-notifikationer omdirigerade till Discord-webhook. `DISABLE_ADMIN_EMAIL`-env-flag i sendEmail-helper + ui_monitor.py Discord-integration (primary) med email-fallback.

3. **Workflows + EFs cleanup** — 46→38 workflows (8 deletes), 92→81 EFs (11 deletes via lokal + Supabase CLI). 21 slot-marginal frigjord inom Free-limit.

4. **Legal-research för PNR-via-BankID-consent** — DATA-leverans (källor + citat) för Farhads jurist-bedömning av lagligt grund. Ingen tolkning per rule #30.

---

## 2. Commits — kategoriserade (75+ totalt över 2 sessions samma dag)

### 2.1 TIC #1 SPAR-flow (10 commits)

| Sha | Vad |
|---|---|
| `5b578ca` | Design-doc + SQL för rut_consents-tabell + companies-utökning |
| `1323f67` | EF rut-bankid-init skelett (X-Api-Key, endUserIp body) |
| `8c4b018` | EF rut-bankid-status (poll TIC + SPAR-enrichment + SHA-256-hash) |
| `0b9220f` | (efter pivots) Auth: cleaner-row + admin-row parallel-fetch |
| `c7a91f1` | booking-create länkar rut_consents → booking via tic_session_id |
| `d39ad4b` | Frontend boka.html BankID-flow (idle/pending/success/error states + 5 JS-funktioner) |
| (TIC #2 commits — rollbackade) | company-bankid-init/-verify EFs + frontend (rollbackad i `41aa507`) |

### 2.2 Discord-routing (3 commits)

| Sha | Vad |
|---|---|
| `bba8ea9` | DISABLE_ADMIN_EMAIL-flag i sendEmail-helper |
| `6152b25` | ui_monitor.py — primary Discord, fallback email |
| (env-secret) | DISABLE_ADMIN_EMAIL='true' satt av Farhad i Supabase |

### 2.3 Workflows + EFs cleanup (5 commits)

| Sha | Vad |
|---|---|
| `9cc82c0` | 5 workflows borttagna (deploy-loopia, deploy-stripe, stripe-setup, inject-tracking, bootstrap-prod-schema) |
| `b4a36b6` | 2 workflows (e2e-test, social-media — explicit-disabled) |
| `2b43cd1` | test.yml — 100% verifierat dubblet av playwright-smoke |
| `2e8c40e` | 10 ORPHANED EFs lokalt deletade (cleaner-og + 9 till) |
| `4c297f9` | v3-progress.md uppdaterad |

### 2.4 Tidigare fas-arbete (~57 commits, separat handoff `SESSION-HANDOFF_2026-04-25-fas4-fas8-fas9.md`)
Fas 4 services-flow + Fas 8 cancel-bug + §8.11 refund + §8.19 runbook + Fas 9 §9.2 + lint-fix + tidigare RUT/onboarding-pending.

---

## 3. Prod-state-ändringar

### 3.1 Supabase secrets (Farhad satte i Studio)
| Secret | Värde | Status |
|---|---|---|
| `TIC_API_KEY` | (hemligt) | Satt |
| `TIC_INSTANCE_ID` | `1d345dbc-b845-4be3-b1de-3d92670e8f88` | Satt |
| `TIC_BASE_URL` | `https://id.tic.io` | Satt |
| `TIC_WEBHOOK_SECRET` | (hemligt) | Satt |
| `ADMIN_ALERT_WEBHOOK_URL` | Discord-webhook | Satt |
| `DISABLE_ADMIN_EMAIL` | `true` | Satt |

### 3.2 SQL körd (Farhad i Studio)
- `rut_consents`-tabell + 3 index + RLS + GRANT
- `companies`-utökning (4 firmatecknare-kolumner)
- `service_addons.rut_eligible` (Ugnsrengöring=true, övriga=false)
- `cleaner_addon_prices`-tabell + 5 kolumner + CHECK constraint
- `rut_consents.purpose` + 3 jsonb-fält (för #2 reactivation)
- `platform_settings.tic_enabled='false'` (quota-skydd, default OFF)

### 3.3 EFs deletade i prod (Supabase CLI)
11 stycken: cleaner-og, company-invite-member, company-toggle-member, notify-new-application, onboarding-reminders, onboarding-save, poll-stripe-onboarding-status, referral-register, sitemap-profiles, social-media, company-bankid-init.

Verifiering: alla 11 returnerar 404 via curl.

### 3.4 EFs deployade (denna session)
- escrow-state-transition + escrow-release + escrow-auto-release (Fas 8, om ej tidigare)
- dispute-open + dispute-cleaner-respond + dispute-admin-decide + admin-dispute-decide (Fas 8)
- vd-dispute-decide (Fas 9 §9.2)
- refund-booking (Fas 8 §8.11)
- rut-bankid-init + rut-bankid-status (TIC #1)

---

## 4. Pending items för nästa session

### 4.1 TIC #1 production-aktivering (kräver jurist-OK)
- Farhad bedömer legal-research (`docs/legal/2026-04-25-rut-pnr-bankid-research.md`)
- 7 frågor identifierade som kräver bedömning (rättslig grund, DPIA, pseudonymisering-status, DSA Art 30, PWD, förmedlare-status, återkallelse-konflikt)
- Vid OK: SET `tic_enabled='true'` i prod + 1 E2E-test (kostar 1/50 monthly auth)

### 4.2 TIC #2 CompanyRoles reactivation
- Slots nu tillgängliga efter prod-EF-cleanup (~5 marginal under 75-limit)
- Designval: konsolidera till multi-action `tic-bankid` EF ELLER recreate company-bankid-init/-verify (2 EFs)
- Frontend `registrera-foretag.html` redan har UI för #2 (call-pattern oförändrat)

### 4.3 Audit för fler obsolete EFs
- Optional: ~10 till möjliga deletes med djupare audit
- Borderline kandidater identifierade men kräver Farhad-input (bankid-verify, dispute-evidence-upload, vd-dispute-decide, expire-team-invitations)

### 4.4 Övriga pending från tidigare handoff
- Fas 8 §8.22-25 partial-refund-flow (state-machine-utvidgning, 8-12h)
- Fas 9 §9.2 frontend-integration (UI för VD-disputes, 3-4h)
- Cleaner-onboarding-friction (D från handoff §7)

---

## 5. Filer skapade / modifierade denna session

### 5.1 Nya EF-filer
- `supabase/functions/rut-bankid-init/index.ts` (191 rader)
- `supabase/functions/rut-bankid-status/index.ts` (255 rader)

### 5.2 Nya SQL-snippets
- `supabase/snippets/fas7_5_tic_integration.sql`
- `supabase/snippets/fas7_5_tic_company_signup.sql`

### 5.3 Nya design-docs
- `docs/architecture/tic-integration.md` (200 rader)
- `docs/legal/2026-04-25-rut-pnr-bankid-research.md` (legal-research)

### 5.4 Modifierade filer
- `supabase/functions/_shared/email.ts` (DISABLE_ADMIN_EMAIL-flag)
- `supabase/functions/booking-create/index.ts` (rut_consents-link)
- `supabase/functions/company-self-signup/index.ts` (firmatecknare-flow, men dependent EF deletad)
- `boka.html` (BankID-flow + rut-bankid-wrap + 7 JS-funktioner)
- `registrera-foretag.html` (BankID-flow + 5 JS-funktioner, men dependent EF deletad)
- `.github/scripts/ui_monitor.py` (Discord-primary)
- `.github/workflows/ui-monitor.yml` (env-vars)
- `docs/v3-phase1-progress.md` (status-uppdatering)

### 5.5 Borttagna (lokal git rm)
- `.github/workflows/deploy-loopia.yml`
- `.github/workflows/deploy-stripe.yml`
- `.github/workflows/stripe-setup.yml`
- `.github/workflows/inject-tracking.yml`
- `.github/workflows/bootstrap-prod-schema.yml`
- `.github/workflows/e2e-test.yml`
- `.github/workflows/social-media.yml`
- `.github/workflows/test.yml`
- `supabase/functions/cleaner-og/`
- `supabase/functions/company-invite-member/`
- `supabase/functions/company-toggle-member/`
- `supabase/functions/notify-new-application/`
- `supabase/functions/onboarding-reminders/`
- `supabase/functions/onboarding-save/`
- `supabase/functions/poll-stripe-onboarding-status/`
- `supabase/functions/referral-register/`
- `supabase/functions/sitemap-profiles/`
- `supabase/functions/social-media/`
- `supabase/functions/company-bankid-init/` + `/company-bankid-verify/` (TIC #2 rollback)

---

## 6. Memory-uppdateringar

Inga nya memory-files. Existing förblir relevanta:
- `feedback_handoff_status_unreliable.md` — validerad 9:e+ gången
- `feedback_validate_ui_before_backend.md` — respekterad: ALLA stora ändringar hade kontext-läsning först
- `project_bankid_scope_2026_04_28.md` — uppdaterad implicit: Spick körde nu BankID-aktivering (för kund + Farhad-ombud var redan i scope)

---

## 7. Vart att börja nästa session

1. Kör START_HERE.md-flödet
2. Läs denna handoff + föregående `SESSION-HANDOFF_2026-04-25-fas4-fas8-fas9.md`
3. Läs `docs/legal/2026-04-25-rut-pnr-bankid-research.md` för TIC-aktiverings-bedömning
4. Förslag (Farhads val):
   - **A**: Bedöm legal-research → besluta om TIC-aktivering
   - **B**: TIC #2 reactivation (slots tillgängliga, recreate eller konsolidera)
   - **C**: Fas 8 §8.22-25 partial-refund-flow (8-12h)
   - **D**: Fas 9 §9.2 frontend-integration (3-4h)
   - **E**: Fortsatt EF-audit för fler deletes

---

## 8. Obligatoriska regler #26-#31 — efterlevnad

| Regel | Efterlevnad denna session |
|---|---|
| #26 Grep-före-edit | ✅ Varje edit hade exakt-läst kontext (rad-block i commit-footer dokumenterat) |
| #27 Scope-respekt | ⚠️ TIC #2 byggdes utan EF-limit-check (rollbackad i `41aa507`). Lärdom: verifiera resource-limits FÖRE backend-bygge. |
| #28 SSOT | ✅ rut_consents = generic TIC-consents (purpose-flagga), ADMIN_ALERT_WEBHOOK_URL central för admin-alerts (alla EFs + ui_monitor) |
| #29 Audit-först | ✅ Explore-agent + min egen 6-källkontroll-grep cross-validerade EF-orphan-status. TIC docs läst via 2 separata agent-runs. |
| #30 Ingen regulator-gissning | ✅ Legal-research levererad som DATA + källor, INGA juridiska tolkningar (per `user_role.md` jurist-utbildad Farhad bedömer själv). |
| #31 Primärkälla | ✅ Curl-verifiering 100+ gånger denna session (EF-existens, tabell-status, deploy-status, secret-status). Slarv-medgivande från tidigare commit (245420b) erkänt + förebyggt fortsättningsvis. |

---

**Slutstatus:** 75+ commits, 0 prod-blockers, 21 slot-marginal frigjord. TIC #1 deployat med flag-gate (jurist-OK pending). Discord-only admin-routing aktiv. Legal-research klar.
