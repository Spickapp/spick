/**
 * SPICK – BankID Edge Function (Signicat/GrandID-redo)
 *
 * Produktion: Sätt GRANDID_API_KEY i Supabase Secrets
 * → Skaffa via: https://www.grandid.com/ eller https://www.signicat.com/
 * → Pris: ca 1-2 kr/autentisering
 *
 * Flöde:
 * 1. start → returnerar sessionId + autoStartToken (öppnar BankID-appen)
 * 2. poll  → returnerar status: pending | complete | failed
 * 3. complete → returnerar namn, personnummer, givenName, surname
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRANDID_KEY   = Deno.env.get("GRANDID_API_KEY") || "DEMO";
const GRANDID_URL   = "https://client.grandid.com";
const SPAR_API_KEY  = Deno.env.get("SPAR_API_KEY") || "DEMO";   // Skatteverket SPAR
const SUPABASE_URL  = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { action, sessionId, personalNumber, bookingId } = await req.json();

    // ─── DEMO-LÄGE (ingen API-nyckel konfigurerad) ──────────────────
    if (GRANDID_KEY === "DEMO") {
      if (action === "start") {
        const demoSession = "demo-" + crypto.randomUUID();
        return json({ 
          sessionId: demoSession, 
          demo: true,
          autoStartToken: "demo-token",
          message: "DEMO: Integrera med GrandID (grandid.com) för riktig BankID"
        });
      }
      if (action === "poll" && sessionId?.startsWith("demo-")) {
        // Simulera 2s fördröjning sedan success
        return json({
          status: "complete",
          demo: true,
          personalNumber: personalNumber || "19900101-1234",
          givenName: "Anna",
          surname: "Andersson",
          name: "Anna Andersson",
        });
      }
    }

    // ─── PRODUKTION: GRANDID ────────────────────────────────────────
    if (action === "start") {
      // Starta BankID-session via GrandID
      const res = await fetch(`${GRANDID_URL}/json1.1/FederatedLogin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: GRANDID_KEY,
          authenticateServiceKey: "bankid",
          callbackUrl: `${SUPABASE_URL}/functions/v1/bankid`,
          userControlledLogin: true,
          requireSameDevice: false,
          ...(personalNumber ? { pnr: personalNumber } : {}),
        }),
      });
      const data = await res.json();
      if (!data.sessionId) throw new Error(data.message || "GrandID-fel");
      
      return json({
        sessionId: data.sessionId,
        autoStartToken: data.autoStartToken,
        qrCode: data.qrCode,
      });
    }

    if (action === "poll") {
      const res = await fetch(
        `${GRANDID_URL}/json1.1/GetSession?apiKey=${GRANDID_KEY}&authenticateServiceKey=bankid&sessionId=${sessionId}`
      );
      const data = await res.json();
      
      if (data.completionData) {
        const user = data.completionData.user;
        const pnr = user.personalNumber;
        
        // Spara i bookings om bookingId finns
        if (bookingId) {
          await sb.from("bookings").update({
            bankid_verified: true,
            bankid_personal_number_hash: await hashPnr(pnr),
            customer_name: user.name,
          }).eq("id", bookingId);
        }
        
        // SPAR-uppslagning för adress (om SPAR_API_KEY konfigurerad)
        let address = null;
        if (SPAR_API_KEY !== "DEMO") {
          address = await sparLookup(pnr);
        }
        
        return json({
          status: "complete",
          personalNumber: pnr,
          givenName: user.givenName,
          surname: user.surname,
          name: user.name,
          address, // null i demo-läge
        });
      }
      
      if (data.errorCode) {
        return json({ status: "failed", error: data.errorCode });
      }
      
      return json({ status: "pending" });
    }

    return json({ error: "Okänd action" }, 400);

  } catch (e) {
    console.error("BankID fel:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

// ── SPAR-uppslagning (Skatteverket personadressregister) ────────────────────
async function sparLookup(pnr: string): Promise<Record<string, string> | null> {
  try {
    // SPAR API: https://www.skatteverket.se/spar
    // Kräver SPAR-avtal med Bolagsverket/SKV
    const res = await fetch("https://api.spar.se/v1/person", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SPAR_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ personnummer: pnr }),
    });
    const data = await res.json();
    if (data.folkbokforingsadress) {
      return {
        street: data.folkbokforingsadress.utdelningsadress2,
        postalCode: data.folkbokforingsadress.postnummer,
        city: data.folkbokforingsadress.postort,
        full: `${data.folkbokforingsadress.utdelningsadress2}, ${data.folkbokforingsadress.postnummer} ${data.folkbokforingsadress.postort}`,
      };
    }
    return null;
  } catch (e) {
    console.warn("SPAR-uppslagning misslyckades:", e);
    return null;
  }
}

async function hashPnr(pnr: string): Promise<string> {
  const clean = pnr.replace(/[^0-9]/g, "");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clean));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
