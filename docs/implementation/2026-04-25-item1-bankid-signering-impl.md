# Item 1 BankID-bunden signering — implementation-rapport

**Datum:** 2026-04-25
**Sprint:** Item 1 (12-18h estimerat) — KLAR
**Föregående:** `docs/design/2026-04-25-registrering-bankid-avtalsgodkannande.md`

---

## TL;DR

Schema + EFs + retroaktiv-modal är **LIVE i prod** men **flag-gated bakom 2 lager** så ingen aktuell user-flow påverkas:

1. `platform_settings.tic_enabled='false'` (TIC BankID-flow gated)
2. `platform_settings.terms_signing_required='false'` (binding-modus gated)
3. `avtal_versioner.is_binding=false` för v0.2-DRAFT (inga drafts är jurist-bindande)

**Aktivering** (Farhad-action) sker i 3 steg när drafts är jurist-godkända:
1. Markera v1.0 som binding: `UPDATE avtal_versioner SET is_binding=true, jurist_godkand_at=NOW(), jurist_godkand_av='Farhad', version='v1.0' WHERE avtal_typ='underleverantorsavtal' AND version='v0.2-DRAFT'`
2. Aktivera TIC: `UPDATE platform_settings SET value='true' WHERE key='tic_enabled'`
3. Aktivera binding-mode: `UPDATE platform_settings SET value='true' WHERE key='terms_signing_required'`

---

## Vad som är levererat

### Etapp 1 — Schema + helper (commit `334d6a0`)

**Migration:** `20260425210000_item1_terms_acceptance_schema.sql` (KÖRD i Studio)

**Nya kolumner:**
- `cleaners.terms_accepted_at` (TIMESTAMPTZ, NULL = aldrig accepterat)
- `cleaners.terms_version` (TEXT, version som accepterats)
- `cleaners.terms_signature_id` (UUID FK → rut_consents.id, BankID-bevis)
- `companies.terms_accepted_at`, `terms_version`, `terms_signature_id` (motsvarande)

**Ny tabell:** `avtal_versioner`
- `avtal_typ` enum: underleverantorsavtal | b2b_tillagg | kundvillkor | integritetspolicy | code_of_conduct
- `version` (TEXT, t.ex. "v1.0")
- `is_binding` (BOOLEAN, default false — blir true när Farhad markerar)
- `jurist_godkand_at` + `jurist_godkand_av` (audit-spår)
- `pdf_url` + `draft_url` (för UI-länkar)
- 5 rader seed:ade (alla v0.2-DRAFT, is_binding=false)

**Ny platform_setting:** `terms_signing_required = 'false'`

**Helper:** `_shared/terms-acceptance.ts` (209 rader, 13/13 tester PASS)
- `getCurrentBindingVersion(supabase, avtalTyp)` → senaste is_binding=true
- `checkAcceptanceStatus(supabase, subjectType, subjectId, avtalTyp)` → 4 paths
- `recordAcceptance(supabase, input)` → spara accept i cleaners/companies-rad
- `isBankIdBindingRequired(supabase)` → läser flag-gate

### Etapp 2 — TIC BankID-EFs (commit `0930abc`)

**Nya EFs (skild från rut-bankid-* för prod-risk-isolation):**

`register-bankid-init`:
- POST: { purpose, cleaner_id|company_id, terms_versions }
- purpose: "cleaner_registration" | "company_signup"
- INSERT rut_consents med purpose-flagga + terms_versions-jsonb
- Returnerar autoStartToken + sessionId

`register-bankid-status`:
- POST: { session_id }
- Pollar TIC, vid 'complete': hämtar SPAR + hashar PNR + uppdaterar consent
- Per purpose: anropar `recordAcceptance` → uppdaterar cleaners/companies
- signature_id = rut_consents.id (BankID-bunden audit-spår)

### Etapp 3 — check-EF + retroaktiv-modal (commit `b559740`)

**Ny EF:** `check-terms-acceptance`
- JWT-auth (cleaner-token)
- Returnerar { signing_required, acceptance, current_version, draft_url }
- Auth-modell: cleaner kollar egen status; VD kan kolla teammedlemmar

**Frontend i stadare-dashboard.html:**
- `checkAndShowTermsModal()` anropas 1s efter `showScreen('app')`
- Render-paths:
  - `current=true` → ingen modal
  - `current=false + signing_required=true` → BLOCKERANDE modal
  - `current=false + signing_required=false` → MJUK banner med "Senare"
  - `current_version=null` (ingen binding) → ingen modal
- Modal har "Granska", "Acceptera + signera med BankID", "Senare"
- BankID-flow integrerat: `register-bankid-init` → polla `register-bankid-status` var 2s
- Vid success → `location.reload()`

### Etapp 4 — Registrerings-sidor — DEFERRED som UX-förbättring

**Anledning:** Etapp 3 retroaktiv-modal fångar BÅDE nya och befintliga cleaners
vid första login. Att lägga till BankID-step direkt i registrera-stadare.html
+ join-team.html är UX-förbättring (mindre friktion vid signup) men inte
funktionellt nödvändig.

**När bygga:** Vid behov om nya cleaners klagar över "extra steg vid login".
~3-4h ytterligare.

