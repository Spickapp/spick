// supabase/functions/_tests/permissions/permissions.test.ts
// ──────────────────────────────────────────────────────────────────
// Unit-tester för _shared/permissions.ts (Sprint Permission-refactor).
//
// Kör: deno test supabase/functions/_tests/permissions/ --allow-env --allow-net
//
// Täckning:
//   - PermissionError-shape (status, code, message)
//   - permissionErrorToResponse: PermissionError → JSON-Response, annat → null
//   - requireAdmin: token saknas → 401, ogiltig token → 401, icke-admin → 403, admin → ctx
//   - requireServiceOrAdmin: service_role-JWT bypassar admin-DB-check
//   - requireCleanerOrAdminBypass: admin → bypass-ctx, cleaner-self → fullt ctx,
//     non-cleaner non-admin → 403
//   - requireCompanyRole: fel company → 403, fel role → 403, rätt roll → ctx,
//     admin → bypass
//   - requireCompanyOwner: convenience-wrapper testas implicit
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assert, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PermissionError,
  permissionErrorToResponse,
  requireAdmin,
  requireServiceOrAdmin,
  requireCleanerOrAdminBypass,
  requireCompanyRole,
  requireCompanyOwner,
} from "../../_shared/permissions.ts";

// ── Env-stub: krävs av extractBearer/getUserFromBearer fetch-target ──
Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon-test-key");

