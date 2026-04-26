// ═══════════════════════════════════════════════════════════════
// SPICK – Cron-EF auth-helper (security-audit-fix 2026-04-26)
// ═══════════════════════════════════════════════════════════════
//
// Centraliserad CRON_SECRET-validering. Replikerar dispute-sla-check-
// pattern (rad 80-88) för konsekvent enforcement över alla cron-EFs.
//
// ANVÄNDNING:
//   import { requireCronAuth } from "../_shared/auth.ts"; // ny export
//   // I handler:
//   const auth = requireCronAuth(req);
//   if (!auth.ok) return auth.response;
//
// REGLER (#28 SSOT, #27 scope-respekt):
//   - En central helper, inga in-line-checks duplicerade per EF
//   - Identisk pattern över alla 5+ cron-EFs (dispute-sla-check redan
//     använder inline — kan migreras senare)
// ═══════════════════════════════════════════════════════════════

const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

export interface CronAuthResult {
  ok: boolean;
  response?: Response;
}

/**
 * Validerar CRON_SECRET från Authorization-header (Bearer) eller x-cron-secret.
 * Returnerar { ok: true } om OK, annars { ok: false, response: 401 } som ska returneras direkt.
 *
 * Användning:
 *   const auth = requireCronAuth(req);
 *   if (!auth.ok) return auth.response;
 */
export function requireCronAuth(req: Request, corsHeaders: Record<string, string> = {}): CronAuthResult {
  if (!CRON_SECRET) {
    // Misconfiguration — secret saknas i env
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "cron_secret_not_configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const authHeader = req.headers.get("Authorization");
  const providedSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : req.headers.get("x-cron-secret");

  if (!providedSecret || providedSecret !== CRON_SECRET) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  return { ok: true };
}
