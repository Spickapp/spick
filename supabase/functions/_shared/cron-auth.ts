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
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

export interface CronAuthResult {
  ok: boolean;
  response?: Response;
}

/**
 * Validerar antingen CRON_SECRET eller SUPABASE_SERVICE_ROLE_KEY från
 * Authorization: Bearer-header eller x-cron-secret.
 *
 * BAKÅTKOMPATIBILITET (audit-fix 2026-04-26): GitHub Actions-workflows
 * skickar service-role-key som Authorization-header (etablerat pattern
 * från innan CRON_SECRET introducerades). Vi accepterar BÅDA — service-
 * role är högre behörighet än CRON_SECRET så det är säkert att tillåta.
 *
 * Användning:
 *   const auth = requireCronAuth(req);
 *   if (!auth.ok) return auth.response;
 */
export function requireCronAuth(req: Request, corsHeaders: Record<string, string> = {}): CronAuthResult {
  if (!CRON_SECRET && !SERVICE_ROLE_KEY) {
    // Misconfiguration — ingen av secrets satta i env
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "auth_not_configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const authHeader = req.headers.get("Authorization");
  const providedSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : req.headers.get("x-cron-secret");

  // Acceptera antingen CRON_SECRET eller service-role-key
  const isValid = providedSecret && (
    (CRON_SECRET && providedSecret === CRON_SECRET) ||
    (SERVICE_ROLE_KEY && providedSecret === SERVICE_ROLE_KEY)
  );

  if (!isValid) {
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
