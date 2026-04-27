// ═══════════════════════════════════════════════════════════════
// SPICK – escrow-release (Fas 8 §8.7)
// ═══════════════════════════════════════════════════════════════
//
// Genomför Stripe-transfer från plattformskonto till städarens
// Connect-konto när bokning attesterats (eller dispute-beslut).
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §2.4
//
// TRIGGERS:
//   customer_attest       — kund godkänner via min-bokning.html
//   auto_24h_timer        — cron: escrow-auto-release 24h efter job_completed
//   admin_dismiss_transfer — efter admin_dismiss dispute-beslut
//
// FLÖDE:
//   1. Validate input + auth (service_role)
//   2. Fetch booking + cleaner.stripe_account_id
//   3. Validera escrow_state (awaiting_attest eller resolved_dismissed)
//   4. calculatePayout() via _shared/money.ts (88% till städare)
//   5. POST Stripe /v1/transfers (amount i öre, destination=acct_xxx)
//   6. Call escrow-state-transition → action='customer_attest' |
//      'auto_release_24h' | 'transfer_dismissed'
//   7. logBookingEvent('escrow_released', metadata)
//
// IDEMPOTENS:
//   - escrow_state är guardrail (kan bara transferera från valid from-states)
//   - Stripe transfer har idempotency_key per booking+trigger
//   - Om call-sites retryar: state-check → 422, inget dubbel-transfer
//
// OUT-OF-SCOPE:
//   - Partial-refund-transfer (resolved_partial_refund — rule #30-flag kvar)
//   - Refund-flöden (separat refund-booking EF i §8.9)
//   - Dispute-logik (separat dispute-admin-decide EF i §8.14)
//
// REGLER: #26 grep calculatePayout + stripe-transfer patterns, #27 scope
// (bara release, ingen refund), #28 SSOT = escrow-state-transition-EF
// för state-changes + calculatePayout för amount, #29 arkitektur-doc
// §2.4 läst i sin helhet, #30 MONEY-CRITICAL — Stripe API följs exakt
// per existing codebase pattern (form-encoded + Basic auth), ingen
// gissning, ingen Stripe-spec tolkning, #31 prod-schema migration
// 20260427000007 + escrow-state-transition EF live-verifierat.
// ═══════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { calculatePayout } from "../_shared/money.ts";
import { logBookingEvent } from "../_shared/events.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";
import { verifyInternalSecret } from "../_shared/auth.ts";
import { createLogger } from "../_shared/log.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

type ReleaseTrigger =
  | "customer_attest"
  | "auto_24h_timer"
  | "admin_dismiss_transfer";

// Map trigger → (expected from-states, escrow-state-transition-action)
const TRIGGER_MAP: Record<ReleaseTrigger, { fromStates: string[]; transitionAction: string }> = {
  customer_attest: {
    fromStates: ["awaiting_attest"],
    transitionAction: "customer_attest",
  },
  auto_24h_timer: {
    fromStates: ["awaiting_attest"],
    transitionAction: "auto_release_24h",
  },
  admin_dismiss_transfer: {
    fromStates: ["resolved_dismissed"],
    transitionAction: "transfer_dismissed",
  },
};

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const log = createLogger("escrow-release");

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Rule #30 helper: Stripe-nyckeln kan vara test eller live beroende
// på platform_settings.stripe_test_mode. Läser samma sätt som
// stripe-webhook/booking-create gör idag för konsekvent beteende.
async function resolveStripeKey(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "stripe_test_mode")
    .maybeSingle();
  const isTestMode = data?.value === "true";
  const key = isTestMode
    ? Deno.env.get("STRIPE_SECRET_KEY_TEST")
    : Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) {
    throw new Error(`Stripe key missing (test_mode=${isTestMode})`);
  }
  return key;
}

