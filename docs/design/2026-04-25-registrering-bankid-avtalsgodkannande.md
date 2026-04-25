# Design — BankID-godkännande av underleverantörsavtal vid registrering

**Datum:** 2026-04-25
**Trigger:** Farhads design-mandate 2026-04-25:
> "Underleverantörsavtal är något som dom även godkänner i samband med registrering via BankID tänker jag. Så att dom godkänner villkoren i samband med registrering. Utöver det gäller även kundvillkoren och integritetspolicyn uppdateras när man gör sin bokning precis som normalts sett gör."

**Format:** Design-skiss för Farhad-OK innan impl. Memory-feedback `validate_ui_before_backend` respekterad.

---

## 1. TL;DR

**Farhad vill:**
1. Underleverantör godkänner avtalet i samband med BankID-verifiering vid registrering (engångs-handling)
2. Kund godkänner kundvillkor + integritetspolicy vid varje bokning (löpande, befintlig flow)

**Min rekommendation (kort):**
- **Underleverantör:** BankID-signering binder personen + avtals-acceptans samtidigt. Signal: `cleaners.terms_accepted_at` + `cleaners.terms_version`. Bevismässigt starkt eftersom BankID-signering är juridiskt giltig signatur.
- **Företagsregistrering (firmatecknare):** Samma flow + extra "Företagsavtal" som kompletterar individuellt avtal.
- **Avtals-versionering:** Vid uppdatering av avtal → cleaner måste re-acceptera vid nästa login + ny BankID-bekräftelse.

---

## 2. Befintlig state (curl-/grep-verifierat 2026-04-25)

### 2.1 Frontend

| Sida | BankID-flow | Avtals-checkbox |
|---|---|---|
| `bli-stadare.html` | (saknas — ingen BankID-integration än per grep) | Standard-checkbox till villkor-stadare.html |
| `registrera-foretag.html` | TIC BankID firmatecknare-verifiering (rad 254-, §B2B.4) — "optional bonus" | Rad 251: "Jag bekräftar att jag är firmatecknare" |

### 2.2 Backend

