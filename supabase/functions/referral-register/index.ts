import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const sb = createClient(
  "https://urjeijcncsyuletprydy.supabase.co",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const url = new URL(req.url);

    // GET: validate referral code
    if (req.method === "GET") {
      const code = url.searchParams.get("code");
      if (!code || code.length < 4) {
        return new Response(JSON.stringify({ valid: false }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      // Look up cleaner by referral_code or slug
      const { data: cleaner } = await sb.from("cleaners")
        .select("id, full_name, referral_code, slug")
        .or(`referral_code.eq.${code},slug.eq.${code}`)
        .eq("is_approved", true)
        .single();

      return new Response(JSON.stringify({
        valid: !!cleaner,
        cleaner_name: cleaner?.full_name?.split(" ")[0] || null,
        cleaner_id: cleaner?.id || null
      }), {
        headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // POST: register a referral
    if (req.method === "POST") {
      const { referral_code, customer_email, booking_id } = await req.json();

      if (!referral_code || !customer_email) {
        return new Response(JSON.stringify({ error: "referral_code och customer_email krävs" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      // Find referring cleaner
      const { data: cleaner } = await sb.from("cleaners")
        .select("id, full_name")
        .or(`referral_code.eq.${referral_code},slug.eq.${referral_code}`)
        .eq("is_approved", true)
        .single();

      if (!cleaner) {
        return new Response(JSON.stringify({ error: "Ogiltig referral-kod" }), {
          status: 404, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      // Check if this customer already has a referral
      const { data: existing } = await sb.from("cleaner_referrals")
        .select("id")
        .eq("referred_email", customer_email)
        .single();

      if (existing) {
        return new Response(JSON.stringify({ ok: true, already_registered: true }), {
          headers: { ...CORS, "Content-Type": "application/json" }
        });
      }

      // Register the referral
      const { error } = await sb.from("cleaner_referrals").insert({
        cleaner_id: cleaner.id,
        referred_email: customer_email,
        booking_id: booking_id || null,
        status: "pending"
      });

      if (error) throw error;

      return new Response(JSON.stringify({ ok: true, cleaner_name: cleaner.full_name }), {
        headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    return new Response("Method not allowed", { status: 405, headers: CORS });

  } catch (e) {
    console.error("referral-register error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
