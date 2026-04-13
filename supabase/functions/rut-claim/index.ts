/**
 * rut-claim – Automatisk RUT-ansökan till Skatteverket
 *
 * Anropas av stripe-webhook direkt efter bekräftad betalning om rut=true.
 * Skatteverkets API: ROT och RUT digitala tjänster (XML/REST)
 * Dokumentation: https://www.skatteverket.se/foretagochorganisationer/arbetsgivare/rotochrut
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, decryptPnr } from "../_shared/email.ts";

const SUPABASE_URL         = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SKV_API_URL          = Deno.env.get("SKV_API_URL") || "https://api.skatteverket.se/rot-rut/v1";
const SKV_API_KEY          = Deno.env.get("SKV_API_KEY") ?? "";  // Skatteverket API-nyckel
const SPICK_ORG_NR         = "5594024522";                    // Haghighi Consulting AB org.nr
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY")!;
const FROM                 = "Spick <hello@spick.se>";
const ADMIN                = "hello@spick.se";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Bygg Skatteverket XML-payload ─────────────────────────────────────────
function buildRutXml(booking: Record<string, unknown>): string {
  const bruttoBelopp = Number(booking.total_price) * 2; // kundpris * 2 = brutto (50% RUT)
  const rutBelopp    = Math.floor(bruttoBelopp * 0.5);  // 50% RUT-avdrag
  const arbetskostnad = Math.round(bruttoBelopp * 0.7); // ~70% arbetskostnad av brutto

  return `<?xml version="1.0" encoding="UTF-8"?>
<Ansokan xmlns="http://www.skatteverket.se/schema/rot-rut/v1">
  <Utforare>
    <OrganisationsNummer>${SPICK_ORG_NR}</OrganisationsNummer>
    <Foretagsnamn>Haghighi Consulting AB</Foretagsnamn>
  </Utforare>
  <Kop>
    <KundPersonNummer>${(booking.customer_pnr as string || "").replace(/\D/g, "")}</KundPersonNummer>
    <Fastighetsbeteckning></Fastighetsbeteckning>
    <TjansteTyp>RUT</TjansteTyp>
    <Undertyp>Städning</Undertyp>
    <ArbetskostnadExklMoms>${arbetskostnad * 100}</ArbetskostnadExklMoms>
    <BegartBelopp>${rutBelopp * 100}</BegartBelopp>
    <FakturaNummer>${booking.id}</FakturaNummer>
    <FakturaDatum>${booking.booking_date || new Date().toISOString().split("T")[0]}</FakturaDatum>
    <Betaldatum>${new Date().toISOString().split("T")[0]}</Betaldatum>
  </Kop>
</Ansokan>`;
}

// ── Skicka till Skatteverket ──────────────────────────────────────────────
async function submitToSkatteverket(xml: string): Promise<{
  success: boolean;
  claim_id?: string;
  status?: string;
  error?: string;
  raw?: string;
}> {
  try {
    const res = await fetch(`${SKV_API_URL}/ansokan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=UTF-8",
        "Accept":        "application/json",
        "X-API-Key":     SKV_API_KEY,
      },
      body: xml,
    });

    const raw = await res.text();

    if (res.ok) {
      // Skatteverket returnerar JSON med ärendenummer
      try {
        const data = JSON.parse(raw);
        return {
          success:  true,
          claim_id: data.arendeNummer || data.id || `SKV-${Date.now()}`,
          status:   "submitted",
        };
      } catch {
        return { success: true, claim_id: `SKV-${Date.now()}`, status: "submitted", raw };
      }
    } else {
      return { success: false, error: `HTTP ${res.status}: ${raw}`, raw };
    }
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ── E-post: bekräftelse till kund ─────────────────────────────────────────
async function sendRutConfirmation(booking: Record<string, unknown>, claimId: string) {
  const email = booking.customer_email as string;
  const name  = ((booking.customer_name || "Kund") as string).split(" ")[0];
  const bruttoBelopp = Number(booking.total_price) * 2;
  const rutBelopp    = Math.floor(bruttoBelopp * 0.5);

  if (!email) return;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{margin:0;padding:0;background:#F7F7F5;font-family:'DM Sans',Arial,sans-serif}
.wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)}
.header{background:#0F6E56;padding:24px 32px}.logo{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff}
.body{padding:32px}.footer{padding:16px 32px;background:#F7F7F5;font-size:12px;color:#9E9E9A;text-align:center}
h2{font-family:Georgia,serif;font-size:20px;color:#1C1C1A;margin:0 0 12px}
p{color:#6B6960;line-height:1.7;font-size:15px;margin:0 0 12px}
.card{background:#F7F7F5;border-radius:12px;padding:20px;margin:16px 0}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E8E8E4;font-size:14px}
.row:last-child{border:none;padding-top:12px}.row .lbl{color:#9B9B95}.row .val{font-weight:600;color:#1C1C1A}
.badge{display:inline-block;background:#E1F5EE;color:#0F6E56;padding:8px 16px;border-radius:100px;font-size:13px;font-weight:600;margin:8px 0}
.btn{display:inline-block;background:#0F6E56;color:#fff;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px;margin-top:8px}
</style></head><body>
<div class="wrap">
  <div class="header"><div class="logo">Spick</div></div>
  <div class="body">
    <h2>RUT-avdrag ansökt! 💚</h2>
    <p>Hej ${name}! Vi har automatiskt skickat din RUT-ansökan till Skatteverket. Du behöver inte göra något mer.</p>
    <div class="badge">✓ RUT-ärendenummer: ${claimId}</div>
    <div class="card">
      <div class="row"><span class="lbl">Tjänst</span><span class="val">${booking.service_type || "Hemstädning"}</span></div>
      <div class="row"><span class="lbl">Städdatum</span><span class="val">${booking.booking_date || "–"}</span></div>
      <div class="row"><span class="lbl">Bruttopris</span><span class="val">${bruttoBelopp.toLocaleString("sv")} kr</span></div>
      <div class="row"><span class="lbl">RUT-avdrag (50%)</span><span class="val" style="color:#0F6E56">−${rutBelopp.toLocaleString("sv")} kr</span></div>
      <div class="row"><span class="lbl">Du betalade</span><span class="val" style="color:#0F6E56;font-size:18px">${Number(booking.total_price).toLocaleString("sv")} kr ✓</span></div>
    </div>
    <p style="font-size:13px;color:#9B9B95">Skatteverket hanterar RUT-ansökan och betalar ut ${rutBelopp.toLocaleString("sv")} kr direkt till Spick. Processen tar normalt 1–5 bankdagar.</p>
    <a class="btn" href="https://spick.se/min-bokning.html">Följ din bokning →</a>
  </div>
  <div class="footer">Spick · 559402-4522 · hello@spick.se · spick.se</div>
</div></body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: email, subject: `💚 RUT-avdrag ansökt – ärendenr ${claimId}`, html }),
  });
}

// ── Huvud-handler ─────────────────────────────────────────────────────────
serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { booking_id } = await req.json();

    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id krävs" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Hämta bokning från Supabase
    const { data: booking, error: fetchError } = await sb
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .single();

    if (fetchError || !booking) {
      return new Response(JSON.stringify({ error: "Bokning hittades inte" }), {
        status: 404, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Kontrollera att bokningen är betald och har RUT
    if (!booking.rut_amount) {
      return new Response(JSON.stringify({ ok: false, reason: "Ingen RUT på denna bokning" }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Kontrollera att vi har ett riktigt personnummer (inte en hash)
    const rawPnr = booking.customer_pnr as string || "";
    const pnr = (rawPnr.length > 15 ? await decryptPnr(rawPnr) : rawPnr).replace(/\D/g, "");
    booking.customer_pnr = pnr; // Uppdatera med dekrypterat värde för buildRutXml
    if (!pnr || pnr.length < 10 || pnr.startsWith("DEMO")) {
      console.warn("rut-claim: customer_pnr saknas eller är ogiltig — skickar admin-varning");
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: FROM,
          to: ADMIN,
          subject: `⚠️ RUT-ansökan blockerad: PNR saknas för bokning ${booking_id}`,
          html: `<p>RUT-bokning kunde inte skickas till Skatteverket — personnumret saknas eller är en gammal SHA-256-hash.</p>
<p>Bokning: <strong>${booking_id}</strong><br>
Kund: ${booking.customer_name} &lt;${booking.customer_email}&gt;<br>
PNR-fält: <code>${booking.customer_pnr || "(tomt)"}</code></p>
<p>Hantera manuellt i Skatteverkets e-tjänst:<br>
<a href="https://www.skatteverket.se/foretagochorganisationer/arbetsgivare/rotochrut">skatteverket.se/rot-rut</a></p>`,
        }),
      }).catch((e: Error) => console.error("Admin mail error:", e.message));

      await sb.from("bookings").update({
        rut_claim_status: "blocked_missing_pnr",
      }).eq("id", booking_id);

      return new Response(
        JSON.stringify({ ok: false, reason: "customer_pnr saknas — admin notifierad" }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    if (booking.payment_status !== "paid") {
      return new Response(JSON.stringify({ ok: false, reason: "Bokningen är inte betald" }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    if (booking.rut_claim_id) {
      return new Response(JSON.stringify({ ok: true, reason: "RUT redan ansökt", claim_id: booking.rut_claim_id }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Guard: SKV_API_KEY saknas → skicka varningsmail och returnera pending
    if (!SKV_API_KEY) {
      console.warn("rut-claim: SKV_API_KEY ej satt — skickar varning till admin");
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: ADMIN,
          subject: `⚠️ RUT-ansökan väntar: SKV_API_KEY saknas`,
          html: `<p>En RUT-bokning har betalats men kunde inte skickas till Skatteverket eftersom <strong>SKV_API_KEY</strong> inte är satt som Supabase-secret.</p>
<p>Bokning: <strong>${booking_id}</strong><br>
Kund: ${booking.customer_name} &lt;${booking.customer_email}&gt;<br>
Belopp: ${Number(booking.total_price).toLocaleString("sv")} kr</p>
<p>Sätt nyckeln med:<br>
<code>npx supabase secrets set SKV_API_KEY=&lt;din-nyckel&gt;</code></p>`,
        }),
      }).catch((e: Error) => console.error("Admin mail error:", e.message));

      await sb.from("bookings").update({
        rut_claim_status: "pending_api_key",
      }).eq("id", booking_id);

      return new Response(
        JSON.stringify({ ok: false, reason: "SKV_API_KEY saknas – admin notifierad" }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Skicka XML till Skatteverket
    const xml    = buildRutXml(booking);
    const result = await submitToSkatteverket(xml);

    // Uppdatera bokning med RUT-status
    await sb.from("bookings").update({
      rut_claim_id:     result.claim_id || null,
      rut_claim_status: result.success ? "submitted" : "failed",
      rut_claim_error:  result.error || null,
      rut_submitted_at: result.success ? new Date().toISOString() : null,
      customer_pnr:     null,   // ← Radera PNR direkt efter ansökan
    }).eq("id", booking_id);

    // Logga i rut_claims-tabell
    await sb.from("rut_claims").insert({
      booking_id,
      claim_id:   result.claim_id,
      status:     result.success ? "submitted" : "failed",
      amount:     Math.round(Number(booking.total_price)),
      xml_sent:   xml,
      response:   result.raw || result.error,
    }).catch((e) => { console.warn("rut-claim: suppressed error", e); }); // Ignorera om tabellen inte finns än

    if (result.success) {
      // Skicka bekräftelsemail till kund
      await sendRutConfirmation(booking, result.claim_id!);

      // Notifiera admin
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM, to: ADMIN,
          subject: `✅ RUT ansökt: ${booking.customer_name} – ${result.claim_id}`,
          html: `<p>RUT-ansökan skickad till Skatteverket.<br>Bokning: ${booking_id}<br>Ärendenummer: ${result.claim_id}<br>Belopp: ${Math.round(Number(booking.total_price)).toLocaleString("sv")} kr</p>`,
        }),
      });
    }

    return new Response(JSON.stringify({ ok: result.success, ...result }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
