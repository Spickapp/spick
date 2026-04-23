# TODO: VD-workflows i foretag-dashboard (prissättning + kalenderblockering)

**Skapad:** 2026-04-23 (sprint Fas 1/2 kontor-formelfix + Begär offert-banner)
**Primärkälla-verifiering:** prod-schema.sql (dumpad 2026-04-22) + stadare-dashboard.html source

## Bakgrund

Under session 2026-04-23 levererades P2 (foretag-dashboard kvick-nav → stadare-dashboard#team / #kalender via hash) + Fas 1/2 kontor-formelfix. **P1 (VD spärrar datum för team-medlem) pausades pga schema-drift och RLS-blockers identifierade i prod-schema.**

Denna fil samlar alla flaggade-men-ej-byggda punkter från sessionen så inget glöms bort.

## Prioriteringslista

### P1 — VD spärra team-medlems datum (PAUSAD, kräver backend-arbete)

**Status:** Blockerat av RLS + VIEW-drift i prod. UI-only räcker inte.

**Fynd (regel #31 primärkälla-verifiering mot prod-schema.sql):**

1. `cleaner_blocked_dates` är en **VIEW** i prod ([rad 1766](../../prod-schema.sql)), inte en tabell. Pekar på `blocked_times`.
2. Ingen INSTEAD OF-trigger hittad i prod-schema → befintlig [addBlockedDate()](../../stadare-dashboard.html:5795) som kör `R.insert('cleaner_blocked_dates', ...)` kan vara **latent trasig i prod** för städarens egen spärring. Behöver verifieras.
3. RLS på `blocked_times`: `Auth inserts blocked_times` ([rad 4602](../../prod-schema.sql)) WITH CHECK kräver `cleaner_id IN (SELECT cleaners.id WHERE auth_user_id = auth.uid())`. **VD kan inte INSERT för team-medlems cleaner_id.**
4. `GRANT SELECT, INSERT` till authenticated på blocked_times ([rad 5688](../../prod-schema.sql)) — saknar DELETE-grant för authenticated.

**Åtgärdssteg:**

- [ ] **Steg 1: Verifiera prod-beteende för nuvarande addBlockedDate().**
  - Farhad eller dev loggar in som städare (solo), öppnar stadare-dashboard → Instill → "Spärrade datum" → lägg in testdatum.
  - Check: får bokare 200 OK (rad skapad i blocked_times) eller felkod? Kolla Network-tab + `SELECT * FROM blocked_times WHERE cleaner_id = X AND blocked_date = Y` i Studio.
  - Om trasig → fix som egen hotfix (INSTEAD OF-trigger på viewn ELLER ändra R.insert till `blocked_times`-tabellen direkt).

- [ ] **Steg 2: SQL-migration för VD-team-manage-policy.**
  - Ny policy på `blocked_times`: authenticated kan INSERT/UPDATE/DELETE för cleaner_id där cleaner tillhör samma company_id som VD (inloggad user med is_company_owner=true).
  - Ny GRANT: `GRANT DELETE ON blocked_times TO authenticated` (för VD + städare själv).
  - Reviewa existing "Cleaner sees own blocked"-policy ([rad 4730](../../prod-schema.sql)) — utvidga eller addera parallell.

- [ ] **Steg 3: UI i team-modal (stadare-dashboard).**
  - Lägg `<input type="date" id="team-block-date">` + `<div id="team-blocked-list">` efter schedule-sektionen (rad ~2111).
  - Ny function `loadTeamMemberBlockedDates(memberId)`, `addTeamMemberBlockedDate(memberId)`, `removeTeamMemberBlockedDate(id)`.
  - Kalla `loadTeamMemberBlockedDates(memberId)` i [openTeamEditModal](../../stadare-dashboard.html:8460).

**Alternativ väg (om policy-ändring blir för risky):**
- Edge Function `block-team-member-date` med service_role + application-layer-check att caller är VD + member tillhör samma company_id.
- Mer kod men säkrare sikkerhetsmodell.

**Uppskattning:** 4-6h (EF-väg) eller 2-3h (SQL-policy-väg + UI).

---

### P3 — company_service_prices self-service UI (när use_company_pricing=true)

**Kontext:** 3-lager-pricing: `cleaners.hourly_rate` → `cleaner_service_prices` → `company_service_prices` (aktiverad när `companies.use_company_pricing=true`). Idag har bara lager 1+2 UI. Lager 3 kräver admin eller SQL.

**Blocker:** Per [docs/1-MASTERKONTEXT.md:229](../1-MASTERKONTEXT.md) — `booking-create` ignorerar `use_company_pricing` pre-Dag 2. Att bygga UI för lager 3 innan booking-create fixats ger data-inkonsistens (DB-pris ≠ Stripe-amount).

**Åtgärdssteg:**

- [ ] Först: `booking-create` Dag 2-fix (3-lagers-pricing läses korrekt). Se [docs/3-TODOLIST-v2.md:12](../3-TODOLIST-v2.md).
- [ ] Efter Dag 2: ny sektion i foretag-dashboard (eller ny sv-subview i stadare-dashboard) för att sätta `company_service_prices` per tjänst. Visa tydligt att detta är "företagsgemensamt pris" som overrider individuella priser.
- [ ] Toggle för `companies.use_company_pricing` i samma sektion.

**Uppskattning:** 3-5h efter Dag 2-fix är deployad.

---

### P4 — Strategisk: varför två VD-dashboards?

**Problem:** Foretag-dashboard (480 rader, onboarding + invite) vs stadare-dashboard (10141 rader, full team-management för VD). Namngivning missvisande (stadare-dashboard är där VD gör sitt jobb).

**Alternativ:**
- A: Slå ihop — gör foretag-dashboard till redirect + deprecate
- B: Dela upp klarare — foretag-dashboard blir "Ägar-view" (fakturor, stats, strategi), stadare-dashboard blir "Operativ" (team, kalender, priser)
- C: Fortsätt som idag men med tydlig labeling

**Beslut behövs av Farhad.** Ej tidsuppskattat.

---

### Flaggade hygien-tasks från kontor-pricing-research (offerta.se + agent)

Dessa påverkar prisprecision men blockerar inte nuvarande funktionalitet.

- [ ] **Glasytor-tillägg.** Kontor har 3-5× mer glas än bostad (konferensrum, entrépartier). Offerta: +15-30 kr/kvm tilläggs-fönsterputs. Bör hanteras som separat tjänst eller tillägg per m² glas.
- [ ] **Toalett/pentry-tillägg.** Skalas inte linjärt med kvm. Ett 600 kvm öppet kontor med 2 toaletter ≠ 600 kvm cellkontor med 8 toaletter. Fast pris per toalett/pentry utöver kvm-formel.
- [ ] **Heltäckningsmatta +20-40% tid.** Golvtyp är input som påverkar tid. Kräver dropdown i boka.html.
- [ ] **Kvällstillägg (+15-25% efter 17:00).** Kontorsstäd sker ofta kvällar. Kristallrent: 290 → 370 kr (27% upp). Relaterat till `time_premium_percent` i pricing-engine.
- [ ] **Trappstäd/Vårdstäd/Skolstäd/Hotell — specialformler saknas.** Nuvarande calcHours() har ingen kontor-specifik multiplier för dessa tjänster; de går genom generella bostads-formeln när customerType=foretag.
  - Flaggat i [boka.html:1366-1375](../../boka.html) — Fas 1-commit 2026-04-23 `1d1a12c`.
- [ ] **Rate-arkitektur mismatch.** Branschen tar 30-60 kr/kvm för storstäd. Spick vid 400 kr/h × 8h för 600 kvm = ~5.3 kr/kvm — **83% lägre än bransch**. Arkitekturfråga (overhead/marknadsvinst vs pure tim-pris). Kräver strategiskt beslut av Farhad om prismodell.

---

### Fas 2+ flaggat (team-kapacitetsmatchning)

Efter Fas 1-formelfix är de flesta företagsjobb ≤8h → solo klarar. Fas 2-banner (commit `4bac5ce`) fångar stora uppdrag via mailto. Men full team-matchning är nästa nivå.

- [ ] **Team-kapacitetsmatchning i find_nearby_providers RPC.** Returnera `team_capacity_per_day = team_size × max_hours_per_day` per provider. Kräver prod-schema-verifiering först.
- [ ] **Team-slot-aware kalender.** getAvailableSlots() i boka.html multiplicerar tillgänglig tid med team_size. Visar "4 städare parallellt · 8h kalendertid" för 32h-jobb.
- [ ] **`max_hours_per_day` per cleaner (prod-schema).** Idag hardcoded 8h i min Fas 2-tröskel. Affärsbeslut + Arbetstidslagen-bedömning krävs (regel #30 — ej gissat). Kolumn på cleaners eller companies, eller platform_settings-default + per-cleaner-override.
- [ ] **Cleaner-list-badges för kapacitet.** I renderCleaners: solo + hours>solo-cap → "Behöver team", company team_size × 8 >= hours → "✓ Team klarar på Yh kalendertid". Mindre värde efter Fas 1/2, men bra user-info.

**Uppskattning Fas 3 (alla ovan):** 8-14h + prod-schema-migration + RPC-rewrite.

---

## Relaterade dokument

- [CLAUDE.md](../../CLAUDE.md) — projekt-kontext
- [docs/sanning/provision.md](../sanning/provision.md) — provisions-sanning
- [docs/architecture/matching-algorithm.md](../architecture/matching-algorithm.md) — Modell B/C-ramverk
- [docs/sessions/SESSION-HANDOFF_2026-04-27-c2-m4b.md](../sessions/SESSION-HANDOFF_2026-04-27-c2-m4b.md) — föregående handoff
- Commits 2026-04-23:
  - `1d1a12c` — Fas 1: kontor-formel + husdjur dölj
  - `5f77738` — flyttstäd-multiplier 2.0→2.2 efter bransch-research
  - `4bac5ce` — Fas 2: Begär offert-banner (>8h)
  - (denna session) — P2: foretag-dashboard kvick-nav med djup-länkar till stadare-dashboard#team/#kalender

## Regel-efterlevnad vid skrivning av denna fil

- **#26** grep-före-edit — läst exakta rader i prod-schema.sql + stadare-dashboard.html
- **#27** scope-respekt — P1 pausad när scope visat sig större än beställt
- **#28** single source of truth — identifierar fragmentering (3-lagers-pricing utan full UI-täckning)
- **#29** audit-först — läst saveProfile, updateTeamMember, loadTeamMemberSchedule, addBlockedDate, prod RLS-policies innan beslut
- **#30** regulator-gissning — max_hours_per_day markerat som affärs/arbetsrätt-beslut, ej gissat
- **#31** primärkälla över memory — fynd baserade på prod-schema.sql (dumpad 2026-04-22) + läsning av befintlig kod. **Flagga:** denna todo förlitar sig på prod-schema.sql-snapshot; innan implementation ska färsk `information_schema`-query verifiera att state inte ändrats sedan 2026-04-22.
