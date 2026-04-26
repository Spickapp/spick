# Session handoff — 2026-04-26 (50 commits, Item 1 + Fas 8.22 + Alt B + Alt A + N3 Sprint 1 + SMS-design)

**Föregående handoff:** `SESSION-HANDOFF_2026-04-25-tic-cleanup-massive.md`
**Status vid avslut:** 50 commits pushade. 0 prod-incidenter. Stripe-Connect-webhook LIVE 200 OK. BankID OBLIGATORISKT vid RUT-bokning. Disk IO Etapp 1 deployad. AES-256-GCM PNR-encryption aktiv. Fas 8 §8.22 partial-refund komplett. Item 1 BankID-bunden signering klar (flag-OFF). Alt A B2B-fallback för team-medlemmar. VD-payment-summary-vy LIVE. N3 PNR Sprint 1 levererad (migration pending). SMS-saldo-design klar (väntar Farhad-OK).

---

## 1. TL;DR

Denna session levererade **9 stora arbetsspår** parallellt:

1. **Regel #32 + hook-enforcement** — `.claude/settings.json` PreToolUse-hook injicerar regel #26-#32 vid varje `git commit*`. CLAUDE.md uppdaterad. `.gitignore` öppnar `.claude/settings.json` för commit.
2. **Villkor-paket** — kundvillkor + underleverantörsavtal-drafts + jurist-checklist + hybrid-utförare/förmedlare-analys + 50%-drag-mot-kund + ångerrätt-analys.
3. **Item 1 BankID-bunden signering** — 5 etapper (terms-acceptance schema/helper, register-bankid-init/-status, check-terms-acceptance EF, retroaktiv-modal i stadare-dashboard, impl-rapport). Flag-gated tills jurist-OK.
4. **Item 2 BankID OBLIGATORISKT** — boka.html blockerar submit för RUT + privat + RUT-eligible-service utan BankID-verifiering.
5. **Stripe-fixar** — verify_jwt=false för stripe-connect-webhook (config.toml + deploy --no-verify-jwt). Dupe-konto-fix i stripe-connect-EF. Alt A B2B-fallback i money.ts triggerStripeTransfer.
6. **Disk IO Etapp 1** — 5 cron-justeringar (escrow-auto-release, auto-remind, admin-morning-report, dispute-sla-check, cleanup-stale).
7. **Fas 8 §8.22 partial-refund** — escrow-state-machine + refund-booking-EF + dispute-admin-decide auto-call. Fas 8 ~99%.
8. **Alt B AES-256-GCM PNR-encryption** — `_shared/encryption.ts` + rut-bankid-status krypterar bookings.customer_pnr.
9. **N3 PNR-verifiering Sprint 1** — schema + helper + 18/18 tester PASS.
10. **SMS-saldo per cleaner-owner** — design-doc 277 rader (5-lager-modell, 4 sprintar, 5 risk-flaggor, 7 frågor till Farhad).

Plus: Fas 6 §6.8 + Fas 7 §7.7 + Hygien #48.4/#48.6 + Fas 2 §2.1.2 (1/15) + public_stats fix + auto-remind 500-fix + swish arkiverad + VD-onboarding fix + N3 PNR-doc-leverans + Solid Service team-readiness audit + 3 UI-mockups (§3.8 admin-matching, §9.2 VD-dispute, §9.9 underleverantörsavtal) + interaktiv kalender-design + VD-payment-summary EF.

---

## 2. Commits — kategoriserade (50 totalt sedan `38e4c97`)

### 2.1 Regel-enforcement + dokumentation (3 commits)

| Sha | Vad |
|---|---|
| `b0abaa9` | Regel #32 + hook-enforcement för regel #26-#31 (settings.json, gitignore, CLAUDE.md) |
| `8c781e3` | Hygien #48 — #48.4 GitHub-issue vid migration-fel + #48.6 migrations-konvention |
| `5d2dc16` | codebase-snapshot.md auto-bump |

### 2.2 Fas-stängning (3 commits)

| Sha | Vad |
|---|---|
| `3382111` | Fas 6 §6.8 — customer-subscription-manage retrofittad med 5 recurring-events |
| `89bbefb` | Fas 7 §7.7 — find_nearby_cleaners utökad med p_languages-filter |
| `b5aba07` | Fas 2 §2.1.2 1/15 — DROP cleaner_languages (SUPERSEDED) |

### 2.3 Villkor-paket (5 commits)

