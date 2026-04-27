# CLAUDE.md – Spick Projektkontext
> **Uppdaterad:** 2026-04-24 · Manuell sync från codebase-snapshot + sanning/-filer.
> **Verifieringskonvention (§11.3):** Varje infrastruktur-sektion markerar "Senast verifierad: YYYY-MM-DD" när datan senast kontrollerades mot prod eller auto-snapshot. Datum äldre än 14 dagar → verifiera innan du bygger på påståendet.

## Projekt
**Spick** — Sveriges städplattform. Uber-modellen för städning.
Kunder bokar betygsatta städare direkt. Städare sätter egna priser (250–600 kr/h). **Spick tar 12% flat provision** (trappsystem avskaffat 2026-04-17, låst i `platform_settings.commission_standard=12`). RUT-avdrag 50%.

**Primärkällor för affärsregler:** `docs/sanning/provision.md`, `docs/sanning/rut.md`, `docs/sanning/pnr-och-gdpr.md`. Memory + denna fil är hypoteser — sanning-filer vinner vid konflikt.

## Ägare
- **Farhad Haghighi** — farrehagge@gmail.com / hello@spick.se
- **Bolag:** Haghighi Consulting AB (559402-4522), bifirma Spick

## Tech Stack
*Senast verifierad: 2026-04-24 (EF-count mot `docs/auto-generated/codebase-snapshot.md`).*

| Komponent | Teknik |
|-----------|--------|
| Frontend | Vanilla HTML/CSS/JS (64 sidor), components.js (nav/footer) |
| Typsnitt | Playfair Display (rubriker) + DM Sans (brödtext) |
| Färger | #0F6E56 primär, #1D9E75 accent, #E1F5EE pale, #F7F7F5 bg |
| Backend/DB | Supabase PostgreSQL + 78 Edge Functions + 3 VIEWs |
| Hosting | GitHub Pages (auto-deploy vid push till main) |
| E-post | Resend (verifierad) + Google Workspace hello@spick.se |
| Betalning | Stripe live mode (kort + Klarna) + dual-key test/live-toggle (`platform_settings.stripe_test_mode`) |
| CI/CD | 35 GitHub Actions workflows (cron + on-push + manuell) |
| Analytics | GA4 (G-CP115M45TT) + Meta Pixel + Microsoft Clarity (w1ep5s1zm6) |
| PWA | Service Worker (stale-while-revalidate) + manifest.json |

## Edge Functions (78 st — fullständig lista + beskrivningar)
*Senast verifierad: 2026-04-24 (auto-snapshot).*

**Full canonical snapshot:** `docs/auto-generated/codebase-snapshot.md` (auto-uppdateras veckovis via workflow `update-claude-md.yml` — Fas 11.2).

**Kritiska EFs (urval):**

| Funktion | Syfte | Auth |
|----------|-------|------|
| booking-create | Prismotor + Stripe Checkout + booking-insert + event-log | Anon |
| stripe-webhook | Betalningsbekräftelse, auto-tilldelning, email, idempotency + dual-key | Stripe sig via API-verify |
| matching-wrapper | Branching mellan v1/v2/shadow/providers — returnerar V2Cleaner[] | Anon |
| auto-delegate | System-tilldelning av ersättare (cron fallback + on-reject) | Service role |
| auto-rebook | Cron som skapar bokningar från aktiva subscriptions | CRON_SECRET |
| charge-subscription-booking | Debiterar sparade kort dagen innan städning | CRON_SECRET |
| cleanup-stale | Rensar pending >30min | CRON_SECRET |
| auto-remind | Bokningspåminnelser + auto-reassign | CRON_SECRET |
| notify | Transaktionsmail (bekräftelse, avbokning, garanti etc) | Anon |
| health | Systemstatus + business metrics | Anon |
| geo | Geocoding + nearest-cleaner matching (Nominatim) | Anon |
| rut-claim | RUT-ansökan till Skatteverket (**AVSTÄNGD** — pausad till Fas 7.5) | Service role |
| sitemap-profiles | Dynamisk XML sitemap för /f/ och /s/ (Prof-5) | Anon |
| reconcile-payouts | Daglig avstämning Stripe transfers vs payout_status | CRON_SECRET |
| stripe-connect-webhook | Stripe Connect onboarding-status-updates | Stripe sig |
| generate-receipt | HTML-kvitto + Resend-mail (BokfL 5 kap 7§-kompatibelt) | Anon |
| company-self-signup | Self-service företagsregistrering (Sprint B) | Anon |

