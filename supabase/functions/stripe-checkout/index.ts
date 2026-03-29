import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const BASE_URL = "https://spick.se";
const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// CORS: begränsa till spick.se
const ALLOWED_ORIGINS = [BASE_URL, "https://www.spick.se", "http://localhost:3000"];
function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : BASE_URL;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  };
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── RATE LIMITING: max 5 checkout attempts per IP per minute ──────
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { data: allowed } = await sb.rpc("check_rate_limit", {
      p_key: `checkout:${clientIP}`,
      p_max_requests: 5,
      p_window_seconds: 60,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "För många förfrågningar. Vänta en minut." }), {
        status: 429, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (!STRIPE_SECRET_KEY) {
      console.error("STRIPE_SECRET_KEY saknas – sätt den i Supabase Secrets");
      return new Response(JSON.stringify({ error: "Betalning ej konfigurerad – kontakta hello@spick.se" }), {
        status: 503, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    const {
      booking_id, amount, name, email, service, date, hours,
      rut, sqm, address, phone, cleaner_id, cleaner_name,
      frequency, key_info, customer_notes, referral_code
    } = await req.json();

    if (!booking_id || !email || !service) {
      return new Response(JSON.stringify({ error: "Saknade fält: booking_id, email, service krävs" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // ── VERIFY BOOKING EXISTS AND IS PENDING ──────
    // Förhindra att random UUIDs skapar Stripe sessions
    const { data: existingBooking, error: bookingErr } = await sb
      .from("bookings")
      .select("id, payment_status, email, status")
      .eq("id", booking_id)
      .single();

    if (bookingErr || !existingBooking) {
      return new Response(JSON.stringify({ error: "Bokning hittades inte" }), {
        status: 404, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (existingBooking.payment_status !== "pending") {
      return new Response(JSON.stringify({ error: "Bokning redan behandlad" }), {
        status: 409, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // ── SERVER-SIDE PRISBERÄKNING (klient-amount ignoreras) ──────
    const PRICE_PER_HOUR: Record<string, number> = {
      "Hemstädning": 349,
      "Storstädning": 449,
      "Flyttstädning": 499,
      "Fönsterputs": 399,
      "Kontorsstädning": 399,
    };
    const basePrice = PRICE_PER_HOUR[service] || 349;
    const validHours = Math.max(2, Math.min(12, Number(hours) || 3));
    const grossAmount = basePrice * validHours;
    const finalAmount = rut ? Math.round(grossAmount * 0.5) : grossAmount;
    
    // Sanity check: vägra orimliga belopp
    if (finalAmount < 300 || finalAmount > 30000) {
      return new Response(JSON.stringify({ error: "Ogiltigt belopp" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS }
      });
    }
    
    const amountOre = finalAmount * 100;

    const params = new URLSearchParams();
    params.append("mode", "payment");
    // Betalning auktoriseras direkt vid checkout
    // Klarna kräver automatic capture (manual stöds ej)
    params.append("currency", "sek");
    params.append("customer_email", email);
    params.append("success_url",
      `${BASE_URL}/tack.html?session_id={CHECKOUT_SESSION_ID}&bid=${booking_id}&service=${encodeURIComponent(service || "Städning")}&date=${encodeURIComponent(date || "")}`
    );
    params.append("cancel_url", `${BASE_URL}/boka.html?cancelled=1`);

    // Metadata för webhook
    params.append("metadata[booking_id]", booking_id);
    if (cleaner_id)   params.append("metadata[cleaner_id]",   cleaner_id);
    if (cleaner_name) params.append("metadata[cleaner_name]", cleaner_name.slice(0, 100));
    if (sqm)          params.append("metadata[sqm]",          sqm.toString());
    if (address)      params.append("metadata[address]",      address.slice(0, 200));
    if (phone)        params.append("metadata[phone]",        phone);
    params.append("metadata[rut]", rut ? "true" : "false");
    if (frequency)       params.append("metadata[frequency]",       frequency);
    if (key_info)        params.append("metadata[key_info]",        key_info.slice(0, 200));
    if (customer_notes)  params.append("metadata[customer_notes]",  customer_notes.slice(0, 300));
    if (referral_code)   params.append("metadata[referral_code]",   referral_code.slice(0, 20));

    // Betalmetoder: kort + Klarna (inget separat avtal krävs i Sverige)
    params.append("payment_method_types[]", "card");
    params.append("payment_method_types[]", "klarna");
    // params.append("payment_method_types[]", "swish"); // Aktivera när certifikat är klart

    // Produktrad
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "sek");
    params.append("line_items[0][price_data][unit_amount]", String(amountOre));
    params.append("line_items[0][price_data][product_data][name]",
      `${service || "Hemstädning"} – ${hours || 3} timmar`);
    params.append("line_items[0][price_data][product_data][description]",
      rut
        ? `Pris inkl. 50% RUT-avdrag. Städdatum: ${date}. Städare: ${cleaner_name || "Tilldelas"}`
        : `Städdatum: ${date}. Städare: ${cleaner_name || "Tilldelas"}`
    );
    params.append("line_items[0][price_data][product_data][images][]",
      "https://spick.se/assets/og-image.jpg");

    params.append("allow_promotion_codes", "true");
    params.append("payment_intent_data[statement_descriptor]", "SPICK STADNING");
    // Klarna kräver telefonnummer
    if (phone) params.append("payment_method_options[klarna][setup_future_usage]", "none");
    params.append("billing_address_collection", "auto");

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2023-10-16",
        "Idempotency-Key": `checkout-${booking_id}`,
      },
      body: params.toString(),
    });

    const session = await res.json();

    if (!res.ok) {
      console.error("Stripe API-fel:", JSON.stringify(session));
      return new Response(JSON.stringify({
        error: session.error?.message || "Stripe-fel",
        code:  session.error?.code
      }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      headers: { "Content-Type": "application/json", ...CORS }
    });

  } catch (e) {
    console.error("stripe-checkout exception:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS }
    });
  }
});
