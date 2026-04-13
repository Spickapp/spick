// ═══════════════════════════════════════════════════════════════
// SPICK – Självfaktura-generator (Self-billing invoice)
// Genererar månadsvis självfakturor för städare med F-skatt
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
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

  // 10. pdf_url = htmlUrl (HTML har perfekta svenska tecken + print-CSS)
  const pdfUrl = htmlUrl;

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
