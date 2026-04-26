/**
 * rating-reminder-cron — Sprint 5A
 *
 * Auto-trigga 1-tap rating-flow ~2h efter städ klar via SMS (46elks om
 * configurerat) eller mail (Resend fallback).
 *
 * MÅL: Höja recensionsfrekvens från ~15% till 80% via:
 *   - Skickar inom 2-4h efter städ (high recall window)
 *   - SMS short-link med HMAC-token (1-tap, ingen login)
 *   - Idempotent (rating_reminder_sent != NULL = skip)
 *
 * SCHEMA-VERIFIERAT (curl mot prod 2026-04-26):
 *   - bookings.completed_at FINNS
 *   - bookings.checkout_time FINNS
 *   - bookings.rating_reminder_sent — adderas via migration 20260426300000
 *   - bookings.rating_token — adderas via migration 20260426300000
 *   - ratings-tabell + ratings.job_id FINNS
 *   - get_booking_for_rating + insert_rating_with_token RPC — adderas via
 *     migration 20260426300000
 *
 * AUTH: CRON_SECRET via _shared/cron-auth.ts (samma pattern som auto-remind).
 *
 * SCHEMA: var 2:a timme dagtid (8-20 CET) via .github/workflows/rating-reminder.yml
 *
 * REGLER: #28 SSOT (cron-auth-helper, ingen inline-check), #29 audit-först
 * (auto-remind/index.ts som primärkälla för struktur), #31 schema curl-
 * verifierat mot prod (alla kolumner + RPC bekräftade).
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";
import { sendSms } from "../_shared/notifications.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = "Spick <hello@spick.se>";
const SITE = "https://spick.se";

const sb = createClient(SUPA_URL, SUPA_KEY);

// ── HMAC-token-generator ──────────────────────────────────────
// Token = base64url(hmac_sha256(booking_id, secret)).slice(0, 32)
// Lagras i bookings.rating_token + ingår i SMS-länken.
// 32-tecken nyckel = ~190 bits entropy efter base64url, oguessbart.
async function generateRatingToken(bookingId: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(bookingId));
  // base64url-encode (URL-safe utan padding)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64.slice(0, 32);
}

// ── Hämta eller initiera rating_token_secret ──────────────────
async function getRatingSecret(): Promise<string | null> {
  const { data } = await sb
    .from("platform_settings")
    .select("value")
    .eq("key", "rating_token_secret")
    .maybeSingle();
  return data?.value || null;
}

// ── E-post wrapper ────────────────────────────────────────────
function emailWrap(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{margin:0;background:#F7F7F5;font-family:'DM Sans',Arial,sans-serif}
.w{max-width:560px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.06)}
.h{background:#0F6E56;padding:20px 28px}
.logo{font-family:Georgia,serif;font-size:20px;font-weight:700;color:#fff}
.b{padding:28px;text-align:center}
.f{padding:14px 28px;background:#F7F7F5;font-size:11px;color:#9E9E9A;text-align:center}
h2{font-family:Georgia,serif;font-size:20px;color:#1C1C1A;margin:0 0 12px}
p{color:#6B6960;line-height:1.7;font-size:14px;margin:0 0 12px}
.stars{margin:20px 0;font-size:0}
.star-link{display:inline-block;font-size:36px;text-decoration:none;margin:0 4px;line-height:1}
.btn{display:inline-block;background:#0F6E56;color:#fff;padding:12px 28px;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px}
</style></head><body><div class="w">
<div class="h"><div class="logo">Spick</div></div>
<div class="b">${html}</div>
<div class="f">Spick · hello@spick.se · <a href="${SITE}" style="color:#0F6E56">spick.se</a></div>
</div></body></html>`;
}

async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_KEY) {
    console.warn("RESEND_API_KEY not set — skipping email");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) {
      console.error("Email-fel:", await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Email exception:", (e as Error).message);
    return false;
  }
}

// ── Bygg rating-länk med pre-vald stjärna (tap = direkt-submit) ──
function buildRatingUrl(bookingId: string, token: string, rating?: number): string {
  const base = `${SITE}/rate.html?b=${bookingId}&t=${token}`;
  return rating ? `${base}&r=${rating}` : base;
}

// ── Per-booking processing ───────────────────────────────────
async function processBooking(b: any, secret: string, now: Date): Promise<string> {
  // Generera + persistera token om ej redan satt
  let token = b.rating_token;
  if (!token) {
    token = await generateRatingToken(b.id, secret);
    const { error: tokErr } = await sb
      .from("bookings")
      .update({ rating_token: token })
      .eq("id", b.id);
    if (tokErr) {
      console.error(`token-update-fel ${b.id}:`, tokErr.message);
      return `error:token:${b.id}`;
    }
  }

  const cleanerName = b.cleaner_name || "din städare";
  const customerFirst = (b.customer_name || "").split(" ")[0] || "Hej";
  const ratingUrl = buildRatingUrl(b.id, token);

  // Försök SMS först (om telefonnummer finns)
  let smsOk = false;
  if (b.customer_phone) {
    const smsMessage =
      `Spick: Hej! Hur gick städningen med ${cleanerName}? ` +
      `1-tap-betyg här: ${ratingUrl}`;
    smsOk = await sendSms(b.customer_phone, smsMessage);
  }

  // Mail-fallback (alltid om SMS-failade ELLER om telefon saknas)
  let mailOk = false;
  if (!smsOk && b.customer_email) {
    const stars = [1, 2, 3, 4, 5].map((n) =>
      `<a href="${buildRatingUrl(b.id, token, n)}" class="star-link">⭐</a>`
    ).join("");

    mailOk = await sendMail(
      b.customer_email,
      `Hur gick städningen med ${cleanerName}? (1 tap)`,
      emailWrap(`
<h2>Hej ${customerFirst}!</h2>
<p>Hur gick din städning med <strong>${cleanerName}</strong>?</p>
<p style="font-size:13px;color:#9B9B95">Tap en stjärna nedan — det tar 1 sekund.</p>
<div class="stars">${stars}</div>
<p style="font-size:12px;color:#9B9B95;margin-top:16px">Eller öppna full betygssida:</p>
<a href="${ratingUrl}" class="btn">Lämna betyg →</a>
      `),
    );
  }

  // Markera reminder skickad även om båda kanaler failade
  // (annars retry varje 2h = mass-spam vid permanent fel)
  const { error: updateErr } = await sb
    .from("bookings")
    .update({ rating_reminder_sent: now.toISOString() })
    .eq("id", b.id);

  if (updateErr) {
    console.error(`reminder-flag-update-fel ${b.id}:`, updateErr.message);
    return `error:flag:${b.id}`;
  }

  if (smsOk) return `sms:${b.id}`;
  if (mailOk) return `mail:${b.id}`;
  return `noop:${b.id}`;
}

// ── Main handler ─────────────────────────────────────────────
serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const auth = requireCronAuth(req, CORS);
  if (!auth.ok) return auth.response!;

  const now = new Date();
  const sent: string[] = [];

  try {
    const secret = await getRatingSecret();
    if (!secret) {
      // Migration kanske inte applicerad — generera lokal fallback för loggning
      console.error("rating_token_secret saknas i platform_settings — kör migration 20260426300000");
      return new Response(
        JSON.stringify({ ok: false, error: "rating_token_secret_missing" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Cutoff: städ klar för minst 2h sedan, max 48h sedan (undvik
    // gamla bokningar som missades pga cron-paus eller deploy-issue)
    const cutoffMin = new Date(now.getTime() - 48 * 3_600_000).toISOString();
    const cutoffMax = new Date(now.getTime() - 2 * 3_600_000).toISOString();

    // Primary signal = completed_at (cleaner markerar klar i appen).
    // Fallback = checkout_time (om cleaner glömde markera men skannade QR).
    // Använder OR i query — completed_at OR checkout_time inom fönstret.
    const { data: candidates, error } = await sb
      .from("bookings")
      .select(
        "id, customer_email, customer_phone, customer_name, cleaner_id, cleaner_name, completed_at, checkout_time, rating_token, rating_reminder_sent, status",
      )
      .eq("status", "klar")
      .is("rating_reminder_sent", null)
      .or(
        `and(completed_at.gte.${cutoffMin},completed_at.lte.${cutoffMax}),and(checkout_time.gte.${cutoffMin},checkout_time.lte.${cutoffMax})`,
      )
      .limit(100);

    if (error) {
      console.error("Query-fel:", error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    for (const b of candidates || []) {
      // Kontaktdata måste finnas — annars kan vi inte nå kunden
      if (!b.customer_phone && !b.customer_email) {
        // Markera ändå som "sent" för att undvika att queryn återkommer hit varje run
        await sb.from("bookings")
          .update({ rating_reminder_sent: now.toISOString() })
          .eq("id", b.id);
        sent.push(`skip-no-contact:${b.id}`);
        continue;
      }

      // Skippa om redan ratad (extra säkerhet — RPC kollar också)
      const { data: existing } = await sb
        .from("ratings")
        .select("id")
        .eq("job_id", b.id)
        .limit(1);

      if (existing && existing.length > 0) {
        await sb.from("bookings")
          .update({ rating_reminder_sent: now.toISOString() })
          .eq("id", b.id);
        sent.push(`already-rated:${b.id}`);
        continue;
      }

      const result = await processBooking(b, secret, now);
      sent.push(result);
    }

    console.log("rating-reminder-cron klar:", sent);
    return new Response(
      JSON.stringify({ ok: true, processed: sent.length, sent, ts: now.toISOString() }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("rating-reminder-cron fel:", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
