// supabase/functions/_tests/sms/sms-billing.test.ts
// ──────────────────────────────────────────────────────────────────
// SMS-saldo Sprint A (2026-04-26) — tester för helpers.
//
// Kör: deno test supabase/functions/_tests/sms/sms-billing.test.ts --allow-env
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  billingPeriod,
  calcSegments,
  getCompanySmsBalance,
  getSmsBillingConfig,
  logSmsAndCharge,
  phoneSuffix,
  settleCompanySmsBalance,
  shouldThrottleSms,
  SMS_DEFAULT_PRICE_ORE,
  SMS_DEFAULT_THROTTLE_ORE,
  SMS_SEGMENT_LENGTH,
  type SupabaseSmsClient,
} from "../../_shared/sms-billing.ts";

// ── Mock-helper ──

interface MockState {
  platform_settings: Array<Record<string, unknown>>;
  sms_log: Array<Record<string, unknown>>;
  company_sms_balance: Array<Record<string, unknown>>;
  rpc_should_fail?: boolean;
  rpc_balance_after?: bigint;
}

function createMock(state: Partial<MockState>): { client: SupabaseSmsClient; state: MockState } {
  const s: MockState = {
    platform_settings: state.platform_settings || [],
    sms_log: state.sms_log || [],
    company_sms_balance: state.company_sms_balance || [],
    rpc_should_fail: state.rpc_should_fail,
    rpc_balance_after: state.rpc_balance_after ?? 0n,
  };
  // deno-lint-ignore no-explicit-any
  const queryBuilder = (table: keyof MockState): any => {
    const filters: Record<string, unknown> = {};
    let inserting: Record<string, unknown> | null = null;
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
      insert(row: any) { inserting = row; return this; },
    };
    return builder;
  };
  const client: SupabaseSmsClient = {
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

Deno.test("SMS_DEFAULT_PRICE_ORE = 52 (0,52 kr)", () => {
  assertEquals(SMS_DEFAULT_PRICE_ORE, 52);
});

Deno.test("SMS_SEGMENT_LENGTH = 160", () => {
  assertEquals(SMS_SEGMENT_LENGTH, 160);
});

Deno.test("SMS_DEFAULT_THROTTLE_ORE = 100000 (1000 kr)", () => {
  assertEquals(SMS_DEFAULT_THROTTLE_ORE, 100000);
});

// ── calcSegments ──

Deno.test("calcSegments: tom sträng → 0", () => {
  assertEquals(calcSegments(""), 0);
});

Deno.test("calcSegments: 1-tecken → 1 segment", () => {
  assertEquals(calcSegments("a"), 1);
});

Deno.test("calcSegments: 160-tecken → 1 segment", () => {
  assertEquals(calcSegments("a".repeat(160)), 1);
});

Deno.test("calcSegments: 161-tecken → 2 segment", () => {
  assertEquals(calcSegments("a".repeat(161)), 2);
});

Deno.test("calcSegments: 320-tecken → 2 segment", () => {
  assertEquals(calcSegments("a".repeat(320)), 2);
});

Deno.test("calcSegments: 321-tecken → 3 segment", () => {
  assertEquals(calcSegments("a".repeat(321)), 3);
});

// ── phoneSuffix ──

Deno.test("phoneSuffix: 070-1234567 → 4567", () => {
  assertEquals(phoneSuffix("070-1234567"), "4567");
});

Deno.test("phoneSuffix: +46701234567 → 4567", () => {
  assertEquals(phoneSuffix("+46701234567"), "4567");
});

Deno.test("phoneSuffix: tom → tom", () => {
  assertEquals(phoneSuffix(""), "");
});

// ── billingPeriod ──

Deno.test("billingPeriod: april 2026 → '2026-04'", () => {
  assertEquals(billingPeriod(new Date(Date.UTC(2026, 3, 15))), "2026-04");
});

Deno.test("billingPeriod: januari → padded '2026-01'", () => {
  assertEquals(billingPeriod(new Date(Date.UTC(2026, 0, 1))), "2026-01");
});

// ── getSmsBillingConfig ──

Deno.test("getSmsBillingConfig: defaults när allt saknas", async () => {
  const { client } = createMock({});
  const cfg = await getSmsBillingConfig(client);
  assertEquals(cfg.enabled, false);
  assertEquals(cfg.price_per_segment_ore, 52);
  assertEquals(cfg.throttle_ore, 100000);
});

Deno.test("getSmsBillingConfig: enabled när flag = 'true'", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "sms_billing_enabled", value: "true" }],
  });
  const cfg = await getSmsBillingConfig(client);
  assertEquals(cfg.enabled, true);
});

