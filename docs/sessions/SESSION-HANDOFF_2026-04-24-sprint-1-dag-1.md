# Session handoff — Sprint 1 Dag 1 (24 april 2026)

**Föregående session:** 23 april kväll (commit `4400245`).
**Denna session:** Sprint 1 Dag 1 — stabilisering före skalning.
**Status vid avslut:** PNR-fält avstängt i kod. Två manuella Studio-steg väntar på Farhad.

---

## Strategisk kontext

Farhads mål: "Tusentals bokningar per dag, så automatiserat som möjligt, marknadsdominans".
V3-planen siktade på 1500/månad (~50/dag). Målet är 20-60× större.

Accepterad 8-sprint-plan (2026-04-24):
1. **Sprint 1 (denna vecka):** STABILISERING — stoppa aktiva läckor innan skalning
2. Sprint 2 (2-3v): Fas 3 Matching klart
3. Sprint 3 (3-4v): Fas 6 Events + Fas 7.5 RUT parallellt
4. Sprint 4 (2v): Fas 5 Retention/Recurring
5. Sprint 5 (6-8v): Fas 8 Dispute + Full Escrow (EU-deadline 2 dec 2026)
6. Sprint 6 (4-5v): Fas 9 VD-autonomi + Fas 10 Observability parallellt
7. Sprint 7 (3-4v): **NY** — Tusentals-bokningar-härdning (rate limiting, cache, load-test, idempotency)
8. Sprint 8 (resterande): Fas 4/12/13 polish + GA

Detta avviker från v3: ny Sprint 7, Fas 4 skjuts bakåt, Fas 7/11 skjuts till sidospår.

---

## Vad som gjordes idag (2026-04-24)

### 1. PNR-fält avstängt i boka.html ✅

**Varför:** GDPR-fynd från 23 apr — 11 klartext-PNR från 3 riktiga kunder ackumulerade i prod trots löfte om kryptering. Utan fix = fortsatt ackumulation vid varje ny RUT-bokning.

**Implementation:** Kill-switch `PNR_FIELD_DISABLED = true` + guards på alla 7 visa-ställen + HTML dolt via `display:none !important`.

**Data-flöde verifierat dött:** `rawPnr = ''` → `customer_pnr: undefined` → booking-create tar aldrig emot PNR.

**UI-påverkan:** RUT-rabatt (50%) visas och tillämpas som tidigare. Endast PNR-fältet är dolt. Ärlig text ersätter vilseledande "krypteras..."-text.

**Återaktivering:** Endast efter Fas 7.5 §7.5.1 Skatteverket-API-research + korrekt server-side-kryptering + jurist-verifierad text.

**Filer ändrade:**
- `boka.html` — 7 edits (kill-switch + HTML + 5 JS-guards)
- `docs/sanning/pnr-och-gdpr.md` — status uppdaterad

### 2. Sanningsfilen uppdaterad ✅

`docs/sanning/pnr-och-gdpr.md`:
- Status: AKTIVT PROBLEM → STABILISERAT
- Risker: 🔴 aktiv insamling → 🟢 stoppad
- Planerad åtgärd steg 1: markerad KLART
- Hårda låsningar: förtydligade kring återaktivering

---

## Öppna manuella steg (Farhad gör själv i PROD Studio)

### Steg 1 — Droppa backup-tabell (5 sek)

**Kontext:** Skapades 23 apr vid verifiering innan commission-UPDATE. UPDATE kördes aldrig. Tabellen användes inte men ligger kvar.

**Kör i PROD SQL Editor:**

```sql
-- Verifiera först att tabellen finns och är tom/testdata
SELECT COUNT(*) AS rows, MIN(id) AS sample_id
FROM bookings_backup_commission_17_before_sync;

-- Om rader > 0, bekräfta att de matchar bookings (det är en kopia)
SELECT COUNT(*) AS matching_bookings
FROM bookings_backup_commission_17_before_sync b
INNER JOIN bookings ON bookings.id = b.id;

-- Droppa om bekräftat
DROP TABLE IF EXISTS bookings_backup_commission_17_before_sync;

-- Verifiera borttagning
SELECT COUNT(*) FROM information_schema.tables
WHERE table_name = 'bookings_backup_commission_17_before_sync';
-- Förväntat: 0
```

### Steg 2 — Radera `RUT_PNR_ENCRYPTION_KEY` från PROD vault

