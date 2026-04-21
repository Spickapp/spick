# Fas 2.7 — B2B-kompatibilitet (kort-only)

> **Status:** Arkitekturdokument för Fas 2.7. Levererat 2026-04-23 tillsammans med §2.7.1 DB-migration.
> **Primärkälla:** Bokföringslag (1999:1078) 5 kap 7§ + Mervärdesskattelag (1994:200) 11 kap 8§ + Skatteverkets riktlinjer för B2B-fakturor 2026.
> **Beslutsfattare:** Farhad Haghighi (projektchef). Designbeslut verifierade i chatt-diskussion 2026-04-23.
> **Scope-typ:** Ny fas, insatt efter Fas 2.5 (RUT/dokument-fix) och före Fas 3 (matching).

---

## 1. Syfte & mål

**Syfte:** Göra Spick B2B-kompatibelt så företagskunder kan boka städtjänster med korrekt fakturering som uppfyller bokföringslag + Mervärdesskattelag. **Kort-only** — ingen fakturabetalning via pappersfaktura/30-dagars-kredit. Stripe tar kortet vid bokning, men Spick utfärdar en formell faktura efteråt som kunden kan ange i sin bokföring.

**Mål efter Fas 2.7:**

- Företag kan boka städning på `boka.html` med fullt utökad fakturainfo (orgnr, VAT-nr, kontaktperson, fakturaadress separat från tjänsteadress, fakturamejl).
- Fakturan (`F-YYYY-NNNNN`) utfärdas automatiskt efter betalning, persisterad i `invoices/`-bucket med serve-invoice EF som rendering-gateway.
- Alla 11 obligatoriska BokfL + MervL-fält rendras.
- F-skatt-status + momsreg.nr visas explicit (kund behöver det för sin egen bokföring).
- Båda prefix (KV- för kvitton till privatperson, F- för fakturor till företag) samexisterar. `generate-receipt` routar baserat på `customer_type`.

## 2. Kontext & motivation

**Varför B2B nu?**

1. **Rafa-pilot skalningen**: företagskunder är en stor del av Rafas befintliga kundbas. Att bara kunna fakturera privatpersoner begränsar pilot-tillväxten.
2. **Revisor-auditens (§2.5-R1) D2-gap**: generate-receipt-EF har företagslogik ([rad 199-209](../../supabase/functions/generate-receipt/index.ts:199)) men ingen formell B2B-faktura med sekventiell nummerserie. R2-kvittot KV- är juridiskt ett kvitto, inte en faktura — företag behöver det senare för bokföring och kan inte använda ett kvitto med `KV-`-prefix i Fortnox/Visma.
3. **RUT-paus (§2.5-minifix + Fas 7.5)**: utan RUT är B2B-flödet enklare att bygga än B2C (ingen RUT-ansökan, ingen Skatteverkets API-integration, ingen PNR-hantering). Fas 2.7 kan rulla ut snabbt medan Fas 7.5 bygger RUT.

**Varför kort-only, inte faktura-kredit?**

- Stripe-integration finns redan — vi återanvänder existerande payment-flödet.
- Ingen cashflow-risk (betalning samtidig med bokning).
- Ingen pappers-kredit-hantering behövs.
- Kunden kan betala med företagskort (Amex, Eurocard) och bokföra mot betalningsdatumet.
- Pappersfaktura med 30-dagars-kredit kommer i framtida Fas (om efterfrågan finns).

## 3. Designprinciper

| Princip | Varför |
|---|---|
| **Additivt, inte destruktivt** | Ingen B2C-regression. `customer_type='privat'`-flödet förblir orört. Alla nya kolumner är NULL-able och populeras bara när `customer_type='foretag'`. |
| **Single source of truth** | Företagsuppgifter (org.nr, VAT-nr, adress) läses från `platform_settings.company_*` (seedade i §2.5-R2). Kundens B2B-data lever på `bookings`-raden. Inga hardcodes. |
| **Semantisk konsistens** | Kvitton (`KV-`) i `receipts/`, fakturor (`SF-` städare, `F-` kund) i `invoices/`. Serve-invoice routar baserat på prefix. |
| **Unique + sekventiell numrering** | Bokföringslag 5 kap 7§. `F-YYYY-NNNNN` via `b2b_invoice_number_seq`. Inget UUID-prefix, ingen årsrollback. |
| **Immutable efter utgiven** | När `invoice_number` satt på en booking är fakturan låst. Refund skapar kreditnota (Fas 2.7.6 eller §2.5-R5), ändrar inte ursprungsfaktura. |
| **Config-driven timezone** | Timezone läses från `platform_settings.company_timezone` (ny nyckel §2.7.1). Matchar designmönstret från R2. |

