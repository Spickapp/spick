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
 */
export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!to || !message) return false;

  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ to, message }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(JSON.stringify({
        level: "warn",
        fn: "sendSms",
        msg: "SMS failed",
        to: to.slice(0, 5) + "...",
        status: res.status,
        error: err
      }));
      return false;
    }
    return true;
  } catch (e) {
    console.warn(JSON.stringify({
      level: "warn",
      fn: "sendSms",
      msg: "SMS exception",
      error: (e as Error).message
    }));
    return false;
  }
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
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        type,
        data,
        target_email: target.email,
        target_type: target.type,
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn(JSON.stringify({
      level: "warn",
      fn: "sendPush",
      msg: "Push exception",
      error: (e as Error).message
    }));
    return false;
  }
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
