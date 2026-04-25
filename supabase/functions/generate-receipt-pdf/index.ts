// ═══════════════════════════════════════════════════════════════
// SPICK – generate-receipt-pdf (Fas F-PDF, 2026-04-28)
// ═══════════════════════════════════════════════════════════════
//
// Genererar PDF-kvitto/faktura för en bokning. Använder SAMMA
// BokfL 5 kap 7§ + MervL 11 kap 8§-fält som generate-receipt-EF
// (HTML-email) så regulator-granskning gäller identisk.
//
// Används för: städfirmors bokföring (Fortnox/Visma-arkiv),
// kund-bekräftelse (nedladdningsbart), revisor-audit.
//
// PRIMÄRKÄLLA: generate-receipt/index.ts §computePricingBreakdown +
// platform_settings company_*-nycklar (Fas 2.5-R2).
//
// FLÖDE:
//   1. JWT-auth (customer eller admin)
//   2. Fetch booking + platform_settings company-info
//   3. Ownership: customer-email match ELLER admin-role
//   4. Build PDF med pdf-lib: text-rader i BokfL-ordning
//   5. Return Content-Type: application/pdf, attachment-filename
//
// OUT-OF-SCOPE:
//   - Batch-generering (månads-ZIP) — separat EF
//   - Fönster/loga-design — text-only MVP
//   - Självfaktura (SF-prefix) — generate-self-invoice har egen path
//
// REGLER: #26 läst generate-receipt pricing-breakdown + field-list,
// #27 read-only + MVP-rendering, #28 SSOT = platform_settings för
// company-info + bookings som data-källa, #30 BokfL-fälten speglar
// generate-receipt exakt (redan regulator-granskad i Fas 2.5-R2),
// #31 pdf-lib verifierad Deno-kompatibel (esm.sh).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);

function fmtKr(n: number): string {
  return Math.round(n || 0).toLocaleString("sv-SE");
}

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

// ── Document-classifier (Iteration 1, 2026-04-25) ──
// Mappar payment_status × customer_type till PDF-titel + status-text +
// refund-flag. Tidigare hade EF:n binär logik (KVITTO/FAKTURA + paid/Ej
// betald) som visade "Ej betald" för refunded-bokningar — BokfL-vilseledande.
//
// Källor:
//   - BokfL 5 kap 7§: kvitto = dokumentation av affärshändelse
//   - SSOT för status-mapping: denna funktion (rule #28)
//
// Default = pending → ORDERBEKRÄFTELSE (säker fallback för okända status).
type DocumentMode = {
  title: string;
  statusText: string;
  showRefund: boolean;
  isReceipt: boolean;       // true om "kvitto" (paid eller refunded privat)
  fileLabel: string;        // för filnamn + footer-text
  // Iteration 2 (2026-04-25): status-badge-färg [r, g, b] 0-1
  statusColor: [number, number, number];
};

// Status-badge-färger (Iteration 2). Matchar UI-konventioner:
//   Grön = positivt slutfört (Betald)
//   Orange = övergångstillstånd (Återbetald, Krediterad)
//   Röd = negativt avslut (Avbruten)
//   Grå = väntande (Ej betald)
const COLOR_PAID: [number, number, number] = [0.09, 0.40, 0.17];     // #16a34a
const COLOR_REFUNDED: [number, number, number] = [0.96, 0.62, 0.04]; // #F59E0B
const COLOR_CANCELLED: [number, number, number] = [0.73, 0.11, 0.11]; // #b91c1c
const COLOR_PENDING: [number, number, number] = [0.42, 0.41, 0.38];   // grey

