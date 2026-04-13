// ═══════════════════════════════════════════════════════════════
// SPICK – Självfaktura-generator (Self-billing invoice)
// Genererar månadsvis självfakturor för städare med F-skatt
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    console.log("[SELF-INVOICE] Request:", { month: body.month, cleaner_id: body.cleaner_id, period_start: body.period_start, period_end: body.period_end });

    // --- Determine mode: single cleaner or all cleaners for a month ---
    let cleanerIds: string[] = [];
    let periodStart: string;
    let periodEnd: string;

    if (body.month) {
      // month format: "2026-04"
      const [y, m] = body.month.split("-").map(Number);
      periodStart = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      periodEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // Fetch all cleaners with f_skatt_verified
      const { data: cleaners, error: cErr } = await supabase
        .from("cleaners")
        .select("id")
        .eq("f_skatt_verified", true);
      if (cErr) return json(500, { error: "Kunde inte hämta städare: " + cErr.message });
      cleanerIds = (cleaners || []).map((c: { id: string }) => c.id);
    } else if (body.cleaner_id && body.period_start && body.period_end) {
      cleanerIds = [body.cleaner_id];
      periodStart = body.period_start;
      periodEnd = body.period_end;
    } else {
      return json(400, { error: "Ange { month } eller { cleaner_id, period_start, period_end }" });
    }

    if (cleanerIds.length === 0) {
      return json(200, { message: "Inga städare med F-skatt hittades", invoices: [] });
    }

    // --- Ensure storage bucket exists ---
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b: { name: string }) => b.name === "invoices")) {
      await supabase.storage.createBucket("invoices", { public: true });
    }

    const results: Array<{ cleaner_id: string; invoice_id: string; invoice_number: string; pdf_url: string }> = [];
    const errors: Array<{ cleaner_id: string; error: string }> = [];

    for (const cleanerId of cleanerIds) {
      try {
        const result = await generateInvoiceForCleaner(supabase, cleanerId, periodStart!, periodEnd!);
        if (result.skipped) {
          // No billable bookings — skip silently
          continue;
        }
        results.push(result);
      } catch (e) {
        errors.push({ cleaner_id: cleanerId, error: (e as Error).message });
      }
    }

    return json(200, {
      success: true,
      generated: results.length,
      invoices: results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    console.error("generate-self-invoice error:", e);
    return json(500, { error: (e as Error).message });
  }
});

// ─── Generate invoice for a single cleaner ───────────────────

interface InvoiceResult {
  cleaner_id: string;
  invoice_id: string;
  invoice_number: string;
  pdf_url: string;
  skipped?: boolean;
}

