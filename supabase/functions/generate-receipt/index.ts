// ═══════════════════════════════════════════════════════════════
// SPICK – Kundkvitto (Customer Receipt HTML)
// Genererar kvitto vid betalning. Privat = RUT-info, Företag = org.nr
// Anropas av stripe-webhook efter checkout.session.completed
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RUT_OMBUD = true;

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

    console.log("[RECEIPT] Generating receipt for booking:", bookingId);

    // 1. Fetch booking
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (bErr || !booking) return json(404, { error: "Bokning ej hittad: " + (bErr?.message || bookingId) });

    // Skip if receipt already exists
    if (booking.receipt_url) {
      console.log("[RECEIPT] Receipt already exists:", booking.receipt_number);
      return json(200, { receipt_number: booking.receipt_number, receipt_url: booking.receipt_url });
    }

    // 2. Generate receipt number
    const { data: receiptNum, error: rnErr } = await supabase.rpc("generate_receipt_number");
    if (rnErr) {
      console.error("[RECEIPT] Receipt number generation error:", rnErr.message);
      return json(500, { error: "Kunde inte generera kvittonummer: " + rnErr.message });
    }
    const receiptNumber = receiptNum as string;
    console.log("[RECEIPT] Receipt number:", receiptNumber);

    // 3. Determine customer type
    const isCompany = (booking.customer_type || "").toLowerCase() === "foretag";
    const isRut = !isCompany && !!booking.rut_amount && booking.rut_amount > 0;

    // 4. Build receipt data
    const d: ReceiptData = {
      receiptNumber,
      receiptDate: new Date().toISOString().split("T")[0],
      bookingDate: booking.booking_date || "",
      bookingTime: booking.booking_time || "",
      service: translateService(booking.service_type),
      hours: booking.booking_hours || 0,
      address: booking.customer_address || "",
      customerName: booking.customer_name || "",
      customerEmail: booking.customer_email || "",
      isCompany,
      companyName: booking.business_name || "",
      companyOrg: booking.business_org_number || "",
      companyRef: booking.business_reference || "",
      totalPrice: booking.total_price || 0,
      amountPaid: booking.amount_paid || booking.total_price || 0,
      rutAmount: booking.rut_amount || 0,
      isRut,
      paymentMethod: booking.payment_method || "card",
      cleanerName: booking.cleaner_name || "",
      bookingId: booking.id,
    };

    // 5. Ensure storage bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b: { name: string }) => b.name === "receipts")) {
      await supabase.storage.createBucket("receipts", { public: true });
    }

    // 6. Generate HTML receipt
    const html = buildReceiptHtml(d);
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

    // 7. Update booking with receipt info
    await supabase.from("bookings").update({
      receipt_number: receiptNumber,
      receipt_url: receiptUrl,
    }).eq("id", bookingId);

    return json(200, {
      success: true,
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

// ─── Helpers ────────────────────────────────────────────────

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

function fmtSEK(n: number): string {
  const str = n.toFixed(2).replace(".", ",");
  const parts = str.split(",");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "&nbsp;");
  return parts.join(",");
}

// ─── HTML Receipt Builder ───────────────────────────────────

function buildReceiptHtml(d: ReceiptData): string {
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
    <h1>Spick</h1>
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
      <strong>Haghighi Consulting AB</strong><br>
      Bifirma: Spick<br>
      Org.nr: 559402-4522<br>
      hello@spick.se
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
  <p>Inte n&ouml;jd med st&auml;dningen? Vi st&auml;dar om kostnadsfritt. Kontakta hello@spick.se inom 24h.</p>
</div>

<div class="booking-id">Boknings-ID: ${esc(d.bookingId)}</div>

<div class="footer">
  Haghighi Consulting AB (bifirma Spick) · Org.nr: 559402-4522 · hello@spick.se<br>
  <strong style="color:#0F6E56">Spick</strong> &mdash; Sveriges st&auml;dplattform &middot; <a href="https://spick.se" style="color:#0F6E56">spick.se</a>
</div>

</body>
</html>`;
}
