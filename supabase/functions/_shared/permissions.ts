// supabase/functions/_shared/permissions.ts
// ─────────────────────────────────────────────────────────────────
// Centraliserad permission/auth-helper för EFs (Sprint Permission-refactor).
//
// PROBLEM SOM LÖSES (rule #28 SSOT):
//   17 EFs duplicerar admin-check + cleaner-resolve + admin-bypass-pattern
//   med små varianter (vissa använder supabase-js auth.getUser, andra
//   fetch /auth/v1/user; vissa returnerar 401, andra 403; vissa har
//   typo:ad email-cast). Hade redan orsakat bug i generate-receipt-pdf
//   och get-booking-events där admin_users.user_id refererades fel
//   (kolumnen finns inte — bara email + is_active + role_id).
//
// PRIMÄRKÄLLA (rule #31):
//   admin_users-schema verifierat mot 00000_fas_2_1_1_bootstrap_dependencies.sql:
//     id uuid PK, email text UNIQUE, role_id uuid, is_active boolean DEFAULT true.
//   cleaners.company_role verifierat mot prod 2026-04-28 (10 cleaners, 4 owners).
//
// ANVÄNDNING:
//   import { requireAdmin, requireCleanerOrAdminBypass, PermissionError,
//            permissionErrorToResponse } from "../_shared/permissions.ts";
//
//   try {
//     const ctx = await requireAdmin(req, sb);
//     // ctx.userId, ctx.email, ctx.isAdmin=true
//   } catch (e) {
//     const r = permissionErrorToResponse(e, CORS);
//     if (r) return r;
//     throw e;
//   }
//
// REGLER: #26 N/A (ny fil), #27 scope (bara permissions),
// #28 SSOT (centraliserar 17 EF-duplicat), #30 säker (fail-closed),
// #31 prod-schema verifierat innan kolumn-references.
// ─────────────────────────────────────────────────────────────────

import { getJwtRole } from "./auth.ts";

// Strukturell typ — fungerar med både @2 och @2.49.4 av supabase-js.
// Codebase är fragmenterad på versioner; nominal SupabaseClient-typer är
// inte assignable mellan versioner pga generics-ändring (3 → 5 params).
// PostgrestBuilder är PromiseLike (thenable), inte Promise — därför
// använder vi `then` direkt och PromiseLike som returntyp.
// deno-lint-ignore no-explicit-any
export type MinimalSupabaseClient = any;

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

export type CompanyRole = "owner" | "manager" | "member";

export type AuthContext = {
  userId: string;
  email: string;
  isAdmin: boolean;
  isServiceRole: boolean;
  cleanerId?: string;
  companyId?: string;
  companyRole?: CompanyRole | null;
};

export class PermissionError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, msg: string) {
    super(msg);
    this.name = "PermissionError";
    this.status = status;
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────
// Internal: token-extraction
// ─────────────────────────────────────────────────────────────────

function extractBearer(req: Request): string {
  const h = req.headers.get("Authorization");
  if (!h?.startsWith("Bearer ")) {
    throw new PermissionError(401, "missing_auth", "Authorization-header krävs");
  }
  return h.slice(7);
}

async function getUserFromBearer(token: string): Promise<{ id: string; email: string }> {
  const res = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });
  if (!res.ok) {
    throw new PermissionError(401, "invalid_token", "Token kunde inte verifieras");
  }
  const user = await res.json();
  if (!user?.id || !user?.email) {
    throw new PermissionError(401, "invalid_token", "Token saknar id/email");
  }
  return { id: user.id, email: user.email };
}