function classifyDocument(
  paymentStatus: string,
  isCompanyCustomer: boolean,
): DocumentMode {
  const ps = (paymentStatus || "").toLowerCase();

  // B2B: alltid faktura/fakturaunderlag oavsett payment-status
  if (isCompanyCustomer) {
    if (ps === "refunded") {
      return { title: "FAKTURA (krediterad)", statusText: "Krediterad", showRefund: true, isReceipt: false, fileLabel: "faktura", statusColor: COLOR_REFUNDED };
    }
    if (ps === "paid") {
      return { title: "FAKTURA", statusText: "Betald", showRefund: false, isReceipt: false, fileLabel: "faktura", statusColor: COLOR_PAID };
    }
    if (ps === "cancelled") {
      return { title: "FAKTURA (avbruten)", statusText: "Avbruten", showRefund: false, isReceipt: false, fileLabel: "faktura", statusColor: COLOR_CANCELLED };
    }
    return { title: "FAKTURAUNDERLAG", statusText: "Ej betald", showRefund: false, isReceipt: false, fileLabel: "fakturaunderlag", statusColor: COLOR_PENDING };
  }

  // Privat
  if (ps === "paid") {
    return { title: "KVITTO", statusText: "Betald", showRefund: false, isReceipt: true, fileLabel: "kvitto", statusColor: COLOR_PAID };
  }
  if (ps === "refunded") {
    return { title: "KVITTO (återbetald)", statusText: "Återbetald", showRefund: true, isReceipt: true, fileLabel: "kvitto", statusColor: COLOR_REFUNDED };
  }
  if (ps === "cancelled") {
    return { title: "AVBOKNINGSBEKRÄFTELSE", statusText: "Avbruten", showRefund: false, isReceipt: false, fileLabel: "avbokningsbekraftelse", statusColor: COLOR_CANCELLED };
  }
  // pending / okänt — säker default
  return { title: "ORDERBEKRÄFTELSE", statusText: "Ej betald", showRefund: false, isReceipt: false, fileLabel: "orderbekraftelse", statusColor: COLOR_PENDING };
}

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level, fn: "generate-receipt-pdf", msg, ...extra,
    ts: new Date().toISOString(),
  }));
}

