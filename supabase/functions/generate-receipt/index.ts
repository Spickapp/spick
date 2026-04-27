// ═══════════════════════════════════════════════════════════════
// SPICK – Kundkvitto (Customer Receipt HTML + Email)
//
// Fas 2.5-R2 (2026-04-23): Utökad att skicka bokföringslag-kompatibelt
// kvittomejl till kund. Tidigare genererade bara HTML till storage.
//
// Flöde:
//   1. Fetch booking + platform_settings (företagsuppgifter)
//   2. IDEMPOTENS (F-R2-7):
//      (a) receipt_email_sent_at satt       → return early (allt klart)
//      (b) receipt_url satt, email_sent NULL → skip HTML-gen, skicka mejl
//      (c) annars                            → full flow
//   3. Generera HTML + upload till storage (webbversion)
//   4. Skicka kvittomejl till kund via wrap()-mall
//   5. UPDATE bookings (receipt_url, receipt_number, receipt_email_sent_at)
//
// Error-handling: sendEmail-fel loggas + admin notifieras, men returnerar
// 200 så stripe-webhook inte triggar sin fallback (URL finns och kan
// återanvändas). 500 returneras bara vid total misslyckande (storage upload).
//
// Anropas av stripe-webhook SYNKRONT efter checkout.session.completed.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, sendEmail, wrap, ADMIN, getMaterialInfo, type EmailAttachment } from "../_shared/email.ts";
import { generateMagicShortUrl } from "../_shared/send-magic-sms.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RUT_OMBUD = true;

// ─── Platform settings-helpers ──────────────────────────────
// Läser företagsuppgifter från platform_settings (Regel #28, single
// source of truth). Fallback-defaults matchar dagens hardcodes så
// systemet fungerar även om seed-migrationen av någon anledning
// inte har körts i prod än.

interface CompanyInfo {
  legalName: string;
  tradeName: string;
  orgNumber: string;
  vatNumber: string;
  address: string;
  sniCode: string;
  fSkatt: boolean;
  email: string;
  website: string;
}

async function fetchCompanyInfo(
  supabase: ReturnType<typeof createClient>,
): Promise<CompanyInfo> {
  const keys = [
    "company_legal_name", "company_trade_name", "company_org_number",
    "company_vat_number", "company_address", "company_sni_code",
    "company_f_skatt", "company_email", "company_website",
  ];

  const { data } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", keys);

  const m = new Map<string, string>();
  (data || []).forEach((row: { key: string; value: string }) => m.set(row.key, row.value));

  return {
    legalName:  m.get("company_legal_name")  || "Haghighi Consulting AB",
    tradeName:  m.get("company_trade_name")  || "Spick",
    orgNumber:  m.get("company_org_number")  || "559402-4522",
    vatNumber:  m.get("company_vat_number")  || "SE559402452201",
    address:    m.get("company_address")     || "Solna, Sverige",
    sniCode:    m.get("company_sni_code")    || "81.210",
    fSkatt:     m.get("company_f_skatt")     === "true",
    email:      m.get("company_email")       || "hello@spick.se",
    website:    m.get("company_website")     || "spick.se",
  };
}

