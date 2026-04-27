// charge-subscription-booking — Debiterar sparade kort dagen innan städning
// ═══════════════════════════════════════════════════════════════════════════
// Triggas dagligen 20:00 CET via GitHub Actions
//
// Flöde:
//   1. Hitta bookings: payment_mode='stripe_subscription', status='awaiting_charge',
//      booking_date <= imorgon, attempts < 3
//   2. Per bokning:
//      - Hämta customer_profile (stripe_customer_id + default_payment_method_id)
//      - Hämta Connect-destination (cleaner → ev. company owner)
//      - Skapa PaymentIntent off-session
//      - Hantera succeeded → markera paid + email
//      - Hantera failed → öka attempts, vid 3 försök → pausa sub
//   3. Returnera sammanfattning
//
// Kopplar till:
//   - auto-rebook EF (FAS 6) — skapar bokningar med payment_status='awaiting_charge'
//   - stripe-webhook — hanterar charge.succeeded / charge.failed events

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log, sendEmail, wrap, card } from "../_shared/email.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY")!;
const BASE_URL     = Deno.env.get("BASE_URL") || "https://spick.se";

// Fel som INTE är värda att försöka igen
const NO_RETRY_ERRORS = new Set(["expired_card", "authentication_required"]);

serve(withSentry("charge-subscription-booking", async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Security-audit-fix 2026-04-26: kräv CRON_SECRET (var helt öppen,
  // anyone kunde trigga off-session card-debiteringar via anon-key)
  const auth = requireCronAuth(req, CORS);
  if (!auth.ok) return auth.response!;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const json = (s: number, d: unknown) => new Response(JSON.stringify(d), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

  try {
    await req.json().catch(() => ({}));

    // Måldatum: imorgon (fånga även missade tidigare om cron varit nere)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const targetDate = tomorrow.toISOString().slice(0, 10);

    log("info", "charge-sub", "Starting", { targetDate });

    // Hämta bokningar som behöver debiteras
    const { data: bookings, error: fetchErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("payment_mode", "stripe_subscription")
      .eq("payment_status", "awaiting_charge")
      .lte("booking_date", targetDate)
      .lt("subscription_charge_attempts", 3);

    if (fetchErr) {
      log("error", "charge-sub", "Fetch failed", { error: fetchErr.message });
      return json(500, { error: fetchErr.message });
    }

    if (!bookings || bookings.length === 0) {
      log("info", "charge-sub", "No bookings to charge", { targetDate });
      return json(200, { processed: 0, date: targetDate });
    }

    const results: Array<Record<string, unknown>> = [];

    for (const booking of bookings) {
      try {
        const result = await chargeBooking(supabase, booking);
        results.push({ booking_id: booking.id, ...result });
      } catch (e: unknown) {
        const msg = (e as Error).message || "Unknown error";
        log("error", "charge-sub", `Exception for booking ${booking.id}`, { error: msg });
        results.push({ booking_id: booking.id, status: "error", error: msg });
      }
    }

    const summary = {
      processed: results.length,
      succeeded: results.filter((r) => r.status === "paid").length,
      failed: results.filter((r) => r.status === "failed" || r.status === "retry").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      date: targetDate,
      results,
    };

    log("info", "charge-sub", "Complete", {
      processed: summary.processed,
      succeeded: summary.succeeded,
      failed: summary.failed,
      skipped: summary.skipped,
    });

    return json(200, summary);
  } catch (err: unknown) {
    log("error", "charge-sub", "Fatal", { error: (err as Error).message });
    return json(500, { error: (err as Error).message });
  }
}));

// ── Hämta Connect-destination för bokningen ──────────────────
async function getConnectDestination(
  supabase: ReturnType<typeof createClient>,
  cleanerId: string,
): Promise<{ destinationAccountId: string | null }> {
  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("stripe_account_id, stripe_onboarding_status, company_id, is_company_owner")
    .eq("id", cleanerId)
    .maybeSingle();

  if (!cleaner) return { destinationAccountId: null };

  // Teammedlem (inte företagsägare) → pengar till VD
  if (cleaner.company_id && !cleaner.is_company_owner) {
    const { data: owner } = await supabase
      .from("cleaners")
      .select("stripe_account_id, stripe_onboarding_status")
      .eq("company_id", cleaner.company_id)
      .eq("is_company_owner", true)
      .maybeSingle();
    if (owner?.stripe_account_id && owner.stripe_onboarding_status === "complete") {
      return { destinationAccountId: owner.stripe_account_id };
    }
    return { destinationAccountId: null };
  }

  // Solo-städare eller företagsägare själv
  if (cleaner.stripe_account_id && cleaner.stripe_onboarding_status === "complete") {
    return { destinationAccountId: cleaner.stripe_account_id };
  }
  return { destinationAccountId: null };
}

// ── Processa debitering av en bokning ────────────────────────
async function chargeBooking(
  supabase: ReturnType<typeof createClient>,
  booking: Record<string, unknown>,
) {
  const bookingId = booking.id as string;
  const customerEmail = booking.customer_email as string;
  const attempts = (booking.subscription_charge_attempts as number) || 0;
  const subscriptionId = booking.subscription_id as string | null;

  // 1. Hämta customer_profile (stripe_customer_id + default_payment_method_id)
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("stripe_customer_id, default_payment_method_id, payment_method_last4")
    .eq("email", customerEmail)
    .maybeSingle();

  if (!profile?.stripe_customer_id || !profile?.default_payment_method_id) {
    log("warn", "charge-sub", "Missing payment setup", {
      booking_id: bookingId,
      email: customerEmail,
    });
    await supabase.from("bookings").update({
      payment_status: "failed",
      subscription_charge_attempts: attempts + 1,
      subscription_charge_failed_at: new Date().toISOString(),
    }).eq("id", bookingId);
    return { status: "skipped", reason: "no_payment_method" };
  }

  const chargeAmount = Math.round(Number(booking.total_price) || 0);

  // Helt kredit-betald bokning
  if (chargeAmount <= 0) {
    await supabase.from("bookings").update({
      payment_status: "paid",
      confirmed_at: booking.confirmed_at || new Date().toISOString(),
    }).eq("id", bookingId);
    return { status: "paid", reason: "zero_amount", amount: 0 };
  }

  // 2. Hämta Connect-destination
  const cleanerId = booking.cleaner_id as string;
  const { destinationAccountId } = await getConnectDestination(supabase, cleanerId);

  // 3. Beräkna provision
  const amountOre = chargeAmount * 100;
  const commissionPct = Number(booking.commission_pct) || 17;
  const commissionRate = commissionPct / 100;
  const applicationFee = Math.round(amountOre * commissionRate);

  // 4. Skapa Stripe PaymentIntent (off-session, confirm=true)
  const piParams = new URLSearchParams();
  piParams.append("amount", String(amountOre));
  piParams.append("currency", "sek");
  piParams.append("customer", profile.stripe_customer_id);
  piParams.append("payment_method", profile.default_payment_method_id);
  piParams.append("off_session", "true");
  piParams.append("confirm", "true");
  piParams.append("metadata[booking_id]", bookingId);
  if (subscriptionId) {
    piParams.append("metadata[subscription_id]", subscriptionId);
  }
  piParams.append("metadata[type]", "subscription_charge");
  piParams.append("statement_descriptor", "SPICK STADNING");

  if (destinationAccountId) {
    piParams.append("transfer_data[destination]", destinationAccountId);
    piParams.append("application_fee_amount", String(applicationFee));
  }

  // R3 (§13.3): idempotency-key förhindrar dubbeldebitering vid cron-retry
  // attempt+1 i key → nästa retry får ny key om denna sluträknas som failed
  const idempotencyKey = `pi-sub-${bookingId}-attempt-${attempts + 1}`;
  const piRes = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: piParams.toString(),
  });
  const pi = await piRes.json();
  const newAttempts = attempts + 1;

  // 5a. LYCKAT
  if (piRes.ok && pi.status === "succeeded") {
    // P1 Race Fix #3: atomisk dubbeluppdatering via commit_subscription_charge RPC
    // Ersätter 2 separate UPDATEs med 1 transaktion + idempotency-guard
    // (förhindrar duplicate charge om cron-retry sker innan payment_status hinner sparas).
    // Ref: migration 20260426350001 (Agent A + C audit).
    const nowIso = new Date().toISOString();
    const confirmedAt = (booking.confirmed_at as string) || nowIso;

    if (subscriptionId) {
      const { data: chargeResult, error: chargeErr } = await supabase.rpc(
        "commit_subscription_charge",
        {
          p_booking_id: bookingId,
          p_subscription_id: subscriptionId,
          p_payment_status: "paid",
          p_stripe_payment_intent_id: pi.id,
          p_confirmed_at: confirmedAt,
          p_last_charge_success_at: nowIso,
        },
      );

      if (chargeErr) {
        log("error", "charge-sub", "commit_subscription_charge RPC failed", {
          booking_id: bookingId,
          subscription_id: subscriptionId,
          error: chargeErr.message,
        });
        // Hård fail: vi har redan dragit pengarna i Stripe — returnera error-status
        // så cron-retry inte triggar dubbeldebitering. Manuell intervention krävs
        // (jfr Stripe Dashboard payment_intents.list för pi.id för att refunda).
        return {
          status: "error",
          error: `commit_failed_after_stripe_charge: ${chargeErr.message}`,
          pi_id: pi.id,
          amount: chargeAmount,
        };
      }

      if (chargeResult?.[0]?.idempotent) {
        log("info", "charge-sub", "Charge already committed (idempotency-skip)", {
          booking_id: bookingId,
          subscription_id: subscriptionId,
        });
      }

      // subscription_charge_attempts ingår ej i RPC-spec — uppdatera separat.
      // Best-effort; ej kritisk för transaktion (cron-filter använder den i nästa run).
      await supabase.from("bookings").update({
        subscription_charge_attempts: newAttempts,
      }).eq("id", bookingId);
    } else {
      // Ingen subscription_id (manuell engångsbokning?) — kör legacy 1-step UPDATE
      await supabase.from("bookings").update({
        payment_status: "paid",
        stripe_payment_intent_id: pi.id,
        subscription_charge_attempts: newAttempts,
        confirmed_at: confirmedAt,
      }).eq("id", bookingId);
    }

    // Email: Betalning lyckad
    try {
      await sendChargeSuccessEmail(booking, profile.payment_method_last4, chargeAmount);
    } catch (e) {
      log("warn", "charge-sub", "Success email failed", {
        booking_id: bookingId,
        error: (e as Error).message,
      });
    }

    log("info", "charge-sub", "Charge succeeded", {
      booking_id: bookingId,
      amount: chargeAmount,
      pi_id: pi.id,
    });
    return { status: "paid", amount: chargeAmount, pi_id: pi.id };
  }

  // 5b. MISSLYCKAT
  const errorCode = pi?.last_payment_error?.code
    || pi?.error?.code
    || pi?.code
    || "unknown_error";
  const errorMessage = pi?.last_payment_error?.message
    || pi?.error?.message
    || "Unknown Stripe error";

  log("warn", "charge-sub", "Charge failed", {
    booking_id: bookingId,
    attempt: newAttempts,
    error_code: errorCode,
    error_message: errorMessage,
  });

  const isNoRetry = NO_RETRY_ERRORS.has(errorCode);
  const isFinal = newAttempts >= 3 || isNoRetry;

  if (isFinal) {
    // Ge upp — markera failed, pausa subscription
    await supabase.from("bookings").update({
      payment_status: "failed",
      subscription_charge_attempts: newAttempts,
      subscription_charge_failed_at: new Date().toISOString(),
    }).eq("id", bookingId);

    if (subscriptionId) {
      await supabase.from("subscriptions").update({
        status: "paused",
        paused_at: new Date().toISOString(),
        pause_reason: isNoRetry ? `payment_failed_${errorCode}` : "payment_failed_3x",
        last_charge_attempt_at: new Date().toISOString(),
        consecutive_failures: (Number(booking.consecutive_failures) || 0) + 1,
      }).eq("id", subscriptionId);
    }

    try {
      await sendChargeFinalFailureEmail(booking, profile.payment_method_last4);
    } catch (e) {
      log("warn", "charge-sub", "Final-failure email failed", {
        booking_id: bookingId,
        error: (e as Error).message,
      });
    }

    return { status: "failed", error_code: errorCode, attempt: newAttempts };
  }

  // Retry möjlig — behåll awaiting_charge
  await supabase.from("bookings").update({
    payment_status: "awaiting_charge",
    subscription_charge_attempts: newAttempts,
    subscription_charge_failed_at: new Date().toISOString(),
  }).eq("id", bookingId);

  if (subscriptionId) {
    await supabase.from("subscriptions").update({
      last_charge_attempt_at: new Date().toISOString(),
      consecutive_failures: (Number(booking.consecutive_failures) || 0) + 1,
    }).eq("id", subscriptionId);
  }

  try {
    await sendChargeRetryEmail(booking, profile.payment_method_last4);
  } catch (e) {
    log("warn", "charge-sub", "Retry email failed", {
      booking_id: bookingId,
      error: (e as Error).message,
    });
  }

  return { status: "retry", error_code: errorCode, attempt: newAttempts };
}

