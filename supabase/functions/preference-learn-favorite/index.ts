// preference-learn-favorite — Fas 5 §5.5b
// ═══════════════════════════════════════════════════════════════
// Cron-EF: auto-sätter customer_preferences.favorite_cleaner_id baserat
// på bokningshistorik — ≥3 ratings ≥4 mot samma cleaner_id = favorit.
//
// Endast om kunden INTE har manuellt satt en favorit (NULL check).
// Idempotent: körs dagligen, endast ej-satta favorites påverkas.
//
// Triggas via GitHub Actions workflow preference-learn-favorite.yml
//
// Rule #27 scope: bara auto-set. Ingen email-notifikation till kund,
//   ingen override av manuellt satt favorit, ingen "byt tillbaka"-logik.
// Rule #28 SSOT: använder _shared/preferences.ts-helpers (getPreferences +
//   setFavoriteCleaner). Ingen fragmentering.
// Rule #31: ratings-schema (cleaner_id, job_id, rating) verifierad via
//   mitt-konto.html:864-869 submitInlineReview-INSERT. bookings +
//   customer_preferences via information_schema 2026-04-24.
//
// Primärkälla: docs/planning/spick-arkitekturplan-v3.md §5.8 ("efter 3
//   bokningar rating≥4 → auto-favorit"), specificerad som §5.5b i
//   docs/v3-phase1-progress.md.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log } from "../_shared/email.ts";
import { getPreferences, setFavoriteCleaner } from "../_shared/preferences.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_RATINGS_THRESHOLD = 3;          // ≥3 bokningar krävs
const MIN_RATING_VALUE      = 4;          // alla ≥4 stjärnor
const MAX_UPDATES_PER_RUN   = 100;        // rate-limit per körning

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (s: number, d: unknown) => new Response(JSON.stringify(d), {
    status: s, headers: { ...CORS, "Content-Type": "application/json" },
  });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // ── 1. Hämta alla ratings ≥4 med cleaner_id + job_id ──
    const { data: ratings, error: rErr } = await sb
      .from("ratings")
      .select("cleaner_id, job_id, rating")
      .gte("rating", MIN_RATING_VALUE)
      .not("cleaner_id", "is", null)
      .not("job_id", "is", null);

    if (rErr) {
      log("error", "preference-learn-favorite", "Ratings fetch failed", { error: rErr.message });
      return json(500, { error: rErr.message });
    }
    if (!ratings || ratings.length === 0) {
      return json(200, { processed: 0, reason: "no qualifying ratings" });
    }

    // ── 2. Batch-fetcha customer_email via bookings.id ──
    const jobIds = [...new Set((ratings as Array<{ job_id: string }>).map((r) => r.job_id))];
    const { data: bookings, error: bErr } = await sb
      .from("bookings")
      .select("id, customer_email")
      .in("id", jobIds);

    if (bErr) {
      log("error", "preference-learn-favorite", "Bookings fetch failed", { error: bErr.message });
      return json(500, { error: bErr.message });
    }

    const emailByBookingId = new Map<string, string>();
    for (const b of (bookings || []) as Array<{ id: string; customer_email: string | null }>) {
      if (b.customer_email) emailByBookingId.set(b.id, b.customer_email.toLowerCase().trim());
    }

    // ── 3. Gruppera: (email + cleaner_id) → count ──
    const counts = new Map<string, { email: string; cleaner_id: string; count: number }>();
    for (const r of ratings as Array<{ cleaner_id: string; job_id: string }>) {
      const email = emailByBookingId.get(r.job_id);
      if (!email) continue;
      const key = `${email}|${r.cleaner_id}`;
      const entry = counts.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(key, { email, cleaner_id: r.cleaner_id, count: 1 });
      }
    }

    // ── 4. Filtrera kandidater med ≥3 ratings ──
    const candidates = Array.from(counts.values()).filter((c) => c.count >= MIN_RATINGS_THRESHOLD);

    // Deduplicera per email (en kund kan ha flera cleaners med ≥3 ratings — välj högst count)
    const bestPerEmail = new Map<string, { email: string; cleaner_id: string; count: number }>();
    for (const c of candidates) {
      const existing = bestPerEmail.get(c.email);
      if (!existing || c.count > existing.count) {
        bestPerEmail.set(c.email, c);
      }
    }

    // ── 5. För varje kandidat: sätt favorite om NULL ──
    const results: Array<Record<string, unknown>> = [];
    let updatesCount = 0;

    for (const c of bestPerEmail.values()) {
      if (updatesCount >= MAX_UPDATES_PER_RUN) break;

      const existing = await getPreferences(sb, c.email);
      if (existing?.favorite_cleaner_id) {
        results.push({ email: c.email, skipped: "manual_favorite_exists", existing: existing.favorite_cleaner_id });
        continue;
      }

      const ok = await setFavoriteCleaner(sb, c.email, c.cleaner_id);
      if (ok) {
        updatesCount += 1;
        results.push({ email: c.email, cleaner_id: c.cleaner_id, count: c.count, status: "favorite_set" });
        log("info", "preference-learn-favorite", "Favorite set", {
          email: c.email, cleaner_id: c.cleaner_id, rating_count: c.count,
        });
      } else {
        results.push({ email: c.email, cleaner_id: c.cleaner_id, status: "upsert_failed" });
      }
    }

    log("info", "preference-learn-favorite", "Run complete", {
      total_ratings: ratings.length,
      candidates_found: bestPerEmail.size,
      favorites_set: updatesCount,
      skipped_manual: results.filter((r) => r.skipped === "manual_favorite_exists").length,
    });

    return json(200, {
      processed: bestPerEmail.size,
      favorites_set: updatesCount,
      skipped_manual_favorite: results.filter((r) => r.skipped === "manual_favorite_exists").length,
      threshold: `${MIN_RATINGS_THRESHOLD} bokningar, alla rating ≥${MIN_RATING_VALUE}`,
      results,
    });
  } catch (e) {
    log("error", "preference-learn-favorite", "Fatal", { error: (e as Error).message });
    return json(500, { error: (e as Error).message });
  }
});