serve(async (req) => {
  const CORS = corsHeaders(req);

  function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const bookingId = body.booking_id;

    if (!bookingId) return json(400, { error: "booking_id krävs" });

    console.log("[RECEIPT] Processing booking:", bookingId);

    // 1. Fetch booking
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (bErr || !booking) return json(404, { error: "Bokning ej hittad: " + (bErr?.message || bookingId) });

    // §2.7.4: Dokumenttyp-gren. customer_type='foretag' → FAKTURA (F-serie)
    // i invoices-bucket. Privat → KVITTO (KV-serie) i receipts-bucket.
    // Återanvänder receipt_url + receipt_email_sent_at för båda flöden
    // (Regel #28, ingen kolumnfragmentering — se B-15-beslut).
    const isB2B = String(booking.customer_type || "").toLowerCase() === "foretag";
    const existingNumber: string | null = isB2B
      ? (booking.invoice_number as string | null)
      : (booking.receipt_number as string | null);

    // ── F-R2-7 IDEMPOTENS (återanvänd från R2, utökad för B2B) ──
    // Steg (a): Mejl redan skickat → inget att göra
    if (booking.receipt_email_sent_at) {
      console.log("[RECEIPT] Email already sent at", booking.receipt_email_sent_at, "— skipping");
      return json(200, {
        success: true,
        already_sent: true,
        is_b2b: isB2B,
        document_number: existingNumber,
        receipt_url: booking.receipt_url,
      });
    }

    const company = await fetchCompanyInfo(supabase);

    // Steg (b): HTML finns men mejl INTE skickat → skippa HTML-gen, skicka mejl
    // E3-skydd: ingen regenerering av invoice_number/receipt_number (sekvensvärde skyddas).
    if (booking.receipt_url && existingNumber) {
      console.log("[RECEIPT] Document exists but email not sent — sending email only (isB2B=" + isB2B + ")");
      const d = buildReceiptData(booking, existingNumber);
      const ctx = await buildEmailContext(supabase, booking);
      const emailResult = isB2B
        ? await sendInvoiceEmail(d, company, booking.receipt_url as string, ctx)
        : await sendReceiptEmail(d, company, booking.receipt_url as string, ctx);

      if (emailResult.ok) {
        await supabase.from("bookings").update({
          receipt_email_sent_at: new Date().toISOString(),
        }).eq("id", bookingId);
      } else {
        await notifyAdminEmailFailure(bookingId, d.customerEmail, emailResult.error, isB2B);
      }

      return json(200, {
        success: true,
        email_sent: emailResult.ok,
        email_error: emailResult.error,
        is_b2b: isB2B,
        document_number: existingNumber,
        receipt_url: booking.receipt_url,
      });
    }

    // Steg (c): Full flow — generera nummer via rätt RPC, upload till rätt bucket, skicka mejl
    const rpcName = isB2B ? "generate_b2b_invoice_number" : "generate_receipt_number";
    const { data: numData, error: rnErr } = await supabase.rpc(rpcName);
    if (rnErr) {
      console.error(`[RECEIPT] ${rpcName} error:`, rnErr.message);
      return json(500, { error: `Kunde inte generera dokumentnummer: ${rnErr.message}` });
    }
    const documentNumber = numData as string;
    console.log(`[RECEIPT] Document number (${isB2B ? "FAKTURA" : "KVITTO"}):`, documentNumber);

    const d = buildReceiptData(booking, documentNumber);

    // Bucket-val per §2.7-arkitektur (B-2-beslut): F- + SF- i invoices/, KV- i receipts/
    const targetBucket = isB2B ? "invoices" : "receipts";

    // Ensure storage bucket exists (idempotent — skapar bara om saknas)
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b: { name: string }) => b.name === targetBucket)) {
      await supabase.storage.createBucket(targetBucket, { public: true });
    }

    // Generera rätt HTML-mall per dokumenttyp
    const html = isB2B ? buildInvoiceHtml(d, company) : buildReceiptHtml(d, company);
    const fileName = `${documentNumber}.html`;

    const { error: uploadErr } = await supabase.storage
      .from(targetBucket)
      .upload(fileName, new TextEncoder().encode(html), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[RECEIPT] Upload error:", uploadErr.message);
      return json(500, { error: `Kunde inte ladda upp dokument: ${uploadErr.message}` });
    }

    const { data: urlData } = supabase.storage.from(targetBucket).getPublicUrl(fileName);
    const documentUrl = urlData.publicUrl;
    console.log("[RECEIPT] HTML uploaded:", documentUrl);

    // Skicka mejl — dubbel-mejl om B2B med separat faktura-email (E1)
    const ctx = await buildEmailContext(supabase, booking);
    const emailResult = isB2B
      ? await sendInvoiceEmail(d, company, documentUrl, ctx)
      : await sendReceiptEmail(d, company, documentUrl, ctx);

    // UPDATE bookings med rätt nummer-kolumn (invoice_number för B2B, receipt_number för B2C).
    // Motsatt kolumn förblir NULL (mutually exclusive per B-15).
    const updatePayload: Record<string, unknown> = {
      receipt_url: documentUrl,
    };
    if (isB2B) {
      updatePayload.invoice_number = documentNumber;
    } else {
      updatePayload.receipt_number = documentNumber;
    }
    if (emailResult.ok) {
      updatePayload.receipt_email_sent_at = new Date().toISOString();
    }
    await supabase.from("bookings").update(updatePayload).eq("id", bookingId);

    if (!emailResult.ok) {
      await notifyAdminEmailFailure(bookingId, d.customerEmail, emailResult.error, isB2B);
    }

    // §2.7.4: Minimal B2B-logging (GDPR — inga fria värden, bara flags/counts)
    if (isB2B) {
      const separateInvoiceEmail = !!d.bizInvoiceEmail
        && d.bizInvoiceEmail.toLowerCase() !== d.customerEmail.toLowerCase();
      console.log("[RECEIPT] B2B invoice generated:", {
        booking_id: bookingId,
        invoice_number: documentNumber,
        has_separate_invoice_email: separateInvoiceEmail,
        emails_sent_count: separateInvoiceEmail ? 2 : 1,
        email_ok: emailResult.ok,
      });
    }

    return json(200, {
      success: true,
      email_sent: emailResult.ok,
      email_error: emailResult.error,
      is_b2b: isB2B,
      document_number: documentNumber,
      receipt_url: documentUrl,
    });
  } catch (e) {
    console.error("[RECEIPT] Error:", (e as Error).message);
    return json(500, { error: (e as Error).message });
  }
});

// ─── Types ──────────────────────────────────────────────────

interface ReceiptData {
  // Generiska fält (båda flöden)
  documentNumber: string;        // §2.7.4: ersätter receiptNumber — innehåller KV- eller F-prefix
  receiptDate: string;
  bookingDate: string;
  bookingTime: string;
  service: string;
  hours: number;
  address: string;               // Tjänste-adress (för B2C = kundadress)
  customerName: string;
  customerEmail: string;
  isCompany: boolean;
  companyName: string;
  companyOrg: string;
  companyRef: string;
  totalPrice: number;
  amountPaid: number;
  rutAmount: number;
  isRut: boolean;
  paymentMethod: string;
  cleanerName: string;
  bookingId: string;
  // §2.7.4 B2B-utökning (populeras bara när isCompany=true)
  bizVatNumber:       string;
  bizContactPerson:   string;
  bizInvoiceEmail:    string;
  invoiceAddrStreet:  string;
  invoiceAddrCity:    string;
  invoiceAddrPostal:  string;
}

function buildReceiptData(booking: Record<string, unknown>, documentNumber: string): ReceiptData {
  const isCompany = String(booking.customer_type || "").toLowerCase() === "foretag";
  const rutAmount = Number(booking.rut_amount || 0);
  const isRut = !isCompany && rutAmount > 0;

  return {
    documentNumber,
    receiptDate:   new Date().toISOString().split("T")[0],
    bookingDate:   String(booking.booking_date || ""),
    bookingTime:   String(booking.booking_time || ""),
    service:       translateService(String(booking.service_type || "")),
    hours:         Number(booking.booking_hours || 0),
    address:       String(booking.customer_address || ""),
    customerName:  String(booking.customer_name || ""),
    customerEmail: String(booking.customer_email || ""),
    isCompany,
    companyName:   String(booking.business_name || ""),
    companyOrg:    String(booking.business_org_number || ""),
    companyRef:    String(booking.business_reference || ""),
    totalPrice:    Number(booking.total_price || 0),
    amountPaid:    Number(booking.amount_paid || booking.total_price || 0),
    rutAmount,
    isRut,
    paymentMethod: String(booking.payment_method || "card"),
    cleanerName:   String(booking.cleaner_name || ""),
    bookingId:     String(booking.id || ""),
    // B2B (§2.7.4) — null-fält blir tomma strängar för mall-enkelhet
    bizVatNumber:       String(booking.business_vat_number || ""),
    bizContactPerson:   String(booking.business_contact_person || ""),
    bizInvoiceEmail:    String(booking.business_invoice_email || ""),
    invoiceAddrStreet:  String(booking.invoice_address_street || ""),
    invoiceAddrCity:    String(booking.invoice_address_city || ""),
    invoiceAddrPostal:  String(booking.invoice_address_postal_code || ""),
  };
}

