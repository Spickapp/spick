// ═══════════════════════════════════════════════════════════════
// SPICK – public-auth-link (Fas 1.2)
// Genererar Supabase magic-link + skapar shortcode i magic_link_shortcodes
// Loggar event i auth_audit_log
// 
// Input:  { email, redirect_to, scope, resource_id?, ttl_hours? }
// Output: { short_url, short_code, expires_at }
// ═══════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_BASE_URL = "https://spick.se";

const sb = createClient(SUPA_URL, SERVICE_KEY);

// Base62 alphabet för shortcodes (8 tecken = 62^8 = ~218 trillion kombinationer)
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function generateShortcode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

async function auditLog(event: {
  event_type: string;
  user_email?: string;
  user_id?: string;
  resource_type?: string;
  resource_id?: string;
  success: boolean;
  error_message?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await sb.from("auth_audit_log").insert(event);
  } catch (e) {
    console.warn(JSON.stringify({
      level: "warn",
      fn: "auditLog",
      msg: "Failed to write audit log",
      error: (e as Error).message,
    }));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { email, redirect_to, scope, resource_id, ttl_hours = 24 } = body;

    if (!email || !redirect_to || !scope) {
      return new Response(
        JSON.stringify({ error: "email, redirect_to, scope required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Säkerställ auth.users-rad finns (skapa om ej)
    let userId: string | undefined;
    const { data: existingUser } = await sb.auth.admin.listUsers();
    const found = existingUser?.users?.find((u) => u.email === email);
    
    if (found) {
      userId = found.id;
    } else {
      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (createErr) {
        console.warn(JSON.stringify({
          level: "warn",
          fn: "public-auth-link",
          msg: "createUser failed",
          error: createErr.message,
        }));
      } else {
        userId = created?.user?.id;
        await auditLog({
          event_type: "auth_user_created",
          user_email: email,
          user_id: userId,
          success: true,
          metadata: { scope, resource_id },
        });
      }
    }

    // 2. Generera magic-link via Supabase
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: redirect_to },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      await auditLog({
        event_type: "magic_link_generated",
        user_email: email,
        user_id: userId,
        resource_type: scope,
        resource_id,
        success: false,
        error_message: linkErr?.message ?? "No action_link in response",
      });
      return new Response(
        JSON.stringify({ error: "generateLink failed", detail: linkErr?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const magicLinkFull = linkData.properties.action_link;

    // 3. Skapa shortcode (med retry om kollision)
    let shortCode = generateShortcode(8);
    let attempts = 0;
    while (attempts < 5) {
      const { data: existing } = await sb
        .from("magic_link_shortcodes")
        .select("code")
        .eq("code", shortCode)
        .maybeSingle();
      if (!existing) break;
      shortCode = generateShortcode(8);
      attempts++;
    }

    const expiresAt = new Date(Date.now() + ttl_hours * 60 * 60 * 1000).toISOString();

    const { error: insertErr } = await sb.from("magic_link_shortcodes").insert({
      code: shortCode,
      full_redirect_url: magicLinkFull,
      email,
      scope,
      resource_id: resource_id ?? null,
      expires_at: expiresAt,
      single_use: true,
    });

    if (insertErr) {
      console.warn(JSON.stringify({
        level: "warn",
        fn: "public-auth-link",
        msg: "shortcode insert failed",
        error: insertErr.message,
      }));
      return new Response(
        JSON.stringify({ error: "shortcode insert failed", detail: insertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Logga generering
    await auditLog({
      event_type: "magic_link_generated",
      user_email: email,
      user_id: userId,
      resource_type: scope,
      resource_id,
      success: true,
      metadata: { short_code: shortCode, ttl_hours },
    });

    return new Response(
      JSON.stringify({
        short_url: `${PUBLIC_BASE_URL}/m/${shortCode}`,
        short_code: shortCode,
        expires_at: expiresAt,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(JSON.stringify({
      level: "error",
      fn: "public-auth-link",
      msg: "Unhandled error",
      error: (e as Error).message,
    }));
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
