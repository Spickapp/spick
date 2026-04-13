import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const BASE_URL = "https://spick.se";
const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);


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
      frequency, key_info, customer_notes, referral_code,
      customer_type, business_name
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
      .select("id, payment_status, customer_email, status")
      .eq("id", booking_id)
      .single();

    if (bookingErr || !existingBooking) {
      console.error("Booking lookup failed:", JSON.stringify({ booking_id, bookingErr }));
      return new Response(JSON.stringify({ error: "Bokning hittades inte", debug: bookingErr?.message }), {
        status: 404, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (existingBooking.payment_status !== "pending") {
      return new Response(JSON.stringify({ error: "Bokning redan behandlad" }), {
        status: 409, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // ── STRIPE CONNECT: Hämta mottagarens konto ──────────────────
    let destinationAccountId: string | null = null;
    let commissionRate = 0.17; // Default 17% privat
    // deno-lint-ignore no-explicit-any
    let cleanerData: any = null;

    if (cleaner_id) {
      const { data } = await sb
        .from("cleaners")
        .select("stripe_account_id, stripe_onboarding_status, company_id, is_company_owner, hourly_rate")
        .eq("id", cleaner_id)
        .single();
      cleanerData = data;

      if (cleanerData) {
        commissionRate = customer_type === "foretag" ? 0.12 : 0.17;

        if (cleanerData.company_id) {
          // Städare tillhör företag → pengar till företagsägaren
          const { data: owner } = await sb
            .from("cleaners")
            .select("stripe_account_id, stripe_onboarding_status")
            .eq("company_id", cleanerData.company_id)
            .eq("is_company_owner", true)
            .single();

          if (owner?.stripe_account_id && owner.stripe_onboarding_status === "complete") {
            destinationAccountId = owner.stripe_account_id;
          }
        } else {
          // Solo-städare → pengar direkt
          if (cleanerData.stripe_account_id && cleanerData.stripe_onboarding_status === "complete") {
            destinationAccountId = cleanerData.stripe_account_id;
          }
        }
      }
    }
    console.log("[SPICK] Stripe Connect:", { cleaner_id, destinationAccountId, commissionRate });

    // ── SERVER-SIDE PRISBERÄKNING med dynamiska priser ───────────
    const validHours = Math.max(2, Math.min(12, Number(hours) || 3));
    const primaryService = service.split(" + ")[0].trim();
    let basePrice = 349; // fallback

    if (cleanerData) {
      let resolved = false;

      if (cleanerData.company_id) {
        const { data: company } = await sb
          .from("companies")
          .select("use_company_pricing")
          .eq("id", cleanerData.company_id)
          .single();

        if (company?.use_company_pricing === true) {
          // Lager 1: Företagspris
          const { data: compPrice } = await sb
            .from("company_service_prices")
            .select("price")
            .eq("company_id", cleanerData.company_id)
            .eq("service_type", primaryService)
            .single();
          if (compPrice?.price) { basePrice = compPrice.price; resolved = true; }
        }
      }

      if (!resolved) {
        // Lager 2: Individpris
        const { data: svcPrice } = await sb
          .from("cleaner_service_prices")
          .select("price")
          .eq("cleaner_id", cleaner_id)
          .eq("service_type", primaryService)
          .single();

        if (svcPrice?.price) {
          basePrice = svcPrice.price;
        } else if (cleanerData.company_id) {
          // Fallback: företagspris
          const { data: compPrice } = await sb
            .from("company_service_prices")
            .select("price")
            .eq("company_id", cleanerData.company_id)
            .eq("service_type", primaryService)
            .single();
          if (compPrice?.price) basePrice = compPrice.price;
        } else if (cleanerData.hourly_rate) {
          basePrice = cleanerData.hourly_rate;
        }
      }
    }
    console.log("[SPICK] Price:", { primaryService, basePrice, hours: validHours });

    const grossAmount = basePrice * validHours;
    const finalAmount = rut ? Math.floor(grossAmount * 0.5) : grossAmount;
    
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
    params.append("metadata[customer_type]", customer_type || "privat");
    if (business_name)   params.append("metadata[business_name]",   business_name.slice(0, 100));

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
      "https://spick.se/assets/og-image.png");

    params.append("allow_promotion_codes", "true");
    params.append("payment_intent_data[statement_descriptor]", "SPICK STADNING");
    // Klarna kräver telefonnummer
    if (phone) params.append("payment_method_options[klarna][setup_future_usage]", "none");
    params.append("billing_address_collection", "auto");

    // ── STRIPE CONNECT: Destination charge ──────────────────────
    if (destinationAccountId) {
      const applicationFee = Math.round(amountOre * commissionRate);
      params.append("payment_intent_data[transfer_data][destination]", destinationAccountId);
      params.append("payment_intent_data[application_fee_amount]", String(applicationFee));
      console.log("[SPICK] Destination charge:", {
        destination: destinationAccountId,
        applicationFee: applicationFee / 100 + " SEK",
        cleanerGets: (amountOre - applicationFee) / 100 + " SEK",
      });
    } else {
      console.log("[SPICK] No connected account — funds stay on platform");
    }

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

    // ── Logga provision i commission_log ────────────────────────
    if (destinationAccountId && session.id) {
      try {
        const commissionSek = Math.round(finalAmount * commissionRate);
        const netSek = finalAmount - commissionSek;
        await sb.from("commission_log").insert({
          booking_id,
          cleaner_id,
          gross_amount: finalAmount,
          commission_pct: commissionRate * 100,
          commission_amt: commissionSek,
          net_amount: netSek,
          level_name: customer_type === "foretag" ? "Företag 12%" : "Standard 17%",
        });
      } catch (e) { console.warn("Commission log error:", e); }
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