// ─── Email-hantering ────────────────────────────────────────

interface EmailContext {
  autoConfirm: boolean;
  cleanerFullName: string;
  cleanerAvgRating: string;
  magicLink: string;
  materialCustomerText: string;
  materialEmoji: string;
}

async function buildEmailContext(
  supabase: ReturnType<typeof createClient>,
  booking: Record<string, unknown>,
): Promise<EmailContext> {
  let cleanerFullName = String(booking.cleaner_name || "Din städare");
  let cleanerAvgRating = "5.0";
  let autoConfirm = false;

  if (booking.cleaner_id) {
    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("full_name, avg_rating, total_jobs, tier")
      .eq("id", booking.cleaner_id)
      .maybeSingle();
    if (cleaner) {
      cleanerFullName = String(cleaner.full_name || cleanerFullName);
      cleanerAvgRating = cleaner.avg_rating != null ? String(cleaner.avg_rating) : "5.0";
      // Samma auto-confirm-heuristik som stripe-webhook: erfaren cleaner → auto-confirm
      autoConfirm = Number(cleaner.total_jobs || 0) >= 5 || String(cleaner.tier || "") === "experienced";
    }
  }

  let magicLink = `https://spick.se/min-bokning.html?bid=${booking.id}`;
  try {
    const generated = await generateMagicShortUrl({
      email: String(booking.customer_email || ""),
      redirect_to: `https://spick.se/min-bokning.html?bid=${booking.id}`,
      scope: "booking",
      resource_id: String(booking.id),
      ttl_hours: 168,
    });
    if (generated) magicLink = generated;
  } catch (e) {
    console.warn("[RECEIPT] Magic link generation failed, using direct URL:", (e as Error).message);
  }

  const matInfo = getMaterialInfo(String(booking.service_type || ""));

  return {
    autoConfirm,
    cleanerFullName,
    cleanerAvgRating,
    magicLink,
    materialCustomerText: matInfo.customer,
    materialEmoji: matInfo.emoji,
  };
}

