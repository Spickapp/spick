// supabase/functions/calendar-ical-feed/index.ts
// =============================================================
// Genererar iCal (.ics) feed för en städare.
// URL: /functions/v1/calendar-ical-feed?slug=farhad-haghighi
//   eller: ?cleaner_id=605fe29a-...
//
// Alla kalender-appar kan prenumerera:
//   Google Calendar: "Other calendars" → "From URL"
//   Outlook: "Add calendar" → "Subscribe from web"
//   Apple Calendar: "New Subscription"
//
// Returnerar text/calendar med VCALENDAR/VEVENT-format.
// =============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // CORS för alla origins (public feed)
  const CORS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    const cleanerId = url.searchParams.get("cleaner_id");

    if (!slug && !cleanerId) {
      return new Response("Missing slug or cleaner_id parameter", {
        status: 400,
        headers: { ...CORS, "Content-Type": "text/plain" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Hitta städare
    let cleaner: any = null;
    if (slug) {
      const { data } = await supabase
        .from("cleaners")
        .select("id, full_name, slug, email")
        .eq("slug", slug)
        .single();
      cleaner = data;
    } else {
      const { data } = await supabase
        .from("cleaners")
        .select("id, full_name, slug, email")
        .eq("id", cleanerId)
        .single();
      cleaner = data;
    }

    if (!cleaner) {
      return new Response("Cleaner not found", {
        status: 404,
        headers: { ...CORS, "Content-Type": "text/plain" },
      });
    }

    // Hämta events (60 dagar bakåt, 90 dagar framåt)
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 60);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 90);

    const { data: events, error } = await supabase
      .from("calendar_events")
      .select("id, start_at, end_at, event_type, title, address, is_all_day, booking_id")
      .eq("cleaner_id", cleaner.id)
      .gte("start_at", pastDate.toISOString())
      .lte("start_at", futureDate.toISOString())
      .order("start_at", { ascending: true });

    if (error) {
      console.error("Failed to fetch events:", error);
      return new Response("Internal error", {
        status: 500,
        headers: { ...CORS, "Content-Type": "text/plain" },
      });
    }

    // Generera iCal
    const ical = generateICal(cleaner, events || []);

    return new Response(ical, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="${cleaner.slug || "spick"}.ics"`,
        "Cache-Control": "public, max-age=300", // 5 min cache
      },
    });
  } catch (err) {
    console.error("calendar-ical-feed error:", err);
    return new Response("Internal error", {
      status: 500,
      headers: { ...CORS, "Content-Type": "text/plain" },
    });
  }
});

function generateICal(
  cleaner: { id: string; full_name: string; slug: string; email: string },
  events: any[]
): string {
  const now = formatICalDate(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Spick//Kalender//SV",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Spick - ${icalEscape(cleaner.full_name)}`,
    "X-WR-TIMEZONE:Europe/Stockholm",

    // Timezone definition
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Stockholm",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ];

  for (const ev of events) {
    const uid = `${ev.id}@spick.se`;
    const summary = ev.title || eventTypeLabel(ev.event_type);
    const description = buildDescription(ev);
    const location = ev.address || "";

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${now}`);

    if (ev.is_all_day) {
      // Heldags-event: bara datum, inga tider
      const startDate = ev.start_at.slice(0, 10).replace(/-/g, "");
      const endDate = new Date(ev.end_at);
      endDate.setDate(endDate.getDate() + 1); // iCal: DTEND är exklusive
      const endDateStr = endDate.toISOString().slice(0, 10).replace(/-/g, "");
      lines.push(`DTSTART;VALUE=DATE:${startDate}`);
      lines.push(`DTEND;VALUE=DATE:${endDateStr}`);
    } else {
      lines.push(`DTSTART;TZID=Europe/Stockholm:${formatICalDateTime(ev.start_at)}`);
      lines.push(`DTEND;TZID=Europe/Stockholm:${formatICalDateTime(ev.end_at)}`);
    }

    lines.push(`SUMMARY:${icalEscape(summary)}`);
    if (description) lines.push(`DESCRIPTION:${icalEscape(description)}`);
    if (location) lines.push(`LOCATION:${icalEscape(location)}`);

    // Status-färg
    const categories = eventTypeLabel(ev.event_type);
    lines.push(`CATEGORIES:${categories}`);

    // Alarm 30 min före (bara för bokningar)
    if (ev.event_type === "booking") {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:Spick: ${icalEscape(summary)} om 30 min`);
      lines.push("TRIGGER:-PT30M");
      lines.push("END:VALARM");
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function formatICalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function formatICalDateTime(iso: string): string {
  // Konvertera ISO-sträng till Stockholm-tid
  const d = new Date(iso);
  const stockholm = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const parts: Record<string, string> = {};
  stockholm.forEach(p => { if (p.type !== "literal") parts[p.type] = p.value; });

  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

function icalEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function eventTypeLabel(type: string): string {
  const map: Record<string, string> = {
    booking: "Bokning",
    blocked: "Blockerad",
    travel: "Restid",
    external: "Extern",
    break: "Paus",
  };
  return map[type] || type;
}

function buildDescription(ev: any): string {
  const parts: string[] = [];
  if (ev.event_type === "booking") {
    parts.push("Spick-bokning");
    if (ev.booking_id) parts.push(`Boknings-ID: ${ev.booking_id}`);
  } else if (ev.event_type === "blocked") {
    parts.push(ev.title || "Blockerad tid");
  }
  if (ev.address) parts.push(`Adress: ${ev.address}`);
  return parts.join("\\n");
}
