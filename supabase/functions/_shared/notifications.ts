// ═══════════════════════════════════════════════════════════════
// SPICK – Multi-kanal notifikationer
// SMS via 46elks, Push via VAPID, In-app via notifications-tabellen
// Importeras av: cleaner-booking-response, company-propose-substitute,
//                customer-approve-proposal, auto-delegate, auto-remind
// ═══════════════════════════════════════════════════════════════

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Skicka SMS via Spicks sms-EF
 * Misslyckas tyst (loggar fel, kastar inte).
 *
 * Audit-fix P1 (2026-04-26): exponential-backoff retry på 5xx eller
 * network-fel (max 3 försök, 200ms→400ms→800ms). 4xx (kund-fel) retry:as
 * INTE — mottagar-nummer är felaktigt och retry hjälper inte.
 */
export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!to || !message) return false;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/sms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ to, message }),
      });

      if (res.ok) {
        if (attempt > 1) {
          console.log(JSON.stringify({
            level: "info", fn: "sendSms", msg: "SMS succeeded after retry",
            to: to.slice(0, 5) + "...", attempt,
          }));
        }
        return true;
      }

      // 4xx = kund-fel (felaktigt nummer etc) — retry:a inte
      if (res.status >= 400 && res.status < 500) {
        const err = await res.text();
        console.warn(JSON.stringify({
          level: "warn", fn: "sendSms", msg: "SMS failed (4xx, no retry)",
          to: to.slice(0, 5) + "...", status: res.status, error: err,
        }));
        return false;
      }

      // 5xx — retry-able
      console.warn(JSON.stringify({
        level: "warn", fn: "sendSms", msg: `SMS 5xx, attempt ${attempt}/${maxAttempts}`,
        to: to.slice(0, 5) + "...", status: res.status,
      }));
    } catch (e) {
      // Network/exception — retry-able
      console.warn(JSON.stringify({
        level: "warn", fn: "sendSms", msg: `SMS exception, attempt ${attempt}/${maxAttempts}`,
        error: (e as Error).message,
      }));
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
    }
  }
  return false;
}

/**
 * Skicka push-notis via Spicks push-EF.
 * Kräver att användaren har registrerat push_subscription.
 */
export async function sendPush(
  target: { email?: string; type?: string },
  type: string,
  data: Record<string, unknown>
): Promise<boolean> {
  // Audit-fix P1 (2026-04-26): retry på 5xx/network — samma pattern som sendSms.
  const maxAttempts = 3;
  const body = JSON.stringify({ type, data, target_email: target.email, target_type: target.type });
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
        body,
      });
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500) {
        console.warn(JSON.stringify({
          level: "warn", fn: "sendPush", msg: "Push failed (4xx, no retry)",
          status: res.status, type,
        }));
        return false;
      }
      console.warn(JSON.stringify({
        level: "warn", fn: "sendPush", msg: `Push 5xx, attempt ${attempt}/${maxAttempts}`,
        status: res.status,
      }));
    } catch (e) {
      console.warn(JSON.stringify({
        level: "warn", fn: "sendPush", msg: `Push exception, attempt ${attempt}/${maxAttempts}`,
        error: (e as Error).message,
      }));
    }
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
    }
  }
  return false;
}

/**
 * Skapa in-app notification i notifications-tabellen
 * Visas i stadare-dashboard och admin.html
 */
export async function createNotification(params: {
  cleaner_id: string;
  title: string;
  body: string;
  type: string;
  job_id?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        cleaner_id: params.cleaner_id,
        title: params.title,
        body: params.body,
        type: params.type,
        job_id: params.job_id || null,
        read: false,
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn(JSON.stringify({
      level: "warn",
      fn: "createNotification",
      msg: "Notification failed",
      error: (e as Error).message
    }));
    return false;
  }
}

/**
 * Fire-and-forget multi-kanal notifikation.
 * Skickar samtidigt via SMS + push + in-app (om parametrar finns).
 * Alla kanaler är oberoende — om en misslyckas går de andra ändå igenom.
 */
export async function notify(params: {
  cleaner_id?: string;         // För in-app + push
  email?: string;               // För push-targeting
  phone?: string;               // För SMS
  push_type?: string;           // Push notification type (se push EF)
  push_data?: Record<string, unknown>;
  sms_message?: string;
  in_app?: { title: string; body: string; type: string; job_id?: string };
}): Promise<{ sms: boolean; push: boolean; in_app: boolean }> {
  const results = { sms: false, push: false, in_app: false };

  const tasks: Promise<void>[] = [];

  if (params.phone && params.sms_message) {
    tasks.push(sendSms(params.phone, params.sms_message).then((r) => { results.sms = r; }));
  }

  if (params.email && params.push_type) {
    tasks.push(sendPush({ email: params.email }, params.push_type, params.push_data || {}).then((r) => { results.push = r; }));
  }

  if (params.cleaner_id && params.in_app) {
    tasks.push(createNotification({
      cleaner_id: params.cleaner_id,
      title: params.in_app.title,
      body: params.in_app.body,
      type: params.in_app.type,
      job_id: params.in_app.job_id,
    }).then((r) => { results.in_app = r; }));
  }

  await Promise.allSettled(tasks);
  return results;
}