async function sendReceiptEmail(
  d: ReceiptData,
  company: CompanyInfo,
  receiptUrl: string,
  ctx: EmailContext,
): Promise<{ ok: boolean; error?: string }> {
  if (!d.customerEmail) {
    return { ok: false, error: "customer_email saknas" };
  }

  const subject = `Bokningsförfrågan mottagen + kvitto — ${d.service} ${d.bookingDate}`;
  const html = buildReceiptEmailHtml(d, company, receiptUrl, ctx);

  // 2026-04-27 (Fas E-PDF): bifoga PDF-kvitto. Email-body är nu minimal
  // text — all kvitto-data ligger i PDF:n (kund-feedback: "borde endast
  // vara PDF, inget mejl i text"). Best-effort — om PDF-bygge failar
  // skickas mejl utan attachment.
  const attachments = await buildPdfAttachment(d, company, /* isInvoice */ false)
    .catch((e) => {
      console.warn("[RECEIPT] PDF generation failed, sending email without attachment:", (e as Error).message);
      return undefined;
    });

  const result = await sendEmail(d.customerEmail, subject, html, attachments);
  if (!result.ok) {
    console.error("[RECEIPT] sendEmail failed:", result.error);
  } else {
    console.log("[RECEIPT] Email sent to", d.customerEmail, "id:", result.id, "pdf_attached:", !!attachments);
  }
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// ─── §2.7.4: B2B-faktura-mejl ───────────────────────────────
// Dubbel-mejl-logik (E1): om business_invoice_email är satt OCH skiljer
// sig från customer_email → skicka till båda. Annars bara ett mejl.
// Betraktar lyckad leverans = minst kund-mejlet OK (faktura-mejl är bonus).
async function sendInvoiceEmail(
  d: ReceiptData,
  company: CompanyInfo,
  invoiceUrl: string,
  ctx: EmailContext,
): Promise<{ ok: boolean; error?: string }> {
  if (!d.customerEmail) {
    return { ok: false, error: "customer_email saknas" };
  }

  const subject = `Faktura ${d.documentNumber} — ${d.service} ${d.bookingDate}`;
  const html = buildInvoiceEmailHtml(d, company, invoiceUrl, ctx);

  // 2026-04-27 (Fas E-PDF): bifoga PDF-faktura. Email-body är nu minimal
  // text — all faktura-data ligger i PDF:n. Best-effort.
  const attachments = await buildPdfAttachment(d, company, /* isInvoice */ true)
    .catch((e) => {
      console.warn("[RECEIPT] PDF (invoice) generation failed, sending email without attachment:", (e as Error).message);
      return undefined;
    });

  // Kund-mejl (obligatoriskt)
  const customerResult = await sendEmail(d.customerEmail, subject, html, attachments);
  if (!customerResult.ok) {
    console.error("[RECEIPT] Invoice email to customer failed:", customerResult.error);
    return { ok: false, error: customerResult.error };
  }
  console.log("[RECEIPT] Invoice email sent to customer", d.customerEmail, "id:", customerResult.id, "pdf_attached:", !!attachments);

  // Separat faktura-mejl om business_invoice_email skiljer sig
  const separateEmail = d.bizInvoiceEmail
    && d.bizInvoiceEmail.toLowerCase() !== d.customerEmail.toLowerCase();

  if (separateEmail) {
    const invoiceResult = await sendEmail(d.bizInvoiceEmail, subject, html, attachments);
    if (!invoiceResult.ok) {
      // Logga men räkna inte som hårt fel — kund-mejlet gick ut
      console.warn("[RECEIPT] Invoice email to business_invoice_email failed:", invoiceResult.error);
    } else {
      console.log("[RECEIPT] Invoice email also sent to", d.bizInvoiceEmail, "id:", invoiceResult.id);
    }
  }

  return { ok: true };
}

async function notifyAdminEmailFailure(
  bookingId: string,
  customerEmail: string,
  errorMsg: string | undefined,
  isB2B: boolean = false,
): Promise<void> {
  // §2.7.4 (B-17): terminologi anpassad per dokumenttyp
  const docType = isB2B ? "Fakturamejl" : "Kvittomejl";
  const docWord = isB2B ? "fakturan" : "kvittot";
  const html = wrap(`
<h2>⚠️ ${docType} misslyckades</h2>
<p>generate-receipt kunde inte skicka ${docWord} till kund. HTML finns i storage, men kunden har inte fått mejlet.</p>
<div class="card">
  <div class="row"><span class="lbl">Bokning</span><span class="val">${escHtml(bookingId)}</span></div>
  <div class="row"><span class="lbl">Kund-email</span><span class="val">${escHtml(customerEmail)}</span></div>
  <div class="row"><span class="lbl">Dokumenttyp</span><span class="val">${isB2B ? "B2B-faktura (F-serie)" : "B2C-kvitto (KV-serie)"}</span></div>
  <div class="row"><span class="lbl">Fel</span><span class="val">${escHtml(errorMsg || "okänt")}</span></div>
</div>
<p>Åtgärd: anropa generate-receipt igen manuellt, eller skicka <code>receipt_url</code> direkt till kund. EF:n är idempotent (F-R2-7) — retry säkert.</p>
`);
  await sendEmail(ADMIN, `⚠️ ${docType} misslyckades — bokning ${bookingId.slice(0, 8)}`, html)
    .catch((e) => console.error("[RECEIPT] Admin notify failed:", (e as Error).message));
  // Fas 10: warn — kvitto/faktura misslyckades, manuell retry krävs
  await sendAdminAlert({
    severity: "warn",
    title: `${docType} misslyckades`,
    source: "generate-receipt",
    message: "Anropa generate-receipt manuellt för retry (idempotent F-R2-7).",
    booking_id: bookingId,
    metadata: {
      doc_type: docType,
      customer_email: customerEmail,
      error: errorMsg || "okänt",
      is_b2b: isB2B,
    },
  });
}

// ─── Email HTML Builder (Fas E-PDF, 2026-04-27) ─────────────
// Minimal text-mejl. All kvitto-data ligger i bifogat PDF — kund-feedback:
// "borde endast vara PDF, inget mejl i text". Tidigare wrap()-mall med
// .lbl + .val (CSS-baserad spacing) renderade som "KvittonummerKV-2026-..."
// i mejl-klienter som strippar inline-CSS.

function buildReceiptEmailHtml(
  d: ReceiptData,
  _company: CompanyInfo,
  _receiptUrl: string,
  ctx: EmailContext,
): string {
  const fname = escHtml(d.customerName.split(" ")[0] || "");
  const statusLine = ctx.autoConfirm
    ? `Din bokning är bekräftad — ${escHtml(ctx.cleanerFullName)} utför uppdraget.`
    : `Din bokning är mottagen. Städaren bekräftar uppdraget inom 90 minuter.`;

  const content = `
<h2>Tack för din bokningsförfrågan${fname ? ", " + fname : ""}! 🌿</h2>
<p>${statusLine}</p>
<p>📄 <strong>Kvitto:</strong> Bifogat som PDF (för RUT-deklaration och garanti-krav).</p>
<p>🔗 <a href="${escAttr(ctx.magicLink)}" style="color:#0F6E56">Visa min bokning</a></p>
`;
  return wrap(content);
}

// ─── §2.7.4: B2B-faktura-mejl-mall ──────────────────────────
// Separat mall från B2C-kvittot för juridisk klarhet:
//   - Titel "FAKTURA" istället för "KVITTO"
//   - Fakturanr (F-YYYY-NNNNN) istället för kvittonr
//   - "Köpare"-sektion med org.nr, VAT, kontaktperson, fakturaadress
//   - Ingen RUT-rad (B2B har aldrig RUT)
//   - Betalningsstatus + Spick-plattform-notering
//   - Fakturaadress-fallback (E2): invoice_address_street → customer_address
function buildInvoiceEmailHtml(
  d: ReceiptData,
  _company: CompanyInfo,
  _invoiceUrl: string,
  ctx: EmailContext,
): string {
  const fname = escHtml(d.customerName.split(" ")[0] || "");

  const content = `
<h2>Tack för ditt uppdrag${fname ? ", " + fname : ""}! 🌿</h2>
<p>Fakturan ${escHtml(d.documentNumber)} är bifogad som PDF — spara den som underlag för er bokföring.</p>
<p>🔗 <a href="${escAttr(ctx.magicLink)}" style="color:#0F6E56">Visa bokning</a></p>
`;
  return wrap(content);
}

// ─── PDF-bygge (Fas E-PDF, 2026-04-27) ──────────────────────
// Genererar BokfL 5 kap 7 § + MervL 11 kap 8 § kompatibel PDF inline.
// Matchar layout från generate-receipt-pdf EF (samma fält, samma ordning)
// så regulator-granskning gäller identisk. Returnerar Resend-attachment-
// objekt med base64-kodad PDF.
async function buildPdfAttachment(
  d: ReceiptData,
  company: CompanyInfo,
  isInvoice: boolean,
): Promise<EmailAttachment[]> {
  const pricing = computePricingBreakdown(d);
  const pm = d.paymentMethod === "klarna" ? "Klarna" : "Kortbetalning";

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const M = 40;
  const W = 595.28 - 2 * M;
  let y = 841.89 - M;

  const black = rgb(0, 0, 0);
  const dark = rgb(0.06, 0.43, 0.34);
  const grey = rgb(0.42, 0.41, 0.38);
  const lightGrey = rgb(0.85, 0.85, 0.85);

  function text(s: string, x: number, yy: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    page.drawText(s || "", {
      x, y: yy,
      size: opts.size ?? 10,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? black,
    });
  }
  function row(lbl: string, val: string, size = 10) {
    text(lbl, M, y, { size, color: grey });
    text(val, M + 180, y, { size });
    y -= size + 6;
  }
  function divider() {
    page.drawLine({
      start: { x: M, y: y + 4 },
      end: { x: M + W, y: y + 4 },
      thickness: 0.3,
      color: lightGrey,
    });
    y -= 10;
  }

  const title = isInvoice ? "FAKTURA" : "KVITTO";
  const numberLabel = isInvoice ? "Fakturanr" : "Kvittonr";

  // Header
  text(company.tradeName, M, y, { size: 24, bold: true, color: dark });
  y -= 32;
  text(title, M, y, { size: 20, bold: true, color: dark });
  y -= 24;
  text(`${numberLabel}: ${d.documentNumber}`, M, y, { size: 10, color: grey });
  text(`Utställt: ${d.receiptDate}`, M + 280, y, { size: 10, color: grey });
  y -= 22;
  divider();

  // Säljare
  text("SÄLJARE", M, y, { size: 9, bold: true, color: dark });
  y -= 14;
  row("Företag", `${company.legalName} (${company.tradeName})`);
  row("Organisationsnummer", company.orgNumber);
  if (company.vatNumber) row("Momsregnr", company.vatNumber);
  row("Adress", company.address);
  row("E-post", company.email);
  row("Webb", company.website);
  y -= 6;
  divider();

  // Köpare / Kund
  text(isInvoice ? "KÖPARE" : "KUND", M, y, { size: 9, bold: true, color: dark });
  y -= 14;
  if (isInvoice && d.companyName) {
    row("Företag", d.companyName);
    if (d.companyOrg) row("Organisationsnummer", d.companyOrg);
    if (d.bizVatNumber) row("Momsregnr", d.bizVatNumber);
    if (d.bizContactPerson) row("Kontaktperson", d.bizContactPerson);
    if (d.companyRef) row("Referens", d.companyRef);
    const invoiceAddr = d.invoiceAddrStreet
      ? `${d.invoiceAddrStreet}${d.invoiceAddrPostal || d.invoiceAddrCity ? ", " + (d.invoiceAddrPostal + " " + d.invoiceAddrCity).trim() : ""}`
      : (d.address || "–");
    row("Fakturaadress", invoiceAddr);
  } else {
    row("Namn", d.customerName || "–");
  }
  row("E-post", d.customerEmail || "–");
  if (!isInvoice) row("Adress", d.address || "–");
  y -= 6;
  divider();

  // Tjänst
  text("TJÄNST", M, y, { size: 9, bold: true, color: dark });
  y -= 14;
  row("Typ", d.service);
  row("Datum", `${d.bookingDate} kl ${d.bookingTime}`);
  row("Omfattning", `${d.hours} timmar`);
  if (d.cleanerName) row("Städare", d.cleanerName);
  y -= 6;
  divider();

  // Belopp
  text("BELOPP", M, y, { size: 9, bold: true, color: dark });
  y -= 14;
  row("Netto (exkl. moms)", `${fmtKr(pricing.exVat)} kr`);
  row("Moms 25 %", `${fmtKr(pricing.vat)} kr`);
  row("Brutto (inkl. moms)", `${fmtKr(pricing.gross)} kr`);
  if (d.isRut) {
    row("RUT-avdrag 50 %", `-${fmtKr(d.rutAmount)} kr`);
  }
  y -= 4;

  const attBetalaBoxH = 32;
  const attBetalaBoxY = y - attBetalaBoxH + 6;
  page.drawRectangle({
    x: M, y: attBetalaBoxY, width: W, height: attBetalaBoxH,
    color: rgb(0.96, 0.96, 0.93),
  });
  text("Att betala", M + 12, y - 14, { size: 13, bold: true, color: dark });
  const amountValue = d.isRut ? d.amountPaid : d.totalPrice;
  const amountStr = `${fmtKr(amountValue)} kr`;
  const amountW = amountStr.length * 8.5;
  text(amountStr, M + W - amountW - 12, y - 14, { size: 15, bold: true, color: dark });
  y -= attBetalaBoxH + 10;
  divider();

  // Betalning
  text("BETALNING", M, y, { size: 9, bold: true, color: dark });
  y -= 14;
  row("Metod", pm);
  row("Status", "Betald");
  y -= 8;

  // Fotnot
  y = M + 20;
  const fSkattNote = company.fSkatt ? " Utfärdaren är godkänd för F-skatt." : "";
  text(
    `Detta dokument är ett automatgenererat ${isInvoice ? "faktura" : "kvitto"} och uppfyller BokfL 5 kap 7 § samt MervL 11 kap 8 §.${fSkattNote}`,
    M, y, { size: 8, color: grey }
  );

  const pdfBytes = await pdfDoc.save();
  const base64 = base64Encode(pdfBytes);
  const filename = `${isInvoice ? "faktura" : "kvitto"}-${d.documentNumber}.pdf`;

  return [{
    filename,
    content: base64,
    content_type: "application/pdf",
  }];
}

// Base64-encode Uint8Array (Deno har btoa men bara för strings).
// Chunkar i 8KB-block för att undvika "Maximum call stack" på stora PDF:er.
function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface PricingBreakdown {
  gross: number;    // inkl moms
  exVat: number;    // exkl moms
  vat: number;      // moms-belopp (25%)
}

function computePricingBreakdown(d: ReceiptData): PricingBreakdown {
  // För RUT-bokning är total_price efter-RUT; brutto = total + rut
  // För icke-RUT är total_price direkt brutto inkl moms
  const gross = d.isRut ? (d.totalPrice + d.rutAmount) : d.totalPrice;
  const exVat = Math.round(gross / 1.25);
  const vat = gross - exVat;
  return { gross, exVat, vat };
}

// ─── Helpers (oförändrade från tidigare) ────────────────────

function translateService(type: string): string {
  const map: Record<string, string> = {
    hemstadning: "Hemstädning",
    storstadning: "Storstädning",
    flyttstadning: "Flyttstädning",
    fonsterputs: "Fönsterputs",
    kontor: "Kontorsstädning",
  };
  return map[(type || "").toLowerCase()] || type || "Städning";
}

function esc(s: string): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/ä/g, "&auml;").replace(/Ä/g, "&Auml;")
    .replace(/ö/g, "&ouml;").replace(/Ö/g, "&Ouml;")
    .replace(/å/g, "&aring;").replace(/Å/g, "&Aring;")
    .replace(/é/g, "&eacute;")
    .replace(/–/g, "&ndash;").replace(/—/g, "&mdash;")
    .replace(/\u00A0/g, "&nbsp;");
}

