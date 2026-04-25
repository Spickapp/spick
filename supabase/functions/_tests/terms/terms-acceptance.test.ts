// supabase/functions/_tests/terms/terms-acceptance.test.ts
// ──────────────────────────────────────────────────────────────────
// Item 1 (2026-04-25) — Unit-tester för _shared/terms-acceptance.ts
//
// Kör: deno test supabase/functions/_tests/terms/terms-acceptance.test.ts --allow-env
//
// Täckning:
//   - getCurrentBindingVersion: returnerar senaste is_binding=true
//   - checkAcceptanceStatus: 4 paths (current/outdated/never/no-binding)
//   - recordAcceptance: validerar input + uppdaterar DB
//   - isBankIdBindingRequired: läser platform_settings-flagga
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkAcceptanceStatus,
  getCurrentBindingVersion,
  isBankIdBindingRequired,
  recordAcceptance,
  type SupabaseTermsClient,
} from "../../_shared/terms-acceptance.ts";

// ── Mock-helper ──────────────────────────────────────────

interface MockData {
  avtal_versioner?: Array<Record<string, unknown>>;
  cleaners?: Array<Record<string, unknown>>;
  companies?: Array<Record<string, unknown>>;
  platform_settings?: Array<Record<string, unknown>>;
}

interface UpdateLog {
  table: string;
  payload: Record<string, unknown>;
  whereId: string;
}