| Sha | Vad |
|---|---|
| `2e5bd43` | Villkor-paket — research + 2 drafts + jurist-checklist (4 docs) |
| `f5c838b` | Underleverantörsavtal v0.2 — anti-fraud + vite-skala + trappad avstängning |
| `c64af73` | Hybrid-modell-analys + 50%-drag-mot-kund-vid-RUT-nekande |
| `f7a0a06` | Ångerrätt-analys — boka.html-text saknar lag-krav del 2 |
| `2b83aed` | Supabase Disk IO Budget diagnos + 4-etapps åtgärdsplan |

### 2.4 Item 1 BankID-bunden signering (5 etapper, 5 commits + 5 snapshots)

| Sha | Vad |
|---|---|
| `5e596c0` | Design-doc — Item 1 BankID-godkännande av underleverantörsavtal vid registrering |
| `334d6a0` | Etapp 1: terms-acceptance schema + helper för BankID-bunden signering |
| `0930abc` | Etapp 2: register-bankid-init/-status för cleaner+company-signering |
| `b559740` | Etapp 3: check-terms-acceptance EF + retroaktiv-modal i dashboard |
| `8749103` | Etapp 5: impl-rapport + progress.md-uppdatering |

### 2.5 Stripe-fixar (3 commits)

| Sha | Vad |
|---|---|
| `1a03615` | Item 5 — verify_jwt=false för stripe-connect-webhook (config.toml) |
| `09d0df9` | stripe-connect dupe-konto-bug — defensiv check mot existing stripe_account_id |
| `edc267e` | Alt A B2B-fallback — team-medlemmar transfer:as till företaget (money.ts) |

### 2.6 BankID-obligatorisk + Disk IO + PNR-encryption + §8.22 (7 commits)

| Sha | Vad |
|---|---|
| `a2777fd` | Item 2 — BankID-verifiering OBLIGATORISK för RUT-bokning (boka.html) |
| `4b729e4` | Etapp 1 IO — 5 cron-justeringar för Supabase Disk IO Budget |
| `813eb51` | Alt B AES-256-GCM-encryption för RUT-PNR-lagring (_shared/encryption.ts + rut-bankid-status) |
| `a7f9acd` | Alt B-migration KÖRD + Farhad-beslut (b) på legacy-rader |
| `b6fb146` | Fas 8 §8.22 state-machine — released_partial + transfer_partial_refund |
| `0359844` | Fas 8 §8.22 step 2 — partial-refund-flow i refund-booking + dispute-admin-decide |
| `d782a70` | Fas 8 §8.22 KLAR — uppdatera status till ~99% |

### 2.7 Prod-fixar (3 commits)

| Sha | Vad |
|---|---|
| `36fcd23` | public_stats-vy saknades i prod + CLAUDE.md doc-drift |
| `71b2e9e` | public_stats — ta bort security_invoker (RLS-blockerar anon) |
| `31bba2c` | auto-remind krascha 500 på .rpc(...).catch — byt till try/await |

### 2.8 Cleanup + UI-fixar (2 commits)

| Sha | Vad |
|---|---|
| `0e33e17` | swish-EF + swish-return.html arkiverade (audit 2026-04-25) |
| `0e646a3` | VD-onboarding punkt 1 markerades aldrig klar (avatar-mismatch) |

### 2.9 VD-payment-summary + Fas 9-mockups (3 commits)

| Sha | Vad |
|---|---|
| `741194c` | Fas 9 §9.2 VD-dispute frontend UI-mockup för Farhad-OK |
| `05b91c0` | Fas 9 VD-betalningsöversikt — företagets payment-flow synlig för VD |
| `a4c60c0` | A+C-leverans — Solid Service-audit + 3 UI-mockups + kalender-design |

### 2.10 N3 PNR-verifiering Sprint 1 + SMS-design (2 commits)

| Sha | Vad |
|---|---|
| `50cfbcc` | N3 Sprint 1 — PNR-verifiering schema + helper |
| `0d37949` | SMS-saldo per cleaner-owner — designanalys (för Farhad-OK) |

### 2.11 Auto-genererade (~14 commits)
codebase-snapshot.md auto-bumps, sitemap auto-update, backup auto.

---

## 3. Prod-state-ändringar

### 3.1 Migrationer KÖRDA i Supabase Studio (Farhad)