// Enkel HTML-escape för mejl-templates (inga entity-konverteringar för svenska bokstäver)
function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function fmtSEK(n: number): string {
  const str = n.toFixed(2).replace(".", ",");
  const parts = str.split(",");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "&nbsp;");
  return parts.join(",");
}

function fmtKr(n: number): string {
  return Math.round(n).toLocaleString("sv-SE");
}

// ─── HTML Receipt Builder (storage / webbversion) ───────────
// Oförändrad struktur från tidigare. Använder company-data
// (Regel #28) istället för hardcodes.

function buildReceiptHtml(d: ReceiptData, company: CompanyInfo): string {
  const pm = d.paymentMethod === "klarna" ? "Klarna" : "Kortbetalning";

  // Pricing section differs for company vs private
  let pricingHtml = "";

  if (d.isCompany) {
    const exVat = Math.round(d.totalPrice / 1.25);
    const vat = d.totalPrice - exVat;
    pricingHtml = `
      <div class="card">
        <div class="row"><span class="lbl">Tj&auml;nstepris exkl. moms</span><span class="val">${fmtSEK(exVat)} kr</span></div>
        <div class="row"><span class="lbl">Moms (25%)</span><span class="val">${fmtSEK(vat)} kr</span></div>
        <div class="row total"><span class="lbl">Totalt inkl. moms</span><span class="val">${fmtSEK(d.totalPrice)} kr</span></div>
        <div class="row"><span class="lbl">Betalningsmetod</span><span class="val">${pm}</span></div>
      </div>
      ${d.companyRef ? `<div class="ref-box"><strong>Fakturareferens:</strong> ${esc(d.companyRef)}</div>` : ""}`;
  } else if (d.isRut) {
    const grossPrice = d.totalPrice + d.rutAmount;
    const exVat = Math.round(grossPrice / 1.25);
    const vat = grossPrice - exVat;
    pricingHtml = `
      <div class="card">
        <div class="row"><span class="lbl">Arbetskostnad exkl. moms (${esc(d.hours + "h")})</span><span class="val">${fmtSEK(exVat)} kr</span></div>
        <div class="row"><span class="lbl">Moms 25%</span><span class="val">${fmtSEK(vat)} kr</span></div>
        <div class="row" style="border-top:1px solid #e5e7eb;padding-top:10px"><span class="lbl"><strong>Arbetskostnad inkl. moms</strong></span><span class="val"><strong>${fmtSEK(grossPrice)} kr</strong></span></div>
        <div class="row rut"><span class="lbl" style="color:#0F6E56">RUT-avdrag 50%</span><span class="val" style="color:#0F6E56">&minus;${fmtSEK(d.rutAmount)} kr</span></div>
        <div class="row total"><span class="lbl">ATT BETALA</span><span class="val green">${fmtSEK(d.amountPaid)} kr</span></div>
        <div class="row"><span class="lbl">Betalningsmetod</span><span class="val">${pm}</span></div>
      </div>
      <div class="rut-box">
        <strong>&#x1F3E6; RUT-AVDRAG</strong><br>
        ${RUT_OMBUD
          ? `Spick har beg&auml;rt utbetalning fr&aring;n Skatteverket f&ouml;r RUT-avdraget (${fmtSEK(d.rutAmount)} kr) &aring; kundens v&auml;gnar. Avdraget belastar kundens prelimin&auml;ra skatt.`
          : `Kunden ansvarar sj&auml;lv f&ouml;r att s&ouml;ka RUT-avdrag hos Skatteverket. Detta kvitto utg&ouml;r underlag f&ouml;r ans&ouml;kan. Maximalt avdrag: 75&nbsp;000 kr/&aring;r.`}
      </div>`;
  } else {
    const exVat = Math.round(d.totalPrice / 1.25);
    const vat = d.totalPrice - exVat;
    pricingHtml = `
      <div class="card">
        <div class="row"><span class="lbl">Arbetskostnad exkl. moms (${esc(d.hours + "h")})</span><span class="val">${fmtSEK(exVat)} kr</span></div>
        <div class="row"><span class="lbl">Moms 25%</span><span class="val">${fmtSEK(vat)} kr</span></div>
        <div class="row total"><span class="lbl">ATT BETALA INKL. MOMS</span><span class="val green">${fmtSEK(d.totalPrice)} kr</span></div>
        <div class="row"><span class="lbl">Betalningsmetod</span><span class="val">${pm}</span></div>
      </div>`;
  }

  // Customer "TO" section
  let toHtml = "";
  if (d.isCompany && d.companyName) {
    toHtml = `
      <strong>${esc(d.companyName)}</strong><br>
      ${d.companyOrg ? `Org.nr: ${esc(d.companyOrg)}<br>` : ""}
      ${d.companyRef ? `Ref: ${esc(d.companyRef)}<br>` : ""}
      ${esc(d.customerName)}`;
  } else {
    toHtml = `
      <strong>${esc(d.customerName)}</strong><br>
      ${esc(d.customerEmail)}`;
  }

  const fSkattLine = company.fSkatt ? "Godk&auml;nd f&ouml;r F-skatt &middot; " : "";

  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kvitto ${esc(d.documentNumber)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color:#1a1a19; background:#fff; padding:40px; max-width:800px; margin:0 auto; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; padding-bottom:24px; border-bottom:3px solid #0F6E56; }
  .header-left { display:flex; align-items:baseline; gap:16px; }
  .header-left h1 { font-size:28px; font-weight:700; color:#0F6E56; letter-spacing:1px; }
  .header-left .title { font-size:20px; font-weight:700; color:#1a1a19; }
  .header .meta { text-align:right; font-size:14px; color:#555; }
  .header .meta strong { color:#1a1a19; }
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:32px; }
  .party { padding:20px; background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb; }
  .party h3 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#0F6E56; margin-bottom:12px; font-weight:600; }
  .party p { font-size:14px; line-height:1.6; color:#333; }
  .section-title { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#0F6E56; font-weight:600; margin-bottom:12px; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; font-size:13px; }
  thead th { background:#0F6E56; color:#fff; padding:10px 12px; text-align:left; font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; }
  thead th:first-child { border-radius:6px 0 0 0; }
  thead th:last-child { border-radius:0 6px 0 0; }
  thead th.right { text-align:right; }
  tbody td { padding:10px 12px; border-bottom:1px solid #e5e7eb; }
  tbody tr { background:#f9fafb; }
  .card { background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb; padding:4px 0; margin-bottom:20px; }
  .row { display:flex; justify-content:space-between; padding:10px 20px; border-bottom:1px solid #e5e7eb; font-size:14px; }
  .row:last-child { border:none; }
  .row .lbl { color:#666; }
  .row .val { font-weight:600; color:#1a1a19; }
  .row.total { border-top:2px solid #0F6E56; padding-top:14px; }
  .row.total .lbl { font-weight:700; font-size:16px; color:#1a1a19; }
  .row.total .val { font-size:16px; }
  .row.rut .lbl { color:#0F6E56; }
  .row.rut .val { color:#0F6E56; }
  .val.green { color:#0F6E56; }
  .rut-box { background:#E1F5EE; border-radius:8px; padding:16px 20px; margin:16px 0; font-size:14px; color:#0F6E56; line-height:1.6; border-left:4px solid #0F6E56; }
  .ref-box { background:#eff6ff; border-radius:8px; padding:12px 20px; margin:16px 0; font-size:14px; color:#333; border-left:4px solid #0F6E56; }
  .guarantee { background:#f9fafb; border-radius:8px; padding:16px 20px; margin:24px 0; }
  .guarantee strong { color:#0F6E56; }
  .guarantee p { font-size:13px; color:#666; margin-top:4px; }
  .booking-id { font-size:12px; color:#999; margin:16px 0; }
  .footer { margin-top:40px; padding-top:20px; border-top:1px solid #e5e7eb; font-size:12px; color:#666; line-height:1.6; text-align:center; }
  @media print { body { padding:20px; } .header { border-bottom-width:2px; } }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1>${esc(company.tradeName)}</h1>
    <span class="title">KVITTO</span>
  </div>
  <div class="meta">
    <div><strong>Kvittonr:</strong> ${esc(d.documentNumber)}</div>
    <div><strong>Datum:</strong> ${esc(d.receiptDate)}</div>
  </div>
</div>

<div class="parties">
  <div class="party">
    <h3>Fr&aring;n</h3>
    <p>
      <strong>${esc(company.legalName)}</strong><br>
      Bifirma: ${esc(company.tradeName)}<br>
      Org.nr: ${esc(company.orgNumber)}<br>
      Momsreg.nr: ${esc(company.vatNumber)}<br>
      ${esc(company.address)}<br>
      ${esc(company.email)}
    </p>
  </div>
  <div class="party">
    <h3>Till</h3>
    <p>${toHtml}</p>
  </div>
</div>

<div class="section-title">Bokningsdetaljer</div>
<table>
  <thead>
    <tr>
      <th>Tj&auml;nst</th>
      <th>Datum</th>
      <th>Tid</th>
      <th class="right">Timmar</th>
      <th>Adress</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${esc(d.service)}</td>
      <td>${esc(d.bookingDate)}</td>
      <td>${esc(d.bookingTime)}</td>
      <td style="text-align:right">${d.hours}</td>
      <td>${esc(d.address)}</td>
    </tr>
  </tbody>
</table>

${d.cleanerName ? `<p style="font-size:13px;color:#666;margin-bottom:16px">St&auml;dare: ${esc(d.cleanerName)}</p>` : ""}

<div class="section-title">Betalning</div>
${pricingHtml}

<div class="guarantee">
  <strong>&#x1F6E1;&#xFE0F; N&ouml;jdhetsgaranti</strong>
  <p>Inte n&ouml;jd med st&auml;dningen? Vi st&auml;dar om kostnadsfritt. Kontakta ${esc(company.email)} inom 24h.</p>
</div>

<div class="booking-id">Boknings-ID: ${esc(d.bookingId)}</div>

<div class="footer">
  ${esc(company.legalName)} (bifirma ${esc(company.tradeName)}) &middot; Org.nr: ${esc(company.orgNumber)} &middot; ${fSkattLine}SNI: ${esc(company.sniCode)} &middot; ${esc(company.email)}<br>
  <strong style="color:#0F6E56">${esc(company.tradeName)}</strong> &mdash; Sveriges st&auml;dplattform &middot; <a href="https://${esc(company.website)}" style="color:#0F6E56">${esc(company.website)}</a>
</div>

</body>
</html>`;
}

// ─── §2.7.4: B2B-faktura storage-HTML (full webbversion) ────
// Matchar buildReceiptHtml-struktur men:
//   - Titel "FAKTURA" istället för "KVITTO"
//   - Fakturanr (F-serie)
//   - "Köpare"-block ersätter "Till"-block med utökade B2B-uppgifter
//   - Pricing utan RUT
//   - Betalningsstatus-box
//   - Spick-plattform-notering i footer
function buildInvoiceHtml(d: ReceiptData, company: CompanyInfo): string {
  const pm = d.paymentMethod === "klarna" ? "Klarna" : "Kortbetalning";
  const exVat = Math.round(d.totalPrice / 1.25);
  const vat = d.totalPrice - exVat;

  // Fakturaadress-fallback (E2/B-16)
  const useSeparateInvoiceAddr = !!d.invoiceAddrStreet;
  const invoiceAddrDisplay = useSeparateInvoiceAddr
    ? `${esc(d.invoiceAddrStreet)}${(d.invoiceAddrPostal || d.invoiceAddrCity) ? `<br>${esc(d.invoiceAddrPostal)} ${esc(d.invoiceAddrCity)}`.trim() : ""}`
    : esc(d.address || "—");

  const pricingHtml = `
    <div class="card">
      <div class="row"><span class="lbl">Arbetskostnad exkl. moms (${esc(d.hours + "h")})</span><span class="val">${fmtSEK(exVat)} kr</span></div>
      <div class="row"><span class="lbl">Moms 25%</span><span class="val">${fmtSEK(vat)} kr</span></div>
      <div class="row total"><span class="lbl">ATT BETALA INKL. MOMS</span><span class="val green">${fmtSEK(d.totalPrice)} kr</span></div>
      <div class="row"><span class="lbl">Betalningsmetod</span><span class="val">${pm}</span></div>
      <div class="row"><span class="lbl">Betalningsstatus</span><span class="val green">&#x2713; Betald</span></div>
    </div>`;

  // Köpare-block
  const buyerHtml = `
    <strong>${esc(d.companyName || "—")}</strong><br>
    Org.nr: ${esc(d.companyOrg || "—")}<br>
    ${d.bizVatNumber ? `Momsreg.nr: ${esc(d.bizVatNumber)}<br>` : ""}
    ${d.bizContactPerson ? `Att: ${esc(d.bizContactPerson)}<br>` : ""}
    ${invoiceAddrDisplay}
    ${d.companyRef ? `<br><span style="color:#0F6E56">Ref: ${esc(d.companyRef)}</span>` : ""}`;

  const fSkattLine = company.fSkatt ? "Utf&auml;rdaren &auml;r godk&auml;nd f&ouml;r F-skatt &middot; " : "";

  // Spick-plattform-notering
  const platformNote = d.cleanerName
    ? `Fakturan genererades av ${esc(company.tradeName)}, plattformen f&ouml;r st&auml;dtj&auml;nster. Arbetet utf&ouml;rdes av ${esc(d.cleanerName)}.`
    : `Fakturan genererades av ${esc(company.tradeName)}, plattformen f&ouml;r st&auml;dtj&auml;nster.`;

  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Faktura ${esc(d.documentNumber)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color:#1a1a19; background:#fff; padding:40px; max-width:800px; margin:0 auto; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; padding-bottom:24px; border-bottom:3px solid #0F6E56; }
  .header-left { display:flex; align-items:baseline; gap:16px; }
  .header-left h1 { font-size:28px; font-weight:700; color:#0F6E56; letter-spacing:1px; }
  .header-left .title { font-size:20px; font-weight:700; color:#1a1a19; }
  .header .meta { text-align:right; font-size:14px; color:#555; }
  .header .meta strong { color:#1a1a19; }
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:32px; }
  .party { padding:20px; background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb; }
  .party h3 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#0F6E56; margin-bottom:12px; font-weight:600; }
  .party p { font-size:14px; line-height:1.6; color:#333; }
  .section-title { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#0F6E56; font-weight:600; margin-bottom:12px; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; font-size:13px; }
  thead th { background:#0F6E56; color:#fff; padding:10px 12px; text-align:left; font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; }
  thead th:first-child { border-radius:6px 0 0 0; }
  thead th:last-child { border-radius:0 6px 0 0; }
  thead th.right { text-align:right; }
  tbody td { padding:10px 12px; border-bottom:1px solid #e5e7eb; }
  tbody tr { background:#f9fafb; }
  .card { background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb; padding:4px 0; margin-bottom:20px; }
  .row { display:flex; justify-content:space-between; padding:10px 20px; border-bottom:1px solid #e5e7eb; font-size:14px; }
  .row:last-child { border:none; }
  .row .lbl { color:#666; }
  .row .val { font-weight:600; color:#1a1a19; }
  .row.total { border-top:2px solid #0F6E56; padding-top:14px; }
  .row.total .lbl { font-weight:700; font-size:16px; color:#1a1a19; }
  .row.total .val { font-size:16px; }
  .val.green { color:#0F6E56; }
  .paid-box { background:#E1F5EE; border-radius:8px; padding:16px 20px; margin:16px 0; font-size:14px; color:#0F6E56; line-height:1.6; border-left:4px solid #0F6E56; }
  .platform-note { background:#f9fafb; border-radius:8px; padding:12px 20px; margin:16px 0; font-size:13px; color:#666; line-height:1.6; border-left:2px solid #e5e7eb; }
  .booking-id { font-size:12px; color:#999; margin:16px 0; }
  .footer { margin-top:40px; padding-top:20px; border-top:1px solid #e5e7eb; font-size:12px; color:#666; line-height:1.6; text-align:center; }
  @media print { body { padding:20px; } .header { border-bottom-width:2px; } }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1>${esc(company.tradeName)}</h1>
    <span class="title">FAKTURA</span>
  </div>
  <div class="meta">
    <div><strong>Fakturanr:</strong> ${esc(d.documentNumber)}</div>
    <div><strong>Datum:</strong> ${esc(d.receiptDate)}</div>
  </div>
</div>

<div class="paid-box">
  <strong>&#x2713; Betald via ${pm.toLowerCase()} den ${esc(d.receiptDate)}.</strong> Ingen &aring;terst&aring;ende skuld.
</div>

<div class="parties">
  <div class="party">
    <h3>S&auml;ljare (Utf&auml;rdare)</h3>
    <p>
      <strong>${esc(company.legalName)}</strong><br>
      Bifirma: ${esc(company.tradeName)}<br>
      Org.nr: ${esc(company.orgNumber)}<br>
      Momsreg.nr: ${esc(company.vatNumber)}<br>
      ${esc(company.address)}<br>
      ${esc(company.email)}
    </p>
  </div>
  <div class="party">
    <h3>K&ouml;pare</h3>
    <p>${buyerHtml}</p>
  </div>
</div>

<div class="section-title">Uppdragsdetaljer</div>
<table>
  <thead>
    <tr>
      <th>Tj&auml;nst</th>
      <th>Datum</th>
      <th>Tid</th>
      <th class="right">Timmar</th>
      <th>Utf&ouml;rd adress</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${esc(d.service)}</td>
      <td>${esc(d.bookingDate)}</td>
      <td>${esc(d.bookingTime)}</td>
      <td style="text-align:right">${d.hours}</td>
      <td>${esc(d.address)}</td>
    </tr>
  </tbody>
</table>

${d.cleanerName ? `<p style="font-size:13px;color:#666;margin-bottom:16px">St&auml;dare: ${esc(d.cleanerName)}</p>` : ""}

<div class="section-title">Betalning</div>
${pricingHtml}

<div class="platform-note">${platformNote}</div>

<div class="booking-id">Boknings-ID: ${esc(d.bookingId)}</div>

<div class="footer">
  ${esc(company.legalName)} (bifirma ${esc(company.tradeName)}) &middot; Org.nr: ${esc(company.orgNumber)} &middot; ${fSkattLine}SNI: ${esc(company.sniCode)} &middot; ${esc(company.email)}<br>
  <strong style="color:#0F6E56">${esc(company.tradeName)}</strong> &mdash; Sveriges st&auml;dplattform &middot; <a href="https://${esc(company.website)}" style="color:#0F6E56">${esc(company.website)}</a>
</div>

</body>
</html>`;
}
