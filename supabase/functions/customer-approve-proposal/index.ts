/**
 * customer-approve-proposal — Kund svarar på VD:s ersättarförslag
 *
 * Input: { booking_id, customer_email, decision }
 * decision: "approve" | "reject" | "refund" | "choose_self"
 *
 * Verifierar:
 *   - booking har status='awaiting_customer_approval'
 *   - customer_email matchar
 *   - reassignment_proposed_cleaner_id är satt
 *
 * Branching:
 *   - approve: cleaner_id = proposed, status='confirmed'
 *   - reject: status=awaiting_company_proposal (VD får ny chans)
 *   - choose_self: status=awaiting_reassignment (kund väljer)
 *   - refund: status='cancelled', stripe-refund triggas
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, card, log, ADMIN } from "../_shared/email.ts";
import { notify } from "../_shared/notifications.ts";
import { formatStockholmDate } from "../_shared/timezone.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { booking_id, customer_email, decision } = await req.json();
    if (!booking_id || !customer_email || !decision) {
      return json({ error: "booking_id, customer_email och decision krävs" }, 400, CORS);
    }

    const validDecisions = ["approve", "reject", "refund", "choose_self"];
    if (!validDecisions.includes(decision)) {
      return json({ error: `decision måste vara en av: ${validDecisions.join(", ")}` }, 400, CORS);
    }

    // ── FETCH BOOKING ─────────────────────────────────
    const { data: booking } = await sb
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .maybeSingle();

    if (!booking) return json({ error: "Bokning hittades inte" }, 404, CORS);
    if (booking.customer_email !== customer_email) {
      return json({ error: "E-post matchar inte bokningen" }, 403, CORS);
    }
    if (booking.status !== "awaiting_customer_approval") {
      return json({ error: `Bokningen har status ${booking.status}, ingen proposal att svara på` }, 409, CORS);
    }
    if (!booking.reassignment_proposed_cleaner_id) {
      return json({ error: "Ingen föreslagen städare finns" }, 409, CORS);
    }

    const now = new Date().toISOString();

    // ═════════════════════════════════════════════════
    // APPROVE — godkänn föreslagen städare
    // ═════════════════════════════════════════════════
    if (decision === "approve") {
      const { data: newCleaner } = await sb
        .from("cleaners")
        .select("id, full_name, email, company_id")
        .eq("id", booking.reassignment_proposed_cleaner_id)
        .single();

      if (!newCleaner) return json({ error: "Föreslagen städare finns inte längre" }, 404, CORS);

      let displayName = newCleaner.full_name;
      if (newCleaner.company_id) {
        const { data: company } = await sb
          .from("companies")
          .select("display_name, name")
          .eq("id", newCleaner.company_id)
          .single();
        if (company) {
          displayName = `${newCleaner.full_name} (${company.display_name || company.name})`;
        }
      }

      await sb.from("bookings").update({
        status: "confirmed",
        cleaner_id: newCleaner.id,
        cleaner_name: displayName,
        reassignment_proposed_cleaner_id: null,
        reassignment_proposed_at: null,
      }).eq("id", booking_id);

      // Notifiera ny städare
      if (newCleaner.email) {
        await sendEmail(newCleaner.email, `Bokning bekräftad av kund`, wrap(`
          <h2>Din bokning är bekräftad</h2>
          <p>Hej ${esc(newCleaner.full_name)},</p>
          <p>Kunden har godkänt dig som ersättare. Bokningen är nu bekräftad:</p>
          ${card([
            ["Kund", esc(booking.customer_name)],
            ["Datum & tid", `${formatStockholmDate(booking.booking_date)} kl ${esc(booking.booking_time)}`],
            ["Adress", esc(booking.address || "-")],
          ])}
        `));

        // SMS + push + in-app till städare
        const { data: cleanerPhone } = await sb
          .from("cleaners")
          .select("phone")
          .eq("id", newCleaner.id)
          .single();

        await notify({
          cleaner_id: newCleaner.id,
          email: newCleaner.email,
          phone: cleanerPhone?.phone || undefined,
          sms_message: `Spick: Kunden godkände dig för bokningen ${formatStockholmDate(booking.booking_date)} kl ${booking.booking_time}. Du har ett bekräftat uppdrag!`,
          push_type: "proposal_approved",
          push_data: {
            date: formatStockholmDate(booking.booking_date),
            booking_id,
          },
          in_app: {
            title: "Bokning bekräftad",
            body: `Kunden godkände dig för ${formatStockholmDate(booking.booking_date)}`,
            type: "proposal_approved",
            job_id: booking_id,
          },
        });
      }

      log("info", "customer-approve-proposal", "Proposal approved", { booking_id });
      return json({ success: true, message: "Tack! Bokningen är nu bekräftad." }, 200, CORS);
    }

    // ═════════════════════════════════════════════════
    // REJECT — kunden avböjer förslaget, VD får ny chans
    // ═════════════════════════════════════════════════
    if (decision === "reject") {
      await sb.from("bookings").update({
        status: "awaiting_company_proposal",
        reassignment_proposed_cleaner_id: null,
        reassignment_proposed_at: null,
      }).eq("id", booking_id);

      log("info", "customer-approve-proposal", "Proposal rejected by customer", { booking_id });
      return json({
        success: true,
        message: "Förslaget avböjt. Företaget kommer föreslå en annan ersättare."
      }, 200, CORS);
    }

    // ═════════════════════════════════════════════════
    // CHOOSE_SELF — kunden vill välja själv från alla
    // ═════════════════════════════════════════════════
    if (decision === "choose_self") {
      await sb.from("bookings").update({
        status: "awaiting_reassignment",
        cleaner_id: null,
        cleaner_name: null,
        reassignment_proposed_cleaner_id: null,
        reassignment_proposed_at: null,
      }).eq("id", booking_id);

      log("info", "customer-approve-proposal", "Customer chose self-select", { booking_id });
      return json({
        success: true,
        message: "Du kan nu välja ersättare själv via min-bokning."
      }, 200, CORS);
    }

    // ═════════════════════════════════════════════════
    // REFUND — avboka och återbetala
    // ═════════════════════════════════════════════════
    if (decision === "refund") {
      // Använd befintlig booking-reassign EF med action=refund
      const refundRes = await fetch(`${SUPA_URL}/functions/v1/booking-reassign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          booking_id,
          customer_email,
          action: "refund",
        }),
      });

      if (!refundRes.ok) {
        const err = await refundRes.text();
        log("error", "customer-approve-proposal", "Refund failed", { booking_id, err });
        return json({ error: "Återbetalning misslyckades. Kontakta support." }, 500, CORS);
      }

      log("info", "customer-approve-proposal", "Refund initiated", { booking_id });
      return json({
        success: true,
        message: "Återbetalning är påbörjad. Du får pengarna inom 5-10 dagar."
      }, 200, CORS);
    }

    return json({ error: "Okänd decision" }, 400, CORS);

  } catch (err) {
    log("error", "customer-approve-proposal", "Unhandled error", { error: (err as Error).message });
    return json({ error: (err as Error).message }, 500, CORS);
  }
});

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
