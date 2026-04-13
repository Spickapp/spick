// supabase/functions/booking-create/index.ts
// =============================================================
// SPICK: Booking Create — med inbyggd prismotor + marginalcheck
//
// Flöde:
//   1. Validera input
//   2. Lös rabattkod (om angiven)
//   3. Hämta kredit (om finns)
//   4. Beräkna pris via pricing-engine (source of truth)
//   5. MARGINALCHECK — blockera om under 8 %
//   6. Hämta/matcha städare
//   7. Kontrollera tillgänglighet
//   8. Skapa bokning i DB (med alla prisfält)
//   9. Skapa Stripe Checkout-session
//   10. Logga event + returnera URL
//
// Klienten skickar:
//   { name, email, phone, address, date, time, hours, service,
//     cleaner_id?, discount_code?, rut?, frequency?, ... }
//
// Servern returnerar:
//   { url, booking_id, customer_price, cleaner_name }
// =============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  loadSettings,
  resolveDiscount,
  getAvailableCredit,
  calculateBooking,
} from "../_shared/pricing-engine.ts";
import { corsHeaders, encryptPnr } from "../_shared/email.ts";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY      = Deno.env.get("STRIPE_SECRET_KEY")!;
const BASE_URL        = Deno.env.get("BASE_URL") || "https://spick.se";

