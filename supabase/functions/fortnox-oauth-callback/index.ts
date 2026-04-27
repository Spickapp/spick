/**
 * fortnox-oauth-callback — tar emot ?code från Fortnox + byter mot tokens
 *
 * FLÖDE:
 * 1. Cleaner kommer tillbaka från Fortnox med ?code=X&state=Y
 * 2. Vi verifierar state mot platform_settings (CSRF-skydd)
 * 3. POST till Fortnox /oauth-v1/token för att byta code mot tokens
 * 4. Lagrar tokens i cleaner_fortnox_credentials
 * 5. Redirect cleaner tillbaka till stadare-dashboard.html#fortnox med success-flag
 *
 * Verify_jwt = false (Fortnox redirect:ar utan JWT — vi verifierar via state-token).
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FORTNOX_CLIENT_ID = Deno.env.get("FORTNOX_CLIENT_ID") || "";
const FORTNOX_CLIENT_SECRET = Deno.env.get("FORTNOX_CLIENT_SECRET") || "";
const SITE = "https://spick.se";
const REDIRECT_URI = `${SUPA_URL}/functions/v1/fortnox-oauth-callback`;

const sb = createClient(SUPA_URL, SERVICE_KEY);

function htmlResponse(message: string, success: boolean): Response {
  const color = success ? "#0F6E56" : "#dc2626";
  const html = `<!DOCTYPE html><html lang="sv"><head><meta charset="UTF-8"><title>Fortnox-koppling</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;text-align:center}h1{color:${color}}p{color:#555;line-height:1.6}a{display:inline-block;background:#0F6E56;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:20px;font-weight:600}</style></head><body><h1>${success ? "✅ Klart!" : "❌ Något gick fel"}</h1><p>${message}</p><a href="${SITE}/stadare-dashboard.html#fortnox">Tillbaka till dashboard</a></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  try {
    if (!FORTNOX_CLIENT_ID || !FORTNOX_CLIENT_SECRET) {
      return htmlResponse("Fortnox är inte konfigurerat på Spick. Kontakta hello@spick.se.", false);
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return htmlResponse(`Fortnox returnerade fel: ${error}. Försök igen.`, false);
    }
    if (!code || !state) {
      return htmlResponse("Kopplingen avbröts. Försök igen från dashboard.", false);
    }

    // Verifiera state-token mot platform_settings (CSRF-skydd)
    const stateKey = `fortnox_oauth_state_${state}`;
    const { data: stateRow } = await sb.from("platform_settings").select("value").eq("key", stateKey).maybeSingle();
    if (!stateRow) {
      return htmlResponse("Din session har gått ut. Starta om kopplingen från dashboard.", false);
    }

    const stateData = JSON.parse(stateRow.value as string) as { cleaner_id: string; created_at: string };
    const cleanerId = stateData.cleaner_id;

    // Validera state-ålder (max 10 min)
    const stateAge = Date.now() - new Date(stateData.created_at).getTime();
    if (stateAge > 10 * 60 * 1000) {
      return htmlResponse("Din session har gått ut (10 min-gräns). Starta om kopplingen.", false);
    }

    // Byt code mot access_token + refresh_token
    const basicAuth = btoa(`${FORTNOX_CLIENT_ID}:${FORTNOX_CLIENT_SECRET}`);
    const tokenRes = await fetch("https://apps.fortnox.se/oauth-v1/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("[fortnox-oauth-callback] token exchange failed", tokenRes.status, errBody.slice(0, 300));
      return htmlResponse(`Kunde inte koppla Fortnox (${tokenRes.status}). Försök igen eller kontakta hello@spick.se.`, false);
    }

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
      token_type: string;
    };

    // Hämta Fortnox company_id
    const companyRes = await fetch("https://api.fortnox.se/3/companyinformation", {
      headers: {
        "Authorization": `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
    });
    let fortnoxCompanyId = "unknown";
    if (companyRes.ok) {
      const companyData = await companyRes.json() as { CompanyInformation?: { OrganizationNumber?: string } };
      fortnoxCompanyId = companyData.CompanyInformation?.OrganizationNumber || "unknown";
    }

    // Lagra credentials (UPSERT — om cleaner re-kopplar ersätts gamla tokens)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const { error: upsertErr } = await sb.from("cleaner_fortnox_credentials").upsert(
      {
        cleaner_id: cleanerId,
        fortnox_company_id: fortnoxCompanyId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        expires_at: expiresAt,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cleaner_id" },
    );

    if (upsertErr) {
      console.error("[fortnox-oauth-callback] upsert failed:", upsertErr.message);
      return htmlResponse(`Kunde inte spara kopplingen (DB-fel). Kontakta hello@spick.se.`, false);
    }

    // Cleanup state-token
    await sb.from("platform_settings").delete().eq("key", stateKey);

    return htmlResponse(`Ditt Fortnox-konto (${fortnoxCompanyId}) är kopplat till Spick. Fakturor från städningar pushar nu automatiskt till Fortnox.`, true);
  } catch (e) {
    console.error("[fortnox-oauth-callback] unhandled:", (e as Error).message);
    return htmlResponse(`Tekniskt fel: ${(e as Error).message}. Kontakta hello@spick.se.`, false);
  }
});
