/**
 * fortnox-oauth-init — generera Fortnox OAuth2 authorization URL för cleaner
 *
 * FLÖDE:
 * 1. Cleaner klickar "Koppla Fortnox" i stadare-dashboard.html
 * 2. Frontend anropar denna EF med JWT (cleaner-auth)
 * 3. Vi genererar state-token + skapar Fortnox auth-URL
 * 4. Frontend redirect:ar cleaner till Fortnox för login + grant
 * 5. Fortnox redirect:ar tillbaka till fortnox-oauth-callback EF med ?code=X&state=Y
 *
 * STATE: Vi lagrar tillfällig {state, cleaner_id}-mapping i platform_settings
 * (auto-rensa efter 10 min). Skydd mot CSRF i OAuth-callback.
 *
 * AUTH: cleaner-JWT krävs (samma pattern som admin-pnr-update).
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FORTNOX_CLIENT_ID = Deno.env.get("FORTNOX_CLIENT_ID") || "";
const SITE = "https://spick.se";

// Spick-app callback-URL (registrerad i Fortnox developer portal)
const REDIRECT_URI = `${SUPA_URL}/functions/v1/fortnox-oauth-callback`;

// Scopes för MVP: läsa företagsinfo + skriva fakturor + bokföring
const SCOPES = "companyinformation invoice bookkeeping";

const sb = createClient(SUPA_URL, SERVICE_KEY);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    if (!FORTNOX_CLIENT_ID) {
      return new Response(JSON.stringify({ error: "fortnox_not_configured", detail: "FORTNOX_CLIENT_ID secret saknas" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Verifiera cleaner-JWT
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === ANON_KEY) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    if (!authRes.ok) return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    const authUser = await authRes.json() as { email?: string };
    if (!authUser.email) return new Response(JSON.stringify({ error: "no_email" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    // Hitta cleaner-id för authenticated user
    const { data: cleaner } = await sb.from("cleaners").select("id").eq("email", authUser.email).maybeSingle();
    if (!cleaner) {
      return new Response(JSON.stringify({ error: "cleaner_not_found" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Generera CSRF-state-token
    const stateToken = crypto.randomUUID();
    const stateKey = `fortnox_oauth_state_${stateToken}`;
    const stateValue = JSON.stringify({ cleaner_id: cleaner.id, created_at: new Date().toISOString() });

    // Lagra i platform_settings (auto-rensa efter 10 min via TTL-pattern)
    await sb.from("platform_settings").upsert(
      { key: stateKey, value: stateValue, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

    // Bygg Fortnox auth-URL
    const params = new URLSearchParams({
      client_id: FORTNOX_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state: stateToken,
      response_type: "code",
      account_type: "service",
    });
    const authUrl = `https://apps.fortnox.se/oauth-v1/auth?${params.toString()}`;

    return new Response(JSON.stringify({ ok: true, auth_url: authUrl, state: stateToken }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[fortnox-oauth-init]", (e as Error).message);
    return new Response(JSON.stringify({ error: "internal_error", detail: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
