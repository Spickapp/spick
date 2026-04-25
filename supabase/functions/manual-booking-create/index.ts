// ═══════════════════════════════════════════════════════════════
// SPICK – manual-booking-create (Fas A)
// ═══════════════════════════════════════════════════════════════
//
// Admin/VD skapar bokning manuellt på kundens vägnar. Kund får
// email med Stripe Checkout-länk för betalning.
//
// PRIMÄRKÄLLOR:
//   - docs/planning/manual-booking-bankid-rut-flow.md (design-spec)
//   - docs/sanning/rut.md (RUT blockas i Fas A)
//   - docs/sanning/provision.md (commission via platform_settings)
//   - _shared/pricing-resolver.ts (SSOT pricing)
//
// FAS-AVGRÄNSNING (Fas A):
//   - Endast email-flow (signing_method='email')
//   - RUT-bokningar BLOCKERADE (privat + rut_amount > 0 → 400)
//   - Klick-bekräftelse (Fas B) + BankID (Fas C) ej tillgängliga
//
// AUTH-NIVÅER:
//   1. admin: full access (admin_users.email-match)
//   2. company_owner: skapa bokningar för egen company
//   3. company_member: skapa bokningar OM company.allow_member_manual_booking=true
//
// FLÖDE:
//   1. Validera JWT + auth-nivå
//   2. Input-validering (service, datum, tid, customer-info, expiry)
//   3. Block RUT (privat + rut_amount > 0)
//   4. Hämta cleaner (default: VD själv eller specificerad)
//   5. Beräkna pris via resolvePricing (SSOT)
//   6. INSERT bookings (status='pending', payment_status='pending',
//      created_by_admin=true, signing_method='email')
//   7. Skapa Stripe Checkout Session (med expires_at)
//   8. UPDATE booking med stripe_session_id + checkout_url
//   9. Skicka email till kund
//   10. logBookingEvent('booking_created', actor='admin')
//   11. Return { booking_id, checkout_url, email_sent }
//
// REGLER:
//   #26 grep-före-edit: pricing-resolver/stripe-pattern/email-helper läst
//   #27 scope: Fas A endast. Click-confirm + BankID flaggade som todo
//   #28 SSOT: pricing via resolvePricing, email via sendEmail+wrap,
//      logger via createLogger
//   #30 ingen regulator-gissning: RUT-block + ingen PNR-collection
//   #31 primärkälla: schema verifierat via curl före migration
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, sendEmail, wrap } from "../_shared/email.ts";
import { resolvePricing } from "../_shared/pricing-resolver.ts";
import { logBookingEvent } from "../_shared/events.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_KEY_LIVE = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_KEY_TEST = Deno.env.get("STRIPE_SECRET_KEY_TEST") || "";
const BASE_URL = Deno.env.get("BASE_URL") || "https://spick.se";

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("manual-booking-create");

// ── Helpers ──────────────────────────────────────────────────

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function isValidEmail(s: unknown): boolean {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function resolveStripeKey(): Promise<string> {
  try {
    const { data } = await sbService
      .from("platform_settings")
      .select("value")
      .eq("key", "stripe_test_mode")
      .single();
    if (data?.value === "true" && STRIPE_KEY_TEST) return STRIPE_KEY_TEST;
  } catch (_) { /* fallback live */ }
  return STRIPE_KEY_LIVE;
}

type AuthContext =
  | { role: "admin"; userId: string; email: string }
  | { role: "company_owner"; userId: string; cleanerId: string; companyId: string }
  | { role: "company_member"; userId: string; cleanerId: string; companyId: string };

async function authorize(jwt: string): Promise<AuthContext | null> {
  const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error } = await sbUser.auth.getUser();
  if (error || !user) return null;
  const email = user.email?.toLowerCase().trim() || "";

  // 1) Admin via admin_users.email
  if (email) {
    const { data: adminRow } = await sbService
      .from("admin_users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (adminRow) return { role: "admin", userId: user.id, email };
  }

  // 2) Cleaner-context (VD eller member-with-flag)
  const { data: cleaner } = await sbService
    .from("cleaners")
    .select("id, company_id, is_company_owner")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!cleaner) return null;

  if (cleaner.is_company_owner && cleaner.company_id) {
    return {
      role: "company_owner",
      userId: user.id,
      cleanerId: cleaner.id as string,
      companyId: cleaner.company_id as string,
    };
  }

  // 3) Member: kräver company.allow_member_manual_booking=true
  if (cleaner.company_id) {
    const { data: company } = await sbService
      .from("companies")
      .select("allow_member_manual_booking")
      .eq("id", cleaner.company_id)
      .maybeSingle();
    if (company?.allow_member_manual_booking) {
      return {
        role: "company_member",
        userId: user.id,
        cleanerId: cleaner.id as string,
        companyId: cleaner.company_id as string,
      };
    }
  }

  return null;
}

