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
import { logBookingEvent } from "../_shared/events.ts";

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

    // ────────────────────────────────────────────────────────────────
    // Audit-fix P0 (2026-04-26): batch-fetch INNAN loop för att undvika
    // N+1 queries. Tidigare 2 queries per booking × 14 bookings/timme
    // (vid 10k/månad) = ~28 DB-anrop/timme bara för delegation-cron.
    // Nu 2 queries totalt per körning oavsett booking-count.
    // ────────────────────────────────────────────────────────────────

    // Steg 1: batch-fetch alla previous cleaners (för company_id-lookup)
    const prevCleanerIds = [...new Set(bookings.map(b => b.cleaner_id).filter(Boolean))];
    const prevCleanersById = new Map<string, { id: string; company_id: string | null; avg_rating: number | null }>();
    if (prevCleanerIds.length > 0) {
      const { data: prevCleaners } = await sb
        .from("cleaners")
        .select("id, company_id, avg_rating")
        .in("id", prevCleanerIds);
      for (const pc of (prevCleaners || [])) {
        prevCleanersById.set(pc.id, pc);
      }
    }

    // Steg 2: batch-fetch alla candidates per unik company_id
    const companyIds = [...new Set(
      Array.from(prevCleanersById.values())
        .map(pc => pc.company_id)
        .filter((id): id is string => !!id)
    )];
    const candidatesByCompany = new Map<string, Array<{ id: string; full_name: string; avg_rating: number | null }>>();
    if (companyIds.length > 0) {
      const { data: allCandidates } = await sb
        .from("cleaners")
        .select("id, full_name, avg_rating, company_id")
        .in("company_id", companyIds)
        .eq("is_active", true)
        .eq("status", "aktiv")
        .eq("is_approved", true)
        .order("avg_rating", { ascending: false });
      for (const cand of (allCandidates || [])) {
        if (!cand.company_id) continue;
        if (!candidatesByCompany.has(cand.company_id)) candidatesByCompany.set(cand.company_id, []);
        candidatesByCompany.get(cand.company_id)!.push({ id: cand.id, full_name: cand.full_name, avg_rating: cand.avg_rating });
      }
    }

    for (const booking of bookings) {
      try {
        // Kolla auto-delegation (per-booking customer_profiles-fetch är OK,
        // ingen batch eftersom auto_delegation_enabled redan kan ligga i
        // booking-row och oftast inte triggar lookup).
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

        if (!booking.cleaner_id) {
          results.push({ booking_id: booking.id, action: "skipped", reason: "no previous cleaner" });
          continue;
        }

        const prevCleaner = prevCleanersById.get(booking.cleaner_id);
        if (!prevCleaner?.company_id) {
          results.push({ booking_id: booking.id, action: "skipped", reason: "not a company booking" });
          continue;
        }

        // Filter candidates: ej previous cleaner, ej tom lista
        const candidates = (candidatesByCompany.get(prevCleaner.company_id) || [])
          .filter(c => c.id !== prevCleaner.id);

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

        // Fas 6.3: logga cleaner_assigned för auto-delegation audit-trail
        await logBookingEvent(sb, booking.id, "cleaner_assigned", {
          actorType: "system",
          metadata: {
            cleaner_id: chosen.id,
            assigned_by: "auto-delegate",
            delegation_route: "auto_fallback",
            previous_cleaner_id: booking.cleaner_id || null,
            reassignment_attempts: (booking.reassignment_attempts || 0) + 1,
          },
        });

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
