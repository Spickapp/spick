// ═══════════════════════════════════════════════════════════════
// SPICK – Delad Edge Function-infrastruktur
// Importeras av: notify, stripe-webhook, auto-remind, health
// ═══════════════════════════════════════════════════════════════

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM  = "Spick <hello@spick.se>";
const ADMIN = "hello@spick.se";

/**
 * Fetch med timeout (default 10s)
 */
export async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Structured log entry
 */
export function log(level: "info" | "warn" | "error", fn: string, msg: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, fn, msg, ...data };
  if (level === "error") console.error(JSON.stringify(entry));
  else if (level === "warn") console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

/**
 * HTML-escape user input mot XSS i e-post
 */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Branded HTML e-post wrapper
 */
export function wrap(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>body{margin:0;padding:0;background:#F7F7F5;font-family:'DM Sans',Arial,sans-serif}
.wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)}
.header{background:#0F6E56;padding:24px 32px}
.logo{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff}
.body{padding:32px}
.footer{padding:16px 32px;background:#F7F7F5;font-size:12px;color:#9E9E9A;text-align:center}
h2{font-family:Georgia,serif;font-size:20px;color:#1C1C1A;margin:0 0 12px}
p{color:#6B6960;line-height:1.7;font-size:15px;margin:0 0 12px}
.card{background:#F7F7F5;border-radius:12px;padding:20px;margin:16px 0}
.row{padding:6px 0;border-bottom:1px solid #E8E8E4;font-size:14px}
.row:last-child{border:none;padding-top:12px}
.row .lbl{color:#9B9B95;display:inline-block;min-width:110px;padding-right:12px}.row .val{font-weight:600;color:#1C1C1A}
.btn{display:inline-block;background:#0F6E56;color:#fff;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px;margin-top:8px}
.badge{display:inline-block;background:#E1F5EE;color:#0F6E56;padding:6px 14px;border-radius:100px;font-size:13px;font-weight:600}
</style></head><body>
<div class="wrap">
  <div class="header"><div class="logo">Spick</div></div>
  <div class="body">${content}</div>
  <div class="footer">Spick · 559402-4522 · hello@spick.se · <a href="https://spick.se" style="color:#0F6E56">spick.se</a></div>
</div></body></html>`;
}

/**
 * Helper: info-kort med rader
 */
export function card(rows: Array<[string, string]>): string {
  return `<div class="card">${rows.map(([lbl, val]) =>
    `<div class="row"><span class="lbl">${lbl}</span><span class="val">${val}</span></div>`
  ).join("")}</div>`;
}

/**
 * Skicka e-post via Resend
 * Returnerar { ok, id?, error? }
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  // §10.6 (2026-04-25): admin-email-disable-flag.
  // När DISABLE_ADMIN_EMAIL='true' i env → admin-emails (to=ADMIN) skippas.
  // Discord-webhook (sendAdminAlert) fortsätter funka parallellt eftersom
  // alla call-sites redan har sendAdminAlert-anrop. Customer-emails
  // (bekräftelser, kvitton) påverkas INTE.
  const disableAdminEmail = (Deno.env.get("DISABLE_ADMIN_EMAIL") || "").toLowerCase() === "true";
  if (disableAdminEmail && to === ADMIN) {
    return { ok: true, id: "skipped-admin-email-disabled" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, id: data.id };
    }
    const err = await res.text();
    console.error(`Resend ${res.status}: ${err}`);
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    console.error("sendEmail error:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * CORS-headers (begränsat till spick.se) med 24h preflight-cache
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ["https://spick.se", "https://www.spick.se"];
  const allow = allowed.includes(origin) ? origin : "https://spick.se";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
    "Access-Control-Max-Age": "86400",
  };
}

export function getMaterialInfo(serviceType: string): { customer: string; cleaner: string; emoji: string } {
  const svc = (serviceType || "").toLowerCase();
  if (svc.includes("flytt")) {
    return {
      customer: "Städaren tar med all utrustning och alla rengöringsmedel. Du behöver inte förbereda något.",
      cleaner: "⚠️ DU TAR MED ALL UTRUSTNING: dammsugare, mopp, hinkar, allrengöring, ugnsrengöring, avkalkningsmedel, fönsterspray, mikrofiberdukar, skrapa, handskar. Lägenheten är tom.",
      emoji: "🧰"
    };
  }
  if (svc.includes("fönster") || svc.includes("fonster")) {
    return {
      customer: "Städaren tar med all fönsterputsutrustning. Du behöver inte förbereda något.",
      cleaner: "Ta med fönsterutrustning: squeegee, skrapa, fönsterlösning, mikrofiberdukar.",
      emoji: "🪟"
    };
  }
  return {
    customer: "Se till att dammsugare, mopp och rengöringsmedel finns tillgängliga för städaren.",
    cleaner: "Kundens utrustning — dammsugare och mopp ska finnas på plats.",
    emoji: "🏠"
  };
}

// ── PNR KRYPTERING (AES-256-GCM) ────────────────────────
const PNR_KEY = Deno.env.get("PNR_ENCRYPTION_KEY") || "";

export async function encryptPnr(pnr: string): Promise<string> {
  if (!PNR_KEY || !pnr) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PNR_KEY.padEnd(32, "0").slice(0, 32)),
    "AES-GCM",
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(pnr)
  );
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptPnr(encrypted: string): Promise<string> {
  if (!PNR_KEY || !encrypted) return "";
  try {
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(PNR_KEY.padEnd(32, "0").slice(0, 32)),
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return "";
  }
}

export { FROM, ADMIN };
