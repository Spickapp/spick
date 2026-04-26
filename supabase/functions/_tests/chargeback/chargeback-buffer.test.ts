// supabase/functions/_tests/chargeback/chargeback-buffer.test.ts
// ──────────────────────────────────────────────────────────────────
// Chargeback-buffer Etapp 1 (2026-04-26) — tester för helpers.
//
// Kör: deno test supabase/functions/_tests/chargeback/chargeback-buffer.test.ts --allow-env
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BUFFER_DEFAULT_PCT,
  BUFFER_DEFAULT_RELEASE_DAYS,
  consumeBufferForChargeback,
  getBufferPct,
  getBufferReleaseDays,
  getBufferStatus,
  isBufferEnabled,
  releaseExpiredReservations,
  reserveBufferForBooking,
  type SupabaseChargebackClient,
} from "../../_shared/chargeback-buffer.ts";

// ── Mock-helper ──

interface MockState {
  platform_settings: Array<Record<string, unknown>>;
  chargeback_buffer: Array<Record<string, unknown>>;
  chargeback_buffer_log: Array<Record<string, unknown>>;
  rpc_balance_after?: bigint;
  rpc_should_fail?: boolean;
}

function createMock(state: Partial<MockState>): { client: SupabaseChargebackClient; state: MockState } {
  const s: MockState = {
    platform_settings: state.platform_settings || [],
    chargeback_buffer: state.chargeback_buffer || [],
    chargeback_buffer_log: state.chargeback_buffer_log || [],
    rpc_balance_after: state.rpc_balance_after,
    rpc_should_fail: state.rpc_should_fail,
  };
  // deno-lint-ignore no-explicit-any
  const queryBuilder = (table: keyof MockState): any => {
    const filters: Record<string, unknown> = {};
    let inserting: Record<string, unknown> | null = null;
    let updating: Record<string, unknown> | null = null;
    const builder = {
      select() { return this; },
      eq(col: string, val: unknown) { filters[col] = val; return this; },
      maybeSingle() {
        if (inserting) {
          const row = { id: crypto.randomUUID(), ...inserting };
          (s[table] as Array<Record<string, unknown>>).push(row);
          return Promise.resolve({ data: row, error: null });
        }
        const rows = s[table] as Array<Record<string, unknown>>;
        const found = rows.find((r) => {
          for (const [k, v] of Object.entries(filters)) {
            if (r[k] !== v) return false;
          }
          return true;
        });
        return Promise.resolve({ data: found ?? null, error: null });
      },
      // deno-lint-ignore no-explicit-any
      insert(row: any) {
        inserting = row;
        return this;
      },
      // deno-lint-ignore no-explicit-any
      update(row: any) {
        updating = row;
        return {
          eq(col: string, val: unknown) {
            filters[col] = val;
            const rows = s[table] as Array<Record<string, unknown>>;
            const found = rows.find((r) => {
              for (const [k, v] of Object.entries(filters)) {
                if (r[k] !== v) return false;
              }
              return true;
            });
            if (found && updating) {
              Object.assign(found, updating);
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    return builder;
  };
  const client: SupabaseChargebackClient = {
    from(t: string) { return queryBuilder(t as keyof MockState); },
    rpc(_fn: string, _args?: Record<string, unknown>) {
      if (s.rpc_should_fail) {
        return Promise.resolve({ data: null, error: { message: "rpc_failed" } });
      }
      return Promise.resolve({ data: Number(s.rpc_balance_after ?? 0n), error: null });
    },
  };
  return { client, state: s };
}

// ── Konstanter ──

Deno.test("BUFFER_DEFAULT_PCT är 5", () => {
  assertEquals(BUFFER_DEFAULT_PCT, 5);
});

Deno.test("BUFFER_DEFAULT_RELEASE_DAYS är 180", () => {
  assertEquals(BUFFER_DEFAULT_RELEASE_DAYS, 180);
});

// ── Flag-läsning ──

Deno.test("isBufferEnabled: false default när flag saknas", async () => {
  const { client } = createMock({ platform_settings: [] });
  assertEquals(await isBufferEnabled(client), false);
});

Deno.test("isBufferEnabled: false när flag = 'false'", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "chargeback_buffer_enabled", value: "false" }],
  });
  assertEquals(await isBufferEnabled(client), false);
});

Deno.test("isBufferEnabled: true när flag = 'true'", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "chargeback_buffer_enabled", value: "true" }],
  });
  assertEquals(await isBufferEnabled(client), true);
});

Deno.test("getBufferPct: returnerar 5 default", async () => {
  const { client } = createMock({ platform_settings: [] });
  assertEquals(await getBufferPct(client), 5);
});

Deno.test("getBufferPct: returnerar konfigurerat värde", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "chargeback_buffer_pct", value: "7" }],
  });
  assertEquals(await getBufferPct(client), 7);
});

Deno.test("getBufferPct: ogiltigt värde → fallback default", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "chargeback_buffer_pct", value: "weird" }],
  });
  assertEquals(await getBufferPct(client), 5);
});

Deno.test("getBufferReleaseDays: returnerar 180 default", async () => {
  const { client } = createMock({ platform_settings: [] });
  assertEquals(await getBufferReleaseDays(client), 180);
});

Deno.test("getBufferReleaseDays: returnerar konfigurerat värde", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "chargeback_buffer_release_days", value: "90" }],
  });
  assertEquals(await getBufferReleaseDays(client), 90);
});

// ── reserveBufferForBooking ──

