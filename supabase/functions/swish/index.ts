/**
 * SPICK – Swish Betalning Edge Function
 *
 * Produktion: Skaffa Swish Handel via din bank (Handelsbanken, SEB, Swedbank etc.)
 * → Pris: ca 2-3 kr/transaktion
 * → Kräver: Swish-certifikat (PEM) + merchant phone number
 *
 * Docs: https://developer.swish.nu/api/payment-request/v2
 *
 * Flöde:
 * 1. create  → skapar betalningsbegäran, returnerar token/qr
 * 2. status  → kollar betalningsstatus (PAID/DECLINED/ERROR)
 * 3. refund  → återbetalning
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SWISH_CERT      = Deno.env.get("SWISH_CERT_PEM") || "DEMO";
const SWISH_KEY       = Deno.env.get("SWISH_KEY_PEM") || "DEMO";
const SWISH_NUMBER    = Deno.env.get("SWISH_MERCHANT_NUMBER") || "1234679304"; // Test-nr
const SWISH_URL       = SWISH_CERT === "DEMO"
  ? "https://mss.cpc.getswish.net/swish-cpcapi/api/v2"   // Testmiljö
  : "https://cpc.getswish.net/swish-cpcapi/api/v2";       // Produktion
const SUPABASE_URL    = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_URL        = "https://spick.se";

const CORS = {
  "Access-Control-Allow-Origin": "https://spick.se",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { action, bookingId, amount, phone, message } = await req.json();

    // ─── DEMO-LÄGE ──────────────────────────────────────────────────
    if (SWISH_CERT === "DEMO") {
      if (action === "create") {
        const demoToken = "demo-swish-" + crypto.randomUUID();
        // Spara "demo-betalning" i DB
        await sb.from("bookings").update({
          swish_payment_id: demoToken,
          payment_method: "swish",
          payment_status: "pending",
        }).eq("id", bookingId);

        return json({
          demo: true,
          token: demoToken,
          swishUrl: `swish://payment?token=${demoToken}`,
          qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=swish://payment?token=${demoToken}`,
          message: "DEMO: Konfigurera Swish Handel via din bank för produktionsläge",
        });
      }
      if (action === "status") {
        return json({ status: "PAID", demo: true });
      }
      if (action === "simulate_paid") {
        // För testning – simulera betald
        await sb.from("bookings").update({
          payment_status: "paid",
          paid_at: new Date().toISOString(),
        }).eq("id", bookingId);
        return json({ ok: true, status: "PAID" });
      }
    }

    // ─── PRODUKTION: RIKTIGA SWISH-API ──────────────────────────────
    if (action === "create") {
      const instructionId = crypto.randomUUID().replace(/-/g, "").toUpperCase().slice(0, 32);
      
      const payload = {
        callbackUrl: `${SUPABASE_URL}/functions/v1/swish?action=callback`,
        payeeAlias: SWISH_NUMBER,
        currency: "SEK",
        amount: amount.toString(),
        message: message || `Spick-bokning #${bookingId?.slice(0,8)}`,
        ...(phone ? { payerAlias: phone.replace(/[^0-9]/g, "") } : {}),
      };

      const res = await fetch(`${SWISH_URL}/paymentrequests/${instructionId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          // I produktion: SSL-certifikat bifogas via fetch-options
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 201) {
        const location = res.headers.get("Location") || "";
        const paymentId = location.split("/").pop() || instructionId;
        
        await sb.from("bookings").update({
          swish_payment_id: paymentId,
          payment_method: "swish",
          payment_status: "pending",
        }).eq("id", bookingId);

        return json({
          paymentId,
          token: instructionId,
          swishUrl: `swish://payment?token=${instructionId}`,
          qrCode: `https://mpc.getswish.net/qrg/api/v1/prefilled?token=${instructionId}`,
        });
      }
      
      const err = await res.json();
      throw new Error(err[0]?.errorMessage || "Swish-fel");
    }

    if (action === "status") {
      const { paymentId } = await req.json();
      const res = await fetch(`${SWISH_URL}/paymentrequests/${paymentId}`);
      const data = await res.json();
      
      if (data.status === "PAID") {
        await sb.from("bookings").update({
          payment_status: "paid",
          paid_at: new Date().toISOString(),
        }).eq("id", bookingId);
      }
      
      return json({ status: data.status });
    }

    if (action === "refund") {
      const { paymentId, refundAmount } = await req.json();
      const refundId = crypto.randomUUID().replace(/-/g, "").toUpperCase().slice(0, 32);
      
      const res = await fetch(`${SWISH_URL}/refunds/${refundId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalPaymentReference: paymentId,
          callbackUrl: `${SUPABASE_URL}/functions/v1/swish?action=callback`,
          payerAlias: SWISH_NUMBER,
          amount: refundAmount.toString(),
          currency: "SEK",
          message: "Återbetalning från Spick",
        }),
      });
      
      if (res.status === 201) {
        await sb.from("bookings").update({ payment_status: "refunded" }).eq("id", bookingId);
        return json({ ok: true, refundId });
      }
      throw new Error("Återbetalning misslyckades");
    }

    // Swish callback (webhook från Swish)
    if (action === "callback") {
      const data = await req.json();
      if (data.status === "PAID" && data.payeePaymentReference) {
        await sb.from("bookings")
          .update({ payment_status: "paid", paid_at: new Date().toISOString() })
          .eq("swish_payment_id", data.id);
      }
      return new Response("OK", { status: 200 });
    }

    return json({ error: "Okänd action" }, 400);

  } catch (e) {
    console.error("Swish-fel:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