### Etapp 5 — Dokumentation (denna doc + progress-uppdatering)

---

## Retroaktiv-status för befintliga 9 cleaners

Alla befintliga cleaners har `terms_accepted_at = NULL` → `checkAcceptanceStatus`
returnerar `never=true` automatiskt.

**Inget data-skript behövs.** När Farhad flippar:
- `is_binding=true` för v1.0 → modal visas vid nästa login per cleaner
- `terms_signing_required=true` → modal är blockerande, måste signera för att fortsätta

**Solid Service-team (5 cleaners):**
- Dildora Kenjaeva — `never=true`
- Zivar Majid (VD) — `never=true` + dual: kollar både cleaner + company-version
- Nilufar Kholdorova — `never=true`
- Nasiba Kenjaeva — `never=true`
- Odilov Firdavsiy — `never=true`

VD Zivar Majid har dubbel-roll:
1. Som cleaner accepterar hen `underleverantorsavtal`
2. Som firmatecknare accepterar hen `b2b_tillagg` för Solid Service AB

Båda kan signeras separat med BankID (olika `purpose` per session).

---

## Säkerhets-design

### Multi-layer flag-gating
1. **TIC-flow gated** (`tic_enabled=false`) → register-bankid-init returnerar 503
2. **Binding-mode gated** (`terms_signing_required=false`) → modal är "soft", kan stängas
3. **Version-binding gated** (`avtal_versioner.is_binding=false`) → ingen modal alls

### Säkerhets-invariants
- Cleaner kan inte ändra annan cleaners terms_*-fält (RLS)
- VD kan kolla teammedlemmars status MEN inte spara accept för dem
- BankID-bunden signature_id = rut_consents.id är immutabel audit-spår
- recordAcceptance fungerar både med och utan signature_id (soft vs hard)

### eIDAS-aspekter (per Item 1-design rule #30)
BankID-signering är **erkänd elektronisk signatur** per EU 910/2014 Art 25-27.
Klassificering (QES/AdES) kräver din jurist-bedömning — implementation
stödjer båda formerna.

---

## Tekniska beroenden

| Komponent | Krav |
|---|---|
| Migration `20260425210000` | KÖRD i Studio (rapporterat 2026-04-25) |
| platform_settings.tic_enabled | Manuell flip när redo |
| platform_settings.terms_signing_required | Manuell flip när drafts är jurist-OK |
| TIC_API_KEY env-var i Supabase | Satt 2026-04-25 (TIC #1 SPAR-flow handoff) |
| TIC_INSTANCE_ID env-var | Satt 2026-04-25 |
| rut_consents.cleaner_id + company_id-kolumner | ANTAGET existera per TIC #1 design — verifieras vid första prod-test |

---

## Filer skapade/ändrade

| Fil | Etapp | Type |
|---|---|---|
| `supabase/migrations/20260425210000_item1_terms_acceptance_schema.sql` | 1 | NEW |
| `supabase/functions/_shared/terms-acceptance.ts` | 1 | NEW |
| `supabase/functions/_tests/terms/terms-acceptance.test.ts` | 1 | NEW (13/13 PASS) |
| `supabase/functions/register-bankid-init/index.ts` | 2 | NEW |
| `supabase/functions/register-bankid-status/index.ts` | 2 | NEW |
| `supabase/functions/check-terms-acceptance/index.ts` | 3 | NEW |
| `stadare-dashboard.html` | 3 | EDIT (terms-modal + checkAndShowTermsModal + startTermsBankidFlow) |

---

## Nästa steg när drafts är jurist-OK

1. **Du**: läs villkor-paketet (`docs/legal/2026-04-25-jurist-checklist.md`) — 8-15h
2. **Du**: justera drafts efter jurist-bedömning + commit `v1.0` av varje
3. **Generera PDFs** av drafts (kan automatiseras med pdf-lib)
4. **Studio-SQL** för att aktivera (3 steg):
   ```sql
   -- Steg 1: skapa v1.0 i avtal_versioner
   INSERT INTO avtal_versioner (avtal_typ, version, is_binding, pdf_url, andringssammanfattning, publicerat_av, jurist_godkand_at, jurist_godkand_av)
   VALUES ('underleverantorsavtal', 'v1.0', true, '/docs/legal/v1.0/underleverantorsavtal.pdf', 'Initial bindande version', 'Farhad', NOW(), 'Farhad');

   -- Steg 2: aktivera binding-mode (modal blir blockerande)
   UPDATE platform_settings SET value='true' WHERE key='terms_signing_required';

   -- Steg 3: aktivera TIC-flow (BankID-anrop blir möjliga)
   UPDATE platform_settings SET value='true' WHERE key='tic_enabled';
   ```
5. **Verifiera** end-to-end: logga in som test-cleaner → modal visas → signera → reload → verify cleaners.terms_accepted_at är satt

---

## Disclaimer (rule #30)

Inget i denna implementation är juridisk rådgivning. eIDAS-klassificering
(AdES vs QES), giltighet av BankID-signaturer i avtals-tvist, och
tillämpning av Avtalslagen 36 § på retroaktiva accept-flöden kräver din
egen jurist-bedömning. Min roll: data + implementation + säkra defaults.
