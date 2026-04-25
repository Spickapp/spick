// supabase/functions/_tests/escrow/state-transition.test.ts
// ──────────────────────────────────────────────────────────────────
// Unit-tester för escrow-state-transition state-machine (Fas 8 §8.6).
//
// Kör: deno test supabase/functions/_tests/escrow/state-transition.test.ts --allow-env
//
// Täckning:
//   - TRANSITIONS-map matchar arkitektur-docen §1.2
//   - validateInput accepterar korrekt shape
//   - validateInput avvisar ogiltig action/triggered_by/uuid/metadata
//   - Alla terminal-states är fria från transitions-out (no loop back)
//   - Alla from-states i TRANSITIONS finns i CHECK-constraint-listan
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  TRANSITIONS,
  VALID_TRIGGERED_BY,
  validateInput,
  type EscrowAction,
  type EscrowState,
} from "../../_shared/escrow-state.ts";

// CHECK-constraint-listan från migration 20260427000007 + §8.22 utökning
// (released_partial via 20260425XXXXXX_fas_8_22_released_partial.sql)
const VALID_STATES: EscrowState[] = [
  "pending_payment",
  "paid_held",
  "awaiting_attest",
  "released",
  "released_partial",          // §8.22 (2026-04-25)
  "disputed",
  "resolved_full_refund",
  "resolved_partial_refund",
  "resolved_dismissed",
  "refunded",
  "cancelled",
  "released_legacy",
];

// Terminal-states (inga transitions ut per design)
const TERMINAL_STATES: EscrowState[] = [
  "released",
  "released_partial",          // §8.22: terminal efter partial-refund + transfer
  "refunded",
  "cancelled",
  "released_legacy",
  // resolved_partial_refund borttagen från terminal-listan §8.22 — nu har
  // den transition ut via transfer_partial_refund → released_partial.
];

const baseValid = {
  booking_id: "abcdef01-1234-1234-1234-1234567890ab",
  action: "charge_succeeded" as EscrowAction,
  triggered_by: "system_webhook",
};

// ══════════════════════════════════════════════════════════════════
// State-machine integrity tests
// ══════════════════════════════════════════════════════════════════

Deno.test("TRANSITIONS: alla from-states finns i CHECK-constraint-listan", () => {
  for (const [action, t] of Object.entries(TRANSITIONS)) {
    for (const fromState of t.from) {
      assertEquals(
        VALID_STATES.includes(fromState),
        true,
        `Action ${action} has invalid from-state: ${fromState}`,
      );
    }
    assertEquals(
      VALID_STATES.includes(t.to),
      true,
      `Action ${action} has invalid to-state: ${t.to}`,
    );
  }
});

Deno.test("TRANSITIONS: terminal-states saknar transitions ut", () => {
  for (const terminal of TERMINAL_STATES) {
    for (const [action, t] of Object.entries(TRANSITIONS)) {
      if (t.from.includes(terminal)) {
        throw new Error(
          `Terminal state ${terminal} has transition out via action ${action} → ${t.to}`,
        );
      }
    }
  }
});

Deno.test("TRANSITIONS: charge_succeeded är enda vägen ut ur pending_payment + till paid_held", () => {
  assertEquals(TRANSITIONS.charge_succeeded.from, ["pending_payment"]);
  assertEquals(TRANSITIONS.charge_succeeded.to, "paid_held");
});

Deno.test("TRANSITIONS: dispute_open kräver awaiting_attest", () => {
  assertEquals(TRANSITIONS.dispute_open.from, ["awaiting_attest"]);
  assertEquals(TRANSITIONS.dispute_open.to, "disputed");
});

Deno.test("TRANSITIONS: 3 admin-beslut från disputed", () => {
  assertEquals(TRANSITIONS.admin_full_refund.from, ["disputed"]);
  assertEquals(TRANSITIONS.admin_partial_refund.from, ["disputed"]);
  assertEquals(TRANSITIONS.admin_dismiss.from, ["disputed"]);

  assertEquals(TRANSITIONS.admin_full_refund.to, "resolved_full_refund");
  assertEquals(TRANSITIONS.admin_partial_refund.to, "resolved_partial_refund");
  assertEquals(TRANSITIONS.admin_dismiss.to, "resolved_dismissed");
});

