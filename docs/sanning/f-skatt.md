# Sanning: F-skatt-status

**Senaste verifiering:** 2026-04-28 (farrehagge-session — fragmenterings-upptäckt + prod-verifierad)
**Status:** SSOT-FRAGMENTERING DOKUMENTERAD · Konsolidering skjuts till Fas 7.5 eller tidigare sprint
**Verifierad av:** Farhad + Claude, mot prod-DB via `information_schema` + aktuell data
**Ändras genom:** commit som uppdaterar denna fil + ev. konsolideringsmigration

---

## 1. Affärsbeslut (låst)

### 1.1 Spick = utförare → F-skattade underleverantörer krävs

Per [payment-model.md §1.1](payment-model.md): Spick är utförare enligt Lag (2009:194) § 8. Alla underleverantörer (städbolag + enskilda firmare) måste ha giltig F-skatt.

### 1.2 Tre grupper i systemet

| Grupp | F-skatt-plats | Verifikation krävs av |
|---|---|---|
| **Company owner** (Rafael, Zivar, Rudolf, Farhad) | `companies.org_number` → SKV öppna data | Spick vid onboarding |
| **Team member** (Lizbeth, Nilufar, etc.) | Ingen egen F-skatt — omfattas av owner-bolagets F-skatt | — (inte Spicks ansvar) |
| **Solo cleaner** (framtida enskilda firmare) | `cleaners.org_number` (om registrerad firma) ELLER anställdsstatus via jurist | Spick vid onboarding |

---

## 2. 🟡 Rule #28-fragmentering (kvarstår 2026-04-28)

### 2.1 Tre kolumner på `cleaners` med liknande semantik

| Kolumn | Datatyp | Nuvarande värden (prod 2026-04-28) | Avsedd semantik |
|---|---|---|---|
| `cleaners.has_fskatt` | boolean | 13 true · 4 false (exkl testkonton) | Cleanern påstår sig ha F-skatt (självdeklaration) |
| `cleaners.f_skatt_verified` | boolean | 1 true · 16 false (exkl testkonton) | Spick-admin har verifierat F-skatt mot SKV |
| `cleaners.fskatt_needs_help` | boolean | 3 true · 14 false (exkl testkonton) | Cleanern saknar F-skatt + vill ha hjälp att skaffa |

**Problem:** Tre kolumner utan formell SSOT-definition. Någon kod kan läsa `has_fskatt`, annan `f_skatt_verified`, tredje aggregerar. Skapades iterativt utan konsolidering.

### 2.2 Ingen motsvarande kolumn på `companies`

`companies`-tabellen saknar `f_skatt_verified`. F-skatt tillhör företaget (inte personen) vid company-modell → borde finnas där. Idag är det endast på cleaner-nivån, vilket skapar logik-drift:

- Farhad (personlig cleaner) har `f_skatt_verified=true` — men det är **egentligen** Haghighi Consulting AB:s F-skatt (`559402-4522`) som är verifierad
- Alla 4 members i Solid Service Sverige AB har `f_skatt_verified=false` trots att företaget självt kan ha F-skatt (inte verifierat än)

---

## 3. Prod-data (verifierad 2026-04-28)

### 3.1 Cleaner-flottan f-skatt-status

```sql
SELECT has_fskatt, f_skatt_verified, fskatt_needs_help, COUNT(*)
FROM cleaners
WHERE is_test_account IS NOT TRUE
GROUP BY has_fskatt, f_skatt_verified, fskatt_needs_help;
```

| has_fskatt | f_skatt_verified | fskatt_needs_help | Antal | Kommentar |
|---|---|---|---|---|
| true | false | false | 13 | Påstår F-skatt men ej verifierat |
| false | false | true | 3 | Saknar F-skatt, behöver hjälp (Clara-Maria, derin, Jelena) |
| false | true | false | 1 | Anomali — behöver utredas (verkar vara Farhad, kolumnen reflekterar bolagets F-skatt) |
| **Summa** | | | **17** | 15 aktiva + 2 dataminimerade avstängda (post-Fix 3 2026-04-28) |

### 3.2 Company-flottan f-skatt-status

Ingen kolumn finns. Status måste härledas från owner-cleanerns `f_skatt_verified`:

