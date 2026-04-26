// supabase/functions/_tests/pnr/pnr-verification.test.ts
// ──────────────────────────────────────────────────────────────────
// N3 Sprint 1 (2026-04-26) — Tester för _shared/pnr-verification.ts
//
// Kör: deno test supabase/functions/_tests/pnr/pnr-verification.test.ts --allow-env
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canCreateBookingWithPnr,
  classifyBookingPnr,
  getRutQuotaStatus,
  getVerificationRequirement,
  RUT_ANNUAL_LIMIT_SEK,
  RUT_WARNING_THRESHOLD_SEK,
  type SupabasePnrClient,
} from "../../_shared/pnr-verification.ts";

// ── Mock-helper ──

function createMock(data: Record<string, Array<Record<string, unknown>>>) {
  // deno-lint-ignore no-explicit-any
  const queryBuilder = (table: string): any => {
    const filters: Record<string, unknown> = {};
    const builder = {
      select() { return this; },
      eq(col: string, val: unknown) { filters[col] = val; return this; },
      maybeSingle() {
        const rows = data[table] || [];
        const found = rows.find((r) => {
          for (const [k, v] of Object.entries(filters)) {
            if (r[k] !== v) return false;
          }
          return true;
        });
        return Promise.resolve({ data: found ?? null, error: null });
      },
    };
    return builder;
  };
  const client: SupabasePnrClient = { from(t: string) { return queryBuilder(t); } };
  return client;
}

// ── classifyBookingPnr ──

Deno.test("classifyBookingPnr: bankid + verified_at + session → is_rut_safe=true", () => {
  const r = classifyBookingPnr({
    id: "b1",
    pnr_verification_method: "bankid",
    pnr_verified_at: "2026-04-26T10:00:00Z",
    customer_pnr_verification_session_id: "sess1",
  });
  assertEquals(r.is_rut_safe, true);
  assertEquals(r.needs_attention, false);
});

Deno.test("classifyBookingPnr: manual_klartext → is_rut_safe=false, needs_attention=true", () => {
  const r = classifyBookingPnr({
    id: "b1",
    pnr_verification_method: "manual_klartext",
    pnr_verified_at: "2026-04-26T10:00:00Z",
  });
  assertEquals(r.is_rut_safe, false);
  assertEquals(r.needs_attention, true);
});

Deno.test("classifyBookingPnr: pending_bankid → needs_attention=true", () => {
  const r = classifyBookingPnr({
    id: "b1",
    pnr_verification_method: "pending_bankid",
  });
  assertEquals(r.is_rut_safe, false);
  assertEquals(r.needs_attention, true);
});

Deno.test("classifyBookingPnr: bankid utan verified_at → is_rut_safe=false", () => {
  const r = classifyBookingPnr({
    id: "b1",
    pnr_verification_method: "bankid",
    pnr_verified_at: null,
    customer_pnr_verification_session_id: "sess1",
  });
  assertEquals(r.is_rut_safe, false);
});

Deno.test("classifyBookingPnr: null method → not safe, not attention", () => {
  const r = classifyBookingPnr({ id: "b1" });
  assertEquals(r.is_rut_safe, false);
  assertEquals(r.needs_attention, false);
});

// ── getRutQuotaStatus ──

Deno.test("getRutQuotaStatus: under threshold → approaches=false", async () => {
  const client = createMock({
    customer_profiles: [{ customer_email: "k@a.se", rut_ytd_used_sek: 30000, rut_ytd_year: 2026 }],
  });
  const r = await getRutQuotaStatus(client, "k@a.se");
  assert(r !== null);
  assertEquals(r.ytd_used_sek, 30000);
  assertEquals(r.approaches_limit, false);
  assertEquals(r.exceeds_limit, false);
  assertEquals(r.remaining_sek, RUT_ANNUAL_LIMIT_SEK - 30000);
});

