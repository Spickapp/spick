// ═══════════════════════════════════════════════════════════════
// SPICK – Magic-link SMS för publika auth-flows (Fas 1.2)
// Skapar kort URL via public-auth-link + skickar via notifications.sendSms
// Importeras av: auto-remind, stripe-webhook, company-propose-substitute,
//                cleaner-booking-response, booking-reassign, notify
// ═══════════════════════════════════════════════════════════════
import { sendSms } from "./notifications.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Skicka SMS med kort magic-link till publik sida.
 * 
 * 1. Anropar public-auth-link EF → får short_url (t.ex. spick.se/m/Ab3XyZ9K)
 * 2. Bygger SMS med template-callback + short_url
 * 3. Skickar via sendSms (46elks-proxy)
 * 
 * Om public-auth-link misslyckas → fallback till redirect_to som rå URL
 * (user får fortfarande SMS, men utan inloggning).
 */
export async function sendMagicSms(params: {
  phone: string;
  email?: string;
  redirect_to: string;                    // https://spick.se/min-bokning.html?bid=<id>
  sms_template: (link: string) => string; // (link) => `Din bokning är bekräftad: ${link}`
  scope: "booking" | "subscription" | "dashboard" | "team_job" | "team_onboarding" | "other";
  resource_id?: string;
  ttl_hours?: number;                     // default 24
}): Promise<boolean> {
  let link = params.redirect_to; // fallback om auth-link failar

  if (params.email) {
    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/public-auth-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          email: params.email,
          redirect_to: params.redirect_to,
          scope: params.scope,
          resource_id: params.resource_id ?? null,
          ttl_hours: params.ttl_hours ?? 24,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.short_url) {
          link = data.short_url;
        }
      } else {
        console.warn(JSON.stringify({
          level: "warn",
          fn: "sendMagicSms",
          msg: "public-auth-link returned non-ok",
          status: res.status,
          email: (params.email || "").slice(0, 5) + "...",
        }));
      }
    } catch (e) {
      console.warn(JSON.stringify({
        level: "warn",
        fn: "sendMagicSms",
        msg: "public-auth-link call failed, using fallback URL",
        email: (params.email || "").slice(0, 5) + "...",
        error: (e as Error).message,
      }));
    }
  }

  return await sendSms(params.phone, params.sms_template(link));
}
