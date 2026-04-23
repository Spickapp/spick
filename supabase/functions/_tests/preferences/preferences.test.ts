// supabase/functions/_tests/preferences/preferences.test.ts
// ──────────────────────────────────────────────────────────────────
// Unit-tester för _shared/preferences.ts (Fas 5.5a).
//
// Kör: deno test supabase/functions/_tests/preferences/preferences.test.ts --allow-env
//
// Täckning:
//   - getPreferences: happy path, ingen rad (null), invalid email
//   - upsertPreferences: happy path, DB-error, invalid email
//   - setFavoriteCleaner: happy path, invalid inputs
//   - addBlockedCleaner: append, dubblett-skydd, invalid uuid
//   - removeBlockedCleaner: remove, not-in-list, invalid inputs
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  addBlockedCleaner,
  getPreferences,
  removeBlockedCleaner,
  setFavoriteCleaner,
  upsertPreferences,
  type CustomerPreferences,
} from "../../_shared/preferences.ts";

const VALID_EMAIL = "test@example.se";
const VALID_UUID = "12345678-1234-1234-1234-123456789012";
const VALID_UUID_2 = "87654321-4321-4321-4321-210987654321";

// ── Mock supabase-klient (query-builder-chain) ────────────────────

type QueryCall = {
  table: string;
  op: string;
  args?: Record<string, unknown>;
  filters?: Array<{ column: string; value: unknown }>;
};

function createMockSupabase(options: {
  getRow?: CustomerPreferences | null;
  getError?: { message: string } | null;
  upsertRow?: CustomerPreferences | null;
  upsertError?: { message: string } | null;
} = {}): { client: unknown; calls: QueryCall[] } {
  const calls: QueryCall[] = [];

  const client = {
    from(table: string) {
      const ctx: QueryCall = { table, op: "", filters: [] };
      calls.push(ctx);

      const builder: Record<string, unknown> = {
        select(_cols?: string) {
          // Bevara första op — select() efter upsert() ska inte överskriva
          if (!ctx.op) ctx.op = "select";
          return builder;
        },
        upsert(row: Record<string, unknown>, args?: Record<string, unknown>) {
          ctx.op = "upsert";
          ctx.args = { row, ...args };
          return builder;
        },
        eq(column: string, value: unknown) {
          ctx.filters?.push({ column, value });
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data: options.getRow ?? null,
            error: options.getError ?? null,
          });
        },
        single() {
          return Promise.resolve({
            data: options.upsertRow ?? null,
            error: options.upsertError ?? null,
          });
        },
      };

      return builder;
    },
  };

  return { client, calls };
}

const sampleRow: CustomerPreferences = {
  id: "row-id-1",
  customer_email: VALID_EMAIL,
  favorite_cleaner_id: null,
  blocked_cleaner_ids: [],
  default_has_pets: null,
  pet_type: null,
  has_children_at_home: null,
  has_stairs: null,
  prefers_eco_products: false,
  default_notes_to_cleaner: null,
  budget_range_min_sek: null,
  budget_range_max_sek: null,
  language_preference: null,
  created_at: "2026-04-23T00:00:00Z",
  updated_at: "2026-04-23T00:00:00Z",
};

// ── getPreferences ────────────────────────────────────────────────

Deno.test("getPreferences: returnerar rad vid match", async () => {
  const { client, calls } = createMockSupabase({ getRow: sampleRow });
  const result = await getPreferences(client, VALID_EMAIL);
  assertEquals(result?.id, "row-id-1");
  assertEquals(calls[0].table, "customer_preferences");
  assertEquals(calls[0].filters?.[0].column, "customer_email");
  assertEquals(calls[0].filters?.[0].value, VALID_EMAIL);
});

Deno.test("getPreferences: null när ingen rad", async () => {
  const { client } = createMockSupabase({ getRow: null });
  const result = await getPreferences(client, VALID_EMAIL);
  assertEquals(result, null);
});

Deno.test("getPreferences: DB-error → null, ingen throw", async () => {
  const { client } = createMockSupabase({ getError: { message: "RLS denied" } });
  const result = await getPreferences(client, VALID_EMAIL);
  assertEquals(result, null);
});

Deno.test("getPreferences: ogiltig email → null, ingen DB-call", async () => {
  const { client, calls } = createMockSupabase();
  const result = await getPreferences(client, "not-an-email");
  assertEquals(result, null);
  assertEquals(calls.length, 0);
});

Deno.test("getPreferences: email normaliseras (lowercase + trim)", async () => {
  const { client, calls } = createMockSupabase({ getRow: sampleRow });
  await getPreferences(client, "  TEST@EXAMPLE.SE  ");
  assertEquals(calls[0].filters?.[0].value, "test@example.se");
});

