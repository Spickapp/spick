// calendar-sync — Synkronisera Google Calendar ↔ Spick
// Triggas av:
//   1. POST { cleaner_id, provider } — synka en specifik anslutning
//   2. POST {} (ingen body) — synka ALLA aktiva anslutningar (cron)
//
// Flöde:
//   1. Hämta aktiv connection
//   2. Refresh access_token om expired
//   3. Inbound: hämta Google-events → upsert calendar_events
//   4. Outbound: hämta nya Spick-bokningar → push till Google

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { SWEDEN_TZ } from "../_shared/timezone.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

serve(async (req) => {
  const CORS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const targetCleanerId = body.cleaner_id || null;
    const targetProvider = body.provider || null;

    // Hämta anslutningar att synka
    let query = supabase
      .from("calendar_connections")
      .select("*")
      .eq("is_active", true);

    if (targetCleanerId) query = query.eq("cleaner_id", targetCleanerId);
    if (targetProvider) query = query.eq("provider", targetProvider);

    const { data: connections, error: connErr } = await query;

    if (connErr || !connections) {
      console.error("Failed to fetch connections:", connErr);
      return new Response(JSON.stringify({ error: "No connections found" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const conn of connections) {
      try {
        if (conn.provider === "google") {
          const result = await syncGoogle(supabase, conn);
          results.push({ cleaner_id: conn.cleaner_id, provider: "google", ...result });
        }
        // Outlook kan läggas till här med samma mönster
      } catch (e: any) {
        console.error(`Sync failed for ${conn.cleaner_id}/${conn.provider}:`, e.message);
        results.push({ cleaner_id: conn.cleaner_id, provider: conn.provider, error: e.message });
      }
    }

    return new Response(JSON.stringify({ synced: results.length, results }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("calendar-sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

// ── GOOGLE CALENDAR SYNC ─────────────────────────────────────

async function syncGoogle(supabase: any, conn: any) {
  let accessToken = conn.access_token;

  // 1. Refresh token om expired
  if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
    if (!conn.refresh_token) {
      throw new Error("Token expired and no refresh_token available");
    }
    accessToken = await refreshGoogleToken(supabase, conn);
  }

  // 2. Inbound: hämta Google-events
  let inboundCount = 0;
  if (conn.sync_direction === "inbound" || conn.sync_direction === "both") {
    inboundCount = await googleInbound(supabase, conn, accessToken);
  }

  // 3. Outbound: pusha Spick-bokningar till Google
  let outboundCount = 0;
  if (conn.sync_direction === "outbound" || conn.sync_direction === "both") {
    outboundCount = await googleOutbound(supabase, conn, accessToken);
  }

  // Uppdatera last_synced_at
  await supabase
    .from("calendar_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", conn.id);

  return { inbound: inboundCount, outbound: outboundCount };
}

async function refreshGoogleToken(supabase: any, conn: any): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const tokens = await res.json();
  const expiresAt = new Date();
  expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expires_in || 3600));

  // Uppdatera tokens i DB
  await supabase
    .from("calendar_connections")
    .update({
      access_token: tokens.access_token,
      token_expires_at: expiresAt.toISOString(),
      // refresh_token uppdateras bara om Google skickar ny
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    })
    .eq("id", conn.id);

  return tokens.access_token;
}

async function googleInbound(supabase: any, conn: any, accessToken: string): Promise<number> {
  const calendarId = encodeURIComponent(conn.calendar_id || "primary");

  // Hämta events (incremental med syncToken om tillgänglig)
  let url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?maxResults=100&singleEvents=true&orderBy=startTime`;

  if (conn.sync_token) {
    url += `&syncToken=${conn.sync_token}`;
  } else {
    // Första synk: hämta 30 dagar bakåt, 90 dagar framåt
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - 30);
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 90);
    url += `&timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 410) {
    // syncToken invalid — gör full re-sync
    await supabase
      .from("calendar_connections")
      .update({ sync_token: null })
      .eq("id", conn.id);
    return 0; // nästa körning gör full sync
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google events.list failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  let count = 0;

  for (const ev of (data.items || [])) {
    // Skippa Spick-skapade events (undvik loop)
    if (ev.summary && ev.summary.startsWith("Spick:")) continue;
    if (ev.description && ev.description.includes("spick.se")) continue;

    if (ev.status === "cancelled") {
      // Radera från calendar_events
      await supabase
        .from("calendar_events")
        .delete()
        .eq("external_id", ev.id)
        .eq("cleaner_id", conn.cleaner_id);
      count++;
      continue;
    }

    // Konvertera Google-event → calendar_event
    const startAt = ev.start?.dateTime || (ev.start?.date ? ev.start.date + "T00:00:00Z" : null);
    const endAt = ev.end?.dateTime || (ev.end?.date ? ev.end.date + "T23:59:59Z" : null);
    if (!startAt || !endAt) continue;

    const isAllDay = !!ev.start?.date;

    const { error } = await supabase
      .from("calendar_events")
      .upsert({
        cleaner_id: conn.cleaner_id,
        start_at: startAt,
        end_at: endAt,
        event_type: "external",
        source: "google",
        external_id: ev.id,
        title: `Google: ${ev.summary || "Upptagen"}`,
        address: ev.location || null,
        is_all_day: isAllDay,
        synced_at: new Date().toISOString(),
      }, {
        onConflict: "cleaner_id,external_id",
        ignoreDuplicates: false,
      });

    if (error) {
      // Om upsert misslyckas pga constraint, prova utan onConflict
      // (external_id unique index kanske saknas)
      console.warn(`Upsert failed for Google event ${ev.id}:`, error.message);
    }
    count++;
  }

  // Spara syncToken för incremental sync nästa gång
  if (data.nextSyncToken) {
    await supabase
      .from("calendar_connections")
      .update({ sync_token: data.nextSyncToken })
      .eq("id", conn.id);
  }

  return count;
}

async function googleOutbound(supabase: any, conn: any, accessToken: string): Promise<number> {
  const calendarId = encodeURIComponent(conn.calendar_id || "primary");

  // Hitta Spick-bokningar som saknar external_id (ej pushade ännu)
  const { data: newBookings } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("cleaner_id", conn.cleaner_id)
    .eq("event_type", "booking")
    .eq("source", "spick")
    .is("external_id", null)
    .gte("start_at", new Date().toISOString());

  let count = 0;
  for (const ev of (newBookings || [])) {
    try {
      const googleEvent = {
        summary: `Spick: ${ev.title || "St&auml;dning"}`.replace(/&auml;/g, "ä").replace(/&ouml;/g, "ö").replace(/&aring;/g, "å"),
        description: `Spick-bokning\nBoknings-ID: ${ev.booking_id || "–"}\nhttps://spick.se`,
        location: ev.address || "",
        start: ev.is_all_day
          ? { date: ev.start_at.slice(0, 10) }
          : { dateTime: ev.start_at, timeZone: SWEDEN_TZ },
        end: ev.is_all_day
          ? { date: ev.end_at.slice(0, 10) }
          : { dateTime: ev.end_at, timeZone: SWEDEN_TZ },
      };

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(googleEvent),
        }
      );

      if (res.ok) {
        const created = await res.json();
        // Spara Google event ID på vår calendar_event
        await supabase
          .from("calendar_events")
          .update({ external_id: created.id, synced_at: new Date().toISOString() })
          .eq("id", ev.id);
        count++;
      } else {
        console.warn(`Failed to push event ${ev.id} to Google:`, await res.text());
      }
    } catch (e: any) {
      console.warn(`Outbound push failed for ${ev.id}:`, e.message);
    }
  }
  return count;
}