Deno.test("getSmsBillingConfig: kustom pris 65", async () => {
  const { client } = createMock({
    platform_settings: [
      { key: "sms_billing_enabled", value: "true" },
      { key: "sms_price_per_segment_ore", value: "65" },
    ],
  });
  const cfg = await getSmsBillingConfig(client);
  assertEquals(cfg.price_per_segment_ore, 65);
});

// ── logSmsAndCharge ──

Deno.test("logSmsAndCharge: enabled=false → loggas men ej chargas", async () => {
  const { client, state } = createMock({});
  const r = await logSmsAndCharge({
    supabase: client,
    companyId: "c1",
    triggeredByCleanerId: "cl1",
    recipientPhone: "0701234567",
    message: "Hej kund!",
  });
  assertEquals(r.enabled, false);
  assertEquals(r.logged, true);
  assertEquals(r.charged, false);
  assertEquals(r.segment_count, 1);
  assertEquals(r.total_charge_ore, 52);
  assertEquals(r.reason, "billing_disabled");
  // sms_log ska ha 1 rad med billing_status='waived'
  assertEquals(state.sms_log.length, 1);
  assertEquals(state.sms_log[0].billing_status, "waived");
});

Deno.test("logSmsAndCharge: enabled=true + company_id → loggas + chargas", async () => {
  const { client, state } = createMock({
    platform_settings: [{ key: "sms_billing_enabled", value: "true" }],
  });
  const r = await logSmsAndCharge({
    supabase: client,
    companyId: "comp-1",
    triggeredByCleanerId: "cl1",
    recipientPhone: "0701234567",
    message: "Hej!",
  });
  assertEquals(r.enabled, true);
  assertEquals(r.logged, true);
  assertEquals(r.charged, true);
  assertEquals(r.reason, "logged_and_charged");
  assertEquals(state.sms_log[0].billing_status, "pending");
});

Deno.test("logSmsAndCharge: 200-tecken → 2 segment * 52 = 104 öre", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "sms_billing_enabled", value: "true" }],
  });
  const r = await logSmsAndCharge({
    supabase: client,
    companyId: "c1",
    triggeredByCleanerId: null,
    recipientPhone: "0701234567",
    message: "a".repeat(200),
  });
  assertEquals(r.segment_count, 2);
  assertEquals(r.total_charge_ore, 104);
});

Deno.test("logSmsAndCharge: ingen company_id → loggas, ej chargas", async () => {
  const { client, state } = createMock({
    platform_settings: [{ key: "sms_billing_enabled", value: "true" }],
  });
  const r = await logSmsAndCharge({
    supabase: client,
    companyId: null,
    triggeredByCleanerId: "cl-solo",
    recipientPhone: "0701234567",
    message: "Hej",
  });
  assertEquals(r.charged, false);
  assertEquals(r.reason, "no_company_id");
  assertEquals(state.sms_log[0].billing_status, "waived");
});

Deno.test("logSmsAndCharge: isSystemSms=true → ej chargas", async () => {
  const { client, state } = createMock({
    platform_settings: [{ key: "sms_billing_enabled", value: "true" }],
  });
  const r = await logSmsAndCharge({
    supabase: client,
    companyId: "c1",
    triggeredByCleanerId: null,
    recipientPhone: "0701234567",
    message: "Spick system-mejl",
    isSystemSms: true,
  });
  assertEquals(r.charged, false);
  assertEquals(r.reason, "system_sms_not_billable");
  assertEquals(state.sms_log[0].billing_status, "system");
});

