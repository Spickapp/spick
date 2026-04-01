// SPICK – Push Notifications med VAPID
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function getSubscriptions(filter?: string): Promise<any[]> {
  const url = SUPA_URL + "/rest/v1/push_subscriptions?select=*" + (filter || "");
  const res = await fetch(url, {
    headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY }
  });
  return res.json();
}

async function sendPush(sub: any, notification: any): Promise<boolean> {
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "TTL": "86400" },
      body: JSON.stringify(notification)
    });
    return res.ok || res.status === 201;
  } catch { return false; }
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json();
    const { type, data, target_email, target_type, action, subscription, booking_id } = body;

    // Hantera subscribe-action från frontend
    if (action === "subscribe" && subscription) {
      // Spara subscription i Supabase
      const subRes = await fetch(SUPA_URL + "/rest/v1/push_subscriptions", {
        method: "POST",
        headers: {
          apikey: SUPA_KEY,
          Authorization: "Bearer " + SUPA_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          p256dh: subscription.keys?.p256dh,
          auth: subscription.keys?.auth,
          booking_id: booking_id || null,
          created_at: new Date().toISOString()
        })
      });
      return new Response(JSON.stringify({ ok: subRes.ok }), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // Bygg notification
    const notifications: Record<string, any> = {
      new_booking: {
        title: "🔔 Ny bokning!",
        body: `${data?.name || "Kund"} bokade städning den ${data?.date || ""}`,
        url: "/admin.html",
        icon: "/assets/icon-192.png"
      },
      cleaner_job: {
        title: "🧹 Nytt uppdrag!",
        body: `${data?.service || "Städning"} i ${data?.city || ""} – ${data?.pay || ""} kr`,
        url: "/portal",
        icon: "/assets/icon-192.png"
      },
      booking_confirmed: {
        title: "✅ Bokning bekräftad!",
        body: `Din städning ${data?.date || ""} är bekräftad`,
        url: "/min-bokning.html",
        icon: "/assets/icon-192.png"
      },
      reminder: {
        title: "⏰ Påminnelse",
        body: `Din städning är imorgon kl ${data?.time || ""}`,
        url: "/min-bokning.html",
        icon: "/assets/icon-192.png"
      }
    };

    const notification = notifications[type] || {
      title: "Spick",
      body: data?.message || "Nytt meddelande",
      url: "/",
      icon: "/assets/icon-192.png"
    };

    // Hämta rätt prenumeranter
    let filter = "";
    if (target_email) filter = `&user_email=eq.${encodeURIComponent(target_email)}`;
    else if (target_type) filter = `&user_type=eq.${target_type}`;

    const subs = await getSubscriptions(filter);
    if (!subs?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, total: 0 }), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    let sent = 0;
    for (const sub of subs) {
      if (await sendPush(sub, notification)) sent++;
    }

    return new Response(JSON.stringify({ ok: true, sent, total: subs.length }), {
      headers: { "Content-Type": "application/json", ...CORS }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS }
    });
  }
});