**Kontext:** Skapades av misstag när RUT.1 byggdes i fel Studio 23 apr förmiddag.
UUID: `86767fda-4dcf-44c6-8869-7e5b9a0145f1`

**Innan radering, verifiera att inga rader använder nyckeln:**

```sql
-- Båda ska returnera 0
SELECT COUNT(*) FROM bookings WHERE customer_pnr_encrypted IS NOT NULL;
SELECT COUNT(*) FROM bookings WHERE customer_pnr_hash IS NOT NULL;
```

**Om båda = 0 → radera i Studio:**
1. PROD Studio → Settings → Vault
2. Sök UUID `86767fda-4dcf-44c6-8869-7e5b9a0145f1`
3. Delete

**VIKTIGT:** Rör INTE den lokala vault-nyckeln (annan UUID). Den behålls intakt.

---

## Regler som obligatoriska per commit (bekräftat 24 apr)

Alla commits i Sprint 1+ ska följa dessa. Ingen gissning, aldrig antagande.

- **#26 Grep-before-edit:** Läs exakt text + kartlägg alla callers innan str_replace
- **#27 Scope-respekt:** Gör vad som blev ombedd, inget mer
- **#28 Pricing-konsolidering:** En källa för värden (`platform_settings`)
- **#29 Audit-först:** Läs hela audit-filen innan agera på "audit säger X"
- **#30 Ingen regulator-gissning:** Skatteverket/GDPR/BokfL/Stripe verifieras mot spec
- **#31 Primärkälla över memory:** `prod-schema.sql` + sanningsfiler slår memory

---

## Nästa steg i Sprint 1 Dag 1

### Kvar att göra idag/imorgon

1. **Preview-verifiering av boka.html** — öppna sidan i browser, gå till steg 3, bekräfta PNR-fält är dolt + RUT-rabatt fungerar + submit går igenom utan PNR
2. **Kör manuella Steg 1+2 ovan** (Farhad)
3. **Commit Sprint 1 Dag 1 PNR-del**

### Sprint 1 Dag 2-3 — Pricing-resolver + cleaner-dubletter (hygien #29 + #30)

**Kontext:** Fönsterputs-testbokning `681aaa93` visade att pricing-resolver läste `cleaner.hourly_rate` (100 kr för Farhad-solo-raden) istället för `services.default_hourly_price` (349 kr). Kund debiterades 100 kr/h istf 349 kr/h = **aktiv revenue-läcka som skalar med volym**.

Steg:
1. Grep pricing-resolver-callers + trace fallback-kedja
2. Audit PROD: finns fler cleaner-dubletter utöver Farhad-solo-raden?
3. Fix pricing-resolver att prioritera `services.default_hourly_price` över `cleaner.hourly_rate`
4. Unique constraint på `cleaners(email, company_id)` (om data tillåter)
5. Regressionstest + commit

Estimat: 4-6h.

### Sprint 1 Dag 4-5 — §2.1.1-utökning klar

Bootstrap-migrations tills `supabase db reset --local` går igenom alla 100 migrations. Unblock-ar `supabase db push` för CI/CD.

Estimat: 3-5h kvarvarande.

---

## Primärkällor för denna session

- `docs/sanning/pnr-och-gdpr.md` (uppdaterad idag)
- `docs/sanning/provision.md` (oförändrad)
- `docs/sanning/rut.md` (oförändrad)
- `docs/planning/todo-pnr-infrastructure-2026-04-23.md` (Åtgärd 1 bockas av)
- `docs/audits/2026-04-23-rut-infrastructure-decision.md` (post-mortem bakgrund)
- `docs/planning/spick-arkitekturplan-v3.md` (v3.1, 8-sprint-plan för skalning)
- `docs/v3-phase1-progress.md` (fas-status)

---

## Miljö och checkpoints

- **Repo-status vid start:** Clean på main, commit `4400245` som HEAD
- **Repo-status vid avslut:** Sprint 1 Dag 1 PNR-del redo för commit (ocommittade ändringar: `boka.html` + `docs/sanning/pnr-och-gdpr.md` + denna handoff-fil)
- **PROD DB:** Oförändrad. Två manuella steg väntar (backup-drop + vault-radering).
- **Stripe:** LIVE mode, oförändrat. Inga transaktioner påverkade.
- **RUT:** Förblir AVSTÄNGD. Fas 7.5 ej startad.