Deno.test("TRANSITIONS §8.22: transfer_partial_refund eskorterar resolved_partial_refund → released_partial", () => {
  assertEquals(TRANSITIONS.transfer_partial_refund.from, ["resolved_partial_refund"]);
  assertEquals(TRANSITIONS.transfer_partial_refund.to, "released_partial");
});

Deno.test("TRANSITIONS: transfer_full_refund eskorterar resolved_full_refund → refunded", () => {
  assertEquals(TRANSITIONS.transfer_full_refund.from, ["resolved_full_refund"]);
  assertEquals(TRANSITIONS.transfer_full_refund.to, "refunded");
});

Deno.test("TRANSITIONS: transfer_dismissed eskorterar resolved_dismissed → released", () => {
  assertEquals(TRANSITIONS.transfer_dismissed.from, ["resolved_dismissed"]);
  assertEquals(TRANSITIONS.transfer_dismissed.to, "released");
});

Deno.test("TRANSITIONS: customer_attest OCH auto_release_24h båda leder awaiting_attest → released", () => {
  assertEquals(TRANSITIONS.customer_attest.to, "released");
  assertEquals(TRANSITIONS.auto_release_24h.to, "released");
});

// ══════════════════════════════════════════════════════════════════
// validateInput tests
// ══════════════════════════════════════════════════════════════════

Deno.test("validateInput: minimal giltig input → ok", () => {
  const result = validateInput(baseValid);
  if (!result.ok) throw new Error(`Expected ok, got error: ${result.error}`);
  assertEquals(result.input.booking_id, baseValid.booking_id);
  assertEquals(result.input.action, "charge_succeeded");
  assertEquals(result.input.triggered_by, "system_webhook");
  assertEquals(result.input.triggered_by_id, null);
  assertEquals(result.input.metadata, {});
});

Deno.test("validateInput: full input med metadata + triggered_by_id → ok", () => {
  const input = {
    ...baseValid,
    triggered_by_id: "11111111-1111-1111-1111-111111111111",
    metadata: { stripe_session: "cs_test_abc" },
  };
  const result = validateInput(input);
  if (!result.ok) throw new Error(`Expected ok, got error: ${result.error}`);
  assertEquals(result.input.triggered_by_id, input.triggered_by_id);
  assertEquals(result.input.metadata, { stripe_session: "cs_test_abc" });
});

Deno.test("validateInput: booking_id inte uuid → invalid_booking_id", () => {
  const result = validateInput({ ...baseValid, booking_id: "not-a-uuid" });
  if (result.ok) throw new Error("Expected fail");
  assertEquals(result.error, "invalid_booking_id");
});

Deno.test("validateInput: action ej i TRANSITIONS → invalid_action", () => {
  const result = validateInput({ ...baseValid, action: "fake_action" });
  if (result.ok) throw new Error("Expected fail");
  assertEquals(result.error, "invalid_action");
  assertExists(result.details);
});

Deno.test("validateInput: triggered_by ogiltig → invalid_triggered_by", () => {
  const result = validateInput({ ...baseValid, triggered_by: "robot" });
  if (result.ok) throw new Error("Expected fail");
  assertEquals(result.error, "invalid_triggered_by");
});

Deno.test("validateInput: alla 5 triggered_by-värden accepteras", () => {
  for (const tb of VALID_TRIGGERED_BY) {
    const result = validateInput({ ...baseValid, triggered_by: tb });
    if (!result.ok) {
      throw new Error(`Expected ok for triggered_by=${tb}, got: ${result.error}`);
    }
  }
});

Deno.test("validateInput: triggered_by_id not-uuid när satt → invalid_triggered_by_id", () => {
  const result = validateInput({ ...baseValid, triggered_by_id: "not-uuid" });
  if (result.ok) throw new Error("Expected fail");
  assertEquals(result.error, "invalid_triggered_by_id");
});

Deno.test("validateInput: metadata som array → invalid_metadata", () => {
  const result = validateInput({ ...baseValid, metadata: [] });
  if (result.ok) throw new Error("Expected fail");
  assertEquals(result.error, "invalid_metadata");
});

Deno.test("validateInput: null body → invalid_body", () => {
  const result = validateInput(null);
  if (result.ok) throw new Error("Expected fail");
  assertEquals(result.error, "invalid_body");
});

Deno.test("validateInput: saknar action → invalid_action", () => {
  const result = validateInput({ booking_id: baseValid.booking_id, triggered_by: "admin" });
  if (result.ok) throw new Error("Expected fail");
  assertEquals(result.error, "invalid_action");
});
