// ═══════════════════════════════════════════════════════════════
// SPICK – public-auth-exchange (Fas 1.2)
// Växlar shortcode mot Supabase-session + redirect-URL
// Används av /m/:code-routen för att etablera auth-session
//
// Input:  { short_code, ip_address?, user_agent? }
// Output: { action_link, scope, resource_id }
// ═══════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPA_URL, SERVICE_KEY);

async function auditLog(event: {
  event_type: string;
  user_email?: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  success: boolean;
  error_message?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await sb.from("auth_audit_log").insert(event);
  } catch (e) {
    console.warn(JSON.stringify({
      level: "warn",
      fn: "auditLog (exchange)",
      error: (e as Error).message,
    }));
  }
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const { short_code, ip_address, user_agent } = body;

    if (!short_code) {
      return new Response(
        JSON.stringify({ error: "short_code required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: code, error: codeErr } = await sb
      .from("magic_link_shortcodes")
      .select("*")
      .eq("code", short_code)
      .maybeSingle();

    if (codeErr || !code) {
      await auditLog({
        event_type: "magic_link_used",
        ip_address,
        user_agent,
        success: false,
        error_message: "short_code not found",
        metadata: { short_code },
      });
      return new Response(
        JSON.stringify({ error: "Invalid or expired link" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (new Date(code.expires_at) < new Date()) {
      await auditLog({
        event_type: "magic_link_expired",
        user_email: code.email,
        resource_type: code.scope,
        resource_id: code.resource_id,
        ip_address,
        user_agent,
        success: false,
        metadata: { short_code },
      });
      return new Response(
        JSON.stringify({ error: "Link expired" }),
        { status: 410, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (code.single_use && code.used_at) {
      await auditLog({
        event_type: "magic_link_reuse_attempt",
        user_email: code.email,
        resource_type: code.scope,
        resource_id: code.resource_id,
        ip_address,
        user_agent,
        success: false,
        metadata: { short_code, originally_used_at: code.used_at },
      });
      return new Response(
        JSON.stringify({ error: "Link already used" }),
        { status: 410, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    await sb
      .from("magic_link_shortcodes")
      .update({
        used_at: new Date().toISOString(),
        ip_address,
        user_agent,
      })
      .eq("code", short_code);

    await auditLog({
      event_type: "magic_link_used",
      user_email: code.email,
      resource_type: code.scope,
      resource_id: code.resource_id,
      ip_address,
      user_agent,
      success: true,
    });

    return new Response(
      JSON.stringify({
        action_link: code.full_redirect_url,
        scope: code.scope,
        resource_id: code.resource_id,
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(JSON.stringify({
      level: "error",
      fn: "public-auth-exchange",
      msg: "Unhandled error",
      error: (e as Error).message,
    }));
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
