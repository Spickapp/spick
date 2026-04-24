// rut-batch-export-xml — Fas 7.5 §7.5.x
// ═══════════════════════════════════════════════════════════════
// Genererar Skatteverket-kompatibel XML-fil (V6) för batch-upload till
// https://www7.skatteverket.se/portal/rotrut/begar-utbetalning/fil
//
// Flow:
//   1. Admin väljer bokningar via admin.html RUT-kö (checkboxes)
//   2. POST { booking_ids: [...], batch_name: "..." }
//   3. EF:en:
//      - Auth-check: admin krävs
//      - Läser bokningarna från DB
//      - Mappar till RutBegaran via _shared/rut-xml-builder
//      - Validerar mot SKV-regler (publika)
//      - Om valid: genererar XML-fil, laddar upp till Supabase storage,
//        skapar rut_batch_submissions-rad med status='exported'
//      - Om invalid: returnerar 400 med lista av fel per bokning
//
// Primärkällor:
//   - docs/skatteverket/xsd-v6/Begaran.xsd
//   - supabase/migrations/20260424233000_fas7_5_rut_batch_submissions.sql
//
// Rule #27: Endast export (XML-fil). Ingen auto-submit till SKV.
//           Farhad laddar ner filen, loggar in med BankID, uppladdar manuellt.
// Rule #28: Återanvänder _shared/rut-xml-builder. Ingen duplicering.
// Rule #30: Alla SKV-regler från publik XSD + publik valideringsregel-sida.
// Rule #31: Verifierar via curl att alla bookings finns + har rut_amount.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log } from "../_shared/email.ts";
import {
  buildRutXml,
  validateBegaran,
  bookingToRutArende,
  type RutBegaran,
  type SpickBookingForRut,
  MAX_BUYERS_PER_FILE,
} from "../_shared/rut-xml-builder.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Storage-bucket för XML-filer (skapas via Dashboard, publik bör vara OFF)
const XML_STORAGE_BUCKET = "rut-batches";

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (s: number, d: unknown) =>
    new Response(JSON.stringify(d), {
      status: s,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ── 1. Auth: admin krävs ─────────────────────────────────────
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
  if (!token || token === SUPA_ANON) {
    return json(401, { error: "Admin-token krävs" });
  }

  let adminEmail: string;
  let adminCleanerId: string | null = null;
  try {
    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPA_ANON },
    });
    if (!authRes.ok) return json(401, { error: "Invalid token" });
    const authUser = await authRes.json();
    adminEmail = (authUser.email || "").toLowerCase();
    if (!adminEmail) return json(401, { error: "No email in token" });

    const sbAdmin = createClient(SUPA_URL, SERVICE_KEY);
    const { data: adminRow } = await sbAdmin
      .from("admin_users")
      .select("id")
      .eq("email", adminEmail)
      .maybeSingle();
    if (!adminRow) return json(403, { error: "Forbidden: inte en admin" });

    // Hitta admin:s cleaner_id om de också är städare (för created_by-audit)
    const { data: cleanerRow } = await sbAdmin
      .from("cleaners")
      .select("id")
      .eq("email", adminEmail)
      .maybeSingle();
    if (cleanerRow) adminCleanerId = cleanerRow.id;
  } catch (e) {
    log("error", "rut-batch-export-xml", "Auth failed", { error: (e as Error).message });
    return json(401, { error: "Auth verification failed" });
  }

  // ── 2. Parse request ─────────────────────────────────────────
  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const bookingIds = body.booking_ids as string[] | undefined;
  const batchName = body.batch_name as string | undefined;

  if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
    return json(400, { error: "booking_ids (array) krävs" });
  }
  if (bookingIds.length > MAX_BUYERS_PER_FILE) {
    return json(400, {
      error: `Max ${MAX_BUYERS_PER_FILE} bokningar per batch (fick ${bookingIds.length})`,
    });
  }
  if (!batchName || typeof batchName !== "string") {
    return json(400, { error: "batch_name (1-16 tecken) krävs" });
  }
  if (batchName.length > 16) {
    return json(400, { error: "batch_name max 16 tecken" });
  }

  const sb = createClient(SUPA_URL, SERVICE_KEY);

  // ── 3. Hämta bokningar ───────────────────────────────────────
  const { data: bookings, error: bErr } = await sb
    .from("bookings")
    .select(`
      id, booking_id, customer_pnr, customer_name, customer_email,
      service_type, total_price, rut_amount,
      booking_date, booking_hours, actual_hours,
      completed_at, payment_marked_at, receipt_number,
      payment_status, status, rut_application_status,
      customer_type, dispute_status
    `)
    .in("id", bookingIds);

  if (bErr) {
    log("error", "rut-batch-export-xml", "Bookings fetch failed", { error: bErr.message });
    return json(500, { error: bErr.message });
  }
  if (!bookings || bookings.length !== bookingIds.length) {
    return json(404, {
      error: `Hittade ${bookings?.length || 0} av ${bookingIds.length} begärda bokningar`,
    });
  }

  // ── 4. Pre-validering: RUT-berättigade + ej redan submitted ─
  const preErrors: Array<{ booking_id: string; message: string }> = [];
  for (const b of bookings as Array<Record<string, unknown>>) {
    const id = b.id as string;
    if (!b.rut_amount || (b.rut_amount as number) <= 0) {
      preErrors.push({ booking_id: id, message: "Ingen rut_amount (inte RUT-berättigad)" });
    }
    if (b.customer_type !== "privat") {
      preErrors.push({ booking_id: id, message: "Endast privatkunder får RUT" });
    }
    if (b.payment_status !== "paid") {
      preErrors.push({ booking_id: id, message: `payment_status är '${b.payment_status}', krävs 'paid'` });
    }
    if (b.dispute_status !== "none") {
      preErrors.push({ booking_id: id, message: `dispute_status är '${b.dispute_status}', får inte vara aktivt dispute` });
    }
    if (["submitted", "approved"].includes(b.rut_application_status as string)) {
      preErrors.push({
        booking_id: id,
        message: `Redan '${b.rut_application_status}' — får inte dubbelsubmittas`,
      });
    }
    if (!b.customer_pnr) {
      preErrors.push({ booking_id: id, message: "customer_pnr saknas — kan inte skapa RUT-ansökan" });
    }
  }

  if (preErrors.length > 0) {
    return json(400, { error: "Pre-validering misslyckades", details: preErrors });
  }

  // ── 5. Mappa till RutArende + validera mot SKV-regler ────────
  const arenden = (bookings as SpickBookingForRut[])
    .map((b) => ({
      bookingId: b.id,
      arende: bookingToRutArende(b),
    }))
    .filter((x) => x.arende !== null);

  if (arenden.length === 0) {
    return json(400, { error: "Inga RUT-berättigade tjänster efter mappning" });
  }

  // Hitta alla unika kalenderår för betalningsdatum (SKV-regel: samma år)
  const paymentYears = new Set(
    arenden.map((x) => x.arende!.betalningsDatum.slice(0, 4)),
  );
  if (paymentYears.size > 1) {
    return json(400, {
      error: `SKV kräver att alla betalningsdatum är samma kalenderår. Hittade: ${Array.from(paymentYears).join(", ")}`,
    });
  }
  const submissionYear = parseInt(Array.from(paymentYears)[0], 10);

  const begaran: RutBegaran = {
    namnPaBegaran: batchName,
    arenden: arenden.map((x) => x.arende!),
  };

  const validationErrors = validateBegaran(begaran);
  if (validationErrors.length > 0) {
    return json(400, {
      error: "SKV-valideringsregler misslyckades",
      details: validationErrors,
    });
  }

  // ── 6. Generera XML ──────────────────────────────────────────
  const xml = buildRutXml(begaran);
  const xmlBytes = new TextEncoder().encode(xml);

  // SHA256-checksum
  const checksumBuf = await crypto.subtle.digest("SHA-256", xmlBytes);
  const checksumHex = Array.from(new Uint8Array(checksumBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // ── 7. Ladda upp till storage ────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const batchId = crypto.randomUUID();
  const fileName = `${submissionYear}/${today}-${batchName.replace(/[^A-Za-z0-9_-]/g, "_")}-${batchId.slice(0, 8)}.xml`;

  const { error: uploadErr } = await sb.storage
    .from(XML_STORAGE_BUCKET)
    .upload(fileName, xmlBytes, {
      contentType: "application/xml",
      upsert: false,
    });

  if (uploadErr) {
    log("error", "rut-batch-export-xml", "Storage upload failed", {
      error: uploadErr.message,
      bucket: XML_STORAGE_BUCKET,
    });
    return json(500, {
      error: "Kunde inte spara XML-fil i storage",
      hint: `Verifiera att bucket '${XML_STORAGE_BUCKET}' finns i Supabase Dashboard`,
      details: uploadErr.message,
    });
  }

  // ── 8. Skapa rut_batch_submissions-rad ───────────────────────
  const totalBegartBelopp = arenden.reduce((s, x) => s + x.arende!.begartBelopp, 0);
  const totalPrisforarbete = arenden.reduce((s, x) => s + x.arende!.prisForArbete, 0);

  const { data: batchRow, error: insertErr } = await sb
    .from("rut_batch_submissions")
    .insert({
      id: batchId,
      batch_name: batchName,
      submission_year: submissionYear,
      booking_ids: arenden.map((x) => x.bookingId),
      total_bookings: arenden.length,
      total_begart_belopp: totalBegartBelopp,
      total_prisforarbete: totalPrisforarbete,
      status: "exported",
      xml_file_path: fileName,
      xml_generated_at: new Date().toISOString(),
      xml_file_size_bytes: xmlBytes.length,
      xml_checksum: checksumHex,
      created_by: adminCleanerId,
    })
    .select()
    .single();

  if (insertErr) {
    log("error", "rut-batch-export-xml", "DB insert failed", { error: insertErr.message });
    // Cleanup: ta bort den just uppladdade filen
    await sb.storage.from(XML_STORAGE_BUCKET).remove([fileName]).catch(() => {});
    return json(500, { error: insertErr.message });
  }

  // ── 9. Uppdatera bookings.rut_application_status → 'pending' ─
  await sb
    .from("bookings")
    .update({ rut_application_status: "pending" })
    .in("id", arenden.map((x) => x.bookingId));

  // ── 10. Signed URL för nedladdning ───────────────────────────
  const { data: signedUrl } = await sb.storage
    .from(XML_STORAGE_BUCKET)
    .createSignedUrl(fileName, 3600);  // 1h giltig

  log("info", "rut-batch-export-xml", "Batch exported", {
    batch_id: batchId,
    bookings_count: arenden.length,
    total_begart: totalBegartBelopp,
    file: fileName,
    admin: adminEmail,
  });

  return json(200, {
    success: true,
    batch_id: batchId,
    file_name: fileName,
    file_size_bytes: xmlBytes.length,
    checksum_sha256: checksumHex,
    download_url: signedUrl?.signedUrl,
    total_bookings: arenden.length,
    total_begart_belopp: totalBegartBelopp,
    total_prisforarbete: totalPrisforarbete,
    submission_year: submissionYear,
    next_steps: [
      "1. Ladda ner XML-filen från download_url (giltig 1h)",
      "2. Logga in på https://www7.skatteverket.se/portal/rotrut/begar-utbetalning/fil",
      "3. Välj 'Importera fil' och ladda upp",
      "4. När SKV svarat — markera batchen som 'submitted' eller 'approved'/'rejected' i admin",
    ],
  });
});
