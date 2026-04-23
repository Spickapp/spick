// ═══════════════════════════════════════════════════════════════
// SPICK – Admin-alert-helper (Fas 10 §10.1 + §10.2 partial)
// ═══════════════════════════════════════════════════════════════
//
// Centraliserad admin-alert-dispatcher för prod-observability.
// Skickar till Slack/Discord/generic webhook om konfigurerat, annars
// strukturerad console.log (pickas upp av Supabase log-aggregation).
//
// PRIMÄRKÄLLA:
//   docs/planning/spick-arkitekturplan-v3.md §10 (Observability)
//
// ANVÄNDNING (från EFs):
//   import { sendAdminAlert } from "../_shared/alerts.ts";
//
//   await sendAdminAlert({
//     severity: "error",
//     title: "VD timeout escalation failed",
//     source: "auto-remind",
//     booking_id: b.id,
//     metadata: { vd_id: "...", attempt: 2 }
//   });
//
// KONFIG:
//   ENV ADMIN_ALERT_WEBHOOK_URL — Slack-webhook, Discord-webhook, eller
//   generic JSON-endpoint. Om tom → fallback till strukturerad console.
//
// GRACEFUL DEGRADATION:
//   1. Om webhook-URL satt → POST JSON (auto-detect Slack/Discord)
//   2. Om webhook fail eller URL saknas → console.error "[ALERT] ..."
//   Kastar ALDRIG — alerts är best-effort audit, inte kritisk path.
//
// REGLER: #26 grep notifications.ts-mönstret, #27 scope (bara helper,
// ingen retrofit av 27 existing mail-ADMIN-calls denna commit),
// #28 SSOT = denna fil för alert-shape, #30 N/A, #31 primärkälla =
// plan §10.1.
// ═══════════════════════════════════════════════════════════════

export type AlertSeverity = "info" | "warn" | "error" | "critical";

export interface AdminAlert {
  severity: AlertSeverity;
  title: string;
  source: string; // EF/function name, t.ex. "auto-remind"
  message?: string;
  metadata?: Record<string, unknown>;
  booking_id?: string;
  cleaner_id?: string;
  company_id?: string;
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: "\u2139\uFE0F", // ℹ️
  warn: "\u26A0\uFE0F", // ⚠️
  error: "\u274C", // ❌
  critical: "\uD83D\uDEA8", // 🚨
};

const SEVERITY_COLOR_HEX: Record<AlertSeverity, string> = {
  info: "#3B82F6",
  warn: "#F59E0B",
  error: "#EF4444",
  critical: "#991B1B",
};

const SEVERITY_COLOR_INT: Record<AlertSeverity, number> = {
  info: 0x3B82F6,
  warn: 0xF59E0B,
  error: 0xEF4444,
  critical: 0x991B1B,
};

/**
 * Skicka admin-alert till konfigurerad webhook.
 * Best-effort — kastar aldrig, returnerar true vid lyckad webhook-delivery.
 */
export async function sendAdminAlert(alert: AdminAlert): Promise<boolean> {
  // Validera minimal shape (caller-bug-skydd)
  if (!alert || !alert.title || !alert.source || !alert.severity) {
    console.error("[alerts] Invalid alert shape, skipping:", alert);
    return false;
  }

  const webhookUrl = Deno.env.get("ADMIN_ALERT_WEBHOOK_URL");

  if (webhookUrl) {
    try {
      const ok = await postToWebhook(webhookUrl, alert);
      if (ok) return true;
      console.warn(
        "[alerts] webhook non-2xx, falling back to console",
        { title: alert.title, source: alert.source },
      );
    } catch (e) {
      console.warn(
        "[alerts] webhook exception, falling back to console:",
        (e as Error).message,
      );
    }
  }

  // Fallback: strukturerad console (pickas upp av Supabase log-aggregation)
  console.error("[ALERT]", JSON.stringify({
    severity: alert.severity,
    title: alert.title,
    source: alert.source,
    message: alert.message,
    booking_id: alert.booking_id,
    cleaner_id: alert.cleaner_id,
    company_id: alert.company_id,
    metadata: alert.metadata,
    ts: new Date().toISOString(),
  }));
  return false;
}

/**
 * Detektera plattform från URL-mönster + skicka korrekt payload-format.
 * Slack:   https://hooks.slack.com/services/...
 * Discord: https://discord.com/api/webhooks/...
 * Annat:   generic JSON (alert-objektet + emoji + timestamp)
 */
async function postToWebhook(url: string, alert: AdminAlert): Promise<boolean> {
  const isSlack = url.includes("hooks.slack.com");
  const isDiscord = url.includes("discord.com/api/webhooks") ||
    url.includes("discordapp.com/api/webhooks");

  let payload: Record<string, unknown>;

  if (isSlack) {
    payload = buildSlackPayload(alert);
  } else if (isDiscord) {
    payload = buildDiscordPayload(alert);
  } else {
    payload = {
      ...alert,
      emoji: SEVERITY_EMOJI[alert.severity],
      ts: new Date().toISOString(),
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

function buildSlackPayload(alert: AdminAlert): Record<string, unknown> {
  const fields: Array<{ title: string; value: string; short: boolean }> = [
    { title: "Source", value: alert.source, short: true },
    { title: "Severity", value: alert.severity, short: true },
  ];

  if (alert.booking_id) {
    fields.push({ title: "Booking", value: alert.booking_id, short: true });
  }
  if (alert.cleaner_id) {
    fields.push({ title: "Cleaner", value: alert.cleaner_id, short: true });
  }
  if (alert.company_id) {
    fields.push({ title: "Company", value: alert.company_id, short: true });
  }
  if (alert.metadata) {
    for (const [k, v] of Object.entries(alert.metadata)) {
      fields.push({ title: k, value: String(v), short: true });
    }
  }

  return {
    text: `${SEVERITY_EMOJI[alert.severity]} *${alert.title}*`,
    attachments: [{
      color: SEVERITY_COLOR_HEX[alert.severity],
      text: alert.message || undefined,
      fields,
      footer: "Spick",
      ts: Math.floor(Date.now() / 1000),
    }],
  };
}

function buildDiscordPayload(alert: AdminAlert): Record<string, unknown> {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: "Source", value: alert.source, inline: true },
    { name: "Severity", value: alert.severity, inline: true },
  ];

  if (alert.booking_id) {
    fields.push({ name: "Booking", value: alert.booking_id, inline: true });
  }
  if (alert.cleaner_id) {
    fields.push({ name: "Cleaner", value: alert.cleaner_id, inline: true });
  }
  if (alert.company_id) {
    fields.push({ name: "Company", value: alert.company_id, inline: true });
  }
  if (alert.metadata) {
    for (const [k, v] of Object.entries(alert.metadata)) {
      fields.push({ name: k, value: String(v), inline: true });
    }
  }

  return {
    embeds: [{
      title: `${SEVERITY_EMOJI[alert.severity]} ${alert.title}`,
      description: alert.message || undefined,
      color: SEVERITY_COLOR_INT[alert.severity],
      fields,
      footer: { text: "Spick" },
      timestamp: new Date().toISOString(),
    }],
  };
}
