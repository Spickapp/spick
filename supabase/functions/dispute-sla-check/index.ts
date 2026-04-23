// ═══════════════════════════════════════════════════════════════
// SPICK – dispute-sla-check (Fas 8 §8.12.2)
// ═══════════════════════════════════════════════════════════════
//
// Cron var timme. Övervakar dispute-SLAs:
//   - 48h utan cleaner-response → alert (admin kan besluta utan)
//   - 72h utan admin-beslut     → escalation-alert (kritiskt)
//   - 7 dagar (EU PWD deadline) → CRITICAL escalation
//
// Idempotent: använder dispute.metadata/admin_notes för att track:a
// "alert-skickad" (undviker spam). Skickar EN alert per SLA-brott.
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §5
//
// CRON: '5 * * * *' (var timme, 5 min in)
// Auth: CRON_SECRET
//
// REGLER: #26 grep dispute-structure + cron-patterns, #27 scope
// (bara SLA-check, 0 business-logic-changes), #28 SSOT = disputes-
// tabellen, #30 EU PWD 7d deadline är regulator-krav, #31 disputes
// schema live.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const CLEANER_RESPONSE_SLA_HOURS = 48;
const ADMIN_DECISION_SLA_HOURS = 72;
const EU_PWD_DEADLINE_HOURS = 168; // 7 dagar

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level,
    fn: "dispute-sla-check",
    msg,
    ...extra,
    ts: new Date().toISOString(),
  }));
}

interface DisputeRow {
  id: string;
  booking_id: string;
  reason: string;
  opened_at: string;
  cleaner_response: string | null;
  cleaner_responded_at: string | null;
  admin_decision: string | null;
  admin_decided_at: string | null;
  resolved_at: string | null;
  admin_notes: string | null;
}

// Helper: om admin_notes innehåller en SLA-tag, har alert skickats.
// Vi lägger till taggen när alert skickats första gången per SLA-typ.
// Format: "[sla:cleaner_48h][sla:admin_72h][sla:eu_pwd_168h]" i admin_notes.
function hasSlaTag(disp: DisputeRow, tag: string): boolean {
  return (disp.admin_notes || "").includes(`[sla:${tag}]`);
}

async function markSlaAlerted(disputeId: string, existingNotes: string | null, tag: string) {
  const prefix = existingNotes ? existingNotes + "\n" : "";
  await sb.from("disputes").update({
    admin_notes: prefix + `[sla:${tag}]`,
  }).eq("id", disputeId);
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Auth: CRON_SECRET ──
    const authHeader = req.headers.get("Authorization");
    const providedSecret = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.headers.get("x-cron-secret");

    if (!providedSecret || providedSecret !== CRON_SECRET) {
      return json(CORS, 401, { error: "unauthorized" });
    }

    // ── Fetch öppna disputes ──
    const { data: openDisputes, error: fetchErr } = await sb
      .from("disputes")
      .select("id, booking_id, reason, opened_at, cleaner_response, cleaner_responded_at, admin_decision, admin_decided_at, resolved_at, admin_notes")
      .is("resolved_at", null)
      .order("opened_at", { ascending: true });

    if (fetchErr) {
      log("error", "Fetch failed", { error: fetchErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }

    if (!openDisputes || openDisputes.length === 0) {
      return json(CORS, 200, { processed: 0, alerts_sent: 0 });
    }

    const now = Date.now();
    const alertsSent: Array<{ dispute_id: string; tag: string; severity: string }> = [];

    for (const d of openDisputes as DisputeRow[]) {
      const openedAt = new Date(d.opened_at).getTime();
      const hoursSinceOpen = (now - openedAt) / (60 * 60 * 1000);

      // ── Check: EU PWD 7-dagars deadline (CRITICAL) ──
      if (hoursSinceOpen >= EU_PWD_DEADLINE_HOURS && !hasSlaTag(d, "eu_pwd_168h")) {
        await sendAdminAlert({
          severity: "critical",
          title: `🚨 EU PWD SLA-breach: dispute öppen ${Math.round(hoursSinceOpen)}h`,
          source: "dispute-sla-check",
          message: "Dispute har passerat 7d EU Platform Work Directive-deadline utan resolution. REGULATORY-RISK.",
          booking_id: d.booking_id,
          metadata: {
            dispute_id: d.id,
            reason: d.reason,
            hours_open: Math.round(hoursSinceOpen),
            has_cleaner_response: !!d.cleaner_response,
            has_admin_decision: !!d.admin_decision,
          },
        });
        await markSlaAlerted(d.id, d.admin_notes, "eu_pwd_168h");
        alertsSent.push({ dispute_id: d.id, tag: "eu_pwd_168h", severity: "critical" });
        continue; // Bara EU PWD-alert per iteration — mest kritiska
      }

      // ── Check: 72h utan admin-beslut (efter cleaner-response) ──
      if (
        hoursSinceOpen >= ADMIN_DECISION_SLA_HOURS &&
        !d.admin_decision &&
        !hasSlaTag(d, "admin_72h")
      ) {
        await sendAdminAlert({
          severity: "error",
          title: `Dispute awaiting admin-decision ${Math.round(hoursSinceOpen)}h`,
          source: "dispute-sla-check",
          message: "Admin behöver fatta beslut (full_refund/partial_refund/dismissed) via dispute-admin-decide EF.",
          booking_id: d.booking_id,
          metadata: {
            dispute_id: d.id,
            reason: d.reason,
            hours_open: Math.round(hoursSinceOpen),
            has_cleaner_response: !!d.cleaner_response,
            hours_until_eu_pwd_breach: Math.round(EU_PWD_DEADLINE_HOURS - hoursSinceOpen),
          },
        });
        await markSlaAlerted(d.id, d.admin_notes, "admin_72h");
        alertsSent.push({ dispute_id: d.id, tag: "admin_72h", severity: "error" });
        continue;
      }

      // ── Check: 48h utan cleaner-response ──
      if (
        hoursSinceOpen >= CLEANER_RESPONSE_SLA_HOURS &&
        !d.cleaner_response &&
        !hasSlaTag(d, "cleaner_48h")
      ) {
        await sendAdminAlert({
          severity: "warn",
          title: "Dispute: cleaner har inte svarat 48h",
          source: "dispute-sla-check",
          message: "Admin kan fatta beslut utan cleaner-perspektiv. dispute-cleaner-respond är nu blockad (422).",
          booking_id: d.booking_id,
          metadata: {
            dispute_id: d.id,
            reason: d.reason,
            hours_open: Math.round(hoursSinceOpen),
          },
        });
        await markSlaAlerted(d.id, d.admin_notes, "cleaner_48h");
        alertsSent.push({ dispute_id: d.id, tag: "cleaner_48h", severity: "warn" });
      }
    }

    log("info", "SLA-check complete", {
      total_open: openDisputes.length,
      alerts_sent: alertsSent.length,
    });

    return json(CORS, 200, {
      processed: openDisputes.length,
      alerts_sent: alertsSent.length,
      details: alertsSent,
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});
