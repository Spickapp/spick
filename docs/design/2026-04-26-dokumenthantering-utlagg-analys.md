# Dokumenthantering + artiklar/utlägg — designanalys

**Datum:** 2026-04-26
**Trigger:** Farhad-fråga: "Har du tänkt ut något kring dokumenthantering? Eller artiklar/utlägg? Hur det kan implementeras?"

**Verifierat 2026-04-26:**
- ✅ `dispute_evidence` (RLS-skyddad) — foto-bevis per dispute (Fas 8)
- ✅ `generate-receipt` EF — HTML-kvitto per kund-booking
- ✅ `rut-batch-export-xml` EF — RUT-rapport-XML till SKV
- ❌ Allt annat dokument/utlägg-stöd saknas helt

---

## DEL 1 — Dokumenthantering (10 dokumenttyper)

### 1.1 Vad behöver hanteras (use-cases)

| Dokumenttyp | Vem skapar | Vem läser | Retention | Status idag |
|---|---|---|---|---|
| **Kund-kvitto per booking** | Spick auto | Kund + VD + bokföring | 7 år (BokfL) | ✅ generate-receipt EF |
| **VD-faktura (Spick → cleaner-firma månadsvis för plattformsavgift)** | Spick auto | VD | 7 år | ❌ Finns inte |
| **Underleverantörs-faktura (Spick → städfirma per månad för utförda jobb)** | Spick auto | VD | 7 år | ❌ Saknas (B2B-faktura-modell paus:ad) |
| **Kund-villkor (PDF-version)** | Spick admin | Kund vid registrering | Permanent | ❌ Bara markdown |
| **Underleverantörsavtal (signerat PDF)** | TIC BankID-flow | VD + Spick | 10 år | ◑ Item 1 i progress, signering klar |
| **Försäkringsdokument** | Försäkringsbolag | Kund + VD vid skada | Hela skadeperioden | ❌ Saknas |
| **RUT-XML för SKV** | rut-batch-export-xml | SKV (export) | 7 år (Spick BokfL) | ✅ EF finns, ej testad i prod |
| **Skatte-K10/KU13/KU16-rapporter** | Spick auto årligen | SKV + VD | 7 år | ❌ Saknas |
| **Cleaner-utbildningsbevis (handbok-test)** | Spick auto | Cleaner + VD | Hela anställning | ❌ Test finns men ingen certifikat-PDF |
| **Foto-bevis (incheckning + dispute)** | Cleaner | Admin + VD | 6 mån (PII per Fas 8) | ✅ dispute_evidence |

### 1.2 Föreslagen schema (MVP-version)

**Ny tabell: `documents`** (universal — matar alla typer)
```sql
CREATE TABLE public.documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type   text NOT NULL,    -- 'receipt'|'invoice'|'contract'|'insurance'|'tax_xml'|'training_cert'|'other'
  -- Ägar-FK (XOR — bara en aktiv beroende på typ)
  customer_email  text,
  cleaner_id      uuid REFERENCES cleaners(id),
  company_id      uuid REFERENCES companies(id),
  booking_id      uuid REFERENCES bookings(id),
  -- Storage
  storage_path    text NOT NULL,    -- Supabase storage 'documents/...'
  file_size_bytes integer,
  mime_type       text,
  -- Metadata
  title           text NOT NULL,
  description     text,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,      -- för försäkring/avtal
  retention_until timestamptz,      -- BokfL-deadline
  -- Generering-spår
  generated_by    text,             -- 'auto'|'admin'|'user_upload'
  source_ef       text,             -- 'generate-receipt'|'rut-batch-export-xml'|null
  -- Status
  status          text NOT NULL DEFAULT 'active',  -- 'active'|'archived'|'deleted'
  -- Audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_type_check CHECK (document_type IN
    ('receipt','invoice_to_company','invoice_from_subleverantor','contract','insurance','tax_xml','training_cert','dispute_evidence','other')),
  CONSTRAINT documents_owner_xor CHECK (
    (customer_email IS NOT NULL)::int +
    (cleaner_id IS NOT NULL)::int +
    (company_id IS NOT NULL)::int >= 1
  )
);

CREATE INDEX idx_documents_customer ON documents(customer_email, issued_at DESC) WHERE customer_email IS NOT NULL;
CREATE INDEX idx_documents_company ON documents(company_id, issued_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX idx_documents_cleaner ON documents(cleaner_id, issued_at DESC) WHERE cleaner_id IS NOT NULL;
CREATE INDEX idx_documents_booking ON documents(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_documents_type_active ON documents(document_type, issued_at DESC) WHERE status = 'active';
```

