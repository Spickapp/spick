// supabase/functions/setup-subscription/index.ts
// =============================================================
// SPICK: Subscription Setup
// Skapar en subscription-record + Stripe Customer + Checkout Session
// (mode=setup) så att kunden kan registrera betalkort. Efter avslutad
// kortregistrering hanteras resten av stripe-webhook (handleSubscriptionSetup).
//
// Klienten skickar:
//   { name, email, phone, address, city?,
//     date, time, hours, service,
//     cleaner_id, cleaner_name?,
//     frequency: 'weekly' | 'biweekly' | 'monthly',
//     customer_type, customer_pnr?, business_*,
//     key_type, key_info, customer_notes, rut,
//     company_id?, manual_override_price? }
//
// Servern returnerar:
//   { subscription_id, setup_url, customer_email, frequency }
// =============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, sendEmail, wrap, card, encryptPnr } from "../_shared/email.ts";
import { upsertHold, findSlotConflict } from "../_shared/slot-holds.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY")!;
const BASE_URL     = Deno.env.get("BASE_URL") || "https://spick.se";

serve(async (req) => {
  const CORS = corsHeaders(req);

  function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json();
    const {
      name,
      email,
      phone,
      address,
      city,
      date,
      time,
      hours,
      service,
      cleaner_id,
      cleaner_name: _cleaner_name, // reserveras
      frequency,
      customer_type,
      customer_pnr,
      business_name,
      business_org_number,
      business_reference,
      key_type,
      key_info,
      customer_notes,
      rut,
      company_id,
      manual_override_price,
    } = body;

    // 1. Validera required fields
    if (!name || !email || !address || !date || !hours || !service || !cleaner_id || !frequency) {
      return json(400, { error: "Obligatoriska fält saknas" });
    }
    if (!["weekly", "biweekly", "monthly"].includes(frequency)) {
      return json(400, { error: "Ogiltig frekvens" });
    }

    // 2. Beräkna preferred_day (1=mån...7=sön)
    const jsDay = new Date(date).getDay(); // 0=sön, 1=mån...6=lör
    const preferred_day = jsDay === 0 ? 7 : jsDay;

    // 3. Hämta städare
    const { data: cleaner, error: cleanerErr } = await supabase
      .from("cleaners")
      .select("id, full_name, hourly_rate, company_id, is_company_owner")
      .eq("id", cleaner_id)
      .single();

    if (cleanerErr || !cleaner) {
      return json(400, { error: "Städaren finns inte" });
    }

    // 4. Beräkna pris
    const rate = cleaner.hourly_rate || 350;
    let totalPrice = Math.round(Number(hours) * rate);
    if (manual_override_price && Number(manual_override_price) >= 100) {
      totalPrice = Math.round(Number(manual_override_price));
    }

    // 5. Hämta eller skapa Stripe Customer
    const { data: existingProfile } = await supabase
      .from("customer_profiles")
      .select("stripe_customer_id")
      .eq("email", email)
      .maybeSingle();

    let stripeCustomerId: string | null = existingProfile?.stripe_customer_id || null;

    if (!stripeCustomerId) {
      const customerRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: email,
          name: name,
          "metadata[source]": "spick_subscription",
        }).toString(),
      });
      const customer = await customerRes.json();
      if (!customerRes.ok || !customer.id) {
        console.error("[SPICK] Stripe customer creation failed:", customer);
        return json(500, { error: "Kunde inte skapa Stripe-kund" });
      }
      stripeCustomerId = customer.id;

      await supabase.from("customer_profiles").upsert(
        {
          email,
          name,
          phone: phone || null,
          address: address || null,
          city: city || null,
          stripe_customer_id: stripeCustomerId,
        },
        { onConflict: "email" },
      );
    }

    // 6. Skapa subscription-record
    const subscriptionId = crypto.randomUUID();
    const useRut = !!rut && customer_type !== "foretag";

    const subInsert: Record<string, unknown> = {
      id: subscriptionId,
      customer_name: name,
      customer_email: email,
      customer_phone: phone || null,
      customer_address: address || null,
      service_type: service,
      frequency: frequency,
      preferred_day: preferred_day,
      preferred_time: time || "09:00",
      booking_hours: Number(hours),
      cleaner_id: cleaner_id,
      cleaner_name: cleaner.full_name,
      hourly_rate: cleaner.hourly_rate || 350,
      status: "pending_setup",
      next_booking_date: date,
      city: city || null,
      rut: useRut,
      key_type: key_type || "open",
      key_info: key_info || null,
      customer_notes: customer_notes || null,
      customer_type: customer_type || "privat",
      business_name: business_name || null,
      business_org_number: business_org_number || null,
      business_reference: business_reference || null,
      auto_delegation_enabled: null,
      payment_mode: "stripe_subscription",
      company_id: company_id || cleaner.company_id || null,
      manual_override_price: (manual_override_price && Number(manual_override_price) >= 100)
        ? Math.round(Number(manual_override_price)) : null,
    };
    if (customer_pnr) {
      subInsert.customer_pnr_hash = await encryptPnr(customer_pnr);
    }

    const { error: insertErr } = await supabase.from("subscriptions").insert(subInsert);
    if (insertErr) {
      console.error("[SPICK] Subscription insert failed:", insertErr);
      return json(500, { error: "Kunde inte skapa prenumeration" });
    }

    // §5.4.2 Soft-reservation: skapa slot_hold för denna sub + varna kund om existing krock
    try {
      const holdInput = {
        subscription_id: subscriptionId,
        cleaner_id: cleaner_id,
        weekday: preferred_day,
        start_time: (time || "09:00") + (time && time.length === 5 ? ":00" : ""),
        duration_hours: Number(hours),
      };
      const existingConflict = await findSlotConflict(supabase, {
        cleaner_id: cleaner_id,
        weekday: preferred_day,
        start_time: holdInput.start_time,
        duration_hours: Number(hours),
      });
      await upsertHold(supabase, holdInput);
      if (existingConflict) {
        console.warn("[SPICK] setup-subscription: slot-conflict existerade vid create", {
          subscription_id: subscriptionId,
          conflicting_sub: existingConflict.subscription_id,
        });
      }
    } catch (e) {
      console.warn("[SPICK] setup-subscription: slot-hold-create failed (non-fatal):", e);
    }

    // 7. Skapa Stripe Checkout Session (mode=setup)
    const params = new URLSearchParams();
    params.append("mode", "setup");
    params.append("customer", stripeCustomerId);
    params.append("currency", "sek");
    params.append("payment_method_types[]", "card");
    params.append(
      "success_url",
      `${BASE_URL}/prenumeration-tack.html?sub=${subscriptionId}&session_id={CHECKOUT_SESSION_ID}`,
    );
    params.append("cancel_url", `${BASE_URL}/prenumerera.html?cancelled=1`);
    params.append("metadata[subscription_id]", subscriptionId);
    params.append("metadata[customer_email]", email);
    params.append("metadata[type]", "subscription_setup");

    const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const session = await sessionRes.json();

    if (!sessionRes.ok || !session.url) {
      console.error("[SPICK] Stripe setup session failed:", session);
      // Rullar tillbaka subscription-raden så vi inte har kvar skräp
      await supabase.from("subscriptions").delete().eq("id", subscriptionId);
      return json(500, { error: session.error?.message || "Stripe-fel" });
    }

    // 8. Spara setup_intent på subscription
    await supabase
      .from("subscriptions")
      .update({ stripe_setup_intent_id: session.setup_intent || null })
      .eq("id", subscriptionId);

    // 9. Skicka email till kund
    try {
      const freqText = frequency === "weekly"
        ? "varje vecka"
        : frequency === "biweekly"
          ? "varannan vecka"
          : "varje månad";
      const rutText = useRut ? " (efter RUT-avdrag)" : "";
      const displayPrice = useRut ? Math.floor(totalPrice * 0.5) : totalPrice;

      let companyName = "Spick";
      if (cleaner.company_id) {
        const { data: co } = await supabase
          .from("companies")
          .select("display_name, name")
          .eq("id", cleaner.company_id)
          .maybeSingle();
        if (co) companyName = co.display_name || co.name;
      }

      const fname = String(name).split(" ")[0];
      const emailHtml = wrap(`
        <h2>Registrera betalkort</h2>
        <p>Hej ${fname}!</p>
        <p>En prenumeration har skapats åt dig hos <strong>Spick</strong>.</p>
        ${
        card([
          ["Tjänst", service + " · " + hours + " tim"],
          ["Frekvens", freqText.charAt(0).toUpperCase() + freqText.slice(1)],
          ["Utförs av", companyName],
          ["Pris per tillfälle", displayPrice + " kr" + rutText],
        ])
      }
        <p>För att aktivera din prenumeration, registrera ditt betalkort:</p>
        <p><a href="${session.url}" class="btn">Registrera kort →</a></p>
        <p style="font-size:13px;color:#6B6960;margin-top:16px">Ditt kort debiteras automatiskt dagen innan varje städtillfälle. Du kan avsluta prenumerationen när som helst.</p>
        <p style="font-size:13px;color:#6B6960">Länken är giltig i 24 timmar.</p>
      `);

      await sendEmail(email, "Registrera betalkort — Spick prenumeration", emailHtml);
    } catch (e) {
      console.warn("[SPICK] Setup email failed:", e);
    }

    // 10. Returnera
    return json(200, {
      subscription_id: subscriptionId,
      setup_url: session.url,
      customer_email: email,
      frequency: frequency,
    });
  } catch (e) {
    console.error("setup-subscription exception:", e);
    return json(500, { error: (e as Error).message });
  }
});
