# Codebase Snapshot (auto-generated 2026-04-27)

Genererad av `scripts/generate-claude-md.ts`. Kopiera valda sektioner
till CLAUDE.md för att fixa Regel #29-drift.

---

## Edge Functions (112 st)

| Funktion | Första kommentar |
|----------|------------------|
| `admin-approve-cleaner` |  |
| `admin-approve-company` | ═══════════════════════════════════════════════════════════════ SPICK – admin-approve-company (Sprint B Dag 5) |
| `admin-cancel-booking` | ═══════════════════════════════════════════════════════════════ SPICK – admin-cancel-booking (Audit-fix P2-1, 2026-04-26 |
| `admin-create-company` |  |
| `admin-dispute-decide` | ═══════════════════════════════════════════════════════════════ SPICK – admin-dispute-decide (Fas 8 §8.14 wrapper) |
| `admin-mark-payouts-paid` | Fas 1.10.2: Admin-trigger av payout-flode (ersatter direkt DB-PATCH) Primarkalla: docs/planning/spick-arkitekturplan-v3. |
| `admin-morning-report` |  |
| `admin-pnr-update` | ═══════════════════════════════════════════════════════════════ SPICK – admin-pnr-update (Audit-fix P2-2, 2026-04-26) |
| `admin-reject-company` | ═══════════════════════════════════════════════════════════════ SPICK – admin-reject-company (Sprint B Dag 5) |
| `analyze-booking-pattern` | analyze-booking-pattern — Fas 5 §5.8 ═══════════════════════════════════════════════════════════════ |
| `auto-approve-check` |  |
| `auto-delegate` |  |
| `auto-rebook` | auto-rebook — Skapar bokningar för aktiva prenumerationer ═══════════════════════════════════════════════════════════ |
| `auto-remind` |  |
| `bankid` |  |
| `bankid-verify` |  |
| `bankid-webhook` |  |
| `blog-auto-publish-cron` | ═══════════════════════════════════════════════════════════════ SPICK – blog-auto-publish-cron (Sprint 6, 2026-04-26) |
| `blog-generate` | ═══════════════════════════════════════════════════════════════ SPICK – blog-generate (Sprint 6 Content-Engine, 2026-04- |
| `booking-auto-timeout` |  |
| `booking-cancel-v2` |  |
| `booking-create` | supabase/functions/booking-create/index.ts SPICK: Booking Create — med inbyggd prismotor + marginalcheck |
| `booking-reassign` |  |
| `calendar-google-auth` | calendar-google-auth — Starta Google OAuth-flöde URL: /functions/v1/calendar-google-auth?cleaner_id=XXX |
| `calendar-google-callback` | calendar-google-callback — Google OAuth callback Tar emot auth code, utbyter mot tokens, sparar i calendar_connections |
| `calendar-ical-feed` | supabase/functions/calendar-ical-feed/index.ts Genererar iCal (.ics) feed för en städare. |
| `calendar-sync` | calendar-sync — Synkronisera Google Calendar ↔ Spick Triggas av: |
| `charge-subscription-booking` | charge-subscription-booking — Debiterar sparade kort dagen innan städning ══════════════════════════════════════════════ |
| `check-terms-acceptance` | ═══════════════════════════════════════════════════════════════ SPICK – check-terms-acceptance (Item 1 Etapp 3) |
| `checklist-mark` | ═══════════════════════════════════════════════════════════════ SPICK – checklist-mark (Phase 1.2) |
| `claude` |  |
| `cleaner-addon-price-set` | ═══════════════════════════════════════════════════════════════ SPICK – cleaner-addon-price-set (Fas 4 §4.8c) |
| `cleaner-application-submit` | ═══════════════════════════════════════════════════════════════ SPICK – cleaner-application-submit (Audit-fix P2-3, 2026 |
| `cleaner-booking-response` |  |
| `cleaner-job-completed` | ═══════════════════════════════════════════════════════════════ SPICK – cleaner-job-completed (Fas 8 §8.2 wiring) |
| `cleaner-onboarding-emails` |  |
| `cleaner-optout` |  |
| `cleanup-stale` |  |
| `clock-event` | ═══════════════════════════════════════════════════════════════ SPICK – clock-event (Phase 1.1) |
| `company-accept-invite` | ═══════════════════════════════════════════════════════════════ SPICK – company-accept-invite (Sprint B Dag 4) |
| `company-propose-substitute` |  |
| `company-self-signup` | ═══════════════════════════════════════════════════════════════ SPICK – company-self-signup (Sprint B Dag 3) |
| `company-url-monitor` |  |
| `content-claims-monitor` |  |
| `customer-approve-proposal` |  |
| `customer-check-auto-delegation` | ═══════════════════════════════════════════════════════════════ SPICK – customer-check-auto-delegation (Fas 1.2) |
| `customer-nudge-recurring` | customer-nudge-recurring — Fas 5 §5.9 ═══════════════════════════════════════════════════════════════ |
| `customer-subscription-manage` | customer-subscription-manage — Fas 5 §5.4 ═══════════════════════════════════════════════════════════ |
| `customer-upsert` | ═══════════════════════════════════════════════════════════════ SPICK – customer-upsert (Fas 1.2) |
| `dispute-admin-decide` | ═══════════════════════════════════════════════════════════════ SPICK – dispute-admin-decide (Fas 8 §8.14) |
| `dispute-cleaner-respond` | ═══════════════════════════════════════════════════════════════ SPICK – dispute-cleaner-respond (Fas 8 §8.9) |
| `dispute-evidence-upload` | ═══════════════════════════════════════════════════════════════ SPICK – dispute-evidence-upload (Fas 8 §8.13) |
| `dispute-open` | ═══════════════════════════════════════════════════════════════ SPICK – dispute-open (Fas 8 §8.8) |
| `dispute-sla-check` | ═══════════════════════════════════════════════════════════════ SPICK – dispute-sla-check (Fas 8 §8.12.2) |
| `elks-balance-monitor` |  |
| `email-deliverability-test` | ═══════════════════════════════════════════════════════════════ SPICK – email-deliverability-test (manuellt-triggad / mo |
| `email-inbound` |  |
| `escrow-auto-release` | ═══════════════════════════════════════════════════════════════ SPICK – escrow-auto-release (Fas 8 §8.12) |
| `escrow-release` | ═══════════════════════════════════════════════════════════════ SPICK – escrow-release (Fas 8 §8.7) |
| `escrow-state-transition` | ═══════════════════════════════════════════════════════════════ SPICK – escrow-state-transition (Fas 8 §8.6) |
| `expire-team-invitations` | ═══════════════════════════════════════════════════════════════ SPICK – expire-team-invitations (Sprint B Dag 6) |
| `export-cleaner-data` | export-cleaner-data — Fas 8 §8.20 ═══════════════════════════════════════════════════════════════ |
| `export-customer-data` | export-customer-data — Fas 13 §13.4 gap A1 ═══════════════════════════════════════════════════════════════ |
| `fortnox-oauth-callback` |  |
| `fortnox-oauth-init` |  |
| `fortnox-push-invoice` |  |
| `generate-receipt` | ═══════════════════════════════════════════════════════════════ SPICK – Kundkvitto (Customer Receipt HTML + Email) |
| `generate-receipt-pdf` | ═══════════════════════════════════════════════════════════════ SPICK – generate-receipt-pdf (Fas F-PDF, 2026-04-28) |
| `generate-self-invoice` | ═══════════════════════════════════════════════════════════════ SPICK – Självfaktura-generator (Self-billing invoice) |
| `geo` | SPICK – Geo Matching |
| `get-booking-events` | ═══════════════════════════════════════════════════════════════ SPICK – get-booking-events (Fas 6 §6.4-§6.6) |
| `get-cleaner-contact` |  |
| `health` |  |
| `incident-create` | ═══════════════════════════════════════════════════════════════ SPICK – incident-create (Phase 1.3) |
| `matching-wrapper` | supabase/functions/matching-wrapper/index.ts §3.7-full Step 2b — Matching-wrapper EF (shadow-mode A/B-ramverk) |
| `n3-pnr-reminder-cron` | ═══════════════════════════════════════════════════════════════ SPICK – n3-pnr-reminder-cron (N3 Sprint 3, 2026-04-26) |
| `noshow-refund` |  |
| `notify` |  |
| `og-image` | ═══════════════════════════════════════════════════════════════ SPICK – og-image (Sprint B3, 2026-04-26) |
| `og-prerender` | ═══════════════════════════════════════════════════════════════ SPICK – og-prerender (Sprint B1, 2026-04-26) |
| `places-autocomplete` |  |
| `preference-learn-favorite` | preference-learn-favorite — Fas 5 §5.5b ═══════════════════════════════════════════════════════════════ |
| `proof-photo-upload` | ═══════════════════════════════════════════════════════════════ SPICK – proof-photo-upload (Tier A.2) |
| `public-auth-exchange` | ═══════════════════════════════════════════════════════════════ SPICK – public-auth-exchange (Fas 1.2) |
| `public-auth-link` | ═══════════════════════════════════════════════════════════════ SPICK – public-auth-link (Fas 1.2) |
| `push` | SPICK – Push Notifications med VAPID |
| `quality-check-ai` | ═══════════════════════════════════════════════════════════════ SPICK – quality-check-ai (Tier A.4) |
| `rating-reminder-cron` |  |
| `reconcile-payouts` | Fas 1.9: Edge Function for reconciliation cron Primarkalla: docs/architecture/fas-1-8-reconciliation-design.md |
| `refund-booking` | ═══════════════════════════════════════════════════════════════ SPICK – refund-booking (Fas 8 §8.11) |
| `register-bankid-init` | ═══════════════════════════════════════════════════════════════ SPICK – register-bankid-init (Item 1 Etapp 2) |
| `register-bankid-status` | ═══════════════════════════════════════════════════════════════ SPICK – register-bankid-status (Item 1 Etapp 2) |
| `rut-bankid-init` | ═══════════════════════════════════════════════════════════════ SPICK – rut-bankid-init (Fas 7.5 §RUT.1 — TIC.io BankID- |
| `rut-bankid-status` | ═══════════════════════════════════════════════════════════════ SPICK – rut-bankid-status (Fas 7.5 §RUT.2 — TIC poll + S |
| `rut-batch-export-xml` | rut-batch-export-xml — Fas 7.5 §7.5.x ═══════════════════════════════════════════════════════════════ |
| `save-booking-event` | ═══════════════════════════════════════════════════════════════ SPICK – save-booking-event (Fas 6.3 + §6.5 beslut 2026-0 |
| `seo-page-stad-tjanst` | ═══════════════════════════════════════════════════════════════ SPICK – seo-page-stad-tjanst (Sprint 4A, 2026-04-26) |
| `serve-invoice` |  |
| `services-list` | services-list: Public read of services + addons F1 Dag 1 - arkitekturplan v3 |
| `setup-subscription` | supabase/functions/setup-subscription/index.ts SPICK: Subscription Setup |
| `sms` |  |
| `sms-delivery-test` | ═══════════════════════════════════════════════════════════════ SPICK – sms-delivery-test (manuellt-triggad weekly healt |
| `stripe-connect` |  |
| `stripe-connect-webhook` | ═══════════════════════════════════════════════════════════════ SPICK – stripe-connect-webhook (Sprint B Dag 1) |
| `stripe-refund` |  |
| `stripe-webhook` |  |
| `synthetic-monitor` | ═══════════════════════════════════════════════════════════════ SPICK – synthetic-monitor (Fas 10 §10.x extension 2026-0 |
| `team-sms-notify` |  |
| `vd-dispute-decide` | ═══════════════════════════════════════════════════════════════ SPICK – vd-dispute-decide (Fas 9 §9.2 — VD dispute-tier- |
| `vd-dispute-list` | ═══════════════════════════════════════════════════════════════ SPICK – vd-dispute-list (Fas 9 §9.2 — VD dispute-tab lis |
| `vd-payment-summary` | ═══════════════════════════════════════════════════════════════ SPICK – vd-payment-summary (Fas 9-utökning, 2026-04-26) |
| `verify-fskatt` |  |

## Shared EF helpers (31 st)

| Fil | Första kommentar |
|-----|------------------|
| `_shared/alerts.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Admin-alert-helper (Fas 10 §10.1 + §10.2 partial |
| `_shared/auth.ts` | supabase/functions/_shared/auth.ts ───────────────────────────────────────────────────────────────── |
| `_shared/chargeback-buffer.ts` | supabase/functions/_shared/chargeback-buffer.ts ────────────────────────────────────────────────────────────────── |
| `_shared/cron-auth.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Cron-EF auth-helper (security-audit-fix 2026-04- |
| `_shared/document-store.ts` | supabase/functions/_shared/document-store.ts ────────────────────────────────────────────────────────────────── |
| `_shared/email.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Delad Edge Function-infrastruktur |
| `_shared/encryption.ts` | supabase/functions/_shared/encryption.ts ────────────────────────────────────────────────────────────────── |
| `_shared/escrow-state.ts` | supabase/functions/_shared/escrow-state.ts ────────────────────────────────────────────────────────────────── |
| `_shared/events.ts` | supabase/functions/_shared/events.ts ────────────────────────────────────────────────────────────────── |
| `_shared/expenses.ts` | supabase/functions/_shared/expenses.ts ────────────────────────────────────────────────────────────────── |
| `_shared/fonts.ts` |  |
| `_shared/holidays.ts` | _shared/holidays.ts — Fas 5 §5.11 ═══════════════════════════════════════════════════════════════ |
| `_shared/log.ts` | supabase/functions/_shared/log.ts ────────────────────────────────────────────────────────────────── |
| `_shared/matching-diff.ts` | supabase/functions/_shared/matching-diff.ts ────────────────────────────────────────────────────────────────── |
| `_shared/money.ts` |  |
| `_shared/notifications.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Multi-kanal notifikationer |
| `_shared/pnr-verification.ts` | supabase/functions/_shared/pnr-verification.ts ────────────────────────────────────────────────────────────────── |
| `_shared/preferences.ts` | supabase/functions/_shared/preferences.ts ────────────────────────────────────────────────────────────────── |
| `_shared/pricing-engine.ts` |  |
| `_shared/pricing-resolver.ts` | supabase/functions/_shared/pricing-resolver.ts ────────────────────────────────────────────────────────────────── |
| `_shared/retry-backoff.ts` | ═══════════════════════════════════════════════════════════════ SPICK: Retry-helper för optimistic-lock retry |
| `_shared/rut-xml-builder.ts` |  |
| `_shared/send-magic-sms.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Magic-link hjälpare för publika auth-flows (Fas  |
| `_shared/sentry.ts` | ═══════════════════════════════════════════════════════════════ SPICK — Sentry-wrapper för Edge Functions (Fas 10 Observ |
| `_shared/slot-holds.ts` | _shared/slot-holds.ts — Fas 5 §5.4.2 ═══════════════════════════════════════════════════════════════ |
| `_shared/sms-billing.ts` | supabase/functions/_shared/sms-billing.ts ────────────────────────────────────────────────────────────────── |
| `_shared/stripe-client.ts` |  |
| `_shared/stripe-webhook-verify.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Stripe webhook HMAC-signature-validering (shared |
| `_shared/stripe.ts` |  |
| `_shared/terms-acceptance.ts` | supabase/functions/_shared/terms-acceptance.ts ────────────────────────────────────────────────────────────────── |
| `_shared/timezone.ts` | ───────────────────────────────────────────────────────────── SPICK – Tidszon-hjälpare |

## GitHub Actions workflows (51 st)

- `.github/workflows/admin-morning-report.yml`
- `.github/workflows/auto-post-daily.yml`
- `.github/workflows/auto-rebook.yml`
- `.github/workflows/auto-remind.yml`
- `.github/workflows/backup-verify-monthly.yml`
- `.github/workflows/backup.yml`
- `.github/workflows/blog-auto-publish.yml`
- `.github/workflows/bulk-schedule-week.yml`
- `.github/workflows/charge-subscription.yml`
- `.github/workflows/claude.yml`
- `.github/workflows/cleaner-onboarding-emails.yml`
- `.github/workflows/cleanup-stale.yml`
- `.github/workflows/company-url-monitor.yml`
- `.github/workflows/content-claims-monitor.yml`
- `.github/workflows/content-engine.yml`
- `.github/workflows/customer-nudge-recurring.yml`
- `.github/workflows/daily-automation.yml`
- `.github/workflows/db-audit.yml`
- `.github/workflows/deploy-edge-functions.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/disaster-recovery.yml`
- `.github/workflows/dispute-sla-check.yml`
- `.github/workflows/elks-balance-monitor.yml`
- `.github/workflows/email-deliverability-monthly.yml`
- `.github/workflows/escrow-auto-release.yml`
- `.github/workflows/generate-sitemap.yml`
- `.github/workflows/lighthouse-nightly.yml`
- `.github/workflows/lint-hardcoded-values.yml`
- `.github/workflows/load-test.yml`
- `.github/workflows/loopia-dns.yml`
- `.github/workflows/monthly-invoices.yml`
- `.github/workflows/n3-pnr-reminder-cron.yml`
- `.github/workflows/playwright-cross-browser.yml`
- `.github/workflows/playwright-smoke.yml`
- `.github/workflows/playwright-stripe-e2e.yml`
- `.github/workflows/preference-learn-favorite.yml`
- `.github/workflows/rating-reminder.yml`
- `.github/workflows/run-migrations.yml`
- `.github/workflows/schema-drift-check.yml`
- `.github/workflows/security-scan.yml`
- `.github/workflows/set-secrets.yml`
- `.github/workflows/sms-delivery-weekly.yml`
- `.github/workflows/ssl-monitor.yml`
- `.github/workflows/synthetic-monitor.yml`
- `.github/workflows/team-sms.yml`
- `.github/workflows/test-money.yml`
- `.github/workflows/ui-monitor.yml`
- `.github/workflows/update-claude-md.yml`
- `.github/workflows/uptime-monitor.yml`
- `.github/workflows/visual-regression.yml`
- `.github/workflows/weekly-report.yml`

## Migrations (173 st)

- Senaste: `20260429000004_phase2_data_hygiene.sql`
- Timestamp-prefix: `20260429000004`

