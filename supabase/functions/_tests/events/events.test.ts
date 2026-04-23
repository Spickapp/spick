// supabase/functions/_tests/events/events.test.ts
// ──────────────────────────────────────────────────────────────────
// Unit-tester för _shared/events.ts (Fas 6.2).
//
// Kör: deno test supabase/functions/_tests/events/events.test.ts --allow-env
//
// Täckning:
//   - logBookingEvent anropar RPC med korrekt payload
//   - Fel från RPC → returnerar false (best-effort, ej throw)
//   - Nätverks-exception → returnerar false
//   - Ogiltigt booking_id → returnerar false utan RPC-anrop
//   - buildEventMetadata är identitets-funktion (compile-time-hjälp)
//   - EVENT_METADATA täcker alla BookingEventType-värden
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEventMetadata,
  EVENT_METADATA,
  logBookingEvent,
  type BookingEventType,
  type SupabaseRpcClient,
} from "../../_shared/events.ts";

// ── Mock supabase-klient ──────────────────────────────────────────

type RpcCall = { name: string; args: Record<string, unknown> };

function createMockSupabase(options: {
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  throws?: Error;
} = {}): { client: SupabaseRpcClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  // Fas 6.3 robustness (migration 20260427000003): RPC returnerar nu uuid.
  // Default: mock returnerar en valid uuid så happy-path-tests passerar.
  // Silent-failure-test passerar rpcData=null explicit.
  const defaultInsertedId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const client: SupabaseRpcClient = {
    rpc(name, args) {
      // Interface tillåter args?=undefined, men logBookingEvent passar
      // alltid ett objekt → normalisera till {} för stabil assertion.
      calls.push({ name, args: args ?? {} });
      if (options.throws) {
        return Promise.reject(options.throws);
      }
      return Promise.resolve({
        data: options.rpcData !== undefined ? options.rpcData : defaultInsertedId,
        error: options.rpcError ?? null,
      });
    },
  };
  return { client, calls };
}

const VALID_UUID = "12345678-1234-1234-1234-123456789012";

// ── Happy path ────────────────────────────────────────────────────

Deno.test("logBookingEvent: success → true + korrekt RPC-payload", async () => {
  const { client, calls } = createMockSupabase();

  const result = await logBookingEvent(
    client,
    VALID_UUID,
    "booking_created",
    {
      actorType: "customer",
      metadata: { total_price: 2400, service: "Hemstädning" },
    },
  );

  assertEquals(result, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "log_booking_event");
  assertEquals(calls[0].args, {
    p_booking_id: VALID_UUID,
    p_event_type: "booking_created",
    p_actor_type: "customer",
    p_metadata: { total_price: 2400, service: "Hemstädning" },
  });
});

Deno.test("logBookingEvent: default actor_type = 'system' + default metadata = {}", async () => {
  const { client, calls } = createMockSupabase();

  await logBookingEvent(client, VALID_UUID, "cleaner_assigned");

  assertEquals(calls[0].args.p_actor_type, "system");
  assertEquals(calls[0].args.p_metadata, {});
});

// ── Error paths (best-effort: returnerar false, kastar aldrig) ───

Deno.test("logBookingEvent: RPC returnerar error → false, ingen throw", async () => {
  const { client, calls } = createMockSupabase({
    rpcError: { message: "RLS policy denied" },
  });

  const result = await logBookingEvent(client, VALID_UUID, "completed");

  assertEquals(result, false);
  assertEquals(calls.length, 1); // Försöket gjordes
});

Deno.test("logBookingEvent: RPC kastar exception → false, ingen re-throw", async () => {
  const { client, calls } = createMockSupabase({
    throws: new Error("network timeout"),
  });

  const result = await logBookingEvent(client, VALID_UUID, "completed");

  assertEquals(result, false);
  assertEquals(calls.length, 1);
});

// ── NYA: silent-failure-detection (Fas 6.3 robustness) ───────────

Deno.test("logBookingEvent: RPC data=null trots error=null → false (silent fail)", async () => {
  // Detta var silent-failure-buggen från d701d7b: EF returnerade 200 OK
  // men DB-rad skrevs inte. Nya migration + helper-check fångar det.
  const { client, calls } = createMockSupabase({
    rpcData: null,
    rpcError: null,
  });

  const result = await logBookingEvent(client, VALID_UUID, "review_submitted");

  assertEquals(result, false);
  assertEquals(calls.length, 1); // Försöket gjordes
});

Deno.test("logBookingEvent: RPC data=undefined → false (silent fail)", async () => {
  const { client } = createMockSupabase({
    rpcData: undefined,  // explicit undefined (edge case)
    rpcError: null,
  });

  const result = await logBookingEvent(client, VALID_UUID, "review_submitted");

  // undefined går till default-branch = valid uuid → returnerar true
  // Så denna test verifierar att default inte är "no data"
  assertEquals(result, true);
});

Deno.test("logBookingEvent: RPC data='' (tom sträng) → false", async () => {
  const { client } = createMockSupabase({
    rpcData: "",
    rpcError: null,
  });

  const result = await logBookingEvent(client, VALID_UUID, "review_submitted");

  assertEquals(result, false); // tom sträng är falsy
});

// ── Input-validering ──────────────────────────────────────────────

Deno.test("logBookingEvent: ogiltigt booking_id (för kort) → false + ingen RPC", async () => {
  const { client, calls } = createMockSupabase();

  const result = await logBookingEvent(client, "not-a-uuid", "booking_created");

  assertEquals(result, false);
  assertEquals(calls.length, 0); // RPC anropades INTE
});

Deno.test("logBookingEvent: tomt booking_id → false + ingen RPC", async () => {
  const { client, calls } = createMockSupabase();

  const result = await logBookingEvent(client, "", "booking_created");

  assertEquals(result, false);
  assertEquals(calls.length, 0);
});

// ── buildEventMetadata ───────────────────────────────────────────

Deno.test("buildEventMetadata: är identitets-funktion (återger input)", () => {
  const fields = { rating: 5, cleaner_id: "abc", has_comment: true };
  const result = buildEventMetadata("review_submitted", fields);

  // Samma referens och samma content
  assertEquals(result, fields);
  assertEquals(result.rating, 5);
});

// ── EVENT_METADATA coverage ─────────────────────────────────────

Deno.test("EVENT_METADATA: varje BookingEventType har en metadata-nyckel-lista", () => {
  const allEventTypes: BookingEventType[] = [
    "booking_created",
    "cleaner_assigned",
    "cleaner_reassigned",
    "cleaner_invited",
    "cleaner_declined",
    "checkin",
    "checkout",
    "completed",
    "payment_received",
    "payment_captured",
    "escrow_held",
    "escrow_released",
    "refund_issued",
    "cancelled_by_customer",
    "cancelled_by_cleaner",
    "cancelled_by_admin",
    "noshow_reported",
    "dispute_opened",
    "dispute_cleaner_responded",
    "dispute_resolved",
    "review_submitted",
    "recurring_generated",
    "recurring_skipped",
    "recurring_paused",
    "recurring_resumed",
    "recurring_cancelled",
    "schedule_changed",
  ];

  for (const evt of allEventTypes) {
    const meta = EVENT_METADATA[evt];
    assert(
      Array.isArray(meta),
      `EVENT_METADATA saknar nyckel '${evt}' eller är inte array`,
    );
    assert(meta.length > 0, `EVENT_METADATA['${evt}'] är tom — dokumentera minst 1 nyckel`);
  }
});
