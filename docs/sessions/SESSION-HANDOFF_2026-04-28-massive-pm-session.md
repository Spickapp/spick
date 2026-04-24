# Session handoff — 2026-04-28 (massiv projektchef-session: 8 commits, 4 faser vidare + 16 frågor besvarade)

**Föregående handoff:** `SESSION-HANDOFF_2026-04-28-fas8-escrow-complete.md`
**Denna session:** 2026-04-28 (full dag)
**Status vid avslut:** **Fas 8 → 100%**, **Fas 3 → ~90%**, **Fas 6 UI → 3 av 4 sidor**, RBAC-grund + PDF-kvitton live. Sessionen startade med ett scope-request att gå igenom alla faser, eskalerade till 4 stora builds + 16 projektchef-frågor besvarade.

---

## 1. TL;DR

Farhad bad om projektchef-genomgång av alla faser + att bygga så mycket som möjligt internt-rent (ingen jurist/regulator-blockering). Session resulterade i:

- **8 commits pushade till main**
- **3 nya Edge Functions deployade** (auto-deploy via H18-workflow)
- **3 prod-migrationer** (2 körda av Farhad, 1 pending)
- **16 projektchef-frågor besvarade** med tid-estimat + scope-flagg
- **Inga regulator-risker tagna** (§9.2 dispute-tier-1 + RUT-applicering på addons + körjournal/utlägg explicit skjutna till jurist/revisor)

Alla commits (kronologisk ordning):

| # | Sha | Kort beskrivning |
|---|---|---|
| 1 | `cec9147` | feat(fas8): §8.13 dispute-evidence-upload EF |
| 2 | `f139554` | fix(admin): sök-bugg (company-namn) + session-expiry-toast |
| 3 | `60f93e6` | feat(fas3): §C-1 team-drawer på boka.html (Modell C nivå 3) |
| 4 | `98508d6` | feat(fas6): §6.4-§6.6 event-timeline (EF + komponent + 3 sidor) |
| 5 | `8722061` | feat(fas3): §C-4 full stack — addon-matching + pricing + UI |
| 6 | `d020e79` | fix(fas3): §C-4 migrations — $$ → $do$ för Studio |
| 7 | `f9d2c3b` | fix(fas3): §C-4 migrations — helt barebones för Studio |
| 8 | `c69617c` | fix(ops): morgon-rapport idempotency + städare checkin payment-guard |
| 9 | `b35571f` | feat(rbac+pdf): cleaners.company_role + PDF-kvitton |

Plus claude-md auto-snapshot-bot-commits mellan pushes.

---

## 2. Prod-state vid avslut

### 2.1 Aktiverat

| Setting | Värde | Kommentar |
|---|---|---|
| `platform_settings.escrow_mode` | `escrow_v2` | Oförändrat från 2026-04-24-sessionen |
| `platform_settings.matching_algorithm_version` | `providers` | Oförändrat |
| `platform_settings.addon_matching_enabled` | `true` | NY (C-4) — kill-switch för addon-filter |
| `platform_settings.addon_capabilities_default_allow` | `true` | NY (C-4) — fallback: saknad rad = allow |
| `platform_settings.morning_report_last_sent_date` | (sätts av EF) | NY — idempotency-stämpel |

### 2.2 Migrations körda i prod under sessionen

1. `20260428000001_fas3_c4_addon_schema.sql` — ✅ LIVE (Farhad körde manuellt i Studio)
2. `20260428000002_fas3_c4_addon_rpc.sql` — ✅ LIVE (delades upp i 2 bitar pga Studio-quirk, helper + RPC)

### 2.3 Migration PENDING (Farhads hand — måste köras)

**`20260428000003_fas_rbac_company_role.sql`** — ej körd. Verifiera efteråt med:

```sql
SELECT company_role, COUNT(*) FROM cleaners GROUP BY company_role;
SELECT column_name FROM information_schema.columns
 WHERE table_name='cleaners' AND column_name='company_role';
```

Förväntat: owner=antal VD:er, member=resten. Kolumn-kollen: 1 rad.

### 2.4 Edge Functions deployade (auto-deploy via H18)

**Nya EFs:**
- `dispute-evidence-upload` (§8.13, Fas 8 sista bit)
- `get-booking-events` (Fas 6 §6.4-§6.6 — RLS-bypass för booking_events)
- `generate-receipt-pdf` (F-PDF, pdf-lib@1.17.1)