function createMockClient(data: MockData = {}) {
  const updates: UpdateLog[] = [];

  // deno-lint-ignore no-explicit-any
  const queryBuilder = (table: string): any => {
    let _filters: Record<string, unknown> = {};
    let _order: { col: string; asc: boolean } | null = null;
    let _limit: number | null = null;
    const builder = {
      select() { return this; },
      eq(col: string, val: unknown) { _filters[col] = val; return this; },
      order(col: string, opts?: { ascending?: boolean }) { _order = { col, asc: opts?.ascending ?? true }; return this; },
      limit(n: number) { _limit = n; return this; },
      maybeSingle() {
        const rows = (data[table as keyof MockData] || []) as Array<Record<string, unknown>>;
        let filtered = rows.filter((r) => {
          for (const [k, v] of Object.entries(_filters)) {
            if (r[k] !== v) return false;
          }
          return true;
        });
        if (_order) {
          const o = _order; // capture for type narrowing
          filtered = filtered.slice().sort((a, b) => {
            const av = a[o.col];
            const bv = b[o.col];
            if (av === bv) return 0;
            const cmp = String(av) > String(bv) ? 1 : -1;
            return o.asc ? cmp : -cmp;
          });
        }
        if (_limit) filtered = filtered.slice(0, _limit);
        return Promise.resolve({ data: filtered[0] ?? null, error: null });
      },
      update(payload: Record<string, unknown>) {
        return {
          eq(col: string, val: unknown) {
            updates.push({ table, payload, whereId: String(val) });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    return builder;
  };

  const client: SupabaseTermsClient = {
    from(table: string) { return queryBuilder(table); },
  };

  return { client, updates };
}

// ── Test 1: getCurrentBindingVersion ──────────────────────

Deno.test("getCurrentBindingVersion: returnerar senaste is_binding=true per typ", async () => {
  const { client } = createMockClient({
    avtal_versioner: [
      { id: "1", avtal_typ: "underleverantorsavtal", version: "v0.2-DRAFT", is_binding: false, publicerat_at: "2026-04-25T10:00:00Z" },
      { id: "2", avtal_typ: "underleverantorsavtal", version: "v1.0", is_binding: true, publicerat_at: "2026-04-26T10:00:00Z" },
      { id: "3", avtal_typ: "underleverantorsavtal", version: "v1.1", is_binding: true, publicerat_at: "2026-04-27T10:00:00Z" },
      { id: "4", avtal_typ: "kundvillkor", version: "v1.0", is_binding: true, publicerat_at: "2026-04-26T10:00:00Z" },
    ],
  });

  const result = await getCurrentBindingVersion(client, "underleverantorsavtal");
  assert(result !== null);
  assertEquals(result.version, "v1.1");
  assertEquals(result.is_binding, true);
});

Deno.test("getCurrentBindingVersion: returnerar null om inga binding-versioner", async () => {
  const { client } = createMockClient({
    avtal_versioner: [
      { id: "1", avtal_typ: "underleverantorsavtal", version: "v0.2-DRAFT", is_binding: false, publicerat_at: "2026-04-25T10:00:00Z" },
    ],
  });

  const result = await getCurrentBindingVersion(client, "underleverantorsavtal");
  assertEquals(result, null);
});

// ── Test 2: checkAcceptanceStatus — 4 paths ───────────────

Deno.test("checkAcceptanceStatus: current=true när accept matchar binding-version", async () => {
  const { client } = createMockClient({
    avtal_versioner: [
      { id: "v", avtal_typ: "underleverantorsavtal", version: "v1.0", is_binding: true, publicerat_at: "2026-04-25T10:00:00Z" },
    ],
    cleaners: [
      { id: "c1", terms_accepted_at: "2026-04-26T10:00:00Z", terms_version: "v1.0", terms_signature_id: "sig1" },
    ],
  });

  const result = await checkAcceptanceStatus(client, "cleaner", "c1", "underleverantorsavtal");
  assertEquals(result.current, true);
  assertEquals(result.outdated, false);
  assertEquals(result.never, false);
  assertEquals(result.signature_id, "sig1");
});

Deno.test("checkAcceptanceStatus: outdated=true när accept är gammal version", async () => {
  const { client } = createMockClient({
    avtal_versioner: [
      { id: "v", avtal_typ: "underleverantorsavtal", version: "v1.1", is_binding: true, publicerat_at: "2026-04-27T10:00:00Z" },
    ],
    cleaners: [
      { id: "c1", terms_accepted_at: "2026-04-26T10:00:00Z", terms_version: "v1.0", terms_signature_id: null },
    ],
  });

  const result = await checkAcceptanceStatus(client, "cleaner", "c1", "underleverantorsavtal");
  assertEquals(result.current, false);
  assertEquals(result.outdated, true);
  assertEquals(result.never, false);
  assertEquals(result.current_version, "v1.1");
  assertEquals(result.accepted_version, "v1.0");
});

Deno.test("checkAcceptanceStatus: never=true när cleaner aldrig accepterat", async () => {
  const { client } = createMockClient({
    avtal_versioner: [
      { id: "v", avtal_typ: "underleverantorsavtal", version: "v1.0", is_binding: true, publicerat_at: "2026-04-25T10:00:00Z" },
    ],
    cleaners: [
      { id: "c1", terms_accepted_at: null, terms_version: null, terms_signature_id: null },
    ],
  });

  const result = await checkAcceptanceStatus(client, "cleaner", "c1", "underleverantorsavtal");
  assertEquals(result.current, false);
  assertEquals(result.outdated, false);
  assertEquals(result.never, true);
});

Deno.test("checkAcceptanceStatus: never=true när ingen binding-version finns", async () => {
  const { client } = createMockClient({
    avtal_versioner: [],
    cleaners: [
      { id: "c1", terms_accepted_at: null, terms_version: null, terms_signature_id: null },
    ],
  });

  const result = await checkAcceptanceStatus(client, "cleaner", "c1", "underleverantorsavtal");
  assertEquals(result.never, true);
  assertEquals(result.current_version, null);
});

// ── Test 3: recordAcceptance ──────────────────────────────

Deno.test("recordAcceptance: skickar UPDATE med korrekta fält", async () => {
  const { client, updates } = createMockClient();

  const result = await recordAcceptance(client, {
    subjectType: "cleaner",
    subjectId: "c1",
    version: "v1.0",
    signatureId: "sig1",
  });

  assertEquals(result.ok, true);
  assertEquals(updates.length, 1);
  assertEquals(updates[0].table, "cleaners");
  assertEquals(updates[0].whereId, "c1");
  assertEquals(updates[0].payload.terms_version, "v1.0");
  assertEquals(updates[0].payload.terms_signature_id, "sig1");
  assert(updates[0].payload.terms_accepted_at !== undefined);
});

Deno.test("recordAcceptance: signatureId=null tillåts (soft-accept)", async () => {
  const { client, updates } = createMockClient();

  const result = await recordAcceptance(client, {
    subjectType: "company",
    subjectId: "co1",
    version: "v1.0",
    signatureId: null,
  });

  assertEquals(result.ok, true);
  assertEquals(updates[0].table, "companies");
  assertEquals(updates[0].payload.terms_signature_id, null);
});

Deno.test("recordAcceptance: invalid_subject_id vid tom string", async () => {
  const { client } = createMockClient();
  const result = await recordAcceptance(client, {
    subjectType: "cleaner",
    subjectId: "",
    version: "v1.0",
  });
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_subject_id");
});

Deno.test("recordAcceptance: invalid_version vid tom string", async () => {
  const { client } = createMockClient();
  const result = await recordAcceptance(client, {
    subjectType: "cleaner",
    subjectId: "c1",
    version: "",
  });
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_version");
});

// ── Test 4: isBankIdBindingRequired ───────────────────────

Deno.test("isBankIdBindingRequired: returnerar true när flag='true'", async () => {
  const { client } = createMockClient({
    platform_settings: [{ key: "terms_signing_required", value: "true" }],
  });

  assertEquals(await isBankIdBindingRequired(client), true);
});

Deno.test("isBankIdBindingRequired: returnerar false default", async () => {
  const { client } = createMockClient({
    platform_settings: [{ key: "terms_signing_required", value: "false" }],
  });

  assertEquals(await isBankIdBindingRequired(client), false);
});

Deno.test("isBankIdBindingRequired: returnerar false när flag saknas", async () => {
  const { client } = createMockClient({ platform_settings: [] });

  assertEquals(await isBankIdBindingRequired(client), false);
});
