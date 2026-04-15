/**
 * team-sms-notify – SMS till team-medlemmar om deras jobb + sammanfattning till VD
 *
 * Körs via GitHub Actions cron:
 * - Kväll (18:00 svensk tid): target_date = imorgon
 * - Morgon (08:00 svensk tid): target_date = idag
 *
 * POST body: { mode: "evening" | "morning" }
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPA_URL, SUPA_KEY);

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function sendSms(to: string | null | undefined, message: string): Promise<boolean> {
  if (!to) return false;
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPA_KEY}`,
      },
      body: JSON.stringify({ to, message }),
    });
    if (!res.ok) {
      console.warn("SMS ej skickat:", res.status, await res.text());
    }
    return res.ok;
  } catch (e) {
    console.warn("SMS fel:", (e as Error).message);
    return false;
  }
}

interface TeamBooking {
  id: string;
  cleaner_id: string;
  booking_date: string;
  booking_time: string | null;
  customer_address: string | null;
  customer_name: string | null;
  service_type: string | null;
  booking_hours: number | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    const body = await req.json().catch(() => ({} as { mode?: string }));
    const mode: "evening" | "morning" = body.mode === "morning" ? "morning" : "evening";

    // Beräkna target_date: evening = imorgon, morning = idag
    const now = new Date();
    const target = new Date(now);
    if (mode === "evening") {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    const targetDate = ymd(target);
    const dateLabel = mode === "evening" ? "imorgon" : "idag";

    // 1. Hämta alla team-medlemmar (ej VD)
    const { data: teamMembers, error: memberErr } = await sb.from("cleaners")
      .select("id, full_name, phone, email, company_id")
      .not("company_id", "is", null)
      .eq("is_company_owner", false);

    if (memberErr) throw memberErr;

    if (!teamMembers || teamMembers.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, mode, target_date: targetDate, team_sms_sent: 0, vd_sms_sent: 0, note: "Inga team-medlemmar" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Hämta bokningar för target_date som tillhör team-medlemmar
    const cleanerIds = teamMembers.map((m) => m.id);
    const { data: bookings, error: bookErr } = await sb.from("bookings")
      .select("id, cleaner_id, booking_date, booking_time, customer_address, customer_name, service_type, booking_hours")
      .in("cleaner_id", cleanerIds)
      .eq("booking_date", targetDate)
      .not("status", "in", "(cancelled,avbokad)");

    if (bookErr) throw bookErr;

    const memberSent: { cleaner_id: string; name: string; jobs: number }[] = [];
    const companyJobs: Record<string, { jobs: (TeamBooking & { cleaner_name: string })[] }> = {};

    // 3. Skicka SMS till varje team-medlem med jobb
    for (const member of teamMembers) {
      const memberBookings = ((bookings || []) as TeamBooking[]).filter((b) => b.cleaner_id === member.id);
      if (memberBookings.length === 0) continue;

      // Samla till VD-summering
      if (!companyJobs[member.company_id]) {
        companyJobs[member.company_id] = { jobs: [] };
      }
      for (const b of memberBookings) {
        companyJobs[member.company_id].jobs.push({ ...b, cleaner_name: member.full_name || "Städare" });
      }

      // Generera magic link per teammedlem (mönster från admin-approve-cleaner)
      let magicLink = "https://spick.se/team-jobb.html"; // fallback
      if (member.email) {
        try {
          const { data: linkData } = await sb.auth.admin.generateLink({
            type: "magiclink",
            email: member.email,
            options: { redirectTo: "https://spick.se/team-jobb.html" },
          });
          if (linkData?.properties?.action_link) {
            magicLink = linkData.properties.action_link;
          }
        } catch (e) {
          console.warn("Magic link generation failed for", member.email, (e as Error).message);
        }
      }

      // Bygg SMS-meddelande
      let message: string;

      if (memberBookings.length === 1) {
        const b = memberBookings[0];
        message =
          `Spick: Jobb ${dateLabel} kl ${b.booking_time || "09:00"} 🧹\n` +
          `📍 ${(b.customer_address || "").substring(0, 45)}\n` +
          `👤 ${(b.customer_name || "").split(" ")[0]}\n` +
          `→ ${magicLink}`;
      } else {
        const jobLines = memberBookings
          .sort((a, b) => (a.booking_time || "").localeCompare(b.booking_time || ""))
          .map((b) => `- kl ${b.booking_time || "09:00"} ${b.customer_address || ""}`)
          .join("\n");
        message =
          `Spick: ${memberBookings.length} jobb ${dateLabel} 🧹\n${jobLines}\n` +
          `→ ${magicLink}`;
      }

      const sent = await sendSms(member.phone, message);
      if (sent) memberSent.push({ cleaner_id: member.id, name: member.full_name || "", jobs: memberBookings.length });
    }

    // 4. Skicka sammanfattning till varje VD
    const companyIds = Object.keys(companyJobs);
    const vdSent: { company_id: string; name: string; jobs: number }[] = [];

    if (companyIds.length > 0) {
      const { data: vds, error: vdErr } = await sb.from("cleaners")
        .select("id, full_name, phone, company_id")
        .in("company_id", companyIds)
        .eq("is_company_owner", true);

      if (vdErr) throw vdErr;

      for (const vd of vds || []) {
        const jobs = companyJobs[vd.company_id]?.jobs || [];
        if (jobs.length === 0) continue;

        const firstName = (vd.full_name || "VD").split(" ")[0];

        // Gruppera per städare
        const byCleaner: Record<string, number> = {};
        for (const j of jobs) {
          byCleaner[j.cleaner_name] = (byCleaner[j.cleaner_name] || 0) + 1;
        }

        const summary = Object.entries(byCleaner)
          .map(([name, count]) => `- ${name}: ${count} jobb`)
          .join("\n");

        const message =
          `Spick Team: Hej ${firstName}! Ditt team har ${jobs.length} jobb ${dateLabel}:\n${summary}\n` +
          `Alla har fått SMS ✅`;

        const sent = await sendSms(vd.phone, message);
        if (sent) vdSent.push({ company_id: vd.company_id, name: vd.full_name || "", jobs: jobs.length });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode,
        target_date: targetDate,
        team_sms_sent: memberSent.length,
        vd_sms_sent: vdSent.length,
        details: { members: memberSent, vds: vdSent },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("team-sms-notify fel:", (e as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