**Shared helpers** (13 st i `_shared/`): money.ts, events.ts, preferences.ts, matching-diff.ts, pricing-engine.ts, pricing-resolver.ts, stripe.ts, stripe-client.ts, stripe-webhook-verify.ts, email.ts, notifications.ts, send-magic-sms.ts, timezone.ts, fonts.ts.

## Databasvyer (säkra, anon-åtkomst)
*Senast verifierad: 2026-04-24. Notera: `v_customer_bookings` + `v_calendar_slots` finns också i prod (Fas 8 + Fas 1) men är cleaner/customer-scopade, inte publika stats.*

| View | Syfte | Exponerade kolumner |
|------|-------|-------------------|
| booking_slots | Kalender (boka.html) | cleaner_id, date, time, hours |
| booking_confirmation | Tack/betyg-sidor | id, booking_id, service_type, booking_date, booking_time, customer_address, total_price, cleaner_name, customer_name, customer_email, payment_intent_id, payment_status (m.fl.) |
| public_stats | Homepage-statistik | total_bookings, bookings_today, active_cleaners, avg_rating |

## Säkerhet (efter audit 2026-03-30)
*Senast verifierad: 2026-04-24. Full audit nästa: §13.7 pentest (Fas 13).*
- **XSS:** escHtml() i 29 filer, 174 sanerade renderingspunkter
- **RLS:** Alla öppna USING(true) UPDATE-policies borttagna
- **CSP:** Utan unsafe-eval, med HSTS (max-age=31536000)
- **Booking validation:** Server-side trigger (dubbelbokningar, ogiltiga belopp, bokningar i förfluten tid)
- **Stripe:** Booking-verifiering + Idempotency-Key på checkout
- **Rate limiting:** check_rate_limit() RPC-funktion i Edge Functions
- **Webhook:** processed_webhook_events-tabell (idempotency)
- **Cron auth:** CRON_SECRET krävs för cleanup-stale + auto-remind
- **booking_status_log:** Auditlogg för statusändringar

## Kända problem / Nästa sprint
- [ ] Innovation Sprint-migrationer (referral, coupons, spark) — ej körda i prod
- [ ] SMS-integration (46elks) — bokningsbekräftelser
- [ ] Google Business Profile — ej skapat
- [ ] PostHog analytics — ej installerat
- [ ] Sentry error monitoring — ej installerat
- [ ] Astro-migrering (64 HTML → komponentbaserat) — framtid

## GitHub Secrets
*Senast verifierad: 2026-04-24. Plus Supabase-secrets (server-side): `INTERNAL_EF_SECRET`, `ADMIN_ALERT_WEBHOOK_URL` (EJ satt — console-fallback), `RUT_PNR_ENCRYPTION_KEY` (legacy, låst till Fas 7.5).*

```
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET,
RESEND_API_KEY, ANTHROPIC_API_KEY, SUPABASE_ACCESS_TOKEN,
SUPABASE_ANON_KEY, SUPABASE_DB_PASSWORD, SUPABASE_SERVICE_KEY,
BUFFER_ACCESS_TOKEN, CRON_SECRET
```

