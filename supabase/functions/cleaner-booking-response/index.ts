import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, card, log, ADMIN } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── AUTH: verify logged-in user ─────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return json({ error: "Unauthorized" }, 401, CORS);
    }

    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
    });
    if (!authRes.ok) return json({ error: "Invalid token" }, 401, CORS);
    const authUser = await authRes.json();

    // Find cleaner by auth_user_id
    const { data: cleaner, error: clErr } = await sb
      .from("cleaners")
      .select("id, full_name, email, company_id, is_company_owner")
      .eq("auth_user_id", authUser.id)
      .eq("is_approved", true)
      .maybeSingle();

    if (clErr || !cleaner) return json({ error: "Städarprofil hittades inte" }, 403, CORS);

    // ── PARSE BODY ──────────────────────────────────────────
    const { booking_id, action, reason } = await req.json();
    if (!booking_id || !["accept", "reject"].includes(action)) {
      return json({ error: "booking_id + action (accept|reject) krävs" }, 400, CORS);
    }

    // ── FETCH BOOKING ───────────────────────────────────────
    const { data: booking, error: bkErr } = await sb
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .maybeSingle();

    if (bkErr || !booking) return json({ error: "Bokning hittades inte" }, 404, CORS);

    // Verify this cleaner owns this booking (or is company owner of the assigned cleaner)
    let isAuthorized = booking.cleaner_id === cleaner.id;
    if (!isAuthorized && cleaner.is_company_owner && cleaner.company_id) {
      // Check if the assigned cleaner belongs to the same company
      const { data: assignedCleaner } = await sb
        .from("cleaners")
        .select("company_id")
        .eq("id", booking.cleaner_id)
        .maybeSingle();
      if (assignedCleaner?.company_id === cleaner.company_id) {
        isAuthorized = true;
      }
    }
    if (!isAuthorized) {
      return json({ error: "Du har inte tillgång till denna bokning" }, 403, CORS);
    }

    if (booking.status !== "pending_confirmation" && booking.status !== "bekräftad" && booking.status !== "pending" && booking.status !== "awaiting_reassignment") {
      return json({ error: `Bokning har redan status: ${booking.status}` }, 409, CORS);
    }

    const customerEmail = booking.customer_email;
    const customerName = booking.customer_name || "Kund";
    const bookingDate = booking.booking_date || booking.scheduled_date || "";
    const bookingTime = booking.booking_time || "";
    const serviceType = booking.service_type || "Städning";
    const bookingHours = booking.booking_hours || booking.hours || 3;

    // ════════════════════════════════════════════════════════
    // ACCEPT
    // ════════════════════════════════════════════════════════
    if (action === "accept") {
      await sb.from("bookings").update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        cleaner_email: cleaner.email || null,
        cleaner_phone: cleaner.phone || null,
      }).eq("id", booking_id);

      // Email to customer
      if (customerEmail) {
        const html = wrap(`
          <h2>Din städning är bekräftad! ✅</h2>
          <p>Hej ${esc(customerName)},</p>
          <p><strong>${esc(cleaner.full_name)}</strong> har bekräftat din städning!</p>
          ${card([
            ["Datum", formatDate(bookingDate)],
            ["Tid", bookingTime || "Se bekräftelse"],
            ["Tjänst", `${esc(serviceType)}, ${bookingHours}h`],
            ["Städare", esc(cleaner.full_name)],
          ])}
          <p>Vi ses! Om du behöver ändra eller avboka, kontakta oss på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> minst 24h innan.</p>
        `);
        await sendEmail(customerEmail, "Din städning är bekräftad! ✅", html);
      }

      // Email to admin
      await sendEmail(ADMIN, `Bokning bekräftad av ${cleaner.full_name}`, wrap(`
        <h2>Bokning bekräftad</h2>
        <p><strong>${esc(cleaner.full_name)}</strong> har accepterat bokning <code>${esc(booking_id.slice(0, 8))}</code>.</p>
        ${card([
          ["Kund", esc(customerName)],
          ["Datum", formatDate(bookingDate)],
          ["Tjänst", `${esc(serviceType)}, ${bookingHours}h`],
        ])}
      `));

      log("info", "cleaner-booking-response", "Booking accepted", { booking_id, cleaner_id: cleaner.id });
      return json({ success: true, message: "Bokning bekräftad! Kunden har fått mejl." }, 200, CORS);
    }

    // ════════════════════════════════════════════════════════
    // REJECT
    // ════════════════════════════════════════════════════════
    if (action === "reject") {
      // ── Set awaiting_reassignment — give customer 24h to pick new cleaner ──
      await sb.from("bookings").update({
        status: "awaiting_reassignment",
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || null,
        admin_notes: `rejected_by:${cleaner.id}`,
        cleaner_id: null,
        cleaner_name: null,
      }).eq("id", booking_id);

      // ── NO immediate refund — customer gets 24h to rebook ──
      // Auto-refund handled by auto-remind after 24h if still awaiting_reassignment

      const rebookUrl = `https://spick.se/min-bokning.html?bid=${booking_id}`;
      const refundUrl = `https://spick.se/min-bokning.html?bid=${booking_id}&action=refund`;

      // Email to customer — choose new cleaner or get refund
      if (customerEmail) {
        const html = wrap(`
          <h2>Din städare kunde tyvärr inte ta uppdraget</h2>
          <p>Hej ${esc(customerName)},</p>
          <p>Tyvärr kunde <strong>${esc(cleaner.full_name)}</strong> inte ta din ${esc(serviceType).toLowerCase()} den ${formatDate(bookingDate)}. Vi beklagar!</p>
          <p><strong>Du har två alternativ:</strong></p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
            <tr>
              <td style="padding:8px">
                <a href="${rebookUrl}" style="display:block;background:#0F6E56;color:#fff;padding:16px 24px;border-radius:12px;text-decoration:none;text-align:center;font-weight:700;font-size:16px">Välj en ny städare →</a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px">
                <a href="${refundUrl}" style="display:block;background:#fff;color:#DC2626;padding:14px 24px;border-radius:12px;text-decoration:none;text-align:center;font-weight:600;font-size:14px;border:1.5px solid #FECACA">Jag vill ha återbetalning</a>
              </td>
            </tr>
          </table>
          <p style="font-size:13px;color:#6B6960">Om du inte agerar inom 24 timmar återbetalas du automatiskt.</p>
          <p>Frågor? Kontakta oss på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a>.</p>
        `);
        await sendEmail(customerEmail, `Din städare kunde inte ta uppdraget — välj ny`, html);
      }

      // Email to admin
      await sendEmail(ADMIN, `⚠️ Bokning avböjd av ${cleaner.full_name}`, wrap(`
        <h2>⚠️ Bokning avböjd — väntar på kundens val</h2>
        <p><strong>${esc(cleaner.full_name)}</strong> har avböjt bokning <code>${esc(booking_id.slice(0, 8))}</code>.</p>
        ${card([
          ["Kund", `${esc(customerName)} (${esc(customerEmail)})`],
          ["Datum", formatDate(bookingDate)],
          ["Anledning", esc(reason || "Ingen angiven")],
          ["Status", "Väntar på kundens val (24h)"],
        ])}
        <p>Kunden har fått mejl med alternativ att välja ny städare eller begära återbetalning. Auto-refund efter 24h.</p>
      `));

      log("info", "cleaner-booking-response", "Booking rejected — awaiting reassignment", { booking_id, cleaner_id: cleaner.id });
      return json({ success: true, message: "Bokning avböjd. Kunden har fått mejl med alternativ." }, 200, CORS);
    }

    return json({ error: "Ogiltig action" }, 400, CORS);
  } catch (err) {
    log("error", "cleaner-booking-response", "Unhandled error", { error: (err as Error).message });
    return json({ error: (err as Error).message }, 500, CORS);
  }
});

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "–";
  try {
    return new Date(dateStr).toLocaleDateString("sv-SE", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  } catch {
    return dateStr;
  }
}
