// supabase/functions/_shared/escrow-state.ts
// ──────────────────────────────────────────────────────────────────
// Fas 8 §8.6: Escrow-state-machine + input-validering.
//
// SYFTE: Separerar pure state-machine-logik från HTTP-layern i
// escrow-state-transition EF så att logiken är unit-testbar utan
// supabase-client-beroende (top-level createClient i EF skulle
// kräva SERVICE_KEY i tests).
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §1.2
//
// ANVÄNDNING:
//   import { TRANSITIONS, validateInput } from "../_shared/escrow-state.ts";
//
// UTÖKNING:
//   1. Lägg till state i EscrowState
//   2. Lägg till action i EscrowAction
//   3. Uppdatera TRANSITIONS-map
//   4. UPDATE migration CHECK constraint bookings_escrow_state_check
//   5. Uppdatera tester
// ──────────────────────────────────────────────────────────────────

export type EscrowState =
  | "pending_payment"
  | "paid_held"
  | "awaiting_attest"
  | "released"
  | "released_partial"          // §8.22 (2026-04-25): efter partial-refund + transfer-rest
  | "disputed"
  | "resolved_full_refund"
  | "resolved_partial_refund"
  | "resolved_dismissed"
  | "refunded"
  | "cancelled"
  | "released_legacy";

export type EscrowAction =
  | "charge_succeeded"
  | "cancel_before_charge"
  | "job_completed"
  | "cancel_pre_service"
  | "customer_attest"
  | "auto_release_24h"
  | "dispute_open"
  | "admin_full_refund"
  | "admin_partial_refund"
  | "admin_dismiss"
  | "transfer_full_refund"
  | "transfer_partial_refund"   // §8.22 (2026-04-25)
  | "transfer_dismissed";

export type TriggeredBy =
  | "customer"
  | "cleaner"
  | "admin"
  | "system_timer"
  | "system_webhook";

export interface Transition {
  from: EscrowState[];
  to: EscrowState;
}

// Primärkälla: dispute-escrow-system.md §1.2.
// §8.22 (2026-04-25): transfer_partial_refund stänger partial-refund-flowen.
// Efter admin_partial_refund → resolved_partial_refund, refund-booking EF
// gör Stripe partial refund + transfer av rest till cleaner → därefter
// transfer_partial_refund-action sätter released_partial som terminal.
export const TRANSITIONS: Record<EscrowAction, Transition> = {
  charge_succeeded:        { from: ["pending_payment"],         to: "paid_held" },
  cancel_before_charge:    { from: ["pending_payment"],         to: "cancelled" },
  job_completed:           { from: ["paid_held"],               to: "awaiting_attest" },
  cancel_pre_service:      { from: ["paid_held"],               to: "refunded" },
  customer_attest:         { from: ["awaiting_attest"],         to: "released" },
  auto_release_24h:        { from: ["awaiting_attest"],         to: "released" },
  dispute_open:            { from: ["awaiting_attest"],         to: "disputed" },
  admin_full_refund:       { from: ["disputed"],                to: "resolved_full_refund" },
  admin_partial_refund:    { from: ["disputed"],                to: "resolved_partial_refund" },
  admin_dismiss:           { from: ["disputed"],                to: "resolved_dismissed" },
  transfer_full_refund:    { from: ["resolved_full_refund"],    to: "refunded" },
  transfer_partial_refund: { from: ["resolved_partial_refund"], to: "released_partial" },
  transfer_dismissed:      { from: ["resolved_dismissed"],      to: "released" },
};

export const VALID_TRIGGERED_BY: ReadonlyArray<TriggeredBy> = [
  "customer", "cleaner", "admin", "system_timer", "system_webhook",
];

export interface ValidatedInput {
  booking_id: string;
  action: EscrowAction;
  transition: Transition;
  triggered_by: TriggeredBy;
  triggered_by_id: string | null;
  metadata: Record<string, unknown>;
}

export type ValidationResult =
  | { ok: true; input: ValidatedInput }
  | { ok: false; error: string; details?: unknown };

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function validateInput(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;

  if (!isValidUuid(b.booking_id)) {
    return { ok: false, error: "invalid_booking_id" };
  }
  if (typeof b.action !== "string" || !(b.action in TRANSITIONS)) {
    return {
      ok: false,
      error: "invalid_action",
      details: { allowed: Object.keys(TRANSITIONS) },
    };
  }
  if (
    typeof b.triggered_by !== "string" ||
    !VALID_TRIGGERED_BY.includes(b.triggered_by as TriggeredBy)
  ) {
    return {
      ok: false,
      error: "invalid_triggered_by",
      details: { allowed: VALID_TRIGGERED_BY },
    };
  }
  if (
    b.triggered_by_id !== undefined &&
    b.triggered_by_id !== null &&
    !isValidUuid(b.triggered_by_id)
  ) {
    return { ok: false, error: "invalid_triggered_by_id" };
  }
  if (
    b.metadata !== undefined &&
    (typeof b.metadata !== "object" || Array.isArray(b.metadata))
  ) {
    return { ok: false, error: "invalid_metadata" };
  }

  const action = b.action as EscrowAction;
  return {
    ok: true,
    input: {
      booking_id: b.booking_id as string,
      action,
      transition: TRANSITIONS[action],
      triggered_by: b.triggered_by as TriggeredBy,
      triggered_by_id: (b.triggered_by_id as string | undefined) ?? null,
      metadata: (b.metadata as Record<string, unknown> | undefined) ?? {},
    },
  };
}
