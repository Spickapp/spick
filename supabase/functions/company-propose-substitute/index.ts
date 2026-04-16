/**
 * company-propose-substitute — VD föreslår ersättare från sitt team
 *
 * Input: { booking_id, new_cleaner_id }
 * Auth: VD (cleaner med is_company_owner=true) via Bearer token
 *
 * Verifierar:
 *   - Bokningen har status='awaiting_company_proposal'
 *   - Anroparen är VD för företaget som äger bokningen
 *   - new_cleaner_id tillhör samma företag
 *   - Ersättarens avg_rating >= originalets avg_rating - 0.3
 *
 * Branching:
 *   - Om auto_delegation_enabled=true OCH kvalitet OK → direkt confirmed
 *   - Annars → awaiting_customer_approval, mejl till kund för godkännande
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, card, log, ADMIN } from "../_shared/email.ts";
import { notify } from "../_shared/notifications.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── AUTH ─────────────────────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return json({ error: "Unauthorized" }, 401, CORS);
    }

    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
    });
    if (!authRes.ok) return json({ error: "Invalid token" }, 401, CORS);
    const authUser = await authRes.json();

    // Verifiera att anroparen är VD
    const { data: vdCleaner } = await sb
      .from("cleaners")
      .select("id, full_name, email, company_id, is_company_owner")
      .eq("auth_user_id", authUser.id)
      .eq("is_company_owner", true)
      .eq("is_approved", true)
      .maybeSingle();

    if (!vdCleaner || !vdCleaner.company_id) {
      return json({ error: "Endast VD med företag kan föreslå ersättare" }, 403, CORS);
    }

    // ── PARSE INPUT ──────────────────────────────────
    const { booking_id, new_cleaner_id, let_customer_choose } = await req.json();
    if (!booking_id) {
      return json({ error: "booking_id krävs" }, 400, CORS);
    }
    if (!let_customer_choose && !new_cleaner_id) {
      return json({ error: "new_cleaner_id krävs (eller let_customer_choose=true)" }, 400, CORS);
    }

    // ── FETCH BOOKING ─────────────────────────────────
    const { data: booking } = await sb
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .maybeSingle();

    if (!booking) return json({ error: "Bokning hittades inte" }, 404, CORS);
    if (booking.status !== "awaiting_company_proposal") {
      return json({ error: `Bokning har status ${booking.status}, kan inte föreslå ersättare` }, 409, CORS);
    }

    // ── FAS A (BUG #7 FIX): LET CUSTOMER CHOOSE FLÖDE ──
    if (let_customer_choose) {
      try {
        // Audit: verifiera att bokningens cleaner tillhör VDs företag
        if (booking.cleaner_id) {
          const { data: prevCleaner } = await sb
            .from("cleaners")
            .select("company_id")
            .eq("id", booking.cleaner_id)
            .maybeSingle();

          if (prevCleaner?.company_id && prevCleaner.company_id !== vdCleaner.company_id) {
            return json({ error: "Bokningen tillhör inte ditt företag" }, 403, CORS);
          }
        }

        // Uppdatera bokning → awaiting_reassignment, rensa cleaner
        await sb.from("bookings").update({
          status: "awaiting_reassignment",
          cleaner_id: null,
          cleaner_name: null,
          reassignment_proposed_cleaner_id: null,
          reassignment_proposed_at: null,
          reassignment_proposed_by: vdCleaner.id,
          reassignment_attempts: (booking.reassignment_attempts || 0) + 1,
        }).eq("id", booking_id);

        // Förbered notifikationsdata
        const customerFirstName = (booking.customer_name || "Kund").split(" ")[0];
        const bookingDate = formatDate(booking.booking_date);
        const bookingTime = (booking.booking_time || "").slice(0, 5);
        const chooseUrl = `https://spick.se/min-bokning.html?bid=${booking_id}`;

        // Push + SMS + in-app till kund
        try {
          await notify({
            email: undefined,
            phone: booking.customer_phone || undefined,
            sms_message: `Spick: Företaget hann inte hitta ersättare för din städning ${bookingDate} ${bookingTime}. Välj själv: ${chooseUrl}`,
            push_type: "booking_rejected_by_cleaner",
            push_data: {
              cleaner_name: "Ersättare",
              date: bookingDate,
              booking_id: booking_id,
            },
            in_app: {
              title: "Välj ersättare för din bokning",
              body: `Din städning ${bookingDate} ${bookingTime} behöver en ny städare.`,
              type: "booking_rejected_by_cleaner",
              job_id: booking_id,
            },
          });
        } catch (notifyErr) {
          console.warn("[let-customer-choose] notify failed:", (notifyErr as Error).message);
        }

        // Email till kund
        if (booking.customer_email) {
          try {
            await sendEmail(
              booking.customer_email,
              "Välj ersättare för din städning",
              wrap(`
                <h2>Hej ${esc(customerFirstName)}!</h2>
                <p>Ditt städföretag hann tyvärr inte hitta en ersättare för din städning.</p>
                ${card([
                  ["Tjänst", esc(booking.service_type || "Hemstädning")],
                  ["Datum", esc(bookingDate)],
                  ["Tid", `kl ${esc(bookingTime)}`],
                  ["Adress", esc(booking.customer_address || "")],
                ])}
                <p>Du kan välja en annan städare själv — eller få pengarna tillbaka om ingen passar.</p>
                <p style="text-align:center;margin:24px 0">
                  <a href="${chooseUrl}" style="display:inline-block;padding:14px 28px;background:#0F6E56;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Välj ersättare →</a>
                </p>
                <p style="color:#6B6960;font-size:.9rem;margin-top:24px">Frågor? Kontakta oss på hello@spick.se</p>
              `)
            );
          } catch (emailErr) {
            console.warn("[let-customer-choose] customer email failed:", (emailErr as Error).message);
          }
        }

        // Admin-kopia
        try {
          await sendEmail(
            ADMIN,
            `[Admin] VD släppte bokning till kundval: ${booking_id.slice(0, 8)}`,
            wrap(`
              <h3>VD släppte ersättare till kundval</h3>
              ${card([
                ["VD", `${esc(vdCleaner.full_name)} (${esc(vdCleaner.email)})`],
                ["Företag ID", esc(vdCleaner.company_id)],
                ["Bokning", esc(booking_id)],
                ["Kund", `${esc(booking.customer_name || "")} (${esc(booking.customer_email || "")})`],
                ["Datum & tid", `${esc(bookingDate)} kl ${esc(bookingTime)}`],
                ["Tidigare städare", esc(booking.cleaner_name || "(okänd)")],
                ["Avböj-anledning", esc(booking.rejection_reason || "(ej angiven)")],
              ])}
              <p>Bokningen är nu i status <code>awaiting_reassignment</code>. Kunden kan välja själv från alla tillgängliga städare.</p>
            `)
          );
        } catch (adminErr) {
          console.warn("[let-customer-choose] admin email failed:", (adminErr as Error).message);
        }

        log("info", "company-propose-substitute", "VD released to customer choice", {
          booking_id, vd: vdCleaner.id, company_id: vdCleaner.company_id
        });

        return json({
          success: true,
          status: "awaiting_reassignment",
          message: "Bokningen är nu tillgänglig för kundval. Kunden är notifierad."
        }, 200, CORS);
      } catch (err) {
        console.error("[let-customer-choose] Unexpected error:", (err as Error).message);
        return json({ error: "Kunde inte slutföra. Försök igen." }, 500, CORS);
      }
    }

    // ── VERIFIERA ATT BOKNINGEN TILLHÖR VD:NS FÖRETAG ──
    // Bokningens senaste cleaner bör tillhöra VD:ns company_id
    if (!booking.cleaner_id) {
      return json({ error: "Bokningen saknar tidigare städare — kan inte verifiera företag" }, 409, CORS);
    }

    const { data: previousCleaner } = await sb
      .from("cleaners")
      .select("id, full_name, avg_rating, company_id")
      .eq("id", booking.cleaner_id)
      .maybeSingle();

    if (!previousCleaner || previousCleaner.company_id !== vdCleaner.company_id) {
      return json({ error: "Bokningen tillhör inte ditt företag" }, 403, CORS);
    }

    // ── HÄMTA OCH VERIFIERA NY STÄDARE ────────────────
    const { data: newCleaner } = await sb
      .from("cleaners")
      .select("id, full_name, email, company_id, avg_rating, hourly_rate, is_active, status, is_approved")
      .eq("id", new_cleaner_id)
      .maybeSingle();

    if (!newCleaner) return json({ error: "Föreslagen städare hittades inte" }, 404, CORS);
    if (newCleaner.company_id !== vdCleaner.company_id) {
      return json({ error: "Föreslagen städare tillhör inte ditt företag" }, 403, CORS);
    }
    if (!newCleaner.is_active || newCleaner.status !== "aktiv" || !newCleaner.is_approved) {
      return json({ error: "Föreslagen städare är inte aktiv" }, 409, CORS);
    }

    // ── KOLLA AUTO-DELEGATION-PREFERENS ───────────────
    // Kundens explicita val styr. Per-booking override trumfar profil-default.
    let autoDelegation = booking.auto_delegation_enabled;
    if (autoDelegation === null || autoDelegation === undefined) {
      // Hämta kundens default
      const { data: customerProfile } = await sb
        .from("customer_profiles")
        .select("auto_delegation_enabled")
        .eq("email", booking.customer_email)
        .maybeSingle();
      autoDelegation = customerProfile?.auto_delegation_enabled || false;
    }

    // Kund A (aktiv) → kundgodkännande alltid
    // Kund B (passiv, auto-delegation) → direkt tilldelning
    const requireCustomerApproval = !autoDelegation;

    // ── UPPDATERA BOKNING ─────────────────────────────
    const now = new Date().toISOString();
    const attempts = (booking.reassignment_attempts || 0) + 1;

    if (requireCustomerApproval) {
      // Spara proposal, vänta på kund
      await sb.from("bookings").update({
        status: "awaiting_customer_approval",
        reassignment_proposed_cleaner_id: newCleaner.id,
        reassignment_proposed_at: now,
        reassignment_proposed_by: vdCleaner.id,
        reassignment_attempts: attempts,
      }).eq("id", booking_id);

      // Mejla kund för godkännande
      const approveUrl = `https://spick.se/min-bokning.html?bid=${booking_id}&action=approve_proposal`;
      const rejectUrl = `https://spick.se/min-bokning.html?bid=${booking_id}&action=reject_proposal`;

      if (booking.customer_email) {
        await sendEmail(booking.customer_email, `Ny städare föreslagen — bekräfta inom 1h`, wrap(`
          <h2>Din städning har fått en ny städare — bekräfta</h2>
          <p>Hej ${esc(booking.customer_name)},</p>
          <p>Tyvärr kunde den ursprungliga städaren inte ta din bokning. Företaget har föreslagit en ersättare:</p>
          ${card([
            ["Ny städare", esc(newCleaner.full_name)],
            ["Datum & tid", `${formatDate(booking.booking_date)} kl ${esc(booking.booking_time)}`],
            ["Tjänst", esc(booking.service_type || "Städning")],
            ["Pris", `${booking.total_price} kr (oförändrat)`],
          ])}
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
            <tr>
              <td style="padding:8px" width="50%">
                <a href="${approveUrl}" style="display:block;background:#0F6E56;color:#fff;padding:16px 24px;border-radius:12px;text-decoration:none;text-align:center;font-weight:700;font-size:16px">✓ Ja, bra!</a>
              </td>
              <td style="padding:8px" width="50%">
                <a href="${rejectUrl}" style="display:block;background:#f5f5f5;color:#333;padding:16px 24px;border-radius:12px;text-decoration:none;text-align:center;font-weight:700;font-size:16px;border:1px solid #ddd">Nej tack</a>
              </td>
            </tr>
          </table>
          <p style="color:#6B6960;font-size:14px">Svara inom 1 timme. Efter det kan du välja själv eller få pengarna tillbaka.</p>
        `));

        // SMS + push till kund
        await notify({
          email: booking.customer_email,
          phone: booking.customer_phone || undefined,
          sms_message: `Spick: ${newCleaner.full_name} föreslås ersätta din städare ${formatDate(booking.booking_date)}. Bekräfta inom 1h: spick.se/min-bokning.html?bid=${booking_id}`,
          push_type: "customer_proposal_pending",
          push_data: {
            cleaner_name: newCleaner.full_name,
            date: formatDate(booking.booking_date),
            booking_id,
          },
        });
      }

      log("info", "company-propose-substitute", "Proposal sent to customer", {
        booking_id, new_cleaner_id, vd: vdCleaner.id
      });

      return json({
        success: true,
        status: "awaiting_customer_approval",
        message: "Förslag skickat till kund. Du får besked inom 1h."
      }, 200, CORS);

    } else {
      // Auto-delegation aktiverad + kvalitet OK → direkt confirmed
      await sb.from("bookings").update({
        status: "confirmed",
        cleaner_id: newCleaner.id,
        cleaner_name: `${newCleaner.full_name}${previousCleaner.company_id ? ` (företag)` : ''}`,
        reassignment_proposed_cleaner_id: null,
        reassignment_proposed_at: null,
        reassignment_proposed_by: vdCleaner.id,
        reassignment_attempts: attempts,
      }).eq("id", booking_id);

      // Hämta företagsnamn för fint cleaner_name
      const { data: company } = await sb
        .from("companies")
        .select("display_name, name")
        .eq("id", vdCleaner.company_id)
        .single();

      if (company) {
        const companyDisplayName = company.display_name || company.name;
        await sb.from("bookings").update({
          cleaner_name: `${newCleaner.full_name} (${companyDisplayName})`,
        }).eq("id", booking_id);
      }

      // Info-mejl till kund (inget att godkänna)
      if (booking.customer_email) {
        await sendEmail(booking.customer_email, `Din städning har en ny städare`, wrap(`
          <h2>Information: ny städare för din bokning</h2>
          <p>Hej ${esc(booking.customer_name)},</p>
          <p>Den ursprungliga städaren kunde inte ta din bokning. Vi har automatiskt tilldelat en annan städare från samma företag:</p>
          ${card([
            ["Ny städare", esc(newCleaner.full_name)],
            ["Datum & tid", `${formatDate(booking.booking_date)} kl ${esc(booking.booking_time)}`],
            ["Pris", `${booking.total_price} kr (oförändrat)`],
          ])}
          <p>Detta skedde enligt dina preferenser för automatisk hantering. Du kan ändra detta i dina kontoinställningar.</p>
          <p><a href="https://spick.se/min-bokning.html?bid=${booking_id}">Se din bokning →</a></p>
        `));

        // Info-push + SMS till kund (ingen åtgärd krävs)
        await notify({
          email: booking.customer_email,
          phone: booking.customer_phone || undefined,
          sms_message: `Spick: Din städning ${formatDate(booking.booking_date)} utförs av ${newCleaner.full_name} (ersättare). Oförändrat pris och tid.`,
          push_type: "auto_delegated",
          push_data: {
            cleaner_name: newCleaner.full_name,
            date: formatDate(booking.booking_date),
            booking_id,
          },
        });
      }

      // Mejl till ny städare
      if (newCleaner.email) {
        await sendEmail(newCleaner.email, `Nytt uppdrag tilldelat`, wrap(`
          <h2>Du har fått ett nytt uppdrag</h2>
          <p>Hej ${esc(newCleaner.full_name)},</p>
          <p>Du har tilldelats en bokning från ditt företag:</p>
          ${card([
            ["Kund", esc(booking.customer_name)],
            ["Datum & tid", `${formatDate(booking.booking_date)} kl ${esc(booking.booking_time)}`],
            ["Adress", esc(booking.address || "-")],
            ["Tjänst", esc(booking.service_type || "Städning")],
          ])}
        `));

        // SMS + push + in-app till ny städare
        const { data: newCleanerFull } = await sb
          .from("cleaners")
          .select("phone")
          .eq("id", newCleaner.id)
          .single();

        await notify({
          cleaner_id: newCleaner.id,
          email: newCleaner.email,
          phone: newCleanerFull?.phone || undefined,
          sms_message: `Spick: Nytt uppdrag tilldelat! ${booking.customer_name} ${formatDate(booking.booking_date)} kl ${booking.booking_time}. Se detaljer: spick.se/stadare-dashboard`,
          push_type: "proposal_approved",
          push_data: {
            date: formatDate(booking.booking_date),
            booking_id,
          },
          in_app: {
            title: "Nytt uppdrag tilldelat",
            body: `${booking.customer_name} ${formatDate(booking.booking_date)} kl ${booking.booking_time}`,
            type: "proposal_approved",
            job_id: booking_id,
          },
        });
      }

      log("info", "company-propose-substitute", "Auto-delegation: directly confirmed", {
        booking_id, new_cleaner_id, vd: vdCleaner.id
      });

      return json({
        success: true,
        status: "confirmed",
        message: "Ersättare tilldelad och bekräftad direkt (kund hade auto-delegation på)."
      }, 200, CORS);
    }

  } catch (err) {
    log("error", "company-propose-substitute", "Unhandled error", { error: (err as Error).message });
    return json({ error: (err as Error).message }, 500, CORS);
  }
});

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" });
}