async function generateInvoiceForCleaner(
  supabase: ReturnType<typeof createClient>,
  cleanerId: string,
  periodStart: string,
  periodEnd: string,
): Promise<InvoiceResult & { skipped?: boolean }> {
  // 1. Fetch cleaner details
  const { data: cleaner, error: clErr } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, business_name, org_number, business_address, vat_registered, f_skatt_verified, company_id")
    .eq("id", cleanerId)
    .single();
  if (clErr || !cleaner) throw new Error("Städare ej funnen: " + (clErr?.message || cleanerId));

  // 2. Fetch completed bookings for the period that aren't already invoiced
  const { data: existingInvoices } = await supabase
    .from("self_invoices")
    .select("booking_ids")
    .eq("cleaner_id", cleanerId);

  const alreadyInvoiced = new Set<string>();
  (existingInvoices || []).forEach((inv: { booking_ids: string[] }) => {
    (inv.booking_ids || []).forEach((id: string) => alreadyInvoiced.add(id));
  });

  console.log("[SELF-INVOICE] Querying bookings for cleaner:", cleanerId, "period:", periodStart, "–", periodEnd);

  const { data: bookings, error: bErr } = await supabase
    .from("bookings")
    .select("id, booking_date, service_type, booking_hours, total_price, status")
    .eq("cleaner_id", cleanerId)
    .eq("status", "completed")
    .gte("booking_date", periodStart)
    .lte("booking_date", periodEnd)
    .order("booking_date", { ascending: true });

  if (bErr) {
    console.log("[SELF-INVOICE] Booking query error:", bErr.message);
    throw new Error("Kunde inte hämta bokningar: " + bErr.message);
  }

  console.log("[SELF-INVOICE] Bookings found:", bookings?.length, bookings?.map((b: { id: string }) => b.id));

  // Filter out already invoiced bookings
  const billableBookings = (bookings || []).filter(
    (b: { id: string }) => !alreadyInvoiced.has(b.id),
  );

  if (billableBookings.length === 0) {
    console.log("[SELF-INVOICE] No billable bookings for cleaner:", cleanerId);
    return { cleaner_id: cleanerId, invoice_id: "", invoice_number: "", pdf_url: "", skipped: true };
  }

  // 3. Fetch commission data
  const bookingIds = billableBookings.map((b: { id: string }) => b.id);
  const { data: commissionRows } = await supabase
    .from("commission_log")
    .select("booking_id, commission_pct, commission_amt, net_amount, gross_amount")
    .in("booking_id", bookingIds);

  const commissionMap = new Map<string, { commission_pct: number; commission_amt: number; net_amount: number; gross_amount: number }>();
  (commissionRows || []).forEach((c: { booking_id: string; commission_pct: number; commission_amt: number; net_amount: number; gross_amount: number }) => {
    commissionMap.set(c.booking_id, c);
  });

  // 4. Build line items
  interface LineItem {
    booking_id: string;
    date: string;
    service: string;
    hours: number;
    gross: number;
    commission_pct: number;
    commission: number;
    net: number;
  }

  let totalGross = 0;
  let totalCommission = 0;
  let totalNet = 0;

  const lineItems: LineItem[] = billableBookings.map((b: { id: string; booking_date: string; service_type: string; booking_hours: number; total_price: number }) => {
    const cl = commissionMap.get(b.id);
    const gross = cl?.gross_amount || b.total_price;
    const commPct = cl?.commission_pct || 17;
    const commission = cl?.commission_amt || Math.round(gross * (commPct / 100));
    const net = cl?.net_amount || (gross - commission);

    totalGross += gross;
    totalCommission += commission;
    totalNet += net;

    return {
      booking_id: b.id,
      date: b.booking_date,
      service: translateService(b.service_type),
      hours: b.booking_hours || 0,
      gross,
      commission_pct: commPct,
      commission,
      net,
    };
  });

  // 5. VAT calculation
  const vatRate = cleaner.vat_registered ? 25 : 0;
  const vatAmount = cleaner.vat_registered ? Math.round(totalNet * 0.25) : 0;
  const totalWithVat = totalNet + vatAmount;

  // 6. Generate invoice number
  const { data: invNumData, error: invNumErr } = await supabase.rpc("generate_invoice_number");
  if (invNumErr) throw new Error("Kunde inte generera fakturanummer: " + invNumErr.message);
  const invoiceNumber = invNumData as string;
  console.log("[SELF-INVOICE] Invoice created:", invoiceNumber, "for cleaner:", cleanerId);

  // 7. Build seller info
  const sellerName = cleaner.business_name || `${cleaner.first_name} ${cleaner.last_name}`;
  const sellerOrg = cleaner.org_number || "";
  const sellerAddress = cleaner.business_address || "";

  // 8. Generate HTML invoice
  const invoiceDate = new Date().toISOString().split("T")[0];
  const html = buildInvoiceHtml({
    invoiceNumber,
    invoiceDate,
    periodStart,
    periodEnd,
    sellerName,
    sellerOrg,
    sellerAddress,
    fSkatt: cleaner.f_skatt_verified,
    vatRegistered: cleaner.vat_registered,
    lineItems,
    totalGross,
    totalCommission,
    totalNet,
    vatRate,
    vatAmount,
    totalWithVat,
  });

  // 9. Upload HTML to storage
  const htmlFileName = `${invoiceNumber}.html`;
  const { error: uploadErr } = await supabase.storage
    .from("invoices")
    .upload(htmlFileName, new TextEncoder().encode(html), {
      contentType: "text/html; charset=utf-8",
      upsert: true,
    });
  if (uploadErr) throw new Error("Kunde inte ladda upp HTML-faktura: " + uploadErr.message);

  const { data: htmlUrlData } = supabase.storage.from("invoices").getPublicUrl(htmlFileName);
  const htmlUrl = htmlUrlData.publicUrl;

  // 10. Generate and upload PDF
  const pdfData = {
    invoiceNumber,
    invoiceDate,
    periodStart,
    periodEnd,
    buyer: { name: "Haghighi Consulting AB", orgNumber: "559402-4522", address: "Solna, Sverige" },
    seller: {
      name: sellerName,
      orgNumber: sellerOrg || "\u2014",
      address: sellerAddress || "\u2014",
      fSkatt: cleaner.f_skatt_verified || false,
      vatRegistered: cleaner.vat_registered || false,
    },
    lineItems: lineItems.map((li) => ({
      date: li.date,
      service: li.service,
      hours: li.hours,
      gross: li.gross,
      commissionPct: li.commission_pct,
      commission: li.commission,
      net: li.net,
    })),
    totalGross,
    totalCommission,
    totalNet,
    vatAmount,
    totalWithVat,
  };

  let pdfUrl = htmlUrl; // fallback to HTML if PDF fails
  try {
    const pdfBytes = await generatePdf(pdfData);
    const pdfFileName = `${invoiceNumber}.pdf`;
    const { error: pdfUploadErr } = await supabase.storage
      .from("invoices")
      .upload(pdfFileName, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (pdfUploadErr) {
      console.error("[SELF-INVOICE] PDF upload error:", pdfUploadErr.message);
    } else {
      const { data: pdfUrlData } = supabase.storage.from("invoices").getPublicUrl(pdfFileName);
      pdfUrl = pdfUrlData.publicUrl;
      console.log("[SELF-INVOICE] PDF uploaded:", pdfFileName);
    }
  } catch (pdfErr) {
    console.error("[SELF-INVOICE] PDF generation error:", (pdfErr as Error).message);
  }

  // 11. Insert self_invoices record
  const { data: invoice, error: insErr } = await supabase
    .from("self_invoices")
    .insert({
      invoice_number: invoiceNumber,
      cleaner_id: cleanerId,
      company_id: cleaner.company_id || null,
      period_start: periodStart,
      period_end: periodEnd,
      total_gross: totalGross,
      total_commission: totalCommission,
      total_net: totalNet,
      vat_amount: vatAmount,
      total_with_vat: totalWithVat,
      currency: "SEK",
      status: "draft",
      pdf_url: pdfUrl,
      html_url: htmlUrl,
      booking_ids: bookingIds,
      line_items: lineItems,
      buyer_name: "Haghighi Consulting AB",
      buyer_org_number: "559402-4522",
      buyer_address: "Solna, Sverige",
      seller_name: sellerName,
      seller_org_number: sellerOrg,
      seller_address: sellerAddress,
      seller_f_skatt: cleaner.f_skatt_verified || false,
      seller_vat_registered: cleaner.vat_registered || false,
    })
    .select("id")
    .single();

  if (insErr) throw new Error("Kunde inte spara faktura: " + insErr.message);

  return {
    cleaner_id: cleanerId,
    invoice_id: invoice.id,
    invoice_number: invoiceNumber,
    pdf_url: pdfUrl,
  };
}

// ─── Service name translation ────────────────────────────────

function translateService(type: string): string {
  const map: Record<string, string> = {
    hemstadning: "Hemstädning",
    storstadning: "Storstädning",
    flyttstadning: "Flyttstädning",
    fonsterputs: "Fönsterputs",
    kontor: "Kontorsstädning",
  };
  return map[type] || type || "Städning";
}

// ─── HTML invoice builder ────────────────────────────────────

interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  periodStart: string;
  periodEnd: string;
  sellerName: string;
  sellerOrg: string;
  sellerAddress: string;
  fSkatt: boolean;
  vatRegistered: boolean;
  lineItems: Array<{
    date: string;
    service: string;
    hours: number;
    gross: number;
    commission_pct: number;
    commission: number;
    net: number;
  }>;
  totalGross: number;
  totalCommission: number;
  totalNet: number;
  vatRate: number;
  vatAmount: number;
  totalWithVat: number;
}

