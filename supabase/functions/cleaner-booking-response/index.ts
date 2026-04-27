import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, card, log, ADMIN } from "../_shared/email.ts";
import { notify } from "../_shared/notifications.ts";
import { generateMagicShortUrl } from "../_shared/send-magic-sms.ts";
import { formatStockholmDateLong } from "../_shared/timezone.ts";
import { logBookingEvent } from "../_shared/events.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── AUTH: verify logged-in user ─────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return json({ error: "Unauthorized" }, 401, CORS);
    }

    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
    });
    if (!authRes.ok) return json({ error: "Invalid token" }, 401, CORS);
    const authUser = await authRes.json();

    // ── ADMIN-BYPASS: admin (admin_users-tabellen) får agera åt vilken cleaner som helst
    // Pattern matchar admin-approve-company/admin-cancel-booking. Per Farhad-mandate 2026-04-27:
    // "Admin ska kunna göra allt även i andras namn" (impersonation från admin-vy).
    let isAdmin = false;
    if (authUser?.email) {
      const { data: adminRow } = await sb
        .from("admin_users")
        .select("email")
        .eq("email", authUser.email)
        .eq("is_active", true)
        .maybeSingle();
      isAdmin = !!adminRow;
    }

    // Find cleaner by auth_user_id (om INTE admin — annars använder vi booking.cleaner_id)
    let cleaner: any = null;
    if (!isAdmin) {
      const { data, error: clErr } = await sb
        .from("cleaners")
        .select("id, full_name, email, company_id, is_company_owner")
        .eq("auth_user_id", authUser.id)
        .eq("is_approved", true)
        .maybeSingle();
      if (clErr || !data) return json({ error: "Städarprofil hittades inte" }, 403, CORS);
      cleaner = data;
    }

    // ── PARSE BODY ──────────────────────────────────────────
    const { booking_id, action, reason } = await req.json();
    if (!booking_id || !["accept", "reject"].includes(action)) {
      return json({ error: "booking_id + action (accept|reject) krävs" }, 400, CORS);
    }

    // ── FETCH BOOKING ───────────────────────────────────────
    const { data: booking, error: bkErr } = await sb
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .maybeSingle();

    if (bkErr || !booking) return json({ error: "Bokning hittades inte" }, 404, CORS);

    // ── ADMIN: hämta target-cleaner från bookingen för logging/email-namn ──
    if (isAdmin && booking.cleaner_id) {
      const { data: targetCl } = await sb
        .from("cleaners")
        .select("id, full_name, email, company_id, is_company_owner")
        .eq("id", booking.cleaner_id)
        .maybeSingle();
      if (targetCl) {
        cleaner = targetCl;
      } else {
        // Bokning utan tilldelad cleaner — admin kan ändå hantera; fyll med admin-info
        cleaner = { id: null, full_name: `Admin (${authUser.email})`, email: authUser.email, company_id: null, is_company_owner: true };
      }
    }

    // Verify this cleaner owns this booking (or is company owner of the assigned cleaner)
    // Admin: alltid auktoriserad (Farhad-mandate 2026-04-27)
    let isAuthorized = isAdmin || booking.cleaner_id === cleaner.id;
    if (!isAuthorized && cleaner.is_company_owner && cleaner.company_id) {
      // Check if the assigned cleaner belongs to the same company
      const { data: assignedCleaner } = await sb
        .from("cleaners")
        .select("company_id")
        .eq("id", booking.cleaner_id)
        .maybeSingle();
      if (assignedCleaner?.company_id === cleaner.company_id) {
        isAuthorized = true;
      }
    }
    if (!isAuthorized) {
      return json({ error: "Du har inte tillgång till denna bokning" }, 403, CORS);
    }

    if (booking.status !== "pending_confirmation" && booking.status !== "bekräftad" && booking.status !== "pending" && booking.status !== "awaiting_reassignment") {
      return json({ error: `Bokning har redan status: ${booking.status}` }, 409, CORS);
    }

    const customerEmail = booking.customer_email;
    const customerName = booking.customer_name || "Kund";
    const bookingDate = booking.booking_date || booking.scheduled_date || "";
    const bookingTime = booking.booking_time || "";
    const serviceType = booking.service_type || "Städning";
    const bookingHours = booking.booking_hours || booking.hours || 3;

    // ════════════════════════════════════════════════════════
    // ACCEPT
    // ════════════════════════════════════════════════════════
    if (action === "accept") {
      // Regel #28: Hämta alltid target-cleaner's email/phone, inte inloggad användares
      // Detta gör flödet homogent för både solo-accept och VD-accept
      const { data: targetCleaner } = await sb
        .from("cleaners")
        .select("email, phone")
        .eq("id", booking.cleaner_id)
        .maybeSingle();

      await sb.from("bookings").update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        cleaner_email: targetCleaner?.email || null,
        cleaner_phone: targetCleaner?.phone || null,
      }).eq("id", booking_id);

      // Email to customer
      if (customerEmail) {
        const html = wrap(`
          <h2>Din städning är bekräftad! ✅</h2>
          <p>Hej ${esc(customerName)},</p>
          <p><strong>${esc(cleaner.full_name)}</strong> har bekräftat din städning!</p>
          ${card([
            ["Datum", formatStockholmDateLong(bookingDate)],
            ["Tid", bookingTime || "Se bekräftelse"],
            ["Tjänst", `${esc(serviceType)}, ${bookingHours}h`],
            ["Städare", esc(cleaner.full_name)],
          ])}
          <p>Vi ses! Om du behöver ändra eller avboka, kontakta oss på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> minst 24h innan.</p>
        `);
        await sendEmail(customerEmail, "Din städning är bekräftad! ✅", html);
      }

      // Email to admin
      await sendEmail(ADMIN, `Bokning bekräftad av ${cleaner.full_name}`, wrap(`
        <h2>Bokning bekräftad</h2>
        <p><strong>${esc(cleaner.full_name)}</strong> har accepterat bokning <code>${esc(booking_id.slice(0, 8))}</code>.</p>
        ${card([
          ["Kund", esc(customerName)],
          ["Datum", formatStockholmDateLong(bookingDate)],
          ["Tjänst", `${esc(serviceType)}, ${bookingHours}h`],
        ])}
      `));
      // Fas 10: info — normalt flöde, nice-to-know
      await sendAdminAlert({
        severity: "info",
        title: `Bokning bekräftad: ${cleaner.full_name}`,
        source: "cleaner-booking-response",
        booking_id,
        cleaner_id: cleaner.id,
        metadata: { customer: customerName, service: serviceType, hours: bookingHours, date: bookingDate },
      });

      log("info", "cleaner-booking-response", "Booking accepted", { booking_id, cleaner_id: cleaner.id });
      return json({ success: true, message: "Bokning bekräftad! Kunden har fått mejl." }, 200, CORS);
    }

    // ════════════════════════════════════════════════════════
    // REJECT
    // ════════════════════════════════════════════════════════
    if (action === "reject") {
      // ── FAS 2: Avgör om detta är företag eller solo ──
      // Om avböjande cleaner tillhör ett företag → awaiting_company_proposal
      // VD får hantera. Kund vet inget än.
      // Om solo → awaiting_reassignment (befintligt flöde)

      const isCompanyBooking = !!cleaner.company_id;
      const newStatus = isCompanyBooking ? "awaiting_company_proposal" : "awaiting_reassignment";

      // Bevara cleaner_id och cleaner_name för företagsbokningar
      // (VD behöver se vem som avböjde och var bokningen var tilldelad)
      const updateFields: Record<string, unknown> = {
        status: newStatus,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || null,
        admin_notes: `rejected_by:${cleaner.id}`,
      };

      if (!isCompanyBooking) {
        // Solo: nollställ cleaner så kund kan välja ny
        updateFields.cleaner_id = null;
        updateFields.cleaner_name = null;
      }
      // För företagsbokningar: behåll cleaner_id som "sist tilldelad"
      // VD kommer att sätta ny cleaner_id via company-propose-substitute

      await sb.from("bookings").update(updateFields).eq("id", booking_id);

      // Fas 6.3: logga cleaner_declined för audit-trail
      await logBookingEvent(sb, booking_id, "cleaner_declined", {
        actorType: "cleaner",
        metadata: {
          cleaner_id: cleaner.id,
          reason: reason || null,
          is_company: isCompanyBooking,
          company_id: cleaner.company_id || null,
          new_status: newStatus,
        },
      });

      log("info", "cleaner-booking-response", `Booking ${newStatus}`, {
        booking_id,
        cleaner_id: cleaner.id,
        is_company: isCompanyBooking,
        company_id: cleaner.company_id || null
      });

      // ── NO immediate refund — customer gets 24h to rebook ──
      // Auto-refund handled by auto-remind after 24h if still awaiting_reassignment

      const rebookUrl = await generateMagicShortUrl({
        email: customerEmail,
        redirect_to: `https://spick.se/min-bokning.html?bid=${booking_id}`,
        scope: "booking",
        resource_id: booking_id,
        ttl_hours: 168,
      });
      const refundUrl = await generateMagicShortUrl({
        email: customerEmail,
        redirect_to: `https://spick.se/min-bokning.html?bid=${booking_id}&action=refund`,
        scope: "booking",
        resource_id: booking_id,
        ttl_hours: 168,
      });

      // Email to customer — choose new cleaner or get refund
      if (customerEmail && !isCompanyBooking) {
        const html = wrap(`
          <h2>Din städare kunde tyvärr inte ta uppdraget</h2>
          <p>Hej ${esc(customerName)},</p>
          <p>Tyvärr kunde <strong>${esc(cleaner.full_name)}</strong> inte ta din ${esc(serviceType).toLowerCase()} den ${formatStockholmDateLong(bookingDate)}. Vi beklagar!</p>
          <p><strong>Du har två alternativ:</strong></p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
            <tr>
              <td style="padding:8px">
                <a href="${rebookUrl}" style="display:block;background:#0F6E56;color:#fff;padding:16px 24px;border-radius:12px;text-decoration:none;text-align:center;font-weight:700;font-size:16px">Välj en ny städare →</a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px">
                <a href="${refundUrl}" style="display:block;background:#fff;color:#DC2626;padding:14px 24px;border-radius:12px;text-decoration:none;text-align:center;font-weight:600;font-size:14px;border:1.5px solid #FECACA">Jag vill ha återbetalning</a>
              </td>
            </tr>
          </table>
          <p style="font-size:13px;color:#6B6960">Om du inte agerar inom 24 timmar återbetalas du automatiskt.</p>
          <p>Frågor? Kontakta oss på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a>.</p>
        `);
        await sendEmail(customerEmail, `Din städare kunde inte ta uppdraget — välj ny`, html);

        // Multi-kanal till kund (SMS + push)
        const smsLink = await generateMagicShortUrl({
          email: customerEmail,
          redirect_to: `https://spick.se/min-bokning.html?bid=${booking_id}`,
          scope: "booking",
          resource_id: booking_id,
          ttl_hours: 24,
        });
        await notify({
          email: customerEmail,
          phone: booking.customer_phone || undefined,
          sms_message: `Spick: Din städare ${cleaner.full_name} kan inte ta bokningen ${formatStockholmDateLong(bookingDate)}. Välj ny eller få pengarna tillbaka: ${smsLink}`,
          push_type: "booking_rejected_by_cleaner",
          push_data: {
            cleaner_name: cleaner.full_name,
            date: formatStockholmDateLong(bookingDate),
            booking_id,
          },
        });
      }

      // Email to admin
      await sendEmail(ADMIN, `⚠️ Bokning avböjd av ${cleaner.full_name}`, wrap(`
        <h2>⚠️ Bokning avböjd — väntar på kundens val</h2>
        <p><strong>${esc(cleaner.full_name)}</strong> har avböjt bokning <code>${esc(booking_id.slice(0, 8))}</code>.</p>
        ${card([
          ["Kund", `${esc(customerName)} (${esc(customerEmail)})`],
          ["Datum", formatStockholmDateLong(bookingDate)],
          ["Anledning", esc(reason || "Ingen angiven")],
          ["Status", "Väntar på kundens val (24h)"],
        ])}
        <p>Kunden har fått mejl med alternativ att välja ny städare eller begära återbetalning. Auto-refund efter 24h.</p>
      `));
      // Fas 10: warn — kund behöver agera, 24h-window
      await sendAdminAlert({
        severity: "warn",
        title: `Bokning avböjd: ${cleaner.full_name}`,
        source: "cleaner-booking-response",
        booking_id,
        cleaner_id: cleaner.id,
        metadata: {
          customer: customerName,
          customer_email: customerEmail,
          reason: reason || "Ingen angiven",
          auto_refund_in_hours: 24,
        },
      });

      // ── FAS 2: Notifiera VD om detta var en företagsbokning ──
      let companyName: string | null = null;
      if (isCompanyBooking && cleaner.company_id) {
        try {
          const { data: company } = await sb
            .from("companies")
            .select("display_name, name, owner_cleaner_id")
            .eq("id", cleaner.company_id)
            .single();

          if (company) {
            companyName = company.display_name || company.name;
          }

          if (company?.owner_cleaner_id) {
            const { data: owner } = await sb
              .from("cleaners")
              .select("email, full_name")
              .eq("id", company.owner_cleaner_id)
              .single();

            if (owner?.email) {
              const dashboardUrl = "https://spick.se/stadare-dashboard.html";

              await sendEmail(owner.email, `[Spick] Ersättare behövs: ${esc(customerName)} ${formatStockholmDateLong(bookingDate)}`, wrap(`
                <h2>Städare avböjde — du behöver föreslå ersättare</h2>
                <p>Hej ${esc(owner.full_name)},</p>
                <p><strong>${esc(cleaner.full_name)}</strong> har avböjt en bokning för ditt företag. Du behöver föreslå en ersättare från ditt team inom 2 timmar.</p>
                ${card([
                  ["Kund", esc(customerName)],
                  ["Tjänst", esc(serviceType)],
                  ["Datum & tid", `${formatStockholmDateLong(bookingDate)} kl ${esc(booking.booking_time)}`],
                  ["Adress", esc(booking.address || "-")],
                  ["Pris", `${booking.total_price} kr`],
                  ["Avböjare", esc(cleaner.full_name)],
                  ["Anledning", esc(reason || "Ingen angiven")],
                ])}
                <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
                  <tr>
                    <td style="padding:8px">
                      <a href="${dashboardUrl}" style="display:block;background:#0F6E56;color:#fff;padding:16px 24px;border-radius:12px;text-decoration:none;text-align:center;font-weight:700;font-size:16px">Öppna Spick-dashboard →</a>
                    </td>
                  </tr>
                </table>
                <p style="color:#6B6960;font-size:14px">Om du inte svarar inom 2 timmar kommer kunden automatiskt få välja ersättare själv. Om ingen ersättare från ditt team kan hjälpa, kan du direkt släppa bokningen för kundval.</p>
              `));

              // Multi-kanal notifikation till VD (SMS + push + in-app)
              const { data: ownerPhone } = await sb
                .from("cleaners")
                .select("phone")
                .eq("id", company.owner_cleaner_id)
                .single();

              await notify({
                cleaner_id: company.owner_cleaner_id,
                email: owner.email,
                phone: ownerPhone?.phone || undefined,
                sms_message: `Spick: ${cleaner.full_name} avböjde bokning för ${customerName} ${formatStockholmDateLong(bookingDate)}. Föreslå ersättare: spick.se/stadare-dashboard`,
                push_type: "company_substitute_needed",
                push_data: {
                  cleaner_name: cleaner.full_name,
                  date: formatStockholmDateLong(bookingDate),
                  booking_id,
                },
                in_app: {
                  title: "Ersättare behövs",
                  body: `${cleaner.full_name} avböjde bokning för ${customerName} ${formatStockholmDateLong(bookingDate)}`,
                  type: "company_substitute_needed",
                  job_id: booking_id,
                },
              });
            }
          }

          // Admin-kopia för övervakning
          await sendEmail(ADMIN, `[Spick admin] Företagsbokning avböjd — ${companyName || cleaner.company_id}`, wrap(`
            <h2>Företagsbokning avböjd av teammedlem</h2>
            ${card([
              ["Avböjare", esc(cleaner.full_name)],
              ["Företag", esc(companyName || String(cleaner.company_id))],
              ["Bokning", `${esc(serviceType)} ${formatStockholmDateLong(bookingDate)}`],
              ["Kund", esc(customerName)],
              ["Status", "awaiting_company_proposal"],
            ])}
            <p>VD har 2h att föreslå ersättare. Efter det eskaleras till awaiting_reassignment automatiskt.</p>
          `));
          // Fas 10: warn — VD-SLA 2h startar
          await sendAdminAlert({
            severity: "warn",
            title: `Företagsbokning avböjd: ${companyName || "okänt företag"}`,
            source: "cleaner-booking-response",
            booking_id,
            cleaner_id: cleaner.id,
            company_id: String(cleaner.company_id || ""),
            metadata: {
              declined_by: cleaner.full_name,
              company: companyName || "okänt",
              customer: customerName,
              sla_hours: 2,
              status: "awaiting_company_proposal",
            },
          });
        } catch (notifyErr) {
          log("error", "cleaner-booking-response", "Failed to notify company owner", {
            error: (notifyErr as Error).message,
            company_id: cleaner.company_id
          });
        }
      }

      log("info", "cleaner-booking-response", `Booking rejected — ${newStatus}`, { booking_id, cleaner_id: cleaner.id });
      const msg = isCompanyBooking
        ? "Bokning avböjd. VD har notifierats för att föreslå ersättare."
        : "Bokning avböjd. Kunden har fått mejl med alternativ.";
      return json({ success: true, message: msg }, 200, CORS);
    }

    return json({ error: "Ogiltig action" }, 400, CORS);
  } catch (err) {
    log("error", "cleaner-booking-response", "Unhandled error", { error: (err as Error).message });
    return json({ error: (err as Error).message }, 500, CORS);
  }
});

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