Deno.test("logSmsAndCharge: phone-suffix sparas korrekt", async () => {
  const { client, state } = createMock({});
  await logSmsAndCharge({
    supabase: client,
    companyId: null,
    triggeredByCleanerId: null,
    recipientPhone: "+46 70 123 45 67",
    message: "Hej",
  });
  assertEquals(state.sms_log[0].recipient_phone_suffix, "4567");
});

Deno.test("logSmsAndCharge: message_excerpt cap:as till 50 tecken", async () => {
  const { client, state } = createMock({});
  await logSmsAndCharge({
    supabase: client,
    companyId: null,
    triggeredByCleanerId: null,
    recipientPhone: "0701234567",
    message: "a".repeat(200),
  });
  assertEquals((state.sms_log[0].message_excerpt as string).length, 50);
});

// ── settleCompanySmsBalance ──

Deno.test("settleCompanySmsBalance: 0 öre → no-op", async () => {
  const { client } = createMock({});
  const r = await settleCompanySmsBalance(client, "c1", 0);
  assertEquals(r.ok, true);
  assertEquals(r.reason, "noop_zero_amount");
});

Deno.test("settleCompanySmsBalance: 100 öre → ok", async () => {
  const { client } = createMock({ rpc_balance_after: 50n });
  const r = await settleCompanySmsBalance(client, "c1", 100);
  assertEquals(r.ok, true);
  assertEquals(r.new_balance_ore, 50n);
});

// ── getCompanySmsBalance ──

Deno.test("getCompanySmsBalance: returnerar null när saknas", async () => {
  const { client } = createMock({ company_sms_balance: [] });
  const r = await getCompanySmsBalance(client, "c1");
  assertEquals(r, null);
});

Deno.test("getCompanySmsBalance: returnerar data när finns", async () => {
  const { client } = createMock({
    company_sms_balance: [{
      company_id: "c1",
      balance_ore: 7384,
      total_charged_lifetime_ore: 50000,
      total_settled_lifetime_ore: 42616,
      last_charged_at: "2026-04-15T10:00:00Z",
      last_settled_at: "2026-04-10T10:00:00Z",
    }],
  });
  const r = await getCompanySmsBalance(client, "c1");
  assert(r !== null);
  assertEquals(r?.balance_ore, 7384n);
  assertEquals(r?.total_charged_lifetime_ore, 50000n);
});

// ── shouldThrottleSms ──

Deno.test("shouldThrottleSms: ej throttle när disabled", async () => {
  const { client } = createMock({});
  const r = await shouldThrottleSms(client, "c1");
  assertEquals(r.throttle, false);
});

Deno.test("shouldThrottleSms: throttle när skuld >= 1000 kr (100000 öre)", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "sms_billing_enabled", value: "true" }],
    company_sms_balance: [{ company_id: "c1", balance_ore: 100000, total_charged_lifetime_ore: 100000, total_settled_lifetime_ore: 0, last_charged_at: null, last_settled_at: null }],
  });
  const r = await shouldThrottleSms(client, "c1");
  assertEquals(r.throttle, true);
  assertEquals(r.balance_ore, 100000n);
});

Deno.test("shouldThrottleSms: ej throttle när skuld < threshold", async () => {
  const { client } = createMock({
    platform_settings: [{ key: "sms_billing_enabled", value: "true" }],
    company_sms_balance: [{ company_id: "c1", balance_ore: 50000, total_charged_lifetime_ore: 50000, total_settled_lifetime_ore: 0, last_charged_at: null, last_settled_at: null }],
  });
  const r = await shouldThrottleSms(client, "c1");
  assertEquals(r.throttle, false);
});