function buildInvoiceHtml(d: InvoiceData): string {
  const fmt = (n: number) => n.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rows = d.lineItems
    .map(
      (li) => `
    <tr>
      <td>${esc(li.date)}</td>
      <td>${esc(li.service)}</td>
      <td style="text-align:right">${li.hours}</td>
      <td style="text-align:right">${fmt(li.gross)}</td>
      <td style="text-align:right">${li.commission_pct}%</td>
      <td style="text-align:right">${fmt(li.commission)}</td>
      <td style="text-align:right">${fmt(li.net)}</td>
    </tr>`,
    )
    .join("");

  const vatRow = d.vatRegistered
    ? `<tr><td colspan="6" style="text-align:right;font-weight:600">Moms ${d.vatRate}%:</td><td style="text-align:right">${fmt(d.vatAmount)} SEK</td></tr>`
    : `<tr><td colspan="7" style="text-align:right;color:#666;font-size:13px">Säljaren är inte momsregistrerad — moms: 0,00 SEK</td></tr>`;

  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Självfaktura ${esc(d.invoiceNumber)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color:#1a1a19; background:#fff; padding:40px; max-width:800px; margin:0 auto; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; padding-bottom:24px; border-bottom:3px solid #0F6E56; }
  .header h1 { font-size:28px; font-weight:700; color:#0F6E56; letter-spacing:1px; }
  .header .invoice-meta { text-align:right; font-size:14px; color:#555; }
  .header .invoice-meta strong { color:#1a1a19; }
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:32px; }
  .party { padding:20px; background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb; }
  .party h3 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#0F6E56; margin-bottom:12px; font-weight:600; }
  .party p { font-size:14px; line-height:1.6; color:#333; }
  .party .badge { display:inline-block; background:#dcfce7; color:#166534; font-size:11px; padding:2px 8px; border-radius:4px; margin-top:8px; font-weight:600; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; font-size:13px; }
  thead th { background:#0F6E56; color:#fff; padding:10px 12px; text-align:left; font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; }
  thead th:first-child { border-radius:6px 0 0 0; }
  thead th:last-child { border-radius:0 6px 0 0; }
  tbody td { padding:10px 12px; border-bottom:1px solid #e5e7eb; }
  tbody tr:nth-child(even) { background:#f9fafb; }
  tbody tr:hover { background:#f0fdf4; }
  .summary { border-top:2px solid #0F6E56; padding-top:16px; }
  .summary tr td { padding:8px 12px; font-size:14px; border:none; }
  .summary .total-row td { font-size:18px; font-weight:700; color:#0F6E56; padding-top:12px; border-top:2px solid #0F6E56; }
  .payment-ref { margin:24px 0; padding:16px 20px; background:#eff6ff; border-radius:8px; border-left:4px solid #0F6E56; font-size:14px; color:#333; }
  .footer { margin-top:40px; padding-top:20px; border-top:1px solid #e5e7eb; font-size:12px; color:#666; line-height:1.6; text-align:center; }
  .period-label { font-size:14px; color:#666; margin-bottom:16px; }
  @media print { body { padding:20px; } .header { border-bottom-width:2px; } }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>SJÄLVFAKTURA</h1>
    <div style="font-size:13px;color:#666;margin-top:4px">Self-billing invoice</div>
  </div>
  <div class="invoice-meta">
    <div><strong>Fakturanr:</strong> ${esc(d.invoiceNumber)}</div>
    <div><strong>Fakturadatum:</strong> ${esc(d.invoiceDate)}</div>
    <div><strong>Period:</strong> ${esc(d.periodStart)} – ${esc(d.periodEnd)}</div>
  </div>
</div>

<div class="parties">
  <div class="party">
    <h3>Köpare (utställare)</h3>
    <p>
      <strong>Haghighi Consulting AB</strong><br>
      Org.nr: 559402-4522<br>
      Solna, Sverige
    </p>
  </div>
  <div class="party">
    <h3>Säljare (utförare)</h3>
    <p>
      <strong>${esc(d.sellerName)}</strong><br>
      ${d.sellerOrg ? `Org.nr: ${esc(d.sellerOrg)}<br>` : ""}
      ${d.sellerAddress ? `${esc(d.sellerAddress)}<br>` : ""}
      ${d.fSkatt ? '<span class="badge">Godkänd för F-skatt</span>' : ""}
    </p>
  </div>
</div>

<div class="period-label">Utförda tjänster under perioden ${esc(d.periodStart)} – ${esc(d.periodEnd)}:</div>

<table>
  <thead>
    <tr>
      <th>Datum</th>
      <th>Tjänst</th>
      <th style="text-align:right">Timmar</th>
      <th style="text-align:right">Brutto (SEK)</th>
      <th style="text-align:right">Provision</th>
      <th style="text-align:right">Provision (SEK)</th>
      <th style="text-align:right">Netto (SEK)</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<table class="summary">
  <tr>
    <td colspan="6" style="text-align:right;font-weight:600">Total brutto:</td>
    <td style="text-align:right;font-weight:600">${fmt(d.totalGross)} SEK</td>
  </tr>
  <tr>
    <td colspan="6" style="text-align:right;font-weight:600">Total provision:</td>
    <td style="text-align:right;font-weight:600">−${fmt(d.totalCommission)} SEK</td>
  </tr>
  <tr>
    <td colspan="6" style="text-align:right;font-weight:600">Total netto:</td>
    <td style="text-align:right;font-weight:600">${fmt(d.totalNet)} SEK</td>
  </tr>
  ${vatRow}
  <tr class="total-row">
    <td colspan="6" style="text-align:right">Att betala:</td>
    <td style="text-align:right">${fmt(d.totalWithVat)} SEK</td>
  </tr>
</table>

<div class="payment-ref">
  <strong>Betalningsreferens:</strong> Utbetalt löpande via Stripe Connect till säljarens konto.
</div>

<div class="footer">
  Denna självfaktura är utställd av köparen enligt mervärdesskattelagen (ML) 11 kap.<br>
  Säljaren har godkänt förfarandet genom uppdragsavtalet med Spick.<br><br>
  <strong style="color:#0F6E56">Spick</strong> — Sveriges städplattform &bull; spick.se
</div>

</body>
</html>`;
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── PDF invoice builder (pdf-lib) ──────────────────────────

interface PdfInvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  periodStart: string;
  periodEnd: string;
  buyer: { name: string; orgNumber: string; address: string };
  seller: { name: string; orgNumber: string; address: string; fSkatt: boolean; vatRegistered: boolean };
  lineItems: Array<{ date: string; service: string; hours: number; gross: number; commissionPct: number; commission: number; net: number }>;
  totalGross: number;
  totalCommission: number;
  totalNet: number;
  vatAmount: number;
  totalWithVat: number;
}

// Replace Swedish chars for Helvetica (no Unicode support)
function ascii(s: string): string {
  return (s || "")
    .replace(/å/g, "a").replace(/Å/g, "A")
    .replace(/ä/g, "a").replace(/Ä/g, "A")
    .replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/é/g, "e").replace(/É/g, "E")
    .replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/—/g, "-").replace(/–/g, "-")
    .replace(/•/g, "*").replace(/\u2014/g, "-");
}

async function generatePdf(d: PdfInvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  // Try to load Inter font with Swedish chars, fallback to Helvetica
  let font: Awaited<ReturnType<typeof doc.embedFont>>;
  let fontBold: Awaited<ReturnType<typeof doc.embedFont>>;
  let useFallback = false;

  // Try multiple CDNs for Inter font (supports å, ä, ö)
  const fontSources = [
    {
      regular: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf",
      bold: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf",
      name: "jsdelivr",
    },
    {
      regular: "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hjQ.ttf",
      bold: "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hjQ.ttf",
      name: "gstatic",
    },
  ];

  for (const src of fontSources) {
    try {
      const [fontResp, boldResp] = await Promise.all([
        fetch(src.regular, { signal: AbortSignal.timeout(8000) }),
        fetch(src.bold, { signal: AbortSignal.timeout(8000) }),
      ]);
      if (fontResp.ok && boldResp.ok) {
        const [fontBytes, boldBytes] = await Promise.all([
          fontResp.arrayBuffer(),
          boldResp.arrayBuffer(),
        ]);
        font = await doc.embedFont(fontBytes);
        fontBold = await doc.embedFont(boldBytes);
        console.log(`[SELF-INVOICE] Inter font loaded from ${src.name}`);
        break;
      }
    } catch (e) {
      console.warn(`[SELF-INVOICE] Font fetch failed (${src.name}):`, (e as Error).message);
    }
  }

  if (!font) {
    font = await doc.embedFont(StandardFonts.Helvetica);
    fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    useFallback = true;
    console.log("[SELF-INVOICE] Using Helvetica fallback (no Swedish chars)");
  }

  const t = useFallback ? ascii : (s: string) => s;

  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const GREEN = rgb(15 / 255, 110 / 255, 86 / 255);
  const BLACK = rgb(0.1, 0.1, 0.1);
  const GRAY = rgb(0.4, 0.4, 0.4);
  const WHITE = rgb(1, 1, 1);
  const LIGHT_GRAY = rgb(0.95, 0.95, 0.95);

  function text(s: string, x: number, yP: number, opts: { f?: typeof font; sz?: number; c?: typeof BLACK } = {}) {
    page.drawText(s, { x, y: yP, size: opts.sz || 10, font: opts.f || font, color: opts.c || BLACK });
  }

  function textR(s: string, xRight: number, yP: number, opts: { f?: typeof font; sz?: number; c?: typeof BLACK } = {}) {
    const f2 = opts.f || font;
    const w = f2.widthOfTextAtSize(s, opts.sz || 10);
    text(s, xRight - w, yP, opts);
  }

  function line(x1: number, yP: number, x2: number, th = 1, c = GREEN) {
    page.drawLine({ start: { x: x1, y: yP }, end: { x: x2, y: yP }, thickness: th, color: c });
  }

  // === HEADER ===
  text(t("SJÄLVFAKTURA"), margin, y, { f: fontBold, sz: 22, c: GREEN });
  text("Self-billing invoice", margin, y - 18, { sz: 9, c: GRAY });

  const metaX = width - margin - 180;
  text(`Fakturanr: ${d.invoiceNumber}`, metaX, y, { f: fontBold, sz: 10 });
  text(`Fakturadatum: ${d.invoiceDate}`, metaX, y - 14, { sz: 9, c: GRAY });
  text(`Period: ${d.periodStart} - ${d.periodEnd}`, metaX, y - 28, { sz: 9, c: GRAY });

  y -= 45;
  line(margin, y, width - margin, 2);
  y -= 25;

  // === BUYER & SELLER ===
  const colW = (width - margin * 2 - 20) / 2;

  text(t("KÖPARE (UTSTÄLLARE)"), margin, y, { f: fontBold, sz: 8, c: GREEN });
  y -= 16;
  text(d.buyer.name, margin, y, { f: fontBold, sz: 10 });
  y -= 14;
  text(`Org.nr: ${d.buyer.orgNumber}`, margin, y, { sz: 9, c: GRAY });
  y -= 14;
  text(t(d.buyer.address), margin, y, { sz: 9, c: GRAY });

  const sellerX = margin + colW + 20;
  let sY = y + 44;
  text(t("SÄLJARE (UTFÖRARE)"), sellerX, sY, { f: fontBold, sz: 8, c: GREEN });
  sY -= 16;
  text(t(d.seller.name), sellerX, sY, { f: fontBold, sz: 10 });
  sY -= 14;
  text(`Org.nr: ${d.seller.orgNumber}`, sellerX, sY, { sz: 9, c: GRAY });
  sY -= 14;
  text(t(d.seller.address), sellerX, sY, { sz: 9, c: GRAY });
  if (d.seller.fSkatt) {
    sY -= 14;
    text(t("Godkänd för F-skatt"), sellerX, sY, { f: fontBold, sz: 8, c: GREEN });
  }

  y -= 40;
  text(t(`Utförda tjänster under perioden ${d.periodStart} - ${d.periodEnd}:`), margin, y, { sz: 9, c: GRAY });
  y -= 20;

  // === TABLE HEADER ===
  const cols = [
    { label: "Datum", x: margin, w: 70, right: false },
    { label: t("Tjänst"), x: margin + 70, w: 110, right: false },
    { label: "Timmar", x: margin + 180, w: 50, right: true },
    { label: "Brutto", x: margin + 230, w: 70, right: true },
    { label: "Prov.%", x: margin + 300, w: 50, right: true },
    { label: "Provision", x: margin + 350, w: 70, right: true },
    { label: "Netto", x: margin + 420, w: 75, right: true },
  ];

  page.drawRectangle({ x: margin, y: y - 4, width: width - margin * 2, height: 18, color: GREEN });
  cols.forEach((col) => {
    const tw = fontBold.widthOfTextAtSize(col.label, 8);
    const xP = col.right ? col.x + col.w - tw : col.x + 4;
    text(col.label, xP, y, { f: fontBold, sz: 8, c: WHITE });
  });
  y -= 20;

  // === TABLE ROWS ===
  const fmt2 = (n: number) => n.toFixed(2);

  d.lineItems.forEach((item, i) => {
    if (y < 100) return; // page overflow guard
    if (i % 2 === 0) {
      page.drawRectangle({ x: margin, y: y - 4, width: width - margin * 2, height: 16, color: LIGHT_GRAY });
    }
    const rowData = [item.date, t(item.service), String(item.hours), fmt2(item.gross), `${item.commissionPct}%`, fmt2(item.commission), fmt2(item.net)];
    cols.forEach((col, ci) => {
      const val = rowData[ci];
      if (col.right) { textR(val, col.x + col.w, y, { sz: 9 }); }
      else { text(val, col.x + 4, y, { sz: 9 }); }
    });
    y -= 16;
  });

  y -= 10;
  line(margin, y, width - margin, 1.5);
  y -= 20;

  // === SUMMARY ===
  const sumLX = margin + 300;
  const sumVX = width - margin - 10;

  function sumRow(label: string, value: string, bold = false) {
    const f2 = bold ? fontBold : font;
    const sz = bold ? 13 : 10;
    text(label, sumLX, y, { f: f2, sz });
    textR(value, sumVX, y, { f: f2, sz, c: bold ? GREEN : BLACK });
    y -= bold ? 22 : 16;
  }

  sumRow("Total brutto:", `${fmt2(d.totalGross)} SEK`);
  sumRow("Total provision:", `-${fmt2(d.totalCommission)} SEK`);
  sumRow("Total netto:", `${fmt2(d.totalNet)} SEK`);

  if (!d.seller.vatRegistered) {
    text(t("Säljaren är inte momsregistrerad - moms: 0,00 SEK"), sumLX, y, { sz: 8, c: GRAY });
    y -= 16;
  } else {
    sumRow("Moms 25%:", `${fmt2(d.vatAmount)} SEK`);
  }

  line(sumLX, y + 6, width - margin, 1.5);
  y -= 8;
  sumRow("Att betala:", `${fmt2(d.totalWithVat)} SEK`, true);

  // === PAYMENT REF ===
  y -= 10;
  page.drawRectangle({ x: margin, y: y - 8, width: width - margin * 2, height: 30, color: rgb(0.93, 0.96, 1) });
  page.drawRectangle({ x: margin, y: y - 8, width: 3, height: 30, color: GREEN });
  text(t("Betalningsreferens: Utbetalt löpande via Stripe Connect till säljarens konto."), margin + 12, y + 2, { sz: 9 });

  // === FOOTER ===
  y -= 50;
  line(margin, y + 10, width - margin, 0.5, GRAY);
  text(t("Denna självfaktura är utställd av köparen enligt mervärdesskattelagen (ML) 11 kap."), margin, y - 5, { sz: 8, c: GRAY });
  text(t("Säljaren har godkänt förfarandet genom uppdragsavtalet med Spick."), margin, y - 17, { sz: 8, c: GRAY });
  text(t("Spick - Sveriges städplattform * spick.se"), margin, y - 35, { f: fontBold, sz: 8, c: GREEN });

  return await doc.save();
}
