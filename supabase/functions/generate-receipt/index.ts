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
import { corsHeaders, sendEmail, wrap, ADMIN, getMaterialInfo } from "../_shared/email.ts";
import { generateMagicShortUrl } from "../_shared/send-magic-sms.ts";

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

    // ── F-R2-7 IDEMPOTENS ─────────────────────────────────
    // Steg (a): Mejl redan skickat → inget att göra
    if (booking.receipt_email_sent_at) {
      console.log("[RECEIPT] Email already sent at", booking.receipt_email_sent_at, "— skipping");
      return json(200, {
        success: true,
        already_sent: true,
        receipt_number: booking.receipt_number,
        receipt_url: booking.receipt_url,
      });
    }

    const company = await fetchCompanyInfo(supabase);

    // Steg (b): HTML finns men mejl INTE skickat → skippa HTML-gen, skicka mejl
    if (booking.receipt_url && booking.receipt_number) {
      console.log("[RECEIPT] HTML exists but email not sent — sending email only");
      const d = buildReceiptData(booking, booking.receipt_number);
      const ctx = await buildEmailContext(supabase, booking);
      const emailResult = await sendReceiptEmail(d, company, booking.receipt_url, ctx);

      if (emailResult.ok) {
        await supabase.from("bookings").update({
          receipt_email_sent_at: new Date().toISOString(),
        }).eq("id", bookingId);
      } else {
        await notifyAdminEmailFailure(bookingId, d.customerEmail, emailResult.error);
      }

      return json(200, {
        success: true,
        email_sent: emailResult.ok,
        email_error: emailResult.error,
        receipt_number: booking.receipt_number,
        receipt_url: booking.receipt_url,
      });
    }

    // Steg (c): Full flow — generera HTML, lagra, skicka mejl
    const { data: receiptNum, error: rnErr } = await supabase.rpc("generate_receipt_number");
    if (rnErr) {
      console.error("[RECEIPT] Receipt number generation error:", rnErr.message);
      return json(500, { error: "Kunde inte generera kvittonummer: " + rnErr.message });
    }
    const receiptNumber = receiptNum as string;
    console.log("[RECEIPT] Receipt number:", receiptNumber);

    const d = buildReceiptData(booking, receiptNumber);

    // Ensure storage bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b: { name: string }) => b.name === "receipts")) {
      await supabase.storage.createBucket("receipts", { public: true });
    }

    // Generate HTML receipt (web version — full layout för "Öppna webbversion"-länk)
    const html = buildReceiptHtml(d, company);
    const fileName = `${receiptNumber}.html`;

    const { error: uploadErr } = await supabase.storage
      .from("receipts")
      .upload(fileName, new TextEncoder().encode(html), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[RECEIPT] Upload error:", uploadErr.message);
      return json(500, { error: "Kunde inte ladda upp kvitto: " + uploadErr.message });
    }

    const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(fileName);
    const receiptUrl = urlData.publicUrl;
    console.log("[RECEIPT] HTML uploaded:", receiptUrl);

    // Skicka kvittomejl till kund (med bokningsbekräftelse-kontext)
    const ctx = await buildEmailContext(supabase, booking);
    const emailResult = await sendReceiptEmail(d, company, receiptUrl, ctx);

    // UPDATE bookings: alltid receipt_url + receipt_number, receipt_email_sent_at bara om mejl OK
    const updatePayload: Record<string, unknown> = {
      receipt_number: receiptNumber,
      receipt_url: receiptUrl,
    };
    if (emailResult.ok) {
      updatePayload.receipt_email_sent_at = new Date().toISOString();
    }
    await supabase.from("bookings").update(updatePayload).eq("id", bookingId);

    if (!emailResult.ok) {
      await notifyAdminEmailFailure(bookingId, d.customerEmail, emailResult.error);
    }

    return json(200, {
      success: true,
      email_sent: emailResult.ok,
      email_error: emailResult.error,
      receipt_number: receiptNumber,
      receipt_url: receiptUrl,
    });
  } catch (e) {
    console.error("[RECEIPT] Error:", (e as Error).message);
    return json(500, { error: (e as Error).message });
  }
});

// ─── Types ──────────────────────────────────────────────────

interface ReceiptData {
  receiptNumber: string;
  receiptDate: string;
  bookingDate: string;
  bookingTime: string;
  service: string;
  hours: number;
  address: string;
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
}