// ── upsertPreferences ────────────────────────────────────────────

Deno.test("upsertPreferences: skickar patch + email i upsert", async () => {
  const { client, calls } = createMockSupabase({ upsertRow: sampleRow });
  await upsertPreferences(client, VALID_EMAIL, {
    prefers_eco_products: true,
    pet_type: "hund",
  });
  assertEquals(calls[0].op, "upsert");
  const row = calls[0].args?.row as Record<string, unknown>;
  assertEquals(row.customer_email, VALID_EMAIL);
  assertEquals(row.prefers_eco_products, true);
  assertEquals(row.pet_type, "hund");
  assertEquals(calls[0].args?.onConflict, "customer_email");
});

Deno.test("upsertPreferences: DB-error → null", async () => {
  const { client } = createMockSupabase({
    upsertError: { message: "constraint violation" },
  });
  const result = await upsertPreferences(client, VALID_EMAIL, { pet_type: "katt" });
  assertEquals(result, null);
});

Deno.test("upsertPreferences: ogiltig email → null, ingen DB-call", async () => {
  const { client, calls } = createMockSupabase();
  const result = await upsertPreferences(client, "", { pet_type: "hund" });
  assertEquals(result, null);
  assertEquals(calls.length, 0);
});

// ── setFavoriteCleaner ────────────────────────────────────────────

Deno.test("setFavoriteCleaner: upsertar favorite_cleaner_id", async () => {
  const { client, calls } = createMockSupabase({
    upsertRow: { ...sampleRow, favorite_cleaner_id: VALID_UUID },
  });
  const ok = await setFavoriteCleaner(client, VALID_EMAIL, VALID_UUID);
  assertEquals(ok, true);
  const row = calls[0].args?.row as Record<string, unknown>;
  assertEquals(row.favorite_cleaner_id, VALID_UUID);
});

Deno.test("setFavoriteCleaner: ogiltig UUID → false, ingen DB-call", async () => {
  const { client, calls } = createMockSupabase();
  const ok = await setFavoriteCleaner(client, VALID_EMAIL, "not-a-uuid");
  assertEquals(ok, false);
  assertEquals(calls.length, 0);
});

// ── addBlockedCleaner ────────────────────────────────────────────

Deno.test("addBlockedCleaner: appendar till tom lista", async () => {
  const { client } = createMockSupabase({
    getRow: sampleRow,
    upsertRow: { ...sampleRow, blocked_cleaner_ids: [VALID_UUID] },
  });
  const ok = await addBlockedCleaner(client, VALID_EMAIL, VALID_UUID);
  assertEquals(ok, true);
});

Deno.test("addBlockedCleaner: dubblett → false, ingen upsert", async () => {
  const mockClient = createMockSupabase({
    getRow: { ...sampleRow, blocked_cleaner_ids: [VALID_UUID] },
  });
  const ok = await addBlockedCleaner(mockClient.client, VALID_EMAIL, VALID_UUID);
  assertEquals(ok, false);
  // Bara get-call, ingen upsert
  const upsertCalls = mockClient.calls.filter((c) => c.op === "upsert");
  assertEquals(upsertCalls.length, 0);
});

Deno.test("addBlockedCleaner: ogiltig UUID → false", async () => {
  const { client } = createMockSupabase();
  const ok = await addBlockedCleaner(client, VALID_EMAIL, "invalid");
  assertEquals(ok, false);
});

// ── removeBlockedCleaner ──────────────────────────────────────────

Deno.test("removeBlockedCleaner: tar bort från lista", async () => {
  const { client } = createMockSupabase({
    getRow: {
      ...sampleRow,
      blocked_cleaner_ids: [VALID_UUID, VALID_UUID_2],
    },
    upsertRow: { ...sampleRow, blocked_cleaner_ids: [VALID_UUID_2] },
  });
  const ok = await removeBlockedCleaner(client, VALID_EMAIL, VALID_UUID);
  assertEquals(ok, true);
});

Deno.test("removeBlockedCleaner: inte i lista → false", async () => {
  const mockClient = createMockSupabase({
    getRow: { ...sampleRow, blocked_cleaner_ids: [VALID_UUID_2] },
  });
  const ok = await removeBlockedCleaner(mockClient.client, VALID_EMAIL, VALID_UUID);
  assertEquals(ok, false);
  const upsertCalls = mockClient.calls.filter((c) => c.op === "upsert");
  assertEquals(upsertCalls.length, 0);
});
