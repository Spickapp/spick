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
//     cleaner_id?, discount_code?, rut?, frequency?,
//     manual_override_price?, payment_mode?, send_email_to_customer?,
//     company_id?, subscription_id?, manual_entry? }
//
// Servern returnerar:
//   { url, booking_id, customer_price, cleaner_name }        — stripe_checkout
//   { booking_id, payment_mode, customer_price, cleaner_name } — stripe_subscription
// =============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  loadSettings,
  resolveDiscount,
  getAvailableCredit,
  calculateBooking,
} from "../_shared/pricing-engine.ts";
import { resolvePricing } from "../_shared/pricing-resolver.ts";
import { corsHeaders, encryptPnr, sendEmail, wrap, card } from "../_shared/email.ts";

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
      chosen_cleaner_match_score, // §3.7 audit-writing (null för v1-fallback)
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
      // ── §2.7.3: B2B-utökning (6 nya fält från §2.7.1-schema) ──
      business_vat_number,
      business_contact_person,
      business_invoice_email,
      invoice_address_street,
      invoice_address_city,
      invoice_address_postal_code,
      auto_delegation_enabled,
      // ── V1.0: Manuell bokning + Subscription ──
      manual_override_price,     // integer | null — VD-satt totalpris
      payment_mode,              // 'stripe_checkout' | 'stripe_subscription' (default: 'stripe_checkout')
      send_email_to_customer,    // boolean — skicka mejl till kund
      company_id,                // uuid — VD:s företag (vid manuell bokning)
      subscription_id,           // uuid — om genererad av subscription-engine
      manual_entry,              // boolean — flagga för manuella bokningar
    } = body;

    // Validera payment_mode (CHECK constraint i DB)
    const validPaymentModes = ['stripe_checkout', 'stripe_subscription'];
    const effectivePaymentMode = validPaymentModes.includes(payment_mode) ? payment_mode : 'stripe_checkout';

    // Required fields
    if (!name || !email || !date || !time || !hours || !service) {
      return json(400, { error: "Obligatoriska fält saknas: name, email, date, time, hours, service" });
    }

    // ── §2.7.3: B2B-sanitering + customer_type-validering ──
    // sanitize(): trim sträng + returnera null för whitespace-only
    // (defense-in-depth; frontend trim:ar redan, men direkt API-anrop
    //  kan skicka whitespace som annars sparas som-är).
    const sanitize = (s: unknown): string | null => {
      if (typeof s !== 'string') return null;
      const trimmed = s.trim();
      return trimmed === '' ? null : trimmed;
    };

    // customer_type hybrid-validering (B-10-beslut):
    //   - saknas/null/undefined → default 'privat' (backwards-compat för
    //     pre-§2.7.2-clients)
    //   - satt men ogiltigt värde → 400 Bad Request (skydd mot bad-actor
    //     / cache-drift)
    const validCustomerTypes = ['privat', 'foretag'];
    let effectiveCustomerType: 'privat' | 'foretag';
    if (customer_type === undefined || customer_type === null || customer_type === '') {
      effectiveCustomerType = 'privat';
    } else if (validCustomerTypes.includes(customer_type)) {
      effectiveCustomerType = customer_type as 'privat' | 'foretag';
    } else {
      return json(400, {
        error: `Ogiltigt customer_type: '${customer_type}'. Tillåtna värden: 'privat' eller 'foretag'.`
      });
    }

    // B2B-fält (saniterade). När customer_type='privat' tvingas alla
    // till null (B-11-beslut: data-integritet, förhindra läckage).
    const isBusinessBooking = effectiveCustomerType === 'foretag';
    const b2bFields = {
      business_name:                isBusinessBooking ? sanitize(business_name)                : null,
      business_org_number:          isBusinessBooking ? sanitize(business_org_number)          : null,
      business_reference:           isBusinessBooking ? sanitize(business_reference)           : null,
      business_vat_number:          isBusinessBooking ? sanitize(business_vat_number)          : null,
      business_contact_person:      isBusinessBooking ? sanitize(business_contact_person)      : null,
      business_invoice_email:       isBusinessBooking ? sanitize(business_invoice_email)       : null,
      invoice_address_street:       isBusinessBooking ? sanitize(invoice_address_street)       : null,
      invoice_address_city:         isBusinessBooking ? sanitize(invoice_address_city)         : null,
      invoice_address_postal_code:  isBusinessBooking ? sanitize(invoice_address_postal_code)  : null,
    };

    const validHours = Math.max(2, Math.min(12, Number(hours) || 3));

    // ── 2. HÄMTA STÄDARE ───────────────────────────
    let cleaner: any = null;

    if (cleaner_id) {
      const { data, error } = await supabase
        .from("cleaners")
        .select("id, full_name, avg_rating, completed_jobs, home_lat, home_lng, phone, hourly_rate, company_id, is_company_owner")
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
        .select("id, full_name, avg_rating, completed_jobs, home_lat, home_lng, phone, hourly_rate, company_id, is_company_owner")
        .eq("is_approved", true)
        .eq("is_active", true)
        .order("avg_rating", { ascending: false })
        .limit(1);

      if (!data || data.length === 0) {
        return json(503, { error: "Inga städare tillgängliga just nu" });
      }
      cleaner = data[0];
    }

    // ── 2b. HÄMTA FÖRETAGSNAMN om städaren tillhör ett företag ──
    // Bugg #2: Använd format "Personnamn (Företag)" för teammedlemmar
    // Solo-städare: bara personnamn
    let displayName: string = cleaner.full_name;
    if (cleaner.company_id) {
      try {
        const { data: company } = await supabase
          .from("companies")
          .select("display_name, name")
          .eq("id", cleaner.company_id)
          .single();
        if (company) {
          const companyName = company.display_name || company.name;
          if (companyName) {
            displayName = `${cleaner.full_name} (${companyName})`;
          }
        }
      } catch (_) {
        // Fallback till personnamn om company-fetch misslyckas — icke-kritiskt
      }
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

    // Löser pris + commission via central pricing-resolver
    // (respekterar companies.use_company_pricing, läser commission
    //  från platform_settings.commission_standard)
    const resolved = await resolvePricing(supabase, {
      cleanerId: cleaner.id,
      serviceType: service,
    });
    if (resolved.priceType === "per_sqm" && resolved.pricePerSqm && sqm) {
      // Per_sqm: räkna om till hourly equivalent så pricing-engine fortsatt fungerar
      settings.basePricePerHour = Math.round((resolved.pricePerSqm * sqm) / validHours);
    } else if (resolved.basePricePerHour > 0) {
      settings.basePricePerHour = resolved.basePricePerHour;
    }
    console.log("[SPICK] Pricing resolved:", {
      source: resolved.source,
      priceType: resolved.priceType,
      basePricePerHour: settings.basePricePerHour,
      commissionPct: resolved.commissionPct,
    });

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

    // ── 6b. PRIS-OVERRIDE (manuell bokning från VD) ──────────
    // Modell A: proportionell skalning — alla tar samma procentuella hit
    let overrideActive = false;
    if (manual_override_price && Number(manual_override_price) >= 100) {
      overrideActive = true;
      const op = Math.round(Number(manual_override_price));
      const originalTotal = pricing.customerTotal;
      if (originalTotal > 0) {
        const ratio = op / originalTotal;
        pricing.customerTotal = op;
        pricing.customerPricePerHour = Math.round(pricing.customerPricePerHour * ratio * 100) / 100;
        pricing.cleanerTotal = Math.round(pricing.cleanerTotal * ratio);
        pricing.cleanerPricePerHour = Math.round(pricing.cleanerPricePerHour * ratio * 100) / 100;
        pricing.spickGross = Math.round(pricing.spickGross * ratio);
        pricing.stripeFee = Math.round(pricing.stripeFee * ratio * 100) / 100;
        pricing.spickNet = pricing.spickGross - pricing.stripeFee;
        pricing.netMarginPct = op > 0
          ? Math.round((pricing.spickNet / op) * 1000) / 10
          : 0;
      }
      console.log("[SPICK] Override price:", { override: op, ratio: op / originalTotal, cleanerTotal: pricing.cleanerTotal, spickGross: pricing.spickGross });
    } else if (manual_override_price && Number(manual_override_price) > 0 && Number(manual_override_price) < 100) {
      return json(400, { error: "Minimipris är 100 kr" });
    }

    // ── 7. RUT-BERÄKNING ───────────────────────────
    // §2.7.3: använd effectiveCustomerType (post-validering) istället för
    // rå customer_type från body.
    const useRut = !!rut && effectiveCustomerType !== 'foretag';
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
            cleaner_name: displayName || cleaner_name,
            deduplicated: true,
          });
        }
      }
      await supabase.from("bookings").delete().eq("id", existingBooking.id);
    }

    // ── 8. SKAPA BOKNING I DB ──────────────────────
    const bookingId = crypto.randomUUID();
    const timeEnd = addMinutes(time, validHours * 60);

    // §3.7: läs aktuell matching_algorithm_version från platform_settings server-side
    // Klient får inte dikterar detta — säkerhetsgaranti för A/B-analysens integritet
    const { data: versionRow } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "matching_algorithm_version")
      .maybeSingle();
    const matchingVersion = versionRow?.value ?? "v1";

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
      cleaner_name: displayName || cleaner_name,
      // §3.7 audit-writing: score på vald cleaner + version-snapshot
      chosen_cleaner_match_score: typeof chosen_cleaner_match_score === "number" ? chosen_cleaner_match_score : null,
      matching_algorithm_version: matchingVersion,
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
      // ── §2.7.3: customer_type + 9 B2B-kolumner (saniterade + null-tvång) ──
      customer_type: effectiveCustomerType,
      business_name:                b2bFields.business_name,
      business_org_number:          b2bFields.business_org_number,
      business_reference:           b2bFields.business_reference,
      business_vat_number:          b2bFields.business_vat_number,
      business_contact_person:      b2bFields.business_contact_person,
      business_invoice_email:       b2bFields.business_invoice_email,
      invoice_address_street:       b2bFields.invoice_address_street,
      invoice_address_city:         b2bFields.invoice_address_city,
      invoice_address_postal_code:  b2bFields.invoice_address_postal_code,
      auto_delegation_enabled: auto_delegation_enabled === true ? true : (auto_delegation_enabled === false ? false : null),

      // ── V1.0: Payment mode + Override + Subscription + RUT ──
      payment_mode: effectivePaymentMode,
      subscription_id: subscription_id || null,
      manual_override_price: overrideActive ? Math.round(Number(manual_override_price)) : null,
      rut_application_status: (!!rut && effectiveCustomerType !== 'foretag') ? 'pending' : 'not_applicable',
    });

    if (insertErr) {
      console.error("Booking insert failed:", insertErr);
      return json(500, { error: "Kunde inte skapa bokning" });
    }

    // ── §2.7.3: Minimal B2B-logging för spårbarhet ──
    // Logga bara icke-känsliga identifierare (Regel #26 D).
    // Metriker hanteras i Fas 10 (Observability).
    if (isBusinessBooking) {
      console.log('[BOOKING-CREATE] B2B booking created:', {
        booking_id: bookingId,
        business_name: b2bFields.business_name,
        business_org_number: b2bFields.business_org_number,
        has_vat_number: !!b2bFields.business_vat_number,
        has_separate_invoice_address: !!b2bFields.invoice_address_street,
      });
    }

    // ── 8b. UPSERT CUSTOMER_PROFILE via customer-upsert EF (Fas 1.2) ─────
    // Delegerar till customer-upsert for att sakerstalla auth.users-koppling +
    // audit-log. Non-blocking: fel far INTE stoppa bokningen.
    try {
      const payload: Record<string, unknown> = {
        email,
        source: "booking",
        name,
        phone: phone || null,
        address: address || null,
      };
      if (auto_delegation_enabled === true || auto_delegation_enabled === false) {
        payload.auto_delegation_enabled = auto_delegation_enabled;
      }
      await fetch(`${Deno.env.get("SUPABASE_URL") ?? "https://urjeijcncsyuletprydy.supabase.co"}/functions/v1/customer-upsert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (profileErr) {
      console.warn("customer-upsert call failed (non-critical):", (profileErr as Error).message);
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

    // ═══════════════════════════════════════════════════
    // GREN: stripe_subscription — bokning utan direkt betalning
    // Charge sker senare via charge-subscription-booking EF
    // ═══════════════════════════════════════════════════
    if (effectivePaymentMode === 'stripe_subscription') {
      await supabase
        .from("bookings")
        .update({
          status: "confirmed",
          payment_status: "awaiting_charge",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", bookingId);

      // Email till kund (bekräftelse utan betalningslänk)
      if (send_email_to_customer && email) {
        try {
          let companyName = "Spick";
          if (cleaner.company_id) {
            const { data: co } = await supabase
              .from("companies")
              .select("display_name, name")
              .eq("id", cleaner.company_id)
              .maybeSingle();
            if (co) companyName = co.display_name || co.name;
          }

          const emailHtml = wrap(`
            <h2>Bekräftelse: Din prenumeration</h2>
            <p>Hej ${name.split(' ')[0]}!</p>
            <p>Din återkommande städning hos <strong>Spick</strong> är bekräftad.</p>
            ${card([
              ['Tjänst', service + ' · ' + validHours + ' tim'],
              ['Datum', new Date(date).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })],
              ['Tid', time],
              ['Adress', address || '—'],
              ['Utförs av', companyName],
              ['Pris', netPrice + ' kr' + (useRut ? ' (efter RUT)' : '')]
            ])}
            <p style="font-size:13px;color:#6B6960;margin-top:16px">Betalning dras automatiskt innan varje städtillfälle. Du kan hantera din prenumeration via länken i kommande bokningsbekräftelser.</p>
          `);

          await sendEmail(email, 'Bekräftelse: Prenumeration hos Spick', emailHtml);
        } catch (e) { console.warn("Subscription email failed:", e); }
      }

      return json(200, {
        booking_id: bookingId,
        payment_mode: effectivePaymentMode,
        customer_price: netPrice,
        cleaner_name: displayName || cleaner_name,
      });
    }

    // ── 11b. STRIPE CONNECT: Hämta mottagarens konto ──
    // Commission läses från resolved.commissionPct (platform_settings).
    // customer_type är ej längre en faktor — 12% flat per 17 april 2026-beslutet.
    let destinationAccountId: string | null = null;
    const commissionRate = resolved.commissionPct / 100;

    {
      const { data: cleanerConnect } = await supabase
        .from("cleaners")
        .select("stripe_account_id, stripe_onboarding_status, company_id, is_company_owner")
        .eq("id", cleaner.id)
        .single();

      if (cleanerConnect?.company_id && !cleanerConnect.is_company_owner) {
        // Städare tillhör företag → pengar till företagsägaren
        const { data: owner } = await supabase
          .from("cleaners")
          .select("stripe_account_id, stripe_onboarding_status")
          .eq("company_id", cleanerConnect.company_id)
          .eq("is_company_owner", true)
          .single();
        if (owner?.stripe_account_id && owner.stripe_onboarding_status === "complete") {
          destinationAccountId = owner.stripe_account_id;
        }
      } else if (cleanerConnect?.stripe_account_id && cleanerConnect.stripe_onboarding_status === "complete") {
        destinationAccountId = cleanerConnect.stripe_account_id;
      }
    }
    console.log("[SPICK] Connect:", { cleanerId: cleaner.id, destinationAccountId, commissionRate });

    // ── 12. STRIPE CHECKOUT ────────────────────────
    // Sanity check: vägra orimliga belopp (undantag: kredit-betald)
    if (stripeAmount > 0 && stripeAmount < 3) {
      console.error("[SPICK] Price sanity failed:", { stripeAmount, netPrice, basePrice: pricing.basePricePerHour, validHours });
      await supabase.from("bookings").delete().eq("id", bookingId);
      return json(400, { error: "Ogiltigt belopp — kontrollera prisinställningar" });
    }
    if (stripeAmount > 30000) {
      console.error("[SPICK] Price sanity failed (too high):", { stripeAmount });
      await supabase.from("bookings").delete().eq("id", bookingId);
      return json(400, { error: "Ogiltigt belopp" });
    }

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
        cleaner_name: displayName || cleaner_name,
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
      `${BASE_URL}/tack.html?session_id={CHECKOUT_SESSION_ID}&bid=${bookingId}&service=${encodeURIComponent(service)}&date=${encodeURIComponent(date)}&address=${encodeURIComponent(address || "")}&time=${encodeURIComponent(time || "")}&cleaner_name=${encodeURIComponent(displayName || cleaner_name || "")}&price=${stripeAmount}`
    );
    params.append("cancel_url", `${BASE_URL}/boka.html?cancelled=1`);

    // Metadata
    params.append("metadata[booking_id]", bookingId);
    params.append("metadata[booking_type]", "instant");
    params.append("metadata[cleaner_id]", cleaner.id);
    params.append("metadata[cleaner_name]", (displayName || cleaner_name || "").slice(0, 100));
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
    let productDesc = `Städdatum: ${date}. Städare: ${displayName || cleaner_name || "Tilldelas"}`;
    if (useRut) productDesc = `Pris inkl. 50% RUT-avdrag. ${productDesc}`;
    if (pricing.discountPct > 0) productDesc += `. Rabatt: ${pricing.discountPct}%`;

    params.append("line_items[0][price_data][product_data][name]", productName);
    params.append("line_items[0][price_data][product_data][description]", productDesc);
    params.append("line_items[0][price_data][product_data][images][]", "https://spick.se/assets/og-image.png");

    params.append("payment_intent_data[statement_descriptor]", "SPICK STADNING");
    params.append("billing_address_collection", "auto");

    // ── STRIPE CONNECT: Destination charge ──────────
    if (destinationAccountId) {
      const applicationFee = Math.round(amountOre * commissionRate);
      params.append("payment_intent_data[transfer_data][destination]", destinationAccountId);
      params.append("payment_intent_data[application_fee_amount]", String(applicationFee));
      console.log("[SPICK] Destination charge:", { destination: destinationAccountId, fee: applicationFee / 100 + " SEK" });
    } else {
      console.log("[SPICK] No connected account — funds stay on platform");
    }

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

    // ── Email med betalningslänk (om begärt) ──────────
    if (send_email_to_customer && email && session.url) {
      try {
        let companyName = "Spick";
        if (cleaner.company_id) {
          const { data: co } = await supabase
            .from("companies")
            .select("display_name, name")
            .eq("id", cleaner.company_id)
            .maybeSingle();
          if (co) companyName = co.display_name || co.name;
        }

        const rutText = useRut ? ' (inkl. RUT-avdrag)' : '';
        const emailHtml = wrap(`
          <h2>Betala för din städning</h2>
          <p>Hej ${name.split(' ')[0]}!</p>
          <p>En städning har bokats åt dig hos <strong>Spick</strong>.</p>
          ${card([
            ['Tjänst', service + ' · ' + validHours + ' tim'],
            ['Datum', new Date(date).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })],
            ['Tid', time],
            ['Adress', address || '—'],
            ['Utförs av', companyName],
            ['Pris', netPrice + ' kr' + rutText]
          ])}
          <p>Betala tryggt med kort eller Klarna:</p>
          <p><a href="${session.url}" class="btn">Betala nu →</a></p>
          <p style="font-size:13px;color:#6B6960;margin-top:24px">Länken är giltig i 24 timmar. Bokningen bekräftas automatiskt efter betalning.</p>
        `);

        await sendEmail(email, 'Betala för din städning hos Spick', emailHtml);
      } catch (e) { console.warn("Payment link email failed:", e); }
    }

    // ── Logga provision i commission_log ────────────
    if (destinationAccountId) {
      try {
        const commSek = Math.round(stripeAmount * commissionRate);
        await supabase.from("commission_log").insert({
          booking_id: bookingId,
          cleaner_id: cleaner.id,
          gross_amount: stripeAmount,
          commission_pct: commissionRate * 100,
          commission_amt: commSek,
          net_amount: stripeAmount - commSek,
          level_name: `Standard ${resolved.commissionPct}%`,
        });
      } catch (e) { console.warn("Commission log error:", e); }
    }

    // ── 13. RETURN ─────────────────────────────────
    return json(200, {
      url: session.url,
      session_id: session.id,
      booking_id: bookingId,
      customer_price: netPrice,
      cleaner_name: displayName || cleaner_name,
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