Deno.test("reserveBufferForBooking: no-op när flag är OFF", async () => {
  const { client } = createMock({ platform_settings: [] });
  const r = await reserveBufferForBooking({
    supabase: client,
    bookingId: "b1",
    companyId: "c1",
    cleanerShareOre: 88000n,
  });
  assertEquals(r.enabled, false);
  assertEquals(r.reserved_ore, 0n);
  assertEquals(r.transfer_ore, 88000n);
  assertEquals(r.reason, "buffer_disabled");
});

Deno.test("reserveBufferForBooking: 5% av 88000 öre = 4400 öre", async () => {
  const { client } = createMock({
    platform_settings: [
      { key: "chargeback_buffer_enabled", value: "true" },
      { key: "chargeback_buffer_pct", value: "5" },
    ],
    rpc_balance_after: 4400n,
  });
  const r = await reserveBufferForBooking({
    supabase: client,
    bookingId: "b1",
    companyId: "comp-1",
    cleanerShareOre: 88000n,
  });
  assertEquals(r.enabled, true);
  assertEquals(r.reserved_ore, 4400n);
  assertEquals(r.transfer_ore, 83600n);
  assertEquals(r.reason, "reserved");
});

Deno.test("reserveBufferForBooking: 5% av 88800 öre = 4440 öre (4.44 kr)", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "chargeback_buffer_enabled", value: "true" }],
    rpc_balance_after: 4440n,
  });
  const r = await reserveBufferForBooking({
    supabase: client,
    bookingId: "b2",
    cleanerId: "cleaner-1",
    cleanerShareOre: 88800n,
  });
  assertEquals(r.reserved_ore, 4440n);
  assertEquals(r.transfer_ore, 84360n);
});

Deno.test("reserveBufferForBooking: kastar vid både company OCH cleaner", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "chargeback_buffer_enabled", value: "true" }],
  });
  let threw = false;
  try {
    await reserveBufferForBooking({
      supabase: client,
      bookingId: "b1",
      companyId: "c1",
      cleanerId: "cl1",
      cleanerShareOre: 100n,
    });
  } catch (_) {
    threw = true;
  }
  assert(threw, "borde kasta XOR-fel");
});

Deno.test("reserveBufferForBooking: 7% pct OK", async () => {
  const { client } = createMock({
    platform_settings: [
      { key: "chargeback_buffer_enabled", value: "true" },
      { key: "chargeback_buffer_pct", value: "7" },
    ],
    rpc_balance_after: 7000n,
  });
  const r = await reserveBufferForBooking({
    supabase: client,
    bookingId: "b1",
    companyId: "c1",
    cleanerShareOre: 100000n,
  });
  assertEquals(r.reserved_ore, 7000n);
  assertEquals(r.transfer_ore, 93000n);
});

Deno.test("reserveBufferForBooking: amount_too_small när reserved=0", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "chargeback_buffer_enabled", value: "true" }],
  });
  const r = await reserveBufferForBooking({
    supabase: client,
    bookingId: "b1",
    companyId: "c1",
    cleanerShareOre: 5n, // 5% av 5 öre = 0 öre (avrundning)
  });
  assertEquals(r.reserved_ore, 0n);
  assertEquals(r.reason, "amount_too_small");
});

// ── Stubs Etapp 3-4 ──

Deno.test("releaseExpiredReservations: stub returnerar 0", async () => {
  const { client } = createMock({});
  const r = await releaseExpiredReservations(client);
  assertEquals(r.released_count, 0);
  assertEquals(r.total_released_ore, 0n);
});

Deno.test("consumeBufferForChargeback: stub returnerar 0", async () => {
  const { client } = createMock({});
  const r = await consumeBufferForChargeback({
    supabase: client,
    chargebackId: "cb1",
    bookingId: "b1",
    amountOre: 50000n,
  });
  assertEquals(r.consumed_ore, 0n);
  assertEquals(r.shortfall_ore, 0n);
  assertEquals(r.escalate_needed, false);
});

// ── getBufferStatus ──

Deno.test("getBufferStatus: returnerar tom när buffer ej finns", async () => {
  const { client } = createMock({ chargeback_buffer: [] });
  const r = await getBufferStatus({ supabase: client, companyId: "c1" });
  assertEquals(r.buffer_id, null);
  assertEquals(r.balance_ore, 0n);
});

Deno.test("getBufferStatus: returnerar data när buffer finns", async () => {
  const { client } = createMock({
    chargeback_buffer: [{
      id: "buf-1",
      company_id: "c1",
      balance_ore: 12500,
      total_reserved_lifetime_ore: 50000,
      total_released_lifetime_ore: 30000,
      total_consumed_lifetime_ore: 7500,
      last_reserved_at: "2026-04-15T10:00:00Z",
      last_released_at: null,
    }],
  });
  const r = await getBufferStatus({ supabase: client, companyId: "c1" });
  assertEquals(r.buffer_id, "buf-1");
  assertEquals(r.balance_ore, 12500n);
  assertEquals(r.total_reserved_lifetime_ore, 50000n);
  assertEquals(r.total_consumed_lifetime_ore, 7500n);
  assertEquals(r.last_reserved_at, "2026-04-15T10:00:00Z");
});

Deno.test("getBufferStatus: kastar vid både company OCH cleaner", async () => {
  const { client } = createMock({});
  let threw = false;
  try {
    await getBufferStatus({ supabase: client, companyId: "c1", cleanerId: "cl1" });
  } catch (_) {
    threw = true;
  }
  assert(threw);
});
