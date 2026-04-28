// ═══════════════════════════════════════════════════════════════
// SPICK – vd-payment-summary (Fas 9-utökning, 2026-04-26)
// ═══════════════════════════════════════════════════════════════
//
// Aggregerar betalnings-status per company för VD-dashboarden.
// Ger transparens över: slutreglerat, i escrow, kommande, per-cleaner.
//
// AUTH: JWT (cleaner-token). VD-kontroll: cleaner.is_company_owner=true.
//
// SVAR-FORMAT:
// {
//   ok: true,
//   period: { year, month },
//   company: { id, name },
//   slutreglerat: { total_sek, count, bookings: [...] },
//   i_escrow: { total_sek, count, bookings: [...] },
//   kommande: { total_sek, count, bookings: [...] },
//   per_cleaner: [{ cleaner_id, full_name, count, total_sek }]
// }
//
// REGLER: #26 grep schema (money.ts payout_audit_log-INSERT pattern),
// #27 scope (bara aggregat, ingen mutation), #28 SSOT (denna EF =
// enda källa för VD-payment-overview), #30 ingen Stripe Balance-API
// (skippas tills behövs — DB-aggregat räcker), #31 schema verifierat
// via _shared/money.ts code-grep 2026-04-26.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("vd-payment-summary");

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
    // ── JWT-auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(CORS, 401, { error: "missing_auth" });
    const token = authHeader.slice(7);
    if (token === ANON_KEY) return json(CORS, 401, { error: "anon_not_allowed" });
    const sbAuth = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser();
    if (authErr || !user) return json(CORS, 401, { error: "invalid_token" });

    // ── ADMIN-BYPASS (per project_admin_bypass_principle 2026-04-27) ──
    // Admin (admin_users-tabellen) får agera åt vilken VD som helst för
    // felsökning + impersonation. Body kan skicka view_as_cleaner_id eller
    // company_id för att specifiera vilket företag att summera.
    let isAdmin = false;
    if (user.email) {
      const { data: adminRow } = await sbService
        .from("admin_users")
        .select("email")
        .eq("email", user.email)
        .eq("is_active", true)
        .maybeSingle();
      isAdmin = !!adminRow;
    }

    const earlyBody = await req.json().catch(() => ({}));
    let companyId: string;
    let callerName = "(admin)";

    if (isAdmin && (earlyBody?.view_as_cleaner_id || earlyBody?.company_id)) {
      // Admin impersonation: hämta company_id från body
      if (earlyBody.company_id) {
        companyId = earlyBody.company_id;
      } else {
        const { data: targetCl } = await sbService
          .from("cleaners")
          .select("company_id, full_name")
          .eq("id", earlyBody.view_as_cleaner_id)
          .maybeSingle();
        if (!targetCl?.company_id) return json(CORS, 422, { error: "view_as_cleaner_has_no_company" });
        companyId = targetCl.company_id;
        callerName = `Admin (${user.email}) → ${targetCl.full_name}`;
      }
    } else {
      // Vanlig VD-flow: hämta caller-cleaner + verifiera is_company_owner
      const { data: caller, error: callerErr } = await sbService
        .from("cleaners")
        .select("id, company_id, is_company_owner, full_name")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (callerErr || !caller) return json(CORS, 403, { error: "cleaner_not_found" });
      if (!caller.is_company_owner) return json(CORS, 403, { error: "not_company_owner" });
      if (!caller.company_id) return json(CORS, 422, { error: "no_company_id" });
      companyId = caller.company_id as string;
      callerName = caller.full_name as string;
    }

    // ── Hämta company-info ──
    const { data: company } = await sbService
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .maybeSingle();

    // ── Period (default: pågående månad) — använder earlyBody som redan parsats ──
    const body = earlyBody;
    const now = new Date();
    const year = (body && typeof body.year === "number") ? body.year : now.getUTCFullYear();
    const month = (body && typeof body.month === "number") ? body.month : (now.getUTCMonth() + 1);
    const { from, to } = monthRange(year, month);

    // ── Hämta alla cleaner-IDs i company (för WHERE-filter) ──
    const { data: teamMembers } = await sbService
      .from("cleaners")
      .select("id, full_name")
      .eq("company_id", companyId);
    const teamIds = (teamMembers || []).map((m) => m.id as string);
    if (teamIds.length === 0) {
      return json(CORS, 200, {
        ok: true,
        period: { year, month },
        company: company || { id: companyId, name: null },
        slutreglerat: { total_sek: 0, count: 0, bookings: [] },
        i_escrow: { total_sek: 0, count: 0, bookings: [] },
        kommande: { total_sek: 0, count: 0, bookings: [] },
        per_cleaner: [],
      });
    }

    // ── Slutreglerat: bookings med transfer_created i payout_audit_log denna månad ──
    const { data: paidBookings } = await sbService
      .from("bookings")
      .select("id, booking_id, booking_date, total_price, cleaner_id, cleaner_name, customer_name, service_type, escrow_state")
      .in("cleaner_id", teamIds)
      .gte("booking_date", from)
      .lte("booking_date", to)
      .in("escrow_state", ["released", "released_partial"]);
    const slutreglerat = paidBookings || [];

    // ── I escrow: bookings i awaiting_attest eller paid_held ──
    // Inkluderar rut_amount + rut_application_status för RUT-fordran-aggregat
    const { data: escrowBookings } = await sbService
      .from("bookings")
      .select("id, booking_id, booking_date, total_price, rut_amount, cleaner_id, cleaner_name, customer_name, service_type, escrow_state, rut_application_status")
      .in("cleaner_id", teamIds)
      .gte("booking_date", from)
      .lte("booking_date", to)
      .in("escrow_state", ["paid_held", "awaiting_attest"]);
    const iEscrow = escrowBookings || [];

    // ── Kommande: bokade ej utförda + INTE i escrow (annars dubbel-räkning) ──
    // Fix 2026-04-28: tidigare räknades Clara-Maria både i "I escrow" och
    // "Kommande" (878 kr × 2 = 1756 kr fel-aggregat). Plus saknades svenska
    // status-namn ('avbokad','klar') i exclusion → zombie-test-bokningar
    // räknades som "Kommande".
    const todayIso = now.toISOString().slice(0, 10);
    const escrowIds = new Set((escrowBookings || []).map(b => b.id as string));
    const { data: kommandeBookingsRaw } = await sbService
      .from("bookings")
      .select("id, booking_id, booking_date, total_price, cleaner_id, cleaner_name, customer_name, service_type, escrow_state, status")
      .in("cleaner_id", teamIds)
      .gte("booking_date", todayIso)
      .not("status", "in", "(cancelled,avbokad,completed,klar,timed_out,rejected,expired)");
    const kommande = (kommandeBookingsRaw || []).filter(b => !escrowIds.has(b.id as string));

    // ── Per cleaner-aggregat (slutreglerat + escrow denna månad) ──
    const allRelevant = [...slutreglerat, ...iEscrow];
    const perCleanerMap = new Map<string, { cleaner_id: string; full_name: string; count: number; total_sek: number }>();
    for (const b of allRelevant) {
      const cid = b.cleaner_id as string;
      if (!cid) continue;
      const member = teamMembers?.find((m) => m.id === cid);
      const fullName = member?.full_name as string || (b.cleaner_name as string) || "Okänd";
      const existing = perCleanerMap.get(cid);
      const price = Number(b.total_price) || 0;
      if (existing) {
        existing.count += 1;
        existing.total_sek += price;
      } else {
        perCleanerMap.set(cid, { cleaner_id: cid, full_name: fullName, count: 1, total_sek: price });
      }
    }
    const perCleaner = Array.from(perCleanerMap.values())
      .sort((a, b) => b.total_sek - a.total_sek);

    const sumPrice = (rows: Array<Record<string, unknown>>) =>
      rows.reduce((acc, r) => acc + (Number(r.total_price) || 0), 0);

    // ── RUT-fordran: pengar som väntar från Skatteverket ──
    // För varje bokning i escrow OCH released (denna månad) som har rut_amount > 0
    // OCH rut_application_status NOT IN ('approved','paid'), summera rut_amount.
    // VD ser då hur mycket extra som kommer in från SKV (~6 veckor efter städning).
    const allWithRut = [...iEscrow, ...slutreglerat].filter((b) => {
      const rut = Number((b as Record<string, unknown>).rut_amount) || 0;
      const rutStatus = (b as Record<string, unknown>).rut_application_status as string | null;
      const paid = rutStatus === "approved" || rutStatus === "paid";
      return rut > 0 && !paid;
    });
    const rutFordran = {
      total_sek: allWithRut.reduce((s, b) => s + (Number((b as Record<string, unknown>).rut_amount) || 0), 0),
      count: allWithRut.length,
      bookings: allWithRut,
    };

    // ── P&L (Resultaträkning) — alla betalda bokningar denna månad ──
    // Använder slutreglerat + iEscrow (utförda eller pågående jobb).
    // 'kommande' exkluderas (inte realiserat ännu).
    // Provision-rate från platform_settings (SSOT).
    const { data: provRow } = await sb.from("platform_settings")
      .select("value").eq("key", "commission_standard").maybeSingle();
    const provisionRate = (Number(provRow?.value) || 12) / 100;
    const cleanerKeepRate = 1 - provisionRate;

    const realizedBookings = [...slutreglerat, ...iEscrow];
    const bruttoPL = realizedBookings.reduce((s, b) =>
      s + (Number((b as Record<string, unknown>).total_price) || 0)
        + (Number((b as Record<string, unknown>).rut_amount) || 0), 0);
    const spickProvisionPL = Math.round(bruttoPL * provisionRate);
    const cleanerLonekostnad = Math.round(bruttoPL * cleanerKeepRate);

    // Hämta godkända utlägg denna månad för company
    const { data: approvedExpenses } = await sb.from("cleaner_expenses")
      .select("amount_ore, vat_amount_ore, status, expense_date")
      .eq("company_id", companyId)
      .gte("expense_date", from)
      .lte("expense_date", to)
      .eq("status", "approved");
    const utlaggGodkanda = (approvedExpenses || [])
      .reduce((s, e) => s + Math.round((Number(e.amount_ore) || 0) / 100), 0);

    const nettoMarginal = bruttoPL - spickProvisionPL - cleanerLonekostnad - utlaggGodkanda;
    const marginalPct = bruttoPL > 0 ? Math.round((nettoMarginal / bruttoPL) * 100) : 0;

    const pl = {
      brutto_sek: Math.round(bruttoPL),
      spick_provision_sek: spickProvisionPL,
      provision_rate_pct: Math.round(provisionRate * 100),
      cleaner_lonekostnad_sek: cleanerLonekostnad,
      cleaner_keep_rate_pct: Math.round(cleanerKeepRate * 100),
      utlagg_godkanda_sek: utlaggGodkanda,
      utlagg_count: (approvedExpenses || []).length,
      netto_marginal_sek: nettoMarginal,
      marginal_pct: marginalPct,
      bookings_count: realizedBookings.length,
    };

    return json(CORS, 200, {
      ok: true,
      period: { year, month },
      company: company || { id: companyId, name: null },
      slutreglerat: {
        total_sek: sumPrice(slutreglerat),
        count: slutreglerat.length,
        bookings: slutreglerat,
      },
      i_escrow: {
        total_sek: sumPrice(iEscrow),
        count: iEscrow.length,
        bookings: iEscrow,
      },
      kommande: {
        total_sek: sumPrice(kommande),
        count: kommande.length,
        bookings: kommande,
      },
      rut_fordran: rutFordran,
      pl: pl,
      per_cleaner: perCleaner,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});