Deno.test("getRutQuotaStatus: vid warning-threshold → approaches=true", async () => {
  const client = createMock({
    customer_profiles: [{ customer_email: "k@a.se", rut_ytd_used_sek: RUT_WARNING_THRESHOLD_SEK, rut_ytd_year: 2026 }],
  });
  const r = await getRutQuotaStatus(client, "k@a.se");
  assertEquals(r?.approaches_limit, true);
  assertEquals(r?.exceeds_limit, false);
});

Deno.test("getRutQuotaStatus: vid limit → exceeds=true, remaining=0", async () => {
  const client = createMock({
    customer_profiles: [{ customer_email: "k@a.se", rut_ytd_used_sek: RUT_ANNUAL_LIMIT_SEK, rut_ytd_year: 2026 }],
  });
  const r = await getRutQuotaStatus(client, "k@a.se");
  assertEquals(r?.exceeds_limit, true);
  assertEquals(r?.remaining_sek, 0);
});

Deno.test("getRutQuotaStatus: profilen saknas → returnerar null", async () => {
  const client = createMock({ customer_profiles: [] });
  const r = await getRutQuotaStatus(client, "ny@a.se");
  assertEquals(r, null);
});

Deno.test("getRutQuotaStatus: email lowercase + trim", async () => {
  const client = createMock({
    customer_profiles: [{ customer_email: "k@a.se", rut_ytd_used_sek: 100 }],
  });
  const r = await getRutQuotaStatus(client, "  K@A.SE  ");
  assertEquals(r?.customer_email, "k@a.se");
});

// ── getVerificationRequirement ──

Deno.test("getVerificationRequirement: returnerar 'soft' default när flag saknas", async () => {
  const client = createMock({ platform_settings: [] });
  assertEquals(await getVerificationRequirement(client), "soft");
});

Deno.test("getVerificationRequirement: returnerar 'hard' när flag är hard", async () => {
  const client = createMock({
    platform_settings: [{ key: "pnr_verification_required", value: "hard" }],
  });
  assertEquals(await getVerificationRequirement(client), "hard");
});

Deno.test("getVerificationRequirement: ogiltigt värde → fallback 'soft'", async () => {
  const client = createMock({
    platform_settings: [{ key: "pnr_verification_required", value: "weird" }],
  });
  assertEquals(await getVerificationRequirement(client), "soft");
});

// ── canCreateBookingWithPnr ──

Deno.test("canCreateBookingWithPnr: rut_enabled=false → tillåtet oavsett method", async () => {
  const client = createMock({ platform_settings: [{ key: "pnr_verification_required", value: "hard" }] });
  const r = await canCreateBookingWithPnr(client, { method: null, rut_enabled: false });
  assertEquals(r.allowed, true);
  assertEquals(r.reason, "rut_not_used");
});

Deno.test("canCreateBookingWithPnr: 'off' tillåter allt", async () => {
  const client = createMock({ platform_settings: [{ key: "pnr_verification_required", value: "off" }] });
  const r = await canCreateBookingWithPnr(client, { method: "manual_klartext", rut_enabled: true });
  assertEquals(r.allowed, true);
});

Deno.test("canCreateBookingWithPnr: 'hard' + bankid → tillåtet", async () => {
  const client = createMock({ platform_settings: [{ key: "pnr_verification_required", value: "hard" }] });
  const r = await canCreateBookingWithPnr(client, { method: "bankid", rut_enabled: true });
  assertEquals(r.allowed, true);
});

Deno.test("canCreateBookingWithPnr: 'hard' + manual_klartext → blockerat", async () => {
  const client = createMock({ platform_settings: [{ key: "pnr_verification_required", value: "hard" }] });
  const r = await canCreateBookingWithPnr(client, { method: "manual_klartext", rut_enabled: true });
  assertEquals(r.allowed, false);
});

Deno.test("canCreateBookingWithPnr: 'soft' + manual_klartext → tillåtet med varning", async () => {
  const client = createMock({ platform_settings: [{ key: "pnr_verification_required", value: "soft" }] });
  const r = await canCreateBookingWithPnr(client, { method: "manual_klartext", rut_enabled: true });
  assertEquals(r.allowed, true);
  assertEquals(r.reason, "soft_warning_manual_klartext");
});
