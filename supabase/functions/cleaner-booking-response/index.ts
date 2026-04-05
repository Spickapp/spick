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

    if (booking.status !== "pending_confirmation" && booking.status !== "bekräftad" && booking.status !== "pending") {
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
      await sb.from("bookings").update({
        status: "rejected_by_cleaner",
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || null,
        cleaner_id: null,
        cleaner_name: null,
      }).eq("id", booking_id);

      // Stripe refund
      let refundStatus = "skipped";
      const paymentIntentId = booking.payment_intent_id || booking.stripe_payment_intent_id;
      if (paymentIntentId && STRIPE_KEY) {
        try {
          const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(STRIPE_KEY + ":")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `payment_intent=${paymentIntentId}`,
          });
          if (refundRes.ok) {
            refundStatus = "initiated";
            log("info", "cleaner-booking-response", "Refund initiated", { paymentIntentId });
          } else {
            const errText = await refundRes.text();
            refundStatus = "failed";
            log("error", "cleaner-booking-response", "Refund failed", { paymentIntentId, error: errText });
          }
        } catch (e) {
          refundStatus = "error";
          log("error", "cleaner-booking-response", "Refund exception", { error: (e as Error).message });
        }
      }

      // Update payment status if refund was initiated
      if (refundStatus === "initiated") {
        await sb.from("bookings").update({ payment_status: "refunded" }).eq("id", booking_id);
      }

      // Email to customer
      if (customerEmail) {
        const html = wrap(`
          <h2>Uppdatering om din bokning</h2>
          <p>Hej ${esc(customerName)},</p>
          <p>Tyvärr kunde städaren inte ta detta uppdrag. Vi beklagar besväret.</p>
          ${paymentIntentId ? `<p><strong>Full återbetalning är på väg</strong> — du ser pengarna på ditt konto inom 3–5 bankdagar.</p>` : ""}
          <p>Du är välkommen att boka en annan städare på <a href="https://spick.se/boka.html" class="btn">spick.se/boka</a>.</p>
          <p>Frågor? Kontakta oss på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a>.</p>
        `);
        await sendEmail(customerEmail, "Uppdatering om din bokning hos Spick", html);
      }

      // Email to admin
      await sendEmail(ADMIN, `⚠️ Bokning avböjd av ${cleaner.full_name}`, wrap(`
        <h2>⚠️ Bokning avböjd</h2>
        <p><strong>${esc(cleaner.full_name)}</strong> har avböjt bokning <code>${esc(booking_id.slice(0, 8))}</code>.</p>
        ${card([
          ["Kund", `${esc(customerName)} (${esc(customerEmail)})`],
          ["Datum", formatDate(bookingDate)],
          ["Anledning", esc(reason || "Ingen angiven")],
          ["Återbetalning", refundStatus],
        ])}
      `));

      log("info", "cleaner-booking-response", "Booking rejected", { booking_id, cleaner_id: cleaner.id, refundStatus });
      return json({ success: true, message: "Bokning avböjd. Kunden har fått mejl och återbetalning.", refund: refundStatus }, 200, CORS);
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
