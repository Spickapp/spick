// customer-nudge-recurring — Fas 5 §5.9
// ═══════════════════════════════════════════════════════════════
// Cron-EF: skickar "Vill du ha städning varje vecka?"-email till kunder
// som har en enstaka slutförd bokning för 7-14 dagar sedan men ingen
// aktiv subscription och inte fått nudge tidigare.
//
// Triggas dagligen via GitHub Actions workflow customer-nudge-recurring.yml
//
// Avbryts (idempotent) via customer_profiles.recurring_nudge_sent_at = NOW()
// efter email-dispatch.
//
// Max 50 nudges per körning (rate-limit för att undvika spam-märkning hos Resend).
//
// Primärkälla: docs/planning/spick-arkitekturplan-v3.md §5.9
// Rule #31: customer_profiles, bookings, subscriptions verifierade via information_schema.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log, sendEmail, wrap, card, esc } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_URL     = Deno.env.get("BASE_URL") || "https://spick.se";

const MAX_NUDGES_PER_RUN = 50;

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (s: number, d: unknown) => new Response(JSON.stringify(d), {
    status: s, headers: { ...CORS, "Content-Type": "application/json" },
  });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // ── Hitta kandidater: kunder med exakt 1 completed booking för 7-14 dagar sedan ──
    const today = new Date();
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const sevenDaysAgo    = new Date(today.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    // Hämta kandidater: bookings i fönstret där customer inte har subscription + inte redan nudgat
    const { data: bookings, error: bErr } = await sb
      .from("bookings")
      .select("id, customer_email, customer_name, service_type, booking_date, cleaner_id, cleaner_name")
      .gte("booking_date", fourteenDaysAgo)
      .lte("booking_date", sevenDaysAgo)
      .in("status", ["completed", "klar", "paid"])
      .limit(200);

    if (bErr) {
      log("error", "customer-nudge-recurring", "Booking fetch failed", { error: bErr.message });
      return json(500, { error: bErr.message });
    }
    if (!bookings || bookings.length === 0) {
      log("info", "customer-nudge-recurring", "No bookings in window", { window: [fourteenDaysAgo, sevenDaysAgo] });
      return json(200, { processed: 0, reason: "no bookings in window" });
    }

    // ── Filtrera: bara 1 completed-bokning, ingen sub, ingen nudge redan ──
    const results: Array<Record<string, unknown>> = [];
    const uniqueEmails = new Set<string>();

    for (const b of bookings as Array<Record<string, unknown>>) {
      if (results.length >= MAX_NUDGES_PER_RUN) break;
      const email = (b.customer_email as string | null)?.toLowerCase();
      if (!email || uniqueEmails.has(email)) continue;
      uniqueEmails.add(email);

      // Kolla att customer inte har subscription
      const { data: subs } = await sb
        .from("subscriptions")
        .select("id")
        .eq("customer_email", email)
        .in("status", ["active", "paused", "pending_setup"])
        .limit(1);
      if (subs && subs.length > 0) continue;

      // Kolla customer_profiles för nudge-status
      const { data: profile } = await sb
        .from("customer_profiles")
        .select("email, name, recurring_nudge_sent_at")
        .eq("email", email)
        .maybeSingle();
      if (profile?.recurring_nudge_sent_at) continue;

      // Kolla att kunden bara har 1 completed-bokning totalt (inte redan återkommande)
      const { count: completedCount } = await sb
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("customer_email", email)
        .in("status", ["completed", "klar", "paid"]);
      if ((completedCount || 0) !== 1) continue;

      // ── Skicka nudge-email ──
      try {
        const firstName = ((b.customer_name as string) || profile?.name || "").split(" ")[0] || "du";
        const service = (b.service_type as string) || "Hemstädning";
        const cleanerName = (b.cleaner_name as string) || "din städare";
        const prefillUrl = `${BASE_URL}/prenumerera.html?source=nudge`;

        await sendEmail(
          email,
          "Vill du ha städning varje vecka? 🔁",
          wrap(`
            <h2>Hej ${esc(firstName)}!</h2>
            <p>Det var en vecka sedan ${esc(cleanerName)} städade hos dig (${esc(service)}). Hur kändes det?</p>
            <p>Många av våra kunder väljer att lägga in städning <strong>varje vecka eller varannan vecka</strong> — då slipper du tänka på bokningen och RUT-avdraget dras automatiskt.</p>
            ${card([
              ["Samma tid", "Varje vecka, varannan eller månadsvis"],
              ["Samma städare", "Om du vill — annars flexibel matchning"],
              ["Autodebiterat", "Kort sparas säkert hos Stripe"],
              ["Du bestämmer", "Pausa, skippa eller avsluta när du vill"],
            ])}
            <p style="margin-top:24px"><a href="${prefillUrl}" class="btn">Starta prenumeration →</a></p>
            <p style="font-size:13px;color:#6B6960;margin-top:16px">Detta är det enda mejlet vi skickar om detta — vi spammar inte. Om du inte är intresserad: ignorera bara.</p>
          `),
        );

        // Markera som nudgat (idempotency — även vid race-conditions)
        await sb
          .from("customer_profiles")
          .upsert(
            { email, recurring_nudge_sent_at: new Date().toISOString(), name: profile?.name || (b.customer_name as string) || "Kund" },
            { onConflict: "email" },
          );

        results.push({ email, booking_id: b.id, status: "nudged" });
        log("info", "customer-nudge-recurring", "Nudge sent", { email, booking_id: b.id });
      } catch (e) {
        log("warn", "customer-nudge-recurring", "Nudge email failed", {
          email, booking_id: b.id, error: (e as Error).message,
        });
        results.push({ email, booking_id: b.id, status: "error", error: (e as Error).message });
      }
    }

    log("info", "customer-nudge-recurring", "Run complete", {
      window: [fourteenDaysAgo, sevenDaysAgo],
      candidates_checked: bookings.length,
      nudged: results.filter((r) => r.status === "nudged").length,
      errors: results.filter((r) => r.status === "error").length,
    });

    return json(200, {
      processed: results.length,
      nudged: results.filter((r) => r.status === "nudged").length,
      errors: results.filter((r) => r.status === "error").length,
      window: { from: fourteenDaysAgo, to: sevenDaysAgo },
      results,
    });
  } catch (e) {
    log("error", "customer-nudge-recurring", "Fatal", { error: (e as Error).message });
    return json(500, { error: (e as Error).message });
  }
});
