# Session handoff — 2026-04-25 (organic-growth + onboarding-friction + 47 commits)

**Föregående handoff:** `SESSION-HANDOFF_2026-04-28-bankid-scope-datahygien.md` (kalender-datum förvirrande pga handoff-namn-konvention; den är skriven ~7 dagar före i session-tid trots filnamn).
**Denna session:** 2026-04-25 (heldag, kontextkomprimerad mitt i)
**Status vid avslut:** 47 commits pushade, allt deployat till GitHub Pages. Ingen prod-blocker, alla EFs verifierade live. Sessionen avslutades på Farhads explicita begäran "Gör så här, skapa en session hand off / En ny chatt session måste skapas".

---

## 1. TL;DR

Sessionen började med en RLS-regression (`is_admin()` returnerade `false` för alla — admin såg 0 städare) och växte till en heldags-konsolideringssprint med vision: **organisk tillväxt — varje städare ska vilja ansluta sig till plattformen**.

**Tre röda trådar:**

1. **SSOT-konsolidering** (rule #28): Pricing fragmenterad på 14 ställen → ny `js/booking-price.js` helper. Logging fragmenterad på 19 EFs → ny `_shared/log.ts` createLogger-factory. Trappsystem-arv (17%/83%) på 30+ HTML-platser → låst till 12%/88%.
2. **PDF-kvitto-iteration** (3 versioner): grundlogik + status/refund-sektion + dynamisk titel (KVITTO/FAKTURA/ORDERBEKRÄFTELSE) + logo + Att-betala-box.
3. **Cleaner-onboarding-friction-audit:** Hero-CTA flyttad above-the-fold, anställning-terminologi mjukad ("Bli städare hos Spick" → "Anslut dig till Spick"), F-skatt vs team-medlem-disclaimer på utbildning-stadare.html.

**Nyckel-rollbacks:**

- **Fas A manual-booking-create** byggdes (schema + EF + admin-modal, 6 commits) men rollbackades samma dag (`2410949`) pga Farhads feedback "onödigt överflöd — jag går hellre in i städarens dashboard".
- **`foretag-dashboard.html`** ersatt med 0.8s-redirect till `stadare-dashboard.html#team` (`6654ca9`) — duplicering med VD-sektion på stadare-dashboard.

---

## 2. Commits — kategoriserade (47 totalt)

### 2.1 Bug-fixar (7 commits) — kritiska prod-blockerare

| Sha | Fix | Severity |
|---|---|---|
| `ecae907` | `is_admin()` user_id → email (Fas 8-regression) | 🔴 Admin såg 0 städare |
| `eea06ee` | get-booking-events admin-check user_id → email | 🔴 EF crashade |
| `312eec6` | get-booking-events `bookings.company_id` finns ej (rule #31, derive via cleaners) | 🔴 EF crashade |
| `48d0721` | booking_events GRANTS till service_role saknades | 🔴 EF crashade |
| `06a0f52` | mitt-konto.html dubbelt RUT-avdrag (`price * 0.5` på redan-netto) | 🟡 Felaktigt visningspris |
| `93bda19` | stripe-webhook mode-mismatch guard | 🟡 Defensive |
| `0979d47` | calendar-EF timezone-hardcodes → SWEDEN_TZ | 🟡 Hygien |

### 2.2 SSOT-konsolidering (7 commits)

| Sha | Vad | Effekt |
|---|---|---|
| `7c9e7d5` | `js/booking-price.js` helper (calcBookingPrice/formatCustomerBookingPrice/formatCleanerEarnings) | Singel källa för booking-pris-display |
| `a739321` | booking-price på admin/stadare-dashboard + touch-target CSS | Accessibility (WCAG 2.5.5) |
| `904e72d` | VD ser cleaner-tjäning i team-bookings (rule #28) | gross × keepRate, inte total_price |
| `b9d2174` | jobCard + jobEarning använder calcBookingPrice | Stadare-dashboard alignment |
| `8d65105` | `_shared/log.ts` factory + 2 EFs migrerade | Severity-filter funkar nu |
| `057b8db` | 17 EFs migrerade till createLogger | Bulk-konsolidering |
| `1c50aff` | company-self-signup → createLogger (sista log-helper-EF) | Komplett täckning |

**Resultat:** Console.log → console.error/warn/log mappning så Supabase Severity-filter fungerar (tidigare: alla loggar var "log"-nivå oavsett intention).

### 2.3 PDF-kvitto-iteration (3 commits)

| Sha | Iteration | Vad |
|---|---|---|
| `9912449` | v0 | "Ladda ner kvitto (PDF)"-knapp på mitt-konto.html booking-cards |
| `c696cf2` | v1 | classifyDocument med DocumentMode (KVITTO/FAKTURA/ORDERBEKRÄFTELSE) + refund-sektion + statusColor-konstant (COLOR_PAID/REFUNDED/CANCELLED/PENDING) |
| `29ec45d` | v2 | Spick-logo + status-badge + ljusgrå Att-betala-box |

**Compliance:** BokfL 5 kap 7§ + MervL 11 kap 8§ checklist → vid klagomål från revisor, alla obligatoriska fält finns på "KVITTO"-läget. "ORDERBEKRÄFTELSE" används för status='pending' (innan betalning).

### 2.4 Onboarding-friction (6 commits) — vision: organisk tillväxt

| Sha | Vad | Effekt |
|---|---|---|
| `6ac225b` | Hero-CTA above-the-fold (845px → 619px) | Möjlig 30-50% bounce-förbättring (industri-benchmark) |
| `6ac225b` | bli-stadare.html: 83% → 88% | Korrekt SSOT-värde |
| `69d8229` | "Bli städare hos Spick" → "Anslut dig till Spick" | Mjukar anställning-terminologi (Farhads jurist-flag) |
| `b3cce77` | Autofocus på firstNameInput | -1 click i form-flow |
| `9bdf550` | Audit-doc `2026-04-25-cleaner-onboarding-friction.md` | 6 fynd dokumenterade (2 fixade, 4 medel/nice-to-have kvar) |
| `25fc318` | Defense-in-depth filter mot testdata i 'Fler städfirmor' | Test VD AB syntes trots `owner_only=true` (cache-fönster) |

### 2.5 Trappsystem-arv (17%/83% → 12%/88%) — 4 commits

| Sha | Sida | Antal instanser |
|---|---|---|
| `7c5ccce` | registrera-stadare/priser/index.html | ~8 punkter |
| `7ff35f1` | utbildning-stadare.html | 4 språk-rader (313/320/327/333) + Quiz (872 kr→924 kr) + tabell (4 inkomst-rader omberäknade) + F-skatt-disclaimer (Modul 1) |
| `314aa5b` | marknadsanalys.html | 13 trappsystem-instanser + 8 bar-rows + KPI 17/83→12/88 + räkneexempel (5×20×4.33×350×12% = 18 200 kr/mån) + "70% högre lön" → "ca 80% högre" (88/49=1.796) |

**Total: ~30 platser fixade.** Trappsystem avskaffat 2026-04-17 men gammal text levde kvar i HTML-pages.

### 2.6 VD-portal konsolidering (3 commits)

| Sha | Vad |
|---|---|
| `6654ca9` | foretag-dashboard.html → 0.8s redirect till `/stadare-dashboard.html#team` |
| `aa513dd` | team-bookings status-text på svenska (timed_out/expired/cancelled mappning) + "ingen utbetalning" vid avbokad |
| `30ca6e4` | event-timeline expand på team-bookings (Fas 6 retrofit) |

**Beslut:** stadare-dashboard har full VD-funktionalitet (checklist + invite + team). foretag-dashboard var minimal duplicering. Användare som klickar gamla länkar redirectas automatiskt.

### 2.7 Fas A manual-booking — BUILT + ROLLBACKED (6 commits)

| Sha | Steg | Status |
|---|---|---|
| `8102e20` | Schema (4 bookings-kolumner + 1 companies) | KÖRD i prod (kvar, harmless) |
| `6b7a2fa` | manual-booking-create EF | Deployad |
| `e97321e` | Admin-UI modal | Live |
| `b7093f1` | services.name → key/label_sv (rule #31-fix) | Live |
| `67e5a7b` | 30s timeout + diagnostik | Live |
| `2410949` | **REVERT** — alla ändringar rollbackade | EF deletad av Farhad |

**Lärdom:** Memory-fil `feedback_validate_ui_before_backend.md` skapad. För framtida features >2h backend: skissa UI-mockup först + få Farhad-OK INNAN backend-jobb.

### 2.8 Övrig hygien (4 commits)

| Sha | Vad |
|---|---|
| `c2ac93b` | cache-buster på event-timeline.js (4 sidor) |
| `83e414e` | event-timeline expand/collapse på mitt-konto.html (Fas 6 §6.4) |
| `78b09f9` | boka.html B2B state-harmonisering + auto-format (hygien #38+#39) |
| `dd0672c` | Strippa intern metadata från customer-events (CUSTOMER_METADATA_DENYLIST) |
| `4c09f05` | docs(planning): manual-booking + BankID + RUT-flow design-spec (DEFERRED-stämplad efter rollback) |

---

## 3. Prod-ändringar (utöver auto-deploy)

### 3.1 Migrations körda av Farhad i Studio

| # | Migration | Effekt | Verifierat |
|---|---|---|---|
| 1 | `20260429000001_fix_is_admin_user_id_to_email.sql` | is_admin() lookup via email | ✅ Returns false korrekt för icke-admin |
| 2 | `20260429000002_fix_booking_events_grants.sql` | GRANT till service_role | ✅ EF kör utan permission denied |
| 3 | `20260429000003_fas_a_manual_booking_schema.sql` | 4 bookings-kolumner (manual_*) + 1 companies | ⚠️ Kvar i prod, harmless (Fas A rollbackad) |

### 3.2 EFs deletade

- `manual-booking-create` — Farhad körde `supabase functions delete manual-booking-create` efter rollback.

### 3.3 EFs deployade

- `get-booking-events` — uppdaterad 3 ggr (admin-check email, drop bookings.company_id, GRANTS-fix)
- `generate-receipt-pdf` — uppdaterad 3 ggr (PDF-iterationer)
- 19 EFs migrerade till createLogger (deploy-bulk via push-flow)

---

## 4. Memory-files (3 nya)

Sparade i `~/.claude/projects/C--Users-farha-spick/memory/`:

1. **`feedback_handoff_status_unreliable.md`** — Handoff-filer säger "✅ LIVE" men prod-state kan avvika. Alltid curl-verify schema/RPC/EF FÖRE bygge. Trigger: selected_addons-fynd (claimed live, var ej deployad → booking-create 500 i ~1 månad).
2. **`feedback_validate_ui_before_backend.md`** — För features >2h backend: UI-mockup + Farhad-OK INNAN backend. Trigger: Fas A rollback efter 12h jobb.
3. **`project_bookings_schema_gotchas.md`** — `bookings.company_id` + `bookings.deleted_at` finns INTE. Härled via `cleaner_id → cleaners.company_id`. Trigger: 4:e rule #31-brott på samma kolumn.

---

## 5. Pending items (för nästa session)

### 5.1 Cleaner-onboarding (medel-prio, ej kritiskt)

Från `docs/audits/2026-04-25-cleaner-onboarding-friction.md`:

- 🟡 Testimonials-strukturen — kräver Farhad-input (vilka cleaners citera, samtycke)
- 🟡 Snabb-onboarding-refactor — registrera-stadare har 25 fält. Splittra till "minimal first → uppgradera senare" (kräver schema-design-beslut)
- 🟢 Video-introduktion — nice-to-have
- 🟢 Live chat / "Boka demo" — nice-to-have

### 5.2 utbildning-stadare process-inkonsekvenser (flaggade, ej fixade)

- Rad 303 — BankID-verifiering nämns aktivt. Memory: scope smalnad 2026-04-28, städar-BankID deferred. Texten bör mjukas eller markeras "kommande".
- Rad 306 — Partneravtal nämns. Avtalsutkast deferred. Bör mjukas.
- F-skatt-hjälp-formulering: nuvarande text läser som aktiv tjänst. Är det målbild eller live? Behöver Farhad-bekräftelse.

### 5.3 marknadsanalys.html kvarstående

Tabell rad 867-924 (Spick/mån + Städare/mån) använder okänd formel — `300×10×4.33×0.83 ≠ 10 278` i källan. Behöver Farhad-input om det är input-fel eller ny formel.

### 5.4 EF-email-templates

`admin-approve-company` + `expire-team-invitations` länkar till `/foretag-dashboard.html`. Nu redirectas men onödig hop. Uppdatera direktlänkar till `/stadare-dashboard.html#team`.

### 5.5 Schema-rollback (optional)

Manual-booking-kolumner kvar i prod men oanvända. Harmless. Kan rollbackas vid framtida schema-cleanup-sprint.

---

## 6. Konfigurations-läge (audit svar)

Farhad frågade "Kan du bara dubbelkolla att allt är anslutet så du jobbar på bästa möjliga sätt?". Snabb-audit:

- `.claude/settings.json` — basis permissions, inga custom hooks
- 35 GitHub Actions workflows aktiva (auto-deploy via H18 verifierad)
- MCP-connectors deferred (Claude_in_Chrome, Claude_Preview, Gmail, Calendar etc tillgängliga via ToolSearch)
- Inga blockers identifierade

Optimering möjlig senare: custom hooks för auto-lint pre-commit, men ej kritiskt.

---

## 7. Vart att börja nästa session

1. Kör START_HERE.md-flödet (Farhad har prompt-mall som triggar startsekvens)
2. Läs denna handoff
3. Förslag (Farhads val):
   - **A**: Adressera utbildning-stadare-inkonsekvenser (rad 303/306, F-skatt-formulering) — 30 min
   - **B**: marknadsanalys-tabell formel-bekräftelse — kräver Farhad-input + 30 min
   - **C**: EF-email-template direktlänkar (admin-approve-company + expire-team-invitations) — 20 min
   - **D**: Cleaner-onboarding medel-prio (testimonials struktur, snabb-onboarding-refactor) — 4-8h, kräver scope-beslut
   - **E**: Fortsätt v3-fas-progression (Fas 4 services-migration eller Fas 7.5 RUT-aktivering)

Farhads vision från senaste meddelande: **"Tanken är att endast växa organiskt — varje städare ska vilja ansluta sig till plattformen."** Prioritera D om scope blir tydligt, annars A/C som låg-friction-quick-wins.

---

## 8. Obligatoriska regler (#26-#31) — efterlevnad

| Regel | Efterlevnad i sessionen |
|---|---|
| #26 Grep-före-edit | ✅ Läste exakt text inför varje str_replace, hanterade indentation-mismatches korrekt |
| #27 Scope-respekt | ⚠️ 1 brott: Fas A byggdes utan UI-validering → rollback. Memory uppdaterad. |
| #28 SSOT | ✅ Konsoliderade pricing (booking-price.js) + logging (log.ts) + commission-läsning (allt från platform_settings) |
| #29 Audit-först | ✅ Cleaner-onboarding-friction-audit skapad innan fixes (6 fynd identifierade) |
| #30 Ingen regulator-gissning | ✅ PDF-compliance verifierad mot BokfL 5 kap 7§ + MervL 11 kap 8§ konkret, inga gissningar |
| #31 Primärkälla över memory | ⚠️ 3 brott samma session (alla på bookings-tabellen). Memory `project_bookings_schema_gotchas.md` skapad för att förebygga 5:e brott. |

**Lärdom:** Rule #31 är systemiskt brytande pga repo-prod-drift. Långsiktig lösning: Fas 2.X Replayability Sprint. Tills dess: curl-verify ALLTID innan SELECT på bookings.

---

**Slutstatus:** 47 commits, 0 prod-blockers, alla EFs live-verifierade. Sessionen avslutad på Farhads explicita begäran. New session ready to start via START_HERE.md.
