/**
 * stripe-connect – Automatisk utbetalning till städare via Stripe Connect
 *
 * Flöde:
 * 1. Städare onboardas med Stripe Express (Connect)
 * 2. Efter betald bokning: Spick håller 17% provision, betalar ut 83% till städaren
 * 3. Utbetalning sker automatiskt 1-2 bankdagar efter städning
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const STRIPE_SECRET_KEY    = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL         = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY")!;
const BASE_URL             = "https://spick.se";
const FROM                 = "Spick <hello@spick.se>";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Stripe API helper ─────────────────────────────────────────────────────
async function stripe(path: string, method = "GET", body?: Record<string, unknown>) {
  const opts: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2023-10-16",
    },
  };
  if (body) {
    opts.body = new URLSearchParams(
      Object.entries(body).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map(i => [k, String(i)]) : [[k, String(v)]]
      )
    ).toString();
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts);
  return res.json();
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const { action, ...params } = await req.json();

  try {
    // ── 1. Skapa Stripe Connect-konto för ny städare ──────────
    if (action === "onboard_cleaner") {
      const { cleaner_id, email, name } = params;

      // Skapa Express-konto i Stripe
      const account = await stripe("/accounts", "POST", {
        type: "express",
        country: "SE",
        email,
        capabilities: { transfers: { requested: "true" } },
        business_type: "individual",
        "individual[email]": email,
        "individual[first_name]": name?.split(" ")[0] || "",
        "individual[last_name]":  name?.split(" ").slice(1).join(" ") || "",
        "settings[payouts][schedule][interval]": "manual",
        "metadata[cleaner_id]": cleaner_id,
      });

      if (account.error) throw new Error(account.error.message);

      // Spara stripe_account_id på städaren
      await sb.from("cleaners").update({
        stripe_account_id: account.id,
        stripe_onboarding_status: "pending",
      }).eq("id", cleaner_id);

      // Skapa onboarding-länk (städaren fyller i sina uppgifter)
      const link = await stripe("/account_links", "POST", {
        account: account.id,
        refresh_url: `${BASE_URL}/stadare-dashboard.html?stripe=refresh`,
        return_url:  `${BASE_URL}/stadare-dashboard.html?stripe=success`,
        type: "account_onboarding",
      });

      return new Response(JSON.stringify({ ok: true, onboarding_url: link.url, account_id: account.id }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // ── 2. Betala ut till städare efter genomförd städning ────
    if (action === "payout_cleaner") {
      const { booking_id } = params;

      // Hämta bokning + städare
      const { data: booking } = await sb.from("bookings").select("*, cleaners(stripe_account_id, full_name, email)").eq("id", booking_id).single();

      if (!booking) throw new Error("Bokning hittades inte");
      if (booking.payout_status === "paid") {
        return new Response(JSON.stringify({ ok: false, reason: "Redan utbetald" }), {
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }

      const cleaner         = booking.cleaners;
      const stripeAccountId = cleaner?.stripe_account_id;

      if (!stripeAccountId) throw new Error("Städaren saknar Stripe-konto");

      const totalPaid    = Number(booking.total_price) * 2; // bruttopris (kund betalar 50%)
      const cleanerShare = Math.round(totalPaid * 0.83);    // 83% till städaren i öre
      const cleanerOre   = cleanerShare * 100;

      // Skapa transfer till städarens Stripe-konto
      const transfer = await stripe("/transfers", "POST", {
        amount: cleanerOre,
        currency: "sek",
        destination: stripeAccountId,
        description: `Spick bokning ${booking_id} – ${booking.service_type || "Städning"} ${booking.booking_date || ""}`,
        "metadata[booking_id]": booking_id,
        "metadata[cleaner_id]": booking.cleaner_id,
      });

      if (transfer.error) throw new Error(transfer.error.message);

      // Uppdatera bokning
      await sb.from("bookings").update({
        payout_status:    "paid",
        payout_amount:    cleanerShare,
        stripe_transfer_id: transfer.id,
        paid_out_at:      new Date().toISOString(),
      }).eq("id", booking_id);

      // Mail till städaren
      if (cleaner?.email) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM,
            to: cleaner.email,
            subject: `💰 Utbetalning ${cleanerShare.toLocaleString("sv")} kr – Spick`,
            html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#F7F7F5;padding:32px">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:32px">
  <h2 style="color:#0F6E56">Utbetalning skickad! 💰</h2>
  <p>Hej ${cleaner.full_name?.split(" ")[0]}!</p>
  <p>Din ersättning för bokning ${booking.booking_date || ""} har skickats till ditt bankkonto.</p>
  <div style="background:#F7F7F5;border-radius:12px;padding:20px;margin:16px 0">
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E8E8E4">
      <span style="color:#9B9B95">Tjänst</span><span style="font-weight:600">${booking.service_type || "Hemstädning"}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E8E8E4">
      <span style="color:#9B9B95">Datum</span><span style="font-weight:600">${booking.booking_date || "–"}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:12px 0">
      <span style="color:#9B9B95">Utbetalt</span><span style="font-weight:700;color:#0F6E56;font-size:18px">${cleanerShare.toLocaleString("sv")} kr ✓</span>
    </div>
  </div>
  <p style="font-size:13px;color:#9B9B95">Pengarna når ditt konto inom 1–2 bankdagar.</p>
  <a href="${BASE_URL}/stadare-dashboard.html" style="display:inline-block;background:#0F6E56;color:#fff;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600">Se mina utbetalningar →</a>
</div></body></html>`,
          }),
        });
      }

      return new Response(JSON.stringify({ ok: true, transfer_id: transfer.id, amount: cleanerShare }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // ── 3. Hämta onboarding-status för städare ────────────────
    if (action === "check_status") {
      const { cleaner_id } = params;
      const { data: cleaner } = await sb.from("cleaners").select("stripe_account_id").eq("id", cleaner_id).single();
      if (!cleaner?.stripe_account_id) {
        return new Response(JSON.stringify({ onboarded: false }), { headers: { "Content-Type": "application/json", ...CORS } });
      }
      const account = await stripe(`/accounts/${cleaner.stripe_account_id}`);
      const onboarded = account.details_submitted && account.charges_enabled;
      await sb.from("cleaners").update({ stripe_onboarding_status: onboarded ? "complete" : "pending" }).eq("id", cleaner_id);
      return new Response(JSON.stringify({ onboarded, account_id: cleaner.stripe_account_id }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    return new Response(JSON.stringify({ error: "Okänd action" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
