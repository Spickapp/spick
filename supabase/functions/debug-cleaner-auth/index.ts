// ═══════════════════════════════════════════════════════════════
// SPICK – debug-cleaner-auth
// Diagnostisk EF för att felsöka varför en cleaner (typ. VD) inte
// kan accept/reject team-bokningar via cleaner-booking-response.
//
// Returnerar ALLTID 200 (utom på auth-fail) med full debug-payload.
// Återanvänder exakt samma authoriserings-logik som
// cleaner-booking-response (raderna 57-71) men utan is_approved-filter
// vid cleaner-fetch så vi kan SE om flaggan är false.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const ACTIONABLE_STATUSES = [
  "pending_confirmation",
  "bekräftad",
  "pending",
  "awaiting_reassignment",
];

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── AUTH: verify logged-in user ─────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return json({ error: "Unauthorized" }, 401, CORS);
    }

    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
      },
    });
    if (!authRes.ok) return json({ error: "Invalid token" }, 401, CORS);
    const authUser = await authRes.json();

    // ── PARSE BODY ─────────────────────────────────────────
    let booking_id: string | null = null;
    try {
      const body = await req.json();
      booking_id = body?.booking_id || null;
    } catch {
      // body kan vara tomt — fortsätt med null
    }

    console.log(JSON.stringify({
      fn: "debug-cleaner-auth",
      booking_id,
      authUser: authUser?.id,
    }));

    // ── FETCH CLEANER (utan is_approved-filter!) ───────────
    const { data: cleanerRow } = await sb
      .from("cleaners")
      .select("id, full_name, is_approved, is_company_owner, company_id, auth_user_id, terms_accepted_at")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    const cleaner = cleanerRow
      ? {
          id: cleanerRow.id as string | null,
          full_name: cleanerRow.full_name as string | null,
          is_approved: !!cleanerRow.is_approved,
          is_company_owner: !!cleanerRow.is_company_owner,
          company_id: (cleanerRow.company_id as string | null) ?? null,
          company_name: null as string | null,
          auth_user_id: cleanerRow.auth_user_id as string,
          terms_accepted_at: (cleanerRow.terms_accepted_at as string | null) ?? null,
        }
      : null;

    // ── COMPANY NAME (om cleaner.company_id) ───────────────
    if (cleaner?.company_id) {
      const { data: company } = await sb
        .from("companies")
        .select("name, display_name")
        .eq("id", cleaner.company_id)
        .single();
      if (company) {
        cleaner.company_name =
          (company.display_name as string | null) ||
          (company.name as string | null) ||
          null;
      }
    }

    // ── FETCH BOOKING ──────────────────────────────────────
    let booking: {
      id: string;
      status: string;
      cleaner_id: string | null;
      cleaner_name: string | null;
      customer_name: string | null;
      booking_date: string | null;
    } | null = null;
    let assignedCleaner: {
      id: string;
      full_name: string;
      company_id: string | null;
    } | null = null;
    let bookingMissing = false;

    if (booking_id) {
      const { data: bookingRow } = await sb
        .from("bookings")
        .select("id, status, cleaner_id, cleaner_name, customer_name, booking_date")
        .eq("id", booking_id)
        .maybeSingle();

      if (bookingRow) {
        booking = {
          id: bookingRow.id as string,
          status: bookingRow.status as string,
          cleaner_id: (bookingRow.cleaner_id as string | null) ?? null,
          cleaner_name: (bookingRow.cleaner_name as string | null) ?? null,
          customer_name: (bookingRow.customer_name as string | null) ?? null,
          booking_date: (bookingRow.booking_date as string | null) ?? null,
        };

        // ── FETCH ASSIGNED CLEANER ─────────────────────────
        if (booking.cleaner_id) {
          const { data: ac } = await sb
            .from("cleaners")
            .select("id, full_name, company_id")
            .eq("id", booking.cleaner_id)
            .single();
          if (ac) {
            assignedCleaner = {
              id: ac.id as string,
              full_name: ac.full_name as string,
              company_id: (ac.company_id as string | null) ?? null,
            };
          }
        }
      } else {
        bookingMissing = true;
      }
    }

    // ── COMPUTE company_match ──────────────────────────────
    const company_match = !!(
      assignedCleaner &&
      cleaner &&
      assignedCleaner.company_id &&
      cleaner.company_id &&
      assignedCleaner.company_id === cleaner.company_id
    );

    // ── COMPUTE is_authorized + reason ─────────────────────
    // Exakt samma logik som cleaner-booking-response (raderna 57-71)
    // men med diagnostiska reasons istället för en generisk 403.
    let is_authorized = false;
    let reason: string | null = null;

    if (!cleaner) {
      reason = "Cleaner-row saknas (auth_user_id matchar inte)";
    } else if (!cleaner.is_approved) {
      reason = "is_approved=false. Admin-godkännande saknas.";
    } else if (bookingMissing) {
      reason = "Bokning hittades inte";
    } else if (!booking) {
      reason = "Inget booking_id angivet";
    } else if (booking.cleaner_id === cleaner.id) {
      is_authorized = true;
    } else if (cleaner.is_company_owner && company_match) {
      is_authorized = true;
    } else {
      reason =
        "VD är inte company-owner ELLER tilldelad städares company_id matchar inte";
    }

    // ── COMPUTE status_allowed_for_action ──────────────────
    const status_allowed_for_action = !!(
      booking && ACTIONABLE_STATUSES.includes(booking.status)
    );

    return json({
      cleaner,
      booking,
      assigned_cleaner: assignedCleaner,
      company_match,
      is_authorized,
      reason,
      status_allowed_for_action,
    }, 200, CORS);
  } catch (err) {
    // Diagnostisk EF — returnera 200 även vid oväntat fel,
    // packa felet i reason så frontend kan visa något användbart.
    console.error(JSON.stringify({
      fn: "debug-cleaner-auth",
      level: "error",
      msg: "Unhandled error",
      error: (err as Error).message,
    }));
    return json({
      cleaner: null,
      booking: null,
      assigned_cleaner: null,
      company_match: false,
      is_authorized: false,
      reason: `Internt fel: ${(err as Error).message}`,
      status_allowed_for_action: false,
    }, 200, corsHeaders(req));
  }
});

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
