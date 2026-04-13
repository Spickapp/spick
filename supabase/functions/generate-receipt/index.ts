// ═══════════════════════════════════════════════════════════════
// SPICK – Kundkvitto (Customer Receipt PDF)
// Genererar kvitto-PDF vid betalning. Privat = RUT-info, Företag = org.nr
// Anropas av stripe-webhook efter checkout.session.completed
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
    const receiptData: ReceiptData = {
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

    // 6. Generate PDF
    const pdfBytes = await generateReceiptPdf(receiptData);
    const pdfFileName = `${receiptNumber}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("receipts")
      .upload(pdfFileName, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[RECEIPT] Upload error:", uploadErr.message);
      return json(500, { error: "Kunde inte ladda upp kvitto: " + uploadErr.message });
    }

    const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(pdfFileName);
    const receiptUrl = urlData.publicUrl;
    console.log("[RECEIPT] PDF uploaded:", receiptUrl);

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

// ─── Service name translation ───────────────────────────────

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

// ─── ASCII fallback for Helvetica ───────────────────────────

function ascii(s: string): string {
  return (s || "")
    .replace(/å/g, "a").replace(/Å/g, "A")
    .replace(/ä/g, "a").replace(/Ä/g, "A")
    .replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/é/g, "e").replace(/É/g, "E")
    .replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/—/g, "-").replace(/–/g, "-")
    .replace(/•/g, "*");
}

// ─── PDF Generator ──────────────────────────────────────────

async function generateReceiptPdf(d: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  // Try Inter font, fallback to Helvetica
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
        console.log(`[RECEIPT] Inter font loaded from ${src.name}`);
        break;
      }
    } catch (e) {
      console.warn(`[RECEIPT] Font fetch failed (${src.name}):`, (e as Error).message);
    }
  }

  if (!font) {
    font = await doc.embedFont(StandardFonts.Helvetica);
    fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    useFallback = true;
    console.log("[RECEIPT] Using Helvetica fallback");
  }

  const t = useFallback ? ascii : (s: string) => s;
  const fmt = (n: number) => n.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const GREEN = rgb(15 / 255, 110 / 255, 86 / 255);
  const BLACK = rgb(0.1, 0.1, 0.1);
  const GRAY = rgb(0.4, 0.4, 0.4);
  const WHITE = rgb(1, 1, 1);
  const LIGHT_BG = rgb(0.97, 0.97, 0.96);
  const RUT_BG = rgb(0.88, 0.96, 0.93);

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

  // ═══ HEADER ═══
  text("Spick", margin, y, { f: fontBold, sz: 26, c: GREEN });
  text("KVITTO", margin + 100, y + 2, { f: fontBold, sz: 18, c: BLACK });

  const metaX = width - margin;
  textR(`Kvittonr: ${d.receiptNumber}`, metaX, y, { f: fontBold, sz: 10 });
  textR(`Datum: ${d.receiptDate}`, metaX, y - 14, { sz: 9, c: GRAY });

  y -= 35;
  line(margin, y, width - margin, 2);
  y -= 25;

  // ═══ FROM / TO ═══
  const colW = (width - margin * 2 - 30) / 2;

  // From: Spick
  text(t("FRÅN"), margin, y, { f: fontBold, sz: 8, c: GREEN });
  y -= 14;
  text("Haghighi Consulting AB", margin, y, { f: fontBold, sz: 10 });
  y -= 13;
  text("Bifirma: Spick", margin, y, { sz: 9, c: GRAY });
  y -= 13;
  text("Org.nr: 559402-4522", margin, y, { sz: 9, c: GRAY });
  y -= 13;
  text("hello@spick.se", margin, y, { sz: 9, c: GRAY });

  // To: Customer
  const toX = margin + colW + 30;
  let toY = y + 53;
  text("TILL", toX, toY, { f: fontBold, sz: 8, c: GREEN });
  toY -= 14;

  if (d.isCompany && d.companyName) {
    text(t(d.companyName), toX, toY, { f: fontBold, sz: 10 });
    toY -= 13;
    if (d.companyOrg) {
      text(`Org.nr: ${d.companyOrg}`, toX, toY, { sz: 9, c: GRAY });
      toY -= 13;
    }
    if (d.companyRef) {
      text(`Ref: ${t(d.companyRef)}`, toX, toY, { sz: 9, c: GRAY });
      toY -= 13;
    }
    text(t(d.customerName), toX, toY, { sz: 9, c: GRAY });
  } else {
    text(t(d.customerName), toX, toY, { f: fontBold, sz: 10 });
    toY -= 13;
    text(d.customerEmail, toX, toY, { sz: 9, c: GRAY });
  }

  y -= 30;
  line(margin, y, width - margin, 0.5, GRAY);
  y -= 25;

  // ═══ BOOKING DETAILS TABLE ═══
  text(t("BOKNINGSDETALJER"), margin, y, { f: fontBold, sz: 9, c: GREEN });
  y -= 18;

  // Table header
  const tblLeft = margin;
  const tblRight = width - margin;
  page.drawRectangle({ x: tblLeft, y: y - 4, width: tblRight - tblLeft, height: 20, color: GREEN });

  const detailCols = [
    { label: t("Tjänst"), x: tblLeft + 6, right: false },
    { label: "Datum", x: tblLeft + 170, right: false },
    { label: "Tid", x: tblLeft + 270, right: false },
    { label: "Timmar", x: tblLeft + 340, right: true },
    { label: "Adress", x: tblLeft + 360, right: false },
  ];

  detailCols.forEach(col => {
    text(col.label, col.x, y, { f: fontBold, sz: 8, c: WHITE });
  });
  y -= 22;

  // Table row
  page.drawRectangle({ x: tblLeft, y: y - 4, width: tblRight - tblLeft, height: 18, color: LIGHT_BG });
  text(t(d.service), tblLeft + 6, y, { sz: 9 });
  text(d.bookingDate, tblLeft + 170, y, { sz: 9 });
  text(d.bookingTime, tblLeft + 270, y, { sz: 9 });
  textR(String(d.hours), tblLeft + 355, y, { sz: 9 });
  // Address might be long — truncate to fit
  const addrMax = 28;
  const addrTrunc = d.address.length > addrMax ? d.address.substring(0, addrMax) + "..." : d.address;
  text(t(addrTrunc), tblLeft + 360, y, { sz: 8, c: GRAY });

  y -= 28;

  if (d.cleanerName) {
    text(t(`Städare: ${d.cleanerName}`), margin, y, { sz: 9, c: GRAY });
    y -= 18;
  }

  line(margin, y, width - margin, 0.5, GRAY);
  y -= 25;

  // ═══ PRICING SECTION ═══
  text("BETALNING", margin, y, { f: fontBold, sz: 9, c: GREEN });
  y -= 20;

  const lblX = margin + 10;
  const valX = width - margin - 10;

  if (d.isCompany) {
    // ── COMPANY RECEIPT ──
    const exVat = Math.round(d.totalPrice * 0.8); // 20% VAT on 25% = price / 1.25
    const vat = d.totalPrice - exVat;

    page.drawRectangle({ x: margin, y: y - 8, width: tblRight - tblLeft, height: 80, color: LIGHT_BG, borderColor: rgb(0.9, 0.9, 0.88), borderWidth: 1 });

    text(t("Tjänstepris exkl. moms:"), lblX, y, { sz: 10 });
    textR(`${fmt(exVat)} kr`, valX, y, { sz: 10 });
    y -= 18;
    text("Moms (25%):", lblX, y, { sz: 10 });
    textR(`${fmt(vat)} kr`, valX, y, { sz: 10 });
    y -= 18;
    line(lblX, y + 4, valX, 0.5, GRAY);
    y -= 6;
    text("Totalt inkl. moms:", lblX, y, { f: fontBold, sz: 11 });
    textR(`${fmt(d.totalPrice)} kr`, valX, y, { f: fontBold, sz: 11 });
    y -= 20;
    const pm = d.paymentMethod === "klarna" ? "Klarna" : "Kortbetalning";
    text(t(`Betalningsmetod: ${pm}`), lblX, y, { sz: 9, c: GRAY });

    y -= 30;

    if (d.companyRef) {
      page.drawRectangle({ x: margin, y: y - 8, width: tblRight - tblLeft, height: 24, color: rgb(0.93, 0.96, 1) });
      page.drawRectangle({ x: margin, y: y - 8, width: 3, height: 24, color: GREEN });
      text(`Fakturareferens: ${t(d.companyRef)}`, margin + 12, y, { sz: 9 });
      y -= 30;
    }
  } else {
    // ── PRIVATE RECEIPT ──
    const boxH = d.isRut ? 110 : 70;
    page.drawRectangle({ x: margin, y: y - boxH + 55, width: tblRight - tblLeft, height: boxH, color: LIGHT_BG, borderColor: rgb(0.9, 0.9, 0.88), borderWidth: 1 });

    text(t("Tjänstepris:"), lblX, y, { sz: 10 });
    textR(`${fmt(d.totalPrice)} kr`, valX, y, { sz: 10 });
    y -= 18;

    if (d.isRut) {
      text("RUT-avdrag (50%):", lblX, y, { sz: 10, c: GREEN });
      textR(`-${fmt(d.rutAmount)} kr`, valX, y, { sz: 10, c: GREEN });
      y -= 18;
      line(lblX, y + 4, valX, 0.5, GRAY);
      y -= 6;
      text(t("Du betalar:"), lblX, y, { f: fontBold, sz: 12 });
      textR(`${fmt(d.amountPaid)} kr`, valX, y, { f: fontBold, sz: 12, c: GREEN });
      y -= 20;
      const pm = d.paymentMethod === "klarna" ? "Klarna" : "Kortbetalning";
      text(t(`Betalningsmetod: ${pm}`), lblX, y, { sz: 9, c: GRAY });
      y -= 25;
    } else {
      line(lblX, y + 4, valX, 0.5, GRAY);
      y -= 6;
      text(t("Du betalar:"), lblX, y, { f: fontBold, sz: 12 });
      textR(`${fmt(d.amountPaid)} kr`, valX, y, { f: fontBold, sz: 12, c: GREEN });
      y -= 20;
      const pm = d.paymentMethod === "klarna" ? "Klarna" : "Kortbetalning";
      text(t(`Betalningsmetod: ${pm}`), lblX, y, { sz: 9, c: GRAY });
      y -= 25;
    }

    // RUT info box
    if (d.isRut) {
      const rutBoxH = 52;
      page.drawRectangle({ x: margin, y: y - rutBoxH + 18, width: tblRight - tblLeft, height: rutBoxH, color: RUT_BG, borderColor: GREEN, borderWidth: 0.5 });
      text("RUT-avdrag", margin + 12, y, { f: fontBold, sz: 10, c: GREEN });
      y -= 14;
      text(t("Spick ansöker automatiskt om ditt RUT-avdrag hos Skatteverket."), margin + 12, y, { sz: 9, c: BLACK });
      y -= 13;
      text(t("Du behöver inte göra något — avdraget hanteras av oss."), margin + 12, y, { sz: 9, c: BLACK });
      y -= 25;
    }
  }

  y -= 10;
  line(margin, y, width - margin, 0.5, GRAY);
  y -= 20;

  // ═══ GUARANTEE ═══
  page.drawRectangle({ x: margin, y: y - 22, width: tblRight - tblLeft, height: 36, color: LIGHT_BG });
  text(t("Nöjdhetsgaranti"), margin + 12, y, { f: fontBold, sz: 10, c: GREEN });
  y -= 14;
  text(t("Inte nöjd med städningen? Vi städar om kostnadsfritt. Kontakta hello@spick.se inom 24h."), margin + 12, y, { sz: 9, c: GRAY });

  y -= 30;

  // ═══ BOOKING REFERENCE ═══
  text(`Boknings-ID: ${d.bookingId}`, margin, y, { sz: 8, c: GRAY });

  // ═══ FOOTER ═══
  y = margin + 20;
  line(margin, y + 10, width - margin, 0.5, GRAY);
  text("Haghighi Consulting AB (bifirma Spick) | Org.nr: 559402-4522 | hello@spick.se", margin, y - 5, { sz: 8, c: GRAY });
  text(t("Spick — Sveriges städplattform | spick.se"), margin, y - 18, { f: fontBold, sz: 8, c: GREEN });

  return await doc.save();
}
