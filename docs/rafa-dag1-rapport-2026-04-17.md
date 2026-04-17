# Spick Dag 1 Rapport — 17 april 2026

**Session-typ:** Audit (inga kod- eller SQL-ändringar).  
**Utförd av:** Claude Code.  
**Beslut krävs från:** Farhad, inför Dag 2.

---

## TL;DR (3 meningar)

1. Commission-koden hanterar procent-formatet konsekvent vid LÄSNING från DB men har två hårdkodade paths (`booking-create:497`, `stripe-checkout:88`) som ignorerar både `pricing.commissionPct` och `cleaners.commission_rate` när Stripe application_fee räknas — bugg är latent idag men exploderar när admin ändrar någon cleaners commission.
2. Pricing-arkitekturen är spridd över 14 platser i koden (4 skrivande, 10 läsande) och `booking-create` saknar `use_company_pricing`-logiken som `stripe-checkout` och `boka.html` redan har — Rafas flagga får INTE aktiveras förrän detta fixas.
3. **Rekommendation Dag 2:** Väg B — gemensam `pricing-resolver` helper i `_shared/`, kombinerat med commission-fixen i samma PR (~8 timmar, fyra commits, sex testscenarier).

---

## Commission-audit

**32 träffar** i 8 Edge Functions + 5 frontend-filer. Läsning av `bookings.commission_pct` är konsekvent procent (17) dividerat med 100 överallt. Skrivning till Stripe application_fee är INKONSISTENT.

**Bekräftade buggar:**
- 🔴 **BUG 1 (latent-kritisk):** `booking-create:497` och `stripe-checkout:88` använder hårdkodade decimaler (0.17/0.12). Ignorerar `pricing.commissionPct` (Top-tier = 14) och `cleaners.commission_rate` (admin-justerat värde).
- 🔴 **BUG 3 (aktiv för companies):** `stadare-uppdrag.html:637` läser `booking.commission_rate` som inte existerar (fältet heter `commission_pct`). Always fallback 0.17 → teammedlemmar ser FEL ersättning.
- 🟡 **BUG 2 (kosmetisk, aktiv):** `auto-remind` + `notify` hårdkodar `*0.83` i email. Fel för Top-tier och companies.
- 🟡 **BUG 4 (kosmetisk):** `stadare-dashboard.html:9080` hårdkodar 0.12 som fallback.
- ⚠️ **ANOMALI:** `admin.html` har försvarskod `c.commission_rate < 1 ? ...` som antyder mixed DB-format. SQL-audit krävs.

**Full rapport:** [`docs/dag2-planering/commission-audit-2026-04-17.md`](dag2-planering/commission-audit-2026-04-17.md)

---

## Pricing-arkitektur

**14 pricing-paths** kartlagda. Auktoritativa (skrivande) paths: 4 (booking-create, setup-subscription, admin-create-company, admin-approve-cleaner). Display-only: 10.

**Kritiska fynd:**
1. `booking-create:183-210` ignorerar `companies.use_company_pricing` helt — bekräftat.
2. `boka.html` och `stripe-checkout` har korrekt 3-lagers-logik. Den ska kopieras till `booking-create`.
3. `stripe-checkout` anropas INTE längre från `boka.html` (verifierat rad 2847 — bara `booking-create`). Potentiellt död kod.
4. `foretag.html` ignorerar `use_company_pricing`-flaggan vid listning.
5. `setup-subscription` + `auto-rebook` använder ENBART `cleaner.hourly_rate` — ignorerar all per-tjänst-pricing.

**Rafas case (Flöde 3 i rapporten):** Om `use_company_pricing=true` sätts idag visar frontend företagspriset men `booking-create` sparar `cleaner.hourly_rate × hours` → mismatch.

**Full rapport:** [`docs/dag2-planering/pricing-arkitektur-2026-04-17.md`](dag2-planering/pricing-arkitektur-2026-04-17.md)

---

## Fix-strategi

Tre vägar utvärderade:

| Väg | Tid | Risk | Teknisk skuld | Rekommendation |
|-----|-----|------|---------------|----------------|
| A — Patch booking-create direkt | 3-4h | Låg-medel | Hög (dupliceras på 4 ställen) | ❌ Snabbt men kostar senare |
| **B — Gemensam helper i `_shared/`** | **6-8h** | **Medel** | **Låg** | ✅ **REKOMMENDERAD** |
| C — PostgreSQL RPC | 10-12h | Medel-hög | Lägst på papper | ❌ Overengineering för Spicks skala |