function buildReceiptData(booking: Record<string, unknown>, receiptNumber: string): ReceiptData {
  const isCompany = String(booking.customer_type || "").toLowerCase() === "foretag";
  const rutAmount = Number(booking.rut_amount || 0);
  const isRut = !isCompany && rutAmount > 0;

  return {
    receiptNumber,
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

  const subject = `Bokningsbekräftelse + kvitto — ${d.service} ${d.bookingDate}`;
  const html = buildReceiptEmailHtml(d, company, receiptUrl, ctx);

  const result = await sendEmail(d.customerEmail, subject, html);
  if (!result.ok) {
    console.error("[RECEIPT] sendEmail failed:", result.error);
  } else {
    console.log("[RECEIPT] Email sent to", d.customerEmail, "id:", result.id);
  }
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

async function notifyAdminEmailFailure(
  bookingId: string,
  customerEmail: string,
  errorMsg: string | undefined,
): Promise<void> {
  const html = wrap(`
<h2>⚠️ Kvittomejl misslyckades</h2>
<p>generate-receipt kunde inte skicka kvitto till kund. HTML finns i storage, men kunden har inte fått mejlet.</p>
<div class="card">
  <div class="row"><span class="lbl">Bokning</span><span class="val">${escHtml(bookingId)}</span></div>
  <div class="row"><span class="lbl">Kund-email</span><span class="val">${escHtml(customerEmail)}</span></div>
  <div class="row"><span class="lbl">Fel</span><span class="val">${escHtml(errorMsg || "okänt")}</span></div>
</div>
<p>Åtgärd: anropa generate-receipt igen manuellt, eller skicka <code>receipt_url</code> direkt till kund. EF:n är idempotent (F-R2-7) — retry säkert.</p>
`);
  await sendEmail(ADMIN, `⚠️ Kvittomejl misslyckades — bokning ${bookingId.slice(0, 8)}`, html)
    .catch((e) => console.error("[RECEIPT] Admin notify failed:", (e as Error).message));
}

// ─── Email HTML Builder (R2) ────────────────────────────────
// Kompakt mejl-version med alla 11 bokföringslag-fält. För fullständig
// webbversion använder kunden "Öppna webbversion"-länken till storage.

function buildReceiptEmailHtml(
  d: ReceiptData,
  company: CompanyInfo,
  receiptUrl: string,
  ctx: EmailContext,
): string {
  const pricing = computePricingBreakdown(d);
  const pm = d.paymentMethod === "klarna" ? "Klarna" : "Kortbetalning";

  const customerAddrLine = d.address ? `<br>${escHtml(d.address)}` : "";
  const cleanerLabel = ctx.cleanerFullName
    ? `<div class="row"><span class="lbl">Städare</span><span class="val">${escHtml(ctx.cleanerFullName)} ⭐ ${escHtml(ctx.cleanerAvgRating)}</span></div>`
    : "";

  const pricingRows = d.isRut
    ? `
    <div class="row"><span class="lbl">Arbetskostnad exkl. moms</span><span class="val">${fmtKr(pricing.exVat)} kr</span></div>
    <div class="row"><span class="lbl">Moms 25%</span><span class="val">${fmtKr(pricing.vat)} kr</span></div>
    <div class="row"><span class="lbl">Arbetskostnad inkl. moms</span><span class="val">${fmtKr(pricing.gross)} kr</span></div>
    <div class="row" style="color:#0F6E56"><span class="lbl">RUT-avdrag 50%</span><span class="val">-${fmtKr(d.rutAmount)} kr</span></div>
    <div class="row"><span class="lbl"><strong>Att betala</strong></span><span class="val"><strong>${fmtKr(d.amountPaid)} kr</strong></span></div>`
    : `
    <div class="row"><span class="lbl">Arbetskostnad exkl. moms</span><span class="val">${fmtKr(pricing.exVat)} kr</span></div>
    <div class="row"><span class="lbl">Moms 25%</span><span class="val">${fmtKr(pricing.vat)} kr</span></div>
    <div class="row"><span class="lbl"><strong>Att betala inkl. moms</strong></span><span class="val"><strong>${fmtKr(d.totalPrice)} kr</strong></span></div>`;

  const rutNote = d.isRut
    ? `<p style="font-size:12px;color:#6B6960;margin-top:16px">
         RUT-avdraget ansöks hos Skatteverket efter utfört arbete.
         Maximalt avdrag är 75 000 kr per person och år.
       </p>`
    : "";

  const fSkattLine = company.fSkatt ? "Godkänd för F-skatt. " : "";
  const fname = d.customerName.split(" ")[0] || "";

  // Status-banner: auto-confirm vs pending 90 min
  const statusBanner = ctx.autoConfirm
    ? `<div style="background:#E1F5EE;border-left:4px solid #0F6E56;border-radius:8px;padding:14px 18px;margin-bottom:20px;font-size:14px;color:#0F6E56">
         <strong>✅ Bokning bekräftad</strong> — ${escHtml(ctx.cleanerFullName)} har bekräftats för ditt uppdrag.
       </div>`
    : `<div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:8px;padding:14px 18px;margin-bottom:20px;font-size:14px;color:#92400E">
         <strong>⏳ Bokning mottagen</strong> — Din städare bekräftar uppdraget inom 90 minuter.
       </div>`;

  const prepBox = ctx.materialCustomerText
    ? `<div style="background:#FEF3C7;border-radius:10px;padding:12px 14px;margin:16px 0;font-size:13px;color:#92400E;line-height:1.6">
         ${ctx.materialEmoji} <strong>Förberedelse:</strong> ${escHtml(ctx.materialCustomerText)}
       </div>`
    : "";

  const content = `
${statusBanner}
<h2>Tack för din bokning${fname ? ", " + escHtml(fname) : ""}! 🌿</h2>
<p>Här är ditt bokföringslag-grundade kvitto. Spara mejlet — det är underlag för eventuell RUT-deklaration och garanti-krav.</p>

<h3 style="font-family:Georgia,serif;font-size:16px;color:#1C1C1A;margin:20px 0 8px">Kvitto</h3>
<div class="card">
  <div class="row"><span class="lbl">Kvittonummer</span><span class="val">${escHtml(d.receiptNumber)}</span></div>
  <div class="row"><span class="lbl">Utfärdandedatum</span><span class="val">${escHtml(d.receiptDate)}</span></div>
  <div class="row"><span class="lbl">Betalningsmetod</span><span class="val">${pm}</span></div>
</div>

<h3 style="font-family:Georgia,serif;font-size:16px;color:#1C1C1A;margin:20px 0 8px">Utfärdare</h3>
<div class="card">
  <div class="row"><span class="lbl">Företag</span><span class="val">${escHtml(company.legalName)} (bifirma ${escHtml(company.tradeName)})</span></div>
  <div class="row"><span class="lbl">Org.nr</span><span class="val">${escHtml(company.orgNumber)}</span></div>
  <div class="row"><span class="lbl">Momsreg.nr</span><span class="val">${escHtml(company.vatNumber)}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${escHtml(company.address)}</span></div>
</div>

<h3 style="font-family:Georgia,serif;font-size:16px;color:#1C1C1A;margin:20px 0 8px">Kund</h3>
<div class="card">
  <div class="row"><span class="lbl">Namn</span><span class="val">${escHtml(d.customerName)}${customerAddrLine}</span></div>
  ${d.isCompany && d.companyName ? `<div class="row"><span class="lbl">Företag</span><span class="val">${escHtml(d.companyName)}${d.companyOrg ? " · Org.nr " + escHtml(d.companyOrg) : ""}</span></div>` : ""}
</div>

<h3 style="font-family:Georgia,serif;font-size:16px;color:#1C1C1A;margin:20px 0 8px">Tjänst</h3>
<div class="card">
  <div class="row"><span class="lbl">Beskrivning</span><span class="val">${escHtml(d.service)}</span></div>
  <div class="row"><span class="lbl">Utförd</span><span class="val">${escHtml(d.bookingDate)} kl ${escHtml(d.bookingTime)}</span></div>
  <div class="row"><span class="lbl">Omfattning</span><span class="val">${d.hours} timmar</span></div>
  ${cleanerLabel}
</div>

<h3 style="font-family:Georgia,serif;font-size:16px;color:#1C1C1A;margin:20px 0 8px">Belopp</h3>
<div class="card">${pricingRows}
</div>

<p style="font-size:12px;color:#6B6960;margin-top:20px">
  ${fSkattLine}Momssatsen 25% är inkluderad i priset.
  SNI ${escHtml(company.sniCode)} (städtjänster).
</p>
${rutNote}
${prepBox}

<a href="${escAttr(ctx.magicLink)}" class="btn">Visa min bokning →</a>
<p style="margin-top:8px;font-size:13px"><a href="${escAttr(receiptUrl)}" style="color:#0F6E56">Öppna kvittot som webbversion</a></p>

<hr style="border:none;border-top:1px solid #E8E8E4;margin:24px 0">
<p style="font-size:13px">🛡️ <strong>Nöjdhetsgaranti</strong> — inte nöjd med städningen? Vi städar om kostnadsfritt. Kontakta <a href="mailto:${escAttr(company.email)}" style="color:#0F6E56">${escHtml(company.email)}</a> inom 24h.</p>
<p style="font-size:13px">Ändra eller avboka senast 24h innan på <a href="mailto:${escAttr(company.email)}" style="color:#0F6E56">${escHtml(company.email)}</a>.</p>
`;

  return wrap(content);
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
<title>Kvitto ${esc(d.receiptNumber)}</title>
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
    <div><strong>Kvittonr:</strong> ${esc(d.receiptNumber)}</div>
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
