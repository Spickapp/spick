// supabase/functions/booking-create/index.ts
// =============================================================
// SPICK: Smart Instant Book â Unified booking + Stripe Checkout
// Replaces: client-side DB insert + stripe-checkout Edge Function
// Flow: Validate â Price â Proximity â Insert booking â Create
//       Stripe Checkout Session â Return URL
// After payment: stripe-webhook sets status to 'confirmed'
// =============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const BASE_URL = "https://spick.se";

const ALLOWED_ORIGINS = [BASE_URL, "https://www.spick.se", "http://localhost:3000"];
function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : BASE_URL,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function getOptOutMinutes(tier: string): number {
  switch (tier) { case "elite": return 0; case "established": return 60; default: return 120; }
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    if (!STRIPE_SECRET_KEY) return json(503, { error: "Betalning ej konfigurerad" }, CORS);

    const body = await req.json();
    const { name, email, phone, address, service, date, time, hours, sqm,
      cleaner_id, cleaner_name, rut = false, frequency, key_info, customer_notes,
      customer_lat, customer_lng, customer_pnr_hash } = body;

    if (!email || !service || !cleaner_id || !date || !time)
      return json(400, { error: "Saknade fÃ¤lt: email, service, cleaner_id, date, time krÃ¤vs" }, CORS);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: cleaner, error: clErr } = await supabase.from("cleaners")
      .select("id,user_id,full_name,email,hourly_rate,city,latitude,longitude,lat,lng,service_radius_km,tier,active")
      .eq("id", cleaner_id).single();

    if (clErr || !cleaner) return json(404, { error: "StÃ¤daren hittades inte" }, CORS);

    let distanceKm: number|null = null, travelSurcharge = 0;
    if (customer_lat && customer_lng && (cleaner.latitude || cleaner.lat) && (cleaner.longitude || cleaner.lng)) {
      const cLat = cleaner.latitude || cleaner.lat, cLng = cleaner.longitude || cleaner.lng;
      distanceKm = Math.round(haversineKm(customer_lat, customer_lng, cLat, cLng) * 10) / 10;
      const radius = cleaner.service_radius_km || 15;
      if (distanceKm > radius) return json(400, { error: `FÃ¶r lÃ¥ngt bort (${distanceKm} km, max ${radius} km)` }, CORS);
      if (distanceKm > 10) travelSurcharge = Math.round((distanceKm - 10) * 15);
    }

    const rate = cleaner.hourly_rate || 349;
    const validHours = Math.max(2, Math.min(12, Number(hours) || 3));
    const grossPrice = rate * validHours;
    const rutAmount = rut ? Math.round(grossPrice * 0.5) : 0;
    const netPrice = grossPrice - rutAmount + travelSurcharge;
    const commissionRate = 0.17;
    const cleanerPayout = Math.round(grossPrice * (1 - commissionRate)) + travelSurcharge;
    if (netPrice < 300 || netPrice > 30000) return json(400, { error: "Ogiltigt belopp" }, CORS);

    const bookingId = crypto.randomUUID();
    const optOutMinutes = getOptOutMinutes(cleaner.tier || "new");

    const { error: insErr } = await supabase.from("bookings").insert({
      id: bookingId, cleaner_id, status: "pending", payment_status: "pending",
      name, email, phone, address: address || "", city: cleaner.city || "",
      service, date, time, hours: validHours, total_price: netPrice, rut: !!rut,
      cleaner_name: cleaner.full_name || cleaner_name || "", sqm: sqm || null,
      service_type: service, customer_notes, key_info, frequency: frequency || "once",
      distance_km: distanceKm, travel_surcharge: travelSurcharge * 100,
      gross_price: grossPrice * 100, rut_amount: rutAmount * 100,
      net_price: netPrice * 100, commission_rate: commissionRate,
      cleaner_payout: cleanerPayout * 100, opt_out_minutes: optOutMinutes,
    });
    if (insErr) { console.error("Insert failed:", insErr); return json(500, { error: "Kunde inte skapa bokning" }, CORS); }

    try { await supabase.rpc("log_booking_event", {p_booking_id:bookingId,p_event_type:"booking_created",p_actor_type:"customer",p_metadata:{distance_km:distanceKm,opt_out_minutes:optOutMinutes}}); } catch(_){}

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("currency", "sek");
    params.append("customer_email", email);
    params.append("success_url", `${BASE_URL}/tack.html?session_id={CHECKOUT_SESSION_ID}&bid=${bookingId}&service=${encodeURIComponent(service)}&date=${encodeURIComponent(date)}`);
    params.append("cancel_url", `${BASE_URL}/boka.html?cancelled=1`);
    params.append("metadata[booking_id]", bookingId);
    params.append("metadata[booking_type]", "instant");
    params.append("metadata[cleaner_id]", cleaner_id);
    params.append("metadata[cleaner_name]", (cleaner.full_name || "").slice(0, 100));
    params.append("metadata[opt_out_minutes]", String(optOutMinutes));
    if (address) params.append("metadata[address]", address.slice(0,200));
    if (phone) params.append("metadata[phone]", phone);
    params.append("metadata[rut]", rut ? "true" : "false");
    if (distanceKm) params.append("metadata[distance_km]", String(distanceKm));
    params.append("payment_method_types[]", "card");
    params.append("payment_method_types[]", "klarna");
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "sek");
    params.append("line_items[0][price_data][unit_amount]", String(netPrice * 100));
    params.append("line_items[0][price_data][product_data][name]", `${service} â ${validHours} timmar`);
    params.append("line_items[0][price_data][product_data][description]", `StÃ¤ddatum: ${date}. StÃ¤dare: ${cleaner.full_name || "Tilldelas"}`);
    params.append("allow_promotion_codes", "true");
    params.append("payment_intent_data[statement_descriptor]", "SPICK STADNING");

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2023-10-16" },
      body: params.toString(),
    });
    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      await supabase.from("bookings").delete().eq("id", bookingId);
      return json(500, { error: session.error?.message || "Stripe-fel" }, CORS);
    }

    await supabase.from("bookings").update({ stripe_session_id: session.id, stripe_payment_intent_id: session.payment_intent }).eq("id", bookingId);

    return new Response(JSON.stringify({ url: session.url, session_id: session.id, booking_id: bookingId, net_price: netPrice, distance_km: distanceKm, travel_surcharge: travelSurcharge }), { headers: { "Content-Type": "application/json", ...CORS } });

  } catch (e) {
    console.error("booking-create error:", e);
    return json(500, { error: (e as Error).message }, corsHeaders(req));
  }
});

function json(status: number, body: any, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