// ── JWT-helpers (test-only) ──────────────────────────────────────

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${header}.${body}.signature`;
}

const SERVICE_JWT = makeJwt({ role: "service_role", sub: "svc" });
const USER_JWT = makeJwt({ role: "authenticated", sub: "user-123", email: "u@example.com" });

// ── Mock supabase-client ─────────────────────────────────────────

type Row = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type AnySb = any;

function mockSb(opts: {
  adminEmails?: string[];
  cleanerByAuthId?: Record<string, Row | null>;
}): AnySb {
  const adminSet = new Set(opts.adminEmails ?? []);
  const cleanerMap = opts.cleanerByAuthId ?? {};

  function buildSelectChain(tableName: string) {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: (_cols: string) => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      maybeSingle: () => {
        if (tableName === "admin_users") {
          const email = filters.email as string;
          const active = filters.is_active;
          if (active === true && adminSet.has(email)) {
            return Promise.resolve({ data: { email }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }
        if (tableName === "cleaners") {
          const authId = filters.auth_user_id as string;
          const row = cleanerMap[authId] ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => buildSelectChain(table),
  };
}

// ── Mock fetch (för /auth/v1/user) ───────────────────────────────

const originalFetch = globalThis.fetch;
function installFetchMock(handler: (token: string) => { ok: boolean; user?: Row }) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    if (url?.includes("/auth/v1/user")) {
      // deno-lint-ignore no-explicit-any
      const headers = (init?.headers ?? {}) as any;
      const auth = (headers.Authorization || headers.authorization || "") as string;
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const result = handler(token);
      return Promise.resolve(new Response(
        result.ok ? JSON.stringify(result.user ?? {}) : "invalid",
        { status: result.ok ? 200 : 401 },
      ));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function mkReq(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new Request("https://ef.test/", { method: "POST", headers });
}

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

Deno.test("PermissionError carries status + code", () => {
  const e = new PermissionError(403, "not_admin", "test");
  assertEquals(e.status, 403);
  assertEquals(e.code, "not_admin");
  assertEquals(e.message, "test");
  assert(e instanceof Error);
});

Deno.test("permissionErrorToResponse: PermissionError → JSON-Response", async () => {
  const e = new PermissionError(403, "not_admin", "Admin krävs");
  const res = permissionErrorToResponse(e, { "X-CORS": "*" });
  assert(res instanceof Response);
  assertEquals(res!.status, 403);
  assertEquals(res!.headers.get("X-CORS"), "*");
  const body = await res!.json();
  assertEquals(body.error, "not_admin");
  assertEquals(body.message, "Admin krävs");
});

Deno.test("permissionErrorToResponse: non-PermissionError → null", () => {
  assertEquals(permissionErrorToResponse(new Error("boom"), {}), null);
  assertEquals(permissionErrorToResponse("string", {}), null);
  assertEquals(permissionErrorToResponse(null, {}), null);
});

Deno.test("requireAdmin: missing Authorization → 401 missing_auth", async () => {
  const sb = mockSb({});
  const err = await assertRejects(
    () => requireAdmin(mkReq(), sb),
    PermissionError,
  );
  assertEquals(err.status, 401);
  assertEquals(err.code, "missing_auth");
});

Deno.test("requireAdmin: invalid token → 401 invalid_token", async () => {
  installFetchMock(() => ({ ok: false }));
  try {
    const sb = mockSb({});
    const err = await assertRejects(
      () => requireAdmin(mkReq("bad-token"), sb),
      PermissionError,
    );
    assertEquals(err.status, 401);
    assertEquals(err.code, "invalid_token");
  } finally {
    restoreFetch();
  }
});

Deno.test("requireAdmin: non-admin → 403 not_admin", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u1", email: "non@admin.se" } }));
  try {
    const sb = mockSb({ adminEmails: ["other@admin.se"] });
    const err = await assertRejects(
      () => requireAdmin(mkReq(USER_JWT), sb),
      PermissionError,
    );
    assertEquals(err.status, 403);
    assertEquals(err.code, "not_admin");
  } finally {
    restoreFetch();
  }
});

Deno.test("requireAdmin: admin → ctx{isAdmin:true}", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u1", email: "admin@spick.se" } }));
  try {
    const sb = mockSb({ adminEmails: ["admin@spick.se"] });
    const ctx = await requireAdmin(mkReq(USER_JWT), sb);
    assertEquals(ctx.isAdmin, true);
    assertEquals(ctx.email, "admin@spick.se");
    assertEquals(ctx.userId, "u1");
    assertEquals(ctx.isServiceRole, false);
  } finally {
    restoreFetch();
  }
});

Deno.test("requireServiceOrAdmin: service-role-JWT → bypass DB-check", async () => {
  // Inget fetch-mock: helpern ska inte ens nå /auth/v1/user för service-role
  const sb = mockSb({});
  const ctx = await requireServiceOrAdmin(mkReq(SERVICE_JWT), sb);
  assertEquals(ctx.isAdmin, true);
  assertEquals(ctx.isServiceRole, true);
  assertEquals(ctx.userId, "service_role");
});

Deno.test("requireServiceOrAdmin: non-service-JWT → faller tillbaka till admin-check", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u1", email: "admin@spick.se" } }));
  try {
    const sb = mockSb({ adminEmails: ["admin@spick.se"] });
    const ctx = await requireServiceOrAdmin(mkReq(USER_JWT), sb);
    assertEquals(ctx.isAdmin, true);
    assertEquals(ctx.isServiceRole, false);
  } finally {
    restoreFetch();
  }
});

Deno.test("requireCleanerOrAdminBypass: admin → bypass utan cleanerId", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u1", email: "admin@spick.se" } }));
  try {
    const sb = mockSb({ adminEmails: ["admin@spick.se"] });
    const ctx = await requireCleanerOrAdminBypass(mkReq(USER_JWT), sb);
    assertEquals(ctx.isAdmin, true);
    assertEquals(ctx.cleanerId, undefined);
  } finally {
    restoreFetch();
  }
});

Deno.test("requireCleanerOrAdminBypass: cleaner-self → ctx med cleanerId/companyId/role", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u-cleaner", email: "c@spick.se" } }));
  try {
    const sb = mockSb({
      adminEmails: [],
      cleanerByAuthId: {
        "u-cleaner": { id: "cl-1", company_id: "co-1", company_role: "owner" },
      },
    });
    const ctx = await requireCleanerOrAdminBypass(mkReq(USER_JWT), sb);
    assertEquals(ctx.isAdmin, false);
    assertEquals(ctx.cleanerId, "cl-1");
    assertEquals(ctx.companyId, "co-1");
    assertEquals(ctx.companyRole, "owner");
  } finally {
    restoreFetch();
  }
});

Deno.test("requireCleanerOrAdminBypass: non-admin non-cleaner → 403 not_cleaner", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u-stranger", email: "x@x.se" } }));
  try {
    const sb = mockSb({});
    const err = await assertRejects(
      () => requireCleanerOrAdminBypass(mkReq(USER_JWT), sb),
      PermissionError,
    );
    assertEquals(err.status, 403);
    assertEquals(err.code, "not_cleaner");
  } finally {
    restoreFetch();
  }
});

Deno.test("requireCompanyRole: fel company → 403 wrong_company", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u-cleaner", email: "c@spick.se" } }));
  try {
    const sb = mockSb({
      cleanerByAuthId: {
        "u-cleaner": { id: "cl-1", company_id: "co-1", company_role: "owner" },
      },
    });
    const err = await assertRejects(
      () => requireCompanyRole(mkReq(USER_JWT), sb, "co-OTHER", ["owner"]),
      PermissionError,
    );
    assertEquals(err.status, 403);
    assertEquals(err.code, "wrong_company");
  } finally {
    restoreFetch();
  }
});

Deno.test("requireCompanyRole: rätt company men fel roll → 403 insufficient_role", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u-member", email: "m@spick.se" } }));
  try {
    const sb = mockSb({
      cleanerByAuthId: {
        "u-member": { id: "cl-2", company_id: "co-1", company_role: "member" },
      },
    });
    const err = await assertRejects(
      () => requireCompanyRole(mkReq(USER_JWT), sb, "co-1", ["owner", "manager"]),
      PermissionError,
    );
    assertEquals(err.status, 403);
    assertEquals(err.code, "insufficient_role");
  } finally {
    restoreFetch();
  }
});

Deno.test("requireCompanyRole: rätt company + rätt roll → ctx", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u-mgr", email: "mgr@spick.se" } }));
  try {
    const sb = mockSb({
      cleanerByAuthId: {
        "u-mgr": { id: "cl-3", company_id: "co-1", company_role: "manager" },
      },
    });
    const ctx = await requireCompanyRole(mkReq(USER_JWT), sb, "co-1", ["owner", "manager"]);
    assertEquals(ctx.companyRole, "manager");
    assertEquals(ctx.companyId, "co-1");
  } finally {
    restoreFetch();
  }
});

Deno.test("requireCompanyRole: admin → bypass oavsett company", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u-admin", email: "admin@spick.se" } }));
  try {
    const sb = mockSb({ adminEmails: ["admin@spick.se"] });
    const ctx = await requireCompanyRole(mkReq(USER_JWT), sb, "any-company-id", ["owner"]);
    assertEquals(ctx.isAdmin, true);
  } finally {
    restoreFetch();
  }
});

Deno.test("requireCompanyOwner: cleaner med owner-roll → ok", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u-own", email: "o@spick.se" } }));
  try {
    const sb = mockSb({
      cleanerByAuthId: {
        "u-own": { id: "cl-1", company_id: "co-1", company_role: "owner" },
      },
    });
    const ctx = await requireCompanyOwner(mkReq(USER_JWT), sb, "co-1");
    assertEquals(ctx.companyRole, "owner");
  } finally {
    restoreFetch();
  }
});

Deno.test("requireCompanyOwner: cleaner med manager-roll → 403", async () => {
  installFetchMock(() => ({ ok: true, user: { id: "u-mgr", email: "mgr@spick.se" } }));
  try {
    const sb = mockSb({
      cleanerByAuthId: {
        "u-mgr": { id: "cl-3", company_id: "co-1", company_role: "manager" },
      },
    });
    const err = await assertRejects(
      () => requireCompanyOwner(mkReq(USER_JWT), sb, "co-1"),
      PermissionError,
    );
    assertEquals(err.code, "insufficient_role");
  } finally {
    restoreFetch();
  }
});