| Företag | Org-nummer | Owner F-skatt-verifierad? |
|---|---|---|
| Haghighi Consulting AB | 559402-4522 | Ja (Farhad = owner med f_skatt_verified=true) |
| Solid Service Sverige AB | 559537-7523 | Nej (Zivar Majid har has_fskatt=true men f_skatt_verified=false) |
| Rafa Allservice AB | 559499-3445 | Nej (Rafael har has_fskatt=true men f_skatt_verified=false) |
| GoClean Nordic AB | 559462-4115 | Nej (Rudolf har has_fskatt=true men f_skatt_verified=false) |

---

## 4. Läsregel (framåt, tills konsolidering körs)

När kod behöver veta "har denna cleaner/company giltigt F-skatt?":

```typescript
// SSOT-regel 2026-04-28 (tills Fas 7.5-konsolidering)
function hasVerifiedFSkatt(cleaner: Cleaner, company?: Company): boolean {
  // 1. Om cleaner är solo (company_id IS NULL): läs cleaner-raden
  if (!cleaner.company_id) {
    return cleaner.f_skatt_verified === true;
  }
  // 2. Om cleaner är company member: läs company-owner-cleanerns f_skatt_verified
  // (eftersom companies.f_skatt_verified ej existerar)
  // Fråga: SELECT f_skatt_verified FROM cleaners WHERE id = company.owner_cleaner_id
  // Returnera: owner.f_skatt_verified === true
  return getCompanyOwnerFSkattVerified(company);
}
```

**Detta är ingen permanent lösning** — det är en vägledning tills konsolidering körs.

---

## 5. Konsoliderings-plan (Fas 7.5 eller tidigare)

### 5.1 Föreslagen SSOT-struktur

```sql
-- Ny kolumn på companies (primär SSOT)
ALTER TABLE companies
  ADD COLUMN f_skatt_verified boolean DEFAULT false,
  ADD COLUMN f_skatt_verified_at timestamptz,
  ADD COLUMN f_skatt_verification_source text; -- 'skv_api' | 'admin_manual' | 'document_upload'

-- Behåll cleaners.f_skatt_verified endast för SOLO cleaners (company_id IS NULL)
-- Dokumentera i kolumn-kommentar:
COMMENT ON COLUMN cleaners.f_skatt_verified IS
  'F-skatt-status. Giltig endast för solo cleaners (company_id IS NULL).
   Company members ärver från companies.f_skatt_verified.';

-- Deprecera has_fskatt + fskatt_needs_help till cleaner-onboarding-steg-flaggor
COMMENT ON COLUMN cleaners.has_fskatt IS
  'DEPRECATED 2026-04-28. Historisk självdeklaration. Använd f_skatt_verified + (för members) companies.f_skatt_verified.';
```

### 5.2 Verifierings-källa

**Primärkälla:** Skatteverkets öppna data-API (per [legal-research §3.1](../planning/fas-7-5-rut-legal-research-2026-04-24.md)):

- Input: `org_number` (10 eller 12 tecken)
- Output: F-skatt-status (aktiv/inaktiv), momsregistrering, registreringsdatum
- Ingen auth krävs (öppna data)

### 5.3 Implementations-steg (pending)

1. Migration: lägg till `companies.f_skatt_verified*`-kolumner
2. EF: `verify-fskatt-company` — anropar SKV + uppdaterar företaget
3. Admin-UI: knapp "Verifiera F-skatt" i company-detalj
4. Cron: daglig check av alla aktiva companies (flaggar om status ändrats)
5. Backfill: 1 manuell körning för 4 befintliga companies
6. Deprecera läsning från `cleaners.has_fskatt` i kod (gradvis)
7. Eventuell framtida DROP av `cleaners.has_fskatt` + `cleaners.fskatt_needs_help`

**Estimat:** 4-6h kod + 1-2h admin-UI + 1h backfill = **6-9h total**.

---

## 6. MVP-kontext (2026-04-28)

| Observation | Värde |
|---|---|
| Antal riktiga cleaners | 15 (3 testkonton exkluderade) |
| Aktiva companies | 4 (exkl Test VD AB) |
| Jobb utförda totalt | 0 |
| Ekonomisk exposure från fel F-skatt-klassning | 0 kr |
| Risk-nivå | 🟢 **Förebyggande**, ej retroaktiv |