serve(async (req) => {
  const CORS = corsHeaders(req);

  function json(status: number, body: any) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── 1. PARSE + VALIDATE INPUT ──────────────────
    const body = await req.json();
    const {
      name,
      email,
      phone,
      address,
      date,
      time,
      hours,
      service,
      cleaner_id,
      cleaner_name,
      discount_code,
      rut,
      frequency,
      sqm,
      customer_notes,
      key_info,
      key_type,
      customer_lat,
      customer_lng,
      customer_pnr_hash,
      customer_pnr,
      customer_type,
      business_name,
      business_org_number,
      business_reference,
    } = body;

    // Required fields
    if (!name || !email || !date || !time || !hours || !service) {
      return json(400, { error: "Obligatoriska fält saknas: name, email, date, time, hours, service" });
    }

    const validHours = Math.max(2, Math.min(12, Number(hours) || 3));

    // ── 2. HÄMTA STÄDARE ───────────────────────────
    let cleaner: any = null;

    if (cleaner_id) {
      const { data, error } = await supabase
        .from("cleaners")
        .select("id, full_name, avg_rating, completed_jobs, home_lat, home_lng, phone, hourly_rate")
        .eq("id", cleaner_id)
        .eq("is_approved", true)
        .eq("is_active", true)
        .single();

      if (error || !data) {
        return json(400, { error: "Städaren finns inte eller är inaktiv" });
      }
      cleaner = data;
    } else {
      // Ingen specifik städare vald — matcha enklast möjliga:
      // Alla aktiva städare, sorterade på rating
      const { data } = await supabase
        .from("cleaners")
        .select("id, full_name, avg_rating, completed_jobs, home_lat, home_lng, phone, hourly_rate")
        .eq("is_approved", true)
        .eq("is_active", true)
        .order("avg_rating", { ascending: false })
        .limit(1);

      if (!data || data.length === 0) {
        return json(503, { error: "Inga städare tillgängliga just nu" });
      }
      cleaner = data[0];
    }

    const cleanerTier: "standard" | "top" =
      cleaner.tier === "top" ? "top" : "standard";

    // ── 3. LÖS RABATTKOD ──────────────────────────
    const discount = await resolveDiscount(
      supabase,
      discount_code || null,
      validHours,
      false // isSubscription — inte implementerat i Fas 1
    );

    if (discount_code && !discount.valid) {
      return json(400, { error: discount.error || "Ogiltig rabattkod" });
    }

    // ── 4. HÄMTA KREDIT ────────────────────────────
    const availableCredit = await getAvailableCredit(supabase, email);

    // ── 5. BERÄKNA PRIS — PRICING ENGINE ───────────
    const settings = await loadSettings(supabase);

    // Kolla per-tjänst-pris
    let usePerSqm = false;
    let perSqmRate = 0;
    try {
      const { data: svcPrices } = await supabase
        .from("cleaner_service_prices")
        .select("price, price_type")
        .eq("cleaner_id", cleaner.id)
        .eq("service_type", service.split(" + ")[0].trim())
        .limit(1);
      if (svcPrices && svcPrices.length > 0) {
        if (svcPrices[0].price_type === "per_sqm" && sqm) {
          usePerSqm = true;
          perSqmRate = svcPrices[0].price;
          // Override: total = rate × kvm, dividerat på timmar för att prismotor fungerar
          settings.basePricePerHour = Math.round((perSqmRate * sqm) / validHours);
        } else {
          settings.basePricePerHour = svcPrices[0].price;
        }
      } else if (cleaner.hourly_rate && cleaner.hourly_rate > 0) {
        settings.basePricePerHour = cleaner.hourly_rate;
      }
    } catch (e) {
      console.warn("Service price lookup:", e);
      if (cleaner.hourly_rate && cleaner.hourly_rate > 0) {
        settings.basePricePerHour = cleaner.hourly_rate;
      }
    }

    const pricing = calculateBooking(settings, {
      hours: validHours,
      cleanerTier,
      discountPercent: discount.percentOff,
      fixedDiscountSek: discount.fixedOffSek,
      isSubscription: false,
      creditSek: availableCredit,
    });

    // ── 6. MARGINALCHECK ───────────────────────────
    if (!pricing.allowed) {
      console.error("Margin check failed:", pricing);
      return json(400, {
        error: "Priset ger för låg marginal. Rabattkoden kan inte användas med denna bokning.",
        detail: pricing.reason,
      });
    }

    // ── 7. RUT-BERÄKNING ───────────────────────────
    const useRut = !!rut && customer_type !== 'foretag';
    const rutDeduction = useRut
      ? Math.floor(pricing.customerTotal * 0.5)
      : 0;
    const netPrice = pricing.customerTotal - rutDeduction;

    // Stripe-belopp = det kunden faktiskt betalar (efter RUT + kredit)
    const stripeAmount = Math.max(
      Math.round(netPrice - pricing.creditApplied),
      0
    );

    // ── 7b. DEDUP-GUARD: förhindra dubbelklick ──────
    const { data: existingBooking } = await supabase
      .from("bookings")
      .select("id, stripe_session_id")
      .eq("customer_email", email)
      .eq("booking_date", date)
      .eq("booking_time", time)
      .eq("service_type", service)
      .in("payment_status", ["pending", "paid"])
      .maybeSingle();

    if (existingBooking) {
      if (existingBooking.stripe_session_id) {
        const sess = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${existingBooking.stripe_session_id}`,
          { headers: { Authorization: `Bearer ${STRIPE_KEY}` } }
        ).then(r => r.json());
        if (sess?.url) {
          return json(200, {
            url: sess.url,
            booking_id: existingBooking.id,
            customer_price: netPrice,
            cleaner_name: cleaner.full_name || cleaner_name,
            deduplicated: true,
          });
        }
      }
      await supabase.from("bookings").delete().eq("id", existingBooking.id);
    }

    // ── 8. SKAPA BOKNING I DB ──────────────────────
    const bookingId = crypto.randomUUID();
    const timeEnd = addMinutes(time, validHours * 60);

    const { error: insertErr } = await supabase.from("bookings").insert({
      id: bookingId,
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      customer_address: address,
      service_type: service,
      booking_date: date,
      booking_time: time,
      booking_hours: validHours,
      total_price: Math.round(netPrice),
      status: "pending",
      payment_status: "pending",
      rut_amount: useRut ? Math.round(rutDeduction) : 0,
      frequency: frequency || "once",
      cleaner_id: cleaner.id,
      cleaner_name: cleaner.full_name || cleaner_name,
      square_meters: sqm || null,
      notes: customer_notes || null,
      ...(customer_pnr_hash ? { customer_pnr_hash } : {}),
      ...(customer_pnr ? { customer_pnr: await encryptPnr(customer_pnr) } : {}),
      key_type: key_type || 'open',
      key_info: key_info || null,

      // ── PRISMOTOR-FÄLT (nya) ──
      base_price_per_hour: pricing.basePricePerHour,
      customer_price_per_hour: pricing.customerPricePerHour,
      cleaner_price_per_hour: pricing.cleanerPricePerHour,
      commission_pct: pricing.commissionPct,
      discount_pct: pricing.discountPct,
      discount_code: discount_code || null,
      spick_gross_sek: pricing.spickGross,
      spick_net_sek: pricing.spickNet,
      net_margin_pct: pricing.netMarginPct,
      stripe_fee_sek: pricing.stripeFee,
      credit_applied_sek: pricing.creditApplied,
      customer_type: customer_type || 'privat',
      business_name: business_name || null,
      business_org_number: business_org_number || null,
      business_reference: business_reference || null,
    });

    if (insertErr) {
      console.error("Booking insert failed:", insertErr);
      return json(500, { error: "Kunde inte skapa bokning" });
    }

    // ── 9. LOGGA RABATTANVÄNDNING ──────────────────
    if (discount.discountId && discount.percentOff > 0) {
      // Öka current_uses — hämta först, inkrementera i JS
      const { data: discRow } = await supabase
        .from("discounts")
        .select("current_uses")
        .eq("id", discount.discountId)
        .single();
      await supabase
        .from("discounts")
        .update({ current_uses: (discRow?.current_uses ?? 0) + 1 })
        .eq("id", discount.discountId);

      // Logga användning
      await supabase.from("discount_usage").insert({
        discount_id: discount.discountId,
        booking_id: bookingId,
        customer_email: email,
        percent_applied: discount.percentOff,
        amount_saved_sek: Math.round(
          (pricing.basePricePerHour * validHours * discount.percentOff) / 100
        ),
      });
    }

    // ── 10. DRA KREDIT (om använd) ─────────────────
    if (pricing.creditApplied > 0) {
      let remaining = pricing.creditApplied;
      const { data: credits } = await supabase
        .from("customer_credits")
        .select("id, remaining_sek")
        .eq("customer_email", email)
        .gt("remaining_sek", 0)
        .gte("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: true }); // FIFO

      for (const c of credits || []) {
        if (remaining <= 0) break;
        const deduct = Math.min(remaining, Number(c.remaining_sek));
        await supabase
          .from("customer_credits")
          .update({ remaining_sek: Number(c.remaining_sek) - deduct })
          .eq("id", c.id);
        remaining -= deduct;
      }
    }

    // ── 11. LOGGA EVENT ────────────────────────────
    try {
      await supabase.rpc("log_booking_event", {
        p_booking_id: bookingId,
        p_event_type: "booking_created",
        p_actor_type: "customer",
        p_metadata: {
          cleaner_tier: cleanerTier,
          commission_pct: pricing.commissionPct,
          discount_pct: pricing.discountPct,
          net_margin_pct: pricing.netMarginPct,
          credit_applied: pricing.creditApplied,
        },
      });
    } catch (_) {} // Non-critical

    // ── 12. STRIPE CHECKOUT ────────────────────────
    if (stripeAmount <= 0) {
      // Helt kredit-betald bokning — bekräfta direkt
      await supabase
        .from("bookings")
        .update({ status: "confirmed", payment_status: "paid" })
        .eq("id", bookingId);

      return json(201, {
        booking_id: bookingId,
        url: `${BASE_URL}/tack.html?bid=${bookingId}&service=${encodeURIComponent(service)}&date=${encodeURIComponent(date)}`,
        customer_price: netPrice,
        cleaner_name: cleaner.full_name || cleaner_name,
        paid_with_credit: true,
      });
    }

    const amountOre = stripeAmount * 100;
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("currency", "sek");
    params.append("customer_email", email);
    params.append(
      "success_url",
      `${BASE_URL}/tack.html?session_id={CHECKOUT_SESSION_ID}&bid=${bookingId}&service=${encodeURIComponent(service)}&date=${encodeURIComponent(date)}&address=${encodeURIComponent(address || "")}&time=${encodeURIComponent(time || "")}&cleaner_name=${encodeURIComponent(cleaner.full_name || cleaner_name || "")}&price=${stripeAmount}`
    );
    params.append("cancel_url", `${BASE_URL}/boka.html?cancelled=1`);

    // Metadata
    params.append("metadata[booking_id]", bookingId);
    params.append("metadata[booking_type]", "instant");
    params.append("metadata[cleaner_id]", cleaner.id);
    params.append("metadata[cleaner_name]", (cleaner.full_name || cleaner_name || "").slice(0, 100));
    params.append("metadata[commission_pct]", String(pricing.commissionPct));
    params.append("metadata[net_margin_pct]", String(pricing.netMarginPct));
    if (address) params.append("metadata[address]", address.slice(0, 200));
    if (phone) params.append("metadata[phone]", phone);
    params.append("metadata[rut]", rut ? "true" : "false");
    if (frequency) params.append("metadata[frequency]", frequency);

    // Payment methods
    params.append("payment_method_types[]", "card");
    params.append("payment_method_types[]", "klarna");

    // Line item
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "sek");
    params.append("line_items[0][price_data][unit_amount]", String(amountOre));

    let productName = `${service} – ${validHours} timmar`;
    let productDesc = `Städdatum: ${date}. Städare: ${cleaner.full_name || cleaner_name || "Tilldelas"}`;
    if (useRut) productDesc = `Pris inkl. 50% RUT-avdrag. ${productDesc}`;
    if (pricing.discountPct > 0) productDesc += `. Rabatt: ${pricing.discountPct}%`;

    params.append("line_items[0][price_data][product_data][name]", productName);
    params.append("line_items[0][price_data][product_data][description]", productDesc);
    params.append("line_items[0][price_data][product_data][images][]", "https://spick.se/assets/og-image.png");

    params.append("payment_intent_data[statement_descriptor]", "SPICK STADNING");
    params.append("billing_address_collection", "auto");

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2023-10-16",
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error("Stripe error:", JSON.stringify(session));
      await supabase.from("bookings").delete().eq("id", bookingId);
      return json(500, {
        error: session.error?.message || "Stripe-fel",
      });
    }

    // Uppdatera booking med Stripe-session
    await supabase
      .from("bookings")
      .update({
        stripe_session_id: session.id,
        payment_intent_id: session.payment_intent,
      })
      .eq("id", bookingId);

    // ── 13. RETURN ─────────────────────────────────
    return json(200, {
      url: session.url,
      session_id: session.id,
      booking_id: bookingId,
      customer_price: netPrice,
      cleaner_name: cleaner.full_name || cleaner_name,
      discount_applied: pricing.discountPct > 0 ? `${pricing.discountPct}%` : null,
      credit_applied: pricing.creditApplied > 0 ? pricing.creditApplied : null,
    });
  } catch (e) {
    console.error("booking-create exception:", e);
    return json(500, { error: (e as Error).message });
  }
});

// ── HELPERS ──────────────────────────────────────

function addMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}
