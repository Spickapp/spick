import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://spick.se",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function encryptPNR(pnr) {
  const keyHex = Deno.env.get("PNR_ENCRYPTION_KEY");
  if (!keyHex) throw new Error("PNR_ENCRYPTION_KEY not configured");
  const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(pnr);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { session_id, cleaner_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id krävs" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ticApiKey = Deno.env.get("TIC_API_KEY");
    if (!ticApiKey) throw new Error("TIC_API_KEY not configured");

    const ticResponse = await fetch(
      `https://id.tic.io/api/v1/auth/${session_id}/collect`,
      { method: "GET", headers: { "X-Api-Key": ticApiKey, "Content-Type": "application/json" } }
    );

    if (!ticResponse.ok) {
      console.error("TIC API error:", ticResponse.status);
      return new Response(JSON.stringify({ error: "Kunde inte verifiera BankID-session" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await ticResponse.json();
    if (session.status !== "complete") {
      return new Response(JSON.stringify({ error: "BankID-verifiering ej slutförd", status: session.status }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { personalNumber, givenName, surname, name } = session.user;
    if (!personalNumber) {
      return new Response(JSON.stringify({ error: "Personnummer saknas" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const encryptedPNR = await encryptPNR(personalNumber);
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    if (cleaner_id) {
      await supabase.from("cleaners").update({
        bankid_verified: true,
        bankid_verified_at: new Date().toISOString(),
        bankid_name: name,
        personal_number_encrypted: encryptedPNR,
        bankid_session_id: session_id,
      }).eq("id", cleaner_id);
    } else {
      await supabase.from("bankid_verifications").insert({
        session_id,
        personal_number_encrypted: encryptedPNR,
        bankid_name: name,
        given_name: givenName,
        surname,
        verified_at: new Date().toISOString(),
        used: false,
      });
    }

    return new Response(JSON.stringify({
      success: true, verified: true, name, given_name: givenName, surname,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("bankid-verify error:", err);
    return new Response(JSON.stringify({ error: "Internt serverfel" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
