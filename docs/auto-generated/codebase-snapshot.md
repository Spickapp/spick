# Codebase Snapshot (auto-generated 2026-04-24)

Genererad av `scripts/generate-claude-md.ts`. Kopiera valda sektioner
till CLAUDE.md för att fixa Regel #29-drift.

---

## Edge Functions (82 st)

| Funktion | Första kommentar |
|----------|------------------|
| `admin-approve-cleaner` |  |
| `admin-approve-company` | ═══════════════════════════════════════════════════════════════ SPICK – admin-approve-company (Sprint B Dag 5) |
| `admin-create-company` |  |
| `admin-dispute-decide` | ═══════════════════════════════════════════════════════════════ SPICK – admin-dispute-decide (Fas 8 §8.14 wrapper) |
| `admin-mark-payouts-paid` | Fas 1.10.2: Admin-trigger av payout-flode (ersatter direkt DB-PATCH) Primarkalla: docs/planning/spick-arkitekturplan-v3. |
| `admin-morning-report` |  |
| `admin-reject-company` | ═══════════════════════════════════════════════════════════════ SPICK – admin-reject-company (Sprint B Dag 5) |
| `analyze-booking-pattern` | analyze-booking-pattern — Fas 5 §5.8 ═══════════════════════════════════════════════════════════════ |
| `auto-approve-check` |  |
| `auto-delegate` |  |
| `auto-rebook` | auto-rebook — Skapar bokningar för aktiva prenumerationer ═══════════════════════════════════════════════════════════ |
| `auto-remind` |  |
| `bankid` |  |
| `bankid-verify` |  |
| `bankid-webhook` |  |
| `booking-auto-timeout` |  |
| `booking-cancel-v2` |  |
| `booking-create` | supabase/functions/booking-create/index.ts SPICK: Booking Create — med inbyggd prismotor + marginalcheck |
| `booking-reassign` |  |
| `calendar-google-auth` | calendar-google-auth — Starta Google OAuth-flöde URL: /functions/v1/calendar-google-auth?cleaner_id=XXX |
| `calendar-google-callback` | calendar-google-callback — Google OAuth callback Tar emot auth code, utbyter mot tokens, sparar i calendar_connections |
| `calendar-ical-feed` | supabase/functions/calendar-ical-feed/index.ts Genererar iCal (.ics) feed för en städare. |
| `calendar-sync` | calendar-sync — Synkronisera Google Calendar ↔ Spick Triggas av: |
| `charge-subscription-booking` | charge-subscription-booking — Debiterar sparade kort dagen innan städning ══════════════════════════════════════════════ |
| `claude` |  |
| `cleaner-booking-response` |  |
| `cleaner-job-completed` | ═══════════════════════════════════════════════════════════════ SPICK – cleaner-job-completed (Fas 8 §8.2 wiring) |
| `cleaner-og` |  |
| `cleaner-optout` |  |
| `cleanup-stale` |  |
| `company-accept-invite` | ═══════════════════════════════════════════════════════════════ SPICK – company-accept-invite (Sprint B Dag 4) |
| `company-invite-member` | ═══════════════════════════════════════════════════════════════ SPICK – company-invite-member (Sprint B Dag 4) |
| `company-propose-substitute` |  |
| `company-self-signup` | ═══════════════════════════════════════════════════════════════ SPICK – company-self-signup (Sprint B Dag 3) |
| `company-toggle-member` | ═══════════════════════════════════════════════════════════════ SPICK – company-toggle-member (Fas 9 §9.1) |
| `customer-approve-proposal` |  |
| `customer-check-auto-delegation` | ═══════════════════════════════════════════════════════════════ SPICK – customer-check-auto-delegation (Fas 1.2) |
| `customer-nudge-recurring` | customer-nudge-recurring — Fas 5 §5.9 ═══════════════════════════════════════════════════════════════ |
| `customer-subscription-manage` | customer-subscription-manage — Fas 5 §5.4 ═══════════════════════════════════════════════════════════ |
| `customer-upsert` | ═══════════════════════════════════════════════════════════════ SPICK – customer-upsert (Fas 1.2) |
| `dispute-admin-decide` | ═══════════════════════════════════════════════════════════════ SPICK – dispute-admin-decide (Fas 8 §8.14) |
| `dispute-cleaner-respond` | ═══════════════════════════════════════════════════════════════ SPICK – dispute-cleaner-respond (Fas 8 §8.9) |
| `dispute-open` | ═══════════════════════════════════════════════════════════════ SPICK – dispute-open (Fas 8 §8.8) |
| `dispute-sla-check` | ═══════════════════════════════════════════════════════════════ SPICK – dispute-sla-check (Fas 8 §8.12.2) |
| `email-inbound` |  |
| `escrow-auto-release` | ═══════════════════════════════════════════════════════════════ SPICK – escrow-auto-release (Fas 8 §8.12) |
| `escrow-release` | ═══════════════════════════════════════════════════════════════ SPICK – escrow-release (Fas 8 §8.7) |
| `escrow-state-transition` | ═══════════════════════════════════════════════════════════════ SPICK – escrow-state-transition (Fas 8 §8.6) |
| `expire-team-invitations` | ═══════════════════════════════════════════════════════════════ SPICK – expire-team-invitations (Sprint B Dag 6) |
| `export-cleaner-data` | export-cleaner-data — Fas 8 §8.20 ═══════════════════════════════════════════════════════════════ |
| `generate-receipt` | ═══════════════════════════════════════════════════════════════ SPICK – Kundkvitto (Customer Receipt HTML + Email) |
| `generate-self-invoice` | ═══════════════════════════════════════════════════════════════ SPICK – Självfaktura-generator (Self-billing invoice) |
| `geo` | SPICK – Geo Matching |
| `get-cleaner-contact` |  |
| `health` |  |
| `matching-wrapper` | supabase/functions/matching-wrapper/index.ts §3.7-full Step 2b — Matching-wrapper EF (shadow-mode A/B-ramverk) |
| `noshow-refund` |  |
| `notify` |  |
| `notify-new-application` |  |
| `onboarding-reminders` |  |
| `onboarding-save` |  |
| `places-autocomplete` |  |
| `poll-stripe-onboarding-status` | ═══════════════════════════════════════════════════════════════ SPICK – poll-stripe-onboarding-status (Sprint B Dag 6) |
| `preference-learn-favorite` | preference-learn-favorite — Fas 5 §5.5b ═══════════════════════════════════════════════════════════════ |
| `public-auth-exchange` | ═══════════════════════════════════════════════════════════════ SPICK – public-auth-exchange (Fas 1.2) |
| `public-auth-link` | ═══════════════════════════════════════════════════════════════ SPICK – public-auth-link (Fas 1.2) |
| `push` | SPICK – Push Notifications med VAPID |
| `reconcile-payouts` | Fas 1.9: Edge Function for reconciliation cron Primarkalla: docs/architecture/fas-1-8-reconciliation-design.md |
| `referral-register` |  |
| `save-booking-event` | ═══════════════════════════════════════════════════════════════ SPICK – save-booking-event (Fas 6.3 + §6.5 beslut 2026-0 |
| `serve-invoice` |  |
| `services-list` | services-list: Public read of services + addons F1 Dag 1 - arkitekturplan v3 |
| `setup-subscription` | supabase/functions/setup-subscription/index.ts SPICK: Subscription Setup |
| `sitemap-profiles` | supabase/functions/sitemap-profiles/index.ts Sprint Prof-5: Dynamisk sitemap för profil-URL:er (/f/<slug>, /s/<slug>) |
| `sms` |  |
| `social-media` |  |
| `stripe-connect` |  |
| `stripe-connect-webhook` | ═══════════════════════════════════════════════════════════════ SPICK – stripe-connect-webhook (Sprint B Dag 1) |
| `stripe-refund` |  |
| `stripe-webhook` |  |
| `swish` |  |
| `team-sms-notify` |  |

## Shared EF helpers (19 st)

| Fil | Första kommentar |
|-----|------------------|
| `_shared/alerts.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Admin-alert-helper (Fas 10 §10.1 + §10.2 partial |
| `_shared/auth.ts` | supabase/functions/_shared/auth.ts ───────────────────────────────────────────────────────────────── |
| `_shared/email.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Delad Edge Function-infrastruktur |
| `_shared/escrow-state.ts` | supabase/functions/_shared/escrow-state.ts ────────────────────────────────────────────────────────────────── |
| `_shared/events.ts` | supabase/functions/_shared/events.ts ────────────────────────────────────────────────────────────────── |
| `_shared/fonts.ts` |  |
| `_shared/holidays.ts` | _shared/holidays.ts — Fas 5 §5.11 ═══════════════════════════════════════════════════════════════ |
| `_shared/matching-diff.ts` | supabase/functions/_shared/matching-diff.ts ────────────────────────────────────────────────────────────────── |
| `_shared/money.ts` |  |
| `_shared/notifications.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Multi-kanal notifikationer |
| `_shared/preferences.ts` | supabase/functions/_shared/preferences.ts ────────────────────────────────────────────────────────────────── |
| `_shared/pricing-engine.ts` |  |
| `_shared/pricing-resolver.ts` | supabase/functions/_shared/pricing-resolver.ts ────────────────────────────────────────────────────────────────── |
| `_shared/send-magic-sms.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Magic-link hjälpare för publika auth-flows (Fas  |
| `_shared/slot-holds.ts` | _shared/slot-holds.ts — Fas 5 §5.4.2 ═══════════════════════════════════════════════════════════════ |
| `_shared/stripe-client.ts` |  |
| `_shared/stripe-webhook-verify.ts` | ═══════════════════════════════════════════════════════════════ SPICK – Stripe webhook HMAC-signature-validering (shared |
| `_shared/stripe.ts` |  |
| `_shared/timezone.ts` | ───────────────────────────────────────────────────────────── SPICK – Tidszon-hjälpare |

## GitHub Actions workflows (44 st)

- `.github/workflows/admin-morning-report.yml`
- `.github/workflows/auto-post-daily.yml`
- `.github/workflows/auto-rebook.yml`
- `.github/workflows/auto-remind.yml`
- `.github/workflows/backup-verify-monthly.yml`
- `.github/workflows/backup.yml`
- `.github/workflows/bulk-schedule-week.yml`
- `.github/workflows/charge-subscription.yml`
- `.github/workflows/claude.yml`
- `.github/workflows/cleanup-stale.yml`
- `.github/workflows/content-engine.yml`
- `.github/workflows/customer-nudge-recurring.yml`
- `.github/workflows/daily-automation.yml`
- `.github/workflows/db-audit.yml`
- `.github/workflows/deploy-edge-functions.yml`
- `.github/workflows/deploy-loopia.yml`
- `.github/workflows/deploy-stripe.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/disaster-recovery.yml`
- `.github/workflows/dispute-sla-check.yml`
- `.github/workflows/e2e-test.yml`
- `.github/workflows/escrow-auto-release.yml`
- `.github/workflows/generate-sitemap.yml`
- `.github/workflows/inject-tracking.yml`
- `.github/workflows/lint-hardcoded-values.yml`
- `.github/workflows/load-test.yml`
- `.github/workflows/loopia-dns.yml`
- `.github/workflows/monthly-invoices.yml`
- `.github/workflows/playwright-smoke.yml`
- `.github/workflows/preference-learn-favorite.yml`
- `.github/workflows/run-migrations.yml`
- `.github/workflows/schema-drift-check.yml`
- `.github/workflows/security-scan.yml`
- `.github/workflows/set-secrets.yml`
- `.github/workflows/social-media.yml`
- `.github/workflows/ssl-monitor.yml`
- `.github/workflows/stripe-setup.yml`
- `.github/workflows/team-sms.yml`
- `.github/workflows/test-money.yml`
- `.github/workflows/test.yml`
- `.github/workflows/ui-monitor.yml`
- `.github/workflows/update-claude-md.yml`
- `.github/workflows/uptime-monitor.yml`
- `.github/workflows/weekly-report.yml`

## Migrations (123 st)

- Senaste: `20260427000011_fas8_log_escrow_event_rpc.sql`
- Timestamp-prefix: `20260427000011`