**Risk-kalibrering:** Eftersom 0 jobb utförts finns ingen retroaktiv PWD-anställningspresumtionsrisk. Konsolidering kan vänta tills Rafa-pilot aktiveras eller Fas 7.5 startar. Viktigast är att **före första riktiga bokning** har alla 4 companies verifierad F-skatt.

---

## 7. Hårda låsningar

1. **Inga RUT-ansökningar till SKV utan att alla bokningens underleverantörer har F-skatt-verifierad** (Lag 2009:194 + 67 kap IL)
2. **Matching får INTE returnera cleaner där ägarens company saknar F-skatt** (efter konsolidering — idag är filter manuellt)
3. **Stripe Connect payout till owner_cleaner får INTE triggas om company saknar verifierad F-skatt** (undvika skattebrott-risk + PWD-drift)
4. **Enskilda firmare utan org_number får EJ godkännas som cleaner** förrän de antingen (a) registrerar enskild firma + F-skatt eller (b) anställs via company-modellen

---

## 8. Referenser

### 8.1 Sanning-filer (komplementära)
- [provision.md](provision.md) — 12% flat provision
- [payment-model.md](payment-model.md) — betalningsmodell (ensteg, efter-RUT, SKV-risk mot kund)
- [rut.md](rut.md) — RUT-infrastruktur
- [pnr-och-gdpr.md](pnr-och-gdpr.md) — PNR-hantering

### 8.2 Planning-dokument
- [fas-7-5-rut-legal-research-2026-04-24.md §3](../planning/fas-7-5-rut-legal-research-2026-04-24.md) — ombuds-relation + F-skatt-krav
- [todo-pnr-infrastructure-2026-04-23.md](../planning/todo-pnr-infrastructure-2026-04-23.md)

### 8.3 Lagrum
- **Inkomstskattelag (1999:1229)** — 67 kap 11-19 §§ (RUT-avdrag)
- **Lag (2009:194)** — fakturamodellen + ombudsansvar
- **Skatteförfarandelag (2011:1244)** — F-skattesystemet + näringsbedrivning
- **EU PWD 2024/2831** — anställningspresumtion (deadline 2 dec 2026)
- **SOU 2026:3** — "Genomförande av plattformsdirektivet" (remiss)

### 8.4 Skatteverket-resurser
- [Rot och rut](https://www.skatteverket.se/foretag/skatterochavdrag/rotochrut.4.2ef18e6a125660db8b080002674.html)
- Öppna data-API (specifikt endpoint-URL verifieras vid implementation, rule #30)

---

## 9. Regel-efterlevnad (#26-#31)

- **#26 (grep-före-edit):** Ingen befintlig fil ändrad. Ny fil, inga str_replace-risker.
- **#27 (scope-respekt):** Dokumentation av SSOT-fragmentering. Ingen kod ändrad. Konsoliderings-plan skissad men EJ implementerad.
- **#28 (SSOT):** Denna fil är nu ensam primärkälla för F-skatt-status. Fragmenteringen i prod dokumenteras explicit som **känd teknisk skuld** att åtgärdas.
- **#29 (audit-först):** Läst före skapande: payment-model.md, rut.md, pnr-och-gdpr.md, legal-research-dokumentet, todo-pnr-infrastructure-dokumentet + prod-verifiering (3 queries körda 2026-04-28 mot information_schema + aktuell data).
- **#30 (regulator-gissning förbjuden):** Konkret SKV-API-endpoint + auth-metod markeras som "verifieras vid implementation". Inga antaganden om SKV:s API-format. Lagrum listas med paragraf-referenser, inte tolkade.
- **#31 (primärkälla över memory):** Kolumn-existens verifierad via `information_schema`-query. Värde-distribution verifierad via `SELECT GROUP BY` (Farhad körde 2026-04-28). Ingen gissning om vad som finns i prod.

---

## 10. Ändringar av denna fil

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-28 | Fil skapad. SSOT-fragmentering dokumenterad (3 kolumner på cleaners + saknad companies.f_skatt_verified). Konsoliderings-plan skissad. Prod-data verifierad. | Farhad + Claude session |