**Storage:** Supabase storage-bucket `documents` (privat, RLS-skyddad).

**RLS-policies:**
- Kund ser sina egna kvitton (matchar customer_email på JWT)
- VD ser sitt företags fakturor + cleaners certifikat
- Cleaner ser sina egna utbildnings-certifikat + utlägg-kvitton
- Admin ser allt

### 1.3 Helper-arkitektur (`_shared/document-store.ts`)

```typescript
async function uploadDocument(opts: {
  type: DocumentType,
  ownerEmail?: string,
  cleanerId?: string,
  companyId?: string,
  bookingId?: string,
  title: string,
  fileBuffer: Uint8Array,
  mimeType: string,
  retentionDays?: number,  // default 7 år för bokföring
}): Promise<{ document_id: string, storage_path: string }>;

async function generateReceiptPdf(bookingId: string): Promise<Uint8Array>;
async function generateInvoiceForCompany(companyId: string, period: string): Promise<Uint8Array>;
async function listDocumentsForOwner(opts: {...}): Promise<Document[]>;
async function archiveExpiredDocuments(): Promise<{ archived: number }>;  // cron
```

---

## DEL 2 — Artiklar/utlägg (cleaner-utlägg-system)

### 2.1 Use-case (verklighet på fält)

**Cleaner Dildora kör hemstädning hos kund:**
1. Tar med egna städkemikalier (köpt på ICA för 89 kr)
2. Använder mikrofiberdukar (ny pack, 49 kr)
3. Kör med bil → 12 km × 2 (tur-och-retur) × 2,50 kr/km = 60 kr i transport
4. Total utlägg per jobb: 198 kr

**Idag:**
- Cleaner får 88% × 800 kr = 704 kr för jobbet
- Utläggen tas från egen ficka → netto 506 kr
- Inget spårande, ingen kompensation

**Önskat flow:**
1. Cleaner tar foto av kvitto med mobil-kamera
2. Kategoriserar (Kemikalier / Verktyg / Transport / Annat)
3. Sparar utlägget mot specifik booking ELLER allmänt månads-utlägg
4. VD ser och godkänner i dashboard
5. Vid utbetalning: + utlägg ovanpå 88% av booking-summan
6. Bokförs separat (inte intäkt, utan reimbursement)

### 2.2 Föreslagen schema

**Ny tabell: `cleaner_expenses`**
```sql
CREATE TABLE public.cleaner_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id      uuid NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  company_id      uuid REFERENCES companies(id) ON DELETE SET NULL,
  booking_id      uuid REFERENCES bookings(id) ON DELETE SET NULL,
  -- Belopp
  amount_ore      integer NOT NULL,
  vat_amount_ore  integer DEFAULT 0,        -- 25% moms standard
  category        text NOT NULL,            -- 'chemicals'|'tools'|'transport'|'parking'|'other'
  description     text NOT NULL,            -- t.ex. "Mikrofiberdukar 6-pack"
  -- Receipt
  receipt_storage_path text,                -- foto av kvitto i Supabase storage
  receipt_mime_type text,
  -- Datum
  expense_date    date NOT NULL,            -- när utlägget skedde
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  -- Status
  status          text NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'rejected'|'paid'
  approved_by_cleaner_id uuid,             -- VD som godkände (cleaner med is_company_owner=true)
  approved_at     timestamptz,
  rejected_reason text,
  paid_in_payout_id uuid,                   -- länk till payout_audit_log när utbetalt
  paid_at         timestamptz,
  -- Audit
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaner_expenses_amount_pos CHECK (amount_ore > 0),
  CONSTRAINT cleaner_expenses_category_check CHECK (category IN
    ('chemicals','tools','transport','parking','other')),
  CONSTRAINT cleaner_expenses_status_check CHECK (status IN
    ('pending','approved','rejected','paid'))
);

CREATE INDEX idx_cleaner_expenses_cleaner ON cleaner_expenses(cleaner_id, expense_date DESC);
CREATE INDEX idx_cleaner_expenses_company_pending ON cleaner_expenses(company_id, status) WHERE status = 'pending';
CREATE INDEX idx_cleaner_expenses_booking ON cleaner_expenses(booking_id) WHERE booking_id IS NOT NULL;
```

**Storage:** Återanvänder `documents`-bucket eller egen `expense-receipts`-bucket.

**Platform settings:**
- `expense_max_per_booking_ore` (default: 50000 = 500 kr — flagga om större)
- `expense_auto_approve_under_ore` (default: 10000 = 100 kr — auto-godkänn små utlägg)
- `expense_categories_enabled` (JSON-array av aktiva kategorier)
- `transport_default_kr_per_km` (default: 25 = 2,50 kr/km — branschpraxis Skatteverket-OK)