## 4. Schema-ändringar (§2.7.1)

### 4.1 Nya kolumner på `bookings`

| Kolumn | Typ | Semantik |
|---|---|---|
| `business_vat_number` | `text` NULL | Momsregistreringsnr (SE559402452201-format). Obligatoriskt för fakturor med moms ≥ 2000 kr (MervL 11 kap 8§). |
| `business_contact_person` | `text` NULL | Fakturareferent (t.ex. "Anna Andersson, ekonomi"). Visas som "Att: ..."-rad på fakturan. |
| `business_invoice_email` | `text` NULL | Separat fakturamottagnings-mejl (ofta `faktura@foretag.se`). Om NULL, skickas till `customer_email`. |
| `invoice_address_street` | `text` NULL | Fakturaadress — kan skilja sig från tjänsteadress (huvudkontor vs. städadress). |
| `invoice_address_city` | `text` NULL | Ort för fakturaadress. |
| `invoice_address_postal_code` | `text` NULL | Postnummer för fakturaadress. |
| `invoice_number` | `text` NULL | `F-YYYY-NNNNN`. Partial unique index. NULL för B2C. |

**Befintliga B2B-kolumner** som redan fungerar (ingen ändring):

- `customer_type` (DEFAULT `'privat'`, `'foretag'` för B2B)
- `business_name`
- `business_org_number`
- `business_reference`