| Migration | Vad |
|---|---|
| `20260425170000_fas_7_7_find_nearby_cleaners_languages.sql` | RPC find_nearby_cleaners utökad med p_languages |
| `20260425180000_fas_2_1_2_drop_cleaner_languages.sql` | DROP cleaner_languages-tabell (SUPERSEDED av cleaners.spoken_languages JSONB) |
| `20260425190000_fas_8_22_released_partial.sql` | escrow_status CHECK utökad med 'released_partial' |
| `20260425200000_public_stats_view.sql` + `20260425201000_public_stats_fix_security.sql` | public_stats-vy återskapad utan security_invoker |
| `20260425210000_item1_terms_acceptance_schema.sql` | terms_acceptances + avtal_versioner + cleaners.terms_signed_at + companies.terms_signed_at + 2 platform_settings |

### 3.2 Migrationer EJ KÖRDA — pending Farhad

| Migration | Vad |
|---|---|
| `20260426100000_n3_pnr_verification_schema.sql` | bookings.pnr_verification_method (CHECK-enum) + pnr_verified_at + customer_pnr_verification_session_id + platform_settings.pnr_verification_required='soft' |

### 3.3 EFs deployade (Farhad körde `supabase functions deploy`)

| EF | Vad |
|---|---|
| `stripe-connect-webhook` | `--no-verify-jwt` för Stripe-signatur-verifiering |
| `stripe-connect` | Dupe-konto-fix |
| `register-bankid-init` | Item 1 — TIC BankID för cleaner/company-signering |
| `register-bankid-status` | Item 1 — pollar TIC, hashar PNR, recordAcceptance |
| `check-terms-acceptance` | Item 1 — JWT-auth, returnerar AcceptanceStatus |
| `vd-payment-summary` | Fas 9 — aggregerar payment-status per company för VD |
| `auto-remind` | 500-fel fixat (.rpc(...).catch → try/await) |

### 3.4 Auto-deployade EFs (push till main → workflow auto-deploy)

| EF | Vad |
|---|---|
| `refund-booking` | §8.22 partial_amount_sek + state transitions + admin-alert |
| `dispute-admin-decide` | §8.22 auto-call refund-booking även för 'partial_refund' |
| `rut-bankid-status` | Alt B AES-256-GCM-kryptering av PNR till bookings.customer_pnr |
| `customer-subscription-manage` | Fas 6 §6.8 — 5 recurring-events efter UPDATE |
| `matching-wrapper` | Fas 7 §7.7 — languages?: string[] till body + 3 RPC-anrop |
| `money.ts` (deps refund/transfer) | Alt A B2B-fallback i triggerStripeTransfer |

### 3.5 Supabase secrets satta (Farhad)

| Secret | Vad |
|---|---|
| `PNR_ENCRYPTION_KEY` | AES-256-GCM-nyckel (Alt B) |
| `STRIPE_WEBHOOK_SECRET_CONNECT` | Korrigerad efter mismatch (Stripe Dashboard → secret) |

### 3.6 Cron-workflow-justeringar (Etapp 1 IO-fix)

| Workflow | Före | Efter | IO-besparing |
|---|---|---|---|
| escrow-auto-release.yml | `*/15 * * * *` (96/dag) | `0 * * * *` (24/dag) | 75% |
| auto-remind.yml | `7-59/30 * * * *` (~96/dag) | `0 9 * * *` + `0 15 * * *` (2/dag) | 98% |
| admin-morning-report.yml | 3 stages | 1 stage | 67% |
| dispute-sla-check.yml | `5 * * * *` (24/dag) | `5 9 * * *` (1/dag) | 96% |
| cleanup-stale.yml | `0 * * * *` (24/dag) | `0 */6 * * *` (4/dag) | 83% |

**Verifiera 24-48h efter `4b729e4`-deploy:** Supabase Disk IO Budget-graf ska vara <50% (var 79% innan).

### 3.7 Stripe-städning (Farhad-action)

- Solid Service: 3 dupes raderade i Stripe Dashboard, cleaners/companies.stripe_account_id konsistenta.
- Farhad+Rafa Stripe-dupes: pending Farhad-action (~10 min).

---

## 4. Filer skapade/modifierade — kategoriserat

### 4.1 NYA shared helpers (3)
- `supabase/functions/_shared/encryption.ts` (154 rader) — AES-256-GCM PNR-encryption
- `supabase/functions/_shared/terms-acceptance.ts` (209 rader) — Item 1 helper
- `supabase/functions/_shared/pnr-verification.ts` (179 rader) — N3 Sprint 1 helper

