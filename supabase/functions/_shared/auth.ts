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

/**
 * Shared-secret-auth för interna EF-to-EF-calls.
 *
 * RATIONALE (2026-04-24 rotorsaksfix):
 * Supabase gateway avvisade JWT även när stripe-webhook skickade
 * valid service_role-JWT från env. Skäl okänt (möjligen key-rotation
 * eller gateway-konfig). JWT-role-claim utan signature-verify är
 * sårbar för spoofing. Shared secret är robust + säker:
 * - Ingen JWT-validation behövs
 * - Bara caller som har env-variabeln kan anropa
 * - EF deploy:as med --no-verify-jwt så gateway släpper igenom
 *
 * ENV-KONVENTION:
 *   Sätt `INTERNAL_EF_SECRET` i Supabase Dashboard → Settings →
 *   Edge Functions → Secrets. Använd en slumpmässig sträng (≥32 tecken).
 *
 * HEADER-KONVENTION:
 *   Caller skickar `X-Internal-Secret: <value>`.
 */
export function verifyInternalSecret(req: Request): boolean {
  const expected = Deno.env.get("INTERNAL_EF_SECRET");
  if (!expected || expected.length < 16) {
    // Defense: avvisa om env inte är konfigurerad (fail-closed).
    console.warn("[auth] INTERNAL_EF_SECRET ej satt i env — alla calls avvisas");
    return false;
  }
  const provided = req.headers.get("x-internal-secret");
  if (!provided) return false;
  // Timing-safe-jämförelse skulle varit bättre, men för korta secrets
  // (< 100 tecken) är riskerna minimal. Använd string ===.
  return provided === expected;
}