**Befintliga duplikat** (ignorerade per scope-not, hygien-task #35 framtida):

- `customer_company_name` (duplikat av `business_name`)
- `customer_org_number` (duplikat av `business_org_number`)

### 4.2 Sequence + RPC

```sql
CREATE SEQUENCE IF NOT EXISTS public.b2b_invoice_number_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.generate_b2b_invoice_number() RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tz text; year_part text; seq_part text;
BEGIN
  SELECT value INTO tz FROM platform_settings WHERE key = 'company_timezone';
  IF tz IS NULL THEN tz := 'Europe/Stockholm'; END IF;
  year_part := TO_CHAR(NOW() AT TIME ZONE tz, 'YYYY');
  seq_part := LPAD(NEXTVAL('public.b2b_invoice_number_seq')::text, 5, '0');
  RETURN 'F-' || year_part || '-' || seq_part;
END; $$;
```

**Namn-motivering:** `generate_b2b_invoice_number` undviker kollision med befintliga `generate_invoice_number()` (returnerar `SF-YYYY-NNNN` för städarfakturor). Klar semantik, framtidssäkert om fler invoice-typer tillkommer.

### 4.3 Unique constraint

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_invoice_number_unique
  ON public.bookings(invoice_number)
  WHERE invoice_number IS NOT NULL;
```

Partial unique — skyddar B2B-serien, tillåter fritt `NULL` för B2C.

### 4.4 GRANTs

Lärdom från §2.5-R2: sequences kräver explicit `GRANT USAGE` för `service_role`.

```sql
GRANT USAGE, SELECT ON SEQUENCE public.b2b_invoice_number_seq
  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_b2b_invoice_number()
  TO service_role, authenticated;
```

## 5. Faktura-prefix-strategi

| Prefix | Syfte | Utfärdare | Mottagare | Storage-bucket |
|---|---|---|---|---|
| `KV-YYYY-NNNNN` | Kvitto (B2C, bevis på betalning) | Spick | Privatperson | `receipts/` |
| `F-YYYY-NNNNN` | Faktura (B2B, bokföringsgrund) | Spick | Företag | `invoices/` |
| `SF-YYYY-NNNN` | Självfaktura (B2B, Spick→städare) | Spick (köpare) | Städare (säljare) | `invoices/` |

**Prefix-routing-logik** i `generate-receipt`-EF (utökas i §2.7.5):

```
om customer_type = 'foretag' → F-serie, invoices-bucket
om customer_type = 'privat'  → KV-serie, receipts-bucket
```

**År i prefix** — börjar om på 00001 vid nytt kalenderår? **Nej.** `b2b_invoice_number_seq` är monotont ökande genom alla år. År i prefix är bara kosmetiskt för mänsklig läsbarhet. Juridiskt krav (obruten sekventiell nummerserie) uppfylls via sequence-monotonicitet. Detta skiljer sig från prod-`generate_invoice_number()` (SF-serien) som räknar MAX+1 per år — mindre robust design som vi inte återupprepar här.

## 6. Storage-strategi

**Befintligt:**

- `receipts/` bucket — skapas av [generate-receipt:91](../../supabase/functions/generate-receipt/index.ts:91), `public=true`. Innehåller `KV-YYYY-NNNNN.html`.
- `invoices/` bucket — skapas av [generate-self-invoice:63-65](../../supabase/functions/generate-self-invoice/index.ts:63), `public=true`. Innehåller `SF-YYYY-NNNN.html`.

**§2.7 tillägg:** `F-YYYY-NNNNN.html` läggs i `invoices/`-bucket tillsammans med `SF-`. Semantisk konsistens — "fakturor är fakturor".

**Serve-invoice regex** ([rad 18](../../supabase/functions/serve-invoice/index.ts:18)) utökas i §2.7.5 från `/^(SF|KV)-\d{4}-\d{4,5}\.(html|pdf)$/` till `/^(SF|KV|F)-\d{4}-\d{4,5}\.(html|pdf)$/`. Routing per prefix: `KV-` → `receipts/`, `SF-|F-` → `invoices/`.

## 7. Pricing-flöde för B2B

**Total_price-semantik skiljer sig från B2C:**

| Kundtyp | `total_price` | `rut_amount` | Moms |
|---|---|---|---|
| B2C (privat) | Efter RUT | > 0 om RUT tillämpas | Inkluderad i priset |
| B2B (företag) | Fullt pris | 0 | Inkluderad i priset (visas separat på faktura) |

**Kund-pris per timme** (`customer_price_per_hour`) är alltid inkl moms. Fakturan visar:

- Arbetskostnad exkl. moms (`total_price / 1.25`)
- Moms 25 % (`total_price - exkl`)
- Totalt inkl. moms (`total_price`)

**Inga RUT-rader** i B2B-fakturan. RUT är bara för privatpersoner.

## 8. Moms-hantering

**Standard:** 25 % moms på städtjänster (SNI 81.210). Samma sats B2B som B2C.

**Edge cases (ej implementerade i §2.7.1):**

1. **Moms-undantag vid omvänd skattskyldighet inom byggsektorn** — irrelevant för städning.
2. **EU-kund utan svensk moms (B2B cross-border)** — `business_vat_number` utanför `SE`-prefix. I så fall: moms 0 %, "reverse charge"-klausul på fakturan. **Skippas i §2.7.1**; antas att endast svenska företagskunder bokar (Rafa-pilot är lokal). Framtida hygien-task om efterfrågan finns.
3. **Momsfritt företag** — ideella föreningar etc. Skippas tills konkret case dyker upp.

**Skatteverket-krav vid moms ≥ 2000 kr:** fakturan **måste** visa kundens VAT-nr. `business_vat_number`-kolumnen finns från §2.7.1. Validering att fältet är ifyllt för stora fakturor införs i `boka.html` i §2.7.3.

## 9. F-skatt + företagets bokföring

**F-skatt-uppgift obligatorisk** på alla fakturor (MervL 11 kap 8§). Läses från `platform_settings.company_f_skatt` (seedad i R2).

**Momsreg.nr-rad:** `SE559402452201` från `platform_settings.company_vat_number`.

**SNI-kod:** `81.210` från `platform_settings.company_sni_code`. Hjälper företagskunden kategorisera kostnaden i sin bokföring.

**Fakturans juridiska betydelse:** med alla 11 fält korrekt är fakturan giltig grund för företagskundens moms-avdrag och kostnadsbokföring. Kundens ansvar att registrera i sitt eget bokföringssystem (Fortnox, Visma, eEkonomi).

## 10. Payment-flöde (kort-only)

**Flöde — oförändrat från B2C bortsett från datainsamling:**

1. `boka.html` — kund fyller i företagsinfo (§2.7.3).
2. Stripe Checkout — kortbetalning (Visa, MC, Amex, Eurocard, Klarna).
3. `stripe-webhook` — triggar `generate-receipt` (utökad i §2.7.5 för F-prefix).
4. `generate-receipt` — läser `customer_type`, bygger korrekt dokument (KV eller F), uppladdar till rätt bucket, skickar mejl.
5. Kund får F-faktura via `business_invoice_email` (eller `customer_email` fallback).

**Inga nya Stripe-integrationer** behövs. Samma `customer_type='foretag'`-path som redan finns idag utökas med formell faktura istället för kvitto.

## 11. Sub-faser

| Sub-fas | Omfattning | Estimat | Beroenden |
|---|---|---:|---|
| **§2.7.1** | DB-migration: 7 kolumner + sequence + RPC + company_timezone + serve-invoice i deploy-yml | 1-2h | Ingen |
| **§2.7.2** | UI-form för B2B-data i `boka.html` (utökad `customer_type='foretag'`-panel) | 2-3h | §2.7.1 |
| **§2.7.3** | Client-side validering (VAT-format, obligatoriska fält vid stor moms) + booking-create-EF uppdateras att lagra nya kolumner | 2-3h | §2.7.2 |
| **§2.7.4** | `generate-receipt`-EF utökas: läs `customer_type`, routa prefix/bucket, rendera F-faktura-mall med alla 11 fält + B2B-sektioner | 3-4h | §2.7.1 |
| **§2.7.5** | `serve-invoice`-EF utökas: regex + bucket-mapping för F-prefix | 30 min | §2.7.4 |
| **§2.7.6** | Admin-UI för B2B-faktura-hantering (visa, resend, kreditnota-placeholder) + E2E-test | 2-3h | §2.7.4 |

**Total: 10-15 timmar** över 6 commits. Kortare än §2.5 (R1-R5) tack vare återanvändning av R2-infrastrukturen.

## 12. Scope-gränser

**§2.7 gör INTE:**

- Pappersfaktura med kredit (30-dagars-betalning). Framtida fas.
- EU cross-border B2B med omvänd skattskyldighet. Framtida edge case.
- Påminnelseflöde för obetalda fakturor (finns inte, kort-only = alltid betalt).
- Integration mot Fortnox/Visma-API för auto-export. Kunden laddar ner själv.
- Kreditnota vid refund — det är §2.5-R5 eller §2.7-utökning senare.

**§2.7 rör INTE:**

- Befintliga B2C-flöden (KV-kvitton, RUT-ansökan).
- `faktura.html` (on-the-fly rendering). Det är §2.5-R4.
- `generate-self-invoice` (städar-självfakturor).
- Fas 3 matching-algoritm.
- Fas 7.5 RUT-infrastruktur.

## 13. Review-notes (designavvägningar)

### 13.1 Varför inte samma sequence som KV-serien?

Övervägt: låta B2C `KV-` och B2B `F-` dela sequence → 00001 nästa utgiven oavsett typ.

**Förkastat** — bokföringsmässigt ska varje serie vara sammanhängande. `F-2026-00002` hoppa från `F-2026-00001` skulle kräva kontext (finns KV mellan?). Separata sequences = renare.

### 13.2 Varför partial unique index, inte NOT NULL?

`invoice_number` ska bara finnas på B2B-rader. B2C-rader har `receipt_number` istället. NOT NULL skulle tvinga B2C att också få ett invoice_number → bryter prefix-separation.

Partial unique (`WHERE invoice_number IS NOT NULL`) ger båda: B2B får unik serie, B2C får NULL utan collision.

### 13.3 Varför inte lagra invoice-HTML på `bookings.invoice_url`?

Övervägt: ny kolumn `invoice_url` analog med `receipt_url`.

**Förkastat för §2.7.1** — kolumnen behövs men läggs till i §2.7.4 samtidigt som EF:n som populerar den. Minskar risk för dangling-kolumn under flera commits.

Lägg till i §2.7.4: `invoice_url text`, `invoice_email_sent_at timestamptz` (analog med R2-idempotens).

### 13.4 Varför `SECURITY DEFINER` på RPC:n?

`generate_b2b_invoice_number()` måste nå `platform_settings` (RLS public read) + sequence (GRANT service_role+authenticated). Anonyma användare via `boka.html` skall inte kunna anropa — endast `authenticated` + `service_role` har EXECUTE. `SECURITY DEFINER` med fast `search_path` är standardmönster som matchar befintliga Spick-RPCs.

### 13.5 Varför inte `IDENTITY`-kolumn istället för sequence?

`IDENTITY` är modernare men funktionellt ekvivalent med `SERIAL + sequence`. Prod använder sequences konsekvent (3 i production). Behålla mönstret = mindre kognitiv börda.

## 14. Scenario-analys

### Scenario 1: Svenskt AB bokar hemstädning 500 kr

- `customer_type='foretag'`, `business_name='Acme AB'`, `business_org_number='556677-8899'`.
- Stripe Checkout → paid.
- `generate-receipt` (§2.7.4) ser `customer_type='foretag'` → anropar `generate_b2b_invoice_number()` → `F-2026-00001`.
- F-faktura genereras, lagras i `invoices/F-2026-00001.html`, skickas via mejl.
- Kund importerar i Fortnox med F-prefix som referens.

### Scenario 2: Privatperson bokar samtidigt

- `customer_type='privat'`.
- Samma flöde som R2 idag → `KV-2026-NNNNN` (nästa nummer i KV-serien).
- **Ingen sequence-konflikt** med B2B — separata sequences.

### Scenario 3: Företagskund med stor faktura (moms > 2000 kr)

- Total 10 000 kr, moms 2 000 kr.
- §2.7.3 validering: `business_vat_number` obligatoriskt för denna faktura.
- Om saknas: boka.html visar fel, bokning skickas inte.
- Efter valid VAT-nr: flödet fortsätter som scenario 1.

### Scenario 4: Företag utan VAT-nr (ideell förening)

- `business_vat_number IS NULL`.
- §2.7.3 tillåter om moms < 2000 kr.
- Faktura visar "Ingen momsreg.nr angiven — kund ansvarar för egen momshantering".
- Edge case — konkret implementation i §2.7.4.

### Scenario 5: Refund efter F-faktura utgiven

- Fakturan är immutable efter `invoice_number` satt.
- Stripe-refund EF körs som vanligt.
- **Kreditnota skapas INTE i §2.7** — det är §2.5-R5 eller separat §2.7.7.
- Admin får notis att manuell kreditnota behövs i bokföringssystemet.

### Scenario 6: Auto-retry vid fel i generate-receipt

- §2.7.4 återanvänder R2-idempotens-mönstret (`receipt_email_sent_at` → ny `invoice_email_sent_at`).
- Fallback-flöde i stripe-webhook (från §2.5-R2) triggar om EF fel → admin-notis + kund får enkel bekräftelse.
- Nästa manuell eller cron-retry av generate-receipt fortsätter där den slutade (idempotent).

---

## Appendix A — Sub-fas-dependency-graf

```
§2.7.1 (DB-schema) ─────┐
                         ├──→ §2.7.2 (UI-form) ───→ §2.7.3 (validering + booking-create)
                         └──→ §2.7.4 (generate-receipt) ───┐
                                                            ├──→ §2.7.5 (serve-invoice regex)
                                                            └──→ §2.7.6 (admin-UI + E2E)
```

## Appendix B — Referenser

- [docs/audits/2026-04-23-revisor-audit-dokument-flow.md](../audits/2026-04-23-revisor-audit-dokument-flow.md) — D1-D5 dokument-inventering som motiverar F-serien
- [docs/architecture/money-layer.md](../architecture/money-layer.md) §18 — R2-infrastruktur som §2.7 bygger vidare på
- [docs/v3-phase1-progress.md](../v3-phase1-progress.md) — progress-tracking + hygien-tasks
- Bokföringslag (1999:1078) 5 kap 7§
- Mervärdesskattelag (1994:200) 11 kap 8§
- Skatteverket: "Så fakturerar du" 2026
