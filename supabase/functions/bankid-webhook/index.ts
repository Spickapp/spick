import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

async function verifySignature(payload, signature, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return computed === signature;
}

async function encryptPNR(pnr) {
  const keyHex = Deno.env.get("PNR_ENCRYPTION_KEY");
  if (!keyHex) throw new Error("PNR_ENCRYPTION_KEY not configured");
  const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
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
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("X-Ormeo-Signature");
    const timestamp = req.headers.get("X-Ormeo-Timestamp");
    const eventType = req.headers.get("X-Ormeo-Event");
    const webhookSecret = Deno.env.get("TIC_WEBHOOK_SECRET");

    if (webhookSecret && signature) {
      const valid = await verifySignature(rawBody, signature, webhookSecret);
      if (!valid) { console.error("Invalid webhook signature"); return new Response("Invalid signature", { status: 401 }); }
      if (timestamp) {
        const webhookTime = parseInt(timestamp) * 1000;
        if (Math.abs(Date.now() - webhookTime) > 5 * 60 * 1000) return new Response("Timestamp expired", { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event || eventType;

    if (event === "auth.completed") {
      const { sessionId, user, state } = payload.data;
      const { personalNumber, givenName, surname, name } = user;
      if (!personalNumber) { console.error("No personalNumber"); return new Response("OK", { status: 200 }); }

      const encryptedPNR = await encryptPNR(personalNumber);
      const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

      if (state && state.startsWith("cleaner_")) {
        const cleanerId = state.replace("cleaner_", "");
        await supabase.from("cleaners").update({
          bankid_verified: true, bankid_verified_at: new Date().toISOString(),
          bankid_name: name, personal_number_encrypted: encryptedPNR, bankid_session_id: sessionId,
        }).eq("id", cleanerId);
      } else {
        await supabase.from("bankid_verifications").insert({
          session_id: sessionId, personal_number_encrypted: encryptedPNR,
          bankid_name: name, given_name: givenName, surname, verified_at: new Date().toISOString(), used: false,
        });
      }
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("bankid-webhook error:", err);
    return new Response("OK", { status: 200 });
  }
});