- `rut_consents`-tabell finns för kund-BankID (Sprint 1, 2026-04-25-handoff)
- `company-bankid-init` + `company-bankid-verify` EFs **rollbackade** pga Supabase EF-quota (TIC #2)
- Inga `cleaners.terms_accepted_at` eller motsvarande kolumner ännu (att verifiera via curl)

### 2.3 Avtal som behöver godkännas

| Avtal | Vem | När |
|---|---|---|
| **Kundvillkor** | Kund | Vid bokning (befintlig — checkbox boka.html:701) |
| **Integritetspolicy** | Kund | Vid bokning (befintlig — samma checkbox) |
| **Underleverantörsavtal** | Cleaner | Vid registrering (NY — denna design) |
| **Företagsavtal-tillägg** | Företags-VD | Vid företagsregistrering (NY — denna design) |
| **Code of Conduct** | Cleaner | Vid registrering (NY — denna design) |

---

## 3. Föreslagen UX-flow

### 3.1 Ny cleaner-registrering (`bli-stadare.html` → `registrera-stadare.html`)

```
Steg 1: Personliga uppgifter (namn, email, telefon)
        ↓
Steg 2: Kompetens + tjänster (vad du erbjuder)
        ↓
Steg 3: Försäkring + F-skatt-bevis (upload)
        ↓
Steg 4: Avtal & signering (NY DESIGN)
        ┌─────────────────────────────────────┐
        │ Granska avtal                      │
        │ ──────────────────────────────────  │
        │ ☐ Underleverantörsavtal v1.0 [PDF] │
        │ ☐ Code of Conduct [Read]           │
        │ ☐ Spicks integritetspolicy         │
        │                                     │
        │ ⓘ Genom att signera med BankID     │
        │   accepterar du dessa avtal som    │
        │   juridiskt bindande underskrift   │
        │                                     │
        │ [Signera med BankID →]             │
        └─────────────────────────────────────┘
        ↓
Steg 5: BankID-flow (samma som §7.5 TIC SPAR)
        ↓
Steg 6: Bekräftelse + onboarding
```

### 3.2 Företagsregistrering (`registrera-foretag.html`)

Befintlig BankID-flow (rad 254+) utökas:

```
Steg 1: Företagsuppgifter (org.nr, namn)
        ↓
Steg 2: Firmatecknare-info
        ↓
Steg 3: Avtal & signering (UTÖKAD)
        ┌─────────────────────────────────────┐
        │ Granska avtal                       │
        │ ──────────────────────────────────  │
        │ ☐ Underleverantörsavtal v1.0 [PDF] │
        │ ☐ B2B-tillägg företag v1.0 [PDF]   │
        │ ☐ Code of Conduct [Read]           │
        │                                     │
        │ ⓘ Som firmatecknare binder du      │
        │   företaget till dessa avtal genom  │
        │   din BankID-signering              │
        │                                     │
        │ [Signera med BankID →]             │
        └─────────────────────────────────────┘
        ↓
Steg 4: TIC BankID + Bolagsverket-verifiering
        ↓
Steg 5: Bekräftelse
```

### 3.3 Avtals-uppdatering (vid framtida v0.2 av avtal)

```
Cleaner loggar in → ser modal:
┌─────────────────────────────────────┐
│ ⚠ Underleverantörsavtalet uppdaterat│
│ ──────────────────────────────────  │
│ Version 1.1 publicerad 2026-XX-XX  │
│                                     │
│ Ändringar:                          │
│ - Ny vite-skala §18                 │
│ - Plattformsdeltagar-roll §16       │
│                                     │
│ [Granska ändringar] [Acceptera]    │
│                                     │
│ ⓘ Om du inte accepterar inom 30    │
│   dagar pausas ditt konto           │
└─────────────────────────────────────┘

Acceptera → BankID-signering → terms_version uppdateras
```

---

## 4. Backend-design

### 4.1 Schema-ändringar (förslag — kräver curl-verifiering före impl)

```sql
-- Cleaner-version
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS terms_signature_id UUID
  REFERENCES rut_consents(id);  -- BankID-bevis-rad

-- Företags-version
ALTER TABLE companies ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS terms_signature_id UUID;

-- Avtals-versionering (separat tabell)
CREATE TABLE IF NOT EXISTS avtal_versioner (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avtal_typ TEXT NOT NULL,  -- 'underleverantörsavtal', 'b2b-tillagg', 'kundvillkor', 'code_of_conduct'
  version TEXT NOT NULL,    -- 'v0.2', 'v1.0' osv.
  publicerat_at TIMESTAMPTZ DEFAULT NOW(),
  publicerat_av TEXT,        -- admin email
  pdf_url TEXT,              -- Storage URL
  ändringssammanfattning TEXT,
  UNIQUE (avtal_typ, version)
);
```

### 4.2 Återanvänd `rut_consents`-tabellen

Sprint 1 (TIC #1) skapade `rut_consents` med generic `purpose`-flagga. Vi kan utöka:

| Purpose-värde | Användning |
|---|---|
| `rut_pnr_verification` | Befintligt — kund verifierar PNR för RUT |
| `cleaner_registration` | NY — cleaner signerar underleverantörsavtal |
| `company_signup` | NY — firmatecknare signerar företagsavtal |
| `terms_update_acceptance` | NY — befintlig cleaner re-accepterar uppdaterat avtal |

Fördelen: en tabell för alla BankID-bevis. SSOT (rule #28).

### 4.3 EF-strategi

**Återanvänd `rut-bankid-init` + `rut-bankid-status`** med utökat `purpose`-fält:

```typescript
// rut-bankid-init body utökad:
{
  purpose: 'cleaner_registration',  // istf 'rut_pnr_verification'
  cleaner_id: '...',                 // för cross-ref
  terms_versions: {
    underleverantörsavtal: 'v1.0',
    code_of_conduct: 'v1.0',
  }
}
```

Vid success: rut-bankid-status uppdaterar `cleaners.terms_accepted_at` + `terms_version` + `terms_signature_id`.

Detta undviker att skapa nya EFs (Supabase quota-skydd, lärdom från TIC #2 rollback).

---

## 5. Implementations-steg

| Steg | Storlek | Vad |
|---|---|---|
| 1 | 2-3h | Schema-migration: cleaners + companies + avtal_versioner |
| 2 | 1-2h | Seed avtal_versioner med v1.0 av befintliga drafts (efter Farhad-OK på drafts) |
| 3 | 2-3h | Utöka `rut-bankid-init` + `rut-bankid-status` med purpose=cleaner_registration |
| 4 | 3-4h | Frontend: nytt steg i `registrera-stadare.html` (om finns, annars ny sida) |
| 5 | 1-2h | Frontend-utökning av `registrera-foretag.html` |
| 6 | 2-3h | Avtals-uppdatering-modal + EF för att checka outdated terms_version vid login |
| 7 | 1h | Generera PDF av drafts (för länkar i UI) — kan använda existing pdf-lib |
| **Totalt** | **12-18h** | Multi-sprint impl |

---

## 6. Risk-flaggor (rule #30)

### 6.1 BankID-signering = juridiskt bindande

**Data:** BankID-signering är juridiskt erkänd elektronisk signatur per eIDAS-förordningen (EU 910/2014) Art 25-27. Det stärker bevisvärdet.

**Du som jurist verifierar:**
- Är BankID-signering "qualified electronic signature" (QES) eller "advanced" (AdES)?
- Räcker AdES för anti-fraud-§17 i underleverantörsavtal?
- Behövs separat textsamtycke (checkbox) som komplement till BankID?

### 6.2 Avtals-uppdatering — pausa konto vid icke-acceptans

Den föreslagna flowen säger "om inte accepterar inom 30 dagar pausas konto". Detta kan vara:
- Förenligt med Avtalslagen §13 (parts villkor) i B2B
- Men kan strida mot konsumenttjänstlagen om kund-relation
- AD-jämkningsrisk vid plötsliga avtalsändringar mot mikronäringsidkare

**Mitigering:** 60 dagars varsel istf 30 + tydlig kommunikation.

### 6.3 EU PWD-amplifiering

Att kräva BankID-signering + accept varje uppdaterat avtal skapar **stark plattforms-styrning** över cleaner. Det amplifierar EU PWD-risk för anställnings-omklassning.

**Mitigering:** Behåll cleaner-fri-att-säga-upp-avtal-utan-grund (§11.1) som kompensation.

### 6.4 GDPR — BankID-data

BankID-signaturer innehåller personnummer + namn + ev. adress. Lagring faller under GDPR Art 5-6 + Dataskyddslagen 3 kap 10 §.

**Mitigering:** Återanvänd existing `rut_consents`-tabell med PNR-hash, inte klartext (samma mönster som RUT-flow).

---

## 7. Specifika beslutspunkter för dig

| # | Beslut | Min rek |
|---|---|---|
| 1 | Hela design-flowen OK eller ändra? | Som beskrivet, med mitigeringar §6 |
| 2 | Reuse `rut_consents` ELLER ny `terms_consents`-tabell? | Reuse (SSOT, EF-quota-skydd) |
| 3 | Avtals-uppdatering: pausa konto vid icke-acceptans efter 30 d? | 60 d istf 30 d |
| 4 | Behövs separat checkbox utöver BankID-signering? | Ja, för "uttryckligt samtycke" — analog med ångerrätt-text §11 distansavtalslagen |
| 5 | Generera PDF-version av varje avtal automatiskt vid Farhad-OK? | Ja, för bevis-arkiv |
| 6 | Migration-fil + impl-sprint planera nu eller efter villkor-paket-OK? | Efter villkor-paket-OK (avtal måste vara stabila innan BankID binder dem) |

---

## 8. Beroende-kedja

Detta design hänger på:
1. ✅ Underleverantörsavtal-draft v0.2 (klar, väntar din OK)
2. ✅ Kundvillkor-draft v0.2 (klar, väntar din OK)
3. ⏳ Hybrid-modell-beslut (utförare/förmedlare)
4. ⏳ TIC #1 jurist-OK för PNR-flow (väntar legal-research-bedömning)
5. ⏳ Detta design — väntar din OK
6. ⏳ Implementation (12-18h sprint efter 1-5)

**Min rekommendation:** Bedöm avtal + denna design parallellt. Implementation kan starta efter alla 5 ovan är OK:ade.

---

## 9. Disclaimer (#30)

Inget i denna design är juridisk rådgivning. Specifika juridiska konsekvenser av:
- BankID-signaturers giltighet i avtals-tvist (eIDAS Art 25-27)
- Avtals-uppdatering med konsekvens-pausning
- Plattforms-styrning vs EU PWD anställnings-presumtion

...kräver din egen jurist-bedömning. Min roll: design + risk-flaggor.

---

## 10. Källor

- Befintlig `registrera-foretag.html` rad 254+ (TIC BankID firmatecknare-flow)
- `rut_consents`-tabell schema (Sprint 1 TIC #1)
- Underleverantörsavtal-draft v0.2 (denna sessions leverans)
- EU eIDAS-förordningen (EU 910/2014) — elektroniska signaturer
- Dataskyddslagen 3 kap 10 § — PNR-behandling
- Avtalslagen 36 § + §13 — avtalsändring + jämkning