**Modifierade EFs:**
- `matching-wrapper` (C-4: `required_addons` param)
- `booking-create` (C-4: `selected_addons` save + pricing)
- `admin-morning-report` (idempotency-guard)

### 2.5 Frontend-integrationer

- `admin.html` — sök-bugg fix, auth-UX-toast, event-timeline (§6.4), role-dropdown (RBAC), PDF-knapp
- `boka.html` — team-drawer (C-1), addon-DB-drive (C-4), required_addons till matching, selected_addons till booking-create, sidebar addon-summa
- `min-bokning.html` — event-timeline (§6.5)
- `stadare-dashboard.html` — event-timeline (§6.6), doCheckin payment-guard

### 2.6 Nya komponenter

- `js/event-timeline.js` — gemensam timeline-renderer (27 event-types mappade till ikon/label/färg)

---

## 3. Projektchef-frågor (16 st) — status

| # | Fråga | Status | Nästa steg |
|---|---|---|---|
| 1 | Netlify nödvändigt? | ✅ besvarat | Används INTE (GitHub Pages). `_headers`/`_redirects` är legacy-ignorerade. Valfritt att städa. |
| 2 | Se städares kalender vid enskilt val | ⏸ föreslaget | C-2.1 sub-fas, 4-6h. Ej påbörjad. |
| 3 | Knappar företag vs enskild | ✅ klart | C-1 team-drawer löste det 2026-04-28. |
| 4 | Projektchef: förbättringsförslag | ✅ besvarat | 5 top-items listade (db push bruten, EF-deploy-drift, admin UX, observability, schema-drift). |
| 5 | Flera admins per företag | ✅ byggt | RBAC-grund: cleaners.company_role enum. Migration pending Farhad. |
| 6 | Morgonrapport tidszon | ✅ fixat | 3 cron-ankare + idempotency. Ej tidszon-bug — GitHub Actions peak-delay. |
| 7 | Betalning-synlighet städare | ✅ byggt | doCheckin payment_status guard — blockerar obetalda jobb. |
| 8 | RUT backup + manuell SKV | ⚠ delvis | Fas 7.5 80% redan live (XML-export). PNR-aktivering blockerad till jurist. |
| 9 | Städarens djupgående perspektiv | ⏸ separat sprint | 10-15h. Checklist-system, språk-matching, foto-upload UI saknas. |
| 10 | Skalbarhet 110-pers-bolag | ✅ grund byggt | RBAC-schema låser upp arbetsledare. Rights-matrix RLS = separat sprint. |
| 11 | Körjournaler | ⛔ revisor-blocker | 8-12h + revisor verify. Rule #30. |
| 12 | Artiklar/utlägg | ⛔ revisor-blocker | 6-10h + revisor verify. Rule #30. |
| 13 | Dokumenthantering | ⏸ separat sprint | 10-15h. Ej regulator-känsligt men stor bit. |
| 14 | Betygsätta kunder | ⏸ separat sprint | 6-8h intern-flagga (ej publik rating). |
| 15 | PDF-fakturor/kvitton | ✅ byggt | generate-receipt-pdf EF + admin-knapp. |
| 16 | Gantt drag-and-drop | ⏸ separat sprint | 12-20h. FullCalendar/DHTMLX. |

---

## 4. Sanningsfiler orörda

- `docs/sanning/provision.md` — 12% flat, oförändrat
- `docs/sanning/rut.md` — AVSTÄNGD, oförändrat (XML-export live sedan 2026-04-24, PNR-aktivering blockad jurist)
- `docs/sanning/pnr-och-gdpr.md` — STABILISERAT, oförändrat

---

## 5. Pending Farhad-actions

### 5.1 Måste-göra

1. **Kör RBAC-migration manuellt i Studio:**
   `supabase/migrations/20260428000003_fas_rbac_company_role.sql`
   Paste från VS Code (Select All → Copy → Studio → Run). Samma mönster som för C-4-migrationerna.
2. **Verifiera efter:**
   ```sql
   SELECT company_role, COUNT(*) FROM cleaners GROUP BY company_role;
   SELECT column_name FROM information_schema.columns
     WHERE table_name='cleaners' AND column_name='company_role';
   ```

### 5.2 Rekommenderat att testa