### 4.2 NYA Edge Functions (4)
- `supabase/functions/register-bankid-init/index.ts` — Item 1 etapp 2
- `supabase/functions/register-bankid-status/index.ts` — Item 1 etapp 2
- `supabase/functions/check-terms-acceptance/index.ts` — Item 1 etapp 3
- `supabase/functions/vd-payment-summary/index.ts` — Fas 9

### 4.3 NYA tester (1)
- `supabase/functions/_tests/pnr/pnr-verification.test.ts` — 18/18 PASS

### 4.4 NYA migrationer (7)
Listade i §3.1 + §3.2.

### 4.5 NYA docs — legal (5)
- `docs/legal/2026-04-25-konkurrent-research-villkor.md`
- `docs/legal/2026-04-25-kundvillkor-draft.md` (v0.2)
- `docs/legal/2026-04-25-underleverantorsavtal-draft.md` (v0.2)
- `docs/legal/2026-04-25-jurist-checklist.md`
- `docs/legal/2026-04-25-utforare-vs-formedlare-hybrid-analys.md`
- `docs/legal/2026-04-25-angerratt-analys.md`

### 4.6 NYA docs — design + planning + audit (8)
- `docs/ops/2026-04-25-supabase-disk-io-diagnos.md`
- `docs/design/2026-04-25-registrering-bankid-avtalsgodkannande.md`
- `docs/design/2026-04-26-sms-saldo-cleaner-owner-design.md` (277 rader)
- `docs/architecture/migrations-convention.md`
- `docs/implementation/2026-04-25-item1-bankid-signering-impl.md`
- `docs/audits/2026-04-26-solid-service-team-readiness.md`
- `docs/planning/fas-9-9-underleverantorsavtal-ui-mockup.md`
- `docs/planning/fas-3-8-admin-matching-dashboard-mockup.md`
- `docs/planning/fas-9-teamkalender-interaktiv-design.md`
- `docs/planning/fas-9-2-vd-dispute-frontend-mockup.md`

