import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const BASE_URL = "https://spick.se";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { booking_id, amount, name, email, service, date, hours, rut } = await req.json();

    if (!booking_id || !amount || !email) {
      return new Response(JSON.stringify({ error: "Saknade fält" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // Stripe vill ha öre (100 = 1 kr)
    const amountOre = Math.round(amount * 100);

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("currency", "sek");
    params.append("customer_email", email);
    params.append("success_url", `${BASE_URL}/tack.html?session_id={CHECKOUT_SESSION_ID}&bid=${booking_id}&service=${encodeURIComponent(service || "Städning")}&date=${encodeURIComponent(date || "")}`);
    params.append("cancel_url", `${BASE_URL}/boka.html?cancelled=1`);
    params.append("metadata[booking_id]", booking_id);
    params.append("metadata[rut]", rut ? "true" : "false");

    // Betalmetoder: Klarna + kortbetalning
    params.append("payment_method_types[]", "card");
    params.append("payment_method_types[]", "klarna");

    // Produktrad
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "sek");
    params.append("line_items[0][price_data][unit_amount]", String(amountOre));
    params.append("line_items[0][price_data][product_data][name]",
      `${service || "Hemstädning"} – ${hours || 3} timmar`);
    params.append("line_items[0][price_data][product_data][description]",
      rut ? `Pris inkl. 50% RUT-avdrag. Städdatum: ${date}` : `Städdatum: ${date}`);
    params.append("line_items[0][price_data][product_data][images][]",
      "https://spick.se/assets/og-image.jpg");

    // Faktura (PDF) skickas automatiskt via Stripe
    params.append("invoice_creation[enabled]", "true");

    // Tillåt rabattkoder (win-back: VÄLKOMMEN10)
    params.append("allow_promotion_codes", "true");

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await res.json();

    if (!res.ok) {
      console.error("Stripe error:", session);
      return new Response(JSON.stringify({ error: session.error?.message || "Stripe-fel" }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      headers: { "Content-Type": "application/json", ...CORS }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS }
    });
  }
});