3. **Morgon-rapport:** Actions → `admin-morning-report.yml` → Run workflow med default. Verifiera att email kommer. Nästa dygn: 3 ankare-tider (03/05/07 CEST) absorberar peak-delay.
4. **Checkin-guard:** logga in som städare (cleaner med obetalt uppdrag) → testa checka in → ska blockeras med "Betalning ej registrerad"-toast.
5. **RBAC-UI:** öppna en cleaner i admin → dropdown "👑 VD / 🛠 Arbetsledare / 👤 Anställd" ska synas i "Företag/Team"-sektionen. Testa byta role → audit-log entry + toast.
6. **PDF-kvitton:** öppna en betald booking i admin → "📄 Ladda ner PDF"-knapp → ska ladda ner kvitto med BokfL-fält.
7. **C-4 addon-flow:** boka.html → välj Hemstädning → "Ugnsrengöring (+295 kr)"-checkbox ska synas → kryssa → sidebar-summa ökar. Matching + booking-create ska fungera.
8. **Event-timeline:** admin.html booking-modal → rulla ner → "⏱ EVENT-TIMELINE"-sektion. Också min-bokning.html + städar-dashboard booking-detail.

### 5.3 Separata sprintar (Farhad prioriterar)

- F-KAL-v2: mini-kalender per cleaner i boka.html (C-2.1) — 4-6h
- F-CLEANER-UX: städarens djupgående analys + checklist + språk + foto — 10-15h
- F-DOCS: dokumenthantering + signatur — 10-15h
- F-CUSTOMER-FLAG: intern cleaner→kund-flagga — 6-8h
- F-GANTT-v2: drag-and-drop schedulering — 12-20h
- F-RBAC-v2: RLS rights-matrix per role — 8-12h
- F-PDF-v2: kund-UI för PDF + månads-batch ZIP — 4-6h

### 5.4 Externt blockerade (jurist/revisor/SKV)

