// ═══════════════════════════════════════════════════════════════
// SPICK – admin-platform-stats (Cross-company översikt 2026-04-28)
// ═══════════════════════════════════════════════════════════════
//
// Returnerar plattform-KPI över ALLA företag för admin-vy.
// Föremål: admin behöver realtidsbild av Spick som SaaS-plattform
// utan att switcha mellan view_as-vyer.
//
// SVAR-FORMAT:
// {
//   ok: true,
//   period: { year, month },
//   global: { total_companies, active_companies, total_cleaners,
//             active_cleaners, bookings_this_month, brutto_sek,
//             spick_provision_sek, rut_fordran_sek, pending_payouts_sek },
//   top_companies: [{ id, name, bookings_count, brutto_sek, provision_sek }],
//   at_risk_companies: [{ id, name, last_booking_date, days_inactive }],
//   monthly_trend: [{ month_iso, brutto_sek, provision_sek, bookings_count }]
// }
//
// AUTH: admin_users-tabellen (samma pattern som alla admin-EFs)
// REGLER: #26 läst admin-create-company auth-pattern, #27 scope =
// bara aggregat, ingen mutation, #28 SSOT (denna EF = enda källan
// för plattform-KPI), #30 ingen regulator-claim, #31 schema verifierat
// (companies, cleaners, bookings — alla finns i prod).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";
import { permissionErrorToResponse, requireAdmin } from "../_shared/permissions.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("admin-platform-stats");

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { from, to };
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Admin-auth (centraliserad via _shared/permissions.ts) ──
    try {
      await requireAdmin(req, sb);
    } catch (e) {
      const r = permissionErrorToResponse(e, CORS);
      if (r) return r;
      throw e;
    }

    // ── Period (default: pågående månad) ──
    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const year = (body && typeof body.year === "number") ? body.year : now.getUTCFullYear();
    const month = (body && typeof body.month === "number") ? body.month : (now.getUTCMonth() + 1);
    const { from, to } = monthRange(year, month);

    // ── Provision-rate från platform_settings ──
    const { data: provRow } = await sb.from("platform_settings")
      .select("value").eq("key", "commission_standard").maybeSingle();
    const provisionRate = (Number(provRow?.value) || 12) / 100;

    // ── Global KPI ──
    const { count: totalCompanies } = await sb.from("companies")
      .select("*", { count: "exact", head: true });
    const { count: totalCleaners } = await sb.from("cleaners")
      .select("*", { count: "exact", head: true })
      .eq("is_approved", true);

    const { data: monthBookings } = await sb.from("bookings")
      .select("id, total_price, rut_amount, cleaner_id, payment_status, escrow_state, rut_application_status")
      .gte("booking_date", from)
      .lte("booking_date", to)
      .eq("payment_status", "paid");

    const bookings = monthBookings || [];
    const brutto = bookings.reduce((s, b) =>
      s + (Number(b.total_price) || 0) + (Number(b.rut_amount) || 0), 0);
    const provision = Math.round(brutto * provisionRate);
    const rutFordran = bookings
      .filter(b => {
        const rut = Number(b.rut_amount) || 0;
        const st = b.rut_application_status as string;
        return rut > 0 && st !== "approved" && st !== "paid";
      })
      .reduce((s, b) => s + (Number(b.rut_amount) || 0), 0);

    // ── Top 10 företag denna månad (per brutto) ──
    // Måste joina cleaners → companies för att aggregera per company
    const cleanerIds = [...new Set(bookings.map(b => b.cleaner_id).filter(Boolean))];
    const { data: cleanerRows } = cleanerIds.length > 0
      ? await sb.from("cleaners").select("id, company_id").in("id", cleanerIds)
      : { data: [] };
    const cleanerToCompany = new Map<string, string | null>();
    (cleanerRows || []).forEach(c => cleanerToCompany.set(c.id as string, c.company_id as string | null));

    const perCompanyMap = new Map<string, { brutto: number; bookings: number }>();
    bookings.forEach(b => {
      const cid = cleanerToCompany.get(b.cleaner_id as string);
      if (!cid) return;
      const bt = (Number(b.total_price) || 0) + (Number(b.rut_amount) || 0);
      const ex = perCompanyMap.get(cid);
      if (ex) { ex.brutto += bt; ex.bookings += 1; }
      else perCompanyMap.set(cid, { brutto: bt, bookings: 1 });
    });

    const companyIds = Array.from(perCompanyMap.keys());
    const { data: companyMeta } = companyIds.length > 0
      ? await sb.from("companies").select("id, name, display_name").in("id", companyIds)
      : { data: [] };
    const companyName = new Map<string, string>();
    (companyMeta || []).forEach(c => companyName.set(c.id as string,
      (c.display_name as string) || (c.name as string) || "Okänt"));

    const topCompanies = Array.from(perCompanyMap.entries())
      .map(([id, v]) => ({
        id,
        name: companyName.get(id) || "Okänt",
        bookings_count: v.bookings,
        brutto_sek: Math.round(v.brutto),
        provision_sek: Math.round(v.brutto * provisionRate),
      }))
      .sort((a, b) => b.brutto_sek - a.brutto_sek)
      .slice(0, 10);

    const activeCompanies = perCompanyMap.size;
    const activeCleaners = new Set(bookings.map(b => b.cleaner_id).filter(Boolean)).size;

    // ── At-risk: företag som inte har bokningar senaste 30 dagar ──
    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const { data: recentBookingsAll } = await sb.from("bookings")
      .select("cleaner_id, booking_date")
      .gte("booking_date", cutoff)
      .order("booking_date", { ascending: false });
    const recentCompanies = new Set<string>();
    (recentBookingsAll || []).forEach(b => {
      const cid = cleanerToCompany.get(b.cleaner_id as string);
      if (cid) recentCompanies.add(cid);
    });
    const { data: allCompanies } = await sb.from("companies")
      .select("id, name, display_name");
    const atRisk = ((allCompanies || []) as Array<Record<string, unknown>>)
      .filter(c => !recentCompanies.has(c.id as string))
      .map(c => ({
        id: c.id as string,
        name: (c.display_name as string) || (c.name as string) || "Okänt",
        days_inactive: 30, // approximation: minst 30 dagar
      }))
      .slice(0, 10);

    // ── Monthly trend: senaste 12 månader ──
    const trendStart = new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 10);
    const { data: trendBookings } = await sb.from("bookings")
      .select("booking_date, total_price, rut_amount")
      .gte("booking_date", trendStart)
      .eq("payment_status", "paid");
    const trendMap = new Map<string, { brutto: number; bookings: number }>();
    (trendBookings || []).forEach(b => {
      const dt = (b.booking_date as string).slice(0, 7); // YYYY-MM
      const bt = (Number(b.total_price) || 0) + (Number(b.rut_amount) || 0);
      const ex = trendMap.get(dt);
      if (ex) { ex.brutto += bt; ex.bookings += 1; }
      else trendMap.set(dt, { brutto: bt, bookings: 1 });
    });
    const trend = Array.from(trendMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([m, v]) => ({
        month_iso: m,
        brutto_sek: Math.round(v.brutto),
        provision_sek: Math.round(v.brutto * provisionRate),
        bookings_count: v.bookings,
      }));

    log("info", "Stats computed", {
      year, month, active_companies: activeCompanies, top_n: topCompanies.length,
    });

    return json(CORS, 200, {
      ok: true,
      period: { year, month },
      provision_rate_pct: Math.round(provisionRate * 100),
      global: {
        total_companies: totalCompanies || 0,
        active_companies: activeCompanies,
        total_cleaners: totalCleaners || 0,
        active_cleaners: activeCleaners,
        bookings_this_month: bookings.length,
        brutto_sek: Math.round(brutto),
        spick_provision_sek: provision,
        rut_fordran_sek: Math.round(rutFordran),
      },
      top_companies: topCompanies,
      at_risk_companies: atRisk,
      monthly_trend: trend,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});