async function fetchCompanyInfo() {
  const { data: rows } = await sbService
    .from("platform_settings")
    .select("key, value")
    .in("key", [
      "company_legal_name", "company_trade_name", "company_org_number",
      "company_address", "company_postal", "company_city",
      "company_email", "company_phone", "company_website",
      "vat_registration_number", "payment_provider_text",
    ]);
  const m = new Map<string, string>();
  (rows || []).forEach((r) => m.set(r.key as string, (r.value as string) || ""));
  return {
    legalName: m.get("company_legal_name") || "Haghighi Consulting AB",
    tradeName: m.get("company_trade_name") || "Spick",
    orgNumber: m.get("company_org_number") || "559402-4522",
    address: m.get("company_address") || "Solna, Sverige",
    postal: m.get("company_postal") || "",
    city: m.get("company_city") || "",
    email: m.get("company_email") || "hello@spick.se",
    phone: m.get("company_phone") || "",
    website: m.get("company_website") || "spick.se",
    vatNumber: m.get("vat_registration_number") || "",
    paymentProvider: m.get("payment_provider_text") || "Stripe",
  };
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "missing_auth" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.slice(7);
    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "invalid_auth" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Parse booking_id ──
    let bookingId: string | null = null;
    if (req.method === "GET") {
      bookingId = new URL(req.url).searchParams.get("booking_id");
    } else {
      const body = await req.json().catch(() => null);
      bookingId = body && typeof body === "object"
        ? (body as Record<string, unknown>).booking_id as string
        : null;
    }
    if (!isValidUuid(bookingId)) {
      return new Response(JSON.stringify({ error: "invalid_booking_id" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Fetch booking ──
    const { data: booking } = await sbService
      .from("bookings")
      .select("*")
      .eq("id", bookingId as string)
      .maybeSingle();

    if (!booking) {
      return new Response(JSON.stringify({ error: "booking_not_found" }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Ownership-check ──
    const jwtEmail = user.email?.toLowerCase().trim() || "";
    const bookingEmail = (booking.customer_email as string | null)?.toLowerCase().trim() || "";
    let authorized = jwtEmail && bookingEmail && jwtEmail === bookingEmail;

    if (!authorized) {
      // Admin-check via email (admin_users.email är primärnyckel,
      // matchar is_admin()-funktionen + get-booking-events EF).
      // Tidigare bug: refererade admin_users.user_id (kolumn finns ej)
      // → admin-fallback failade tyst, admins kunde inte ladda PDF.
      const adminEmail = user.email?.toLowerCase().trim() || "";
      if (adminEmail) {
        const { data: adminRow } = await sbService
          .from("admin_users")
          .select("id")
          .eq("email", adminEmail)
          .maybeSingle();
        if (adminRow) authorized = true;
      }
    }

    if (!authorized) {
      log("warn", "PDF-access denied", { booking_id: bookingId, user_id: user.id });
      return new Response(JSON.stringify({ error: "not_booking_owner" }), {
        status: 403, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Data + pricing ──
    const company = await fetchCompanyInfo();
    const isCompanyCustomer = String(booking.customer_type || "").toLowerCase() === "foretag";
    const totalPrice = Number(booking.total_price || 0);
    const rutAmount = Number(booking.rut_amount || 0);
    const isRut = rutAmount > 0;
    const gross = isRut ? totalPrice + rutAmount : totalPrice;
    const exVat = Math.round(gross / 1.25);
    const vat = gross - exVat;

    const receiptNumber = (booking.receipt_number as string) ||
      `SP-${new Date(booking.created_at as string).getFullYear()}-${(booking.id as string).slice(0, 8)}`;
    const issueDate = new Date(booking.created_at as string).toLocaleDateString("sv-SE");
    const serviceLabel = translateService(booking.service_type as string);
    const serviceDate = booking.booking_date as string;
    const serviceTime = ((booking.booking_time as string) || "").slice(0, 5);
    const hours = Number(booking.booking_hours || 0);
    const cleanerName = (booking.cleaner_name as string) || "–";

    // ── Build PDF ──
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const M = 40;           // margin
    const W = 595.28 - 2 * M;
    let y = 841.89 - M;

    const black = rgb(0, 0, 0);
    const dark = rgb(0.06, 0.43, 0.34);  // #0F6E56
    const grey = rgb(0.42, 0.41, 0.38);

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
      text(val, M + 180, y, { size, bold: false });
      y -= size + 6;
    }

    // Iteration 2: tunnare + ljusare separator-linjer för mer luft.
    const lightGrey = rgb(0.85, 0.85, 0.85);
    function divider() {
      page.drawLine({
        start: { x: M, y: y + 4 },
        end: { x: M + W, y: y + 4 },
        thickness: 0.3,
        color: lightGrey,
      });
      y -= 10;
    }

    // ── Document-klassificering (titel, status, refund-flag) ──
    const doc = classifyDocument(
      String(booking.payment_status || "pending"),
      isCompanyCustomer,
    );

    // ── Header — Iteration 2 ──
    // Logo "Spick" överst i grön Helvetica Bold (Playfair-font kräver
    // separat embedding, skjuts till Iteration 3).
    text("Spick", M, y, { size: 24, bold: true, color: dark });
    y -= 32;

    // Titel + status-badge på samma höjd
    text(doc.title, M, y, { size: 20, bold: true, color: dark });

    // Status-badge — colored pill till höger
    const badgeText = doc.statusText.toUpperCase();
    // Approximation av textbredd (pdf-lib font.widthOfTextAtSize finns
    // men kostar en async-operation; för status-text räcker char-count).
    const charW = 5.5;
    const badgePadding = 10;
    const badgeWidth = badgeText.length * charW + 2 * badgePadding;
    const badgeHeight = 16;
    const badgeX = M + W - badgeWidth;
    const badgeY = y - 1;
    page.drawRectangle({
      x: badgeX, y: badgeY, width: badgeWidth, height: badgeHeight,
      color: rgb(doc.statusColor[0], doc.statusColor[1], doc.statusColor[2]),
    });
    text(badgeText, badgeX + badgePadding, badgeY + 5, { size: 8, bold: true, color: rgb(1, 1, 1) });

    y -= 24;
    text(`Nr: ${receiptNumber}`, M, y, { size: 10, color: grey });
    text(`Utställt: ${issueDate}`, M + 280, y, { size: 10, color: grey });
    y -= 22;
    divider();

    // ── Säljare (BokfL 5 kap 7§ pt 2) ──
    text("SÄLJARE", M, y, { size: 9, bold: true, color: dark });
    y -= 14;
    row("Företag", `${company.legalName} (${company.tradeName})`);
    row("Organisationsnummer", company.orgNumber);
    row("Adress", `${company.address}${company.postal || company.city ? ", " + (company.postal + " " + company.city).trim() : ""}`);
    if (company.vatNumber) row("Momsregnr", company.vatNumber);
    row("E-post", company.email);
    if (company.phone) row("Telefon", company.phone);
    row("Webb", company.website);
    y -= 6;
    divider();

    // ── Köpare (BokfL 5 kap 7§ pt 3) ──
    text("KÖPARE", M, y, { size: 9, bold: true, color: dark });
    y -= 14;
    if (isCompanyCustomer) {
      row("Företag", String(booking.business_name || "–"));
      row("Organisationsnummer", String(booking.business_org_number || "–"));
      if (booking.business_vat_number) row("Momsregnr", String(booking.business_vat_number));
      row("Kontaktperson", String(booking.customer_name || "–"));
      if (booking.business_reference) row("Referens", String(booking.business_reference));
    } else {
      row("Namn", String(booking.customer_name || "–"));
    }
    row("E-post", String(booking.customer_email || "–"));
    row("Adress", String(booking.customer_address || "–"));
    y -= 6;
    divider();

    // ── Tjänst ──
    text("TJÄNST", M, y, { size: 9, bold: true, color: dark });
    y -= 14;
    row("Typ", serviceLabel);
    row("Datum", `${serviceDate} kl ${serviceTime}`);
    row("Omfattning", `${hours} timmar`);
    row("Städare", cleanerName);
    y -= 6;
    divider();

    // ── Belopp (BokfL 5 kap 7§ pt 4–6 + MervL 11 kap 8§) ──
    text("BELOPP", M, y, { size: 9, bold: true, color: dark });
    y -= 14;
    row("Netto (exkl. moms)", `${fmtKr(exVat)} kr`);
    row("Moms 25 %", `${fmtKr(vat)} kr`);
    row("Brutto (inkl. moms)", `${fmtKr(gross)} kr`);
    if (isRut) {
      row("RUT-avdrag 50 %", `-${fmtKr(rutAmount)} kr`);
    }
    y -= 4;

    // Iteration 2: "Att betala"-box med ljusgrå bakgrund för fokus.
    const attBetalaBoxH = 32;
    const attBetalaBoxY = y - attBetalaBoxH + 6;
    page.drawRectangle({
      x: M, y: attBetalaBoxY, width: W, height: attBetalaBoxH,
      color: rgb(0.96, 0.96, 0.93),  // ljus beige/grå
    });
    text("Att betala", M + 12, y - 14, { size: 13, bold: true, color: dark });
    // Höger-justera beloppet via approximerad bredd
    const amountStr = `${fmtKr(totalPrice)} kr`;
    const amountW = amountStr.length * 8.5;
    text(amountStr, M + W - amountW - 12, y - 14, { size: 15, bold: true, color: dark });
    y -= attBetalaBoxH + 10;
    divider();

    // ── Återbetalning (visas bara om payment_status=refunded) ──
    // BokfL: dokumenterad credit/återbetalning ska vara synlig på kvittot
    // för audit-trail. Använder bookings.updated_at som refund-datum
    // (refunded_at-kolumn finns inte i prod 2026-04-25).
    if (doc.showRefund) {
      const refundAmount = Number(booking.refund_amount || 0);
      const refundDate = booking.updated_at
        ? new Date(booking.updated_at as string).toLocaleDateString("sv-SE")
        : "–";
      text("ÅTERBETALNING", M, y, { size: 9, bold: true, color: dark });
      y -= 14;
      if (refundAmount > 0) {
        row("Belopp", `-${fmtKr(refundAmount)} kr`);
      }
      row("Datum", refundDate);
      row("Metod", company.paymentProvider);
      y -= 6;
      divider();
    }

    // ── Betalning ──
    text("BETALNING", M, y, { size: 9, bold: true, color: dark });
    y -= 14;
    row("Status", doc.statusText);
    row("Leverantör", company.paymentProvider);
    if (booking.stripe_session_id) row("Ref", String(booking.stripe_session_id).slice(0, 28) + "…");
    y -= 8;

    // ── Fotnot ──
    // BokfL/MervL gäller bara faktiska kvitton + fakturor (faktiska
    // affärshändelser). Orderbekräftelse + avbokningsbekräftelse
    // refererar inte regulator-spec.
    y = M + 20;
    const isBokfMaterial = doc.isReceipt || (isCompanyCustomer && doc.fileLabel === "faktura");
    const docArticle = doc.fileLabel === "orderbekraftelse" ? "en"
      : doc.fileLabel === "avbokningsbekraftelse" ? "en"
      : "ett";
    const docNoun = doc.fileLabel === "orderbekraftelse" ? "orderbekräftelse"
      : doc.fileLabel === "avbokningsbekraftelse" ? "avbokningsbekräftelse"
      : doc.fileLabel === "fakturaunderlag" ? "fakturaunderlag"
      : doc.fileLabel;
    text(
      `Detta dokument är ${docArticle} automatgenererad ${docNoun}` +
        (isBokfMaterial ? " och uppfyller BokfL 5 kap 7 § samt MervL 11 kap 8 §." : "."),
      M, y, { size: 8, color: grey }
    );

    const pdfBytesRaw = await pdfDoc.save();
    // Kopiera till standard Uint8Array<ArrayBuffer> för Response-body-kompat
    const pdfBytes = new Uint8Array(pdfBytesRaw);

    const filename = `${doc.fileLabel}-${receiptNumber}.pdf`;

    log("info", "PDF generated", {
      booking_id: bookingId,
      receipt_number: receiptNumber,
      is_company: isCompanyCustomer,
      bytes: pdfBytes.byteLength,
    });

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBytes.byteLength),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return new Response(JSON.stringify({ error: "internal_error", detail: (err as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
