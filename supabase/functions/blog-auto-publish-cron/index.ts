// ═══════════════════════════════════════════════════════════════
// SPICK – blog-auto-publish-cron (Sprint 6, 2026-04-26)
// ═══════════════════════════════════════════════════════════════
//
// Cron-EF: triggas tis + tor 09:00 via GitHub Actions
// (.github/workflows/blog-auto-publish.yml).
//
// FLÖDE:
//   1. Hämta platform_settings.blog_topics_queue (JSONB-array som text)
//   2. Pop första topic { topic, target_keyword, city? }
//   3. Anropa blog-generate-EF
//   4. INSERT blog_posts (published_at = NOW())
//   5. UPDATE platform_settings.blog_topics_queue (remove processed)
//   6. Logga + Sentry-capture vid fel
//
// AUTH: CRON_SECRET via requireCronAuth helper.
//
// REGLER (#26-#31):
// - #28 SSOT: en tabell (blog_posts), en queue (platform_settings)
// - #31 platform_settings.value är TEXT (verifierat 2026-04-26 mot prod)
//   → vi parsar/serialiserar JSON manuellt med JSON.parse/stringify
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, log } from "../_shared/email.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";
import { captureError, captureMessage } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const QUEUE_KEY = "blog_topics_queue";

interface TopicEntry {
  topic: string;
  target_keyword: string;
  city?: string;
}

