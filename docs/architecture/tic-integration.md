# TIC.io Integration — Design (2026-04-25)

**Status:** SKELETT · Backend-skiss innan implementation
**Primärkälla:** https://id.tic.io/docs (verifierat 2026-04-25 via Explore-agent)
**Scope:** #1 SPAR-enrichment via BankID (Fas 7.5 RUT-aktivering) + #2 CompanyRoles + signing-authority för B2B-onboarding (Sprint B utökning)
**Out-of-scope:** OIDC hosted mode, multi-party signing, PropertyOwnership, Income, kreditkontroll/faktura

---

## 0. Varför TIC

Spick har två öppna pain-points som TIC löser:

1. **PNR_FIELD_DISABLED-låsning** (sedan 2026-04-24): Kund kan inte längre lämna klartext-PNR i `boka.html`. Fas 7.5 RUT-aktivering blockerad. TIC SPAR-enrichment hämtar PNR från Skatteverket via BankID-consent → Spick lagrar bara hash + krypterad referens, ALDRIG klartext.

2. **Sprint B `company-self-signup` saknar firmatecknare-verifiering**. Företag kan idag registrera utan att signerande person verifierats som behörig. TIC CompanyRoles + signing-authority-analysis kontrollerar detta automatiskt via BankID + Bolagsverket.

---

## 1. SPAR-enrichment-flow (#1)

### 1.1 Use-case
Kund vill aktivera RUT på `boka.html` → BankID-consent → SPAR-data hämtas → bokning fortsätter med PNR-hash + folkbokföringsadress.

### 1.2 Sequence
```
boka.html (kund klickar "Aktivera RUT")
  ↓ POST /functions/v1/rut-bankid-init
EF rut-bankid-init
  ↓ POST TIC /api/v1/auth/bankid/start
  ← { autoStartToken, sessionId }
  ↓ INSERT rut_consents (status='pending')
boka.html visar BankID-QR/-app + pollar status
  ↓ GET /functions/v1/rut-bankid-status?session_id=X
EF rut-bankid-status (poll)
  ↓ GET TIC /api/v1/auth/{sessionId}/status
  ← { status: 'complete', token: enrichmentToken }
  ↓ POST TIC /api/v1/enrichment { type: 'SPAR' }
  ↓ GET TIC /enrichment/data/{token}
  ← { pnr, full_name, address, municipality_code, protected_identity }
  ↓ UPDATE rut_consents (pnr_hash, spar_data, consumed_at=NOW())
  ↓ Returnera till boka.html: { ok: true, customer_name, address }
boka.html fortsätter checkout med RUT aktivt
  ↓ booking-create läser rut_consents.id för audit-trail
```

### 1.3 Endpoints (EF)
- `rut-bankid-init` (anon, kund-flow): startar TIC BankID-session
- `rut-bankid-status` (anon, polling): kollar status + enrichment

### 1.4 GDPR-/lagligt-grund
**Lagring:** Endast hash + krypterad referens. Klartext-PNR ALDRIG i DB.
**Lagligt grund:** Samtycke via BankID (Skatteverkets RUT-rapportering kräver PNR — kund informerade vid BankID-prompt).
**Audit:** `rut_consents` har consent_text, tic_session_id, consented_at för full audit-trail.

**⚠ Rule #30:** PNR-via-BankID-consent som lagligt grund för RUT-rapportering kräver jurist-OK INNAN production-flip. Konsulteras innan flag aktiveras.

---

## 2. CompanyRoles + signing-authority (#2)

### 2.1 Use-case
Företag registrerar via `company-self-signup` → org-nr + BankID-consent → TIC verifierar styrelse + bekräftar inloggad person är firmatecknare → registrering tillåten.

### 2.2 Sequence
```
foretag.html (företag fyller i org-nr + namn)
  ↓ POST /functions/v1/company-self-signup
EF company-self-signup (utökad)
  ↓ POST TIC /api/v1/auth/bankid/start (signerande person)
  ← { autoStartToken, sessionId }
foretag.html visar BankID-prompt
  ↓ Polling
EF company-self-signup (på complete)
  ↓ POST TIC /api/v1/enrichment { type: 'CompanyRoles', orgNumber: X }
  ← { board, signing_authority }
  ↓ GET /api/v1/data/signing-authority-analysis?regNr=X&pnr=Y
  ← { is_signatory: true/false }
  ↓ Om is_signatory=true:
     INSERT companies (firmatecknare_verified_at=NOW(), firmatecknare_personnr_hash, firmatecknare_full_name)
  ↓ Om false: 403 + "Du är inte registrerad firmatecknare"
```

