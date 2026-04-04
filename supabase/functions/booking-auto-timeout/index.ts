import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, log, ADMIN } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const TIMEOUT_HOURS = 2;

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── AUTH: verify admin ──────────────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return json({ error: "Unauthorized" }, 401, CORS);
    }

    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
    });
    if (!authRes.ok) return json({ error: "Invalid token" }, 401, CORS);
    const authUser = await authRes.json();

    const { data: adminRow } = await sb
      .from("admin_users")
      .select("id")
      .eq("email", authUser.email)
      .maybeSingle();
    if (!adminRow) return json({ error: "Forbidden: inte admin" }, 403, CORS);

    // ── FIND TIMED-OUT BOOKINGS ─────────────────────────────
    const cutoff = new Date(Date.now() - TIMEOUT_HOURS * 60 * 60 * 1000).toISOString();

    const { data: stale, error: queryErr } = await sb
      .from("bookings")
      .select("id, customer_email, customer_name, service_type, booking_date, booking_time, payment_intent_id, total_price, cleaner_name")
      .eq("status", "pending_confirmation")
      .lt("created_at", cutoff);

    if (queryErr) {
      log("error", "booking-auto-timeout", "Query failed", { error: queryErr.message });
      return json({ error: queryErr.message }, 500, CORS);
    }

    if (!stale || stale.length === 0) {
      return json({ success: true, message: "Inga bokningar att timeout:a", count: 0 }, 200, CORS);
    }

    const results: Array<{ id: string; refund: string; email: boolean }> = [];

    for (const booking of stale) {
      // 1. Update status
      await sb.from("bookings").update({
        status: "timed_out",
        rejected_at: new Date().toISOString(),
        rejection_reason: `Auto-timeout efter ${TIMEOUT_HOURS}h utan svar`,
      }).eq("id", booking.id);

      // 2. Stripe refund
      let refundStatus = "skipped";
      if (booking.payment_intent_id && STRIPE_KEY) {
        try {
          const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(STRIPE_KEY + ":")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `payment_intent=${booking.payment_intent_id}`,
          });
          refundStatus = refundRes.ok ? "initiated" : "failed";
          if (!refundRes.ok) {
            log("error", "booking-auto-timeout", "Refund failed", {
              bookingId: booking.id,
              error: await refundRes.text(),
            });
          }
        } catch (e) {
          refundStatus = "error";
          log("error", "booking-auto-timeout", "Refund exception", { error: (e as Error).message });
        }
      }

      if (refundStatus === "initiated") {
        await sb.from("bookings").update({ payment_status: "refunded" }).eq("id", booking.id);
      }

      // 3. Email customer
      let emailSent = false;
      if (booking.customer_email) {
        const html = wrap(`
          <h2>Din bokning har avbokats</h2>
          <p>Hej ${esc(booking.customer_name || "")},</p>
          <p>Tyvärr hann ingen städare bekräfta din bokning inom 2 timmar, så den har avbokats automatiskt.</p>
          ${booking.payment_intent_id ? `<p><strong>Full återbetalning är på väg</strong> — du ser pengarna på ditt konto inom 3–5 bankdagar.</p>` : ""}
          <p>Du är välkommen att boka en annan städare på <a href="https://spick.se/boka.html" class="btn">spick.se/boka</a>.</p>
          <p>Ursäkta besväret! Kontakta oss på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> om du har frågor.</p>
        `);
        const res = await sendEmail(booking.customer_email, "Din bokning har avbokats — full återbetalning", html);
        emailSent = res.ok;
      }

      results.push({ id: booking.id, refund: refundStatus, email: emailSent });
      log("info", "booking-auto-timeout", "Booking timed out", {
        bookingId: booking.id,
        refundStatus,
        emailSent,
      });
    }

    // 4. Summary email to admin
    const summary = results.map((r) =>
      `• ${r.id.slice(0, 8)} — refund: ${r.refund}, mejl: ${r.email ? "✅" : "❌"}`
    ).join("\n");

    await sendEmail(ADMIN, `⏰ ${results.length} bokningar timeout:ade`, wrap(`
      <h2>⏰ Booking auto-timeout</h2>
      <p>${results.length} bokning(ar) hade väntat mer än ${TIMEOUT_HOURS}h utan svar och har avbokats.</p>
      <pre style="background:#F7F7F5;padding:12px;border-radius:8px;font-size:13px;white-space:pre-wrap">${esc(summary)}</pre>
    `));

    return json({
      success: true,
      message: `${results.length} bokning(ar) timeout:ade`,
      count: results.length,
      results,
    }, 200, CORS);
  } catch (err) {
    log("error", "booking-auto-timeout", "Unhandled error", { error: (err as Error).message });
    return json({ error: (err as Error).message }, 500, CORS);
  }
});

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
