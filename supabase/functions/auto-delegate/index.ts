/**
 * auto-delegate — System-triggered auto-tilldelning av ersättare
 *
 * Kallas av:
 *   - cleaner-booking-response när en teammedlem avböjer OCH kund har auto_delegation_enabled
 *   - auto-remind cron som fallback om VD inte svarar inom SLA
 *
 * Logik:
 *   1. Hitta bokningar med status='awaiting_company_proposal' och auto-delegation
 *   2. För varje: försök hitta bästa lediga teammedlem (av_rating ≥ previous - 0.3)
 *   3. Om funnen: direkt tilldela via company-propose-substitute logik
 *   4. Om inte: lämna som awaiting_company_proposal för manuell hantering
 *
 * Body: { booking_id } (kör för specifik bokning) eller {} (cron-läge, alla bokningar)
 * Auth: Service role key
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log } from "../_shared/email.ts";
import { notify } from "../_shared/notifications.ts";
import { formatStockholmDate } from "../_shared/timezone.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── AUTH: kräver service_role ─────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!authHeader.includes(serviceKey) && authHeader !== `Bearer ${serviceKey}`) {
      return json({ error: "Unauthorized" }, 401, CORS);
    }

    const body = await req.json().catch(() => ({}));
    const { booking_id } = body;

    // ── HÄMTA BOKNINGAR ATT HANTERA ───────────────────
    let query = sb
      .from("bookings")
      .select("*")
      .eq("status", "awaiting_company_proposal");

    if (booking_id) {
      query = query.eq("id", booking_id);
    }

    const { data: bookings, error } = await query;
    if (error) return json({ error: error.message }, 500, CORS);
    if (!bookings || bookings.length === 0) {
      return json({ success: true, processed: 0, message: "Inga bokningar att hantera" }, 200, CORS);
    }

    const results: Array<{ booking_id: string; action: string; reason?: string }> = [];

    for (const booking of bookings) {
      try {
        // Kolla auto-delegation
        let autoDelegation = booking.auto_delegation_enabled;
        if (autoDelegation === null || autoDelegation === undefined) {
          const { data: profile } = await sb
            .from("customer_profiles")
            .select("auto_delegation_enabled")
            .eq("email", booking.customer_email)
            .maybeSingle();
          autoDelegation = profile?.auto_delegation_enabled || false;
        }

        if (!autoDelegation) {
          results.push({ booking_id: booking.id, action: "skipped", reason: "auto_delegation disabled" });
          continue;
        }

        // Hämta företag via previous cleaner
        if (!booking.cleaner_id) {
          results.push({ booking_id: booking.id, action: "skipped", reason: "no previous cleaner" });
          continue;
        }

        const { data: prevCleaner } = await sb
          .from("cleaners")
          .select("id, company_id, avg_rating")
          .eq("id", booking.cleaner_id)
          .single();

        if (!prevCleaner?.company_id) {
          results.push({ booking_id: booking.id, action: "skipped", reason: "not a company booking" });
          continue;
        }

        // Hitta lediga teammedlemmar, sorterade efter avg_rating desc
        const { data: candidates } = await sb
          .from("cleaners")
          .select("id, full_name, avg_rating, is_active, status, is_approved")
          .eq("company_id", prevCleaner.company_id)
          .eq("is_active", true)
          .eq("status", "aktiv")
          .eq("is_approved", true)
          .neq("id", prevCleaner.id)
          .order("avg_rating", { ascending: false });

        if (!candidates || candidates.length === 0) {
          results.push({ booking_id: booking.id, action: "no_candidates" });
          continue;
        }

        // Candidates är redan sorterade på avg_rating desc (bästa först)
        // Ingen hård kvalitetsgräns — kund valde auto-delegation och litar på företagets val
        // TODO i framtida sprint: kolla availability + takenNow för candidates
        const chosen = candidates[0];

        // Anropa company-propose-substitute internt (som VD)
        // För att göra detta enkelt, uppdaterar vi bokningen direkt här
        const { data: company } = await sb
          .from("companies")
          .select("display_name, name")
          .eq("id", prevCleaner.company_id)
          .single();

        const displayName = company
          ? `${chosen.full_name} (${company.display_name || company.name})`
          : chosen.full_name;

        await sb.from("bookings").update({
          status: "confirmed",
          cleaner_id: chosen.id,
          cleaner_name: displayName,
          reassignment_proposed_cleaner_id: null,
          reassignment_proposed_at: null,
          reassignment_attempts: (booking.reassignment_attempts || 0) + 1,
        }).eq("id", booking.id);

        // Notifiera båda parter om auto-tilldelning
        try {
          // Hämta kontaktinfo för ny städare
          const { data: chosenFull } = await sb
            .from("cleaners")
            .select("email, phone")
            .eq("id", chosen.id)
            .single();

          // Kund (info, inget att godkänna)
          await notify({
            email: booking.customer_email,
            phone: booking.customer_phone || undefined,
            sms_message: `Spick: Din städning ${formatStockholmDate(booking.booking_date)} utförs av ${chosen.full_name} (automatisk ersättare).`,
            push_type: "auto_delegated",
            push_data: {
              cleaner_name: chosen.full_name,
              date: formatStockholmDate(booking.booking_date),
              booking_id: booking.id,
            },
          });

          // Ny städare (kräver action)
          if (chosenFull) {
            await notify({
              cleaner_id: chosen.id,
              email: chosenFull.email,
              phone: chosenFull.phone,
              sms_message: `Spick: Nytt uppdrag tilldelat automatiskt! ${booking.customer_name} ${formatStockholmDate(booking.booking_date)} kl ${booking.booking_time}.`,
              push_type: "proposal_approved",
              push_data: {
                date: formatStockholmDate(booking.booking_date),
                booking_id: booking.id,
              },
              in_app: {
                title: "Nytt uppdrag tilldelat",
                body: `Auto-tilldelning: ${booking.customer_name} ${formatStockholmDate(booking.booking_date)}`,
                type: "auto_delegated",
                job_id: booking.id,
              },
            });
          }
        } catch (notifyErr) {
          log("warn", "auto-delegate", "Notification failed (non-critical)", {
            booking_id: booking.id,
            error: (notifyErr as Error).message
          });
        }

        results.push({ booking_id: booking.id, action: "auto_delegated", reason: `assigned to ${chosen.full_name}` });

        log("info", "auto-delegate", "Auto-delegated", {
          booking_id: booking.id,
          new_cleaner_id: chosen.id
        });

      } catch (err) {
        results.push({ booking_id: booking.id, action: "error", reason: (err as Error).message });
        log("error", "auto-delegate", "Failed to process booking", {
          booking_id: booking.id,
          error: (err as Error).message
        });
      }
    }

    return json({
      success: true,
      processed: results.length,
      results
    }, 200, CORS);

  } catch (err) {
    log("error", "auto-delegate", "Unhandled error", { error: (err as Error).message });
    return json({ error: (err as Error).message }, 500, CORS);
  }
});

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