### 2.3 Helper-arkitektur (`_shared/expenses.ts`)

```typescript
async function submitExpense(opts: {
  cleanerId: string,
  bookingId?: string,
  amountOre: number,
  vatOre?: number,
  category: ExpenseCategory,
  description: string,
  expenseDate: string,
  receiptFile?: Uint8Array,
  receiptMimeType?: string
}): Promise<{ expense_id: string, status: 'pending' | 'auto_approved' }>;

async function approveExpense(opts: {
  expenseId: string,
  approvedByCleanerId: string,    // VD
}): Promise<{ ok: boolean }>;

async function rejectExpense(opts: {
  expenseId: string,
  rejectedByCleanerId: string,
  reason: string,
}): Promise<{ ok: boolean }>;

async function getCleanerExpenseTotal(cleanerId: string, period: string): Promise<{
  pending_ore: number,
  approved_ore: number,
  paid_ore: number,
}>;

async function settleExpensesAtPayout(opts: {
  cleanerId: string,
  payoutAuditLogId: string,
}): Promise<{ settled_count: number, total_settled_ore: number }>;
```

### 2.4 Frontend-arkitektur

**Cleaner-vy (i `stadare-uppdrag.html` per booking):**
```
[Foto-knapp] 📷 Lägg till utlägg
  ↓ klick →
Modal:
  Kategori: [▼ Kemikalier]
  Beskrivning: [Allrent + golvmedel ICA]
  Belopp: [89] kr
  Moms: [22] kr (25% auto)
  Datum: [2026-04-26]
  Foto: [Ta bild av kvitto] eller [Välj från galleri]
  [Skicka till godkännande]
```

**VD-vy (i `stadare-dashboard.html` Inkomst-tab eller ny Utlägg-tab):**
```
┌─ Pending utlägg från team (3 st, 287 kr) ─────────┐
│  [Foto] Dildora · Hemstädning b1abcdef           │
│         "Allrent + golvmedel" · 89 kr · 2026-04-26│
│         [✓ Godkänn]  [✗ Avslå]  [⋯ Detaljer]    │
│                                                    │
│  [Foto] Nasiba · Storstädning b2xyz789            │
│         "Mikrofiberdukar" · 49 kr · 2026-04-25    │
│         ...                                        │
└────────────────────────────────────────────────────┘

┌─ Månadsöversikt ──────────────────────────────────┐
│  Pending: 287 kr (3 utlägg)                       │
│  Godkända (väntar utbetalning): 1 240 kr (8 ut.)  │
│  Utbetalda denna månad: 5 670 kr (32 ut.)         │
│  [📊 Ladda ner CSV-rapport]                       │
└────────────────────────────────────────────────────┘
```

### 2.5 Utbetalning-integration

I `_shared/money.ts::triggerStripeTransfer`:
```typescript
// Innan Stripe-transfer för en booking:
// 1. Hämta godkända utlägg för cleaner
// 2. Lägg till i transfer-amount
const expenseTotal = await settleExpensesAtPayout({ cleanerId, payoutAuditLogId });
const transferAmount = bookingShareOre + expenseTotal.total_settled_ore;
// 3. Stripe-metadata utökas
metadata.expenses_settled_ore = expenseTotal.total_settled_ore;
metadata.expenses_count = expenseTotal.settled_count;
```

---

## DEL 3 — Risker (rule #30, kräver jurist)

| Risk | Beskrivning | Sannolikhet | Mitigering |
|---|---|---|---|
| **Moms-hantering på utlägg** | Spick återbetalar inkl. moms från cleaners kvitton — kan Spick dra avd. moms? Eller måste cleaner själv? | Hög | Jurist-bedömning. Två modeller: (a) Spick = inköpare, drar moms; (b) Spick = ren reimburser, ingen moms-delning |
| **Skattepliktig ersättning** | Skv kan se utlägg som "lön" om inte tydligt utlägg-flow. F-skatt-firmor ska skicka faktura, inte ta utlägg. | Medel | Tydlig kategorisering. För F-skattare: utlägget ska faktureras separat, inte återbetalas. |
| **BokfL — kvitto-arkivering** | Kvitto-foton MÅSTE sparas digitalt 7 år | Hög (lag) | Storage-retention-policy, ingen DELETE inom 7 år |
| **GDPR — kvitto kan innehålla PII** | Kvitto har butiksnamn, datum, kontonummer (sista siffrorna) | Medel | Retention-policy + access-log + RLS-skydd |
| **Konsumentkreditlagen** | Om Spick förskott:erar utlägg-pengar = lån? | Låg | Återbetalning sker mot framtida intäkt → ej lån i lagens mening |
| **Avtalslagen — utlägg-tak** | Om cleaner submittar 5000 kr/mån utlägg → konflikt | Medel | expense_max_per_booking + expense_auto_approve_under |

