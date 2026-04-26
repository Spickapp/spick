// ═══════════════════════════════════════════════════════════════
// SPICK – vd-dispute-list (Fas 9 §9.2 — VD dispute-tab list)
// ═══════════════════════════════════════════════════════════════
//
// Returnerar alla öppna disputes (resolved_at IS NULL) för bokningar
// där cleaner tillhör VD:s företag. Med berikad info: booking-detaljer,
// cleaner-namn, evidence-counts.
//
// SCOPE:
//   - VD JWT auth (cleaner WHERE is_company_owner=true → company_id)
//   - Filter: bookings.cleaner_id ∈ company-team
//   - Filter: disputes.resolved_at IS NULL
//   - Status: 'open' = inte ännu admin-decided, 'pending_response' om
//     cleaner ej svarat
//
// ARKITEKTUR:
//   Service-role wrapper-EF eftersom RLS disputes_cleaner_read_own är
//   per-cleaner (auth.uid()), inte per-VD-company. För att VD ska se
//   team-medlemmars disputes krävs antingen ny RLS-policy eller denna
//   EF. EF-pattern är konsistent med vd-dispute-decide.
//
// REGLER: #26 grep VD-auth-pattern (vd-dispute-decide rad 73-110),
// #27 scope (bara LIST, ingen decide-logik), #28 SSOT — pattern
// återbrukad från decide-EF, #30 inga regulator-claims, #31 schema
// curl-verifierat 2026-04-26 (disputes har opened_at, inte created_at).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("vd-dispute-list");

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(CORS, 405, { error: "method_not_allowed" });
  }

  try {
    // ── VD JWT-auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);
    if (token === ANON_KEY) {
      return json(CORS, 401, { error: "anon_token_rejected" });
    }

    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    if (!authRes.ok) {
      return json(CORS, 401, { error: "invalid_token" });
    }
    const authUser = await authRes.json();
    const userEmail = (authUser.email || "").toLowerCase().trim();
    if (!userEmail) {
      return json(CORS, 401, { error: "email_missing_in_token" });
    }

    // ── Verifiera VD-roll ──
    const { data: vdRow } = await sb
      .from("cleaners")
      .select("id, full_name, company_id")
      .eq("email", userEmail)
      .eq("is_company_owner", true)
      .maybeSingle();

    if (!vdRow || !vdRow.company_id) {
      return json(CORS, 403, { error: "not_vd_or_no_company" });
    }

    const vdCompanyId = vdRow.company_id as string;

    // ── Hämta team-cleaner-ids ──
    const { data: teamRows } = await sb
      .from("cleaners")
      .select("id, full_name")
      .eq("company_id", vdCompanyId);

    const teamIds = (teamRows || []).map((c) => c.id as string);
    const cleanerNameById: Record<string, string> = {};
    (teamRows || []).forEach((c) => {
      cleanerNameById[c.id as string] = (c.full_name as string) || "Okänd";
    });

    if (teamIds.length === 0) {
      return json(CORS, 200, { disputes: [], total: 0, over_500_count: 0 });
    }

    // ── Hämta team-bookings i disputed state ──
    const { data: bookings } = await sb
      .from("bookings")
      .select("id, cleaner_id, total_price, service_type, customer_name, booking_date, escrow_state")
      .in("cleaner_id", teamIds)
      .eq("escrow_state", "disputed");

    if (!bookings || bookings.length === 0) {
      return json(CORS, 200, { disputes: [], total: 0, over_500_count: 0 });
    }

    const bookingIds = bookings.map((b) => b.id as string);
    const bookingById: Record<string, typeof bookings[number]> = {};
    bookings.forEach((b) => { bookingById[b.id as string] = b; });

    // ── Hämta disputes för dessa bookings (öppna) ──
    const { data: disputes, error: disputeErr } = await sb
      .from("disputes")
      .select("id, booking_id, opened_by, reason, customer_description, cleaner_response, cleaner_responded_at, opened_at")
      .in("booking_id", bookingIds)
      .is("resolved_at", null)
      .order("opened_at", { ascending: false });

    if (disputeErr) {
      log("error", "Dispute fetch failed", { error: disputeErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }

    if (!disputes || disputes.length === 0) {
      return json(CORS, 200, { disputes: [], total: 0, over_500_count: 0 });
    }

    const disputeIds = disputes.map((d) => d.id as string);

    // ── Hämta evidence-counts per dispute ──
    const { data: evidence } = await sb
      .from("dispute_evidence")
      .select("dispute_id, uploaded_by, storage_path")
      .in("dispute_id", disputeIds);

    const evidenceByDispute: Record<string, { customer: number; cleaner: number; paths: string[] }> = {};
    (evidence || []).forEach((e) => {
      const did = e.dispute_id as string;
      if (!evidenceByDispute[did]) evidenceByDispute[did] = { customer: 0, cleaner: 0, paths: [] };
      if (e.uploaded_by === "customer") evidenceByDispute[did].customer++;
      else if (e.uploaded_by === "cleaner") evidenceByDispute[did].cleaner++;
      evidenceByDispute[did].paths.push(e.storage_path as string);
    });

    // ── Berika disputes med booking + cleaner-info ──
    const enriched = disputes.map((d) => {
      const booking = bookingById[d.booking_id as string];
      const totalPrice = Number(booking?.total_price) || 0;
      const ev = evidenceByDispute[d.id as string] || { customer: 0, cleaner: 0, paths: [] };
      return {
        dispute_id: d.id,
        booking_id: d.booking_id,
        booking_short_id: (d.booking_id as string).slice(0, 8),
        service_type: booking?.service_type ?? null,
        customer_name: booking?.customer_name ?? null,
        booking_date: booking?.booking_date ?? null,
        total_price_sek: totalPrice,
        over_vd_cap: totalPrice > 500,
        cleaner_id: booking?.cleaner_id ?? null,
        cleaner_name: cleanerNameById[booking?.cleaner_id as string] ?? "Okänd",
        reason: d.reason,
        customer_description: d.customer_description,
        cleaner_response: d.cleaner_response,
        cleaner_responded_at: d.cleaner_responded_at,
        opened_at: d.opened_at,
        evidence_customer_count: ev.customer,
        evidence_cleaner_count: ev.cleaner,
        evidence_paths: ev.paths,
      };
    });

    const overCap = enriched.filter((e) => e.over_vd_cap).length;

    return json(CORS, 200, {
      disputes: enriched,
      total: enriched.length,
      over_500_count: overCap,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});