**Varför Väg B:** `_shared/pricing-engine.ts` finns redan som mönster. Kombinerar pricing-fix + commission-fix i samma PR eftersom BUG 1 bor i samma filer. Möjligheten att senare exponera som RPC för frontend kvarstår.

**Dag 2 plan (Väg B — 4 commits):**
1. `feat(pricing): shared pricing-resolver helper` (2h)
2. `refactor(booking-create): använd pricing-resolver` (2h)
3. `fix(booking-create): läs commission från DB istället för hårdkod` (1h)
4. `fix(stadare-uppdrag): commission_pct fältfix` (30min)

Plus: SQL för Rafa (efter deploy), regression 6 scenarier (~1h).

**Full rapport:** [`docs/dag2-planering/pricing-fix-strategi-2026-04-17.md`](dag2-planering/pricing-fix-strategi-2026-04-17.md)

---

## Blockerare för Rafa-live (uppdaterad lista)

### Interna (kräver kodändring i Dag 2)
1. 🔴 **Pricing-sync i booking-create** — Väg B enligt fix-strategi-dokumentet.
2. 🔴 **Commission-buggar (BUG 1 + BUG 3)** — löses i samma Dag 2 PR.
3. 🟡 **BUG 2 + BUG 4 (email/dashboard hårdkod)** — kan tas i senare sprint, ej blockerande.
4. 🟡 **Underleverantörsavtal-signering UI** — separat arbete (inte denna sessions scope).

### Externa (parallella spår)
5. **Rafael:** Stripe Connect complete (status verifierad?).
6. **Rafael:** Hemadresser för Daniella + Lizbeth (väntar svar).
7. **Försäkringsmäklare:** Offert 1 Mkr.
8. **Rafael:** Signera underleverantörsavtal (när UI klar).

---

## Vad som INTE gjordes i denna session (medvetet)

- ❌ Ingen kodändring (förbudet respekterat).
- ❌ Ingen SQL-körning i prod.
- ❌ Ingen SQL-fix `use_company_pricing=true` för Rafa — väntar på Dag 2-fix först.
- ❌ Ingen uz-språkpatch (Farhad gör manuellt).
- ❌ Inga Stripe-, juridisk-, eller försäkringsuppgifter (externa spår).
- ❌ Ingen borttagning av `.claude/worktrees/wonderful-euler` (ej denna sessions scope — bara `docs/`).

---

## Beslut som Farhad behöver fatta inför Dag 2

### 1. Väg A, B eller C för pricing-fix?
**Rekommendation: B.** Motivering:
- Fyra pricing-paths redan duplicerade → Väg A förvärrar.
- Commission-BUG 1 bor i samma filer → löses i samma PR.
- `stripe-checkout` är sannolikt död kod → Väg B kan ta bort den.
- Väg C är overengineering för 26 bokningar.

### 2. Ska commission-buggar fixas i Dag 2 eller senare?
**Rekommendation: BUG 1 + BUG 3 i Dag 2** (eftersom de berör samma filer som pricing-fixen). BUG 2 + BUG 4 kan vänta — de är kosmetiska och påverkar inte pengar.

### 3. När ska underleverantörsavtal-UI prioriteras?
**Rekommendation:** Efter Dag 2 är deployed och Rafa har gjort första testbokning. UI blockar Rafa-live men blockar inte Dag 2-arbetet.

### 4. SQL-audit av DB-format inför Dag 2?
**Rekommendation: JA** — kör dessa 3 queries innan Dag 2 för att konfirmera att ingen cleaner har `commission_rate < 1` (decimal), ingen har `tier='top'` (vilket skulle trigga BUG 1 omedelbart), och att all `bookings.commission_pct = 17`:

```sql
SELECT COUNT(*) FROM cleaners WHERE commission_rate < 1;  -- förväntat: 0
SELECT COUNT(*) FROM cleaners WHERE tier = 'top';          -- förväntat: 0
SELECT DISTINCT commission_pct FROM bookings;              -- förväntat: [17]
```

Om någon query ger oväntat svar → BUG 1 är redan aktiv och prioriteten höjs.

---

## Länkar

- [Commission-audit](dag2-planering/commission-audit-2026-04-17.md)
- [Pricing-arkitektur](dag2-planering/pricing-arkitektur-2026-04-17.md)
- [Fix-strategi](dag2-planering/pricing-fix-strategi-2026-04-17.md)

---

**Session-slut:** 4 dokument skapade, 0 kodändringar. Committed till main.
