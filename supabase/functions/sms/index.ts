/**
 * sms – Skicka SMS via 46elks
 *
 * Endpoints:
 * - POST { to, message } → skickar SMS
 *
 * Kräver env-variabler:
 * - ELKS_API_USER
 * - ELKS_API_PASSWORD
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/email.ts";

const ELKS_USER = Deno.env.get("ELKS_API_USER")!;
const ELKS_PASS = Deno.env.get("ELKS_API_PASSWORD")!;

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { to, message } = await req.json();

    if (!to || !message) {
      return new Response(JSON.stringify({ error: "to och message krävs" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Formatera svenskt nummer
    let phone = to.replace(/\s+/g, "");
    if (phone.startsWith("0")) phone = "+46" + phone.slice(1);
    if (!phone.startsWith("+")) phone = "+" + phone;

    const res = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(ELKS_USER + ":" + ELKS_PASS),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        from: "Spick",
        to: phone,
        message,
      }).toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.message || "SMS-fel", details: data }), {
        status: res.status,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: data.id, to: data.to, cost: data.cost }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