---

## DEL 4 — Implementation-sprintar

### Sprint A — Schema + helpers (säker, flag-OFF) ~6-8h
- Migration: 2 tabeller (documents + cleaner_expenses) + 4 platform_settings
- Storage-bucket setup (manuell via Supabase admin)
- `_shared/document-store.ts` + `_shared/expenses.ts` med tester
- RLS-policies
- **Status: kan deployas idag, ingen risk**

### Sprint B — Receipt-utvidgning (~3-4h)
- `generate-receipt` EF utvidgas: spara genererat HTML+PDF i `documents`-tabellen
- Kund-vy i `mitt-konto.html`: lista alla kvitton + nedladdning
- VD-vy: aggregat månadsvis för bokföring

### Sprint C — Cleaner-utlägg-flow (~6-8h)
- Foto-upload-modal i `stadare-uppdrag.html`
- Pending-lista i `stadare-dashboard.html` (VD-only)
- approve/reject-knappar + bulk-actions
- Auto-godkänn under tröskel
- Notifikation vid pending utlägg

### Sprint D — Settlement-integration (~3-4h, kräver jurist-OK)
- `triggerStripeTransfer` utökas att inkludera approved expenses
- payout_audit_log.details får expense_breakdown
- VD ser exakt vad som transfererat (booking-share + expenses)
- CSV-export per period

### Sprint E — Faktura-PDF + arkiv (~5-6h)
- VD-faktura-generator (månadsvis plattformsavgift)
- Underleverantörs-faktura (om B2B-modell aktiveras)
- Avtals-PDF från BankID-signering (Item 1 v0.3-utvidgning)
- Kund-villkor-PDF + integritetspolicy-PDF

**Totalt: ~23-30h över 5 sprintar.**

---

## DEL 5 — Min rekommendation

**Bygg Sprint A + C först (~12-16h)** = grundsystem för utlägg + dokument.

**Skäl:**
1. Sprint A är säker (flag-OFF, ingen money-flow-impact)
2. Sprint C ger DIREKT värde till cleaners (de slipper bekosta egna utlägg)
3. Sprint B är "nice-to-have" — generate-receipt fungerar redan
4. Sprint D kräver jurist-bedömning av moms-hantering FÖRST
5. Sprint E är komplext + kräver jurist (avtal + vidareförfaktura)

**Pausa Sprint D + E tills:**
- Jurist-OK på moms-modell (Sprint D)
- B2B-faktura-modell beslutad (Sprint E §1.2)

**Quick-win utan code:**
Idag skickar `generate-receipt` HTML-mejl. Den kan utvidgas att även arkivera till en simpel `receipts`-tabell utan full `documents`-arkitektur. ~2h. Bra första steg.

---

## DEL 6 — Frågor till Farhad innan bygge

1. **Sprint A+C OK att bygga nu?** (~12-16h, säker)
2. **Utlägg-tak per booking:** 500 kr OK eller annan? (Stora utlägg = manuell granskning)
3. **Auto-godkänn under:** 100 kr OK? (Sparar VD-tid på små köp)
4. **Foto-upload obligatoriskt eller frivilligt?** (BokfL kräver kvitto för avdrag)
5. **Transport-utlägg:** km × kr/km schablon eller faktiskt belopp?
6. **F-skatte-cleaners:** ska dom använda samma utlägg-flow eller fakturera separat?
7. **Kund-villkor-PDF:** generera från markdown nu eller vänta jurist-godkänd v1.0?
8. **Storage-quota:** Supabase fri-quota = 1 GB. Vid 1000 cleaners × 5 utlägg/mån × 200 KB/foto = 1 GB/månad. Behöver paid-tier ($25/mån) inom 1 år.

---

## DEL 7 — Verifiering rule #29 + #31

- ✅ Curl-verifierat 9 dokument-tabeller (alla 404)
- ✅ Curl-verifierat 6 Spick-specifika tabeller (5 × 404, 1 × 401 dispute_evidence)
- ✅ Läst CLAUDE.md för existing EFs (generate-receipt, rut-batch-export-xml)
- ⚠ Moms-modell + F-skatte-handling KRÄVER jurist-bedömning per #30