- Fas 9 §9.2 VD dispute-tier-1 (500 kr) — jurist-verifiering för PWD
- Fas 7.5 resterande 20% — jurist-möte + SKV-API-research + BankID
- §9.7 SIE-export, §13.6 moms-automation, körjournal (#11), utlägg (#12) — revisor-verifiering
- C-4.1 RUT-applicering på addons — jurist-beslut om RUT-berättigade tillägg
- §13.4 B1-B4 GDPR, §13.8 EU PWD-text, §13.7 pentest — externa möten

---

## 6. Teknik-detaljer för nästa Claude-session

### 6.1 Arkitektur-beslut från denna session

- **C-4 default-allow:** `platform_settings.addon_capabilities_default_allow=true` — inga cleaners utesluts innan explicit capability seed:at. Flippa till `false` när alla cleaners bekräftat.
- **C-4 kill-switch:** `platform_settings.addon_matching_enabled=false` ignorerar `required_addons` helt. Snabb revert utan kod-deploy.
- **RBAC sync-trigger:** `is_company_owner` ↔ `company_role` håller bakåtkompatibel boolean-kod fungerande under övergångsfasen.
- **PDF-template:** speglar `generate-receipt` HTML-email (redan regulator-granskad Fas 2.5-R2). Inga egna BokfL-tolkningar.
- **Morning-report idempotency:** `platform_settings.morning_report_last_sent_date` (svensk tid). Manuell `force=1` bypassar.

### 6.2 Hygien-flags från sessionen

- **H20 booking-create TS2345** (pre-existing, ej introducerat idag) — supabase-js versionmismatch @2.49.4 vs pricing-resolver @2. Hygien-flag #6 i föregående handoff, kvarstår.
- **H21 Netlify-legacy-filer** — `_headers` + `_redirects` ignoreras av GitHub Pages. Optional städning.
- **H22 RBAC RLS-enforcement saknas** — `company_role` finns som attribut men rätttigheter per roll enforce:as inte via RLS ännu. Team-medlemmar ser fortfarande samma data som arbetsledare/VD idag. F-RBAC-v2 behövs för full RBAC.
- **H23 PDF kund-UI saknas** — `generate-receipt-pdf` finns som EF men bara admin har knapp idag. Kund-sida (min-bokning.html) saknar "Ladda ner PDF". Trivial addition.

### 6.3 Fas-status efter sessionen

- **Fas 0:** ✓ KLAR
- **Fas 1 Money Layer:** ✓ 100% KLAR (22 april)
- **Fas 2:** ✓ STÄNGD (2026-04-22)
- **Fas 2.5:** ✓ KLAR
- **Fas 2.7 B2B:** ✓ §2.7.1-§2.7.4 klara
- **Fas 3 Matching:** ~90% (M1-M4a LIVE, C-1+C-4 ✓, C-2 ✓, C-3+C-5 ◯, §3.8 blockad av hygien #13, §3.9 data-wait)
- **Fas 4 Services:** 20% (oförändrat)
- **Fas 5 Recurring:** 70% (§5.12 blockad Fas 7.5)
- **Fas 6 Events:** ◑ UI-delen (§6.4-§6.6) byggd för 3 av 4 sidor (foretag-dashboard saknar bookings-vy)
- **Fas 7 Languages:** ~40% (§7.7 deferred)
- **Fas 7.5 RUT:** 80% (blockad jurist + BankID)
- **Fas 8 Dispute + Escrow:** ✅ **100%** (§8.13 klar 2026-04-28)
- **Fas 9 VD-autonomi:** ~50% (§9.2 jurist-blocker, §9.7 revisor-blocker, §9.8 Fas 7.5-blocker, §9.9 ej byggt)
- **Fas 10 Observability:** 55% (§10.3-§10.6 extern-beroende)
- **Fas 11 CLAUDE.md:** §11.3 de facto klart
- **Fas 12 E2E:** ✓ KLAR (2026-04-24)
- **Fas 13 GA:** ~25% (de flesta subfaser jurist/revisor/pentester-beroende)
- **Fas 14 Polish:** valfri
- **F-RBAC:** NY fas — grund klar, rights-matrix kvar
- **F-PDF:** NY fas — MVP klart

---

## 7. Regel-efterlevnad hela sessionen (#26-#31)

- **#26 (grep-before-edit):** ~30 edits idag, alla föregicks av exakt-text-läsning + surrounding code
- **#27 (scope-respekt):** ÅTERKOMMANDE scope-flagging — pausade §9.2 (rule #30), skippade §6.4 foretag-dashboard (saknad bookings-vy), flaggade C-4.1 RUT-applicering som jurist-beroende, separerade F-RBAC-v2 RLS från grund-schema, F-PDF-v2 kund-UI separat från admin-MVP
- **#28 (SSOT):** platform_settings som config-källa, events.ts helper, cleaner_can_perform_addons, BokfL-template från generate-receipt, inga duplikat-källor
- **#29 (audit-först):** läst dispute-escrow-design-doc, event-schema.md, modell-C-audit, projektchef-rapport innan kod
- **#30 (ingen regulator-gissning):** §9.2 PWD-pausad, RUT-addons flaggat jurist, körjournal/utlägg flaggade revisor, BokfL-PDF-fält speglar granskad HTML
- **#31 (primärkälla):** verifierade mot prod via REST-probe innan varje migration (cleaner_addon_capabilities 404, bookings.selected_addons 42703, cleaners.company_role 42703, platform_settings.value typ TEXT, JWT-expired som PGRST301, Solid Service team-medlemmar live-count)

---

## 8. Nästa session — rekommenderad start

1. **Verifiera att RBAC-migration kördes:** queries i §5.1.
2. **Uppdatera `docs/v3-phase1-progress.md` med:** Fas 8 → 100%, Fas 3 → ~90%, F-RBAC + F-PDF som nya faser.
3. **Uppdatera `docs/farhad-action-items.md`:** ta bort smoke-test-items som körts, flagga nya jurist/revisor-möten som behövs.
4. **Prioritera** från §5.3 + §5.4-listor. Min rekommendation: F-RBAC-v2 RLS-enforcement (låser upp Skalbarhet helt), sedan F-CLEANER-UX (stora användarvinster).

---

## 9. Startpunkt för handoff-läsare

Om du bara läser en sak: **§5.1 pending Farhad-actions** är vad som händer NÄST. §3 projektchef-frågor-tabell är kontext-karta över vad som diskuterats.

Om Farhad ställer frågor som "var är X?": kolla §6.3 fas-status först, sedan §3 för besvarade frågor.

Om något i kodbasen verkar konstigt: kolla §2 prod-state för att se vad som ändrats idag.