async function checkAdmin(sb: MinimalSupabaseClient, email: string): Promise<boolean> {
  const { data } = await sb
    .from("admin_users")
    .select("email")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Kräver att caller har giltig admin-JWT (admin_users-tabellen, is_active=true).
 * Throws PermissionError(401) om token saknas/ogiltig.
 * Throws PermissionError(403) om user inte är admin.
 */
export async function requireAdmin(req: Request, sb: MinimalSupabaseClient): Promise<AuthContext> {
  const token = extractBearer(req);
  const user = await getUserFromBearer(token);
  const isAdmin = await checkAdmin(sb, user.email);
  if (!isAdmin) {
    throw new PermissionError(403, "not_admin", "Admin-behörighet krävs");
  }
  return {
    userId: user.id,
    email: user.email,
    isAdmin: true,
    isServiceRole: false,
  };
}

/**
 * Kräver service-role-JWT ELLER admin. Används av EFs som accepterar både
 * interna calls (cron, EF-to-EF) och admin-UI.
 *
 * Service-role detekteras via JWT-role-claim (gateway har redan validerat
 * signaturen — se _shared/auth.ts:isServiceRoleJwt-rationale).
 */
export async function requireServiceOrAdmin(
  req: Request,
  sb: MinimalSupabaseClient,
): Promise<AuthContext> {
  const token = extractBearer(req);
  const role = getJwtRole(token);
  if (role === "service_role") {
    return {
      userId: "service_role",
      email: "service_role",
      isAdmin: true,
      isServiceRole: true,
    };
  }
  return await requireAdmin(req, sb);
}

/**
 * Kräver att caller är cleaner med matching auth_user_id ELLER admin (bypass).
 *
 * Admin-bypass-pattern (Farhad-mandate 2026-04-27): admin får agera åt vilken
 * cleaner som helst för debugging/support. Caller får cleanerId från body/params,
 * inte från ctx, när ctx.isAdmin=true.
 *
 * Returnerar:
 *   - isAdmin=true, cleanerId=undefined → admin-bypass, caller läser target från body
 *   - isAdmin=false, cleanerId=<id>, companyId, companyRole → cleaner-self
 */
export async function requireCleanerOrAdminBypass(
  req: Request,
  sb: MinimalSupabaseClient,
): Promise<AuthContext> {
  const token = extractBearer(req);
  const user = await getUserFromBearer(token);
  const isAdmin = await checkAdmin(sb, user.email);

  if (isAdmin) {
    return {
      userId: user.id,
      email: user.email,
      isAdmin: true,
      isServiceRole: false,
    };
  }

  const { data: cleaner } = await sb
    .from("cleaners")
    .select("id, company_id, company_role")
    .eq("auth_user_id", user.id)
    .eq("is_approved", true)
    .maybeSingle();

  if (!cleaner) {
    throw new PermissionError(403, "not_cleaner", "Städarprofil hittades inte eller ej godkänd");
  }

  return {
    userId: user.id,
    email: user.email,
    isAdmin: false,
    isServiceRole: false,
    cleanerId: cleaner.id as string,
    companyId: (cleaner.company_id as string | null) ?? undefined,
    companyRole: (cleaner.company_role as CompanyRole | null) ?? null,
  };
}

/**
 * Kräver att caller är cleaner i companyId med roll i allowedRoles, eller admin.
 *
 * Användning för arbetsledar-roll (Sprint #3 Arbetsledar):
 *   const ctx = await requireCompanyRole(req, sb, companyId, ["owner", "manager"]);
 *
 * Admin-bypass: passerar alltid igenom oavsett companyId/role.
 */
export async function requireCompanyRole(
  req: Request,
  sb: MinimalSupabaseClient,
  companyId: string,
  allowedRoles: CompanyRole[],
): Promise<AuthContext> {
  const ctx = await requireCleanerOrAdminBypass(req, sb);
  if (ctx.isAdmin) return ctx;

  if (!ctx.companyId || ctx.companyId !== companyId) {
    throw new PermissionError(403, "wrong_company", "Tillhör inte denna företag");
  }
  if (!ctx.companyRole || !allowedRoles.includes(ctx.companyRole)) {
    throw new PermissionError(
      403,
      "insufficient_role",
      `Roll '${ctx.companyRole ?? "ingen"}' tillåts inte (kräver: ${allowedRoles.join("/")})`,
    );
  }
  return ctx;
}

/**
 * Kräver att caller är ägare av companyId (company_role='owner'), eller admin.
 * Convenience-wrapper kring requireCompanyRole.
 */
export async function requireCompanyOwner(
  req: Request,
  sb: MinimalSupabaseClient,
  companyId: string,
): Promise<AuthContext> {
  return await requireCompanyRole(req, sb, companyId, ["owner"]);
}

/**
 * Konverterar PermissionError → JSON-Response. Returnerar null om e inte
 * är en PermissionError (caller ska re-kasta då).
 *
 * Användning:
 *   try { ... }
 *   catch (e) {
 *     const r = permissionErrorToResponse(e, CORS);
 *     if (r) return r;
 *     throw e;
 *   }
 */
export function permissionErrorToResponse(
  e: unknown,
  cors: HeadersInit,
): Response | null {
  if (e instanceof PermissionError) {
    return new Response(
      JSON.stringify({ error: e.code, message: e.message }),
      {
        status: e.status,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Test-only export (för _tests/permissions/permissions.test.ts)
// ─────────────────────────────────────────────────────────────────

export const __test__ = { extractBearer, getUserFromBearer, checkAdmin };