### 2.3 Endpoint
Utöka existing `company-self-signup` med TIC-anrop. Alternativt: ny EF `company-bankid-verify` om scope växer.

### 2.4 Schema
- `companies.firmatecknare_verified_at timestamptz`
- `companies.firmatecknare_personnr_hash text`
- `companies.firmatecknare_full_name text`
- `companies.firmatecknare_tic_session_id text`

---

## 3. Konfiguration

### 3.1 Supabase secrets (krävs INNAN EF-deploy)
- `TIC_API_KEY` (Bearer-auth till TIC-API)
- `TIC_BASE_URL` (default: `https://id.tic.io`)
- `TIC_ENVIRONMENT` (`test` eller `production`)

### 3.2 Platform_settings flags
- `tic_enabled` ('false' default — flippa till 'true' för aktivering)
- `rut_via_bankid_enabled` ('false' default — flippa när jurist-OK)

### 3.3 Frontend
- `boka.html`: ny RUT-flow-section (BankID-prompt + status-polling)
- `foretag.html` (eller `bli-foretag.html`): BankID-step före submit

---

## 4. Implementations-ordning

| Steg | Komponent | Effort | Beroende |
|---|---|---|---|
| 1 | Studio-SQL (rut_consents + companies-utökning) | 5 min | Farhad kör |
| 2 | TIC-konto + API-key i Supabase secrets | 30 min | Farhad |
| 3 | EF `rut-bankid-init` + `rut-bankid-status` | 4-6h | Steg 1+2 |
| 4 | boka.html RUT-flow-UI | 3-4h | Steg 3 |
| 5 | EF `company-self-signup`-utökning | 2-3h | Steg 1+2 |
| 6 | foretag.html B2B-flow-UI | 2-3h | Steg 5 |
| 7 | E2E-test: full RUT-flow + B2B-flow | 2-4h | Allt ovan |
| 8 | Flag-flip i prod (jurist-OK) | 5 min | Steg 7 |

**Total:** 14-22h (~2-3 arbetsdagar).

---

## 5. Säkerhets-/lagligt-checklist

- [ ] PNR lagras ALDRIG i klartext (rule #30 + GDPR)
- [ ] BankID-consent-text dokumenterar EXAKT vad som hämtas (SPAR vs CompanyRoles)
- [ ] tic_enrichment_token är single-use (TIC-constraint, 30-min fönster)
- [ ] rut_consents.expires_at = NOW() + 30 min vid INSERT (matchar TIC-fönster)
- [ ] consumed_at sätts EFTER lyckad SPAR-fetch → förhindrar replay
- [ ] RLS på rut_consents = service_role-only (EF-flow)
- [ ] firmatecknare_personnr_hash = SHA-256, NEVER lagra klartext
- [ ] Admin-alert vid signing-authority-analysis-fail (potentiell impersonation)
- [ ] Jurist-OK på "PNR-via-BankID-consent som lagligt grund" INNAN tic_enabled='true' i prod

---

## 6. Rollback-plan

| Nivå | Action |
|---|---|
| Mjuk | `UPDATE platform_settings SET value='false' WHERE key='tic_enabled'` — nya flows skippar TIC, befintliga rut_consents-rader oförändrade |
| EF-bug | Revert specifik commit + push (auto-deploy via H18) |
| Schema-rollback | DROP TABLE rut_consents + DROP COLUMN companies.firmatecknare_* (kräver backup) |

---

## 7. Referenser

- TIC Auth API: https://id.tic.io/docs (BankID start/status/sign)
- TIC Enrichment: https://id.tic.io/docs (SPAR/CompanyRoles/IpIntelligence)
- TIC Data Verification: https://id.tic.io/docs (signing-authority-analysis)
- Spick existing: `_shared/encryption.ts` (för pnr-hash via crypto.subtle.digest)
- Fas 7.5 docs: `docs/audits/2026-04-23-rut-infrastructure-decision.md`

---

**Nästa steg:**
1. Farhad kör `supabase/snippets/fas7_5_tic_integration.sql` i Studio (BLOCK 1-4)
2. Farhad sätter `TIC_API_KEY` + `TIC_BASE_URL` i Supabase secrets
3. Säger till Claude → backend-bygge startar