### 4.7 Modifierade filer (urval)
- `.claude/settings.json` (PreToolUse-hook)
- `.gitignore` (`.claude/*` + whitelist)
- `CLAUDE.md` (Regel #32, Konventioner-utökning, Viktiga filer-utökning)
- `supabase/config.toml` (verify_jwt=false för stripe-webhook + stripe-connect-webhook)
- `supabase/functions/_shared/escrow-state.ts` (`released_partial` + `transfer_partial_refund`)
- `supabase/functions/_shared/money.ts` (Alt A B2B-fallback)
- `supabase/functions/refund-booking/index.ts` (§8.22 partial-refund)
- `supabase/functions/dispute-admin-decide/index.ts` (§8.22 auto-call)
- `supabase/functions/auto-remind/index.ts` (.catch → try/await)
- `supabase/functions/customer-subscription-manage/index.ts` (Fas 6 events)
- `supabase/functions/matching-wrapper/index.ts` (Fas 7 languages)
- `supabase/functions/rut-bankid-status/index.ts` (Alt B encryption)
- `supabase/functions/stripe-connect/index.ts` (dupe-fix)
- `stadare-dashboard.html` (retroaktiv-modal + VD-onboarding-fix + VD-payment-summary)
- `boka.html` (Item 2 BankID-obligatorisk)
- `.github/workflows/run-migrations.yml` (Hygien #48.4 issue-skapande)
- `.github/workflows/escrow-auto-release.yml` + 4 till (IO-Etapp 1)

### 4.8 Memory-uppdateringar
- `C:/Users/farha/.claude/projects/C--Users-farha-spick/memory/project_rut_ombud_betydelse.md` (NY) — Spick = utförare, ansöker direkt från SKV.
- `MEMORY.md` (uppdaterad pointer till ovan)

---

## 5. Pending Farhad-actions (steg-för-steg)

### 5.1 KÖR migration `20260426100000_n3_pnr_verification_schema.sql` (KRITISKT — N3 Sprint 1 blockerad)
1. Öppna Supabase Studio → SQL Editor
2. Paste från fil-disk (NEJ chat-paste — markdown-länkifiering förorenar)
3. Verifiera: `SELECT column_name FROM information_schema.columns WHERE table_name='bookings' AND column_name LIKE 'pnr_%';` → ska returnera 3 rader

### 5.2 Bedöm villkor-paket (8-15h, jurist)
Per `docs/legal/2026-04-25-jurist-checklist.md`:
- Kundvillkor v0.2 (`2026-04-25-kundvillkor-draft.md`)
- Underleverantörsavtal v0.2 (`2026-04-25-underleverantorsavtal-draft.md`)
- Hybrid-modell utförare/förmedlare (`2026-04-25-utforare-vs-formedlare-hybrid-analys.md`) — verifiera mot Skatteverket-direktråd
- Ångerrätt-analys (`2026-04-25-angerratt-analys.md`) — boka.html-text saknar lag-krav

### 5.3 Aktivera Item 1 BankID-signering (efter jurist-OK)
3-stegs Studio-SQL:
```sql
INSERT INTO public.avtal_versioner (avtal_typ, version, content_md, is_binding, created_at)
VALUES ('underleverantorsavtal', 'v1.0', '<jurist-godkänd-text>', true, NOW());

UPDATE public.platform_settings SET value = 'true' WHERE key = 'terms_signing_required';

UPDATE public.platform_settings SET value = 'true' WHERE key = 'tic_enabled';
```

### 5.4 Bedöm SMS-saldo-design (Farhad-läs)
`docs/design/2026-04-26-sms-saldo-cleaner-owner-design.md` — välj A+B (säkrast, ~7-9h) eller A+B+C+D (~22-27h). Svara på 7 frågor i §6.

### 5.5 Verifiera Disk IO-sparing (24-48h efter 2026-04-26 ~10:00)
- Öppna Supabase Studio → Settings → Usage
- Disk IO Budget-graf ska vara <50% (var 79% innan)
- Om kvar >70%: tala om så bygg Etapp 2 (analyserad i `docs/ops/2026-04-25-supabase-disk-io-diagnos.md`)

### 5.6 Stäng Farhad+Rafa Stripe-dupes (10 min)
Per `docs/audits/2026-04-26-solid-service-team-readiness.md` §4.

### 5.7 Solid Service team prislistor (Zivar manuell, övrigt klart)
Per audit §5.

### 5.8 Solid Service team bio + avatar (5 cleaners)
Per audit §6.

### 5.9 Bedöm UI-mockups (Farhad-OK krävs innan bygge)
- §9.2 VD-dispute (`docs/planning/fas-9-2-vd-dispute-frontend-mockup.md`) — ~3-4h bygge
- §9.9 Underleverantörsavtal-UI (`docs/planning/fas-9-9-underleverantorsavtal-ui-mockup.md`) — ~4-6h bygge
- §3.8 Admin-matching-dashboard (`docs/planning/fas-3-8-admin-matching-dashboard-mockup.md`) — ~4-6h bygge

### 5.10 Bedöm interaktiv kalender-design (Farhad-OK krävs)
`docs/planning/fas-9-teamkalender-interaktiv-design.md` — välj F1+F3 (~6-8h) eller F1+F2+F3+F5+F6 (~12h)

### 5.11 Radera prod swish-EF (1 min)
```bash
supabase functions delete swish
```

### 5.12 Långa pending (utan ETA)
- Stripe-Connect-flow för §8.23 cleaner-transfer-rest (Farhad-design + bygge)
- Klarna chargeback §8.24-25
- EU PWD 2 dec 2026-deadline (jurist)
- Pentest §13.7 (extern auditor)

---

## 6. Pending för min sida (nästa session)

### 6.1 N3 PNR-verifiering Sprint 2-4 (~20-25h kvar)
- Sprint 2: Manuell-modal i stadare-dashboard får BankID-knapp som primärt val (~8h)
- Sprint 3: Async + auto-påminnelser (~6h)
- Sprint 4: VD-dashboard + dispute (~6h)

**Blockerad av:** Migration §5.1 ej körd än.

### 6.2 SMS-saldo Sprint A+B+C+D (~22-27h)
**Blockerad av:** Farhad-OK på design + svar på 7 frågor (§5.4).

### 6.3 §9.2 / §9.9 / §3.8 frontend bygge
**Blockerad av:** Farhad-OK på mockups (§5.9).

### 6.4 Kalender F1+F3 bygge
**Blockerad av:** Farhad-OK på design (§5.10).

### 6.5 §8.23 cleaner-transfer-rest
**Blockerad av:** Farhad-design (§5.12).

---

## 7. Status per fas (efter denna session)

| Fas | Före session | Efter session | Anteckning |
|---|---|---|---|
| Fas 6 (recurring) | ~95% | **100%** | §6.8 STÄNGD |
| Fas 7 (matching) | ~95% | **100%** | §7.7 STÄNGD |
| Fas 7.5 (RUT) | 80% | 80% | Avvaktar Sprint A+B Alt B legacy + jurist |
| Fas 8 (escrow) | ~95% | **~99%** | §8.22 KLAR. §8.23-25 kvar (chargeback + Klarna). |
| Fas 9 (VD-features) | ~50% | **~65%** | VD-payment-summary LIVE. §9.2/§9.9 mockups klara. |
| Fas 14 (legal-package) | 0% | **~30%** | Drafts + analyser klara, jurist-bedömning pending. |
| Hygien #48 | ~80% | **~95%** | #48.4 + #48.6 KLARA. |
| Item 1 BankID | 0% | **~95%** | Hela bygget klart. Aktivering pending jurist-OK. |
| Item 2 BankID-obligatorisk | 0% | **100%** | LIVE |
| N3 PNR-verifiering | 0% | **~25%** | Sprint 1 kod klar (migration pending). |

---

## 8. Obligatoriska regler #26-#32 — efterlevnad denna session

- **#26 Grep-före-edit:** ✅ Använd vid alla Edit-anrop (Read first → exakt str_replace)
- **#27 Scope-respekt:** ✅ Hybrid-utförare/förmedlare-tolkning rättad (Spick = utförare) efter Farhad-korrigering. Memory sparad.
- **#28 SSOT:** ✅ encryption.ts + terms-acceptance.ts + pnr-verification.ts centraliserade i `_shared/`
- **#29 Audit-först:** ✅ Solid Service team-readiness-audit läst innan rekommendation
- **#30 Inga regulator-claims:** ✅ Alla legal-docs är "data, inte juridik". Jurist-checklist + Farhad-frågor istället för antaganden. SMS-design §4 = data om moms/BokfL, inte tolkning.
- **#31 Primärkälla över memory:** ✅ Curl-verifierat schema 5+ gånger denna session. payout_audit_log.destination_account_id-misstag rättat via curl 42703. ratings.job_id (inte booking_id) rättat via migration-fil.
- **#32 Hook-enforcement:** ✅ Aktiv från `b0abaa9`. Hook fyrar vid varje `git commit*`-kommando.

**Nya regel-brott denna session:** 0. Tre §31-brott från föregående session var lärdom 2026-04-23.

---

## 9. Hur nästa session ska börja

1. **Kör startsekvensen från START_HERE.md** (läs sanning-filer, v3-progress, denna handoff)
2. **Läs denna handoff** (`docs/sessions/SESSION-HANDOFF_2026-04-26-massive-50-commits.md`)
3. **Verifiera prod-state med curl:**
   - `bookings.pnr_verification_method` → 42703 om migration §5.1 ej körd än
   - `public_stats` → ska returnera data (inte 42501)
   - `vd-payment-summary` EF → ska returnera 200
4. **Fråga Farhad om prio:**
   - N3 PNR Sprint 2-4 (kräver migration först)
   - SMS-saldo Sprint A+B (kräver Farhad-OK på design)
   - §9.2/§9.9/§3.8 frontend (kräver Farhad-OK på mockups)
   - Kalender F1+F3 (kräver Farhad-OK på design)
5. **Använd PreToolUse-hook:** vid varje commit påminns regel #26-#32 automatiskt

### 9.1 Memories att läsa innan beslut
- `project_rut_ombud_betydelse.md` — Spick = utförare, ansöker direkt från SKV (ej ombud)
- `feedback_validate_ui_before_backend.md` — UI-mockup först för >2h backend-jobb
- `feedback_handoff_status_unreliable.md` — verifiera schema/RPC/EF via curl INNAN bygge
- `project_bookings_schema_gotchas.md` — bookings.company_id + bookings.deleted_at FINNS INTE

---

## 10. Bonus — repo-state-stats (slut på session)

- **EFs:** 82 lokala (78 i CLAUDE.md, drift ~+4 från denna session)
- **Workflows:** 38 aktiva
- **Migrationer i repo:** N3 senast (`20260426100000_n3_pnr_verification_schema.sql`)
- **Tester:** _tests/pnr/pnr-verification.test.ts 18/18 PASS, terms-acceptance 13/13 PASS
- **Commits sedan föregående handoff:** 50 (38e4c97..0d37949)
- **Prod-incidenter denna session:** 0
- **Hook-fires:** Aktiv från `b0abaa9`. Fyrar vid varje commit (sparar oss från §26-§31-brott).

---

**Slut på handoff. Nästa session: börja med §9.**
