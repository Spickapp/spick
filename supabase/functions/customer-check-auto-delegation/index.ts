// ═══════════════════════════════════════════════════════════════
// SPICK – customer-check-auto-delegation (Fas 1.2)
// Bool-endpoint för boka.html — ersätter rå customer_profiles SELECT.
//
// Input:  { email } (POST) eller ?email= (GET)
// Output: { auto_delegation_enabled: boolean | null, is_registered: boolean }
// ═══════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPA_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    let email: string | undefined;

    if (req.method === "GET") {
      const url = new URL(req.url);
      email = url.searchParams.get("email") ?? undefined;
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      email = body?.email;
    } else {
      return new Response(
        JSON.stringify({ error: "Use GET or POST" }),
        { status: 405, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!email) {
      return new Response(
        JSON.stringify({ error: "email required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const emailLower = String(email).toLowerCase().trim();

    const { data: profile } = await sb
      .from("customer_profiles")
      .select("auto_delegation_enabled")
      .eq("email", emailLower)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        auto_delegation_enabled: profile?.auto_delegation_enabled ?? null,
        is_registered: !!profile,
      }),
      {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (e) {
    console.error(JSON.stringify({
      level: "error",
      fn: "customer-check-auto-delegation",
      msg: "Unhandled error",
      error: (e as Error).message,
    }));
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