interface BlogGenerateOutput {
  title: string;
  slug: string;
  html_content: string;
  meta_description: string;
  og_image_prompt?: string;
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // CRON_SECRET-auth (samma pattern som auto-rebook, cleanup-stale)
  const auth = requireCronAuth(req, CORS);
  if (!auth.ok) return auth.response!;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const json = (s: number, d: unknown) =>
    new Response(JSON.stringify(d), {
      status: s,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    // 1. Hämta queue
    const { data: setting, error: fetchErr } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", QUEUE_KEY)
      .maybeSingle();

    if (fetchErr) {
      log("error", "blog-auto-publish-cron", "Queue-fetch fel", { error: fetchErr.message });
      await captureError(fetchErr, { ef: "blog-auto-publish-cron", phase: "queue_fetch" });
      return json(500, { error: fetchErr.message });
    }

    if (!setting?.value) {
      log("warn", "blog-auto-publish-cron", "Queue saknas eller är tom (platform_settings.blog_topics_queue)", {});
      return json(200, { processed: 0, reason: "queue_missing_or_empty" });
    }

    let queue: TopicEntry[];
    try {
      const parsed = JSON.parse(setting.value);
      if (!Array.isArray(parsed)) throw new Error("queue must be JSON array");
      queue = parsed;
    } catch (e) {
      log("error", "blog-auto-publish-cron", "Queue JSON-parse fel", {
        error: (e as Error).message,
        raw_preview: String(setting.value).slice(0, 200),
      });
      await captureError(e, { ef: "blog-auto-publish-cron", phase: "queue_parse" });
      return json(500, { error: "queue_parse_failed" });
    }

    if (queue.length === 0) {
      log("info", "blog-auto-publish-cron", "Queue är tom — inget att publicera", {});
      await captureMessage("blog_topics_queue tom — påminn admin att fylla på", "warning", {
        ef: "blog-auto-publish-cron",
      });
      return json(200, { processed: 0, reason: "queue_empty" });
    }

    // 2. Pop första topic
    const next = queue[0];
    const remaining = queue.slice(1);

    if (!next.topic || !next.target_keyword) {
      log("error", "blog-auto-publish-cron", "Ogiltigt queue-item — saknar topic/target_keyword", { item: next });
      // Pop ändå så vi inte fastnar
      await sb.from("platform_settings").update({
        value: JSON.stringify(remaining),
        updated_at: new Date().toISOString(),
      }).eq("key", QUEUE_KEY);
      return json(400, { error: "invalid_queue_item", item: next });
    }

    log("info", "blog-auto-publish-cron", "Processar topic", { topic: next.topic, queue_remaining: remaining.length });

    // 3. Anropa blog-generate-EF (använder service-key för internal call)
    const genRes = await fetch(`${SUPABASE_URL}/functions/v1/blog-generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({
        topic: next.topic,
        target_keyword: next.target_keyword,
        city: next.city || undefined,
      }),
    });

    if (!genRes.ok) {
      const errBody = await genRes.text().catch(() => "");
      log("error", "blog-auto-publish-cron", "blog-generate misslyckades", {
        status: genRes.status,
        body: errBody.slice(0, 500),
      });
      await captureError(new Error(`blog-generate ${genRes.status}: ${errBody.slice(0, 200)}`), {
        ef: "blog-auto-publish-cron",
        phase: "generate",
        topic: next.topic,
      });
      // Pop EJ — låt nästa cron-körning försöka igen (idempotent retry)
      return json(502, { error: "generate_failed", status: genRes.status });
    }

    const gen = await genRes.json() as BlogGenerateOutput;

    if (!gen.title || !gen.slug || !gen.html_content || !gen.meta_description) {
      log("error", "blog-auto-publish-cron", "blog-generate output ofullständig", { gen });
      await captureMessage("blog-generate output saknar obligatoriska fält", "error", {
        ef: "blog-auto-publish-cron",
        gen_keys: Object.keys(gen).join(","),
      });
      return json(502, { error: "generate_incomplete" });
    }

    // 4. INSERT blog_posts (published_at = NOW())
    // Hantera slug-collision: lägg till -2, -3 etc.
    let finalSlug = gen.slug;
    let collisionAttempt = 0;
    while (collisionAttempt < 10) {
      const { data: existing } = await sb
        .from("blog_posts")
        .select("id")
        .eq("slug", finalSlug)
        .maybeSingle();

      if (!existing) break;
      collisionAttempt++;
      finalSlug = `${gen.slug}-${collisionAttempt + 1}`;
    }

    const { data: inserted, error: insertErr } = await sb
      .from("blog_posts")
      .insert({
        slug: finalSlug,
        title: gen.title,
        html_content: gen.html_content,
        meta_description: gen.meta_description,
        target_keyword: next.target_keyword,
        city: next.city || null,
        og_image_prompt: gen.og_image_prompt || null,
        published_at: new Date().toISOString(),
      })
      .select("id, slug, title")
      .single();

    if (insertErr) {
      log("error", "blog-auto-publish-cron", "INSERT blog_posts misslyckades", { error: insertErr.message });
      await captureError(insertErr, { ef: "blog-auto-publish-cron", phase: "insert", slug: finalSlug });
      return json(500, { error: insertErr.message });
    }

    // 5. UPDATE queue (pop processed)
    const { error: updateErr } = await sb
      .from("platform_settings")
      .update({
        value: JSON.stringify(remaining),
        updated_at: new Date().toISOString(),
      })
      .eq("key", QUEUE_KEY);

    if (updateErr) {
      // Post är skapad men queue inte uppdaterad → nästa körning skapar dubblett.
      // Logga som critical men returnera 200 (post är ju publicerad).
      log("error", "blog-auto-publish-cron", "Queue-update misslyckades EFTER publicering — risk för dubblett", {
        error: updateErr.message,
        post_id: inserted.id,
      });
      await captureError(updateErr, {
        ef: "blog-auto-publish-cron",
        phase: "queue_update",
        post_id: inserted.id,
        severity: "critical",
      });
    }

    log("info", "blog-auto-publish-cron", "Publicerad", {
      post_id: inserted.id,
      slug: inserted.slug,
      title: inserted.title,
      queue_remaining: remaining.length,
    });

    return json(200, {
      processed: 1,
      post: inserted,
      queue_remaining: remaining.length,
    });
  } catch (e) {
    const err = e as Error;
    log("error", "blog-auto-publish-cron", "Fatal", { error: err.message });
    await captureError(err, { ef: "blog-auto-publish-cron", phase: "fatal" });
    return json(500, { error: err.message });
  }
});