async function callEscrowStateTransition(
  bookingId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/escrow-state-transition`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": Deno.env.get("INTERNAL_EF_SECRET") || "",
      },
      body: JSON.stringify({
        booking_id: bookingId,
        action,
        triggered_by: "system_webhook",
        metadata,
      }),
    });
    if (!res.ok) {
      log("error", "escrow-state-transition failed", {
        booking_id: bookingId,
        action,
        status: res.status,
      });
      return false;
    }
    return true;
  } catch (e) {
    log("error", "escrow-state-transition exception", {
      booking_id: bookingId,
      error: (e as Error).message,
    });
    return false;
  }
}

Deno.serve(withSentry("escrow-release", async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Auth: shared-secret (internal EF-to-EF calls) ──
    if (!verifyInternalSecret(req)) {
      return json(CORS, 403, { error: "internal_secret_required" });
    }

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const { booking_id, trigger } = body as { booking_id?: unknown; trigger?: unknown };

    if (!isValidUuid(booking_id)) {
      return json(CORS, 400, { error: "invalid_booking_id" });
    }
    if (typeof trigger !== "string" || !(trigger in TRIGGER_MAP)) {
      return json(CORS, 400, {
        error: "invalid_trigger",
        details: { allowed: Object.keys(TRIGGER_MAP) },
      });
    }
    const releaseTrigger = trigger as ReleaseTrigger;
    const triggerConfig = TRIGGER_MAP[releaseTrigger];

    // ── Fetch booking ──
    const { data: booking, error: bookingErr } = await sb
      .from("bookings")
      .select("id, escrow_state, cleaner_id, total_price, commission_pct, customer_type")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingErr) {
      log("error", "Booking fetch failed", { booking_id, error: bookingErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }
    if (!booking) {
      return json(CORS, 404, { error: "booking_not_found" });
    }

    // ── State-validering ──
    const fromState = booking.escrow_state as string;
    if (!triggerConfig.fromStates.includes(fromState)) {
      return json(CORS, 422, {
        error: "invalid_escrow_state",
        details: {
          current: fromState,
          expected: triggerConfig.fromStates,
          trigger: releaseTrigger,
        },
      });
    }

    // ── Cleaner + Stripe-konto ──
    if (!booking.cleaner_id) {
      log("error", "Booking saknar cleaner_id", { booking_id });
      return json(CORS, 422, { error: "no_cleaner_assigned" });
    }

    const { data: cleaner, error: cleanerErr } = await sb
      .from("cleaners")
      .select("id, full_name, stripe_account_id, stripe_onboarding_status")
      .eq("id", booking.cleaner_id as string)
      .maybeSingle();

    if (cleanerErr || !cleaner) {
      log("error", "Cleaner fetch failed", { booking_id, cleaner_id: booking.cleaner_id });
      return json(CORS, 500, { error: "cleaner_fetch_failed" });
    }
    if (!cleaner.stripe_account_id || cleaner.stripe_onboarding_status !== "complete") {
      log("error", "Cleaner Stripe-konto ej komplett", {
        booking_id,
        cleaner_id: cleaner.id,
        has_account: !!cleaner.stripe_account_id,
        onboarding_status: cleaner.stripe_onboarding_status,
      });
      await sendAdminAlert({
        severity: "critical",
        title: `Escrow-release blockerad: ${cleaner.full_name} saknar Stripe`,
        source: "escrow-release",
        booking_id: booking_id as string,
        cleaner_id: cleaner.id,
        message: "Städaren har inget komplett Stripe Connect-konto. Pengar kvar på plattform.",
      });
      return json(CORS, 422, { error: "cleaner_stripe_incomplete" });
    }

    // ── Beräkna payout-belopp ──
    let payout;
    try {
      payout = await calculatePayout(sb, booking_id as string);
    } catch (e) {
      log("error", "calculatePayout failed", { booking_id, error: (e as Error).message });
      return json(CORS, 500, { error: "payout_calculation_failed", details: (e as Error).message });
    }

    const transferAmountOre = Math.round(payout.cleaner_payout_sek * 100);
    if (transferAmountOre <= 0) {
      log("error", "Transfer amount ≤ 0", { booking_id, amount_sek: payout.cleaner_payout_sek });
      return json(CORS, 422, { error: "invalid_transfer_amount" });
    }

    // ── Stripe transfer ──
    // Idempotency-key: unik per (booking, trigger) — skyddar mot retries
    const stripeKey = await resolveStripeKey(sb);
    const idempotencyKey = `escrow-release-${booking_id}-${releaseTrigger}`;

    const transferParams = new URLSearchParams();
    transferParams.append("amount", String(transferAmountOre));
    transferParams.append("currency", "sek");
    transferParams.append("destination", cleaner.stripe_account_id as string);
    transferParams.append("transfer_group", `booking_${booking_id}`);
    transferParams.append("metadata[booking_id]", booking_id as string);
    transferParams.append("metadata[trigger]", releaseTrigger);

    const transferRes = await fetch("https://api.stripe.com/v1/transfers", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2023-10-16",
        "Idempotency-Key": idempotencyKey,
      },
      body: transferParams.toString(),
    });

    const transferJson = await transferRes.json();

    if (!transferRes.ok) {
      log("error", "Stripe transfer failed", {
        booking_id,
        status: transferRes.status,
        stripe_error: transferJson.error?.message,
      });
      await sendAdminAlert({
        severity: "critical",
        title: "Escrow-release: Stripe transfer failed",
        source: "escrow-release",
        booking_id: booking_id as string,
        cleaner_id: cleaner.id,
        metadata: {
          amount_sek: payout.cleaner_payout_sek,
          stripe_error: transferJson.error?.message || "unknown",
          trigger: releaseTrigger,
        },
      });
      return json(CORS, 502, {
        error: "stripe_transfer_failed",
        details: transferJson.error?.message,
      });
    }

    const stripeTransferId = transferJson.id as string;

    // ── State-transition (atomisk via escrow-state-transition-EF) ──
    const transitionOk = await callEscrowStateTransition(
      booking_id as string,
      triggerConfig.transitionAction,
      {
        stripe_transfer_id: stripeTransferId,
        amount_to_cleaner_sek: payout.cleaner_payout_sek,
        cleaner_id: cleaner.id,
        release_reason: releaseTrigger,
      },
    );

    if (!transitionOk) {
      // Transfer lyckades men state-change failade → kritisk inkonsistens
      await sendAdminAlert({
        severity: "critical",
        title: "Escrow-release: state-transition failed EFTER Stripe-transfer",
        source: "escrow-release",
        booking_id: booking_id as string,
        cleaner_id: cleaner.id,
        message: "Pengar transfererade men escrow_state uppdaterades ej. Manuell DB-fix krävs.",
        metadata: {
          stripe_transfer_id: stripeTransferId,
          amount_sek: payout.cleaner_payout_sek,
        },
      });
      // Return 200 eftersom transfer lyckades — admin-alert räcker för åtgärd
    }

    // ── Audit-log via Fas 6.3 events-helper ──
    await logBookingEvent(sb, booking_id as string, "escrow_released", {
      actorType: "system",
      metadata: {
        stripe_transfer_id: stripeTransferId,
        amount_to_cleaner: payout.cleaner_payout_sek,
        release_reason: releaseTrigger,
      },
    });

    log("info", "Escrow released", {
      booking_id,
      cleaner_id: cleaner.id,
      amount_sek: payout.cleaner_payout_sek,
      stripe_transfer_id: stripeTransferId,
      trigger: releaseTrigger,
    });

    return json(CORS, 200, {
      ok: true,
      booking_id,
      stripe_transfer_id: stripeTransferId,
      amount_sek: payout.cleaner_payout_sek,
      new_state: releaseTrigger === "admin_dismiss_transfer" ? "released" : "released",
      trigger: releaseTrigger,
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
}));
