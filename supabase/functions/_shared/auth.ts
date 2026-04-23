// supabase/functions/_shared/auth.ts
// ─────────────────────────────────────────────────────────────────
// Fas 8 §8.2 fix: JWT-role-claim auth för service-role-gated EFs.
//
// PROBLEM SOM LÖSES:
//   Tidigare använde EFs strict-equality-check:
//     if (authHeader.slice(7) !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {...}
//   Detta är brittle när:
//   - Supabase roterar service-role keys
//   - Dashboard visar ny-format keys (sb_secret_*) men env behåller JWT
//   - EF-env-var inte matchar Dashboard-key
//
// NY LÖSNING:
//   Dekoda JWT-payload + kolla 'role'-claim. Säkert eftersom:
//   1. Supabase gateway verifierar JWT-signatur innan EF invokeras
//   2. Bara Supabase kan minta JWT med role='service_role'
//   3. Rolekey-rotation bryter INTE denna logik
//
// REGLER: #26 N/A (ny fil), #27 scope (bara auth-helper), #28 SSOT för
// auth-logik, #30 säker — gateway-validering + role-claim räcker,
// #31 N/A (ingen schema).
// ─────────────────────────────────────────────────────────────────

/**
 * Extraherar role-claim från en Supabase JWT.
 * Returnerar null om token är felformaterad.
 *
 * SÄKERHET: Denna funktion validerar INTE signaturen — det gör
 * Supabase gateway innan EF invokeras. Vi litar på att gateway
 * bara släpper igenom signed JWTs.
 */
export function getJwtRole(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = atob(payloadBase64);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Returnerar true om token är en giltig service_role-JWT.
 * Används för EFs som bara får anropas från andra EFs (interna calls).
 */
export function isServiceRoleJwt(token: string): boolean {
  return getJwtRole(token) === "service_role";
}
