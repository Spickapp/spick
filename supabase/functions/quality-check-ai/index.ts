// ═══════════════════════════════════════════════════════════════
// SPICK – quality-check-ai (Tier A.4)
// ═══════════════════════════════════════════════════════════════
//
// AI-driven kvalitets-bedömning av städ-jobb. Triggas vid clock-out
// eller manuellt från admin. Använder Claude API.
//
// INPUT (POST): { booking_id, triggered_by: 'clock_out'|'manual'|'cron' }
// AUTH: cleaner-JWT eller service-role
//
// PIPELINE:
// 1. Hämta booking + checklist-completions + photos + customer-context
// 2. Bygg Claude-prompt
// 3. Anropa Claude API → strukturerad JSON-output (score + summary + tips)
// 4. Spara i booking_quality_assessments
// 5. Returnera score + feedback
//
// REGLER #26-#33:
// #33 AI-bedömning är RÅDGIVANDE — copy säger "AI-genererad bedömning",
//      INTE "garanterad kvalitet". Approved-claims-compliant.
// #30 Inga PII skickas till Claude (bara service_type + checklist + counts)
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const CLAUDE_MODEL = "claude-3-5-haiku-20241022"; // billig + snabb för korta prompts

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface AIQualityResult {
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
}

async function runClaudeAssessment(input: {
  service_type: string;
  template_items: Array<{ key: string; label_sv: string; required: boolean }>;
  completed_keys: string[];
  photo_count_before: number;
  photo_count_after: number;
  duration_minutes: number | null;
  expected_hours: number;
  prior_avg_rating: number | null;
}): Promise<AIQualityResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("anthropic_api_key_missing");
  }

  const totalItems = input.template_items.length;
  const requiredItems = input.template_items.filter((i) => i.required);
  const completedRequired = requiredItems.filter((i) => input.completed_keys.includes(i.key));
  const completedOptional = input.template_items.filter((i) => !i.required && input.completed_keys.includes(i.key));

  const prompt = `Du är Spicks kvalitetsanalytiker. Analysera detta städ-jobb och returnera STRIKT JSON.

JOBB-DATA:
- Tjänst: ${input.service_type}
- Schemalagd tid: ${input.expected_hours}h
- Faktisk tid: ${input.duration_minutes ? Math.round(input.duration_minutes/60*10)/10 + 'h' : 'okänd'}
- Obligatoriska checklist-items: ${requiredItems.length}, klara: ${completedRequired.length}
- Valfria items: ${input.template_items.filter((i) => !i.required).length}, klara: ${completedOptional.length}
- Foton "före": ${input.photo_count_before}
- Foton "efter": ${input.photo_count_after}
- Städarens snittbetyg historiskt: ${input.prior_avg_rating ?? 'inget'}

CHECKLIST (klar/totalt):
${input.template_items.map((i) => `- [${input.completed_keys.includes(i.key) ? 'X' : ' '}] ${i.label_sv}${i.required ? ' (obligatorisk)' : ''}`).join('\n')}

INSTRUKTIONER:
1. Score 0-100 baserat på: completion-grad (50%), tids-effektivitet (20%), foto-bevis (15%), historisk rating (15%)
2. 1-2 meningar sammanfattning
3. 1-3 styrkor (kort, max 50 tecken vardera)
4. 1-3 förbättringar (kort, max 50 tecken vardera)

Returnera ENDAST giltig JSON:
{"score": <0-100>, "summary": "...", "strengths": ["..."], "improvements": ["..."]}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`claude_api_error_${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as { content?: Array<{ text?: string }> };
  const responseText = data.content?.[0]?.text || "";

  // Försök parsa JSON ur response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("claude_no_json_in_response");
  }

  let parsed: AIQualityResult;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`claude_invalid_json: ${(e as Error).message}`);
  }

  // Validera + normalisera
  if (typeof parsed.score !== "number" || parsed.score < 0 || parsed.score > 100) {
    parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score || 50)));
  }
  parsed.summary = (parsed.summary || "").slice(0, 500);
  parsed.strengths = (Array.isArray(parsed.strengths) ? parsed.strengths : []).slice(0, 5).map((s) => String(s).slice(0, 100));
  parsed.improvements = (Array.isArray(parsed.improvements) ? parsed.improvements : []).slice(0, 5).map((s) => String(s).slice(0, 100));

  return parsed;
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    if (!ANTHROPIC_API_KEY) {
      return json(CORS, 500, { error: "anthropic_api_key_missing" });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(CORS, 401, { error: "missing_auth" });
    const token = authHeader.slice(7);

    const isServiceRole = token === SERVICE_KEY;
    let callerCleanerId: string | null = null;

    if (!isServiceRole) {
      const sbAuth = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: authErr } = await sbAuth.auth.getUser();
      if (authErr || !user) return json(CORS, 401, { error: "invalid_token" });

      const { data: caller } = await sb
        .from("cleaners")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (!caller) return json(CORS, 403, { error: "cleaner_not_found" });
      callerCleanerId = caller.id;
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json(CORS, 400, { error: "invalid_body" });

    const { booking_id, triggered_by } = body as { booking_id?: string; triggered_by?: string };
    if (!booking_id || typeof booking_id !== "string") return json(CORS, 400, { error: "booking_id_required" });
    const trigger = (["clock_out", "manual", "cron"].includes(triggered_by || "") ? triggered_by : "manual") as string;

    // ── Hämta booking + service ──
    const { data: booking } = await sb
      .from("bookings")
      .select("id, cleaner_id, service_type, hours")
      .eq("id", booking_id)
      .maybeSingle();
    if (!booking) return json(CORS, 404, { error: "booking_not_found" });

    if (!isServiceRole && booking.cleaner_id !== callerCleanerId) {
      return json(CORS, 403, { error: "not_owned_by_cleaner" });
    }

    // ── Hämta template + completions ──
    const { data: tmpl } = await sb
      .from("service_checklist_templates")
      .select("items")
      .eq("service_label_sv", booking.service_type)
      .eq("active", true)
      .maybeSingle();
    const items = (tmpl?.items as Array<{ key: string; label_sv: string; required: boolean }>) || [];

    const { data: completions } = await sb
      .from("booking_checklist_completions")
      .select("item_key,checked")
      .eq("booking_id", booking_id);
    const completedKeys = (completions || []).filter((c) => c.checked).map((c) => c.item_key);

    // ── Foto-counts ──
    const { data: photos } = await sb
      .from("booking_proof_photos")
      .select("phase")
      .eq("booking_id", booking_id);
    const photoBefore = (photos || []).filter((p) => p.phase === "before").length;
    const photoAfter = (photos || []).filter((p) => p.phase === "after").length;

    // ── Clock-events för duration ──
    const { data: clocks } = await sb
      .from("cleaner_clock_events")
      .select("event_type,created_at")
      .eq("booking_id", booking_id)
      .order("created_at", { ascending: true });
    let durationMinutes: number | null = null;
    if (clocks && clocks.length >= 2) {
      const inEvent = clocks.find((c) => c.event_type === "in");
      const outEvent = [...clocks].reverse().find((c) => c.event_type === "out");
      if (inEvent && outEvent) {
        durationMinutes = Math.round((new Date(outEvent.created_at).getTime() - new Date(inEvent.created_at).getTime()) / 60000);
      }
    }

    // ── Cleaner historisk avg-rating ──
    const { data: cleanerRow } = await sb
      .from("cleaners")
      .select("avg_rating")
      .eq("id", booking.cleaner_id)
      .maybeSingle();
    const priorAvgRating = (cleanerRow as { avg_rating?: number } | null)?.avg_rating ?? null;

    // ── Anropa Claude ──
    let aiResult: AIQualityResult;
    try {
      aiResult = await runClaudeAssessment({
        service_type: booking.service_type || "Hemstädning",
        template_items: items,
        completed_keys: completedKeys,
        photo_count_before: photoBefore,
        photo_count_after: photoAfter,
        duration_minutes: durationMinutes,
        expected_hours: Number(booking.hours) || 2,
        prior_avg_rating: priorAvgRating,
      });
    } catch (e) {
      console.error("[quality-check-ai] claude failed:", (e as Error).message);
      return json(CORS, 502, { error: "ai_call_failed", detail: (e as Error).message });
    }

    // ── Spara assessment ──
    const { data: inserted, error: insErr } = await sb
      .from("booking_quality_assessments")
      .insert({
        booking_id,
        cleaner_id: booking.cleaner_id,
        score: aiResult.score,
        ai_summary: aiResult.summary,
        ai_strengths: aiResult.strengths,
        ai_improvements: aiResult.improvements,
        triggered_by: trigger,
        raw_response: aiResult,
      })
      .select("id, created_at")
      .single();

    if (insErr) {
      console.error("[quality-check-ai] insert failed:", insErr);
      return json(CORS, 500, { error: "insert_failed", detail: insErr.message });
    }

    return json(CORS, 200, {
      ok: true,
      assessment_id: inserted.id,
      score: aiResult.score,
      summary: aiResult.summary,
      strengths: aiResult.strengths,
      improvements: aiResult.improvements,
      duration_minutes: durationMinutes,
      photo_count: { before: photoBefore, after: photoAfter },
    });
  } catch (err) {
    console.error("[quality-check-ai] unhandled:", (err as Error).message);
    return json(CORS, 500, { error: "internal_error", detail: (err as Error).message });
  }
});
