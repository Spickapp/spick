// ═══════════════════════════════════════════════════════════════
// SPICK – customer-upsert (Fas 1.2)
// Centraliserad kund-skapande-pipeline. Ersätter 4 fragmenterade
// INSERT/upsert-ställen (booking-create, stad-landing, mitt-konto, betyg).
//
// Skapar eller uppdaterar customer_profiles + säkerställer auth.users-koppling.
//
// Input:  { email, source, name?, phone?, address?, city?, 
//           auto_delegation_enabled?, utm_source?, source_page? }
// Output: { customer_profile_id, auth_user_id, is_new_customer }
//
// Sources:
// - "booking"        -> booking-create EF (efter betalning)
// - "lead-capture"   -> stad-landing-sidor + betyg.html
// - "profile-save"   -> mitt-konto.html (user sparar profile)
// - "rating"         -> (framtid: separat rating-flöde)
// ═══════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPA_URL, SERVICE_KEY);

type Source = "booking" | "lead-capture" | "profile-save" | "rating";

async function auditLog(event: {
  event_type: string;
  user_email?: string;
  user_id?: string;
  success: boolean;
  error_message?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await sb.from("auth_audit_log").insert(event);
  } catch (e) {
    console.warn(JSON.stringify({
      level: "warn",
      fn: "auditLog (customer-upsert)",
      error: (e as Error).message,
    }));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      email,
      source,
      name,
      phone,
      address,
      city,
      auto_delegation_enabled,
      utm_source,
      source_page,
    } = body;

    if (!email || !source) {
      return new Response(
        JSON.stringify({ error: "email and source required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validSources: Source[] = ["booking", "lead-capture", "profile-save", "rating"];
    if (!validSources.includes(source)) {
      return new Response(
        JSON.stringify({ error: `source must be one of: ${validSources.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailLower = String(email).toLowerCase().trim();

    // ═══════════════════════════════════════════════════════
    // STEG 1: Säkerställ auth.users-rad
    // ═══════════════════════════════════════════════════════
    let authUserId: string | undefined;
    let isNewAuthUser = false;

    const { data: userList } = await sb.auth.admin.listUsers();
    const existingAuthUser = userList?.users?.find(
      (u) => u.email?.toLowerCase() === emailLower
    );

    if (existingAuthUser) {
      authUserId = existingAuthUser.id;
    } else {
      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email: emailLower,
        email_confirm: true,
      });

      if (createErr) {
        console.warn(JSON.stringify({
          level: "warn",
          fn: "customer-upsert",
          msg: "createUser failed, continuing without auth_user_id",
          error: createErr.message,
        }));
      } else if (created?.user?.id) {
        authUserId = created.user.id;
        isNewAuthUser = true;
        await auditLog({
          event_type: "auth_user_created",
          user_email: emailLower,
          user_id: authUserId,
          success: true,
          metadata: { source, source_page },
        });
      }
    }

    // ═══════════════════════════════════════════════════════
    // STEG 2: Kolla om customer_profiles-rad finns (via email)
    // ═══════════════════════════════════════════════════════
    const { data: existingProfile } = await sb
      .from("customer_profiles")
      .select("id, auth_user_id, total_bookings")
      .eq("email", emailLower)
      .maybeSingle();

    const isNewCustomer = !existingProfile;

    // ═══════════════════════════════════════════════════════
    // STEG 3: Bygg payload (endast fält som skickades)
    // ═══════════════════════════════════════════════════════
    const upsertPayload: Record<string, unknown> = {
      email: emailLower,
    };

    if (name !== undefined && name !== null && name !== "") upsertPayload.name = name;
    if (phone !== undefined && phone !== null && phone !== "") upsertPayload.phone = phone;
    if (address !== undefined && address !== null && address !== "") upsertPayload.address = address;
    if (city !== undefined && city !== null && city !== "") upsertPayload.city = city;

    if (typeof auto_delegation_enabled === "boolean") {
      upsertPayload.auto_delegation_enabled = auto_delegation_enabled;
    }

    // Sätt auth_user_id om vi har det (fix för befintlig bugg där det alltid varit NULL)
    if (authUserId) {
      upsertPayload.auth_user_id = authUserId;
    }

    // Om ny rad — sätt defaults
    if (isNewCustomer) {
      if (!upsertPayload.name) upsertPayload.name = ""; // NOT NULL
      upsertPayload.created_at = new Date().toISOString();
      upsertPayload.total_bookings = 0;
    }

    // ═══════════════════════════════════════════════════════
    // STEG 4: Upsert
    // ═══════════════════════════════════════════════════════
    const { data: upserted, error: upsertErr } = await sb
      .from("customer_profiles")
      .upsert(upsertPayload, {
        onConflict: "email",
        ignoreDuplicates: false,
      })
      .select("id, auth_user_id")
      .maybeSingle();

    if (upsertErr) {
      console.error(JSON.stringify({
        level: "error",
        fn: "customer-upsert",
        msg: "upsert failed",
        error: upsertErr.message,
        email: emailLower.slice(0, 5) + "...",
      }));
      return new Response(
        JSON.stringify({ error: "upsert failed", detail: upsertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════
    // STEG 5: Returnera
    // ═══════════════════════════════════════════════════════
    return new Response(
      JSON.stringify({
        customer_profile_id: upserted?.id,
        auth_user_id: upserted?.auth_user_id,
        is_new_customer: isNewCustomer,
        is_new_auth_user: isNewAuthUser,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(JSON.stringify({
      level: "error",
      fn: "customer-upsert",
      msg: "Unhandled error",
      error: (e as Error).message,
    }));
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