function buildEmailHtml(args: {
  customerName: string;
  service: string;
  date: string;
  time: string;
  hours: number;
  address: string;
  cleanerName: string;
  totalPrice: number;
  checkoutUrl: string;
  expiresAt: Date;
}): string {
  const expiresStr = args.expiresAt.toLocaleString("sv-SE", {
    dateStyle: "long",
    timeStyle: "short",
  });
  return wrap(`
    <h2>Hej ${args.customerName},</h2>
    <p>Vi har förberett din bokning hos Spick. Klicka på knappen nedan för att betala och bekräfta.</p>
    <div class="card">
      <div class="row"><span class="lbl">Tjänst</span><span class="val">${args.service}</span></div>
      <div class="row"><span class="lbl">Datum</span><span class="val">${args.date} kl ${args.time}</span></div>
      <div class="row"><span class="lbl">Omfattning</span><span class="val">${args.hours} timmar</span></div>
      <div class="row"><span class="lbl">Adress</span><span class="val">${args.address}</span></div>
      <div class="row"><span class="lbl">Städare</span><span class="val">${args.cleanerName}</span></div>
      <div class="row"><span class="lbl">Att betala</span><span class="val">${Math.round(args.totalPrice)} kr</span></div>
    </div>
    <p style="text-align:center;margin:24px 0">
      <a href="${args.checkoutUrl}" class="btn">Betala via Stripe</a>
    </p>
    <p style="font-size:.82rem;color:#9E9E9A">Länken är giltig till ${expiresStr}. Kontakta oss om du behöver hjälp.</p>
  `);
}