## Viktiga filer
*Senast verifierad: 2026-04-24.*
| Fil | Syfte |
|-----|-------|
| js/config.js | Config (SUPA_URL, SUPA_KEY, escHtml, spickFetch, error handling) |
| js/components.js | Nav, footer, mobilmeny (injiceras i alla sidor) |
| js/cro.js | Social proof toasts (riktig data från reviews), exit-intent popup |
| js/services-loader.js | Feature-flagged DB-driven services-rendering (F1_USE_DB_SERVICES) |
| js/commission-helpers.js | Centralized commission-läsning (getCommissionRate/Pct från platform_settings) |
| sw.js | Service Worker v2026-04-27 (stale-while-revalidate HTML, cache-first statics, never-cache admin/booking/Supabase). Saknades i prod 2026-03-30→2026-04-27 — registrerades inte i index.html (tomt SW-block). Fixed commit `b4ff932`. |
| supabase/functions/_shared/money.ts | Central money-layer (Fas 1) |
| supabase/functions/_shared/events.ts | Central event-logging (Fas 6.2) |
| supabase/functions/_shared/preferences.ts | customer_preferences helpers (Fas 5.5a) |
| scripts/generate-claude-md.ts | Auto-snapshot av codebase (Fas 11.1) |
| scripts/lint-hardcoded-values.ts | CI-linter för hardcoded commission/hourly_rate/RUT_SERVICES/öppna RLS (Fas 12.5) |
| scripts/.lint-allow.json | Ratchet-allow-list för lint-hardcoded-values (motiverade undantag) |
| docs/sanning/*.md | Primärkällor för affärsregler (provision, rut, pnr-gdpr) |
| docs/architecture/*.md | Design-docs per fas (matching, money, events, recurring, escrow) |
| docs/auto-generated/codebase-snapshot.md | Auto-uppdaterad snapshot (Fas 11.2) |
| docs/OPERATIONS_RUNBOOK.md | Komplett drifthandbok |
| scripts/verify-deploy.sh | Post-deploy verifiering (18 checks) |
| .claude/settings.json | Projekt-level Claude Code-config inkl. PreToolUse-hook för regel #26-#32-enforcement (committad, gäller alla teammates) |

## Konventioner
- Alla innerHTML med DB-data MÅSTE använda escHtml()
- Alla dynamiska URL-parametrar MÅSTE använda encodeURIComponent()
- Nya Edge Functions som anropas via cron MÅSTE kräva CRON_SECRET
- Frontend queryar ALDRIG bookings-tabellen direkt — använd VIEWs
- Supabase JS laddas utan defer (utom index.html som har DOMContentLoaded-wrapper)
- Farhads PowerShell: använd semikolon (;) istf && för att kedja kommandon
- Hardcoded commission/hourly_rate/RUT_SERVICES/öppna RLS-policies blockeras av CI-lint (`deno task lint:hardcoded`). Nya undantag kräver motivering i `scripts/.lint-allow.json`
- Alla `git commit*`-kommandon triggar automatisk regel #26-#32-checklista via PreToolUse-hook i [.claude/settings.json](.claude/settings.json). Om hook saknas (ny dator/klon/disabled) → kör `/hooks` i Claude-prompten för reload, eller manuellt gå igenom checklistan + curl-verifiera mot prod innan commit.

## Obligatoriska regler (#26-#32)
- **#26** Grep-före-edit: läs exakt text + verifiera surrounding code innan str_replace
- **#27** Scope-respekt: gör exakt det du blev ombedd, flagga observationer istället för att agera
- **#28** Single source of truth: business-data centraliserad i `platform_settings` + `_shared/`-helpers. Ingen fragmentering.
- **#29** Audit-först: läs audit-filen i sin helhet innan du agerar på "audit säger X"
- **#30** Regulator-gissning FÖRBJUDEN: Skatteverket, GDPR, BokfL, Stripe-regler, EU PWD får aldrig antas. Verifiera mot spec eller fråga Farhad.
- **#31** Primärkälla över memory: prod-schema (via `information_schema`-query) + `docs/sanning/*.md` är sanning. Migrations-filer kan vara stale. Memory är hypotes.
- **#32** Hook-baserad enforcement: regel #26-#31 ska automatiskt påminnas via PreToolUse-hook i `.claude/settings.json` (matchar `Bash(git commit*)`). Om hook saknas (ny dator/klon/disabled) → kör `/hooks` för reload, eller manuellt gå igenom checklistan innan varje commit. Hook är enforcement-mekanism, inte ersättning för verkligt regel-följande.

**Lärdom 2026-04-23:** Tre rule #31-brott i samma session — alla fall av antagande om DB-kolumner (bookings.company_id, subscriptions.favorite_cleaner_email, subscriptions.price). **ALL schema-verification MÅSTE ske via `information_schema`-query mot prod INNAN kod/SQL skrivs.** Migration-filer i repo är ej tillförlitliga pga §2.1-hygien #25 drift. Fas 2.X Replayability Sprint löser detta långsiktigt.