// ── Hjälp: hämta företagsnamn ────────────────────────────────
async function fetchCompanyName(
  supabase: ReturnType<typeof createClient>,
  cleanerId: string,
): Promise<string> {
  try {
    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("company_id")
      .eq("id", cleanerId)
      .maybeSingle();
    if (cleaner?.company_id) {
      const { data: co } = await supabase
        .from("companies")
        .select("display_name, name")
        .eq("id", cleaner.company_id)
        .maybeSingle();
      if (co) return (co.display_name || co.name) as string;
    }
  } catch {
    // ignore
  }
  return "Spick";
}

// ── Email: Betalning lyckad ──────────────────────────────────
async function sendChargeSuccessEmail(
  booking: Record<string, unknown>,
  last4: string | null | undefined,
  amount: number,
) {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const firstName = ((booking.customer_name as string) || "").split(" ")[0] || "Kund";
  const service = (booking.service_type as string) || "Hemstädning";
  const hours = (booking.booking_hours as number) || 3;
  const bookingDate = booking.booking_date as string;
  const bookingTime = (booking.booking_time as string) || "09:00";
  const companyName = await fetchCompanyName(supabase, booking.cleaner_id as string);
  const cardText = last4 ? `[•••• ${last4}]` : "ditt sparade kort";

  const dateObj = new Date(bookingDate + "T00:00:00");
  const dateStr = dateObj.toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const html = wrap(`
    <h2>Betalning genomförd ✅</h2>
    <p>Hej ${firstName}!</p>
    <p>Vi har debiterat ${cardText} för din städning imorgon.</p>
    ${
    card([
      ["Tjänst", service + " · " + hours + " tim"],
      ["Datum", dateStr],
      ["Tid", bookingTime],
      ["Adress", (booking.customer_address as string) || "—"],
      ["Utförs av", companyName],
      ["Belopp debiterat", amount + " kr"],
    ])
  }
    <p>Din städning utförs imorgon som planerat. Behöver du ändra något? <a href="${BASE_URL}/mitt-konto.html" style="color:#0F6E56">Mitt konto</a></p>
  `);

  await sendEmail(
    booking.customer_email as string,
    "Betalning genomförd — din städning imorgon",
    html,
  );
}