// ── HTTP-handler ─────────────────────────────────────────────

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "missing_auth" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const ctx = await authorize(authHeader.slice(7));
    if (!ctx) {
      return new Response(JSON.stringify({ error: "not_authorized" }), {
        status: 403,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 2. Input
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const customerEmail = typeof body.customer_email === "string" ? body.customer_email.toLowerCase().trim() : "";
    const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
    const customerPhone = typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";
    const customerAddress = typeof body.customer_address === "string" ? body.customer_address.trim() : "";
    const serviceType = typeof body.service_type === "string" ? body.service_type.trim() : "";
    const bookingDate = typeof body.booking_date === "string" ? body.booking_date.trim() : "";
    const bookingTime = typeof body.booking_time === "string" ? body.booking_time.trim() : "";
    const bookingHours = Number(body.booking_hours);
    const customerType = typeof body.customer_type === "string" ? body.customer_type : "privat";
    const cleanerIdInput = typeof body.cleaner_id === "string" ? body.cleaner_id : null;
    const checkoutExpiresInHours = Number(body.checkout_expires_in_hours) || 48;

    // Validation
    if (!isValidEmail(customerEmail)) return new Response(JSON.stringify({ error: "invalid_email" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!customerName) return new Response(JSON.stringify({ error: "missing_customer_name" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!customerAddress) return new Response(JSON.stringify({ error: "missing_address" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!serviceType) return new Response(JSON.stringify({ error: "missing_service_type" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) return new Response(JSON.stringify({ error: "invalid_date" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!/^\d{2}:\d{2}/.test(bookingTime)) return new Response(JSON.stringify({ error: "invalid_time" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!Number.isFinite(bookingHours) || bookingHours < 1 || bookingHours > 12) return new Response(JSON.stringify({ error: "invalid_hours" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (![24, 48, 168].includes(checkoutExpiresInHours)) return new Response(JSON.stringify({ error: "invalid_checkout_expiry", message: "Måste vara 24, 48 eller 168 timmar" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (cleanerIdInput && !isValidUuid(cleanerIdInput)) return new Response(JSON.stringify({ error: "invalid_cleaner_id" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    // 3. Resolve cleaner — default till caller om VD/member, eller använd specificerad
    let cleanerId = cleanerIdInput;
    if (!cleanerId) {
      if (ctx.role === "company_owner" || ctx.role === "company_member") {
        cleanerId = ctx.cleanerId;
      } else {
        return new Response(JSON.stringify({ error: "cleaner_id_required_for_admin" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    const { data: cleaner } = await sbService
      .from("cleaners")
      .select("id, full_name, hourly_rate, company_id")
      .eq("id", cleanerId)
      .maybeSingle();
    if (!cleaner) return new Response(JSON.stringify({ error: "cleaner_not_found" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });

    // VD/member: scope-restriktion till egen company
    if ((ctx.role === "company_owner" || ctx.role === "company_member") && cleaner.company_id !== ctx.companyId) {
      log("warn", "Cross-company cleaner attempt", { caller: ctx.userId, target_cleaner: cleanerId });
      return new Response(JSON.stringify({ error: "cleaner_outside_company" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // 4. Resolve pricing (SSOT)
    // sbService cast as any pga supabase-js typ-mismatch mellan @2 (pricing-resolver)
    // och @2.49.4 (denna EF) — samma runtime-objekt, olika compile-time-typ. H5-pattern.
    // deno-lint-ignore no-explicit-any
    const pricing = await resolvePricing(sbService as any, {
      cleanerId: cleaner.id as string,
      serviceType,
    });

    // 5. Bygg booking-pris (SSOT-pattern: brutto = hours × hourly_rate, RUT 50% för privat-RUT-services)
    const bruttoPrice = (pricing.basePricePerHour || 0) * bookingHours;
    if (bruttoPrice <= 0) {
      log("error", "Invalid bruttoPrice", { cleanerId, serviceType, pricing });
      return new Response(JSON.stringify({ error: "pricing_failed" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // RUT-bedömning: bara privat + RUT-services (Hemstädning/Storstädning/Flyttstädning/Fönsterputs/Trappstädning)
    // Använd services-tabell istället för hardcoded lista (rule #28/#30).
    const { data: serviceRow } = await sbService
      .from("services")
      .select("rut_eligible")
      .eq("name", serviceType)
      .maybeSingle();
    const isRutEligible = serviceRow?.rut_eligible === true;
    const isPrivate = customerType === "privat";
    const wantsRut = isPrivate && isRutEligible;

    // 6. BLOCKERA RUT i Fas A
    if (wantsRut) {
      log("warn", "Manual-booking RUT blocked (Fas A)", { customerEmail, serviceType });
      return new Response(JSON.stringify({
        error: "rut_blocked_in_fas_a",
        message: "Manuell RUT-bokning kräver BankID-signering (Fas C, ej aktiverad). Använd boka.html för RUT-bokning.",
      }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const rutAmount = 0; // Ingen RUT i Fas A
    const totalPrice = bruttoPrice; // Netto = brutto för B2B/utan RUT
    const stripeAmountOre = Math.round(totalPrice * 100);

    // 7. Skapa booking
    const bookingId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + checkoutExpiresInHours * 60 * 60 * 1000);

    const { error: insertErr } = await sbService.from("bookings").insert({
      id: bookingId,
      customer_email: customerEmail,
      customer_name: customerName,
      customer_phone: customerPhone || null,
      customer_address: customerAddress,
      customer_type: customerType,
      service_type: serviceType,
      booking_date: bookingDate,
      booking_time: bookingTime,
      booking_hours: bookingHours,
      cleaner_id: cleaner.id,
      cleaner_name: cleaner.full_name,
      total_price: totalPrice,
      rut_amount: rutAmount,
      commission_pct: pricing.commissionPct,
      status: "pending",
      payment_status: "pending",
      created_by_admin: true,
      created_by_user_id: ctx.userId,
      checkout_link_expires_at: expiresAt.toISOString(),
      signing_method: "email",
    });
    if (insertErr) {
      log("error", "Booking insert failed", { error: insertErr.message });
      return new Response(JSON.stringify({ error: "insert_failed", detail: insertErr.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // 8. Stripe Checkout Session
    const STRIPE_KEY = await resolveStripeKey();
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("payment_method_types[]", "card");
    params.append("payment_method_types[]", "klarna");
    params.append("customer_email", customerEmail);
    params.append("expires_at", String(Math.floor(expiresAt.getTime() / 1000)));
    params.append("line_items[0][price_data][currency]", "sek");
    params.append("line_items[0][price_data][product_data][name]", `${serviceType} (${bookingHours}h) — Spick`);
    params.append("line_items[0][price_data][unit_amount]", String(stripeAmountOre));
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", `${BASE_URL}/tack.html?bid=${bookingId}&session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${BASE_URL}/mitt-konto.html?cancelled=${bookingId}`);
    params.append("metadata[booking_id]", bookingId);
    params.append("metadata[booking_type]", "manual");
    params.append("metadata[created_by_user_id]", ctx.userId);
    params.append("metadata[created_by_role]", ctx.role);

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `manual-booking-${bookingId}`,
      },
      body: params.toString(),
    });
    if (!stripeRes.ok) {
      const errBody = await stripeRes.text();
      log("error", "Stripe Checkout creation failed", { status: stripeRes.status, body: errBody.slice(0, 500) });
      // Rollback: ta bort booking
      await sbService.from("bookings").delete().eq("id", bookingId);
      return new Response(JSON.stringify({ error: "stripe_checkout_failed" }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const session = await stripeRes.json();

    // 9. Update booking med Stripe-info
    await sbService.from("bookings")
      .update({ stripe_session_id: session.id })
      .eq("id", bookingId);

    // 10. Skicka email till kund
    let emailSent = false;
    try {
      const emailHtml = buildEmailHtml({
        customerName,
        service: serviceType,
        date: bookingDate,
        time: bookingTime,
        hours: bookingHours,
        address: customerAddress,
        cleanerName: cleaner.full_name as string,
        totalPrice,
        checkoutUrl: session.url as string,
        expiresAt,
      });
      await sendEmail(customerEmail, `Bekräfta din ${serviceType.toLowerCase()}-bokning hos Spick`, emailHtml);
      emailSent = true;
    } catch (e) {
      log("warn", "Email send failed (non-fatal)", { error: (e as Error).message });
    }

    // 11. Logga event
    await logBookingEvent(sbService, bookingId, "booking_created", {
      actorType: ctx.role === "admin" ? "admin" : (ctx.role === "company_owner" ? "company_owner" : "system"),
      metadata: {
        service: serviceType,
        total_price: totalPrice,
        cleaner_id: cleaner.id,
        manual_booking: true,
        signing_method: "email",
        created_by_user_id: ctx.userId,
      },
    });

    log("info", "Manual booking created", {
      booking_id: bookingId,
      caller_role: ctx.role,
      total_price: totalPrice,
      checkout_expires_at: expiresAt.toISOString(),
      email_sent: emailSent,
    });

    return new Response(JSON.stringify({
      ok: true,
      booking_id: bookingId,
      checkout_url: session.url,
      checkout_session_id: session.id,
      checkout_expires_at: expiresAt.toISOString(),
      total_price: totalPrice,
      email_sent: emailSent,
    }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message, stack: (err as Error).stack?.slice(0, 500) });
    return new Response(JSON.stringify({ error: "internal_error", detail: (err as Error).message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
