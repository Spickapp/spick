// ═══════════════════════════════════════════════════════════════
// SPICK – Magic-link hjälpare för publika auth-flows (Fas 1.2)
// 
// Exporterar två funktioner:
// - sendMagicSms: Skicka SMS med kort magic-link
// - generateMagicShortUrl: Bygg kort magic-link-URL (för HTML-email)
//
// Båda använder public-auth-link EF → shortcode i magic_link_shortcodes.
// 
// Importeras av: auto-remind, stripe-webhook, company-propose-substitute,
//                cleaner-booking-response, booking-reassign, notify, rut-claim
// ═══════════════════════════════════════════════════════════════
import { sendSms } from "./notifications.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Scope = "booking" | "subscription" | "dashboard" | "team_job" | "team_onboarding" | "other";

/**
 * Generera kort magic-link-URL utan att skicka SMS.
 * Används för HTML-email där länken embeds i <a href>.
 * 
 * Om email saknas eller public-auth-link failar → returnerar redirect_to 
 * som fallback (användaren får länken, men utan inloggning).
 */
export async function generateMagicShortUrl(params: {
  email?: string;
  redirect_to: string;
  scope: Scope;
  resource_id?: string;
  ttl_hours?: number;
}): Promise<string> {
  if (!params.email) {
    return params.redirect_to; // ingen email → ingen auth-länk möjlig
  }

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
        return data.short_url;
      }
    } else {
      console.warn(JSON.stringify({
        level: "warn",
        fn: "generateMagicShortUrl",
        msg: "public-auth-link returned non-ok",
        status: res.status,
        email: (params.email || "").slice(0, 5) + "...",
      }));
    }
  } catch (e) {
    console.warn(JSON.stringify({
      level: "warn",
      fn: "generateMagicShortUrl",
      msg: "public-auth-link call failed, using fallback URL",
      email: (params.email || "").slice(0, 5) + "...",
      error: (e as Error).message,
    }));
  }

  return params.redirect_to; // fallback
}

/**
 * Skicka SMS med kort magic-link till publik sida.
 * 
 * Använder generateMagicShortUrl internally + skickar via sendSms (46elks-proxy).
 */
export async function sendMagicSms(params: {
  phone: string;
  email?: string;
  redirect_to: string;
  sms_template: (link: string) => string;
  scope: Scope;
  resource_id?: string;
  ttl_hours?: number;
}): Promise<boolean> {
  const link = await generateMagicShortUrl({
    email: params.email,
    redirect_to: params.redirect_to,
    scope: params.scope,
    resource_id: params.resource_id,
    ttl_hours: params.ttl_hours,
  });

  return await sendSms(params.phone, params.sms_template(link));
}