// ── Email: Misslyckad (retry möjlig) ─────────────────────────
async function sendChargeRetryEmail(
  booking: Record<string, unknown>,
  last4: string | null | undefined,
) {
  const firstName = ((booking.customer_name as string) || "").split(" ")[0] || "Kund";
  const cardText = last4 ? `[•••• ${last4}]` : "ditt sparade kort";

  const html = wrap(`
    <h2>Betalningen kunde inte genomföras</h2>
    <p>Hej ${firstName}!</p>
    <p>Vi kunde inte debitera ${cardText} för din kommande städning hos <strong>Spick</strong>.</p>
    <p>Vi försöker igen inom 24 timmar.</p>
    <p style="font-size:13px;color:#6B6960;margin-top:16px">Om problemet kvarstår kan du behöva uppdatera ditt betalkort. Kontakta <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> så hjälper vi dig.</p>
  `);

  await sendEmail(
    booking.customer_email as string,
    "Betalningen kunde inte genomföras — Spick",
    html,
  );
}

// ── Email: Final misslyckad (pausa prenumeration) ────────────
async function sendChargeFinalFailureEmail(
  booking: Record<string, unknown>,
  last4: string | null | undefined,
) {
  const firstName = ((booking.customer_name as string) || "").split(" ")[0] || "Kund";
  const cardText = last4 ? `[•••• ${last4}]` : "ditt sparade kort";
  const bookingDate = booking.booking_date as string;

  const dateObj = new Date(bookingDate + "T00:00:00");
  const dateStr = dateObj.toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const html = wrap(`
    <h2>Din prenumeration har pausats</h2>
    <p>Hej ${firstName}!</p>
    <p>Vi kunde tyvärr inte debitera ${cardText} efter 3 försök.</p>
    <p>Din städning <strong>${dateStr}</strong> är därför inställd och din prenumeration är pausad.</p>
    <p>För att återuppta prenumerationen behöver du uppdatera ditt betalkort. Kontakta oss på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> så hjälper vi dig komma igång igen.</p>
    <p style="font-size:13px;color:#6B6960;margin-top:16px">Vi ber om ursäkt för besväret.</p>
  `);

  await sendEmail(
    booking.customer_email as string,
    "Din prenumeration har pausats — Spick",
    html,
  );
}
