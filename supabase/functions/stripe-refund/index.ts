import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const sb = createClient(
  "https://urjeijcncsyuletprydy.supabase.co",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── AUTH GUARD: kräver giltig admin-session ──────────────────
  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
    const authRes = await fetch(
      "https://urjeijcncsyuletprydy.supabase.co/auth/v1/user",
      { headers: { "Authorization": `Bearer ${token}`, "apikey": Deno.env.get("SUPABASE_ANON_KEY")! } }
    );
    if (!authRes.ok) throw new Error("Invalid token");
    const authUser = await authRes.json();

    const { data: adminRow } = await sb
      .from("admin_users")
      .select("id")
      .eq("email", authUser.email)
      .maybeSingle();
    if (!adminRow) {
      return new Response(JSON.stringify({ error: "Forbidden: inte en admin" }), {
        status: 403, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
  } catch (authErr) {
    return new Response(JSON.stringify({ error: "Auth check failed" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
  // ── SLUT AUTH GUARD ──────────────────────────────────────────

  try {
    const { booking_id, reason } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id krävs" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const { data: booking, error: bErr } = await sb.from("bookings")
      .select("id, payment_intent_id, total_price, payment_status")
      .eq("id", booking_id).single();

    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: "Bokning hittades inte" }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
    if (booking.payment_status !== "paid") {
      return new Response(JSON.stringify({ error: "Kan bara återbetala betalda bokningar" }), {
        status: 409, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
    if (!booking.payment_intent_id) {
      return new Response(JSON.stringify({ error: "Ingen Stripe-referens" }), {
        status: 422, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const res = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `payment_intent=${booking.payment_intent_id}&reason=requested_by_customer`,
    });

    const refund = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: refund.error?.message || "Stripe-fel" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    await sb.from("bookings").update({
      payment_status: "refunded",
      refund_amount: booking.total_price,
      cancellation_reason: reason || "Admin refund",
      cancelled_at: new Date().toISOString(),
    }).eq("id", booking_id);

    return new Response(JSON.stringify({ ok: true, refund_id: refund.id }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
